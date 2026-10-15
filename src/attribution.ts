import { fileURLToPath } from 'node:url';
import { isMainModule } from '../tooling/cli-entry.ts';
import { readRegularFile } from '../tooling/file-evidence.ts';
import { INPUT_BYTES } from './input-contract.ts';
import { DECISION_MIGRATION } from './policy.ts';
import { checkRaw, InputError } from './records.ts';

export function parseArguments(args: readonly string[]): { input: string; operation: string } {
    const values = [...args];
    if (values.shift() !== 'summarize')
        throw new InputError('Usage: attribution.mjs summarize --input <ledger.json> --operation <operation.json>');
    const options = new Map<string, string>();
    while (values.length) {
        const flag = values.shift();
        const value = values.shift();
        if (
            !flag ||
            !['--input', '--operation'].includes(flag) ||
            options.has(flag) ||
            !value ||
            value.startsWith('--')
        )
            throw new InputError('Invalid input: unknown/duplicate flag or missing value.');
        options.set(flag, value);
    }
    const input = options.get('--input');
    const operation = options.get('--operation');
    if (!input || !operation)
        throw new InputError('Invalid input: explicit ledger and current operation files are required.');
    return { input, operation };
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
export async function run(args: readonly string[]) {
    if (args[0] === 'policy' || args.includes('--context')) throw new InputError(DECISION_MIGRATION);
    if (args[0] === 'render' || args[0] === 'validate') {
        const mode = args[0];
        const options = new Map<string, string>();
        for (let index = 1; index < args.length; index += 2) {
            const flag = args[index],
                value = args[index + 1];
            if (
                !flag ||
                !['--message', '--operation', '--decision', '--input', '--assessment', '--output'].includes(flag) ||
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
                const input = options.get('--input');
                if (!input) throw new InputError('Current skill-default message requires an explicit ledger input.');
                const registryFile = new URL('../references/agent-registry.json', import.meta.url);
                const assessment = options.get('--assessment');
                consumedPaths.push(input, fileURLToPath(registryFile), ...(assessment ? [assessment] : []));
                return {
                    ledger: await jsonFile(input),
                    registry: await jsonFile(registryFile),
                    ...(assessment ? { assessment: await jsonFile(assessment) } : {}),
                };
            },
        );
    }
    const options = parseArguments(args);
    const [ledger, operation, registry] = await Promise.all([
        jsonFile(options.input),
        jsonFile(options.operation),
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
