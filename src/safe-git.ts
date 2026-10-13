import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export class ObservationError extends Error {}
export function inside(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return (
        relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    );
}
/** Host installation roots, independent of cwd/PATH. Environment here is the host bootstrap environment, never repository data. */
export async function resolveTrustedGit(excluded: readonly string[], environment = process.env): Promise<string> {
    const candidates =
        process.platform === 'win32'
            ? [environment.ProgramFiles, environment['ProgramFiles(x86)']]
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
const COMMANDS = new Set(['rev-parse', 'symbolic-ref', 'ls-files', 'diff', 'diff-tree', 'cat-file', 'config']);
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
        if (!COMMANDS.has(command))
            throw new ObservationError('Git command is outside the read-only observation allowlist.');
        if (command === 'config') {
            const queryKeys = [
                'core.hooksPath',
                'commit.template',
                'include.path',
                'extensions.worktreeConfig',
                '^includeIf\\..*\\.path$',
            ];
            const options = args.filter((_, index) => index !== args.indexOf('--file') + 1);
            if (
                !args.includes('--no-includes') ||
                !args.includes('--file') ||
                !args.some((value) => ['--get', '--get-all', '--get-regexp'].includes(value)) ||
                options.some(
                    (value) =>
                        ![
                            '--no-includes',
                            '--null',
                            '--file',
                            '--get',
                            '--get-all',
                            '--get-regexp',
                            '--bool',
                            ...queryKeys,
                        ].includes(value),
                )
            )
                throw new ObservationError('Git configuration query is outside the policy-locator read allowlist.');
        }
        if (args.some((value) => /^--(?:output|ext-diff|textconv|filters)(?:=|$)/.test(value)))
            throw new ObservationError('Git execution/write option is prohibited.');
        return this.#execute(
            [
                '--no-lazy-fetch',
                '--no-optional-locks',
                '--literal-pathspecs',
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
        return new TextDecoder('utf-8', { fatal: true }).decode(await this.run(command, args, allowMissing)).trim();
    }
}
