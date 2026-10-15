import { fileURLToPath } from 'node:url';
import { readRegularFile } from '../tooling/file-evidence.ts';
import { INPUT_BYTES } from './input-contract.ts';
import {
    abandonLedger,
    addIdentities,
    blockLedger,
    createLedger,
    pauseLedger,
    type ReplacementLedger,
    removeIdentities,
    reopenLedger,
    replaceLedgers,
    resumeLedger,
    selectLedger,
    unblockLedger,
} from './ledger.ts';
import { array, integer, object, parseBlocker, uuid, type WorktreeState } from './ledger-contract.ts';
import { initializeState, readState, resolveLedgerContext, transactState } from './ledger-store.ts';
import { checkRaw, InputError, parseIdentity, parseRegistry, type Registry, text } from './records.ts';

const commandFlags: Record<string, readonly string[]> = {
    init: [],
    status: [],
    create: ['--ledger', '--select', '--note', '--work'],
    select: ['--ledger'],
    add: ['--ledger', '--input'],
    remove: ['--ledger', '--input'],
    block: ['--ledger', '--input'],
    unblock: ['--ledger', '--blocker'],
    pause: ['--ledger'],
    resume: ['--ledger'],
    reopen: ['--ledger', '--reviewed-no-result'],
    abandon: ['--ledger'],
    split: ['--input'],
    combine: ['--input'],
};
const switches = ['--select', '--reviewed-no-result'];
export function parseLedgerArguments(args: readonly string[]): {
    command: string;
    options: Map<string, string | true>;
} {
    const command = args[0] ?? '';
    if (!Object.hasOwn(commandFlags, command)) throw new InputError('Unknown ledger command.');
    const mutation = command !== 'init' && command !== 'status';
    const allowed = ['--worktree', ...(mutation ? ['--expect-version'] : []), ...(commandFlags[command] ?? [])];
    const options = new Map<string, string | true>();
    for (let index = 1; index < args.length; index++) {
        const flag = args[index] ?? '';
        if (!allowed.includes(flag) || options.has(flag)) throw new InputError('Unknown or duplicate ledger flag.');
        if (switches.includes(flag)) options.set(flag, true);
        else {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new InputError('Ledger flag is missing its value.');
            checkRaw(value);
            options.set(flag, value);
        }
    }
    if (mutation) {
        const version = options.get('--expect-version');
        if (typeof version !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(version))
            throw new InputError('Ledger mutation requires --expect-version <nonnegative integer>.');
        integer(Number(version));
    }
    return { command, options };
}
async function json(file: string | URL): Promise<unknown> {
    const bytes = await readRegularFile(typeof file === 'string' ? file : fileURLToPath(file), {
        physicalPath: true,
        singleLink: true,
        maximumBytes: INPUT_BYTES,
    });
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new InputError('Ledger input must be strict UTF-8 JSON.');
    }
}
function output(value: unknown): ReplacementLedger {
    checkRaw(value);
    const data = object(value, ['ledgerId', 'identities', 'blockers', 'note', 'work']);
    return {
        ledgerId: uuid(data.ledgerId),
        identities: array(data.identities, parseIdentity),
        blockers: array(data.blockers, parseBlocker),
        ...(data.note === undefined ? {} : { note: text(data.note) }),
        ...(data.work === undefined ? {} : { work: text(data.work) }),
    };
}
/** args begin with the subcommand, after the root CLI's `ledger` token. */
export async function runLedger(
    args: readonly string[],
    loadRegistry: () => Promise<Registry> = async () =>
        parseRegistry(await json(new URL('../references/agent-registry.json', import.meta.url))),
): Promise<WorktreeState> {
    const { command, options } = parseLedgerArguments(args);
    const value = (flag: string) => {
        const found = options.get(flag);
        if (typeof found !== 'string') throw new InputError(`Ledger command requires ${flag}.`);
        return found;
    };
    const context = await resolveLedgerContext(
        typeof options.get('--worktree') === 'string' ? value('--worktree') : process.cwd(),
    );
    if (command === 'init') return initializeState(context);
    if (command === 'status') return readState(context);
    const version = Number(value('--expect-version'));
    let transform: (draft: WorktreeState) => void;
    if (command === 'create') {
        const ledgerId = options.has('--ledger') ? uuid(value('--ledger')) : undefined;
        transform = (draft) => {
            createLedger(draft, {
                ...(ledgerId === undefined ? {} : { ledgerId }),
                select: options.has('--select'),
                ...(options.has('--note') ? { note: value('--note') } : {}),
                ...(options.has('--work') ? { work: value('--work') } : {}),
            });
        };
    } else if (command === 'split' || command === 'combine') {
        const data = object(await json(value('--input')), ['sourceIds', 'outputs']);
        const sourceIds = array(data.sourceIds, uuid);
        const outputs = array(data.outputs, output);
        if (
            command === 'split'
                ? sourceIds.length !== 1 || outputs.length < 2
                : sourceIds.length < 2 || outputs.length !== 1
        )
            throw new InputError(
                'Split requires one source and at least two outputs; combine requires at least two sources and one output.',
            );
        const registry = await loadRegistry();
        transform = (draft) => {
            replaceLedgers(draft, sourceIds, outputs, registry);
        };
    } else {
        const ledgerId = uuid(value('--ledger'));
        if (command === 'add' || command === 'remove') {
            const data = object(await json(value('--input')), ['identities']);
            const identities = array(data.identities, parseIdentity);
            const registry = await loadRegistry();
            transform = (draft) => {
                (command === 'add' ? addIdentities : removeIdentities)(draft, ledgerId, identities, registry);
            };
        } else if (command === 'block') {
            const blocker = parseBlocker(await json(value('--input')));
            transform = (draft) => {
                blockLedger(draft, ledgerId, blocker);
            };
        } else if (command === 'unblock') {
            const blockerId = value('--blocker');
            transform = (draft) => {
                unblockLedger(draft, ledgerId, blockerId);
            };
        } else if (command === 'reopen') {
            transform = (draft) => {
                reopenLedger(draft, ledgerId, { reviewedNoResult: options.has('--reviewed-no-result') });
            };
        } else {
            const action = { select: selectLedger, pause: pauseLedger, resume: resumeLedger, abandon: abandonLedger }[
                command
            ];
            if (!action) throw new InputError('Unsupported ledger mutation.');
            transform = (draft) => {
                action(draft, ledgerId);
            };
        }
    }
    return transactState(context, version, transform);
}
