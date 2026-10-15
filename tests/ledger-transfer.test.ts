import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { abandonLedger, createLedger, replaceLedgers, selectLedger } from '../src/ledger.ts';
import { parseLedgerArguments, runLedger } from '../src/ledger-cli.ts';
import { STATE_BYTES } from '../src/ledger-contract.ts';
import { initializeState, readState, resolveLedgerContext, transactState } from '../src/ledger-store.ts';
import { BUNDLE_BYTES, encodeTransferBundle, parseTransferBundle } from '../src/ledger-transfer.ts';
import type { Operation } from '../src/records.ts';
import type { PreparedReceipt } from '../src/result-contract.ts';
import type { SealedResult } from '../src/result-review.ts';
import { byteDigest } from '../src/runtime-support.ts';
import { gitEnvironment, resolveTrustedGit } from '../src/safe-git.ts';

async function fixture() {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ledger-transfer-')));
    const executable = await resolveTrustedGit([directory]);
    const repository = async (name: string) => {
        const root = path.join(directory, name);
        await mkdir(root);
        execFileSync(executable, ['init', '--quiet', '--initial-branch=main'], {
            cwd: root,
            env: gitEnvironment(),
            windowsHide: true,
        });
        const context = await resolveLedgerContext(root);
        await initializeState(context);
        return context;
    };
    const source = await repository('source');
    const target = await repository('target');
    const state = await transactState(source, 0, (draft) => {
        createLedger(draft, { select: true, note: 'original note' });
    });
    const id = state.ledgers[0]?.ledgerId as string;
    return {
        directory,
        source,
        target,
        id,
        output: path.join(directory, 'bundle.json'),
        dispose: async () => {
            assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
            await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        },
    };
}
const transfer = async () => {
    const module = await import('../src/ledger-transfer.ts').catch(() => undefined);
    assert.equal(typeof module?.exportLedgers, 'function', 'transfer export protocol is available');
    return module as NonNullable<typeof module>;
};

test('Windows export rejects directory streams before freezing authority', {
    skip: process.platform !== 'win32',
}, async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const original = await readFile(f.source.stateFile);
        for (const output of [
            `${f.source.locator.worktree}:bundle.json`,
            `${f.source.locator.worktree}:bundle.json:$DATA`,
            `${f.source.locator.commonGitDir}:bundle.json`,
            path.join(`${f.source.locator.worktree}:stream`, 'bundle.json'),
            `${path.toNamespacedPath(f.source.locator.worktree)}:bundle.json`,
            `${f.source.locator.worktree.slice(0, 2)}${f.source.locator.worktree.slice(3)}:drive-stream.json`,
        ]) {
            await assert.rejects(api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output }), /stream/i);
            assert.deepEqual(await readFile(f.source.stateFile), original);
        }
        const exported = await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output: f.output });
        const bytes = await readFile(f.output);
        const stream = `${f.source.locator.worktree}:old-export.json`;
        await writeFile(stream, bytes);
        const state = await readState(f.source);
        const receipt = state.transfers.find((item) => item.transferId === exported.transferId);
        assert.ok(receipt);
        receipt.output = stream;
        await writeFile(f.source.stateFile, JSON.stringify(state));
        assert.equal((await api.checkRemoval(f.source)).safe, false);
    } finally {
        await f.dispose();
    }
});

test('Windows extended drive paths preserve external publication and cannot hide internal output', {
    skip: process.platform !== 'win32',
}, async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const original = await readFile(f.source.stateFile);
        for (const internal of [
            path.join(f.source.locator.worktree, 'internal.json'),
            path.join(f.source.locator.commonGitDir, 'internal.json'),
        ]) {
            await assert.rejects(
                api.exportLedgers(f.source, 1, {
                    ledgerIds: [f.id],
                    output: path.toNamespacedPath(internal),
                }),
                /outside/i,
            );
            assert.deepEqual(await readFile(f.source.stateFile), original);
        }
        await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output: path.toNamespacedPath(f.output) });
        assert.equal((await api.checkRemoval(f.source)).safe, true);
        const bytes = await readFile(f.output);
        assert.equal(path.dirname(f.source.locator.worktree), f.directory);
        await rm(f.source.locator.worktree, { recursive: true });
        assert.deepEqual(await readFile(f.output), bytes);
    } finally {
        await f.dispose();
    }
});

