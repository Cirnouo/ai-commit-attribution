import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, cp, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkFreshRouting, scanPolicy } from '../src/policy.ts';
import { LIMITS, parseBinding, parseContext } from '../src/policy-contract.ts';
import { EvidenceSearch } from '../src/policy-evidence.ts';
import { byteDigest, canonical, fileState } from '../src/policy-scope.ts';
import { gitEnvironment, resolveTrustedGit, SafeGit } from '../src/safe-git.ts';
import { readRegularFile } from '../tooling/file-evidence.ts';

async function fixture() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-safe-')));
    const executable = await resolveTrustedGit([root]);
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    const git = (args: string[], cwd = root) =>
        execFileSync(executable, ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
            cwd,
            encoding: 'utf8',
            windowsHide: true,
            env: environment,
        }).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    git(['config', 'core.autocrlf', 'false']);
    const operation = {
        schemaVersion: 1,
        id: 'same-id',
        repository: root,
        worktree: root,
        commonGitDir: await realpath(path.join(root, '.git')),
        kind: 'commit',
        paths: ['new.txt'],
        targets: [] as { role: string; objectId: string }[],
    };
    const context = {
        schemaVersion: 1,
        phase: 'prepare',
        selection: 'planned-paths',
        invocation: { kind: 'direct-git', reference: 'git -C fixture', effectiveDirectory: root },
    };
    const commit = () =>
        git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'fixture',
        ]);
    const state = async () => ({
        head: await readFile(path.join(operation.commonGitDir, 'HEAD')),
        config: await readFile(path.join(operation.commonGitDir, 'config')),
        index: await readFile(path.join(operation.commonGitDir, 'index')).catch(() => null),
        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
        identity: git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'var',
            'GIT_AUTHOR_IDENT',
        ]).replace(/\d+ [+-]\d+$/, ''),
        status: git(['status', '--porcelain=v1']),
    });
    return {
        root,
        executable,
        git,
        operation,
        context,
        commit,
        state,
        dispose: () => rm(root, { recursive: true, force: true }),
    };
}
function decision(scan: Awaited<ReturnType<typeof scanPolicy>>, branch = 'skill-default') {
    const selected = scan.candidates.filter((item) => item.sourceKind === 'applicable-instruction');
    return {
        schemaVersion: 1,
        artifact: 'policy-decision',
        operation: scan.operation,
        binding: scan.binding,
        branch,
        assessments: scan.candidates.map((candidate) => ({
            candidateId: candidate.id,
            classification:
                branch === 'repository-policy' && selected.includes(candidate) ? 'ai-disclosure-policy' : 'unrelated',
            rationale: 'Explicit fixture semantic applicability.',
        })),
        selectedCandidateIds: branch === 'repository-policy' ? selected.map((item) => item.id) : [],
        issueIds: scan.issues.map((item) => item.id),
        rationale: 'Agent assessment of every candidate.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture:semantic' },
    };
}

test('exclusive semantic branches do not mechanically infer policy from wording', async () => {
    const f = await fixture();
    try {
        for (const rule of [
            'Use AI-Origin in the body.',
            'AI Co-authored-by is permitted.',
            'AI Co-authored-by is required.',
            'AI disclosure is unnecessary.',
            'Never disclose AI use.',
            'Assisted-by is forbidden.',
        ]) {
            await writeFile(path.join(f.root, 'AGENTS.md'), `${rule}\n`);
            const scan = await scanPolicy(f);
            const result = await checkFreshRouting({ ...f, decision: decision(scan, 'repository-policy') });
            assert.equal(result.exitCode, 10, JSON.stringify(result));
            assert.equal(result.defaultValidation, 'not-run');
            assert.equal(result.repositoryPolicyValidation, 'not-run');
        }
        await writeFile(path.join(f.root, 'AGENTS.md'), 'Use Conventional Commits, English and a short subject.\n');
        const scan = await scanPolicy(f);
        const ordinary = await checkFreshRouting({ ...f, decision: decision(scan) });
        assert.equal(ordinary.defaultValidation, 'eligible');
        const uncertain = decision(scan);
        const first = uncertain.assessments[0];
        assert.ok(first);
        first.classification = 'uncertain';
        assert.equal((await checkFreshRouting({ ...f, decision: uncertain })).exitCode, 20);
        assert.equal((await checkFreshRouting({ ...f, decision: decision(scan, 'needs-decision') })).exitCode, 20);
    } finally {
        await f.dispose();
    }
});

