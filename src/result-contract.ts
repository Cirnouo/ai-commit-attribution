import { INPUT_BYTES, object } from './input-contract.ts';
import type { Decision } from './policy-contract.ts';
import {
    checkRaw,
    InputError,
    identityKey,
    type Ledger,
    type Operation,
    parseIdentity,
    parseOperationShape,
    text,
} from './records.ts';
import { byteDigest, digest } from './runtime-support.ts';

export type ResultPlan = {
    schemaVersion: 1;
    form: 'create' | 'replace';
    expectedParents: string[];
    replacementTarget?: string;
    sourceTargets: { role: string; objectId: string }[];
};
export type PreparedReceipt = {
    schemaVersion: 1;
    artifact: 'prepared-receipt';
    preparationId: string;
    sourceContextId: string;
    ledgerId: string;
    revision: number;
    ledger: Ledger;
    decision: Decision;
    resultPlan: ResultPlan;
    observedHead: string | null;
    objectFormat: 'sha1' | 'sha256';
    indexManifestSha256: string;
    expectedTree: string;
    candidate: { encoding: 'base64'; bytes: string; byteLength: number; sha256: string };
};
function invalid(): never {
    throw new InputError('Invalid portable result contract.');
}
function uuid(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) invalid();
    return value;
}
export function fullObjectId(value: unknown, width?: number): string {
    if (
        typeof value !== 'string' ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ||
        /^0+$/.test(value) ||
        (width !== undefined && value.length !== width)
    )
        invalid();
    return value;
}
function sha256(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid();
    return value;
}
export function parseResultPlan(value: unknown, operation?: Operation): ResultPlan {
    checkRaw(value);
    const data = object(value, ['schemaVersion', 'form', 'expectedParents', 'replacementTarget', 'sourceTargets']);
    if (
        data.schemaVersion !== 1 ||
        !['create', 'replace'].includes(data.form as string) ||
        !Array.isArray(data.expectedParents) ||
        !Array.isArray(data.sourceTargets)
    )
        invalid();
    const expectedParents = data.expectedParents.map((item) => fullObjectId(item));
    const replacementTarget = data.form === 'replace' ? fullObjectId(data.replacementTarget) : undefined;
    if (data.form === 'create' && Object.hasOwn(data, 'replacementTarget')) invalid();
    const sourceTargets = data.sourceTargets.map((item) => {
        const source = object(item, ['role', 'objectId']);
        const role = text(source.role);
        if (role !== source.role) invalid();
        return { role, objectId: fullObjectId(source.objectId) };
    });
    if (new Set(sourceTargets.map((source) => source.role)).size !== sourceTargets.length) invalid();
    const ids = [
        ...expectedParents,
        ...sourceTargets.map((source) => source.objectId),
        ...(replacementTarget ? [replacementTarget] : []),
    ];
    if (ids.some((id) => id.length !== ids[0]?.length)) invalid();
    if (
        operation &&
        (sourceTargets.length !== operation.targets.length ||
            sourceTargets.some(
                (source) =>
                    !operation.targets.some(
                        (target) => source.role === target.role && source.objectId === target.objectId,
                    ),
            ))
    )
        invalid();
    return {
        schemaVersion: 1,
        form: data.form as ResultPlan['form'],
        expectedParents,
        ...(replacementTarget ? { replacementTarget } : {}),
        sourceTargets,
    };
}