test('POSIX export permits a literal colon in an ordinary external filename', {
    skip: process.platform === 'win32',
}, async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const output = path.join(f.directory, 'bundle:literal.json');
        await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output });
        assert.equal((await api.checkRemoval(f.source)).safe, true);
    } finally {
        await f.dispose();
    }
});

test('export freezes selected payload, publishes external bytes, and resume import preserves later target current', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const exported = await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output: f.output });
        const frozen = await readState(f.source);
        assert.equal(frozen.ledgers[0]?.ownership.kind, 'exported');
        assert.deepEqual(frozen.current, { ledgerId: f.id, paused: true });
        await assert.rejects(
            transactState(f.source, frozen.stateVersion, (draft) => {
                if (draft.ledgers[0]) draft.ledgers[0].note = 'tamper';
            }),
            /frozen/i,
        );
        assert.equal((await api.checkRemoval(f.source)).safe, true);
        let target = await transactState(f.target, 0, (draft) => {
            createLedger(draft, { select: true });
        });
        const later = target.current;
        const imported = await api.importLedgers(f.target, target.stateVersion, {
            input: f.output,
            mode: 'resume',
            singleAuthority: true,
        });
        target = await readState(f.target);
        assert.deepEqual(target.current, later);
        assert.ok(target.ledgers.some((ledger) => ledger.ledgerId === f.id && ledger.contextId === target.contextId));
        assert.equal(imported.transferId, exported.transferId);
        await transactState(f.target, target.stateVersion, (draft) => {
            selectLedger(draft, f.id);
        });
        target = await readState(f.target);
        const repeated = await api.importLedgers(f.target, target.stateVersion, {
            input: f.output,
            mode: 'resume',
            singleAuthority: true,
        });
        assert.equal(repeated.idempotent, true);
        assert.deepEqual(await readState(f.target), target);
        await rm(f.output);
        assert.equal((await api.checkRemoval(f.source)).safe, false);
    } finally {
        await f.dispose();
    }
});

async function preparedFixture(f: Awaited<ReturnType<typeof fixture>>) {
    const executable = await resolveTrustedGit([f.directory]);
    const git = (args: string[]) =>
        execFileSync(executable, args, {
            cwd: f.source.locator.worktree,
            env: {
                ...gitEnvironment(),
                GIT_AUTHOR_NAME: 'Fixture Author',
                GIT_AUTHOR_EMAIL: 'author@example.invalid',
                GIT_COMMITTER_NAME: 'Fixture Committer',
                GIT_COMMITTER_EMAIL: 'committer@example.invalid',
            },
            encoding: 'utf8',
            windowsHide: true,
        }).trim();
    git(['-c', 'core.hooksPath=', 'commit', '--quiet', '--allow-empty', '-m', 'Synthetic fixture base']);
    const observedHead = git(['rev-parse', 'HEAD']);
    const expectedTree = git(['rev-parse', 'HEAD^{tree}']);
    const objectFormat = git(['rev-parse', '--show-object-format']);
    assert.ok(objectFormat === 'sha1' || objectFormat === 'sha256');
    const operation: Operation = {
        schemaVersion: 1,
        id: randomUUID(),
        repository: f.source.locator.worktree,
        worktree: f.source.locator.worktree,
        commonGitDir: f.source.locator.commonGitDir,
        kind: 'commit',
        paths: [],
        targets: [],
    };
    const resultPlan = {
        schemaVersion: 1 as const,
        form: 'create' as const,
        expectedParents: [observedHead],
        sourceTargets: [],
    };
    const candidate = Buffer.from('Synthetic subject\n');
    const state = await readState(f.source);
    const receipt: PreparedReceipt = {
        schemaVersion: 1,
        artifact: 'prepared-receipt',
        preparationId: randomUUID(),
        sourceContextId: state.contextId,
        ledgerId: f.id,
        revision: 2,
        ledger: { schemaVersion: 2, ledgerId: f.id, operation, identities: [], blockers: [] },
        decision: {
            schemaVersion: 2,
            artifact: 'policy-decision',
            operation,
            branch: 'repository-policy',
            rationale: 'Caller declared policy',
            decisionSource: { kind: 'agent-semantic', reference: 'synthetic fixture' },
        },
        resultPlan,
        observedHead,
        expectedTree,
        objectFormat,
        // A declared historical fixture, not a verified capture: Task5 owns observer acceptance.
        indexManifestSha256: byteDigest(Buffer.from('Synthetic declared index manifest')),
        candidate: {
            encoding: 'base64',
            bytes: candidate.toString('base64'),
            byteLength: candidate.length,
            sha256: byteDigest(candidate),
        },
    };
    await transactState(f.source, 1, (draft) => {
        const ledger = draft.ledgers[0];
        assert.ok(ledger);
        ledger.state = 'prepared';
        ledger.revision = 2;
        ledger.currentPreparationId = receipt.preparationId;
        draft.preparations.push(receipt);
    });
    return receipt;
}

