import path from 'node:path';
import { isRecord } from '../tooling/errors.ts';
import {
    type Blocker,
    type ConfirmedIdentity,
    checkRaw,
    InputError,
    identityKey,
    ordinal,
    parseIdentity,
    text,
} from './records.ts';
import { type PreparedReceipt, parsePreparedReceipt } from './result-contract.ts';
import { parseSealedResult, type SealedResult } from './result-review.ts';
import { digest } from './runtime-support.ts';

/** Independent from explicit input/message limits: the complete persisted state counts. */
export const STATE_BYTES = 16 * 1024 * 1024;
export type ContextLocator = { worktree: string; gitDirectory: string; commonGitDir: string };
export type Ownership = { kind: 'local' } | { kind: 'exporting' | 'exported'; transferId: string };
export type LedgerOriginEntry = {
    transferId: string;
    sourceContextId: string;
    ledgerId: string;
    revision: number;
    preparations: PreparedReceipt[];
    source: Omit<PlannedLedger, 'origin'>;
};
export type LedgerOrigin = LedgerOriginEntry & { history: LedgerOriginEntry[] };
export type PlannedLedger = {
    ledgerId: string;
    contextId: string;
    revision: number;
    state: 'open' | 'prepared' | 'sealed' | 'abandoned';
    ownership: Ownership;
    identities: ConfirmedIdentity[];
    blockers: Blocker[];
    currentPreparationId: string | null;
    predecessorIds: string[];
    successorIds: string[];
    note?: string;
    work?: string;
    origin?: LedgerOrigin;
    sealedResult?: SealedResult;
};
export type TransferReceipt = {
    transferId: string;
    phase: 'exporting' | 'exported';
    sourceContextId: string;
    locator: ContextLocator;
    ledgerIds: string[];
    preparationIds: string[];
    current: WorktreeState['current'];
    payloadDigest: string;
    bundleDigest: string;
    output: string;
};
export type ImportReceipt = {
    transferId: string;
    bundleDigest: string;
    sourceContextId: string;
    mode: 'resume' | 'copy';
    mapping: { sourceId: string; targetId: string }[];
    preparationIds: string[];
};
export type WorktreeState = {
    schemaVersion: 1;
    contextId: string;
    locator: ContextLocator;
    stateVersion: number;
    current: { ledgerId: string; paused: boolean } | null;
    ledgers: PlannedLedger[];
    preparations: PreparedReceipt[];
    transfers: TransferReceipt[];
    imports: ImportReceipt[];
};
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
        throw new InputError('Invalid ledger state: unexpected object shape.');
    return value;
}
export function uuid(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))
        throw new InputError('Invalid ledger state: UUID must have canonical lowercase spelling.');
    return value;
}
export function integer(value: unknown, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
        throw new InputError('Invalid ledger state: version/revision must be a bounded safe integer.');
    return value;
}
export function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
    if (!Array.isArray(value)) throw new InputError('Invalid ledger state: expected array.');
    return value.map(parse);
}
export function distinct(values: readonly string[]): void {
    if (new Set(values).size !== values.length) throw new InputError('Invalid ledger state: duplicate key/reference.');
}
export function parseBlocker(value: unknown): Blocker {
    checkRaw(value);
    const data = object(value, ['id', 'reason']);
    if (typeof data.id !== 'string' || !data.id.trim())
        throw new InputError('Invalid ledger state: blocker ID is empty.');
    return { id: data.id, reason: text(data.reason) };
}
export function parseLocator(value: unknown): ContextLocator {
    const data = object(value, ['worktree', 'gitDirectory', 'commonGitDir']);
    const directory = (value: unknown) => {
        if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value)
            throw new InputError('Invalid ledger state: locator must be a normalized absolute path.');
        return value;
    };
    return {
        worktree: directory(data.worktree),
        gitDirectory: directory(data.gitDirectory),
        commonGitDir: directory(data.commonGitDir),
    };
}
export function parsePlannedLedger(value: unknown): PlannedLedger {
    const data = object(value, [
        'ledgerId',
        'contextId',
        'revision',
        'state',
        'ownership',
        'identities',
        'blockers',
        'currentPreparationId',
        'predecessorIds',
        'successorIds',
        'note',
        'work',
        'origin',
        'sealedResult',
    ]);
    if (!['open', 'prepared', 'sealed', 'abandoned'].includes(String(data.state)))
        throw new InputError('Invalid ledger state: lifecycle.');
    const owner = object(data.ownership, ['kind', 'transferId']);
    let ownership: Ownership;
    if (owner.kind === 'local' && owner.transferId === undefined) ownership = { kind: 'local' };
    else if (owner.kind === 'exporting' || owner.kind === 'exported')
        ownership = { kind: owner.kind, transferId: uuid(owner.transferId) };
    else throw new InputError('Invalid ledger state: ownership.');
    const identities = array(data.identities, parseIdentity);
    distinct(identities.map(identityKey));
    const blockers = array(data.blockers, parseBlocker);
    distinct(blockers.map((item) => item.id));
    const predecessorIds = array(data.predecessorIds, uuid);
    const successorIds = array(data.successorIds, uuid);
    distinct(predecessorIds);
    distinct(successorIds);
    return {
        ledgerId: uuid(data.ledgerId),
        contextId: uuid(data.contextId),
        revision: integer(data.revision, 1),
        state: data.state as PlannedLedger['state'],
        ownership,
        identities,
        blockers,
        currentPreparationId: data.currentPreparationId === null ? null : uuid(data.currentPreparationId),
        predecessorIds,
        successorIds,
        ...(data.note === undefined ? {} : { note: text(data.note) }),
        ...(data.work === undefined ? {} : { work: text(data.work) }),
        ...(data.origin === undefined ? {} : { origin: parseOrigin(data.origin) }),
        ...(data.sealedResult === undefined ? {} : { sealedResult: parseSealedResult(data.sealedResult) }),
    };
}
export function parsePreparations(value: unknown): PreparedReceipt[] {
    const receipts = array(value, parsePreparedReceipt);
    for (const receipt of receipts) {
        uuid(receipt.preparationId);
        uuid(receipt.sourceContextId);
        uuid(receipt.ledgerId);
        distinct(receipt.ledger.identities.map(identityKey));
    }
    distinct(receipts.map((item) => item.preparationId));
    return receipts;
}
function parseOriginEntry(value: unknown): LedgerOriginEntry {
    const data = object(value, ['transferId', 'sourceContextId', 'ledgerId', 'revision', 'preparations', 'source']);
    const receipts = parsePreparations(data.preparations);
    const ledgerId = uuid(data.ledgerId);
    const revision = integer(data.revision, 1);
    if (receipts.some((receipt) => receipt.ledgerId !== ledgerId || receipt.revision > revision))
        throw new InputError('Invalid ledger origin preparation history.');
    if (isRecord(data.source) && Object.hasOwn(data.source, 'origin'))
        throw new InputError('Origin source history must be flattened.');
    const source = parsePlannedLedger(data.source);
    validateSealedJoin(source, receipts);
    if ((source.state === 'prepared') !== (source.currentPreparationId !== null))
        throw new InputError('Origin source preparation lifecycle mismatch.');
    if (source.ledgerId !== ledgerId || source.revision !== revision || source.contextId !== data.sourceContextId)
        throw new InputError('Origin source snapshot does not match mapping.');
    if (source.currentPreparationId !== null) {
        const receipt = receipts.find((item) => item.preparationId === source.currentPreparationId);
        if (
            !receipt ||
            receipt.revision !== revision ||
            digest(receipt.ledger.identities) !== digest(source.identities) ||
            digest(receipt.ledger.blockers) !== digest(source.blockers)
        )
            throw new InputError('Origin current preparation snapshot mismatch.');
    }
    return {
        transferId: uuid(data.transferId),
        sourceContextId: uuid(data.sourceContextId),
        ledgerId,
        revision,
        preparations: receipts,
        source,
    };
}
function parseOrigin(value: unknown): LedgerOrigin {
    const data = object(value, [
        'transferId',
        'sourceContextId',
        'ledgerId',
        'revision',
        'preparations',
        'source',
        'history',
    ]);
    const { history, ...entry } = data;
    return { ...parseOriginEntry(entry), history: array(history, parseOriginEntry) };
}
export function sha256(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new InputError('Invalid ledger digest.');
    return value;
}
/** Historical locators are shape-only and may name a different supported host. */
export function parsePortableLocator(value: unknown): ContextLocator {
    const data = object(value, ['worktree', 'gitDirectory', 'commonGitDir']);
    const directory = (value: unknown): string => {
        checkRaw(value);
        if (
            typeof value !== 'string' ||
            ![path.posix, path.win32].some((host) => host.isAbsolute(value) && host.normalize(value) === value)
        )
            throw new InputError('Invalid portable locator.');
        return value;
    };
    return {
        worktree: directory(data.worktree),
        gitDirectory: directory(data.gitDirectory),
        commonGitDir: directory(data.commonGitDir),
    };
}
export function parseCurrent(value: unknown, ledgers: readonly PlannedLedger[]): WorktreeState['current'] {
    if (value === null) return null;
    const data = object(value, ['ledgerId', 'paused']);
    const ledgerId = uuid(data.ledgerId);
    const ledger = ledgers.find((item) => item.ledgerId === ledgerId);
    if (
        typeof data.paused !== 'boolean' ||
        !ledger ||
        !['open', 'prepared'].includes(ledger.state) ||
        (ledger.ownership.kind !== 'local' && !data.paused)
    )
        throw new InputError('Invalid ledger state: current reference/lifecycle/ownership.');
    return { ledgerId, paused: data.paused };
}
function parseTransfer(value: unknown): TransferReceipt {
    const data = object(value, [
        'transferId',
        'phase',
        'sourceContextId',
        'locator',
        'ledgerIds',
        'preparationIds',
        'current',
        'payloadDigest',
        'bundleDigest',
        'output',
    ]);
    if (data.phase !== 'exporting' && data.phase !== 'exported') throw new InputError('Invalid transfer phase.');
    const ledgerIds = array(data.ledgerIds, uuid);
    const preparationIds = array(data.preparationIds, uuid);
    distinct(ledgerIds);
    distinct(preparationIds);
    if (
        !ledgerIds.length ||
        typeof data.output !== 'string' ||
        !path.isAbsolute(data.output) ||
        path.resolve(data.output) !== data.output
    )
        throw new InputError('Invalid transfer selection/output.');
    let current: WorktreeState['current'] = null;
    if (data.current !== null) {
        const selected = object(data.current, ['ledgerId', 'paused']);
        if (typeof selected.paused !== 'boolean' || !ledgerIds.includes(uuid(selected.ledgerId)))
            throw new InputError('Invalid transfer current reference.');
        current = { ledgerId: selected.ledgerId as string, paused: selected.paused };
    }
    return {
        transferId: uuid(data.transferId),
        phase: data.phase,
        sourceContextId: uuid(data.sourceContextId),
        locator: parsePortableLocator(data.locator),
        ledgerIds,
        preparationIds,
        current,
        payloadDigest: sha256(data.payloadDigest),
        bundleDigest: sha256(data.bundleDigest),
        output: data.output,
    };
}
function parseImport(value: unknown): ImportReceipt {
    const data = object(value, ['transferId', 'bundleDigest', 'sourceContextId', 'mode', 'mapping', 'preparationIds']);
    if (data.mode !== 'resume' && data.mode !== 'copy') throw new InputError('Invalid import mode.');
    const mapping = array(data.mapping, (item) => {
        const pair = object(item, ['sourceId', 'targetId']);
        return { sourceId: uuid(pair.sourceId), targetId: uuid(pair.targetId) };
    });
    if (
        !mapping.length ||
        mapping.some((pair) =>
            data.mode === 'resume' ? pair.sourceId !== pair.targetId : pair.sourceId === pair.targetId,
        )
    )
        throw new InputError('Invalid import mapping.');
    distinct(mapping.map((pair) => pair.sourceId));
    distinct(mapping.map((pair) => pair.targetId));
    const preparationIds = array(data.preparationIds, uuid);
    distinct(preparationIds);
    return {
        transferId: uuid(data.transferId),
        bundleDigest: sha256(data.bundleDigest),
        sourceContextId: uuid(data.sourceContextId),
        mode: data.mode,
        mapping,
        preparationIds,
    };
}
export function validateLedgerJoins(ledgers: readonly PlannedLedger[], receipts: readonly PreparedReceipt[]): void {
    const byId = new Map(ledgers.map((item) => [item.ledgerId, item]));
    for (const receipt of receipts) {
        const ledger = byId.get(receipt.ledgerId);
        if (ledger && receipt.revision > ledger.revision)
            throw new InputError('Historical preparation revision exceeds ledger.');
    }
    for (const ledger of ledgers) {
        validateSealedJoin(ledger, receipts);
        if ((ledger.state === 'prepared') !== (ledger.currentPreparationId !== null))
            throw new InputError('Invalid preparation lifecycle reference.');
        if (ledger.currentPreparationId !== null) {
            const receipt = receipts.find((item) => item.preparationId === ledger.currentPreparationId);
            if (
                !receipt ||
                receipt.ledgerId !== ledger.ledgerId ||
                receipt.revision !== ledger.revision ||
                digest(receipt.ledger.identities) !== digest(ledger.identities) ||
                digest(receipt.ledger.blockers) !== digest(ledger.blockers)
            )
                throw new InputError('Current preparation does not freeze exact ledger revision/set.');
        }
        for (const id of ledger.predecessorIds) {
            if (id === ledger.ledgerId || !byId.get(id)?.successorIds.includes(ledger.ledgerId))
                throw new InputError('Invalid ledger state: predecessor reference.');
        }
        for (const id of ledger.successorIds) {
            if (
                id === ledger.ledgerId ||
                !byId.get(id)?.predecessorIds.includes(ledger.ledgerId) ||
                ledger.state !== 'abandoned'
            )
                throw new InputError('Invalid ledger state: successor reference.');
        }
    }
}
function validateSealedJoin(ledger: PlannedLedger, receipts: readonly PreparedReceipt[]): void {
    if ((ledger.state === 'sealed') !== (ledger.sealedResult !== undefined))
        throw new InputError(
            'Sealed lifecycle requires an explicit sealed result and only sealed records may carry one.',
        );
    if (ledger.sealedResult === undefined) return;
    const result = ledger.sealedResult;
    const receipt = receipts.find((item) => item.preparationId === result.preparationId);
    if (
        ledger.state !== 'sealed' ||
        !receipt ||
        receipt.ledgerId !== ledger.ledgerId ||
        result.review.ledgerId !== ledger.ledgerId ||
        receipt.revision + 1 !== ledger.revision ||
        result.sha.length !== (receipt.objectFormat === 'sha1' ? 40 : 64) ||
        digest(receipt.ledger.identities) !== digest(ledger.identities) ||
        digest(receipt.ledger.blockers) !== digest(ledger.blockers)
    )
        throw new InputError('Sealed result does not join exact historical preparation/ledger.');
    if (
        (receipt.decision.branch === 'repository-policy') !==
        (result.checks.participation === 'repository-rule-declaration')
    )
        throw new InputError('Sealed participation check does not match historical policy route.');
}
/** Ownership and selection are protocol metadata; every portable ledger field remains frozen. */
export function portableLedger(ledger: PlannedLedger): PlannedLedger {
    return { ...structuredClone(ledger), ownership: { kind: 'local' } };
}
export function transferPayload(
    state: WorktreeState,
    receipt: Pick<TransferReceipt, 'ledgerIds' | 'preparationIds'>,
): { ledgers: PlannedLedger[]; preparations: PreparedReceipt[] } {
    const ledgers = receipt.ledgerIds.map((id) => {
        const ledger = state.ledgers.find((item) => item.ledgerId === id);
        if (!ledger) throw new InputError(`Frozen export ledger missing: ${id}`);
        return portableLedger(ledger);
    });
    const selected = receipt.preparationIds.map((id) => {
        const preparation = state.preparations.find((item) => item.preparationId === id);
        if (!preparation) throw new InputError(`Frozen export preparation missing: ${id}`);
        return preparation;
    });
    return { ledgers, preparations: selected };
}
export function parseWorktreeState(value: unknown): WorktreeState {
    checkRaw(value);
    const data = object(value, [
        'schemaVersion',
        'contextId',
        'locator',
        'stateVersion',
        'current',
        'ledgers',
        'preparations',
        'transfers',
        'imports',
    ]);
    if (data.schemaVersion !== 1) throw new InputError('Invalid ledger state: schemaVersion must be 1.');
    const contextId = uuid(data.contextId);
    const ledgers = array(data.ledgers, parsePlannedLedger);
    distinct(ledgers.map((item) => item.ledgerId));
    const byId = new Map(ledgers.map((item) => [item.ledgerId, item]));
    const prepared = parsePreparations(data.preparations);
    const transfers = array(data.transfers, parseTransfer);
    const imports = array(data.imports, parseImport);
    distinct(transfers.map((item) => item.transferId));
    distinct(imports.map((item) => item.transferId));
    validateLedgerJoins(ledgers, prepared);
    for (const ledger of ledgers) {
        if (ledger.contextId !== contextId) throw new InputError('Invalid ledger state: ledger/context mismatch.');
        if (
            ledger.sealedResult &&
            ledger.sealedResult.review.contextId !== contextId &&
            !imports.some(
                (receipt) =>
                    receipt.mode === 'resume' && receipt.mapping.some((pair) => pair.targetId === ledger.ledgerId),
            )
        )
            throw new InputError('Historical sealed result context requires a resume import receipt.');
        if (ledger.ownership.kind !== 'local') {
            const owner = ledger.ownership;
            const transfer = transfers.find((item) => item.transferId === owner.transferId);
            if (!transfer || transfer.phase !== owner.kind || !transfer.ledgerIds.includes(ledger.ledgerId))
                throw new InputError('Invalid ledger transfer ownership reference.');
        }
    }
    for (const receipt of prepared) {
        if (
            receipt.sourceContextId !== contextId &&
            !imports.some(
                (item) =>
                    item.mode === 'resume' &&
                    item.preparationIds.includes(receipt.preparationId) &&
                    item.mapping.some((pair) => pair.targetId === receipt.ledgerId),
            )
        )
            throw new InputError('Preparation source context requires a validated resume import receipt.');
    }
    for (const receipt of imports) {
        if (
            receipt.mode === 'resume' &&
            receipt.preparationIds.some((id) => !prepared.some((item) => item.preparationId === id))
        )
            throw new InputError('Import preparation reference is missing.');
    }
    for (const transfer of transfers) {
        if (transfer.sourceContextId !== contextId) throw new InputError('Transfer source context mismatch.');
        if (transfer.phase === 'exporting') {
            const payload = transferPayload({ ledgers, preparations: prepared } as WorktreeState, transfer);
            if (digest(payload) !== transfer.payloadDigest) throw new InputError('Frozen transfer payload changed.');
            if (
                transfer.ledgerIds.some((id) => {
                    const ledger = byId.get(id);
                    return (
                        ledger &&
                        ['open', 'prepared'].includes(ledger.state) &&
                        (ledger.ownership.kind !== 'exporting' || ledger.ownership.transferId !== transfer.transferId)
                    );
                })
            )
                throw new InputError('Exporting transfer must freeze unfinished ownership.');
        }
    }
    return {
        schemaVersion: 1,
        contextId,
        locator: parseLocator(data.locator),
        stateVersion: integer(data.stateVersion),
        current: parseCurrent(data.current, ledgers),
        ledgers,
        preparations: prepared,
        transfers,
        imports,
    };
}
export function encodeState(state: WorktreeState): Buffer {
    const bytes = Buffer.from(`${JSON.stringify(parseWorktreeState(state), null, 4)}\n`);
    if (bytes.length > STATE_BYTES) throw new InputError('Ledger state byte budget exceeded.');
    return bytes;
}
export const sortBlockers = (values: readonly Blocker[]): Blocker[] => [...values].sort((a, b) => ordinal(a.id, b.id));

