import { fileURLToPath } from 'node:url';
import { isMainModule } from '../tooling/cli-entry.ts';
import { readRegularFile } from '../tooling/file-evidence.ts';
import { checkFreshRouting, scanPolicy } from './policy.ts';
import { LIMITS } from './policy-contract.ts';
import { InputError } from './records.ts';

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
            maximumBytes: LIMITS.inputBytes,
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
export function parsePolicyArguments(args: readonly string[]): {
    operation: string;
    context: string;
    decision?: string;
} {
    if (args[0] !== 'policy' || args[1] !== 'scan')
        throw new InputError(
            'Usage: attribution.mjs policy scan --operation <operation.json> --context <context.json> [--decision <decision.json>]',
        );
    const options = new Map<string, string>();
    for (let index = 2; index < args.length; index += 2) {
        const flag = args[index],
            value = args[index + 1];
        if (
            !flag ||
            !['--operation', '--context', '--decision'].includes(flag) ||
            options.has(flag) ||
            !value ||
            value.startsWith('--')
        )
            throw new InputError('Invalid policy flag or missing value.');
        options.set(flag, value);
    }
    const operation = options.get('--operation'),
        context = options.get('--context'),
        decision = options.get('--decision');
    if (!operation || !context) throw new InputError('Policy scan requires explicit operation and scope context.');
    return { operation, context, ...(decision ? { decision } : {}) };
}
export async function run(args: readonly string[]) {
    if (args[0] === 'policy') {
        const options = parsePolicyArguments(args);
        const operation = await jsonFile(options.operation),
            context = await jsonFile(options.context);
        if (!options.decision) return scanPolicy({ operation, context });
        const { freshScan: _freshScan, ...route } = await checkFreshRouting({
            operation,
            context,
            decision: await jsonFile(options.decision),
        });
        return route;
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
            JSON.stringify({ error: input ? error.message : 'Attribution execution failed.', exitCode: input ? 2 : 1 }),
        );
        process.exitCode = input ? 2 : 1;
    }
}
