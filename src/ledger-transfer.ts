import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readRegularFile, samePhysicalPath } from '../tooling/file-evidence.ts';
import {
    array,
    type ContextLocator,
    distinct,
    type ImportReceipt,
    integer,
    object,
    type PlannedLedger,
    parseCurrent,
    parsePlannedLedger,
    parsePortableLocator,
    parsePreparations,
    portableLedger,
    STATE_BYTES,
    sha256,
    type TransferReceipt,
    transferPayload,
    uuid,
    validateLedgerJoins,
    type WorktreeState,
} from './ledger-contract.ts';
import {
    importState,
    type LedgerContext,
    pruneState,
    readState,
    rebindState,
    resolveLedgerContext,
    transactState,
} from './ledger-store.ts';
import { writeNewMessage } from './message-output.ts';
import { checkRaw, InputError, ordinal } from './records.ts';
import type { PreparedReceipt } from './result-contract.ts';
import { byteDigest, digest, inspectPath, physicalDirectory } from './runtime-support.ts';
import { inside } from './safe-git.ts';

export { rebindState };
export const BUNDLE_BYTES = STATE_BYTES;
export type TransferBundle = {
    schemaVersion: 1;
    artifact: 'ledger-transfer';
    transferId: string;
    sourceContextId: string;
    locator: ContextLocator;
    current: WorktreeState['current'];
    ledgers: PlannedLedger[];
    preparations: PreparedReceipt[];
    payloadDigest: string;
};
/** Pure historical parser: source paths need not exist. */
export function parseTransferBundle(value: unknown): TransferBundle {
    checkRaw(value);
    const data = object(value, [
        'schemaVersion',
        'artifact',
        'transferId',
        'sourceContextId',
        'locator',
        'current',
        'ledgers',
        'preparations',
        'payloadDigest',
    ]);
    if (data.schemaVersion !== 1 || data.artifact !== 'ledger-transfer')
        throw new InputError('Invalid transfer bundle schema/artifact.');
    const sourceContextId = uuid(data.sourceContextId);
    const ledgers = array(data.ledgers, parsePlannedLedger);
    const preparations = parsePreparations(data.preparations);
    if (!ledgers.length) throw new InputError('Transfer bundle requires a nonempty selection.');
    distinct(ledgers.map((ledger) => ledger.ledgerId));
    distinct(preparations.map((receipt) => uuid(receipt.preparationId)));
    for (const receipt of preparations) {
        uuid(receipt.sourceContextId);
        uuid(receipt.ledgerId);
        if (!ledgers.some((ledger) => ledger.ledgerId === receipt.ledgerId))
            throw new InputError('Transfer preparation has no selected ledger.');
    }
    if (ledgers.some((ledger) => ledger.contextId !== sourceContextId || ledger.ownership.kind !== 'local'))
        throw new InputError('Transfer snapshot context/ownership mismatch.');
    validateLedgerJoins(ledgers, preparations);
    const payloadDigest = sha256(data.payloadDigest);
    if (digest({ ledgers, preparations }) !== payloadDigest) throw new InputError('Transfer payload digest mismatch.');
    return {
        schemaVersion: 1,
        artifact: 'ledger-transfer',
        transferId: uuid(data.transferId),
        sourceContextId,
        locator: parsePortableLocator(data.locator),
        current: parseCurrent(data.current, ledgers),
        ledgers,
        preparations,
        payloadDigest,
    };
}
export function encodeTransferBundle(bundle: TransferBundle): Buffer {
    const bytes = Buffer.from(`${JSON.stringify(parseTransferBundle(bundle), null, 4)}\n`);
    if (bytes.length > BUNDLE_BYTES) throw new InputError('Transfer bundle byte budget exceeded.');
    return bytes;
}
async function readBundle(file: string): Promise<{ bundle: TransferBundle; bytes: Buffer; bundleDigest: string }> {
    const bytes = await readRegularFile(path.resolve(file), {
        physicalPath: true,
        singleLink: true,
        maximumBytes: BUNDLE_BYTES,
    });
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new InputError('Transfer bundle must be strict UTF-8 JSON.');
    }
    return { bundle: parseTransferBundle(value), bytes, bundleDigest: byteDigest(bytes) };
}
async function externalOutput(context: LedgerContext, file: string): Promise<string> {
    checkRaw(file);
    if (!file) throw new InputError('Explicit transfer output path is empty.');
    const output = path.resolve(file);
    const safetyPath = (value: string) => {
        if (process.platform !== 'win32') return value;
        if (/^\\\\\?\\UNC\\/i.test(value)) return value.replace(/^\\\\\?\\UNC\\/i, '\\\\');
        if (/^\\\\\?\\[a-z]:\\/i.test(value)) return value.slice(4);
        if (/^\\\\[?.]\\/.test(value))
            throw new InputError('Transfer output uses an unsupported Windows device namespace.');
        return value;
    };
    const checked = safetyPath(output);
    // NTFS directory streams can look like external regular files but disappear with their owner.
    // Only a leading drive designator may contain a colon; physical checks handle other aliases.
    if (process.platform === 'win32' && checked.replace(/^[a-z]:/i, '').includes(':'))
        throw new InputError('Transfer output must be an ordinary external file, not a Windows stream.');
    if (
        inside(safetyPath(context.locator.worktree), checked) ||
        inside(safetyPath(context.locator.gitDirectory), checked) ||
        inside(safetyPath(context.locator.commonGitDir), checked) ||
        checked.split(path.sep).some((part) => part.toLowerCase() === '.git')
    )
        throw new InputError('Transfer output must be outside the worktree and protected Git metadata.');
    await physicalDirectory(path.dirname(output));
    await inspectPath(output);
    return output;
}
function selectedIds(state: WorktreeState, input: readonly string[]): string[] {
    const ids = input.map(uuid).sort(ordinal);
    distinct(ids);
    if (!ids.length) throw new InputError('Export requires a nonempty explicit ledger selection.');
    for (const id of ids) {
        const ledger = state.ledgers.find((item) => item.ledgerId === id);
        if (!ledger) throw new InputError(`Selected ledger does not exist: ${id}`);
        const missing = [...ledger.predecessorIds, ...ledger.successorIds].filter((linked) => !ids.includes(linked));
        if (missing.length)
            throw new InputError(`Export requires complete replacement link closure: ${missing.join(', ')}`);
    }
    return ids;
}
function reconstruct(state: WorktreeState, receipt: TransferReceipt): TransferBundle {
    const payload = transferPayload(state, receipt);
    if (digest(payload) !== receipt.payloadDigest)
        throw new InputError('Frozen export payload changed; cannot reconstruct original bundle.');
    return {
        schemaVersion: 1,
        artifact: 'ledger-transfer',
        transferId: receipt.transferId,
        sourceContextId: receipt.sourceContextId,
        locator: receipt.locator,
        current: receipt.current,
        ...payload,
        payloadDigest: receipt.payloadDigest,
    };
}
export type ExportResult = { stateVersion: number; transferId: string; bundleDigest: string; path: string };
/** Only interruption boundaries are injectable; production publication uses the audited exclusive writer. */
export type ExportIO = { afterFreeze?: () => Promise<void>; afterPublish?: () => Promise<void> };
export async function exportLedgers(
    contextValue: LedgerContext,
    expectedStateVersion: number,
    options: { ledgerIds: readonly string[]; output: string; transferId?: string },
    io: ExportIO = {},
): Promise<ExportResult> {
    integer(expectedStateVersion);
    const context = await resolveLedgerContext(contextValue.locator.worktree);
    // readState validates the supplied context, rather than accepting an arbitrary output scope.
    let state = await readState(contextValue);
    if (state.stateVersion !== expectedStateVersion) throw new InputError('Ledger state version is stale.');
    const output = await externalOutput(context, options.output);
    const ledgerIds = selectedIds(state, options.ledgerIds);
    let receipt: TransferReceipt;
    let bytes: Buffer;
    if (options.transferId !== undefined) {
        const found = state.transfers.find((item) => item.transferId === uuid(options.transferId));
        if (!found || digest(found.ledgerIds) !== digest(ledgerIds) || !samePhysicalPath(found.output, output))
            throw new InputError('Retry requires the exact owned transfer ID, selection and output path.');
        receipt = found;
        bytes = encodeTransferBundle(reconstruct(state, receipt));
        if (byteDigest(bytes) !== receipt.bundleDigest)
            throw new InputError('Retry bundle bytes differ from frozen receipt.');
    } else {
        if (await inspectPath(output))
            throw new InputError('Transfer output is occupied; explicit owned transfer retry is required.');
        if (ledgerIds.some((id) => state.ledgers.find((item) => item.ledgerId === id)?.ownership.kind !== 'local'))
            throw new InputError('Export requires local ownership or an explicit owned transfer retry.');
        const preparationIds = state.preparations
            .filter((item) => ledgerIds.includes(item.ledgerId))
            .map((item) => item.preparationId)
            .sort(ordinal);
        const payload = transferPayload(state, { ledgerIds, preparationIds });
        receipt = {
            transferId: randomUUID(),
            phase: 'exporting',
            sourceContextId: state.contextId,
            locator: structuredClone(state.locator),
            ledgerIds,
            preparationIds,
            current:
                state.current && ledgerIds.includes(state.current.ledgerId) ? structuredClone(state.current) : null,
            payloadDigest: digest(payload),
            bundleDigest: '',
            output,
        };
        bytes = encodeTransferBundle({
            schemaVersion: 1,
            artifact: 'ledger-transfer',
            transferId: receipt.transferId,
            sourceContextId: receipt.sourceContextId,
            locator: receipt.locator,
            current: receipt.current,
            ...payload,
            payloadDigest: receipt.payloadDigest,
        });
        receipt.bundleDigest = byteDigest(bytes);
        state = await transactState(context, expectedStateVersion, (draft) => {
            if (digest(transferPayload(draft, receipt)) !== receipt.payloadDigest)
                throw new InputError('Selected export payload changed before freeze.');
            draft.transfers.push(structuredClone(receipt));
            for (const ledger of draft.ledgers)
                if (ledgerIds.includes(ledger.ledgerId) && ['open', 'prepared'].includes(ledger.state))
                    ledger.ownership = { kind: 'exporting', transferId: receipt.transferId };
            if (draft.current && ledgerIds.includes(draft.current.ledgerId)) draft.current.paused = true;
        });
    }
    await io.afterFreeze?.();
    await externalOutput(context, output);
    if (await inspectPath(output)) {
        const published = await readBundle(output);
        if (
            published.bundle.transferId !== receipt.transferId ||
            published.bundleDigest !== receipt.bundleDigest ||
            !published.bytes.equals(bytes)
        )
            throw new InputError('Occupied transfer output does not match the exact owned retry bytes.');
    } else {
        await writeNewMessage(output, bytes, context.locator, [context.stateFile]);
    }
    const published = await readBundle(output);
    if (published.bundleDigest !== receipt.bundleDigest || !published.bytes.equals(bytes))
        throw new InputError('Published transfer bundle readback differs from frozen bytes.');
    await io.afterPublish?.();
    // Long publication happened outside the lock. Reread permits unrelated newer current/records.
    state = await readState(context);
    const found = state.transfers.find((item) => item.transferId === receipt.transferId);
    if (!found || digest({ ...found, phase: receipt.phase }) !== digest(receipt))
        throw new InputError('Frozen transfer receipt changed before final publication mark.');
    if (found.phase !== 'exported') {
        state = await transactState(context, state.stateVersion, (draft) => {
            const current = draft.transfers.find((item) => item.transferId === receipt.transferId);
            if (!current || digest(transferPayload(draft, current)) !== current.payloadDigest)
                throw new InputError('Frozen transfer payload changed before final publication mark.');
            current.phase = 'exported';
            for (const ledger of draft.ledgers)
                if (ledger.ownership.kind === 'exporting' && ledger.ownership.transferId === receipt.transferId)
                    ledger.ownership = { kind: 'exported', transferId: receipt.transferId };
        });
    }
    return {
        stateVersion: state.stateVersion,
        transferId: receipt.transferId,
        bundleDigest: receipt.bundleDigest,
        path: output,
    };
}
export type ImportResult = {
    stateVersion: number;
    transferId: string;
    bundleDigest: string;
    ledgerIds: string[];
    idempotent: boolean;
};
export async function importLedgers(
    context: LedgerContext,
    expectedStateVersion: number,
    options: { input: string; mode: 'resume' | 'copy'; singleAuthority?: boolean },
): Promise<ImportResult> {
    if (options.mode !== 'resume' && options.mode !== 'copy')
        throw new InputError('Import mode must be resume or copy.');
    if (options.mode === 'resume' && options.singleAuthority !== true)
        throw new InputError('Resume import requires an explicit single-authority declaration.');
    const { bundle, bundleDigest } = await readBundle(options.input);
    const state = await readState(context);
    if (state.stateVersion !== integer(expectedStateVersion)) throw new InputError('Ledger state version is stale.');
    const existing = state.imports.find((item) => item.transferId === bundle.transferId);
    if (existing) {
        if (existing.bundleDigest !== bundleDigest || existing.mode !== options.mode)
            throw new InputError('Transfer ID conflicts with existing import digest/mode.');
        return {
            stateVersion: state.stateVersion,
            transferId: bundle.transferId,
            bundleDigest,
            ledgerIds: existing.mapping.map((pair) => pair.targetId),
            idempotent: true,
        };
    }
    if (bundle.sourceContextId === state.contextId)
        throw new InputError('Import target must have a distinct context ID.');
    const mapping = bundle.ledgers.map((ledger) => ({
        sourceId: ledger.ledgerId,
        targetId: options.mode === 'resume' ? ledger.ledgerId : randomUUID(),
    }));
    const targetId = (id: string): string => {
        const pair = mapping.find((item) => item.sourceId === id);
        if (!pair) throw new InputError('Imported link target missing.');
        return pair.targetId;
    };
    const ledgers = bundle.ledgers.map((source): PlannedLedger => {
        const ledger = portableLedger(source);
        ledger.contextId = state.contextId;
        if (options.mode === 'copy') {
            ledger.ledgerId = targetId(source.ledgerId);
            ledger.revision = 1;
            ledger.state = 'open';
            ledger.currentPreparationId = null;
            delete ledger.sealedResult;
            // Copy plans are independent; replacement relations remain source history, not active local links.
            ledger.predecessorIds = [];
            ledger.successorIds = [];
            const { origin: priorOrigin, ...originalSnapshot } = portableLedger(source);
            ledger.origin = {
                transferId: bundle.transferId,
                sourceContextId: bundle.sourceContextId,
                ledgerId: source.ledgerId,
                revision: source.revision,
                preparations: structuredClone(bundle.preparations.filter((item) => item.ledgerId === source.ledgerId)),
                source: originalSnapshot,
                history: priorOrigin
                    ? [
                          {
                              transferId: priorOrigin.transferId,
                              sourceContextId: priorOrigin.sourceContextId,
                              ledgerId: priorOrigin.ledgerId,
                              revision: priorOrigin.revision,
                              preparations: priorOrigin.preparations,
                              source: priorOrigin.source,
                          },
                          ...priorOrigin.history,
                      ]
                    : [],
            };
        }
        return ledger;
    });
    const receipt: ImportReceipt = {
        transferId: bundle.transferId,
        bundleDigest,
        sourceContextId: bundle.sourceContextId,
        mode: options.mode,
        mapping,
        preparationIds: options.mode === 'resume' ? bundle.preparations.map((item) => item.preparationId) : [],
    };
    const imported = await importState(
        context,
        expectedStateVersion,
        receipt,
        ledgers,
        options.mode === 'resume' ? bundle.preparations : [],
        bundle.current ? { ledgerId: targetId(bundle.current.ledgerId), paused: true } : null,
    );
    return {
        stateVersion: imported.stateVersion,
        transferId: bundle.transferId,
        bundleDigest,
        ledgerIds: mapping.map((pair) => pair.targetId),
        idempotent: false,
    };
}
export async function pruneLedgers(
    context: LedgerContext,
    expectedStateVersion: number,
    options: { ledgerIds: readonly string[] },
): Promise<WorktreeState> {
    return pruneState(context, expectedStateVersion, options.ledgerIds.map(uuid));
}
export type RemovalResult = {
    stateVersion: number;
    safe: boolean;
    details: { ledgerId: string; covered: boolean; reason: string; transferId?: string }[];
    exitCode: number;
};
/** Advisory snapshot only: never deletes a worktree or promises future file availability. */
export async function checkRemoval(context: LedgerContext): Promise<RemovalResult> {
    const state = await readState(context);
    const details: RemovalResult['details'] = [];
    const evidence = new Map<string, TransferBundle | Error>();
    for (const receipt of state.transfers.filter((item) => item.phase === 'exported')) {
        try {
            await externalOutput(context, receipt.output);
            const observed = await readBundle(receipt.output);
            if (
                observed.bundleDigest !== receipt.bundleDigest ||
                observed.bundle.transferId !== receipt.transferId ||
                observed.bundle.payloadDigest !== receipt.payloadDigest
            )
                throw new InputError('Export bytes/identity no longer match confirmed receipt.');
            evidence.set(receipt.transferId, observed.bundle);
        } catch (error) {
            evidence.set(receipt.transferId, error instanceof Error ? error : new Error('External export unreadable.'));
        }
    }
    for (const ledger of state.ledgers.filter((item) => ['open', 'prepared'].includes(item.state))) {
        let covered: string | undefined;
        let reason = 'No confirmed successful external export covers the current complete payload.';
        for (const receipt of state.transfers.filter(
            (item) => item.phase === 'exported' && item.ledgerIds.includes(ledger.ledgerId),
        )) {
            const bundle = evidence.get(receipt.transferId);
            if (bundle instanceof Error) {
                reason = bundle.message;
                continue;
            }
            const snapshot = bundle?.ledgers.find((item) => item.ledgerId === ledger.ledgerId);
            const history = state.preparations
                .filter((item) => item.ledgerId === ledger.ledgerId)
                .sort((a, b) => ordinal(a.preparationId, b.preparationId));
            const exportedHistory = bundle?.preparations
                .filter((item) => item.ledgerId === ledger.ledgerId)
                .sort((a, b) => ordinal(a.preparationId, b.preparationId));
            if (
                snapshot &&
                digest(snapshot) === digest(portableLedger(ledger)) &&
                digest(history) === digest(exportedHistory)
            ) {
                covered = receipt.transferId;
                break;
            }
        }
        details.push({
            ledgerId: ledger.ledgerId,
            covered: covered !== undefined,
            reason: covered ? 'Current complete payload is covered by a verified external export.' : reason,
            ...(covered ? { transferId: covered } : {}),
        });
    }
    const safe = details.every((item) => item.covered);
    return { stateVersion: state.stateVersion, safe, details, exitCode: safe ? 0 : 1 };
}
