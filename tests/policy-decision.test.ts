import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { run } from '../src/attribution.ts';
import { processMessage } from '../src/message.ts';
import { InputError } from '../src/records.ts';

async function fixture() {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-decision-')));
    const metadata = path.join(directory, 'declared-admin');
    await mkdir(metadata);
    const operation = {
        schemaVersion: 1,
        id: 'decision',
        repository: directory,
        worktree: directory,
        commonGitDir: metadata,
        kind: 'commit',
        paths: ['z.txt', 'a.txt'],
        targets: [],
    };
    const decision = {
        schemaVersion: 2,
        artifact: 'policy-decision',
        operation,
        branch: 'repository-policy',
        rationale: 'An Agent read the applicable instructions.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture:semantic-decision' },
    };
    return { directory, operation, decision, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test('schema 2 exclusive routes use only the Agent declaration and preserve policy bytes', async () => {
    const f = await fixture();
    try {
        const message = Buffer.from('subject\r\n\r\nAssisted-by: invalid\r\n');
        for (const [branch, code] of [
            ['repository-policy', 10],
            ['needs-decision', 20],
        ] as const) {
            for (const mode of ['render', 'validate'] as const) {
                const result = await processMessage(
                    { mode, message, operation: f.operation, decision: { ...f.decision, branch } },
                    async () => {
                        throw new Error('default input accessed');
                    },
                );
                assert.equal(result.exitCode, code);
                assert.equal(result.schemaVersion, 3);
                assert.deepEqual(result.routing, { branch });
                assert.equal('binding' in result, false);
                assert.equal(result.repositoryPolicyValidation.status, 'not-run');
                assert.equal(result.format.status, 'not-run');
                assert.equal(result.participationEvidence.status, 'not-run');
                assert.equal(
                    result.message.preview,
                    branch === 'repository-policy' && mode === 'render' ? message.toString() : undefined,
                );
            }
        }
    } finally {
        await f.dispose();
    }
});

test('default route reaches the lazy input boundary while normalized operation equality stays exact', async () => {
    const f = await fixture();
    try {
        const input = {
            mode: 'render' as const,
            message: Buffer.from('subject\n'),
            operation: f.operation,
            decision: {
                ...f.decision,
                operation: { ...f.operation, paths: ['a.txt', 'z.txt', 'a.txt'] },
                branch: 'skill-default',
            },
        };
        await assert.rejects(
            processMessage(input, async () => {
                throw new Error('default reached');
            }),
            /default reached/,
        );
        for (const change of [
            { id: 'another' },
            { paths: ['a.txt'] },
            { kind: 'amend' },
            { targets: [{ role: 'head', objectId: 'a'.repeat(40) }] },
        ]) {
            await assert.rejects(
                processMessage(
                    { ...input, decision: { ...input.decision, operation: { ...f.operation, ...change } } },
                    async () => {
                        throw new Error('default reached');
                    },
                ),
                (error: unknown) => error instanceof InputError && /operation|scope/i.test(error.message),
            );
        }
    } finally {
        await f.dispose();
    }
});

test('schema 2 decision rejects old schemas, scanner fields, missing members and raw controls', async () => {
    const f = await fixture();
    try {
        const changes = [
            { schemaVersion: 1 },
            { artifact: 'policy-scan' },
            { binding: {} },
            { context: {} },
            { assessments: [] },
            { selectedCandidateIds: [] },
            { issueIds: [] },
            { candidates: [] },
            { freshness: 'current' },
            { branch: 'other' },
            { rationale: '' },
            { decisionSource: { kind: 'automatic', reference: 'fixture' } },
            { decisionSource: { kind: 'agent-semantic', reference: 'fixture', extra: true } },
            { decisionSource: { kind: 'agent-semantic', reference: 'bad\nreference' } },
        ];
        for (const change of changes) {
            await assert.rejects(
                processMessage(
                    {
                        mode: 'render',
                        message: Buffer.from('subject\n'),
                        operation: f.operation,
                        decision: { ...f.decision, ...change },
                    },
                    async () => {
                        throw new Error('default accessed');
                    },
                ),
                InputError,
            );
        }
        for (const field of ['schemaVersion', 'artifact', 'operation', 'branch', 'rationale', 'decisionSource']) {
            const decision: Record<string, unknown> = { ...f.decision };
            delete decision[field];
            await assert.rejects(
                processMessage(
                    { mode: 'render', message: Buffer.from('subject\n'), operation: f.operation, decision },
                    async () => {
                        throw new Error('default accessed');
                    },
                ),
                InputError,
            );
        }
    } finally {
        await f.dispose();
    }
});

test('removed scan and context CLI inputs explain migration without reading any path', async () => {
    for (const args of [
        ['policy', 'scan', '--operation', 'absent', '--context', 'absent'],
        ['render', '--context', 'absent'],
        ['validate', '--context', 'absent'],
    ]) {
        await assert.rejects(
            run(args),
            (error: unknown) => error instanceof InputError && /schema.?2|AI.*decision/i.test(error.message),
        );
    }
});

test('declared route ignores policy, path and nonexistent target changes without rescanning', async () => {
    const f = await fixture();
    try {
        const operation = { ...f.operation, targets: [{ role: 'head', objectId: 'f'.repeat(40) }] };
        const input = {
            mode: 'render' as const,
            message: Buffer.from('subject\n'),
            operation,
            decision: { ...f.decision, operation },
        };
        const load = async () => {
            throw new Error('default accessed');
        };
        assert.equal((await processMessage(input, load)).exitCode, 10);
        await writeFile(path.join(f.directory, 'AGENTS.md'), 'A changed instruction.\n');
        await writeFile(path.join(f.directory, 'a.txt'), 'changed operation bytes');
        await writeFile(path.join(operation.commonGitDir, 'HEAD'), 'not Git metadata');
        assert.equal((await processMessage(input, load)).message.preview, 'subject\n');
    } finally {
        await f.dispose();
    }
});
