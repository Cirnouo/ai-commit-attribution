import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Event, Ledger, Operation } from '../src/records.ts';
import { summarize } from '../src/summarize.ts';

const registry = {
    schemaVersion: 1,
    hosts: [{ name: 'Codex App', aliases: [], family: 'Codex' }],
    ambiguousAliases: [],
};
const mapping = (model: string, observation = 'effective', route = 'gateway/selected') => ({
    fields: ['model'],
    kind: 'handoff',
    observation,
    reference: `handoff:${model}`,
    mapping: { route, model },
});
const event = (extra: Partial<Event> = {}): Event => ({
    id: 'first',
    participantId: 'actor',
    task: 'implementation',
    agent: 'Codex App',
    model: 'gpt-6.1-sol',
    reasoning: { state: 'unknown' },
    evidence: [
        { fields: ['agent', 'model'], kind: 'handoff', observation: 'effective', reference: 'handoff:identity' },
    ],
    ...extra,
});
async function fixture(run: (operation: Operation, input: (events: Event[]) => Ledger) => Promise<void>) {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'identity-review-')));
    const operation: Operation = {
        schemaVersion: 1,
        id: 'operation',
        repository: directory,
        worktree: directory,
        commonGitDir: directory,
        kind: 'commit',
        paths: [],
        targets: [],
    };
    try {
        await run(operation, (events) => ({
            schemaVersion: 1,
            operation,
            events,
            knownParticipants: [{ id: 'actor', eventIds: ['first'] }],
            userExceptions: [],
        }));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('formal colon-bearing model identifiers and exact same-event route mappings are preserved', async () => {
    await fixture(async (operation, input) => {
        const model = 'amazon.nova-micro-v1:0';
        const observed = event({
            model,
            modelRoute: 'gateway/nova',
            evidence: [
                {
                    fields: ['agent', 'model'],
                    kind: 'synthetic fixture',
                    observation: 'effective',
                    reference: 'fixture:dispatch',
                },
                mapping(model, 'effective', 'gateway/nova'),
            ],
        });
        const summary = await summarize(input([observed]), operation, registry);
        assert.equal(summary.exitCode, 0);
        assert.equal(summary.tuples[0]?.model, model);
        assert.equal(summary.events[0]?.records[0]?.evidence[1]?.mapping?.model, model);
    });
});

test('review F1 preserves whitespace filenames and rejects a different supplied selected path', async () => {
    await fixture(async (operation, input) => {
        const selected = { ...operation, paths: [' report.md', 'report.md ', ' report.md'] };
        const ledger = { ...input([event()]), operation: selected };
        const result = await summarize(ledger, selected, registry);
        assert.deepEqual(result.operation.paths, [' report.md', 'report.md ']);
        assert.equal(result.exitCode, 0);
        await assert.rejects(summarize(ledger, { ...operation, paths: ['report.md'] }, registry), /scope/);
        const space = { ...operation, paths: [' '] };
        assert.deepEqual((await summarize({ ...ledger, operation: space }, space, registry)).operation.paths, [' ']);
        await assert.rejects(summarize(ledger, { ...operation, paths: [''] }, registry), /input/);
    });
});

test('review F1 whitespace-distinct opaque event IDs cannot borrow another event model', async () => {
    await fixture(async (operation, input) => {
        const missing = event({ id: ' first' });
        delete missing.model;
        const ledger = {
            ...input([missing, event()]),
            knownParticipants: [{ id: 'actor', eventIds: [' first', 'first'] }],
        };
        const result = await summarize(ledger, operation, registry);
        assert.equal(result.exitCode, 20);
        assert.deepEqual(
            result.events.map((item) => item.id),
            [' first', 'first'],
        );
        assert.deepEqual(result.tuples[0]?.eventIds, ['first']);
        const actors = {
            ...input([event({ id: 'spaced', participantId: ' actor' }), event()]),
            knownParticipants: [
                { id: ' actor', eventIds: ['spaced'] },
                { id: 'actor', eventIds: ['first'] },
            ],
        };
        assert.deepEqual(
            (await summarize(actors, operation, registry)).participants.map((item) => item.id),
            [' actor', 'actor'],
        );
        await assert.rejects(summarize(input([event()]), { ...operation, id: ' operation' }, registry), /scope/);
        await assert.rejects(summarize(input([event()]), { ...operation, id: ' ' }, registry), /input/);
        await assert.rejects(
            summarize(
                {
                    ...input([event()]),
                    userExceptions: [
                        { operationId: ' operation', issueIds: ['x'], decision: 'accept', reference: 'user:1' },
                    ],
                },
                operation,
                registry,
            ),
            /scope/,
        );
    });
});

for (const scenario of ['within-record', 'repeated-candidate', 'incompatible-route'] as const) {
    test(`review F2 retains effective model/mapping conflicts ${scenario}`, async () => {
        await fixture(async (operation, input) => {
            const supported = event({
                modelRoute: 'gateway/selected',
                evidence: [...event().evidence, mapping('gpt-6.1-sol')],
            });
            const records =
                scenario === 'within-record'
                    ? [{ ...supported, evidence: [...supported.evidence, mapping('other-formal-model')] }]
                    : scenario === 'repeated-candidate'
                      ? [supported, { ...supported, model: 'other-formal-model' }]
                      : [supported, { ...supported, modelRoute: 'gateway/incompatible' }];
            const result = await summarize(input(records), operation, registry);
            assert.equal(result.exitCode, 20);
            assert.ok(result.issues.some((issue) => issue.code === 'conflicting-model'));
            assert.equal(result.tuples.length, 0);
            assert.equal(result.events[0]?.records.length, records.length);
        });
    });
}

test('review F2 compatible mapping enrichment ignores requested and capability alternatives', async () => {
    await fixture(async (operation, input) => {
        const candidate = event({ modelRoute: 'gateway/selected' });
        const provenance = event({
            modelRoute: 'gateway/selected',
            evidence: [
                mapping('gpt-6.1-sol'),
                mapping('requested-model', 'requested'),
                mapping('capability-model', 'capability'),
            ],
        });
        delete provenance.model;
        const result = await summarize(input([candidate, provenance]), operation, registry);
        assert.equal(result.exitCode, 0);
        assert.equal(result.tuples[0]?.model, 'gpt-6.1-sol');
        assert.equal(result.events[0]?.records[1]?.evidence.length, 3);
    });
});

for (const model of ['unknown', 'N/A', 'null', 'UNKNOWN', 'n/a', 'NULL']) {
    test(`review F3 explicit missing model ${model} remains a required gap`, async () => {
        await fixture(async (operation, input) => {
            const result = await summarize(input([event({ model })]), operation, registry);
            assert.equal(result.exitCode, 20);
            assert.equal(result.issues[0]?.code, 'unresolved-model');
            assert.equal(result.tuples.length, 0);
        });
    });
}

test('review F3 preserves a real model spelling and compatible same-event placeholder enrichment', async () => {
    await fixture(async (operation, input) => {
        const model = 'vendor.model-1.2.snapshot_2026';
        const result = await summarize(input([event({ model }), event({ model: 'unknown' })]), operation, registry);
        assert.equal(result.exitCode, 0);
        assert.equal(result.tuples[0]?.model, model);
        const conflicting = await summarize(
            input([
                event({ model }),
                event({ model: 'unknown', modelRoute: 'gateway/selected', evidence: [mapping('other-formal-model')] }),
            ]),
            operation,
            registry,
        );
        assert.equal(conflicting.exitCode, 20);
        assert.equal(conflicting.issues[0]?.code, 'conflicting-model');
    });
});

test('review F4 opaque issue components remain unique and exceptions select one concrete issue', async () => {
    await fixture(async (operation, input) => {
        const ledger = {
            ...input([]),
            knownParticipants: [
                { id: 'a', eventIds: ['b:events'] },
                { id: 'a:event:b', eventIds: [] },
            ],
        };
        const result = await summarize(ledger, operation, registry);
        assert.equal(result.issues.length, 3);
        assert.equal(new Set(result.issues.map((issue) => issue.id)).size, 3);
        assert.deepEqual(
            result.issues.map((issue) => JSON.parse(issue.id)),
            [
                ['participant', 'a', 'event', 'b:events'],
                ['participant', 'a', 'events'],
                ['participant', 'a:event:b', 'events'],
            ],
        );
        for (const issue of result.issues) {
            const exception = {
                operationId: operation.id,
                issueIds: [issue.id],
                decision: 'explicit current-operation exception',
                reference: 'user:message-7',
            };
            const recorded = await summarize({ ...ledger, userExceptions: [exception] }, operation, registry);
            assert.equal(recorded.issues.filter((item) => exception.issueIds.includes(item.id)).length, 1);
            assert.equal(recorded.exitCode, 20);
            assert.deepEqual(recorded.userExceptions[0], exception);
        }
    });
});