/** Historical shape only. This performs no filesystem reads and grants no new-action authority. */
export function parsePreparedReceipt(value: unknown): PreparedReceipt {
    const data = object(value, [
        'schemaVersion',
        'artifact',
        'preparationId',
        'sourceContextId',
        'ledgerId',
        'revision',
        'ledger',
        'decision',
        'resultPlan',
        'observedHead',
        'objectFormat',
        'indexManifestSha256',
        'expectedTree',
        'candidate',
    ]);
    if (
        data.schemaVersion !== 1 ||
        data.artifact !== 'prepared-receipt' ||
        !Number.isSafeInteger(data.revision) ||
        (data.revision as number) <= 0
    )
        invalid();
    const ledgerId = uuid(data.ledgerId);
    const rawLedger = object(data.ledger, ['schemaVersion', 'ledgerId', 'operation', 'identities', 'blockers']);
    checkRaw(rawLedger);
    if (
        rawLedger.schemaVersion !== 2 ||
        uuid(rawLedger.ledgerId) !== ledgerId ||
        !Array.isArray(rawLedger.identities) ||
        !Array.isArray(rawLedger.blockers)
    )
        invalid();
    const operation = parseOperationShape(rawLedger.operation);
    const blockers = rawLedger.blockers.map((item) => {
        const blocker = object(item, ['id', 'reason']);
        text(blocker.id);
        const id = blocker.id as string;
        return { id, reason: text(blocker.reason) };
    });
    if (new Set(blockers.map((blocker) => blocker.id)).size !== blockers.length) invalid();
    const identities = rawLedger.identities.map(parseIdentity);
    if (new Set(identities.map(identityKey)).size !== identities.length) invalid();
    const ledger: Ledger = {
        schemaVersion: 2,
        ledgerId,
        operation,
        identities,
        blockers,
    };
    const rawDecision = object(data.decision, [
        'schemaVersion',
        'artifact',
        'operation',
        'branch',
        'rationale',
        'decisionSource',
    ]);
    checkRaw(rawDecision);
    const source = object(rawDecision.decisionSource, ['kind', 'reference']);
    if (
        rawDecision.schemaVersion !== 2 ||
        rawDecision.artifact !== 'policy-decision' ||
        !['repository-policy', 'skill-default'].includes(rawDecision.branch as string) ||
        source.kind !== 'agent-semantic'
    )
        invalid();
    const decisionOperation = parseOperationShape(rawDecision.operation);
    if (digest(operation) !== digest(decisionOperation)) invalid();
    const decision: Decision = {
        schemaVersion: 2,
        artifact: 'policy-decision',
        operation: decisionOperation,
        branch: rawDecision.branch as Decision['branch'],
        rationale: text(rawDecision.rationale),
        decisionSource: { kind: 'agent-semantic', reference: text(source.reference) },
    };
    if (data.objectFormat !== 'sha1' && data.objectFormat !== 'sha256') invalid();
    const width = data.objectFormat === 'sha1' ? 40 : 64;
    const resultPlan = parseResultPlan(data.resultPlan, operation);
    const observedHead = data.observedHead === null ? null : fullObjectId(data.observedHead, width);
    for (const id of [
        ...resultPlan.expectedParents,
        ...resultPlan.sourceTargets.map((target) => target.objectId),
        ...(resultPlan.replacementTarget ? [resultPlan.replacementTarget] : []),
    ])
        fullObjectId(id, width);
    if (
        resultPlan.form === 'create'
            ? observedHead === null
                ? resultPlan.expectedParents.length !== 0
                : resultPlan.expectedParents[0] !== observedHead
            : observedHead === null || resultPlan.replacementTarget !== observedHead
    )
        invalid();
    const candidate = object(data.candidate, ['encoding', 'bytes', 'byteLength', 'sha256']);
    if (
        candidate.encoding !== 'base64' ||
        typeof candidate.bytes !== 'string' ||
        candidate.bytes.length > Math.ceil(INPUT_BYTES / 3) * 4 ||
        !Number.isSafeInteger(candidate.byteLength) ||
        (candidate.byteLength as number) < 0 ||
        (candidate.byteLength as number) > INPUT_BYTES
    )
        invalid();
    const bytes = Buffer.from(candidate.bytes, 'base64');
    if (
        bytes.toString('base64') !== candidate.bytes ||
        bytes.length !== candidate.byteLength ||
        byteDigest(bytes) !== sha256(candidate.sha256)
    )
        invalid();
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        invalid();
    }
    return {
        schemaVersion: 1,
        artifact: 'prepared-receipt',
        preparationId: uuid(data.preparationId),
        sourceContextId: uuid(data.sourceContextId),
        ledgerId,
        revision: data.revision as number,
        ledger,
        decision,
        resultPlan,
        observedHead,
        objectFormat: data.objectFormat,
        indexManifestSha256: sha256(data.indexManifestSha256),
        expectedTree: fullObjectId(data.expectedTree, width),
        candidate: {
            encoding: 'base64',
            bytes: candidate.bytes,
            byteLength: bytes.length,
            sha256: candidate.sha256 as string,
        },
    };
}
