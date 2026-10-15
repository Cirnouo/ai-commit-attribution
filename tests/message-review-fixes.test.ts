import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { processMessage } from '../src/message.ts';
import { resolveTrustedGit } from '../src/safe-git.ts';
import { summarize } from '../src/summarize.ts';

const issueId = '["event","e","model"]';
const message = Buffer.from('subject\n');
async function fixture() {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'message-review-')));
    const repository = path.join(directory, 'business');
    await mkdir(repository);
    const environment = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) => !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$|HOME$|USERPROFILE$|XDG_)/i.test(key),
        ),
    );
    const executable = await resolveTrustedGit([directory]);
    const git = (args: string[]) =>
        execFileSync(executable, args, {
            cwd: repository,
            env: environment,
            windowsHide: true,
            encoding: 'utf8',
        }).trim();
    git(['init', '--quiet']);
    git(['config', 'user.name', 'Synthetic Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    const operation = {
        schemaVersion: 1,
        id: 'review',
        repository,
        worktree: repository,
        commonGitDir: await realpath(path.join(repository, '.git')),
        kind: 'commit',
        paths: ['planned.txt'],
        targets: [],
    };
    const decision = {
        schemaVersion: 2,
        artifact: 'policy-decision',
        operation,
        branch: 'skill-default',
        rationale: 'Synthetic semantic fixture.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture:review' },
    };
    const event = {
        id: 'e',
        participantId: 'actor',
        task: 'fixture',
        agent: 'Codex App',
        model: 'formal.model-1',
        reasoning: { state: 'unknown' },
        evidence: [
            {
                fields: ['agent', 'model', 'reasoning'],
                kind: 'synthetic fixture',
                observation: 'effective',
                reference: 'fixture:dispatch',
                nativeReasoning: 'enabled',
            },
        ],
    };
    const ledger = {
        schemaVersion: 1,
        operation,
        knownParticipants: [{ id: 'actor', eventIds: ['e'] }],
        events: [event],
        userExceptions: [],
    };
    const registry: unknown = JSON.parse(
        await readFile(new URL('../packaging/agent-registry.json', import.meta.url), 'utf8'),
    );
    const exception = {
        operationId: operation.id,
        reference: 'fixture:actual-current-user-decision',
        issueIds: [issueId],
        decision: 'Explicit synthetic current-operation continuation.',
    };
    const application = {
        operationId: operation.id,
        reference: exception.reference,
        issueIds: [issueId],
        action: 'continue-with-incomplete-disclosure',
    };
    const assessment = (extra: Record<string, unknown> = {}) => ({
        schemaVersion: 2,
        artifact: 'message-assessment',
        operation,
        messageSha256: createHash('sha256').update(message).digest('hex'),
        signatures: [],
        migrations: [],
        exceptionApplications: [],
        ...extra,
    });
    const scope = { operation, decision };
    const snapshot = async () => ({
        head: await readFile(path.join(repository, '.git/HEAD')),
        config: await readFile(path.join(repository, '.git/config')),
        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
        status: git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1']),
        author: git(['var', 'GIT_AUTHOR_IDENT']).replace(/ \d+ [+-]\d+$/, ''),
        committer: git(['var', 'GIT_COMMITTER_IDENT']).replace(/ \d+ [+-]\d+$/, ''),
    });
    const payload = path.join(directory, 'home/skill');
    const files = {
        message: path.join(directory, 'message'),
        operation: path.join(directory, 'operation'),
        decision: path.join(directory, 'decision'),
        input: path.join(directory, 'input'),
        assessment: path.join(directory, 'assessment'),
    };
    const installed = async () => {
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
        await writeFile(files.message, message);
        for (const [key, value] of Object.entries(scope))
            await writeFile(files[key as keyof typeof scope], JSON.stringify(value));
    };
    const run = async (mode: string, input: unknown, evaluation: unknown, content = message, output?: string) => {
        await writeFile(files.input, JSON.stringify(input));
        await writeFile(files.assessment, JSON.stringify(evaluation));
        await writeFile(files.message, content);
        const args = [
            mode,
            ...Object.entries(files).flatMap(([key, value]) => [`--${key}`, value]),
            ...(output ? ['--output', output] : []),
        ];
        return spawnSync(process.execPath, [path.join(payload, 'scripts/attribution.mjs'), ...args], {
            cwd: directory,
            windowsHide: true,
            encoding: 'utf8',
            env: {
                ...environment,
                HOME: path.join(directory, 'home'),
                USERPROFILE: path.join(directory, 'home'),
                XDG_CONFIG_HOME: path.join(directory, 'home/config'),
            },
        });
    };
    return {
        directory,
        operation,
        scope,
        event,
        ledger,
        registry,
        exception,
        application,
        assessment,
        snapshot,
        installed,
        run,
        dispose: async () => {
            assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
            await rm(directory, { recursive: true, force: true });
        },
    };
}