test('prepared resume and copy preserve historical receipt after the actual source disappears', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const receipt = await preparedFixture(f);
        await api.exportLedgers(f.source, 2, { ledgerIds: [f.id], output: f.output });
        await rm(f.source.locator.worktree, { recursive: true });
        const imported = await api.importLedgers(f.target, 0, {
            input: f.output,
            mode: 'resume',
            singleAuthority: true,
        });
        let target = await readState(f.target);
        assert.equal(target.ledgers[0]?.currentPreparationId, receipt.preparationId);
        assert.deepEqual(target.preparations, [receipt]);
        assert.deepEqual(target.current, { ledgerId: f.id, paused: true });
        await api.exportLedgers(f.target, imported.stateVersion, {
            ledgerIds: [f.id],
            output: path.join(f.directory, 'forward.json'),
        });
        const copyRoot = path.join(f.directory, 'copy');
        await mkdir(copyRoot);
        const git = await resolveTrustedGit([f.directory]);
        execFileSync(git, ['init', '--quiet'], { cwd: copyRoot, env: gitEnvironment(), windowsHide: true });
        const context = await resolveLedgerContext(copyRoot);
        await initializeState(context);
        await api.importLedgers(context, 0, { input: f.output, mode: 'copy' });
        target = await readState(context);
        assert.equal(target.ledgers[0]?.state, 'open');
        assert.equal(target.ledgers[0]?.currentPreparationId, null);
        assert.deepEqual(target.preparations, []);
        assert.deepEqual(target.ledgers[0]?.origin?.preparations, [receipt]);
        assert.equal(target.ledgers[0]?.origin?.source.currentPreparationId, receipt.preparationId);
    } finally {
        await f.dispose();
    }
});

test('complete replacement closure is required and copy retains original linked history', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const nextId = randomUUID();
        const registry = { schemaVersion: 1 as const, hosts: [], ambiguousAliases: [], familyAliases: {} };
        let source = await transactState(f.source, 1, (draft) => {
            replaceLedgers(draft, [f.id], [{ ledgerId: nextId, identities: [], blockers: [] }], registry);
        });
        await assert.rejects(
            api.exportLedgers(f.source, source.stateVersion, { ledgerIds: [nextId], output: f.output }),
            new RegExp(f.id),
        );
        assert.equal((await readState(f.source)).stateVersion, source.stateVersion);
        await api.exportLedgers(f.source, source.stateVersion, { ledgerIds: [f.id, nextId], output: f.output });
        await api.importLedgers(f.target, 0, { input: f.output, mode: 'copy' });
        const target = await readState(f.target);
        const copy = target.ledgers.find((ledger) => ledger.origin?.ledgerId === nextId);
        assert.deepEqual(copy?.predecessorIds, []);
        assert.deepEqual(copy?.origin?.source.predecessorIds, [f.id]);
        source = await readState(f.source);
        await assert.rejects(api.pruneLedgers(f.source, source.stateVersion, { ledgerIds: [f.id] }), /closure/i);
    } finally {
        await f.dispose();
    }
});

