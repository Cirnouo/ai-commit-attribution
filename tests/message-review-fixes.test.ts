import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { processMessage } from '../src/message.ts';
import { resolveTrustedGit } from '../src/safe-git.ts';
import { summarize } from '../src/summarize.ts';

const issueId = 'required:model';
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
    const identity = { agent: 'Codex App', model: 'formal.model-1' };
    const ledger = {
        schemaVersion: 2,
        ledgerId: '00000000-0000-4000-8000-000000000001',
        operation,
        identities: [identity],
        blockers: [],
    };
    const registry: unknown = JSON.parse(
        await readFile(new URL('../packaging/agent-registry.json', import.meta.url), 'utf8'),
    );
    const assessment = (extra: Record<string, unknown> = {}) => ({
        schemaVersion: 3,
        artifact: 'message-assessment',
        operation,
        messageSha256: createHash('sha256').update(message).digest('hex'),
        signatures: [],
        migrations: [],
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
        identity,
        ledger,
        registry,
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

test('assessment schema 3 rejects legacy scanner sources with migration guidance and keeps exact source joins', async () => {
    const f = await fixture();
    try {
        const signature = {
            id: 'automatic',
            source: { kind: 'automatic-signing', reference: 'fixture:source' },
            classification: 'ai-signature',
            identityKeys: ['["Codex App","formal.model-1",null]'],
            evidenceReferences: ['fixture:evidence'],
            rationale: 'An Agent supplied a semantic signature declaration.',
        };
        const input = { mode: 'render' as const, message, ...f.scope };
        const evaluate = (assessment: unknown) =>
            processMessage(input, async () => ({ ledger: f.ledger, registry: f.registry, assessment }));
        for (const source of [{ policyCandidateId: 'obsolete' }, { messageRecordId: 'obsolete' }])
            await assert.rejects(
                evaluate(f.assessment({ signatures: [{ ...signature, source }] })),
                /schemaVersion 3|migrate/i,
            );
        for (const change of [{ schemaVersion: 1 }, { binding: {} }, { operation: { ...f.operation, id: 'other' } }])
            await assert.rejects(evaluate(f.assessment(change)), /schemaVersion 3|migrate/i);
        for (const change of [
            { source: { kind: 'automatic-signing', reference: '' } },
            { source: { kind: 'automatic-signing', reference: 'fixture', messageRecordId: 'mixed' } },
            { source: { kind: 'message-record', messageRecordId: 'unknown' } },
            { source: { kind: 'unknown', reference: 'fixture' } },
            { classification: 'unknown' },
            { identityKeys: ['unknown'] },
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

test('copied bundle explains schema 3 migration for obsolete assessment versions and scanner sources', async () => {
    const f = await fixture();
    try {
        await f.installed();
        const signature = {
            id: 'legacy-source',
            source: { policyCandidateId: 'obsolete' },
            classification: 'ai-signature',
            identityKeys: ['["Codex App","formal.model-1",null]'],
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
            assert.match(JSON.parse(response.stderr).error, /schemaVersion 3|migrate/i);
        }
    } finally {
        await f.dispose();
    }
});

test('known blockers and independent signature blockers retain colliding opaque IDs', async () => {
    const f = await fixture();
    try {
        const result = await processMessage({ mode: 'render', message, ...f.scope }, async () => ({
            ledger: { ...f.ledger, blockers: [{ id: issueId, reason: 'Required input unresolved.' }] },
            registry: f.registry,
            assessment: f.assessment({
                signatures: [
                    {
                        id: issueId,
                        source: { kind: 'automatic-signing', reference: 'fixture:auto' },
                        classification: 'ai-signature',
                        identityKeys: ['["Codex App","formal.model-1",null]'],
                        evidenceReferences: ['fixture:signing'],
                        rationale: 'Independent signature declaration.',
                    },
                ],
            }),
        }));
        assert.equal(result.exitCode, 20);
        assert.equal(result.issues.filter((issue) => issue.id === issueId).length, 2);
        assert.equal(result.message.preview, undefined);
    } finally {
        await f.dispose();
    }
});

test('assessment v2 and removed exception applications reject with schema 3 migration guidance', async () => {
    const f = await fixture();
    try {
        for (const change of [{ schemaVersion: 2 }, { exceptionApplications: [] }]) {
            await assert.rejects(
                processMessage({ mode: 'render', message, ...f.scope }, async () => ({
                    ledger: f.ledger,
                    registry: f.registry,
                    assessment: f.assessment(change),
                })),
                /schemaVersion 3|migrate/i,
            );
        }
    } finally {
        await f.dispose();
    }
});

test('confirmed native spelling, none and absent reasoning render and validate exactly', async () => {
    const f = await fixture();
    try {
        for (const reasoning of [undefined, 'none', 'Native.MiXeD-7']) {
            const ledger = { ...f.ledger, identities: [{ ...f.identity, ...(reasoning ? { reasoning } : {}) }] };
            const expected = `subject\n\nAssisted-by: Codex App:formal.model-1${reasoning ? ` (${reasoning})` : ''}\n`;
            const load = async () => ({ ledger, registry: f.registry });
            assert.equal(
                (await processMessage({ mode: 'render', message, ...f.scope }, load)).message.preview,
                expected,
            );
            assert.equal(
                (await processMessage({ mode: 'validate', message: Buffer.from(expected), ...f.scope }, load)).exitCode,
                0,
            );
        }
        for (const reasoning of ['n/a', 'UNKNOWN', 'NULL', 'off']) {
            await assert.rejects(
                summarize({ ...f.ledger, identities: [{ ...f.identity, reasoning }] }, f.operation, f.registry),
                /reasoning/,
            );
        }
    } finally {
        await f.dispose();
    }
});

test('copied bundle uses confirmed native spelling and rejects placeholders', async () => {
    const f = await fixture();
    try {
        await f.installed();
        for (const reasoning of [undefined, 'none', 'Native.MiXeD-7']) {
            const ledger = { ...f.ledger, identities: [{ ...f.identity, ...(reasoning ? { reasoning } : {}) }] };
            const expected = `subject\n\nAssisted-by: Codex App:formal.model-1${reasoning ? ` (${reasoning})` : ''}\n`;
            const response = await f.run('render', ledger, f.assessment());
            assert.equal(response.status, 0, response.stderr);
            assert.equal(JSON.parse(response.stdout).message.preview, expected);
            assert.equal(
                (
                    await f.run(
                        'validate',
                        ledger,
                        { ...f.assessment(), messageSha256: createHash('sha256').update(expected).digest('hex') },
                        Buffer.from(expected),
                    )
                ).status,
                0,
            );
        }
        for (const reasoning of ['n/a', 'UNKNOWN', 'NULL', 'off'])
            assert.equal(
                (await f.run('render', { ...f.ledger, identities: [{ ...f.identity, reasoning }] }, f.assessment()))
                    .status,
                2,
            );
    } finally {
        await f.dispose();
    }
});