test('review I1 source waivers never suppress colliding automatic or uncertain signature issues', async (t) => {
    const f = await fixture();
    try {
        const ledger = { ...f.ledger, events: [{ ...f.event, model: undefined }], userExceptions: [f.exception] };
        const base = f.assessment({ exceptionApplications: [f.application] });
        const positive = await processMessage({ mode: 'render', message, ...f.scope }, async () => ({
            ledger,
            registry: f.registry,
            assessment: base,
        }));
        assert.equal(positive.exitCode, 0);
        assert.equal(positive.participationEvidence.summary?.exitCode, 20);
        const before = await f.snapshot();
        for (const classification of ['ai-signature', 'uncertain'])
            for (const mode of ['render', 'validate'] as const) {
                await t.test(`${classification} ${mode}`, async () => {
                    const output = path.join(f.directory, `${classification}-${mode}`);
                    const assessment = {
                        ...base,
                        signatures: [
                            {
                                id: issueId,
                                source: { kind: 'automatic-signing', reference: 'fixture:automatic-signing' },
                                classification,
                                eventIds: ['e'],
                                evidenceReferences: ['fixture:current-signature'],
                                rationale: 'A concrete independent signature issue uses a colliding opaque ID.',
                            },
                        ],
                    };
                    const result = await processMessage(
                        { mode, message, ...f.scope, ...(mode === 'render' ? { output } : {}) },
                        async () => ({ ledger, registry: f.registry, assessment }),
                    );
                    assert.equal(result.exitCode, 20);
                    assert.equal(result.issues.filter((issue) => issue.id === issueId).length, 2);
                    assert.equal(result.message.preview, undefined);
                    assert.equal(existsSync(output), false);
                });
            }
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('assessment schema 2 rejects legacy scanner sources with migration guidance and keeps exact source joins', async () => {
    const f = await fixture();
    try {
        const signature = {
            id: 'automatic',
            source: { kind: 'automatic-signing', reference: 'fixture:source' },
            classification: 'ai-signature',
            eventIds: ['e'],
            evidenceReferences: ['fixture:evidence'],
            rationale: 'An Agent supplied a semantic signature declaration.',
        };
        const input = { mode: 'render' as const, message, ...f.scope };
        const evaluate = (assessment: unknown) =>
            processMessage(input, async () => ({ ledger: f.ledger, registry: f.registry, assessment }));
        for (const source of [{ policyCandidateId: 'obsolete' }, { messageRecordId: 'obsolete' }])
            await assert.rejects(
                evaluate(f.assessment({ signatures: [{ ...signature, source }] })),
                /schemaVersion 2|migrate/i,
            );
        for (const change of [{ schemaVersion: 1 }, { binding: {} }, { operation: { ...f.operation, id: 'other' } }])
            await assert.rejects(evaluate(f.assessment(change)), /schemaVersion 2|migrate/i);
        for (const change of [
            { source: { kind: 'automatic-signing', reference: '' } },
            { source: { kind: 'automatic-signing', reference: 'fixture', messageRecordId: 'mixed' } },
            { source: { kind: 'message-record', messageRecordId: 'unknown' } },
            { source: { kind: 'unknown', reference: 'fixture' } },
            { classification: 'unknown' },
            { eventIds: ['unknown'] },
            { evidenceReferences: [] },
        ])
            await assert.rejects(evaluate(f.assessment({ signatures: [{ ...signature, ...change }] })));
        await assert.rejects(
            evaluate(f.assessment({ signatures: [signature, { ...signature, id: 'duplicate-source' }] })),
            /Duplicate/,
        );
        await assert.rejects(
            evaluate(
                f.assessment({
                    signatures: [
                        signature,
                        { ...signature, source: { kind: 'automatic-signing', reference: 'another' } },
                    ],
                }),
            ),
            /Duplicate/,
        );
    } finally {
        await f.dispose();
    }
});

test('copied bundle explains schema 2 migration for obsolete assessment versions and scanner sources', async () => {
    const f = await fixture();
    try {
        await f.installed();
        const signature = {
            id: 'legacy-source',
            source: { policyCandidateId: 'obsolete' },
            classification: 'ai-signature',
            eventIds: ['e'],
            evidenceReferences: ['fixture:evidence'],
            rationale: 'An obsolete scanner association.',
        };
        for (const change of [
            { schemaVersion: 1 },
            { binding: {} },
            { signatures: [signature] },
            { signatures: [{ ...signature, source: { messageRecordId: 'obsolete' } }] },
        ]) {
            const response = await f.run('render', f.ledger, f.assessment(change));
            assert.equal(response.status, 2, response.stderr + response.stdout);
            assert.match(JSON.parse(response.stderr).error, /schemaVersion 2|migrate/i);
        }
    } finally {
        await f.dispose();
    }
});

test('review I1 copied bundle retains signature blockers beside a legitimate incomplete-disclosure exception', async (t) => {
    const f = await fixture();
    try {
        await f.installed();
        const ledger = { ...f.ledger, events: [{ ...f.event, model: undefined }], userExceptions: [f.exception] };
        const base = f.assessment({ exceptionApplications: [f.application] });
        const positive = await f.run('render', ledger, base);
        assert.equal(positive.status, 0, positive.stderr);
        for (const classification of ['ai-signature', 'uncertain'])
            for (const mode of ['render', 'validate']) {
                await t.test(`${classification} ${mode}`, async () => {
                    const output = path.join(f.directory, `installed-${classification}-${mode}`);
                    const assessment = {
                        ...base,
                        signatures: [
                            {
                                id: issueId,
                                source: { kind: 'automatic-signing', reference: 'fixture:automatic-signing' },
                                classification,
                                eventIds: ['e'],
                                evidenceReferences: ['fixture:current-signature'],
                                rationale: 'Synthetic ID collision.',
                            },
                        ],
                    };
                    const result = await f.run(
                        mode,
                        ledger,
                        assessment,
                        message,
                        mode === 'render' ? output : undefined,
                    );
                    assert.equal(result.status, 20, result.stderr + result.stdout);
                    assert.equal(JSON.parse(result.stdout).participationEvidence.summary.exitCode, 20);
                    assert.equal(existsSync(output), false);
                });
            }
    } finally {
        await f.dispose();
    }
});

test('review M1 exception applications require one exact decision record while distinct joins remain valid', async (t) => {
    const f = await fixture();
    try {
        const ledger = { ...f.ledger, events: [{ ...f.event, model: undefined }], userExceptions: [f.exception] };
        const assessment = f.assessment({ exceptionApplications: [f.application] });
        await t.test('conflicting same-reference coverage is ambiguous', async () => {
            await assert.rejects(
                processMessage({ mode: 'render', message, ...f.scope }, async () => ({
                    registry: f.registry,
                    assessment,
                    ledger: {
                        ...ledger,
                        userExceptions: [f.exception, { ...f.exception, decision: 'A different decision record.' }],
                    },
                })),
                /exception|Exception/,
            );
        });
        await t.test('distinct references do not create an ambiguous join', async () => {
            const result = await processMessage({ mode: 'render', message, ...f.scope }, async () => ({
                registry: f.registry,
                assessment,
                ledger: {
                    ...ledger,
                    userExceptions: [
                        f.exception,
                        {
                            ...f.exception,
                            reference: 'fixture:another-decision',
                            decision: 'Another recorded decision.',
                        },
                    ],
                },
            }));
            assert.equal(result.exitCode, 0);
            assert.equal(result.participationEvidence.summary?.issues.length, 1);
        });
        await t.test('same reference with disjoint issue coverage has unique application joins', async () => {
            const agentId = '["event","e","agent"]';
            const result = await processMessage({ mode: 'render', message, ...f.scope }, async () => ({
                registry: f.registry,
                ledger: {
                    ...ledger,
                    events: [{ ...f.event, agent: undefined, model: undefined }],
                    userExceptions: [
                        f.exception,
                        { ...f.exception, issueIds: [agentId], decision: 'Separate specific coverage.' },
                    ],
                },
                assessment: f.assessment({
                    exceptionApplications: [f.application, { ...f.application, issueIds: [agentId] }],
                }),
            }));
            assert.equal(result.exitCode, 0);
            assert.equal(result.participationEvidence.summary?.issues.length, 2);
            assert.equal(result.participationEvidence.appliedExceptionIssueIds.length, 2);
        });
    } finally {
        await f.dispose();
    }
});

const placeholders = ['n/a', 'N/A', 'UNKNOWN', 'unknown', 'NULL', 'Null', 'NONE', 'OFF'];
test('review I3 shared summary omits case variants of optional placeholders without normalizing native values', async (t) => {
    const f = await fixture();
    try {
        for (const value of placeholders)
            await t.test(value, async () => {
                const summary = await summarize(
                    { ...f.ledger, events: [{ ...f.event, reasoning: { state: 'confirmed', value } }] },
                    f.operation,
                    f.registry,
                );
                assert.equal(summary.exitCode, 0);
                assert.equal(summary.tuples[0]?.reasoning, undefined);
                assert.equal(summary.issues.length, 0);
                assert.equal(summary.diagnostics[0]?.code, 'unknown-reasoning');
            });
    } finally {
        await f.dispose();
    }
});

test('review I3 source render and validate reject fabricated optional placeholders and retain native neighbors', async (t) => {
    const f = await fixture();
    try {
        for (const value of ['n/a', 'UNKNOWN', 'NULL', 'Native.MiXeD-7', 'disabled', 'unknown-state'])
            await t.test(value, async () => {
                const event = {
                    ...f.event,
                    reasoning:
                        value === 'unknown-state'
                            ? { state: 'unknown' }
                            : { state: 'confirmed', value: value === 'disabled' ? 'off' : value },
                    evidence: [
                        { ...f.event.evidence[0], nativeReasoning: value === 'disabled' ? 'disabled' : 'enabled' },
                    ],
                };
                const ledger = { ...f.ledger, events: [event] };
                const suffix = value === 'Native.MiXeD-7' ? ' (Native.MiXeD-7)' : value === 'disabled' ? ' (none)' : '';
                const expected = `subject\n\nAssisted-by: Codex App:formal.model-1${suffix}\n`;
                const load = async () => ({ ledger, registry: f.registry });
                const result = await processMessage({ mode: 'render', message, ...f.scope }, load);
                assert.equal(result.exitCode, 0);
                assert.equal(result.message.preview, expected);
                assert.equal(
                    (await processMessage({ mode: 'validate', message: Buffer.from(expected), ...f.scope }, load))
                        .exitCode,
                    0,
                );
                if (['n/a', 'UNKNOWN', 'NULL'].includes(value)) {
                    const legacy = await processMessage(
                        {
                            mode: 'validate',
                            message: Buffer.from(`subject\n\nAssisted-by: Codex App:formal.model-1 (${value})\n`),
                            ...f.scope,
                        },
                        load,
                    );
                    assert.equal(legacy.exitCode, 2);
                    assert.equal(legacy.participationEvidence.summary?.issues.length, 0);
                }
            });
    } finally {
        await f.dispose();
    }
});

test('review I3 copied bundle omits placeholders and preserves exact native/disabled/unknown output', async (t) => {
    const f = await fixture();
    try {
        await f.installed();
        for (const value of ['n/a', 'UNKNOWN', 'NULL', 'Native.MiXeD-7', 'disabled', 'unknown-state'])
            await t.test(value, async () => {
                const event = {
                    ...f.event,
                    reasoning:
                        value === 'unknown-state'
                            ? { state: 'unknown' }
                            : { state: 'confirmed', value: value === 'disabled' ? 'off' : value },
                    evidence: [
                        { ...f.event.evidence[0], nativeReasoning: value === 'disabled' ? 'disabled' : 'enabled' },
                    ],
                };
                const ledger = { ...f.ledger, events: [event] };
                const expected = `subject\n\nAssisted-by: Codex App:formal.model-1${value === 'Native.MiXeD-7' ? ' (Native.MiXeD-7)' : value === 'disabled' ? ' (none)' : ''}\n`;
                const rendered = await f.run('render', ledger, f.assessment());
                assert.equal(rendered.status, 0, rendered.stderr);
                assert.equal(JSON.parse(rendered.stdout).message.preview, expected);
                const evaluation = {
                    ...f.assessment(),
                    messageSha256: createHash('sha256').update(expected).digest('hex'),
                };
                const validated = await f.run('validate', ledger, evaluation, Buffer.from(expected));
                assert.equal(validated.status, 0, validated.stderr);
                if (['n/a', 'UNKNOWN', 'NULL'].includes(value)) {
                    const old = `subject\n\nAssisted-by: Codex App:formal.model-1 (${value})\n`;
                    const wrong = await f.run(
                        'validate',
                        ledger,
                        { ...f.assessment(), messageSha256: createHash('sha256').update(old).digest('hex') },
                        Buffer.from(old),
                    );
                    assert.equal(wrong.status, 2, wrong.stderr + wrong.stdout);
                }
            });
    } finally {
        await f.dispose();
    }
});
