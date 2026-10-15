import { randomUUID } from 'node:crypto';
import { samePhysicalPath } from '../tooling/file-evidence.ts';
import {
    integer,
    type PlannedLedger,
    parseBlocker,
    sortBlockers,
    uuid,
    type WorktreeState,
} from './ledger-contract.ts';
import {
    type Blocker,
    type ConfirmedIdentity,
    checkRaw,
    InputError,
    identityKey,
    type Ledger,
    normalizeIdentities,
    type Operation,
    parseOperationShape,
    type Registry,
    text,
} from './records.ts';

export type NewLedger = { ledgerId?: string; select?: boolean; note?: string; work?: string };
export type ReplacementLedger = NewLedger & { ledgerId: string; identities: ConfirmedIdentity[]; blockers: Blocker[] };
function find(state: WorktreeState, id: string): PlannedLedger {
    const ledger = state.ledgers.find((item) => item.ledgerId === uuid(id));
    if (!ledger) throw new InputError('Ledger ID does not exist in this context.');
    return ledger;
}
function local(ledger: PlannedLedger): void {
    if (ledger.ownership.kind !== 'local') throw new InputError('Ledger ownership must be local.');
}
function active(state: WorktreeState, id: string): void {
    if (!state.current || state.current.ledgerId !== id || state.current.paused)
        throw new InputError('Mutation requires the exact active current ledger selection.');
}
function open(state: WorktreeState, id: string): PlannedLedger {
    const ledger = find(state, id);
    local(ledger);
    active(state, id);
    if (ledger.state !== 'open') throw new InputError('Recording requires an open ledger.');
    return ledger;
}
export function reviseLedger(ledger: PlannedLedger): void {
    ledger.revision = integer(ledger.revision + 1, 1);
}
export function createLedger(state: WorktreeState, options: NewLedger = {}): string {
    checkRaw(options);
    const ledgerId = uuid(options.ledgerId ?? randomUUID());
    if (state.ledgers.some((item) => item.ledgerId === ledgerId)) throw new InputError('Ledger ID already exists.');
    const ledger: PlannedLedger = {
        ledgerId,
        contextId: state.contextId,
        revision: 1,
        state: 'open',
        ownership: { kind: 'local' },
        identities: [],
        blockers: [],
        currentPreparationId: null,
        predecessorIds: [],
        successorIds: [],
        ...(options.note === undefined ? {} : { note: text(options.note) }),
        ...(options.work === undefined ? {} : { work: text(options.work) }),
    };
    state.ledgers.push(ledger);
    if (options.select) selectLedger(state, ledgerId);
    return ledgerId;
}
export function selectLedger(state: WorktreeState, id: string): void {
    const ledger = find(state, id);
    local(ledger);
    if (!['open', 'prepared'].includes(ledger.state))
        throw new InputError('Selection requires open or prepared ledger.');
    state.current = { ledgerId: ledger.ledgerId, paused: false };
}
export function addIdentities(
    state: WorktreeState,
    id: string,
    identities: readonly ConfirmedIdentity[],
    registry: Registry,
): void {
    const ledger = open(state, id);
    const next = normalizeIdentities([...ledger.identities, ...identities], registry);
    if (JSON.stringify(next) !== JSON.stringify(ledger.identities)) {
        reviseLedger(ledger);
        ledger.identities = next;
    }
}
export function removeIdentities(
    state: WorktreeState,
    id: string,
    identities: readonly ConfirmedIdentity[],
    registry: Registry,
): void {
    const ledger = open(state, id);
    const keys = new Set(normalizeIdentities(identities, registry).map(identityKey));
    const next = ledger.identities.filter((item) => !keys.has(identityKey(item)));
    if (next.length !== ledger.identities.length) {
        reviseLedger(ledger);
        ledger.identities = next;
    }
}
export function blockLedger(state: WorktreeState, id: string, value: Blocker): void {
    const ledger = open(state, id);
    const blocker = parseBlocker(value);
    if (ledger.blockers.some((item) => item.id === blocker.id))
        throw new InputError('Blocker ID already exists; explicitly unblock first.');
    reviseLedger(ledger);
    ledger.blockers = sortBlockers([...ledger.blockers, blocker]);
}
export function unblockLedger(state: WorktreeState, id: string, blockerId: string): void {
    checkRaw(blockerId);
    const ledger = open(state, id);
    if (!ledger.blockers.some((item) => item.id === blockerId)) throw new InputError('Blocker ID does not exist.');
    reviseLedger(ledger);
    ledger.blockers = ledger.blockers.filter((item) => item.id !== blockerId);
}
export function pauseLedger(state: WorktreeState, id: string): void {
    const ledger = find(state, id);
    local(ledger);
    active(state, id);
    state.current = { ledgerId: id, paused: true };
}
export function resumeLedger(state: WorktreeState, id: string): void {
    if (!state.current || state.current.ledgerId !== id || !state.current.paused)
        throw new InputError('Resume requires the exact paused current selection.');
    const ledger = find(state, id);
    local(ledger);
    if (!['open', 'prepared'].includes(ledger.state)) throw new InputError('Resume requires an unfinished ledger.');
    state.current = { ledgerId: id, paused: false };
}
export function reopenLedger(state: WorktreeState, id: string, declaration: { reviewedNoResult: boolean }): void {
    const ledger = find(state, id);
    local(ledger);
    if (!['prepared', 'abandoned'].includes(ledger.state))
        throw new InputError('Only prepared or abandoned ledgers can reopen; sealed ledgers are immutable.');
    if (ledger.successorIds.length) throw new InputError('A replaced ledger cannot reopen while it has successors.');
    if (
        (ledger.state === 'prepared' || state.preparations.some((receipt) => receipt.ledgerId === id)) &&
        declaration.reviewedNoResult !== true
    )
        throw new InputError('Prepared reopen requires an explicit reviewed-no-result declaration.');
    reviseLedger(ledger);
    ledger.state = 'open';
    ledger.currentPreparationId = null;
}
export function abandonLedger(state: WorktreeState, id: string): void {
    const ledger = find(state, id);
    local(ledger);
    if (ledger.state === 'sealed') throw new InputError('Sealed ledgers are immutable.');
    if (ledger.state !== 'abandoned') {
        reviseLedger(ledger);
        ledger.state = 'abandoned';
        ledger.currentPreparationId = null;
    }
    if (state.current?.ledgerId === id) state.current = null;
}
/** Split/combine allocations are complete caller declarations; overlap across output sets is intentional. */
export function replaceLedgers(
    state: WorktreeState,
    sourceIds: readonly string[],
    outputs: readonly ReplacementLedger[],
    registry: Registry,
): void {
    if (!sourceIds.length || !outputs.length || (sourceIds.length !== 1 && outputs.length !== 1))
        throw new InputError('Split/combine requires one source or one output.');
    if (
        new Set(sourceIds).size !== sourceIds.length ||
        new Set(outputs.map((item) => item.ledgerId)).size !== outputs.length
    )
        throw new InputError('Duplicate split/combine IDs.');
    const sources = sourceIds.map((id) => {
        const ledger = find(state, id);
        local(ledger);
        if (ledger.state !== 'open') throw new InputError('Split/combine requires local open sources.');
        integer(ledger.revision + 1, 1);
        return ledger;
    });
    const planned = outputs.map((output) => {
        checkRaw(output);
        uuid(output.ledgerId);
        if (state.ledgers.some((item) => item.ledgerId === output.ledgerId))
            throw new InputError('Replacement ID already exists.');
        const blockers = output.blockers.map(parseBlocker);
        if (new Set(blockers.map((item) => item.id)).size !== blockers.length)
            throw new InputError('Duplicate blocker ID.');
        return {
            ...output,
            identities: normalizeIdentities(output.identities, registry),
            blockers: sortBlockers(blockers),
            ...(output.note === undefined ? {} : { note: text(output.note) }),
            ...(output.work === undefined ? {} : { work: text(output.work) }),
        };
    });
    for (const source of sources) {
        abandonLedger(state, source.ledgerId);
        source.successorIds = planned.map((item) => item.ledgerId);
    }
    for (const output of planned) {
        createLedger(state, { ...output, select: false });
        const ledger = find(state, output.ledgerId);
        ledger.identities = output.identities;
        ledger.blockers = output.blockers;
        ledger.predecessorIds = [...sourceIds];
    }
}
export function selectedLedgerSnapshot(
    state: WorktreeState,
    operationValue: Operation,
    expectedLedgerId?: string,
    useCurrent = false,
): Ledger {
    const operation = parseOperationShape(operationValue);
    if (
        !samePhysicalPath(state.locator.worktree, operation.worktree) ||
        !samePhysicalPath(state.locator.worktree, operation.repository) ||
        !samePhysicalPath(state.locator.commonGitDir, operation.commonGitDir)
    )
        throw new InputError('Operation scope does not match ledger context.');
    if (useCurrent && (!state.current || state.current.paused))
        throw new InputError('Snapshot requires an active current selection; current is missing or paused.');
    const id =
        expectedLedgerId === undefined ? (useCurrent ? state.current?.ledgerId : undefined) : uuid(expectedLedgerId);
    if (!id) throw new InputError('Snapshot requires an explicit ledger ID or active current selection.');
    if (state.current && state.current.ledgerId !== id)
        throw new InputError('Expected ledger does not match current selection; explicitly select before proceeding.');
    const ledger = find(state, id);
    local(ledger);
    if (!['open', 'prepared'].includes(ledger.state))
        throw new InputError('Snapshot requires an open or prepared ledger.');
    return {
        schemaVersion: 2,
        ledgerId: id,
        operation,
        identities: structuredClone(ledger.identities),
        blockers: structuredClone(ledger.blockers),
    };
}