test('sealed result history transfers without mutating sealed source and copies only as origin', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const receipt = await preparedFixture(f);
        const sealedResult: SealedResult = {
            preparationId: receipt.preparationId,
            sha: 'a'.repeat(40),
            messageSha256: receipt.candidate.sha256,
            review: {
                schemaVersion: 1,
                artifact: 'result-review',
                contextId: receipt.sourceContextId,
                ledgerId: f.id,
                preparationId: receipt.preparationId,
                sha: 'a'.repeat(40),
                messageSha256: receipt.candidate.sha256,
                createdByPreparation: true,
                policyReviewed: true,
                reference: 'Synthetic result review',
                repositoryPolicyChecked: true,
            },
            checks: {
                parents: true,
                tree: true,
                message: 'candidate-equivalent',
                participation: 'repository-rule-declaration',
            },
        };
        const sealed = await transactState(f.source, 2, (draft) => {
            const ledger = draft.ledgers[0];
            assert.ok(ledger);
            ledger.state = 'sealed';
            ledger.revision = 3;
            ledger.currentPreparationId = null;
            Object.assign(ledger, { sealedResult });
            draft.current = null;
        });
        await api.exportLedgers(f.source, sealed.stateVersion, { ledgerIds: [f.id], output: f.output });
        assert.deepEqual((await readState(f.source)).ledgers, sealed.ledgers);
        assert.equal((await api.checkRemoval(f.source)).safe, true);
        await api.importLedgers(f.target, 0, { input: f.output, mode: 'copy' });
        const copied = (await readState(f.target)).ledgers[0];
        assert.equal(copied?.state, 'open');
        assert.equal(copied?.sealedResult, undefined);
        assert.deepEqual(copied?.origin?.source.sealedResult, sealedResult);
        const exported = await readState(f.source);
        await api.pruneLedgers(f.source, exported.stateVersion, { ledgerIds: [f.id] });
        const pruned = await readState(f.source);
        assert.deepEqual(pruned.ledgers, []);
        assert.deepEqual(pruned.preparations, [receipt]);
        assert.deepEqual(pruned.transfers, exported.transfers);
    } finally {
        await f.dispose();
    }
});

test('current preparation cannot switch operations without a content revision or grow frozen export history', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const receipt = await preparedFixture(f);
        const swapped = structuredClone(receipt);
        swapped.preparationId = randomUUID();
        swapped.ledger.operation.id = randomUUID();
        swapped.decision.operation.id = swapped.ledger.operation.id;
        await assert.rejects(
            transactState(f.source, 2, (draft) => {
                draft.preparations.push(swapped);
                const ledger = draft.ledgers[0];
                assert.ok(ledger);
                ledger.currentPreparationId = swapped.preparationId;
            }),
            /revision/i,
        );
        await api.exportLedgers(f.source, 2, { ledgerIds: [f.id], output: f.output });
        const frozen = await readState(f.source);
        await assert.rejects(
            transactState(f.source, frozen.stateVersion, (draft) => {
                draft.preparations.push(swapped);
            }),
            /frozen/i,
        );
        assert.deepEqual(await readState(f.source), frozen);
    } finally {
        await f.dispose();
    }
});

test('persisted sealed lifecycle requires an explicit result rather than a bare state transition', async () => {
    const f = await fixture();
    try {
        await preparedFixture(f);
        const before = await readFile(f.source.stateFile);
        await assert.rejects(
            transactState(f.source, 2, (draft) => {
                const ledger = draft.ledgers[0];
                assert.ok(ledger);
                ledger.state = 'sealed';
                ledger.revision = 3;
                ledger.currentPreparationId = null;
                draft.current = null;
            }),
            /sealed/i,
        );
        assert.deepEqual(await readFile(f.source.stateFile), before);
    } finally {
        await f.dispose();
    }
});

test('interrupted export remains frozen and retries same transfer after a late current switch', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        await assert.rejects(
            api.exportLedgers(
                f.source,
                1,
                { ledgerIds: [f.id], output: f.output },
                {
                    afterFreeze: async () => {
                        throw new Error('interrupted');
                    },
                },
            ),
            /interrupted/,
        );
        let state = await readState(f.source);
        const transferId = state.transfers[0]?.transferId as string;
        assert.equal(state.ledgers[0]?.ownership.kind, 'exporting');
        assert.equal((await api.checkRemoval(f.source)).safe, false);
        state = await transactState(f.source, state.stateVersion, (draft) => {
            createLedger(draft, { select: true });
        });
        const current = state.current;
        const result = await api.exportLedgers(f.source, state.stateVersion, {
            ledgerIds: [f.id],
            output: f.output,
            transferId,
        });
        assert.equal(result.transferId, transferId);
        assert.deepEqual((await readState(f.source)).current, current);
        assert.equal((await api.checkRemoval(f.source)).safe, false);
        assert.equal(JSON.parse(await readFile(f.output, 'utf8')).current.ledgerId, f.id);
    } finally {
        await f.dispose();
    }
});

