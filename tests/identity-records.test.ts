import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const registry = {
    schemaVersion: 1,
    hosts: [
        { name: 'Codex App', aliases: ['Codex desktop'], family: 'Codex' },
        { name: 'Pi CLI', aliases: ['pi CLI'], family: 'Pi' },
        { name: 'oh-my-pi CLI', aliases: ['omp CLI'], family: 'oh-my-pi' },
    ],
    ambiguousAliases: ['Codex', 'Pi', 'codex'],
    familyAliases: { codex: 'Codex' },
};

test('confirmed set canonicalizes explicit aliases and sorts exact tuples without event accounting', async () => {
    const { summarize } = await import('../src/summarize.ts');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'identity-set-')));
    const operation = {
        schemaVersion: 1,
        id: 'op',
        repository: directory,
        worktree: directory,
        commonGitDir: directory,
        kind: 'commit',
        paths: ['b', 'a'],
        targets: [],
    };
    const ledger = {
        schemaVersion: 2,
        ledgerId: '00000000-0000-4000-8000-000000000001',
        operation,
        identities: [
            { agent: 'omp CLI', model: 'vendor.model-2' },
            { agent: 'Codex desktop', model: 'amazon.nova-micro-v1:0', reasoning: 'none' },
            { agent: 'Codex App', model: 'amazon.nova-micro-v1:0' },
            { agent: 'Codex App', model: 'amazon.nova-micro-v1:0', reasoning: 'high' },
            { agent: 'Codex desktop', model: 'amazon.nova-micro-v1:0' },
        ],
        blockers: [],
    };
    try {
        const result = await summarize(ledger, { ...operation, paths: ['a', 'b'] }, registry);
        assert.equal(result.schemaVersion, 2);
        assert.equal(result.ledgerId, ledger.ledgerId);
        assert.equal(result.exitCode, 0);
        assert.deepEqual(result.tuples, [
            { agent: 'Codex App', model: 'amazon.nova-micro-v1:0' },
            { agent: 'Codex App', model: 'amazon.nova-micro-v1:0', reasoning: 'high' },
            { agent: 'Codex App', model: 'amazon.nova-micro-v1:0', reasoning: 'none' },
            { agent: 'oh-my-pi CLI', model: 'vendor.model-2' },
        ]);
        assert.equal('events' in result, false);
        assert.equal('participants' in result, false);
        assert.equal('userExceptions' in result, false);
        assert.equal((await summarize({ ...ledger, identities: [] }, operation, registry)).exitCode, 0);
        const blocked = await summarize(
            { ...ledger, blockers: [{ id: 'missing:model', reason: 'Required model is unresolved.' }] },
            operation,
            registry,
        );
        assert.equal(blocked.exitCode, 20);
        assert.deepEqual(blocked.blockers, [{ id: 'missing:model', reason: 'Required model is unresolved.' }]);
        assert.equal(blocked.issues[0]?.id, 'missing:model');
        await assert.rejects(summarize(ledger, { ...operation, id: 'other' }, registry), /scope/);
        for (const agent of ['Codex', 'codex', 'Novel CLI'])
            await assert.rejects(
                summarize({ ...ledger, identities: [{ agent, model: 'formal.model' }] }, operation, registry),
                /Agent|host|registered|alias/i,
            );
        await assert.rejects(
            summarize(
                { schemaVersion: 1, operation, knownParticipants: [], events: [], userExceptions: [] },
                operation,
                registry,
            ),
            /migrat.*schemaVersion 2|schemaVersion 2.*migrat/i,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('supplied scope distinguishes real orphan linked worktrees and separate Git metadata without primary guesses', async () => {
    const { summarize } = await import('../src/summarize.ts');
    const { parseOperation, parseLedger, parseRegistry } = await import('../src/records.ts');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'identity-scope-')));
    try {
        const primary = path.join(directory, 'primary');
        const linked = path.join(directory, 'linked');
        const separate = path.join(directory, 'separate');
        const metadata = path.join(directory, 'metadata');
        execFileSync('git', ['init', '--quiet', primary], { windowsHide: true });
        execFileSync('git', ['-C', primary, 'worktree', 'add', '--orphan', '-b', 'linked', linked], {
            windowsHide: true,
            stdio: 'pipe',
        });
        execFileSync('git', ['init', '--quiet', '--separate-git-dir', metadata, separate], { windowsHide: true });
        const operation = {
            schemaVersion: 1,
            id: 'op',
            repository: linked,
            worktree: linked,
            commonGitDir: await realpath(path.join(primary, '.git')),
            kind: 'amend',
            paths: ['b', 'a', 'a'],
            targets: [
                { role: 'target', objectId: 'b'.repeat(40) },
                { role: 'parent', objectId: 'a'.repeat(40) },
            ],
        };
        const input = {
            schemaVersion: 2,
            ledgerId: '00000000-0000-4000-8000-000000000001',
            operation,
            identities: [],
            blockers: [],
        };
        const summary = await summarize(input, operation, registry);
        assert.deepEqual(summary.operation.paths, ['a', 'b']);
        assert.equal(summary.operation.repository, linked);
        assert.equal(summary.operation.commonGitDir, path.join(primary, '.git'));
        await assert.rejects(
            summarize(input, { ...operation, repository: primary, worktree: primary }, registry),
            /scope/,
        );
        const separateOperation = { ...operation, repository: separate, worktree: separate, commonGitDir: metadata };
        assert.equal((await parseOperation(separateOperation)).commonGitDir, metadata);
        await assert.rejects(
            summarize(
                { ...input, operation: separateOperation },
                { ...separateOperation, commonGitDir: operation.commonGitDir },
                registry,
            ),
            /scope/,
        );
        const alias = path.join(directory, 'alias');
        await symlink(linked, alias, process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(parseOperation({ ...operation, worktree: alias }), /physical/);
        for (const change of [
            { schemaVersion: 2 },
            { repository: '.' },
            { commonGitDir: path.join(directory, 'missing') },
            { kind: 'wrapper' },
            { paths: ['../escape'] },
            { paths: ['bad\\path'] },
            { paths: ['/absolute'] },
            { targets: [{ role: 'parent', objectId: 'HEAD' }] },
            { targets: [operation.targets[0], operation.targets[0]] },
        ])
            await assert.rejects(parseOperation({ ...operation, ...change }), /input/i);
        for (const change of [
            { identities: null },
            { identities: [{}] },
            {
                blockers: [
                    { id: 'x', reason: 'missing' },
                    { id: 'x', reason: 'missing' },
                ],
            },
            { ledgerId: 'not-a-UUID' },
            { ledgerId: '' },
            { blockers: [{ id: '', reason: 'Missing input.' }] },
            { blockers: [{ id: 'required', reason: ' ' }] },
            { blockers: [{ id: 'required', reason: 'bad\nline' }] },
            { task: 'implementation' },
            { events: [] },
            { schemaVersion: 0 },
            { unexpected: true },
        ])
            await assert.rejects(parseLedger({ ...input, ...change }), /input/i);
        for (const invalid of [
            null,
            { schemaVersion: 2 },
            { ...registry, hosts: [null] },
            { ...registry, familyAliases: { wrong: 'Codex' } },
            { ...registry, familyAliases: { codex: 'wrong' } },
            { ...registry, familyAliases: [] },
            { ...registry, hosts: [...registry.hosts, registry.hosts[0]] },
        ])
            assert.throws(() => parseRegistry(invalid), /input/i);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('independent commit ledgers retain overlapping confirmed identities without inferred allocation', async () => {
    const { summarize } = await import('../src/summarize.ts');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'identity-overlap-')));
    const operation = {
        schemaVersion: 1,
        id: 'op',
        repository: directory,
        worktree: directory,
        commonGitDir: directory,
        kind: 'commit',
        paths: [],
        targets: [],
    };
    const shared = { agent: 'Codex App', model: 'Shared.Model:0' };
    try {
        const ab = await summarize(
            {
                schemaVersion: 2,
                ledgerId: '00000000-0000-4000-8000-000000000001',
                operation,
                identities: [shared, { agent: 'Pi CLI', model: 'Model.B' }],
                blockers: [],
            },
            operation,
            registry,
        );
        const ac = await summarize(
            {
                schemaVersion: 2,
                ledgerId: '00000000-0000-4000-8000-000000000002',
                operation,
                identities: [shared, { agent: 'oh-my-pi CLI', model: 'Model.C' }],
                blockers: [],
            },
            operation,
            registry,
        );
        assert.deepEqual(ab.tuples, [shared, { agent: 'Pi CLI', model: 'Model.B' }]);
        assert.deepEqual(ac.tuples, [shared, { agent: 'oh-my-pi CLI', model: 'Model.C' }]);
        assert.notEqual(ab.ledgerId, ac.ledgerId);
        const opaque = await summarize(
            {
                schemaVersion: 2,
                ledgerId: ab.ledgerId,
                operation,
                identities: [],
                blockers: [
                    { id: ' gap', reason: 'First required gap.' },
                    { id: 'gap', reason: 'Second required gap.' },
                ],
            },
            operation,
            registry,
        );
        assert.deepEqual(
            opaque.issues.map((issue) => issue.id),
            [' gap', 'gap'],
        );
        assert.equal(opaque.exitCode, 20);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
