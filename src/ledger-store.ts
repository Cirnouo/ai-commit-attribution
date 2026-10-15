import { randomUUID } from 'node:crypto';
import { type BigIntStats, constants } from 'node:fs';
import { type FileHandle, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { errorCode } from '../tooling/errors.ts';
import { readRegularFile, samePhysicalPath } from '../tooling/file-evidence.ts';
import {
    type ContextLocator,
    encodeState,
    type ImportReceipt,
    integer,
    type PlannedLedger,
    parseWorktreeState,
    STATE_BYTES,
    type TransitionMode,
    validateStateTransition,
    type WorktreeState,
} from './ledger-contract.ts';
import { checkRaw, InputError } from './records.ts';
import type { PreparedReceipt } from './result-contract.ts';
import { digest, inspectPath, physicalDirectory } from './runtime-support.ts';
import { resolveTrustedGit, SafeGit } from './safe-git.ts';
import { isLedgerStatePath } from './state-path.ts';

export type LedgerContext = { locator: ContextLocator; excludeFile: string; stateDirectory: string; stateFile: string };
/** Narrow I/O seams permit deterministic short-write and failed-replacement observations. */
export type StateIO = {
    write?: (handle: FileHandle, bytes: Buffer, offset: number) => Promise<number>;
    rename?: (source: string, destination: string) => Promise<void>;
};
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const unchanged = (a: BigIntStats, b: BigIntStats) =>
    same(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const noFollow = constants.O_NOFOLLOW ?? 0;
async function completeWrite(handle: FileHandle, bytes: Buffer, io: StateIO): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
        const count = io.write
            ? await io.write(handle, bytes, offset)
            : (await handle.write(bytes, offset, bytes.length - offset, offset)).bytesWritten;
        if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset)
            throw new InputError('State write made no valid progress; candidate preserved.');
        offset += count;
    }
}
async function regular(file: string, maximumBytes: number): Promise<{ bytes: Buffer; info: BigIntStats }> {
    await inspectPath(file);
    const info = await lstat(file, { bigint: true });
    const bytes = await readRegularFile(file, { physicalPath: true, singleLink: true, maximumBytes });
    if (!unchanged(info, await lstat(file, { bigint: true })))
        throw new InputError('State file identity changed during reading.');
    return { bytes, info };
}
async function optionalRegular(file: string, maximumBytes: number) {
    if (!(await inspectPath(file))) return undefined;
    return regular(file, maximumBytes);
}
async function withLock<T>(file: string, operation: (guard: () => Promise<void>) => Promise<T>): Promise<T> {
    const parent = path.dirname(file);
    await physicalDirectory(parent);
    let handle: FileHandle | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            handle = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
            break;
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') throw error;
            if (attempt === 49)
                throw new InputError(
                    'Ledger lock is occupied; its owner or residual artifact must be reviewed. No lock was stolen.',
                );
            await delay(20);
        }
    }
    if (!handle) throw new InputError('Could not acquire ledger lock.');
    const token = Buffer.from(`${randomUUID()}\n`);
    let owned: BigIntStats | undefined;
    let failure: unknown;
    let result: T | undefined;
    const guard = async () => {
        if (!owned) throw new InputError('Lock ownership is uncertain; artifact preserved.');
        const current = await regular(file, token.length);
        if (
            !unchanged(owned, current.info) ||
            !current.bytes.equals(token) ||
            !unchanged(owned, await handle.stat({ bigint: true }))
        )
            throw new InputError('Lock was replaced or changed; replacement preserved.');
        await physicalDirectory(parent);
    };
    try {
        await completeWrite(handle, token, {});
        await handle.sync();
        owned = await handle.stat({ bigint: true });
        await guard();
        result = await operation(guard);
        await guard();
    } catch (error) {
        failure = error;
    }
    try {
        await handle.close();
    } catch (error) {
        failure ??= error;
    }
    if (owned) {
        try {
            const current = await regular(file, token.length);
            if (!unchanged(owned, current.info) || !current.bytes.equals(token))
                throw new InputError('Lock changed; replacement preserved.');
            await unlink(file);
        } catch (error) {
            failure ??= error;
        }
    }
    if (failure !== undefined) throw failure;
    return result as T;
}
export async function resolveLedgerContext(directory: string): Promise<LedgerContext> {
    checkRaw(directory);
    const actual = await physicalDirectory(path.resolve(directory));
    const git = new SafeGit(await resolveTrustedGit([actual]), actual);
    await git.guard();
    const worktree = await physicalDirectory(path.resolve(await git.text('rev-parse', ['--show-toplevel'])));
    const gitDirectory = await physicalDirectory(path.resolve(await git.text('rev-parse', ['--absolute-git-dir'])));
    const commonGitDir = await physicalDirectory(
        path.resolve(actual, await git.text('rev-parse', ['--git-common-dir'])),
    );
    const excludeFile = path.resolve(
        await git.text('rev-parse', ['--path-format=absolute', '--git-path', 'info/exclude']),
    );
    await physicalDirectory(path.dirname(excludeFile));
    await inspectPath(excludeFile);
    const stateDirectory = path.join(worktree, '.ai-commit-attribution');
    return {
        locator: { worktree, gitDirectory, commonGitDir },
        excludeFile,
        stateDirectory,
        stateFile: path.join(stateDirectory, 'state.json'),
    };
}
function sameLocator(left: ContextLocator, right: ContextLocator): boolean {
    return (['worktree', 'gitDirectory', 'commonGitDir'] as const).every((key) =>
        samePhysicalPath(left[key], right[key]),
    );
}
async function actualContext(context: LedgerContext): Promise<LedgerContext> {
    const actual = await resolveLedgerContext(context.locator.worktree);
    if (
        !sameLocator(context.locator, actual.locator) ||
        !samePhysicalPath(context.excludeFile, actual.excludeFile) ||
        !samePhysicalPath(context.stateDirectory, actual.stateDirectory) ||
        !samePhysicalPath(context.stateFile, actual.stateFile)
    )
        throw new InputError('Ledger context locator no longer matches actual Git worktree.');
    return actual;
}
async function checkTracked(context: LedgerContext): Promise<SafeGit> {
    const git = new SafeGit(
        await resolveTrustedGit([context.locator.worktree, context.locator.commonGitDir]),
        context.locator.worktree,
    );
    const entries = await git.run('ls-files', ['--cached', '--full-name', '-z']);
    let start = 0;
    for (let index = 0; index < entries.length; index++) {
        if (entries[index] !== 0) continue;
        if (isLedgerStatePath(entries.subarray(start, index)))
            throw new InputError('Ledger state path conflicts with tracked/staged content.');
        start = index + 1;
    }
    if (start !== entries.length)
        throw new InputError('Tracked Git paths are incomplete; state cannot be safely observed.');
    return git;
}
async function checkIgnore(git: SafeGit): Promise<void> {
    const ignored = (
        await git.run(
            'check-ignore',
            ['--no-index', '--', '.ai-commit-attribution/', '.ai-commit-attribution/state.json'],
            true,
        )
    )
        .toString('utf8')
        .split(/\r?\n/);
    if (!ignored.includes('.ai-commit-attribution/') || !ignored.includes('.ai-commit-attribution/state.json'))
        throw new InputError('Ledger directory and state must be effectively ignored by Git.');
}
async function checkDirectory(context: LedgerContext): Promise<void> {
    if (!(await inspectPath(context.stateDirectory))?.isDirectory())
        throw new InputError('Ledger state directory is missing or unsafe.');
    await physicalDirectory(context.stateDirectory);
    const entries = await readdir(context.stateDirectory);
    if (
        entries.some(
            (entry) =>
                entry !== 'state.json' && entry !== 'state.lock' && !/^state\.candidate-[a-f0-9-]{36}$/.test(entry),
        )
    )
        throw new InputError('Ledger state directory contains unknown occupancy; preserve and review it.');
}
async function stateEvidence(context: LedgerContext, rebind = false) {
    await checkDirectory(context);
    const observed = await regular(context.stateFile, STATE_BYTES);
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(observed.bytes));
    } catch {
        throw new InputError('Ledger state is malformed UTF-8 JSON.');
    }
    const state = parseWorktreeState(value);
    if (!rebind && !sameLocator(state.locator, context.locator))
        throw new InputError(
            'Stored locator/context does not match this physical worktree; explicit rebind is required.',
        );
    return { ...observed, state };
}
/** Same-parent candidate publication; failure leaves the old authority or an identifiable candidate. */
async function publish(
    file: string,
    bytes: Buffer,
    previous: Awaited<ReturnType<typeof optionalRegular>>,
    guard: () => Promise<void>,
    io: StateIO = {},
): Promise<void> {
    const parent = path.dirname(file);
    const parentInfo = await lstat(await physicalDirectory(parent), { bigint: true });
    const candidate = path.join(
        parent,
        `${path.basename(file) === 'state.json' ? 'state' : path.basename(file)}.candidate-${randomUUID()}`,
    );
    const handle = await open(candidate, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    let primary: unknown;
    try {
        const owned = await handle.stat({ bigint: true });
        await completeWrite(handle, bytes, io);
        await handle.sync();
        const completed = await regular(candidate, bytes.length);
        if (
            !same(owned, completed.info) ||
            !completed.bytes.equals(bytes) ||
            !unchanged(completed.info, await handle.stat({ bigint: true }))
        )
            throw new InputError('Candidate bytes/identity changed during publication.');
        await guard();
        const current = await optionalRegular(file, Math.max(STATE_BYTES, bytes.length));
        if (
            previous
                ? !current || !unchanged(previous.info, current.info) || !previous.bytes.equals(current.bytes)
                : current !== undefined
        )
            throw new InputError('Original file changed before atomic publication.');
        if (!same(parentInfo, await lstat(parent, { bigint: true })))
            throw new InputError('Publication parent was replaced.');
        await physicalDirectory(parent);
        await handle.close();
        await (io.rename ?? rename)(candidate, file);
        const final = await regular(file, bytes.length);
        if (!same(completed.info, final.info) || !final.bytes.equals(bytes))
            throw new InputError('Publication final readback failed; reread authority before retrying.');
    } catch (error) {
        primary = error;
    }
    try {
        await handle.close();
    } catch (error) {
        primary ??= error;
    }
    if (primary !== undefined) throw primary;
}
async function appendExclusion(context: LedgerContext, guard: () => Promise<void>): Promise<void> {
    const previous = await optionalRegular(context.excludeFile, STATE_BYTES);
    const bytes = previous?.bytes ?? Buffer.alloc(0);
    const fixed = '/.ai-commit-attribution/';
    if (bytes.toString('utf8').split(/\r?\n/).includes(fixed)) return;
    const newline = bytes.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
    const suffix = `${bytes.length && bytes.at(-1) !== 0x0a ? newline : ''}${fixed}${newline}`;
    await publish(context.excludeFile, Buffer.concat([bytes, Buffer.from(suffix)]), previous, guard);
}
export async function initializeState(contextValue: LedgerContext): Promise<WorktreeState> {
    const context = await actualContext(contextValue);
    const git = await checkTracked(context);
    return withLock(`${context.excludeFile}.ai-commit-attribution.lock`, async (excludeGuard) => {
        await checkTracked(context);
        const existing = await inspectPath(context.stateDirectory);
        if (existing) {
            await checkDirectory(context);
            const state = (await stateEvidence(context)).state;
            await appendExclusion(context, excludeGuard);
            await checkIgnore(git);
            return state;
        }
        await appendExclusion(context, excludeGuard);
        await checkIgnore(git);
        await excludeGuard();
        await mkdir(context.stateDirectory, { mode: 0o700 });
        return withLock(path.join(context.stateDirectory, 'state.lock'), async (stateGuard) => {
            await checkTracked(context);
            await checkIgnore(git);
            const state: WorktreeState = {
                schemaVersion: 1,
                contextId: randomUUID(),
                locator: context.locator,
                stateVersion: 0,
                current: null,
                ledgers: [],
                preparations: [],
                transfers: [],
                imports: [],
            };
            await publish(context.stateFile, encodeState(state), undefined, async () => {
                await excludeGuard();
                await stateGuard();
            });
            return (await stateEvidence(context)).state;
        });
    });
}
export async function readState(contextValue: LedgerContext): Promise<WorktreeState> {
    const context = await actualContext(contextValue);
    const git = await checkTracked(context);
    await checkIgnore(git);
    return (await stateEvidence(context)).state;
}
/** Transform is synchronous and bounded; perform long Git/render work before calling this API. */
export async function transactState(
    contextValue: LedgerContext,
    expectedStateVersion: number,
    transform: (draft: WorktreeState) => void,
    io: StateIO = {},
): Promise<WorktreeState> {
    return transaction(contextValue, expectedStateVersion, transform, io, 'ordinary');
}
async function transaction(
    contextValue: LedgerContext,
    expectedStateVersion: number,
    transform: (draft: WorktreeState) => void,
    io: StateIO,
    mode: TransitionMode,
): Promise<WorktreeState> {
    integer(expectedStateVersion);
    const context = await actualContext(contextValue);
    const git = await checkTracked(context);
    await checkIgnore(git);
    const before = await stateEvidence(context, mode === 'rebind');
    if (before.state.stateVersion !== expectedStateVersion) throw new InputError('Ledger state version is stale.');
    return withLock(path.join(context.stateDirectory, 'state.lock'), async (guard) => {
        const locked = await stateEvidence(context, mode === 'rebind');
        if (
            locked.state.stateVersion !== expectedStateVersion ||
            !unchanged(before.info, locked.info) ||
            !before.bytes.equals(locked.bytes)
        )
            throw new InputError('Ledger state changed while obtaining lock.');
        const draft = structuredClone(locked.state);
        const returned: unknown = transform(draft);
        if (returned !== undefined) throw new InputError('State transform must be synchronous and return no value.');
        if (
            draft.stateVersion !== expectedStateVersion ||
            draft.contextId !== locked.state.contextId ||
            (mode === 'rebind'
                ? !sameLocator(draft.locator, context.locator)
                : !sameLocator(draft.locator, locked.state.locator))
        )
            throw new InputError('Transform may not change state version or context locator.');
        draft.stateVersion = integer(expectedStateVersion + 1);
        validateStateTransition(locked.state, draft, mode);
        const bytes = encodeState(draft);
        await publish(context.stateFile, bytes, locked, guard, io);
        return (await stateEvidence(context)).state;
    });
}
/** Narrow original-move entry; only the stored locator is replaced. */
export async function rebindState(
    context: LedgerContext,
    expectedStateVersion: number,
    declaration: { contextId: string; movedOriginal: boolean },
): Promise<WorktreeState> {
    if (declaration.movedOriginal !== true)
        throw new InputError('Rebind requires an explicit moved-original declaration.');
    return transaction(
        context,
        expectedStateVersion,
        (draft) => {
            if (draft.contextId !== declaration.contextId) throw new InputError('Rebind stored context ID mismatch.');
            draft.locator = structuredClone(context.locator);
        },
        {},
        'rebind',
    );
}
/** Explicit terminal selection; no generic deletion transform is exposed. */
export async function pruneState(
    context: LedgerContext,
    expectedStateVersion: number,
    ledgerIds: readonly string[],
): Promise<WorktreeState> {
    return transaction(
        context,
        expectedStateVersion,
        (draft) => {
            if (!ledgerIds.length || new Set(ledgerIds).size !== ledgerIds.length)
                throw new InputError('Prune requires a nonempty distinct selection.');
            for (const id of ledgerIds) {
                const ledger = draft.ledgers.find((item) => item.ledgerId === id);
                if (!ledger || !['sealed', 'abandoned'].includes(ledger.state))
                    throw new InputError('Prune requires selected terminal ledgers.');
                const missing = [...ledger.predecessorIds, ...ledger.successorIds].filter(
                    (linked) => !ledgerIds.includes(linked),
                );
                if (missing.length)
                    throw new InputError(`Prune requires complete terminal link closure: ${missing.join(', ')}`);
                if (draft.transfers.some((receipt) => receipt.phase === 'exporting' && receipt.ledgerIds.includes(id)))
                    throw new InputError('Pending export must finish before terminal prune.');
            }
            draft.ledgers = draft.ledgers.filter((item) => !ledgerIds.includes(item.ledgerId));
        },
        {},
        'prune',
    );
}
/** Import-only append with immutable receipts and collision checks; never replaces existing records. */
export async function importState(
    context: LedgerContext,
    expectedStateVersion: number,
    receipt: ImportReceipt,
    ledgers: PlannedLedger[],
    preparations: PreparedReceipt[],
    current: WorktreeState['current'],
): Promise<WorktreeState> {
    return transaction(
        context,
        expectedStateVersion,
        (draft) => {
            if (draft.imports.some((item) => item.transferId === receipt.transferId))
                throw new InputError('Transfer import already exists; reread before retry.');
            if (ledgers.some((ledger) => draft.ledgers.some((item) => item.ledgerId === ledger.ledgerId)))
                throw new InputError('Imported ledger ID collision.');
            for (const preparation of preparations) {
                const existing = draft.preparations.find((item) => item.preparationId === preparation.preparationId);
                if (existing && digest(existing) !== digest(preparation))
                    throw new InputError('Imported preparation ID collision.');
                if (!existing) draft.preparations.push(structuredClone(preparation));
            }
            draft.ledgers.push(...structuredClone(ledgers));
            draft.imports.push(structuredClone(receipt));
            if (!draft.current && current) draft.current = { ledgerId: current.ledgerId, paused: true };
        },
        {},
        'import',
    );
}