test('copy creates fresh open IDs; explicit terminal prune retains import tombstones', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output: f.output });
        const imported = await api.importLedgers(f.target, 0, { input: f.output, mode: 'copy' });
        const copiedId = imported.ledgerIds[0] as string;
        assert.notEqual(copiedId, f.id);
        let target = await readState(f.target);
        const copy = target.ledgers[0];
        assert.equal(copy?.state, 'open');
        assert.equal(copy?.currentPreparationId, null);
        assert.equal(copy?.origin?.ledgerId, f.id);
        await assert.rejects(api.pruneLedgers(f.target, target.stateVersion, { ledgerIds: [copiedId] }), /terminal/i);
        target = await transactState(f.target, target.stateVersion, (draft) => {
            abandonLedger(draft, copiedId);
        });
        await api.pruneLedgers(f.target, target.stateVersion, { ledgerIds: [copiedId] });
        target = await readState(f.target);
        assert.equal(target.ledgers.length, 0);
        await assert.rejects(
            transactState(f.target, target.stateVersion, (draft) => {
                createLedger(draft, { ledgerId: copiedId });
            }),
            /historical/i,
        );
        await api.importLedgers(f.target, target.stateVersion, { input: f.output, mode: 'copy' });
        assert.deepEqual(await readState(f.target), target);
    } finally {
        await f.dispose();
    }
});

test('resume ID collisions and malformed preparation bytes never overwrite target state', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        await preparedFixture(f);
        await api.exportLedgers(f.source, 2, { ledgerIds: [f.id], output: f.output });
        const bundle = JSON.parse(await readFile(f.output, 'utf8'));
        for (const candidate of [
            { ...bundle.preparations[0].candidate, bytes: `${bundle.preparations[0].candidate.bytes}\n` },
            {
                encoding: 'base64',
                bytes: Buffer.from([0xff]).toString('base64'),
                byteLength: 1,
                sha256: byteDigest(Buffer.from([0xff])),
            },
        ]) {
            const changed = structuredClone(bundle);
            changed.preparations[0].candidate = candidate;
            assert.throws(() => parseTransferBundle(changed), /portable result|control/i);
        }
        const target = await transactState(f.target, 0, (draft) => {
            createLedger(draft, { ledgerId: f.id, select: true, note: 'target authority' });
        });
        const authority = await readFile(f.target.stateFile);
        await assert.rejects(
            api.importLedgers(f.target, target.stateVersion, {
                input: f.output,
                mode: 'resume',
                singleAuthority: true,
            }),
            /collision/i,
        );
        assert.deepEqual(await readFile(f.target.stateFile), authority);
    } finally {
        await f.dispose();
    }
});

test('ordinary copied state rejects reads, explicit original-move rebind preserves context and rejects stale CAS', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        const old = await readState(f.source);
        const moved = path.join(f.directory, 'moved');
        await rename(f.source.locator.worktree, moved);
        const context = await resolveLedgerContext(moved);
        await assert.rejects(readState(context), /rebind/i);
        await assert.rejects(api.rebindState(context, 0, { contextId: old.contextId, movedOriginal: true }), /stale/i);
        await assert.rejects(
            api.rebindState(context, 1, { contextId: old.contextId, movedOriginal: false }),
            /declaration/i,
        );
        const bound = await api.rebindState(context, 1, { contextId: old.contextId, movedOriginal: true });
        assert.equal(bound.contextId, old.contextId);
        assert.deepEqual(bound.ledgers, old.ledgers);
        assert.equal(bound.locator.worktree, moved);
        await writeFile(f.output, 'occupied');
        await assert.rejects(
            api.exportLedgers(context, bound.stateVersion, { ledgerIds: [f.id], output: f.output }),
            /occupied/i,
        );
        assert.equal((await readState(context)).stateVersion, bound.stateVersion);
        await assert.rejects(
            api.exportLedgers(context, bound.stateVersion, {
                ledgerIds: [f.id],
                output: path.join(moved, 'bundle.json'),
            }),
            /outside/i,
        );
    } finally {
        await f.dispose();
    }
});

