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
import { digest } from './runtime-support.ts';

/** Independent from explicit input/message limits: the complete persisted state counts. */
export const STATE_BYTES = 16 * 1024 * 1024;
export type ContextLocator = { worktree: string; gitDirectory: string; commonGitDir: string };
export type Ownership = { kind: 'local' } | { kind: 'exporting' | 'exported'; transferId: string };
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
};
/** Reserved receipt collections accept only empty arrays until their strict contracts are delivered. */
export type WorktreeState = {
    schemaVersion: 1;
    contextId: string;
    locator: ContextLocator;
    stateVersion: number;
    current: { ledgerId: string; paused: boolean } | null;
    ledgers: PlannedLedger[];
    preparations: never[];
    transfers: never[];
    imports: never[];
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
function parsePlannedLedger(value: unknown): PlannedLedger {
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
    };
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
    for (const ledger of ledgers) {
        if (ledger.contextId !== contextId) throw new InputError('Invalid ledger state: ledger/context mismatch.');
        if (ledger.currentPreparationId !== null || ledger.state === 'prepared')
            throw new InputError('Invalid ledger state: preparation receipts are not yet supported.');
        if (ledger.ownership.kind !== 'local')
            throw new InputError('Invalid ledger state: transfer receipts are not yet supported.');
        for (const id of ledger.predecessorIds) {
            const source = byId.get(id);
            if (id === ledger.ledgerId || !source?.successorIds.includes(ledger.ledgerId))
                throw new InputError('Invalid ledger state: predecessor reference.');
        }
        for (const id of ledger.successorIds) {
            const target = byId.get(id);
            if (
                id === ledger.ledgerId ||
                !target?.predecessorIds.includes(ledger.ledgerId) ||
                ledger.state !== 'abandoned'
            )
                throw new InputError('Invalid ledger state: successor reference.');
        }
    }
    let current: WorktreeState['current'] = null;
    if (data.current !== null) {
        const selected = object(data.current, ['ledgerId', 'paused']);
        const ledgerId = uuid(selected.ledgerId);
        if (
            typeof selected.paused !== 'boolean' ||
            !byId.has(ledgerId) ||
            !['open', 'prepared'].includes(byId.get(ledgerId)?.state ?? '')
        )
            throw new InputError('Invalid ledger state: current reference/lifecycle.');
        current = { ledgerId, paused: selected.paused };
    }
    for (const key of ['preparations', 'transfers', 'imports'] as const) {
        if (!Array.isArray(data[key]) || data[key].length !== 0)
            throw new InputError('Invalid ledger state: reserved receipts must be empty.');
    }
    return {
        schemaVersion: 1,
        contextId,
        locator: parseLocator(data.locator),
        stateVersion: integer(data.stateVersion),
        current,
        ledgers,
        preparations: [],
        transfers: [],
        imports: [],
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
        predecessorIds: ledger.predecessorIds,
        successorIds: ledger.successorIds,
    };
}
export function validateStateTransition(before: WorktreeState, after: WorktreeState): void {
    for (const old of before.ledgers) {
        const next = after.ledgers.find((item) => item.ledgerId === old.ledgerId);
        if (!next) throw new InputError('Ledger records cannot be silently deleted.');
        if (old.state === 'sealed' && digest(old) !== digest(next))
            throw new InputError('Sealed ledger content is immutable.');
        const changed = digest(ledgerContent(old)) !== digest(ledgerContent(next));
        if (next.revision !== (changed ? integer(old.revision + 1, 1) : old.revision))
            throw new InputError('Ledger content revision does not match the declared mutation.');
        if (old.ownership.kind !== 'local' && changed) throw new InputError('Nonlocal ledger content is frozen.');
    }
    for (const next of after.ledgers) {
        if (!before.ledgers.some((item) => item.ledgerId === next.ledgerId) && next.revision !== 1)
            throw new InputError('New ledger revision must be 1.');
    }
}