/** Single revision owner: selection, pause, ownership and note/work metadata are outside content. */
export function ledgerContent(ledger: PlannedLedger): unknown {
    return {
        identities: ledger.identities,
        blockers: ledger.blockers,
        state: ledger.state,
        currentPreparationId: ledger.currentPreparationId,
        predecessorIds: ledger.predecessorIds,
        successorIds: ledger.successorIds,
        sealedResult: ledger.sealedResult ?? null,
    };
}
export type TransitionMode = 'ordinary' | 'import' | 'prune' | 'rebind';
export function validateStateTransition(
    before: WorktreeState,
    after: WorktreeState,
    mode: TransitionMode = 'ordinary',
): void {
    for (const collection of ['preparations', 'imports'] as const) {
        for (const old of before[collection]) {
            const id =
                collection === 'preparations'
                    ? (old as PreparedReceipt).preparationId
                    : (old as ImportReceipt).transferId;
            const next = after[collection].find((item) =>
                collection === 'preparations'
                    ? (item as PreparedReceipt).preparationId === id
                    : (item as ImportReceipt).transferId === id,
            );
            if (!next || digest(old) !== digest(next))
                throw new InputError('Historical preparation/import receipts are immutable.');
        }
    }
    if (mode !== 'import' && after.imports.length !== before.imports.length)
        throw new InputError('Import receipts require explicit import mode.');
    for (const old of before.transfers) {
        const next = after.transfers.find((item) => item.transferId === old.transferId);
        if (
            !next ||
            digest({ ...old, phase: next.phase }) !== digest(next) ||
            (old.phase === 'exported' && next.phase !== 'exported')
        )
            throw new InputError('Transfer receipt is immutable except final publication phase.');
        if (old.phase === 'exporting' && digest(transferPayload(before, old)) !== digest(transferPayload(after, old)))
            throw new InputError('Export payload is frozen until publication.');
        if (
            old.phase === 'exporting' &&
            digest(before.preparations.filter((item) => old.ledgerIds.includes(item.ledgerId))) !==
                digest(after.preparations.filter((item) => old.ledgerIds.includes(item.ledgerId)))
        )
            throw new InputError('Export preparation history is frozen until publication.');
    }
    for (const old of before.ledgers) {
        const next = after.ledgers.find((item) => item.ledgerId === old.ledgerId);
        if (!next) {
            if (mode === 'prune' && ['sealed', 'abandoned'].includes(old.state)) continue;
            throw new InputError('Ledger records cannot be silently deleted.');
        }
        if (mode === 'prune' && digest(old) !== digest(next))
            throw new InputError('Prune cannot edit retained ledger records.');
        if (old.state === 'sealed' && digest(old) !== digest(next))
            throw new InputError('Sealed ledger content is immutable.');
        const changed = digest(ledgerContent(old)) !== digest(ledgerContent(next));
        if (next.revision !== (changed ? integer(old.revision + 1, 1) : old.revision))
            throw new InputError('Ledger content revision does not match the declared mutation.');
        if (old.contextId !== next.contextId || digest(old.origin ?? null) !== digest(next.origin ?? null))
            throw new InputError('Ledger owner/origin is immutable.');
        if (old.ownership.kind !== 'local') {
            if (digest(portableLedger(old)) !== digest(portableLedger(next)))
                throw new InputError('Nonlocal ledger payload is frozen.');
            if (
                digest(before.preparations.filter((item) => item.ledgerId === old.ledgerId)) !==
                digest(after.preparations.filter((item) => item.ledgerId === old.ledgerId))
            )
                throw new InputError('Nonlocal preparation history is frozen.');
            if (
                next.ownership.kind === 'local' ||
                next.ownership.transferId !== old.ownership.transferId ||
                (old.ownership.kind === 'exported' && next.ownership.kind !== 'exported')
            )
                throw new InputError('Export ownership cannot thaw.');
        }
    }
    for (const next of after.ledgers) {
        if (
            !before.ledgers.some((item) => item.ledgerId === next.ledgerId) &&
            (before.imports.some((receipt) => receipt.mapping.some((pair) => pair.targetId === next.ledgerId)) ||
                before.transfers.some((receipt) => receipt.ledgerIds.includes(next.ledgerId)) ||
                before.preparations.some((receipt) => receipt.ledgerId === next.ledgerId))
        )
            throw new InputError('Ledger ID has historical receipts and cannot be reused.');
        if (
            !before.ledgers.some((item) => item.ledgerId === next.ledgerId) &&
            next.revision !== 1 &&
            !(
                mode === 'import' &&
                after.imports.some(
                    (receipt) =>
                        receipt.mode === 'resume' && receipt.mapping.some((pair) => pair.targetId === next.ledgerId),
                )
            )
        )
            throw new InputError('New ledger revision must be 1 or covered by explicit resume import.');
    }
}
