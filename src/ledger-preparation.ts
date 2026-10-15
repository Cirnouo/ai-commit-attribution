import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegularFile } from '../tooling/file-evidence.ts';
import { INPUT_BYTES } from './input-contract.ts';
import { reviseLedger, selectedLedgerSnapshot } from './ledger.ts';
import { integer, type PlannedLedger, uuid, type WorktreeState } from './ledger-contract.ts';
import { type LedgerContext, readState, type StateIO, transactState } from './ledger-store.ts';
import { processMessage } from './message.ts';
import type { MessageResult } from './message-contract.ts';
import { writeNewMessage } from './message-output.ts';
import { checkRouting, parseDecision } from './policy.ts';
import { InputError, type Ledger, parseRegistry, type Registry } from './records.ts';
import { fullObjectId, type PreparedReceipt, parsePreparedReceipt, parseResultPlan } from './result-contract.ts';
import { observePreparation, observeResult } from './result-git.ts';
import { parseResultReview, parseSealedResult, type SealedResult } from './result-review.ts';
import { byteDigest, digest } from './runtime-support.ts';
import { inside } from './safe-git.ts';
export type PreparationResult = {
    artifact: 'ledger-preparation' | 'ledger-finish';
    status: 'needs-decision' | 'blocked' | 'prepared' | 'candidate-unprepared' | 'sealed';
    exitCode: number;
    ledgerId: string;
    preparationId?: string;
    outputPath?: string;
    stateVersion?: number;
    messageResult?: MessageResult;
    sealedResult?: SealedResult;
    idempotent?: boolean;
    detail?: string;
};
export type PrepareOptions = {
    ledgerId: string;
    operation: unknown;
    decision: unknown;
    resultPlan: unknown;
    messageBuffer: Buffer;
    output: string;
    assessment?: unknown;
    consumedPaths?: readonly string[];
    /** File-backed lazy loaders append every consumed path before reading it; in-memory inputs append nothing. */
    loadRegistry?: (consumedPaths: string[]) => Promise<Registry>;
    loadAssessment?: (consumedPaths: string[]) => Promise<unknown>;
};
export type FinishOptions = {
    ledgerId: string;
    preparationId: string;
    sha: string;
    review: unknown;
    assessment?: unknown;
    loadAssessment?: (consumedPaths: string[]) => Promise<unknown>;
};
/** Fault seams stop immediately before the bounded state transaction, never execute JSON actions. */
export type PreparationHooks = {
    stateIO?: StateIO;
    beforePrepareTransaction?: () => Promise<void>;
    beforeFinishTransaction?: () => Promise<void>;
};
async function defaultRegistry(consumedPaths: string[]): Promise<Registry> {
    const registryFile = fileURLToPath(new URL('../references/agent-registry.json', import.meta.url));
    consumedPaths.push(registryFile);
    const bytes = await readRegularFile(registryFile, {
        physicalPath: true,
        singleLink: true,
        maximumBytes: INPUT_BYTES,
    });
    try {
        return parseRegistry(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch {
        throw new InputError('Default registry must be valid bounded UTF-8 JSON.');
    }
}
function ledgerIn(state: WorktreeState, id: string): PlannedLedger {
    const ledger = state.ledgers.find((item) => item.ledgerId === uuid(id));
    if (!ledger || ledger.contextId !== state.contextId || ledger.ownership.kind !== 'local')
        throw new InputError('Preparation requires an existing locally owned ledger.');
    return ledger;
}
function unchanged(initial: WorktreeState, draft: WorktreeState): void {
    if (digest(initial) !== digest(draft)) throw new InputError('Frozen lifecycle state changed during observation.');
}
function boundReview(state: WorktreeState, options: FinishOptions) {
    const review = parseResultReview(options.review);
    if (
        review.contextId !== state.contextId ||
        review.ledgerId !== options.ledgerId ||
        review.preparationId !== options.preparationId ||
        review.sha !== options.sha
    )
        throw new InputError('Final review must bind this current context, ledger, preparation and exact SHA.');
    return review;
}
/** Render and observe without Git mutations; publish first, freeze only after complete readback. */
export async function prepareLedger(
    context: LedgerContext,
    expectedStateVersion: number,
    options: PrepareOptions,
    hooks: PreparationHooks = {},
): Promise<PreparationResult> {
    integer(expectedStateVersion);
    const ledgerId = uuid(options.ledgerId);
    const decision = await parseDecision(options.decision);
    const route = await checkRouting({ operation: options.operation, decision });
    const base = { artifact: 'ledger-preparation' as const, ledgerId };
    if (route.branch === 'needs-decision') return { ...base, status: 'needs-decision', exitCode: 20 };
    const message = Buffer.from(options.messageBuffer);
    const plan = parseResultPlan(options.resultPlan, route.operation);
    const consumedPaths = [context.stateFile, ...(options.consumedPaths ?? [])];
    if (route.operation.id === ledgerId)
        throw new InputError('Operation ID must be distinct from the stable ledger ID.');
    const initial = await readState(context);
    if (initial.stateVersion !== expectedStateVersion) throw new InputError('Ledger state version is stale.');
    const historical = [
        ...initial.preparations,
        ...initial.ledgers.flatMap((item) =>
            item.origin ? [item.origin, ...item.origin.history].flatMap((origin) => origin.preparations) : [],
        ),
    ];
    if (
        historical.some(
            (receipt) =>
                receipt.ledger.operation.id === route.operation.id &&
                digest(receipt.ledger.operation) !== digest(route.operation),
        )
    )
        throw new InputError(
            'Operation ID was already bound to a different normalized scope; supply a new operation ID.',
        );
    const planned = ledgerIn(initial, ledgerId);
    if (planned.state !== 'open' || initial.current?.ledgerId !== ledgerId || initial.current.paused)
        throw new InputError('Prepare requires the exact active current open ledger.');
    const snapshot = selectedLedgerSnapshot(initial, route.operation, ledgerId, true);
    let frozenLedger: Ledger = snapshot;
    const rendered = await processMessage(
        { mode: 'render', message, operation: route.operation, decision },
        async () => ({
            ledger: snapshot,
            registry: await (options.loadRegistry ?? defaultRegistry)(consumedPaths),
            assessment: options.loadAssessment ? await options.loadAssessment(consumedPaths) : options.assessment,
        }),
    );
    if (![0, 10].includes(rendered.exitCode))
        return { ...base, status: 'blocked', exitCode: rendered.exitCode, messageResult: rendered };
    if (route.branch === 'skill-default') {
        const tuples = rendered.participationEvidence.summary?.tuples;
        if (!tuples) throw new InputError('Default preparation lacks a complete finite identity summary.');
        frozenLedger = { ...snapshot, identities: tuples };
    }
    const observation = await observePreparation(route.operation, plan);
    if (rendered.message.preview === undefined) throw new InputError('Preparation candidate is unavailable.');
    const candidate = Buffer.from(rendered.message.preview);
    const preparationId = randomUUID();
    const receipt = parsePreparedReceipt({
        schemaVersion: 1,
        artifact: 'prepared-receipt',
        preparationId,
        sourceContextId: initial.contextId,
        ledgerId,
        revision: integer(planned.revision + 1, 1),
        ledger: frozenLedger,
        decision,
        resultPlan: plan,
        ...observation,
        candidate: {
            encoding: 'base64',
            bytes: candidate.toString('base64'),
            byteLength: candidate.length,
            sha256: byteDigest(candidate),
        },
    });
    if (inside(context.stateDirectory, path.resolve(options.output)))
        throw new InputError('Candidate output may not enter the owned state directory.');
    const outputPath = await writeNewMessage(options.output, candidate, context.locator, consumedPaths);
    try {
        await hooks.beforePrepareTransaction?.();
        const state = await transactState(
            context,
            expectedStateVersion,
            (draft) => {
                unchanged(initial, draft);
                const current = ledgerIn(draft, ledgerId);
                reviseLedger(current);
                current.identities = structuredClone(frozenLedger.identities);
                current.state = 'prepared';
                current.currentPreparationId = preparationId;
                draft.preparations.push(receipt);
            },
            hooks.stateIO,
        );
        return {
            ...base,
            status: 'prepared',
            exitCode: route.exitCode,
            preparationId,
            outputPath,
            stateVersion: state.stateVersion,
            messageResult: rendered,
        };
    } catch {
        return {
            ...base,
            status: 'candidate-unprepared',
            exitCode: 2,
            outputPath,
            detail: 'Candidate was published, but preparation persistence failed. Preserve the candidate and inspect ledger status before recovery.',
        };
    }
}
function equivalent(candidate: Buffer, actual: Buffer): boolean {
    const normalize = (bytes: Buffer) =>
        new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\r\n', '\n').replace(/\n$/, '');
    try {
        return normalize(candidate) === normalize(actual);
    } catch {
        return false;
    }
}
function frozenRegistry(receipt: PreparedReceipt): Registry {
    return {
        schemaVersion: 1,
        hosts: [...new Set(receipt.ledger.identities.map((item) => item.agent))].map((name) => ({
            name,
            aliases: [],
            family: 'frozen-identity',
        })),
        ambiguousAliases: [],
        familyAliases: {},
    };
}
/** Read only an explicitly declared result; historical receipt paths never grant Git action authority. */
export async function finishLedger(
    context: LedgerContext,
    expectedStateVersion: number,
    options: FinishOptions,
    hooks: PreparationHooks = {},
): Promise<PreparationResult> {
    integer(expectedStateVersion);
    const ledgerId = uuid(options.ledgerId),
        preparationId = uuid(options.preparationId);
    fullObjectId(options.sha);
    const initial = await readState(context),
        planned = ledgerIn(initial, ledgerId);
    const review = boundReview(initial, options);
    const base = { artifact: 'ledger-finish' as const, ledgerId, preparationId };
    if (planned.state === 'sealed') {
        const stored = planned.sealedResult;
        if (
            !stored ||
            stored.preparationId !== preparationId ||
            stored.sha !== options.sha ||
            stored.messageSha256 !== review.messageSha256
        )
            throw new InputError(
                'Sealed result is immutable; retry must name the same preparation, SHA and message hash.',
            );
        return {
            ...base,
            status: 'sealed',
            exitCode: stored.checks.participation === 'repository-rule-declaration' ? 10 : 0,
            sealedResult: stored,
            stateVersion: initial.stateVersion,
            idempotent: true,
        };
    }
    if (initial.stateVersion !== expectedStateVersion) throw new InputError('Ledger state version is stale.');
    const receipt = initial.preparations.find((item) => item.preparationId === preparationId);
    if (
        planned.state !== 'prepared' ||
        planned.currentPreparationId !== preparationId ||
        !receipt ||
        receipt.ledgerId !== ledgerId ||
        receipt.revision !== planned.revision ||
        digest(receipt.ledger.identities) !== digest(planned.identities) ||
        digest(receipt.ledger.blockers) !== digest(planned.blockers)
    )
        throw new InputError('Finish requires the exact current preparation and frozen ledger revision/set.');
    if (
        [
            receipt.observedHead,
            receipt.resultPlan.replacementTarget,
            ...receipt.resultPlan.sourceTargets.map((item) => item.objectId),
        ].includes(options.sha)
    )
        throw new InputError(
            'Result is an obviously preexisting source or observed HEAD; an actual newly created result is required.',
        );
    const actual = await observeResult(context.locator.worktree, options.sha);
    if (actual.messageSha256 !== review.messageSha256)
        throw new InputError('Final review message digest differs from the actual commit.');
    if (
        actual.objectFormat !== receipt.objectFormat ||
        actual.tree !== receipt.expectedTree ||
        actual.indexManifestSha256 !== receipt.indexManifestSha256 ||
        digest(actual.parents) !== digest(receipt.resultPlan.expectedParents)
    )
        throw new InputError(
            'Actual result parents, tree, manifest or object format differ from the frozen preparation.',
        );
    const sameMessage = equivalent(Buffer.from(receipt.candidate.bytes, 'base64'), actual.message);
    if (!sameMessage && review.acceptMessageChange !== true)
        return {
            ...base,
            status: 'prepared',
            exitCode: 20,
            detail: 'Final message changed; supply a fresh exact-result review accepting this actual message.',
        };
    let messageResult: MessageResult | undefined;
    const repository = receipt.decision.branch === 'repository-policy';
    if (repository) {
        if (review.repositoryPolicyChecked !== true)
            return {
                ...base,
                status: 'prepared',
                exitCode: 20,
                detail: 'Repository policy requires a fresh exact-result repositoryPolicyChecked declaration.',
            };
    } else {
        // A temporary physical validation view retains historical semantic scope and grants no Git action.
        const operation = {
            ...receipt.ledger.operation,
            repository: context.locator.worktree,
            worktree: context.locator.worktree,
            commonGitDir: context.locator.commonGitDir,
        };
        messageResult = await processMessage(
            { mode: 'validate', message: actual.message, operation, decision: { ...receipt.decision, operation } },
            async () => ({
                ledger: { ...receipt.ledger, operation },
                registry: frozenRegistry(receipt),
                assessment: options.loadAssessment ? await options.loadAssessment([]) : options.assessment,
            }),
        );
        if (messageResult.exitCode !== 0)
            return { ...base, status: 'prepared', exitCode: messageResult.exitCode, messageResult };
    }
    const sealedResult = parseSealedResult({
        preparationId,
        sha: actual.sha,
        messageSha256: actual.messageSha256,
        review,
        checks: {
            parents: true,
            tree: true,
            message: sameMessage ? 'candidate-equivalent' : 'explicit-final-review',
            participation: repository ? 'repository-rule-declaration' : 'frozen-default-check',
        },
    });
    try {
        await hooks.beforeFinishTransaction?.();
        const state = await transactState(
            context,
            expectedStateVersion,
            (draft) => {
                unchanged(initial, draft);
                const current = ledgerIn(draft, ledgerId);
                reviseLedger(current);
                current.state = 'sealed';
                current.currentPreparationId = null;
                current.sealedResult = sealedResult;
                if (draft.current?.ledgerId === ledgerId) draft.current = null;
            },
            hooks.stateIO,
        );
        return {
            ...base,
            status: 'sealed',
            exitCode: repository ? 10 : 0,
            sealedResult,
            stateVersion: state.stateVersion,
            ...(messageResult ? { messageResult } : {}),
        };
    } catch {
        return {
            ...base,
            status: 'prepared',
            exitCode: 2,
            detail: 'Result was observed, but sealing persistence failed. Inspect ledger status and retry the same preparation and exact SHA.',
        };
    }
}
