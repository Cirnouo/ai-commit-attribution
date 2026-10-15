import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export class ObservationError extends Error {}
export function inside(root: string, target: string): boolean {
    const relative = path.relative(
        path.toNamespacedPath(path.resolve(root)),
        path.toNamespacedPath(path.resolve(target)),
    );
    return (
        relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    );
}
/** Host installation roots, independent of cwd/PATH. Environment here is the host bootstrap environment, never repository data. */
export async function resolveTrustedGit(excluded: readonly string[], environment = process.env): Promise<string> {
    const windowsRoot = (name: string) => {
        const values = Object.entries(environment)
            .filter(([key]) => key.toLowerCase() === name)
            .map(([, value]) => value);
        if (new Set(values).size > 1)
            throw new ObservationError('Conflicting Windows host installation root environment keys.');
        return values[0];
    };
    const candidates =
        process.platform === 'win32'
            ? [windowsRoot('programfiles'), windowsRoot('programfiles(x86)')]
                  .filter((item): item is string => !!item && path.isAbsolute(item))
                  .map((base) => path.join(base, 'Git/cmd/git.exe'))
            : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
    for (const candidate of candidates) {
        try {
            const actual = await realpath(candidate);
            if (excluded.some((root) => inside(root, actual)) || !(await lstat(actual)).isFile()) continue;
            return actual;
        } catch {
            /* Try only the other reviewed host installation roots. */
        }
    }
    throw new ObservationError('Trusted Git installation unavailable; no PATH or cwd lookup fallback.');
}
export function gitEnvironment(environment = process.env): NodeJS.ProcessEnv {
    const result = Object.fromEntries(
        Object.entries(environment).filter(
            ([key]) => !/^(?:GIT_|HOME$|USERPROFILE$|XDG_|SSH_|NODE_OPTIONS$|NODE_PATH$|LD_|DYLD_)/i.test(key),
        ),
    );
    return {
        ...result,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_NO_LAZY_FETCH: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        GIT_ALLOW_PROTOCOL: '',
        LC_ALL: 'C',
    };
}
const sameArgs = (actual: readonly string[], expected: readonly string[]) =>
    actual.length === expected.length && actual.every((value, index) => value === expected[index]);
/** Fixed metadata queries and the two exact ledger exclusion observations; never arbitrary Git argv. */
function readOnlyArguments(command: string, args: string[]): boolean {
    return (
        (command === 'rev-parse' &&
            (['--show-toplevel', '--absolute-git-dir', '--git-common-dir'].some((option) => sameArgs(args, [option])) ||
                sameArgs(args, ['--path-format=absolute', '--git-path', 'info/exclude']))) ||
        (command === 'ls-files' && sameArgs(args, ['--cached', '--full-name', '-z'])) ||
        (command === 'check-ignore' &&
            sameArgs(args, ['--no-index', '--', '.ai-commit-attribution/', '.ai-commit-attribution/state.json']))
    );
}
export class SafeGit {
    readonly executable: string;
    readonly directory: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly started = performance.now();
    constructor(executable: string, directory: string, environment = process.env) {
        if (!path.isAbsolute(executable)) throw new ObservationError('Git executable must be trusted and absolute.');
        this.executable = executable;
        this.directory = directory;
        this.environment = gitEnvironment(environment);
    }
    async #execute(args: string[], allowMissing = false): Promise<Buffer> {
        const remaining = 30_000 - (performance.now() - this.started);
        if (remaining <= 0) throw new ObservationError('Git observation total time budget exceeded.');
        return new Promise((resolve, reject) => {
            const child = execFile(
                this.executable,
                args,
                {
                    cwd: this.directory,
                    env: this.environment,
                    encoding: 'buffer',
                    windowsHide: true,
                    shell: false,
                    timeout: Math.min(10_000, remaining),
                    maxBuffer: 4 * 1024 * 1024,
                },
                (error, stdout) => {
                    if (error && !(allowMissing && 'code' in error && error.code === 1))
                        reject(
                            new ObservationError(
                                'Git observation failed, timed out, exceeded output budget or required object is unavailable.',
                            ),
                        );
                    else resolve(stdout);
                },
            );
            child.stdin?.end();
        });
    }
    async guard(): Promise<void> {
        await this.#execute(['--no-lazy-fetch', '--version']);
    }
    async run(command: string, args: string[], allowMissing = false): Promise<Buffer> {
        if (!readOnlyArguments(command, args)) throw new ObservationError('Unsupported read-only Git argv.');
        return this.#execute(
            [
                '--no-lazy-fetch',
                '--no-optional-locks',
                // check-ignore accepts fixed pathnames, not Git pathspec magic (including literal).
                ...(command === 'check-ignore' ? [] : ['--literal-pathspecs']),
                '-c',
                'core.fsmonitor=false',
                '-c',
                'core.untrackedCache=false',
                '-c',
                'core.pager=cat',
                '-c',
                'core.quotePath=false',
                '-c',
                'diff.external=',
                '-c',
                'core.hooksPath=',
                command,
                ...args,
            ],
            allowMissing,
        );
    }
    async text(command: string, args: string[], allowMissing = false): Promise<string> {
        return new TextDecoder('utf-8', { fatal: true })
            .decode(await this.run(command, args, allowMissing))
            .replace(/\r?\n$/, '');
    }
}
