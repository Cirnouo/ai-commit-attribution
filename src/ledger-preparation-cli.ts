import { readRegularFile } from '../tooling/file-evidence.ts';
import { INPUT_BYTES } from './input-contract.ts';
import { integer, uuid } from './ledger-contract.ts';
import { finishLedger, type PreparationResult, prepareLedger } from './ledger-preparation.ts';
import { resolveLedgerContext } from './ledger-store.ts';
import { checkRouting } from './policy.ts';
import { checkRaw, InputError, type Registry } from './records.ts';

const flags = {
    prepare: [
        '--worktree',
        '--ledger',
        '--expect-version',
        '--message',
        '--operation',
        '--decision',
        '--result-plan',
        '--output',
        '--assessment',
    ],
    finish: ['--worktree', '--ledger', '--preparation', '--sha', '--review', '--expect-version', '--assessment'],
};
export function parsePreparationArguments(args: readonly string[]): {
    command: 'prepare' | 'finish';
    options: Map<string, string>;
} {
    const command = args[0];
    if (command !== 'prepare' && command !== 'finish') throw new InputError('Unknown preparation command.');
    const options = new Map<string, string>();
    for (let index = 1; index < args.length; index++) {
        const flag = args[index] ?? '',
            value = args[++index];
        if (!flags[command].includes(flag) || options.has(flag) || !value || value.startsWith('--'))
            throw new InputError('Unknown, duplicate or missing preparation flag.');
        checkRaw(value);
        options.set(flag, value);
    }
    const version = options.get('--expect-version');
    if (!version || !/^(?:0|[1-9][0-9]*)$/.test(version))
        throw new InputError('Preparation requires --expect-version <nonnegative integer>.');
    integer(Number(version));
    const required =
        command === 'prepare'
            ? ['--ledger', '--message', '--operation', '--decision', '--result-plan', '--output']
            : ['--ledger', '--preparation', '--sha', '--review'];
    if (required.some((flag) => !options.has(flag)))
        throw new InputError('Preparation command is missing a required flag.');
    return { command, options };
}
async function bytes(file: string): Promise<Buffer> {
    return readRegularFile(file, { physicalPath: true, singleLink: true, maximumBytes: INPUT_BYTES });
}
async function json(file: string): Promise<unknown> {
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(file)));
    } catch {
        throw new InputError('Lifecycle input must be bounded strict UTF-8 JSON.');
    }
}
/** Args begin with the root prepare or finish command. Assessment loading stays branch-lazy. */
export async function runPreparation(
    args: readonly string[],
    loadRegistry?: (consumedPaths: string[]) => Promise<Registry>,
): Promise<PreparationResult> {
    const { command, options } = parsePreparationArguments(args);
    const get = (flag: string) => {
        const value = options.get(flag);
        if (value === undefined) throw new InputError('Required preparation option missing.');
        return value;
    };
    const directory = options.get('--worktree') ?? process.cwd(),
        version = Number(get('--expect-version'));
    const ledgerId = uuid(get('--ledger'));
    const assessment = options.get('--assessment');
    const defaults =
        assessment === undefined
            ? {}
            : {
                  loadAssessment: (consumedPaths: string[]) => {
                      consumedPaths.push(assessment);
                      return json(assessment);
                  },
              };
    if (command === 'finish') {
        const context = await resolveLedgerContext(directory);
        return finishLedger(context, version, {
            ledgerId,
            preparationId: uuid(get('--preparation')),
            sha: get('--sha'),
            review: await json(get('--review')),
            ...defaults,
        });
    }
    // Route before reading optional default evidence. Required lifecycle inputs are bounded metadata.
    const operation = await json(get('--operation')),
        decision = await json(get('--decision'));
    const route = await checkRouting({ operation, decision });
    if (route.branch === 'needs-decision')
        return { artifact: 'ledger-preparation', ledgerId, status: 'needs-decision', exitCode: 20 };
    const context = await resolveLedgerContext(directory);
    return prepareLedger(context, version, {
        ledgerId,
        operation,
        decision,
        resultPlan: await json(get('--result-plan')),
        messageBuffer: await bytes(get('--message')),
        output: get('--output'),
        consumedPaths: [get('--operation'), get('--decision'), get('--result-plan'), get('--message')],
        ...(loadRegistry ? { loadRegistry } : {}),
        ...defaults,
    });
}
