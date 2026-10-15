import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { processMessage } from '../src/message.ts';
import { gitEnvironment, resolveTrustedGit, SafeGit } from '../src/safe-git.ts';

async function fixture() {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'output-scope-')));
    const repository = path.join(directory, 'business');
    await mkdir(repository);
    const executable = await resolveTrustedGit([directory]);
    const env = gitEnvironment();
    const git = (args: string[], cwd = repository) =>
        execFileSync(executable, args, { cwd, env, encoding: 'utf8', windowsHide: true }).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    const operation = {
        schemaVersion: 1,
        id: 'output',
        repository,
        worktree: repository,
        commonGitDir: await realpath(path.join(repository, '.git')),
        kind: 'commit',
        paths: ['new.txt'],
        targets: [],
    };
    const decision = {
        schemaVersion: 2,
        artifact: 'policy-decision',
        operation,
        branch: 'repository-policy',
        rationale: 'Agent selected repository policy.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture:policy' },
    };
    const snapshot = async () => ({
        head: await readFile(path.join(operation.commonGitDir, 'HEAD')),
        config: await readFile(path.join(operation.commonGitDir, 'config')),
        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
        index: existsSync(path.join(operation.commonGitDir, 'index'))
            ? await readFile(path.join(operation.commonGitDir, 'index'))
            : null,
    });
    return {
        directory,
        repository,
        executable,
        git,
        operation,
        decision,
        snapshot,
        dispose: () => rm(directory, { recursive: true, force: true }),
    };
}

