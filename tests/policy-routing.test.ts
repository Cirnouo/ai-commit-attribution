import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkFreshRouting, scanPolicy } from '../src/policy.ts';
import { resolveTrustedGit } from '../src/safe-git.ts';

const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
async function fixture() {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-routing-')));
    const executable = await resolveTrustedGit([directory]);
    const git = (args: string[]) =>
        execFileSync(executable, args, { cwd: directory, env: clean, encoding: 'utf8', windowsHide: true }).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    const operation = {
        schemaVersion: 1,
        id: 'op',
        repository: directory,
        worktree: directory,
        commonGitDir: await realpath(path.join(directory, '.git')),
        kind: 'commit',
        paths: ['new.txt'],
        targets: [],
    };
    const context = {
        schemaVersion: 1,
        phase: 'prepare',
        selection: 'planned-paths',
        invocation: { kind: 'agent-context', reference: 'task:actual', effectiveDirectory: directory },
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
    const snapshot = async () => ({
        head: await readFile(path.join(directory, '.git/HEAD')),
        config: await readFile(path.join(directory, '.git/config')),
        status: git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1']),
        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
    });
    return {
        directory,
        git,
        operation,
        context,
        commit,
        snapshot,
        dispose: () => rm(directory, { recursive: true, force: true }),
    };
}
function decision(scan: Awaited<ReturnType<typeof scanPolicy>>, branch = 'skill-default') {
    return {
        schemaVersion: 1,
        artifact: 'policy-decision',
        operation: scan.operation,
        binding: scan.binding,
        branch,
        assessments: scan.candidates.map((candidate) => ({
            candidateId: candidate.id,
            classification: branch === 'repository-policy' ? 'ai-disclosure-policy' : 'ordinary-format-only',
            rationale: 'Agent read applicable fixture evidence.',
        })),
        selectedCandidateIds: branch === 'repository-policy' ? scan.candidates.map((item) => item.id) : [],
        issueIds: scan.issues.map((item) => item.id),
        rationale: 'Explicit semantic fixture assessment.',
        decisionSource: { kind: 'agent-semantic', reference: 'dispatch:fixture' },
    };
}

test('unborn planned scope, missing policy inventory, canonical paths and newly created evidence freshness', async () => {
    const f = await fixture();
    try {
        const before = await f.snapshot();
        const scan = await scanPolicy({ operation: f.operation, context: f.context });
        assert.equal(scan.scanStatus, 'complete', JSON.stringify(scan.issues));
        assert.equal(scan.exitCode, 0);
        assert.ok(scan.checkedLocations.some((item) => item.locator.endsWith('AGENTS.md') && item.status === 'absent'));
        const selected = decision(scan);
        const route = await checkFreshRouting({ operation: f.operation, context: f.context, decision: selected });
        assert.equal(route.branch, 'skill-default');
        assert.deepEqual(route.binding, route.freshScan.binding);
        assert.deepEqual(route.freshScan.candidates, scan.candidates);
        assert.deepEqual(await f.snapshot(), before);
        await writeFile(path.join(f.directory, 'AGENTS.md'), 'Do not disclose AI use.\n');
        const stale = await checkFreshRouting({ operation: f.operation, context: f.context, decision: selected });
        assert.equal(stale.freshness, 'stale');
        assert.equal(stale.exitCode, 20);
        assert.equal(stale.branch, 'needs-decision');
        const fresh = await scanPolicy({ operation: f.operation, context: f.context });
        assert.equal(
            (
                await checkFreshRouting({
                    operation: f.operation,
                    context: f.context,
                    decision: decision(fresh, 'repository-policy'),
                })
            ).exitCode,
            10,
        );
        await writeFile(path.join(f.directory, 'new.txt'), 'selected bytes\n');
        assert.equal(
            (await checkFreshRouting({ operation: f.operation, context: f.context, decision: decision(fresh) }))
                .freshness,
            'stale',
        );
    } finally {
        await f.dispose();
    }
});

test('real index, targets and same-size selected bytes bind state without mutations', async () => {
    const f = await fixture();
    try {
        await writeFile(path.join(f.directory, 'new.txt'), 'first\n');
        f.git(['add', 'new.txt']);
        f.commit();
        const operation = { ...f.operation, targets: [{ role: 'head', objectId: f.git(['rev-parse', 'HEAD']) }] };
        const context = { ...f.context, selection: 'index' };
        const before = await f.snapshot();
        const scan = await scanPolicy({ operation, context });
        assert.equal(scan.scanStatus, 'complete', JSON.stringify(scan.issues));
        await writeFile(path.join(f.directory, 'new.txt'), 'other\n');
        assert.equal((await checkFreshRouting({ operation, context, decision: decision(scan) })).freshness, 'stale');
        await writeFile(path.join(f.directory, 'new.txt'), 'first\n');
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('Windows inert cwd executable negative control and trusted production observation', async (t) => {
    if (process.platform !== 'win32') {
        t.skip('Actual Windows lookup boundary');
        return;
    }
    const f = await fixture();
    try {
        await writeFile(
            path.join(f.directory, 'git.exe'),
            'INVALID-TEXT git.exe lookup sentinel; this is not a PE binary or script.\r\n',
        );
        const negative = spawnSync('git', ['--version'], { cwd: f.directory, env: process.env, windowsHide: true });
        assert.ok(negative.error || negative.status !== 0);
        const scan = await scanPolicy({ operation: f.operation, context: f.context });
        assert.equal(scan.scanStatus, 'complete', JSON.stringify(scan.issues));
        assert.equal(
            (await checkFreshRouting({ operation: f.operation, context: f.context, decision: decision(scan) }))
                .exitCode,
            0,
        );
    } finally {
        await f.dispose();
    }
});

test('unsupported raw fields, mismatched operations and unknown assessment IDs are input errors', async () => {
    const f = await fixture();
    try {
        await assert.rejects(scanPolicy({ operation: { ...f.operation, extra: true }, context: f.context }));
        await assert.rejects(scanPolicy({ operation: f.operation, context: { ...f.context, phase: 'prepare\n' } }));
        const scan = await scanPolicy({ operation: f.operation, context: f.context });
        await assert.rejects(
            checkFreshRouting({
                operation: { ...f.operation, id: 'other' },
                context: f.context,
                decision: decision(scan),
            }),
        );
        await assert.rejects(
            checkFreshRouting({
                operation: f.operation,
                context: f.context,
                decision: {
                    ...decision(scan),
                    assessments: [{ candidateId: 'absent', classification: 'unrelated', rationale: 'bad' }],
                },
            }),
        );
    } finally {
        await f.dispose();
    }
});
