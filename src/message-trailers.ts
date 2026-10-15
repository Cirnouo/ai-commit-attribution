import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MessageRecord } from './message-contract.ts';
import { LIMITS } from './policy-contract.ts';
import { byteDigest, digest, physical, physicalDirectory } from './policy-scope.ts';
import { checkRaw, InputError } from './records.ts';
import { gitEnvironment, inside, resolveTrustedGit } from './safe-git.ts';

/** Non-repository trailer processing. SafeGit's observation-only allowlist stays separate. */
export async function runTrailers(
    message: Buffer,
    options: {
        excluded: readonly string[];
        additions?: readonly string[];
        environment?: NodeJS.ProcessEnv;
        signal?: AbortSignal;
    },
): Promise<Buffer> {
    if (message.length > LIMITS.inputBytes) throw new InputError('Message byte budget exceeded.');
    options.additions?.forEach(checkRaw);
    const executable = await resolveTrustedGit(options.excluded, options.environment);
    const parent = await physicalDirectory(await realpath(os.tmpdir()));
    if (options.excluded.some((root) => inside(root, parent)))
        throw new Error('Trailer temporary directory is inside an excluded scope.');
    const directory = await mkdtemp(path.join(parent, 'attribution-trailer-'));
    try {
        await physical(directory);
        const home = path.join(directory, 'home');
        await mkdir(home);
        const environment = {
            ...gitEnvironment(options.environment),
            HOME: home,
            USERPROFILE: home,
            XDG_CONFIG_HOME: home,
            GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
            GIT_CEILING_DIRECTORIES: parent,
            GIT_DISCOVERY_ACROSS_FILESYSTEM: '0',
        };
        const args = ['--no-optional-locks', 'interpret-trailers', '--no-divider'];
        if (options.additions !== undefined) {
            args.push('--where=end', '--if-exists=addIfDifferent', '--if-missing=add');
            for (const line of options.additions) {
                if (!line.startsWith('Assisted-by: ')) throw new InputError('Unsupported generated trailer key.');
                args.push('--trailer', line);
            }
        } else args.push('--parse');
        return await new Promise<Buffer>((resolve, reject) => {
            const child = execFile(
                executable,
                args,
                {
                    cwd: directory,
                    env: environment,
                    shell: false,
                    windowsHide: true,
                    encoding: 'buffer',
                    timeout: 10_000,
                    maxBuffer: LIMITS.inputBytes * 2,
                    ...(options.signal ? { signal: options.signal } : {}),
                },
                (error, stdout) => {
                    if (error)
                        reject(
                            new Error('Trailer processing failed, cancelled, timed out or exceeded its output budget.'),
                        );
                    else resolve(stdout);
                },
            );
            child.stdin?.on('error', () => {
                /* Spawn/exit callback owns the bounded failure. */
            });
            child.stdin?.end(message);
        });
    } finally {
        await removeTemporary(directory, parent);
    }
}
async function removeTemporary(directory: string, parent: string): Promise<void> {
    if (path.dirname(directory) !== parent || !path.basename(directory).startsWith('attribution-trailer-'))
        throw new Error('Unsafe trailer temporary cleanup.');
    await rm(directory, { recursive: true, force: true });
}

