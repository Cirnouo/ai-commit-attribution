import { fileURLToPath } from 'node:url';
import { isMainModule } from '../tooling/cli-entry.ts';
import { readRegularFile } from '../tooling/file-evidence.ts';
import { INPUT_BYTES } from './input-contract.ts';
import { DECISION_MIGRATION } from './policy.ts';
import { checkRaw, InputError, parseOperation } from './records.ts';

type LedgerSource = { input?: string; ledger?: string; current?: string };
function ledgerSource(options: Map<string, string>, required: boolean): LedgerSource {
    const supplied = ['--input', '--ledger', '--current'].filter((flag) => options.has(flag));
    if (supplied.length > 1 || (required && supplied.length !== 1))
        throw new InputError('Supply exactly one explicit input, ledger ID or current worktree selector.');
    const flag = supplied[0];
    return flag ? { [flag.slice(2)]: options.get(flag) } : {};
}

export function parseArguments(args: readonly string[]): LedgerSource & { operation: string } {
    const values = [...args];
    if (values.shift() !== 'summarize')
        throw new InputError(
            'Usage: attribution.mjs summarize (--input <json> | --ledger <UUID> | --current <worktree>) --operation <json>',
        );
    const options = new Map<string, string>();
    while (values.length) {
        const flag = values.shift();
        const value = values.shift();
        if (
            !flag ||
            !['--input', '--ledger', '--current', '--operation'].includes(flag) ||
            options.has(flag) ||
            !value ||
            value.startsWith('--')
        )
            throw new InputError('Invalid input: unknown/duplicate flag or missing value.');
        checkRaw(value);
        options.set(flag, value);
    }
    const operation = options.get('--operation');
    if (!operation) throw new InputError('Invalid input: a current operation file is required.');
    return { ...ledgerSource(options, true), operation };
}
async function jsonFile(file: string | URL): Promise<unknown> {
    let bytes: Buffer;
    try {
        bytes = await readRegularFile(typeof file === 'string' ? file : fileURLToPath(file), {
            physicalPath: true,
            maximumBytes: INPUT_BYTES,
        });
    } catch {
        throw new InputError('Invalid input: cannot safely read the explicit JSON resource.');
    }
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
        throw new InputError('Invalid input: malformed UTF-8 JSON resource.');
    }
}
async function loadLedger(source: LedgerSource, operationValue: unknown, consumed: string[]): Promise<unknown> {
    if (source.input) {
        consumed.push(source.input);
        return jsonFile(source.input);
    }
    if (!source.ledger && !source.current)
        throw new InputError(
            'Current skill-default message requires an explicit input, ledger ID or current worktree.',
        );
    const operation = await parseOperation(operationValue);
    const { resolveLedgerContext, readState } = await import('./ledger-store.ts');
    const { selectedLedgerSnapshot } = await import('./ledger.ts');
    const context = await resolveLedgerContext(source.current ?? operation.worktree);
    const state = await readState(context);
    consumed.push(context.stateFile);
    return selectedLedgerSnapshot(state, operation, source.ledger, source.current !== undefined);
}
export async function run(args: readonly string[]) {
    if (args[0] === 'policy' || args.includes('--context')) throw new InputError(DECISION_MIGRATION);
    if (args[0] === 'ledger') {
        const { runLedger } = await import('./ledger-cli.ts');
        return { exitCode: 0, ...(await runLedger(args.slice(1))) };
    }
    if (args[0] === 'render' || args[0] === 'validate') {
        const mode = args[0];
        const options = new Map<string, string>();
        for (let index = 1; index < args.length; index += 2) {
            const flag = args[index],
                value = args[index + 1];
            if (
                !flag ||
                ![
                    '--message',
                    '--operation',
                    '--decision',
                    '--input',
                    '--ledger',
                    '--current',
                    '--assessment',
                    '--output',
                ].includes(flag) ||
                options.has(flag) ||
                !value ||
                value.startsWith('--') ||
                (mode === 'validate' && flag === '--output')
            )
                throw new InputError('Invalid message flag, duplicate or missing value.');
            checkRaw(value);
            options.set(flag, value);
        }
        const messageFile = options.get('--message'),
            operationFile = options.get('--operation'),
            decisionFile = options.get('--decision');
        if (!messageFile || !operationFile || !decisionFile)
            throw new InputError(
                'Message commands require explicit message, operation and schemaVersion 2 AI decision files.',
            );
        const source = ledgerSource(options, false);
        const operation = await jsonFile(operationFile),
            decision = await jsonFile(decisionFile);
        const message = await readRegularFile(messageFile, { physicalPath: true, maximumBytes: INPUT_BYTES });
        // Unused default paths remain opaque. No stat, decode, registry lookup or summary occurs before actual routing.
        const consumedPaths = [messageFile, operationFile, decisionFile];
        const { processMessage } = await import('./message.ts');
        const output = options.get('--output');
        return processMessage(
            { mode, message, operation, decision, consumedPaths, ...(output ? { output } : {}) },
            async () => {
                const registryFile = new URL('../references/agent-registry.json', import.meta.url);
                const assessment = options.get('--assessment');
                consumedPaths.push(fileURLToPath(registryFile), ...(assessment ? [assessment] : []));
                return {
                    ledger: await loadLedger(source, operation, consumedPaths),
                    registry: await jsonFile(registryFile),
                    ...(assessment ? { assessment: await jsonFile(assessment) } : {}),
                };
            },
        );
    }
    const options = parseArguments(args);
    const operation = await jsonFile(options.operation);
    const [ledger, registry] = await Promise.all([
        loadLedger(options, operation, []),
        jsonFile(new URL('../references/agent-registry.json', import.meta.url)),
    ]);
    const { summarize } = await import('./summarize.ts');
    return summarize(ledger, operation, registry);
}
if (isMainModule(import.meta)) {
    try {
        const result = await run(process.argv.slice(2));
        console.log(JSON.stringify(result, null, 4));
        process.exitCode = result.exitCode;
    } catch (error) {
        const input = error instanceof InputError;
        console.error(
            JSON.stringify({
                error: input
                    ? error.message
                    : process.argv.includes('--output')
                      ? 'Attribution execution failed. Check the explicit output location for a residual artifact; uncertain ownership is preserved.'
                      : 'Attribution execution failed.',
                exitCode: input ? 2 : 1,
            }),
        );
        process.exitCode = input ? 2 : 1;
    }
}