test('output publication locates actual Git metadata and rejects a forged explicit scope', async () => {
    const f = await fixture();
    try {
        const message = Buffer.from('subject\r\n\r\nAssisted-by: invalid\r\n');
        const load = async () => {
            throw new Error('default accessed');
        };
        const before = await f.snapshot();
        const output = path.join(f.directory, 'candidate');
        const result = await processMessage({ mode: 'render', message, ...f, output }, load);
        assert.equal(result.exitCode, 10);
        assert.deepEqual(await readFile(output), message);
        const unrelated = path.join(f.directory, 'unrelated-admin');
        await mkdir(unrelated);
        const operation = { ...f.operation, commonGitDir: unrelated };
        await assert.rejects(
            processMessage(
                {
                    mode: 'render',
                    message,
                    operation,
                    decision: { ...f.decision, operation },
                    output: path.join(f.operation.commonGitDir, 'forged-output'),
                },
                load,
            ),
            /scope|directory|metadata/i,
        );
        assert.equal(existsSync(path.join(f.operation.commonGitDir, 'forged-output')), false);
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('linked worktree outputs protect its private and common Git directories without inspecting targets', async () => {
    const f = await fixture();
    try {
        f.git([
            '-c',
            'user.name=Synthetic Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'fixture',
        ]);
        const worktree = path.join(f.directory, 'linked');
        f.git(['worktree', 'add', '--quiet', '-b', 'fixture-linked', worktree]);
        const gitDirectory = await realpath(f.git(['rev-parse', '--absolute-git-dir'], worktree));
        const operation = {
            ...f.operation,
            repository: worktree,
            worktree,
            kind: 'rebase',
            targets: [{ role: 'declared-unavailable', objectId: 'f'.repeat(40) }],
        };
        const input = {
            mode: 'render' as const,
            message: Buffer.from('subject\n'),
            operation,
            decision: { ...f.decision, operation },
        };
        const load = async () => {
            throw new Error('default accessed');
        };
        const before = await f.snapshot();
        for (const output of [path.join(gitDirectory, 'candidate'), path.join(f.operation.commonGitDir, 'candidate')]) {
            await assert.rejects(processMessage({ ...input, output }, load), /metadata/i);
            assert.equal(existsSync(output), false);
        }
        const output = path.join(f.directory, 'linked-candidate');
        assert.equal((await processMessage({ ...input, output }, load)).exitCode, 10);
        assert.equal(await readFile(output, 'utf8'), 'subject\n');
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('output metadata protection rejects linked parents and ordinary consumed-input aliases', async () => {
    const f = await fixture();
    try {
        const parent = path.join(f.directory, 'linked-parent');
        await symlink(f.operation.commonGitDir, parent, process.platform === 'win32' ? 'junction' : 'dir');
        const input = { mode: 'render' as const, message: Buffer.from('subject\n'), ...f };
        const load = async () => {
            throw new Error('default accessed');
        };
        await assert.rejects(processMessage({ ...input, output: path.join(parent, 'candidate') }, load));
        const alias = path.join(f.directory, 'absent-input');
        await assert.rejects(
            processMessage({ ...input, output: alias, consumedPaths: [alias] }, load),
            /consumed input/i,
        );
        assert.equal(existsSync(alias), false);
    } finally {
        await f.dispose();
    }
});

test('safe Git accepts only fixed location/exclusion argv and rejects scanner or write forms before launch', async () => {
    const f = await fixture();
    try {
        const runner = new SafeGit(f.executable, f.repository);
        await runner.guard();
        for (const option of ['--show-toplevel', '--absolute-git-dir', '--git-common-dir'])
            assert.ok(await runner.text('rev-parse', [option]));
        assert.ok(await runner.text('rev-parse', ['--path-format=absolute', '--git-path', 'info/exclude']));
        assert.equal((await runner.run('ls-files', ['--cached', '--full-name', '-z'])).length, 0);
        assert.equal(
            (
                await runner.run(
                    'check-ignore',
                    ['--no-index', '--', '.ai-commit-attribution/', '.ai-commit-attribution/state.json'],
                    true,
                )
            ).length,
            0,
        );
        const rejectingExecutable = new SafeGit(process.execPath, f.repository);
        for (const [command, args] of [
            ['fetch', []],
            ['commit', []],
            ['config', ['--list']],
            ['symbolic-ref', ['--quiet', 'HEAD']],
            ['symbolic-ref', ['HEAD', 'refs/heads/changed']],
            ['symbolic-ref', ['--delete', 'HEAD']],
            ['rev-parse', ['--show-object-format']],
            ['rev-parse', ['--shared-index-path']],
            ['rev-parse', ['--verify', '--quiet', 'HEAD']],
            ['rev-parse', ['--show-toplevel', '--absolute-git-dir']],
            ['ls-files', ['--stage', '-z']],
            ['ls-files', ['--cached', '-z', '--', 'other']],
            ['check-ignore', ['--no-index', '--', 'other']],
            ['rev-parse', ['--path-format=absolute', '--git-path', 'config']],
            ['diff', ['--cached', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--']],
            ['cat-file', ['-p', 'a'.repeat(40)]],
            ['rev-list', ['--max-count=10001', `${'a'.repeat(40)}..${'b'.repeat(40)}`]],
            [
                'diff-tree',
                [
                    '--root',
                    '--no-commit-id',
                    '--name-only',
                    '-r',
                    '-z',
                    '--no-ext-diff',
                    '--no-textconv',
                    'a'.repeat(40),
                    '--',
                ],
            ],
        ] as const)
            await assert.rejects(rejectingExecutable.run(command, [...args]), /Unsupported read-only Git argv/);
        assert.throws(() => new SafeGit('git', f.repository));
        await assert.rejects(resolveTrustedGit([path.parse(f.executable).root]), /unavailable/);
        await assert.rejects(rejectingExecutable.guard());
        const timeout = new SafeGit(f.executable, f.repository);
        Object.defineProperty(timeout, 'started', { value: performance.now() - 31_000 });
        await assert.rejects(timeout.guard(), /time budget/);
    } finally {
        await f.dispose();
    }
});

test('Git output location isolates hostile environment and leaves command sentinels and identity config untouched', async () => {
    const f = await fixture();
    try {
        const sentinel = path.join(f.directory, 'executed');
        const script = path.join(f.directory, 'trap.sh');
        await writeFile(script, `echo executed > '${sentinel.replaceAll('\\', '/')}'\n`);
        for (const key of [
            'core.fsmonitor',
            'diff.external',
            'filter.trap.clean',
            'trailer.assisted.command',
            'credential.helper',
            'core.sshCommand',
        ])
            f.git(['config', key, script.replaceAll('\\', '/')]);
        const before = await f.snapshot();
        const sanitized = gitEnvironment({
            ...process.env,
            GIT_DIR: 'wrong',
            GIT_WORK_TREE: 'wrong',
            GIT_CONFIG_PARAMETERS: 'secret',
            GIT_TRACE: sentinel,
            HOME: 'wrong',
            NODE_OPTIONS: '--require wrong',
        });
        for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_PARAMETERS', 'GIT_TRACE', 'HOME', 'NODE_OPTIONS'])
            assert.equal(sanitized[key], undefined);
        assert.equal(sanitized.GIT_ALLOW_PROTOCOL, '');
        const runner = new SafeGit(f.executable, f.repository, {
            ...process.env,
            GIT_DIR: 'wrong',
            GIT_TRACE: sentinel,
        });
        assert.equal(await runner.text('rev-parse', ['--show-toplevel']), f.repository.replaceAll('\\', '/'));
        assert.equal(existsSync(sentinel), false);
        assert.deepEqual(await f.snapshot(), before);
        if (process.platform === 'win32') {
            await writeFile(path.join(f.repository, 'git.exe'), 'INVALID-TEXT lookup sentinel\r\n');
            const negative = spawnSync('git', ['--version'], { cwd: f.repository, windowsHide: true });
            assert.ok(negative.error || negative.status !== 0);
            assert.ok(await runner.text('rev-parse', ['--absolute-git-dir']));
        }
    } finally {
        await f.dispose();
    }
});