test('local intended/deleted/directory paths, adopted links and exact whitespace scope', async () => {
    const f = await fixture();
    try {
        await mkdir(path.join(f.root, 'area/nested'), { recursive: true });
        await mkdir(path.join(f.root, 'other'));
        await writeFile(path.join(f.root, 'AGENTS.md'), 'Before commit read [policy](area/policy.md).\n');
        await writeFile(path.join(f.root, 'area/policy.md'), 'No AI disclosure.\n');
        await writeFile(path.join(f.root, 'area/CLAUDE.md'), 'Scoped instructions.\n');
        await writeFile(path.join(f.root, 'area/nested/new.txt'), 'new\n');
        await writeFile(path.join(f.root, 'other/AGENTS.md'), 'Unrelated sibling.\n');
        await writeFile(path.join(f.root, ' report.md'), 'space\n');
        const operation = { ...f.operation, paths: ['area', 'area/deleted.txt', ' report.md'] };
        const scan = await scanPolicy({ operation, context: f.context });
        assert.equal(scan.scanStatus, 'complete', JSON.stringify(scan.issues));
        assert.ok(scan.candidates.some((item) => item.locator.endsWith(path.join('area', 'policy.md'))));
        assert.ok(scan.candidates.some((item) => item.locator.endsWith(path.join('area', 'CLAUDE.md'))));
        assert.ok(!scan.candidates.some((item) => item.locator.includes('other')));
        const reordered = await scanPolicy({
            operation: { ...operation, paths: [...operation.paths].reverse() },
            context: f.context,
        });
        assert.deepEqual(scan.binding, reordered.binding);
        assert.equal(
            (
                await checkFreshRouting({
                    operation,
                    context: {
                        ...f.context,
                        invocation: { ...f.context.invocation, reference: 'actual changed invocation' },
                    },
                    decision: decision(scan),
                })
            ).freshness,
            'stale',
        );
    } finally {
        await f.dispose();
    }
});

test('bounded evidence handles absence, unsafe types, invalid encoding/controls, cycles and real byte limits', async () => {
    const f = await fixture();
    try {
        for (const [name, bytes] of [
            ['bad-utf.md', Buffer.from([0xc0, 0xaf])],
            ['control.md', Buffer.from('secret\u0000')],
            ['oversized.md', Buffer.alloc(LIMITS.fileBytes + 1, 65)],
        ] as const)
            await writeFile(path.join(f.root, name), bytes);
        await writeFile(path.join(f.root, 'cycle.md'), '[self](cycle.md)\n');
        await mkdir(path.join(f.root, 'directory.md'));
        for (const name of ['bad-utf.md', 'control.md', 'oversized.md', 'cycle.md', 'directory.md', 'absent.md']) {
            const scan = await scanPolicy({
                ...f,
                context: { ...f.context, additionalCandidatePaths: [path.join(f.root, name)] },
            });
            assert.equal(scan.exitCode, 20, name);
            assert.ok(scan.issues.length);
        }
        const source = path.join(f.root, 'safe.md');
        await writeFile(source, 'Safe evidence.\n');
        await link(source, path.join(f.root, 'hard.md'));
        const hard = await scanPolicy({
            ...f,
            context: { ...f.context, additionalCandidatePaths: [path.join(f.root, 'hard.md')] },
        });
        assert.equal(hard.exitCode, 0, JSON.stringify(hard.issues));
        const symlinkPath = path.join(f.root, 'linked');
        await symlink(f.root, symlinkPath, process.platform === 'win32' ? 'junction' : 'dir');
        const linked = await scanPolicy({
            ...f,
            context: { ...f.context, additionalCandidatePaths: [path.join(symlinkPath, 'safe.md')] },
        });
        assert.equal(linked.exitCode, 20);
        await assert.rejects(readRegularFile(source, { maximumBytes: 1 }));
        assert.equal((await readRegularFile(source, { maximumBytes: 15 })).toString(), 'Safe evidence.\n');
        await assert.rejects(fileState(symlinkPath));
        const enumeration = new EvidenceSearch();
        enumeration.entries = 4096;
        assert.throws(() => enumeration.count());
        const fileCap = new EvidenceSearch();
        fileCap.files = LIMITS.files;
        await fileCap.read(source, 'test', 'cap');
        assert.equal(fileCap.issues.length, 1);
        const candidateCap = new EvidenceSearch();
        candidateCap.candidates.length = LIMITS.candidates;
        await candidateCap.read(source, 'test', 'cap');
        assert.equal(candidateCap.issues.length, 1);
        const totalCap = new EvidenceSearch();
        totalCap.bytes = LIMITS.bytes;
        await totalCap.read(source, 'test', 'cap');
        assert.equal(totalCap.issues.length, 1);
        const hops = new EvidenceSearch();
        await hops.read(path.join(f.root, 'cycle.md'), 'test', 'cap', true, LIMITS.referenceHops);
        assert.ok(hops.issues.length);
        const depth = new EvidenceSearch();
        await depth.docs(f.root, LIMITS.directoryLevels + 1);
        assert.ok(depth.issues.length);
    } finally {
        await f.dispose();
    }
});

