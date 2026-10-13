import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkFreshRouting, scanPolicy } from '../src/policy.ts';
import { resolveTrustedGit } from '../src/safe-git.ts';

async function fixture() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-ops-')));
    const executable = await resolveTrustedGit([root]);
    const env = {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
    };
    const args = [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.fsmonitor=false',
    ];
    const git = (values: string[], cwd = root) =>
        execFileSync(executable, [...args, ...values], { cwd, env, encoding: 'utf8', windowsHide: true }).trim();
    const attempt = (values: string[]) =>
        spawnSync(executable, [...args, ...values], { cwd: root, env, encoding: 'utf8', windowsHide: true });
    git(['init', '--quiet', '--initial-branch=main']);
    const operation = {
        schemaVersion: 1,
        id: 'scope',
        repository: root,
        worktree: root,
        commonGitDir: await realpath(path.join(root, '.git')),
        kind: 'commit',
        paths: ['file.txt'],
        targets: [] as { role: string; objectId: string }[],
    };
    const context = {
        schemaVersion: 1,
        phase: 'prepare',
        selection: 'planned-paths',
        invocation: { kind: 'direct-git', reference: 'actual fixture argv', effectiveDirectory: root },
    };
    const commit = async (name = 'file.txt', bytes = 'initial\n') => {
        await writeFile(path.join(root, name), bytes);
        git(['add', '--', name]);
        git(['commit', '--quiet', '-m', 'fixture']);
        return git(['rev-parse', 'HEAD']);
    };
    return {
        root,
        executable,
        git,
        attempt,
        operation,
        context,
        commit,
        dispose: () => rm(root, { recursive: true, force: true }),
    };
}
function decision(scan: Awaited<ReturnType<typeof scanPolicy>>) {
    return {
        schemaVersion: 1,
        artifact: 'policy-decision',
        operation: scan.operation,
        binding: scan.binding,
        branch: 'skill-default',
        assessments: scan.candidates.map((item) => ({
            candidateId: item.id,
            classification: 'unrelated',
            rationale: 'Fixture has no adopted disclosure rule.',
        })),
        selectedCandidateIds: [],
        issueIds: scan.issues.map((item) => item.id),
        rationale: 'Fixture semantic assessment.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture' },
    };
}

test('actual merge/cherry-pick/rebase message operations bind targets, parents, metadata and paths', async () => {
    const f = await fixture();
    try {
        const base = await f.commit();
        f.git(['checkout', '--quiet', '-b', 'source']);
        const source = await f.commit('source.txt', 'source\n');
        f.git(['checkout', '--quiet', 'main']);
        const head = await f.commit('main.txt', 'main\n');
        f.git(['merge', '--quiet', '--no-commit', 'source']);
        const merge = {
            ...f.operation,
            kind: 'merge',
            paths: [],
            targets: [
                { role: 'head', objectId: head },
                { role: 'source', objectId: source },
            ],
        };
        const context = { ...f.context, phase: 'edit-message', selection: 'operation-targets' };
        const scan = await scanPolicy({ operation: merge, context });
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.equal(
            (
                await scanPolicy({
                    operation: {
                        ...merge,
                        targets: [
                            { role: 'head', objectId: head },
                            { role: 'source', objectId: base },
                        ],
                    },
                    context,
                })
            ).exitCode,
            20,
        );
        assert.ok(scan.checkedLocations.some((item) => item.locator.endsWith('source.txt/AGENTS.md') === false));
        const before = await readFile(path.join(f.root, '.git/MERGE_HEAD'));
        assert.equal((await checkFreshRouting({ operation: merge, context, decision: decision(scan) })).exitCode, 0);
        assert.deepEqual(await readFile(path.join(f.root, '.git/MERGE_HEAD')), before);
        await writeFile(path.join(f.root, '.git/MERGE_MSG'), 'Changed operation message metadata.\n');
        assert.equal(
            (await checkFreshRouting({ operation: merge, context, decision: decision(scan) })).freshness,
            'stale',
        );
        f.git(['merge', '--abort']);
        assert.equal((await scanPolicy({ operation: merge, context })).exitCode, 20);
        // Divergent edits create a real stopped cherry-pick, then a real stopped rebase.
        f.git(['checkout', '--quiet', 'source']);
        const conflictSource = await f.commit('file.txt', 'source edit\n');
        f.git(['checkout', '--quiet', 'main']);
        const conflictHead = await f.commit('file.txt', 'main edit\n');
        assert.notEqual(f.attempt(['cherry-pick', conflictSource]).status, 0);
        const cherry = {
            ...f.operation,
            kind: 'cherry-pick',
            targets: [
                { role: 'source', objectId: conflictSource },
                { role: 'head', objectId: conflictHead },
            ],
        };
        const cherryScan = await scanPolicy({ operation: cherry, context });
        assert.equal(cherryScan.exitCode, 0, JSON.stringify(cherryScan.issues));
        f.git(['cherry-pick', '--abort']);
        assert.notEqual(f.attempt(['rebase', 'source']).status, 0);
        const rebase = {
            ...f.operation,
            kind: 'rebase',
            targets: [
                { role: 'original', objectId: conflictHead },
                { role: 'onto', objectId: conflictSource },
                { role: 'base', objectId: base },
            ],
        };
        const rebased = await scanPolicy({ operation: rebase, context });
        assert.equal(rebased.exitCode, 0, JSON.stringify(rebased.issues));
        await writeFile(path.join(f.root, '.git/rebase-merge/git-rebase-todo'), 'exec never-run-this\n');
        assert.equal((await scanPolicy({ operation: rebase, context })).exitCode, 20);
        f.git(['rebase', '--abort']);
    } finally {
        await f.dispose();
    }
});