test('published-but-unfinalized export retries exact bytes, refuses residual peers, and preserves late current', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        await assert.rejects(
            api.exportLedgers(
                f.source,
                1,
                { ledgerIds: [f.id], output: f.output },
                {
                    afterPublish: async () => {
                        const frozen = await readState(f.source);
                        await transactState(f.source, frozen.stateVersion, (draft) => {
                            createLedger(draft, { select: true });
                        });
                        throw new Error('interrupted after publication');
                    },
                },
            ),
            /interrupted/,
        );
        const published = await readFile(f.output);
        let frozen = await readState(f.source);
        const transferId = frozen.transfers[0]?.transferId as string;
        const laterCurrent = frozen.current;
        assert.equal(frozen.transfers[0]?.phase, 'exporting');
        await writeFile(f.output, 'unknown partial peer');
        await assert.rejects(
            api.exportLedgers(f.source, frozen.stateVersion, { ledgerIds: [f.id], output: f.output, transferId }),
        );
        assert.equal(await readFile(f.output, 'utf8'), 'unknown partial peer');
        assert.deepEqual(await readState(f.source), frozen);
        await writeFile(f.output, published);
        await api.exportLedgers(f.source, frozen.stateVersion, { ledgerIds: [f.id], output: f.output, transferId });
        frozen = await readState(f.source);
        assert.deepEqual(frozen.current, laterCurrent);
        assert.deepEqual(await readFile(f.output), published);
        assert.equal(frozen.transfers[0]?.phase, 'exported');
    } finally {
        await f.dispose();
    }
});

test('strict bundle references, invalid UTF-8 and raw digest conflicts preserve target authority', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output: f.output });
        const original = await readFile(f.output);
        const bundle = JSON.parse(original.toString('utf8'));
        for (const change of [
            (data: typeof bundle) => {
                data.schemaVersion = 2;
            },
            (data: typeof bundle) => {
                data.unrecognized = true;
            },
            (data: typeof bundle) => {
                data.transferId = 'not-a-uuid';
            },
            (data: typeof bundle) => {
                data.ledgers.push(data.ledgers[0]);
            },
            (data: typeof bundle) => {
                data.ledgers[0].predecessorIds = [randomUUID()];
            },
            (data: typeof bundle) => {
                data.current.ledgerId = randomUUID();
            },
            (data: typeof bundle) => {
                data.payloadDigest = '0'.repeat(64);
            },
        ]) {
            const malformed = structuredClone(bundle);
            change(malformed);
            assert.throws(() => parseTransferBundle(malformed));
        }
        const bad = path.join(f.directory, 'bad.json');
        const authority = await readFile(f.target.stateFile);
        await writeFile(bad, Buffer.from([0xff]));
        await assert.rejects(api.importLedgers(f.target, 0, { input: bad, mode: 'copy' }), /UTF-8/i);
        assert.deepEqual(await readFile(f.target.stateFile), authority);
        await assert.rejects(api.importLedgers(f.target, 0, { input: f.output, mode: 'resume' }), /declaration/i);
        const imported = await api.importLedgers(f.target, 0, {
            input: f.output,
            mode: 'resume',
            singleAuthority: true,
        });
        const after = await readFile(f.target.stateFile);
        await writeFile(f.output, Buffer.concat([original, Buffer.from(' ')]));
        await assert.rejects(
            api.importLedgers(f.target, imported.stateVersion, {
                input: f.output,
                mode: 'resume',
                singleAuthority: true,
            }),
            /conflict/i,
        );
        assert.deepEqual(await readFile(f.target.stateFile), after);
    } finally {
        await f.dispose();
    }
});

test('bundle exact 16MiB UTF-8 bound is independent of input bound, and oversize never freezes authority', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output: f.output });
        const original = await readFile(f.output);
        await writeFile(f.output, Buffer.concat([original, Buffer.alloc(BUNDLE_BYTES - original.length, 0x20)]));
        await api.importLedgers(f.target, 0, { input: f.output, mode: 'copy' });
        const before = await readFile(f.target.stateFile);
        await writeFile(f.output, Buffer.concat([original, Buffer.alloc(BUNDLE_BYTES + 1 - original.length, 0x20)]));
        await assert.rejects(api.importLedgers(f.target, 1, { input: f.output, mode: 'copy' }), /budget|limit|size/i);
        assert.deepEqual(await readFile(f.target.stateFile), before);
        const bundle = parseTransferBundle(JSON.parse(original.toString('utf8')));
        const largeLedger = bundle.ledgers[0];
        assert.ok(largeLedger);
        largeLedger.note = '字'.repeat(Math.ceil(STATE_BYTES / 3));
        // Invalid payload also refuses encoding; a correctly recomputed public digest cannot bypass byte budget.
        const { digest } = await import('../src/runtime-support.ts');
        bundle.payloadDigest = digest({ ledgers: bundle.ledgers, preparations: bundle.preparations });
        assert.throws(() => encodeTransferBundle(bundle), /budget/i);
    } finally {
        await f.dispose();
    }
});

