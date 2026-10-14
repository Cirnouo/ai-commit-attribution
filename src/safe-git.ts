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
const objectId = (value: string | undefined) => value !== undefined && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
/** Only argv forms used by the observer are accepted, including query modes of commands that can also write. */
function readOnlyArguments(command: string, args: string[]): boolean {
    switch (command) {
        case 'symbolic-ref':
            return sameArgs(args, ['--quiet', 'HEAD']);
        case 'rev-parse':
            return (
                (args.length === 1 &&
                    [
                        '--show-toplevel',
                        '--absolute-git-dir',
                        '--git-common-dir',
                        '--show-object-format',
                        '--shared-index-path',
                    ].includes(args[0] ?? '')) ||
                sameArgs(args, ['--verify', '--quiet', 'HEAD']) ||
                (args.length === 2 && args[0] === '--verify' && /^[a-f0-9]{4,64}\^\{commit\}$/.test(args[1] ?? ''))
            );
        case 'rev-list':
            return (
                args.length === 2 &&
                args[0] === '--max-count=10001' &&
                /^(?:[a-f0-9]{40}|[a-f0-9]{64})\.\.(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(args[1] ?? '')
            );
        case 'ls-files':
            return sameArgs(args, ['--stage', '-z']) || sameArgs(args, ['--cached', '-z']);
        case 'cat-file':
            return (
                args.length === 2 &&
                ((['-t', '-p'].includes(args[0] ?? '') && objectId(args[1])) ||
                    (args[0] === '-e' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})\^\{commit\}$/.test(args[1] ?? '')))
            );
        case 'diff':
            return (
                sameArgs(args, ['--cached', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--']) ||
                (args.length === 7 &&
                    sameArgs(args.slice(0, 4), ['--name-only', '-z', '--no-ext-diff', '--no-textconv']) &&
                    objectId(args[4]) &&
                    objectId(args[5]) &&
                    args[6] === '--')
            );
        case 'diff-tree': {
            const prefix = args.includes('-m')
                ? ['--root', '-m', '--no-commit-id', '--name-only', '-r', '-z', '--no-ext-diff', '--no-textconv']
                : ['--root', '--no-commit-id', '--name-only', '-r', '-z', '--no-ext-diff', '--no-textconv'];
            return (
                args.length === prefix.length + 2 &&
                sameArgs(args.slice(0, prefix.length), prefix) &&
                objectId(args[prefix.length]) &&
                args.at(-1) === '--'
            );
        }
        case 'config': {
            if (sameArgs(args.slice(0, 2), ['--no-includes', '--file']) && path.isAbsolute(args[2] ?? ''))
                return (
                    sameArgs(args.slice(3), ['--get-regexp', '^includeIf\\..*\\.path$']) ||
                    sameArgs(args.slice(3), ['--bool', '--get', 'extensions.worktreeConfig'])
                );
            return (
                args.length === 6 &&
                sameArgs(args.slice(0, 3), ['--no-includes', '--null', '--file']) &&
                path.isAbsolute(args[3] ?? '') &&
                args[4] === '--get-all' &&
                ['core.hooksPath', 'commit.template', 'include.path'].includes(args[5] ?? '')
            );
        }
        default:
            return false;
    }
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
        return new TextDecoder('utf-8', { fatal: true })
            .decode(await this.run(command, args, allowMissing))
            .replace(/\r?\n$/, '');
    }
}
