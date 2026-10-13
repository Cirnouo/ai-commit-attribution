import { fileURLToPath } from 'node:url';
import { isMainModule } from '../tooling/cli-entry.ts';
import { readRegularFile } from '../tooling/file-evidence.ts';
import { InputError } from './records.ts';
import { summarize } from './summarize.ts';

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
        bytes = await readRegularFile(typeof file === 'string' ? file : fileURLToPath(file), { physicalPath: true });
    } catch {
        throw new InputError('Invalid input: cannot safely read the explicit JSON resource.');
    }
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
        throw new InputError('Invalid input: malformed UTF-8 JSON resource.');
    }
}
export async function run(args: readonly string[]): Promise<Awaited<ReturnType<typeof summarize>>> {
    const options = parseArguments(args);
    const [ledger, operation, registry] = await Promise.all([
        jsonFile(options.input),
        jsonFile(options.operation),
        jsonFile(new URL('../references/agent-registry.json', import.meta.url)),
    ]);
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
            JSON.stringify({ error: input ? error.message : 'Summary execution failed.', exitCode: input ? 2 : 1 }),
        );
        process.exitCode = input ? 2 : 1;
    }
}