test('removal compares notes and history rather than only revision; pruning leaves unfinished bytes intact', async () => {
    const api = await transfer();
    const f = await fixture();
    try {
        await api.exportLedgers(f.source, 1, { ledgerIds: [f.id], output: f.output });
        const state = await readState(f.source);
        const changedLedger = state.ledgers[0];
        assert.ok(changedLedger);
        changedLedger.note = 'changed outside cooperating writers';
        await writeFile(f.source.stateFile, JSON.stringify(state));
        assert.equal((await api.checkRemoval(f.source)).safe, false);
        let target = await transactState(f.target, 0, (draft) => {
            createLedger(draft, { select: true, note: 'retain active' });
        });
        const active = structuredClone(target.ledgers[0]);
        const terminalId = randomUUID();
        target = await transactState(f.target, target.stateVersion, (draft) => {
            createLedger(draft, { ledgerId: terminalId });
        });
        target = await transactState(f.target, target.stateVersion, (draft) => {
            abandonLedger(draft, terminalId);
        });
        const current = structuredClone(target.current);
        await api.pruneLedgers(f.target, target.stateVersion, { ledgerIds: [terminalId] });
        target = await readState(f.target);
        assert.deepEqual(target.ledgers, [active]);
        assert.deepEqual(target.current, current);
        assert.deepEqual(target.preparations, []);
    } finally {
        await f.dispose();
    }
});

test('transfer CLI enforces explicit selections, declarations and mutation versions and reports unsafe exit status', async () => {
    const f = await fixture();
    try {
        for (const command of ['export', 'import', 'rebind', 'prune'])
            assert.throws(() => parseLedgerArguments([command]), /version/i);
        assert.throws(() => parseLedgerArguments(['check-removal', '--expect-version', '1']), /flag/i);
        assert.throws(() => parseLedgerArguments(['rebind', '--expect-version', '1', '--context', 'ignored']), /flag/i);
        const sourceArgs = ['--worktree', f.source.locator.worktree];
        const targetArgs = ['--worktree', f.target.locator.worktree];
        let removal = await runLedger(['check-removal', ...sourceArgs]);
        assert.ok('safe' in removal);
        assert.equal(removal.safe, false);
        assert.equal(removal.exitCode, 1);
        const selection = path.join(f.directory, 'selection.json');
        await writeFile(selection, JSON.stringify({ ledgerIds: [f.id] }));
        const exported = await runLedger([
            'export',
            ...sourceArgs,
            '--expect-version',
            '1',
            '--input',
            selection,
            '--output',
            f.output,
        ]);
        assert.ok('transferId' in exported);
        removal = await runLedger(['check-removal', ...sourceArgs]);
        assert.ok('safe' in removal);
        assert.equal(removal.safe, true);
        assert.equal(removal.exitCode, 0);
        await assert.rejects(
            runLedger(['import', ...targetArgs, '--expect-version', '0', '--input', f.output, '--mode', 'resume']),
            /declaration/i,
        );
        const imported = await runLedger([
            'import',
            ...targetArgs,
            '--expect-version',
            '0',
            '--input',
            f.output,
            '--mode',
            'resume',
            '--single-authority',
        ]);
        assert.ok('ledgerIds' in imported);
        assert.deepEqual(imported.ledgerIds, [f.id]);
        const abandoned = await runLedger([
            'abandon',
            ...targetArgs,
            '--expect-version',
            String(imported.stateVersion),
            '--ledger',
            f.id,
        ]);
        const pruned = await runLedger([
            'prune',
            ...targetArgs,
            '--expect-version',
            String(abandoned.stateVersion),
            '--input',
            selection,
        ]);
        assert.ok('ledgers' in pruned);
        assert.deepEqual(pruned.ledgers, []);
        await assert.rejects(
            runLedger([
                'rebind',
                ...targetArgs,
                '--expect-version',
                String(pruned.stateVersion),
                '--context-id',
                pruned.contextId,
            ]),
            /declaration/i,
        );
        const rebound = await runLedger([
            'rebind',
            ...targetArgs,
            '--expect-version',
            String(pruned.stateVersion),
            '--context-id',
            pruned.contextId,
            '--moved-original',
        ]);
        assert.equal(rebound.stateVersion, pruned.stateVersion + 1);
    } finally {
        await f.dispose();
    }
});