test('amend/squash coverage, all-tracked/index selections and explicit wrapper inputs', async () => {
    const f = await fixture();
    try {
        const base = await f.commit();
        const head = await f.commit('second.txt', 'second\n');
        for (const [kind, selection] of [
            ['amend', 'specified-paths'],
            ['squash', 'operation-targets'],
            ['commit', 'all-tracked'],
            ['commit', 'index'],
        ] as const) {
            const operation = {
                ...f.operation,
                kind,
                targets: [
                    { role: 'base', objectId: base },
                    { role: 'head', objectId: head },
                ],
            };
            const context = {
                ...f.context,
                selection,
                invocation: {
                    ...f.context.invocation,
                    kind: 'wrapper-adapter',
                    adapter: 'explicit-scope-v1',
                    repositoryPath: f.root,
                    gitDirectory: path.join(f.root, '.git'),
                    worktreePath: f.root,
                },
            };
            assert.equal((await scanPolicy({ operation, context })).exitCode, 0, `${kind}/${selection}`);
        }
        assert.equal(
            (await scanPolicy({ operation: { ...f.operation, kind: 'amend' }, context: f.context })).exitCode,
            20,
        );
        assert.equal(
            (
                await scanPolicy({
                    operation: { ...f.operation, kind: 'squash', targets: [{ role: 'head', objectId: head }] },
                    context: f.context,
                })
            ).exitCode,
            20,
        );
        assert.equal(
            (
                await scanPolicy({
                    operation: f.operation,
                    context: {
                        ...f.context,
                        invocation: { ...f.context.invocation, kind: 'wrapper-adapter', adapter: 'unknown' },
                    },
                })
            ).exitCode,
            20,
        );
        await assert.rejects(
            scanPolicy({
                operation: f.operation,
                context: {
                    ...f.context,
                    invocation: { ...f.context.invocation, repositoryPath: path.join(f.root, '.git') },
                },
            }),
        );
        await mkdir(path.join(f.root, 'nested'));
        f.git(['init', '--quiet'], path.join(f.root, 'nested'));
        await assert.rejects(
            scanPolicy({ operation: { ...f.operation, paths: ['nested/file.txt'] }, context: f.context }),
        );
    } finally {
        await f.dispose();
    }
});