test('real local/included/environment execution traps remain inert and secret config text is omitted', async () => {
    const f = await fixture();
    const inherited = { ...process.env };
    try {
        await writeFile(path.join(f.root, 'new.txt'), 'base\n');
        f.git(['add', 'new.txt']);
        f.commit();
        const sentinel = path.join(f.root, 'EXECUTED');
        const script = path.join(f.root, 'trap.sh');
        await writeFile(script, `#!/bin/sh\nprintf executed > '${sentinel.replaceAll('\\', '/')}'\n`);
        await chmod(script, 0o755);
        for (const key of [
            'core.fsmonitor',
            'diff.external',
            'diff.trap.textconv',
            'filter.trap.clean',
            'filter.trap.smudge',
            'trailer.assisted.command',
            'credential.helper',
            'core.sshCommand',
        ])
            f.git(['config', key, script.replaceAll('\\', '/')]);
        f.git(['config', 'private.secret', 'SECRET-DO-NOT-EMIT']);
        f.git(['config', 'core.hooksPath', '.hooks']);
        await mkdir(path.join(f.root, '.hooks'));
        for (const hook of ['commit-msg', 'prepare-commit-msg']) await cp(script, path.join(f.root, '.hooks', hook));
        await writeFile(path.join(f.root, 'template.txt'), 'Template disclosure policy\n');
        f.git(['config', 'commit.template', 'template.txt']);
        Object.assign(process.env, {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'core.fsmonitor',
            GIT_CONFIG_VALUE_0: script,
            GIT_EXTERNAL_DIFF: script,
            GIT_SSH_COMMAND: script,
            GIT_INDEX_FILE: path.join(f.root, 'unrelated-index'),
            GIT_OBJECT_DIRECTORY: path.join(f.root, 'objects'),
            GIT_TRACE: path.join(f.root, 'trace'),
        });
        const before = await f.state();
        const operation = { ...f.operation, targets: [{ role: 'head', objectId: f.git(['rev-parse', 'HEAD']) }] };
        const scan = await scanPolicy({ operation, context: f.context });
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.doesNotMatch(JSON.stringify(scan), /SECRET-DO-NOT-EMIT/);
        assert.ok(scan.candidates.some((item) => item.sourceKind === 'commit-template'));
        assert.equal(
            (await checkFreshRouting({ operation, context: f.context, decision: decision(scan) })).exitCode,
            0,
        );
        assert.equal(existsSync(sentinel), false);
        assert.equal(existsSync(path.join(f.root, 'trace')), false);
        assert.deepEqual(await f.state(), before);
        const include = path.join(f.root, 'include.config');
        await writeFile(
            include,
            `[core]\n fsmonitor = ${JSON.stringify(script.replaceAll('\\', '/'))}\n[private]\n secret = SECRET-INCLUDE\n`,
        );
        f.git(['config', 'include.path', include]);
        const included = await scanPolicy({ operation, context: f.context });
        assert.equal(included.exitCode, 20, 'Include precedence deliberately closes for a decision.');
        assert.doesNotMatch(JSON.stringify(included), /SECRET-INCLUDE/);
        assert.equal(existsSync(sentinel), false);
        await writeFile(include, `[include]\n path = ${JSON.stringify(include.replaceAll('\\', '/'))}\n`);
        assert.equal((await scanPolicy({ operation, context: f.context })).exitCode, 20);
    } finally {
        for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
        Object.assign(process.env, inherited);
        await f.dispose();
    }
});

test('safe runner rejects unsupported commands/options and unavailable trusted installation without fallback', async () => {
    const f = await fixture();
    try {
        await assert.rejects(resolveTrustedGit([path.parse(f.executable).root]));
        const sanitized = gitEnvironment({
            GIT_CONFIG_PARAMETERS: 'secret',
            GIT_NAMESPACE: 'wrong',
            GIT_TRACE: 'wrong',
            HOME: 'wrong',
            NODE_OPTIONS: '--require wrong',
            PATH: process.env.Path,
        });
        assert.equal(sanitized.GIT_CONFIG_PARAMETERS, undefined);
        assert.equal(sanitized.HOME, undefined);
        assert.throws(() => new SafeGit('git', f.root));
        const runner = new SafeGit(f.executable, f.root);
        await runner.guard();
        await assert.rejects(runner.run('fetch', []));
        await assert.rejects(runner.run('config', ['--list']));
        await assert.rejects(runner.run('diff', ['--output=forbidden']));
        const unsupported = new SafeGit(process.execPath, f.root);
        await assert.rejects(unsupported.guard());
        const timeout = new SafeGit(f.executable, f.root);
        Object.defineProperty(timeout, 'started', { value: performance.now() - 31_000 });
        await assert.rejects(timeout.guard());
    } finally {
        await f.dispose();
    }
});