export function decodeMessage(bytes: Buffer): string {
    let message: string;
    try {
        message = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new InputError('Message must be strict UTF-8.');
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]|\r(?!\n)/u.test(message))
        throw new InputError('Message contains unsupported controls or line separators.');
    return message;
}
/** Inspect candidate original lines before Git can unfold or trim their raw fields. Body quotes stay document data. */
export function preflightAssisted(message: string): void {
    const lines = message.split(/\r?\n/);
    while (lines.at(-1)?.trim() === '') lines.pop();
    const start = lines.findLastIndex((line) => line.trim() === '');
    if (start < 0) return;
    const suffix = lines.slice(start + 1);
    if (!suffix.every((line) => /^[A-Za-z0-9][A-Za-z0-9 -]*?[ \t]*:/.test(line) || /^[ \t]/.test(line))) return;
    for (let index = 0; index < suffix.length; index++) {
        const line = suffix[index] ?? '';
        if (!/^assisted\s*-\s*by\s*:/i.test(line)) continue;
        checkRaw(line);
        if (/^[ \t]/.test(suffix[index + 1] ?? ''))
            throw new InputError('Folded Assisted-by is not a single-line record.');
    }
}
/** Span mapping is conservative: Git determines trailer semantics; ambiguous paragraphs are not rewritten. */
export function messageLayout(
    message: string,
    parsed: string,
): { records: MessageRecord[]; start: number; end: number; eol: string } {
    const lines = [...message.matchAll(/([^\n]*)(?:\n|$)/g)]
        .filter((match) => match[0] !== '')
        .map((match) => ({
            raw: match[0],
            text: (match[1] ?? '').replace(/\r$/, ''),
            start: match.index,
            end: match.index + match[0].length,
        }));
    const eol = [...message.matchAll(/\r?\n/g)].at(-1)?.[0] ?? '\n';
    let last = lines.length - 1;
    while (last >= 0 && lines[last]?.text.trim() === '') last--;
    let first = last;
    while (first > 0 && lines[first - 1]?.text.trim() !== '') first--;
    const suffix = lines.slice(first, last + 1);
    const records: MessageRecord[] = [];
    for (const line of suffix) {
        const match = /^([A-Za-z0-9][A-Za-z0-9 -]*?)[ \t]*:[ \t]*(.*)$/.exec(line.text);
        if (match?.[1] && match[2] !== undefined) {
            records.push({
                id: '',
                key: match[1],
                value: match[2],
                raw: line.raw,
                start: line.start,
                end: line.end,
                folded: false,
            });
        } else if (/^[ \t]/.test(line.text) && records.length) {
            const previous = records.at(-1);
            if (previous) {
                previous.raw += line.raw;
                previous.end = line.end;
                previous.folded = true;
            }
        } else if (parsed.trim()) throw new InputError('Ambiguous terminal trailer spans cannot be preserved safely.');
    }
    const hasAssisted = suffix.some((line) => /^assisted\s*-\s*by\s*:/i.test(line.text));
    if (!parsed.trim()) {
        if (
            hasAssisted &&
            first > 0 &&
            suffix.every((line) => /^[A-Za-z0-9][A-Za-z0-9 -]*?[ \t]*:/.test(line.text) || /^[ \t]/.test(line.text))
        )
            throw new InputError('Malformed terminal Assisted-by trailer block.');
        return { records: [], start: message.length, end: message.length, eol };
    }
    if (first === 0 || records.length !== parsed.trimEnd().split('\n').length)
        throw new InputError('Ambiguous terminal trailer structure cannot be preserved safely.');
    for (const record of records)
        record.id = digest([
            'message-record-v1',
            byteDigest(Buffer.from(message)),
            record.start,
            record.end,
            record.raw,
        ]);
    const endings = new Set(records.flatMap((record) => [...record.raw.matchAll(/\r?\n/g)].map((match) => match[0])));
    if (endings.size > 1)
        throw new InputError('Mixed terminal trailer line endings require a decision before rewriting.');
    return {
        records,
        start: suffix[0]?.start ?? message.length,
        end: suffix.at(-1)?.end ?? message.length,
        eol: [...endings][0] ?? eol,
    };
}

export function reconcileSpans(
    message: string,
    layout: ReturnType<typeof messageLayout>,
    removed: ReadonlySet<string>,
    additions: readonly string[],
): string {
    if (!removed.size && !additions.length) return message;
    if (!layout.records.length) {
        if (!additions.length) return message;
        let prefix = message;
        if (!prefix.endsWith('\n')) prefix += layout.eol;
        if (!/\r?\n[ \t]*\r?\n$/.test(prefix)) prefix += layout.eol;
        return prefix + additions.join(layout.eol) + layout.eol;
    }
    const prefix = message.slice(0, layout.start);
    let retained = layout.records
        .filter((record) => !removed.has(record.id))
        .map((record) => record.raw)
        .join('');
    if (additions.length) {
        if (retained && !retained.endsWith('\n')) retained += layout.eol;
        retained += additions.join(layout.eol);
        if (message.slice(0, layout.end).endsWith('\n')) retained += layout.eol;
    }
    return prefix + retained + message.slice(layout.end);
}
