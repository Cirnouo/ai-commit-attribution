import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

test('summary resolves only compatible same-event effective observations and retains accounting', async () => {
    assert.ok(existsSync(new URL('../src/summarize.ts', import.meta.url)), 'PR4 must implement summary business logic');
    const { summarize } = await import('../src/summarize.ts');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'identity-records-')));
    const operation = {
        schemaVersion: 1,
        id: 'operation',
        repository: directory,
        worktree: directory,
        commonGitDir: directory,
        kind: 'commit',
        paths: ['b.ts', 'a.ts'],
        targets: [{ role: 'parent', objectId: 'a'.repeat(40) }],
    };
    const observation = (fields: string[], extra = {}) => ({
        fields,
        kind: 'handoff',
        observation: 'effective',
        reference: 'dispatch:local',
        ...extra,
    });
    const event = (id: string, participantId: string, extra = {}) => ({
        id,
        participantId,
        task: 'implementation',
        agent: 'Codex App',
        model: 'gpt-6.1-sol',
        reasoning: { state: 'unknown' },
        evidence: [observation(['agent', 'model'])],
        ...extra,
    });
    const ledger = (events: unknown[], knownParticipants = [{ id: 'actor', eventIds: ['first'] }]) => ({
        schemaVersion: 1,
        operation,
        events,
        knownParticipants,
        userExceptions: [],
    });
    try {
        const result = await summarize(
            ledger([
                event('first', 'actor', { agent: 'Codex desktop', model: undefined }),
                event('first', 'actor', {
                    agent: 'Codex App',
                    reasoning: { state: 'confirmed', value: 'high' },
                    evidence: [observation(['agent', 'model', 'reasoning'], { nativeReasoning: 'enabled' })],
                }),
                event('later', 'actor', { model: 'formal.snapshot-2026', reasoning: { state: 'unknown' } }),
                event('research', 'researcher', { agent: 'omp CLI', model: 'vendor-model.2' }),
            ]),
            { ...operation, paths: ['a.ts', 'b.ts'] },
            registry,
        );
        assert.equal(result.exitCode, 0);
        assert.deepEqual(
            result.tuples.map((tuple) => [tuple.agent, tuple.model, tuple.reasoning]),
            [
                ['Codex App', 'formal.snapshot-2026', undefined],
                ['Codex App', 'gpt-6.1-sol', 'high'],
                ['oh-my-pi CLI', 'vendor-model.2', undefined],
            ],
        );
        assert.deepEqual(
            result.participants.map((participant) => participant.id),
            ['actor', 'researcher'],
        );
        assert.equal(result.participants[1]?.declared, false);
        assert.deepEqual(result.operation.paths, ['a.ts', 'b.ts']);
        assert.ok(result.limitations.some((limit) => limit.includes('authenticate')));
        assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'unknown-reasoning'));

        const gaps = await summarize(
            ledger(
                [
                    event('first', 'actor', { agent: 'Codex' }),
                    event('conflict', 'second'),
                    event('conflict', 'second', { model: 'different-model' }),
                    event('extra', 'extra'),
                ],
                [
                    { id: 'actor', eventIds: ['first', 'missing'] },
                    { id: 'absent', eventIds: [] },
                ],
            ),
            operation,
            registry,
        );
        assert.equal(gaps.exitCode, 20);
        assert.ok(gaps.issues.some((issue) => issue.code === 'unresolved-agent'));
        assert.ok(gaps.issues.some((issue) => issue.code === 'conflicting-model'));
        assert.ok(gaps.issues.some((issue) => issue.code === 'missing-event'));
        assert.ok(gaps.issues.some((issue) => issue.code === 'missing-participant-event'));
        assert.equal(gaps.tuples.length, 1);
        assert.equal(gaps.tuples[0]?.eventIds[0], 'extra');

        for (const candidate of ['Codex', 'planner', 'Pi Desktop', 'codex app']) {
            assert.equal(
                (await summarize(ledger([event('first', 'actor', { agent: candidate })]), operation, registry))
                    .exitCode,
                20,
            );
        }
        const contextual = await summarize(
            ledger([
                event('first', 'actor', {
                    agent: 'Codex',
                    host: 'Codex App',
                    evidence: [observation(['agent', 'model', 'host'])],
                }),
            ]),
            operation,
            registry,
        );
        assert.equal(contextual.tuples[0]?.agent, 'Codex App');
        const familyAliasRegistry = { ...registry, ambiguousAliases: [...registry.ambiguousAliases, 'codex'] };
        const aliasContext = await summarize(
            ledger([
                event('first', 'actor', {
                    agent: 'codex',
                    host: 'Codex App',
                    evidence: [observation(['agent', 'model', 'host'])],
                }),
            ]),
            operation,
            familyAliasRegistry,
        );
        assert.equal(aliasContext.tuples[0]?.agent, 'Codex App');
        const hostEnrichment = await summarize(
            ledger([
                event('first', 'actor', { agent: 'Codex' }),
                event('first', 'actor', {
                    agent: undefined,
                    model: undefined,
                    host: 'Codex App',
                    evidence: [observation(['host'])],
                }),
            ]),
            operation,
            registry,
        );
        assert.equal(hostEnrichment.tuples[0]?.agent, 'Codex App');
        const incompatibleHost = await summarize(
            ledger([event('first', 'actor', { host: 'Pi CLI', evidence: [observation(['agent', 'model', 'host'])] })]),
            operation,
            registry,
        );
        assert.equal(incompatibleHost.exitCode, 20);
        const unknownHost = await summarize(
            ledger([
                event('first', 'actor', {
                    host: 'invented Desktop',
                    evidence: [observation(['agent', 'model', 'host'])],
                }),
            ]),
            operation,
            registry,
        );
        assert.equal(unknownHost.exitCode, 20);
        const unknownConflict = await summarize(
            ledger([event('first', 'actor'), event('first', 'actor', { agent: 'invented Desktop' })]),
            operation,
            registry,
        );
        assert.equal(unknownConflict.exitCode, 20);
        for (const model of ['auto', 'latest'])
            assert.equal(
                (await summarize(ledger([event('first', 'actor', { model })]), operation, registry)).exitCode,
                20,
            );
        const routed = event('first', 'actor', {
            modelRoute: 'gateway/selected',
            evidence: [
                observation(['agent', 'model'], { mapping: { route: 'gateway/selected', model: 'gpt-6.1-sol' } }),
            ],
        });
        assert.equal((await summarize(ledger([routed]), operation, registry)).exitCode, 0);
        assert.equal((await summarize(ledger([{ ...routed, modelRoute: 'other' }]), operation, registry)).exitCode, 20);

        const efforts = await summarize(
            ledger([
                event('first', 'actor'),
                event('disabled', 'actor', {
                    reasoning: { state: 'confirmed', value: 'none' },
                    evidence: [observation(['agent', 'model', 'reasoning'], { nativeReasoning: 'disabled' })],
                }),
                event('requested', 'actor', {
                    reasoning: { state: 'confirmed', value: 'off' },
                    evidence: [
                        observation(['agent', 'model']),
                        observation(['reasoning'], { observation: 'requested', nativeReasoning: 'disabled' }),
                    ],
                }),
                event('hidden', 'actor', {
                    reasoning: { state: 'confirmed', value: 'none' },
                    evidence: [observation(['agent', 'model']), observation(['reasoning'], { observation: 'display' })],
                }),
                event('clamped', 'actor', {
                    reasoning: { state: 'confirmed', value: 'low' },
                    evidence: [
                        observation(['agent', 'model', 'reasoning'], {
                            nativeReasoning: 'enabled',
                            detail: 'off request clamped to low',
                        }),
                    ],
                }),
                event('optional-conflict', 'actor', {
                    reasoning: { state: 'confirmed', value: 'high' },
                    evidence: [observation(['agent', 'model', 'reasoning'], { nativeReasoning: 'enabled' })],
                }),
                event('optional-conflict', 'actor', {
                    reasoning: { state: 'confirmed', value: 'ultra' },
                    evidence: [observation(['agent', 'model', 'reasoning'], { nativeReasoning: 'enabled' })],
                }),
            ]),
            operation,
            registry,
        );
        assert.equal(efforts.exitCode, 0);
        assert.deepEqual(
            efforts.tuples.map((tuple) => tuple.reasoning),
            [undefined, 'low', 'none'],
        );
        assert.ok(efforts.diagnostics.some((diagnostic) => diagnostic.code === 'conflicting-reasoning'));
        assert.deepEqual(efforts.tuples[0]?.eventIds, ['first', 'hidden', 'optional-conflict', 'requested']);
        for (const value of ['off', '0', 'disabled']) {
            const disabled = await summarize(
                ledger([
                    event('first', 'actor', {
                        reasoning: { state: 'confirmed', value },
                        evidence: [observation(['agent', 'model', 'reasoning'], { nativeReasoning: 'disabled' })],
                    }),
                ]),
                operation,
                registry,
            );
            assert.equal(disabled.tuples[0]?.reasoning, 'none');
        }
        const nativeConflict = await summarize(
            ledger([
                event('first', 'actor', {
                    reasoning: { state: 'confirmed', value: 'high' },
                    evidence: [
                        observation(['agent', 'model', 'reasoning'], { nativeReasoning: 'disabled' }),
                        observation(['reasoning'], { nativeReasoning: 'enabled' }),
                    ],
                }),
            ]),
            operation,
            registry,
        );
        assert.equal(nativeConflict.tuples[0]?.reasoning, undefined);
        assert.ok(nativeConflict.diagnostics.some((diagnostic) => diagnostic.code === 'conflicting-reasoning'));

        const ordered = [
            event('first', 'actor'),
            event('pi', 'other', { agent: 'pi CLI' }),
            event('omp', 'other', { agent: 'omp CLI' }),
        ];
        const forward = await summarize(ledger(ordered), operation, registry);
        const backward = await summarize(ledger([...ordered].reverse()), operation, registry);
        assert.deepEqual(forward.tuples, backward.tuples);
        const crossEvent = await summarize(
            ledger([event('first', 'actor', { model: undefined }), event('second', 'actor')]),
            operation,
            registry,
        );
        assert.equal(crossEvent.exitCode, 20);
        assert.deepEqual(crossEvent.tuples[0]?.eventIds, ['second']);
        const withException = await summarize(
            {
                ...ledger([event('first', 'actor', { model: undefined })]),
                userExceptions: [
                    {
                        operationId: 'operation',
                        issueIds: ['event:first:model'],
                        decision: 'user explicitly accepts missing model for this operation',
                        reference: 'user:message-7',
                    },
                ],
            },
            operation,
            registry,
        );
        assert.equal(withException.exitCode, 20);
        assert.equal(withException.userExceptions.length, 1);
        assert.equal(withException.tuples.length, 0);

        for (const changes of [
            { id: 'other' },
            { commonGitDir: undefined },
            { kind: 'amend' },
            { paths: ['other.ts'] },
            { targets: [] },
        ])
            await assert.rejects(
                summarize(ledger([event('first', 'actor')]), { ...operation, ...changes }, registry),
                /input|scope/i,
            );
        for (const changes of [{ task: 'different' }, { participantId: 'other' }])
            await assert.rejects(
                summarize(ledger([event('first', 'actor'), event('first', 'actor', changes)]), operation, registry),
                /association/i,
            );
        for (const raw of ['\n', '\r', '\0', '\u0085', '\u2028', '\u2029', '\u001b'])
            await assert.rejects(
                summarize(ledger([event('first', 'actor', { agent: ` ${raw}Codex App ` })]), operation, registry),
                /control/i,
            );
        for (const changes of [
            { trusted: true },
            { reasoning: { state: 'confirmed', value: '' } },
            { model: 'bad (value)' },
            { evidence: [{ fields: ['model'], kind: 'handoff', observation: 'effective', reference: '' }] },
        ])
            await assert.rejects(summarize(ledger([event('first', 'actor', changes)]), operation, registry), /input/i);
        await assert.rejects(
            summarize(ledger([event('first', 'actor')], [{ id: 'other', eventIds: ['first'] }]), operation, registry),
            /participant/i,
        );
        await assert.rejects(
            summarize(
                {
                    ...ledger([]),
                    userExceptions: [{ operationId: 'stale', issueIds: ['x'], decision: 'accept', reference: 'user' }],
                },
                operation,
                registry,
            ),
            /scope/i,
        );
    } finally {
        await rm(directory, { recursive: true });
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
        const input = { schemaVersion: 1, operation, knownParticipants: [], events: [], userExceptions: [] };
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
            { events: null },
            { events: [{}] },
            {
                knownParticipants: [
                    { id: 'x', eventIds: [] },
                    { id: 'x', eventIds: [] },
                ],
            },
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