test('strict context/binding/decision fields and same-size/mtime evidence replacement remain bound', async () => {
    const f = await fixture();
    try {
        for (const context of [
            {},
            { ...f.context, schemaVersion: 2 },
            { ...f.context, selection: 'guess' },
            { ...f.context, invocation: { ...f.context.invocation, kind: 'unknown' } },
            { ...f.context, invocation: { ...f.context.invocation, effectiveDirectory: 'relative' } },
            { ...f.context, additionalCandidatePaths: ['bad', 'bad'] },
        ])
            assert.throws(() => parseContext(context));
        const malformed: unknown[] = [
            null,
            { canonicalizationVersion: 2 },
            { canonicalizationVersion: 1, gitDirectory: f.root, commonGitDir: f.root },
        ];
        for (const binding of malformed) assert.throws(() => parseBinding(binding));
        await writeFile(path.join(f.root, 'AGENTS.md'), 'old policy\n');
        const scan = await scanPolicy(f);
        const valid = decision(scan);
        for (const changes of [
            { schemaVersion: 2 },
            { artifact: 'unknown' },
            { branch: 'unknown' },
            { assessments: null },
            { assessments: [{ candidateId: 'x', classification: 'guess', rationale: 'r' }] },
            { decisionSource: { kind: 'user', reference: 'r' } },
            { issueIds: ['absent'] },
            { assessments: [valid.assessments[0], valid.assessments[0]] },
            { branch: 'repository-policy', selectedCandidateIds: [] },
            { selectedCandidateIds: ['absent'] },
            { rationale: 'control\n' },
        ])
            await assert.rejects(checkFreshRouting({ ...f, decision: { ...valid, ...changes } }));
        const time = new Date(1700000000000);
        await utimes(path.join(f.root, 'AGENTS.md'), time, time);
        const timed = await scanPolicy(f);
        await writeFile(path.join(f.root, 'AGENTS.md'), 'new policy\n');
        await utimes(path.join(f.root, 'AGENTS.md'), time, time);
        assert.equal((await checkFreshRouting({ ...f, decision: decision(timed) })).freshness, 'stale');
        assert.deepEqual(canonical({ b: 1, a: ['x'] }), { a: ['x'], b: 1 });
        assert.equal(byteDigest(Buffer.from('x')).length, 64);
    } finally {
        await f.dispose();
    }
});

test('bounded docs/workflows/navigation and worktree configuration are observed as data', async () => {
    const f = await fixture();
    try {
        await mkdir(path.join(f.root, 'docs/policies'), { recursive: true });
        await mkdir(path.join(f.root, 'docs/vendor'), { recursive: true });
        await mkdir(path.join(f.root, '.github/workflows'), { recursive: true });
        await writeFile(path.join(f.root, 'docs/policies/commit.md'), 'Ordinary commit format.\n');
        await writeFile(path.join(f.root, 'docs/vendor/commit.md'), 'Unadopted dependency.\n');
        await writeFile(path.join(f.root, '.github/workflows/ci.yaml'), 'name: fixture\n');
        await writeFile(
            path.join(f.root, 'README.md'),
            '[policy](docs/policies/commit.md)\n[external](https://example.invalid/policy)\n',
        );
        f.git(['config', 'extensions.worktreeConfig', 'true']);
        f.git(['config', '--worktree', 'private.secret', 'WORKTREE-SECRET']);
        f.git(['config', '--worktree', 'commit.template', ' template.txt']);
        await writeFile(path.join(f.root, ' template.txt'), 'Policy template with exact leading space.\n');
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.ok(scan.candidates.some((item) => item.locator.endsWith('ci.yaml')));
        assert.ok(scan.candidates.some((item) => item.locator.endsWith(' template.txt')));
        assert.ok(!scan.candidates.some((item) => item.locator.includes(`${path.sep}vendor${path.sep}`)));
        assert.doesNotMatch(JSON.stringify(scan), /WORKTREE-SECRET/);
        assert.ok(scan.limitations.some((item) => item.includes('example.invalid')));
        const source = path.join(f.root, 'refs.md');
        for (const value of [
            '[missing](missing-policy.md)',
            '[scheme](ftp://example.invalid/rule)',
            '[invalid](bad%00.md)',
            '[bad](bad%zz.md)',
        ]) {
            await writeFile(source, `${value}\n`);
            const search = new EvidenceSearch();
            await search.read(source, 'test', 'adopted');
            assert.ok(search.issues.length, value);
        }
        const candidates = new EvidenceSearch();
        await candidates.docs(path.join(f.root, 'docs'));
        assert.ok(candidates.candidates.length);
    } finally {
        await f.dispose();
    }
});