test('cross-project linked worktrees, separate Git directory and bare common owner remain independent', async () => {
    const f = await fixture();
    const external = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-cross-project-')));
    try {
        const head = await f.commit();
        const linked = path.join(external, 'linked');
        f.git(['worktree', 'add', '--quiet', '-b', 'linked', linked]);
        const linkedRoot = await realpath(linked);
        const operation = {
            ...f.operation,
            repository: linkedRoot,
            worktree: linkedRoot,
            targets: [{ role: 'head', objectId: head }],
        };
        const context = { ...f.context, invocation: { ...f.context.invocation, effectiveDirectory: linkedRoot } };
        const scan = await scanPolicy({ operation, context });
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.notEqual(scan.binding.gitDirectory, operation.commonGitDir);
        const otherScan = await scanPolicy(f);
        await assert.rejects(checkFreshRouting({ operation, context, decision: decision(otherScan) }));
        const separate = path.join(external, 'separate');
        const gitdir = path.join(external, 'metadata');
        f.git(['init', '--quiet', '--separate-git-dir', gitdir, separate]);
        const physicalSeparate = await realpath(separate);
        const separateOperation = {
            ...f.operation,
            repository: physicalSeparate,
            worktree: physicalSeparate,
            commonGitDir: await realpath(gitdir),
        };
        assert.equal(
            (
                await scanPolicy({
                    operation: separateOperation,
                    context: {
                        ...f.context,
                        invocation: { ...f.context.invocation, effectiveDirectory: physicalSeparate },
                    },
                })
            ).exitCode,
            0,
        );
        const bare = path.join(external, 'bare.git');
        f.git(['clone', '--quiet', '--bare', f.root, bare]);
        const bareLinked = path.join(external, 'bare-linked');
        f.git(['--git-dir', bare, 'worktree', 'add', '--quiet', bareLinked]);
        const bareRoot = await realpath(bareLinked);
        const bareOperation = {
            ...f.operation,
            repository: bareRoot,
            worktree: bareRoot,
            commonGitDir: await realpath(bare),
            targets: [{ role: 'head', objectId: head }],
        };
        assert.equal(
            (
                await scanPolicy({
                    operation: bareOperation,
                    context: { ...f.context, invocation: { ...f.context.invocation, effectiveDirectory: bareRoot } },
                })
            ).exitCode,
            0,
        );
        const bareOnly = {
            ...f.operation,
            repository: await realpath(bare),
            worktree: await realpath(bare),
            commonGitDir: await realpath(bare),
        };
        assert.equal(
            (
                await scanPolicy({
                    operation: bareOnly,
                    context: { ...f.context, invocation: { ...f.context.invocation, effectiveDirectory: bare } },
                })
            ).exitCode,
            20,
        );
    } finally {
        await f.dispose();
        await rm(external, { recursive: true, force: true });
    }
});

test('real promisor missing commit and corrupt/detached HEAD close without transport or credential execution', async () => {
    const f = await fixture();
    try {
        const head = await f.commit();
        f.git(['config', 'core.repositoryformatversion', '1']);
        f.git(['config', 'extensions.partialClone', 'origin']);
        f.git(['config', 'remote.origin.promisor', 'true']);
        f.git(['config', 'remote.origin.partialCloneFilter', 'blob:none']);
        f.git(['config', 'remote.origin.url', 'ext::never-run']);
        const script = path.join(f.root, 'transport.sh');
        const sentinel = path.join(f.root, 'EXECUTED');
        await writeFile(script, `#!/bin/sh\necho executed > '${sentinel.replaceAll('\\', '/')}'\n`);
        f.git(['config', 'credential.helper', script]);
        f.git(['config', 'core.sshCommand', script]);
        const object = path.join(f.operation.commonGitDir, 'objects', head.slice(0, 2), head.slice(2));
        await rm(object);
        const before = await readFile(path.join(f.operation.commonGitDir, 'config'));
        const scan = await scanPolicy({
            operation: { ...f.operation, targets: [{ role: 'head', objectId: head }] },
            context: f.context,
        });
        assert.equal(scan.exitCode, 20);
        assert.equal(existsSync(sentinel), false);
        assert.deepEqual(await readFile(path.join(f.operation.commonGitDir, 'config')), before);
        await writeFile(path.join(f.operation.commonGitDir, 'HEAD'), `${'f'.repeat(40)}\n`);
        assert.equal((await scanPolicy(f)).exitCode, 20);
        await writeFile(path.join(f.operation.commonGitDir, 'HEAD'), 'not-a-reference\n');
        assert.equal((await scanPolicy(f)).exitCode, 20);
    } finally {
        await f.dispose();
    }
});

test('corrupt HEAD resolving to a blob is not a valid commit operation', async () => {
    const f = await fixture();
    try {
        await f.commit();
        const blob = f.git(['rev-parse', 'HEAD:file.txt']);
        await writeFile(path.join(f.operation.commonGitDir, 'refs/heads/main'), `${blob}\n`);
        const before = await readFile(path.join(f.operation.commonGitDir, 'refs/heads/main'));
        assert.equal((await scanPolicy(f)).exitCode, 20);
        assert.deepEqual(await readFile(path.join(f.operation.commonGitDir, 'refs/heads/main')), before);
    } finally {
        await f.dispose();
    }
});
