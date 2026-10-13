import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord } from '../tooling/errors.ts';
import { readRegularFile } from '../tooling/file-evidence.ts';
import type { ScopeContext } from './policy-contract.ts';
import { LIMITS } from './policy-contract.ts';
import type { Operation } from './records.ts';
import { checkRaw, InputError, ordinal, unique } from './records.ts';
import { inside, ObservationError, resolveTrustedGit, SafeGit } from './safe-git.ts';

/** One deterministic, delimiter-free serialization owner for all scope/evidence bindings. */
export function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (isRecord(value))
        return Object.fromEntries(
            Object.keys(value)
                .sort(ordinal)
                .map((key) => [key, canonical(value[key])]),
        );
    return value;
}
export const digest = (value: unknown): string =>
    createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
export const byteDigest = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
export async function physical(file: string): Promise<string> {
    const actual = await realpath(file);
    if (path.relative(path.resolve(file), actual) !== '')
        throw new ObservationError('Observed path contains a link or is not physical.');
    return actual;
}
export async function fileState(file: string, maximumBytes = LIMITS.bytes): Promise<unknown> {
    try {
        const info = await lstat(file);
        if (info.isSymbolicLink()) throw new ObservationError('Observed path is a symbolic link/reparse point.');
        await physical(file);
        if (info.isDirectory()) return { type: 'directory' };
        if (!info.isFile()) throw new ObservationError('Observed path has an unsupported file type.');
        const bytes = await readRegularFile(file, { physicalPath: true, maximumBytes });
        return { type: 'file', size: bytes.length, sha256: byteDigest(bytes), executable: (info.mode & 0o111) !== 0 };
    } catch (error) {
        if (errorCode(error) === 'ENOENT') {
            // Check all existing ancestors, including links hiding an absent leaf.
            let ancestor = path.dirname(file);
            for (;;) {
                try {
                    await physical(ancestor);
                    break;
                } catch (problem) {
                    if (errorCode(problem) !== 'ENOENT') throw problem;
                }
                const parent = path.dirname(ancestor);
                if (parent === ancestor) throw error;
                ancestor = parent;
            }
            return { type: 'absent' };
        }
        throw error;
    }
}
function nulPaths(bytes: Buffer): string[] {
    const values = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0').filter(Boolean);
    values.forEach(checkRaw);
    if (values.length > LIMITS.paths) throw new ObservationError('Operation path budget exceeded.');
    return unique(values);
}
async function expand(directory: string, relative: string, output: string[], depth = 0): Promise<void> {
    if (output.length >= LIMITS.paths || depth > LIMITS.directoryLevels)
        throw new ObservationError('Directory/path enumeration budget exceeded.');
    const target = path.join(directory, relative);
    const state = await fileState(target);
    if (isRecord(state) && state.type === 'directory') {
        for (const child of (await readdir(target)).sort(ordinal)) {
            checkRaw(child);
            if (['.git', 'node_modules', '.pnpm', 'vendor'].includes(child)) continue;
            await expand(directory, `${relative}/${child}`, output, depth + 1);
        }
    } else output.push(relative);
}
export type CapturedScope = {
    git: SafeGit;
    worktree: string;
    gitDirectory: string;
    commonGitDir: string;
    paths: string[];
    gitStateDigest: string;
    pathStateDigest: string;
    invocationDigest: string;
    scopeDigest: string;
};
export async function captureScope(operation: Operation, context: ScopeContext): Promise<CapturedScope> {
    if (operation.paths.length > LIMITS.paths) throw new ObservationError('Operation path budget exceeded.');
    const invocation = context.invocation;
    if (invocation.kind === 'wrapper-adapter' && !['explicit-scope-v1'].includes(invocation.adapter ?? ''))
        throw new ObservationError('Unsupported wrapper adapter; actual input semantics require a decision.');
    const effective = await physical(invocation.effectiveDirectory);
    if (!(await lstat(effective)).isDirectory())
        throw new InputError('Invocation effectiveDirectory must be a physical directory.');
    const executable = await resolveTrustedGit([operation.repository, operation.worktree, operation.commonGitDir]);
    const git = new SafeGit(executable, effective);
    await git.guard();
    // Explicit --git-dir/--work-tree locators are reconstructed, never inherited from GIT_*.
    if (invocation.gitDirectory) git.environment.GIT_DIR = await physical(invocation.gitDirectory);
    if (invocation.worktreePath) git.environment.GIT_WORK_TREE = await physical(invocation.worktreePath);
    const top = await physical(await git.text('rev-parse', ['--show-toplevel']));
    const gitDirectory = await physical(await git.text('rev-parse', ['--absolute-git-dir']));
    const commonGitDir = await physical(path.resolve(effective, await git.text('rev-parse', ['--git-common-dir'])));
    if (
        top !== operation.repository ||
        top !== operation.worktree ||
        commonGitDir !== operation.commonGitDir ||
        (invocation.repositoryPath && (await physical(invocation.repositoryPath)) !== top) ||
        (invocation.worktreePath && (await physical(invocation.worktreePath)) !== top) ||
        (invocation.gitDirectory && (await physical(invocation.gitDirectory)) !== gitDirectory)
    )
        throw new InputError('Explicit operation/invocation scope differs from physical Git identity.');
    const format = await git.text('rev-parse', ['--show-object-format']);
    if (!['sha1', 'sha256'].includes(format)) throw new ObservationError('Unsupported repository object format.');
    const objectPattern = format === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/;
    const symbolic = await git.text('symbolic-ref', ['--quiet', 'HEAD'], true);
    const resolved = await git.text('rev-parse', ['--verify', '--quiet', 'HEAD'], true);
    let head: unknown;
    if (resolved) {
        if (!objectPattern.test(resolved)) throw new ObservationError('Invalid HEAD object identity.');
        if ((await git.text('cat-file', ['-t', resolved])) !== 'commit')
            throw new ObservationError('HEAD does not resolve to an available commit object.');
        head = {
            state: 'resolved',
            objectId: resolved,
            symbolic,
            parents: await git.text('cat-file', ['-p', resolved]),
        };
    } else {
        if (!symbolic.startsWith('refs/heads/') || operation.kind !== 'commit' || operation.targets.length)
            throw new ObservationError('Missing HEAD is not a supported unborn commit operation.');
        const refPath = path.join(commonGitDir, symbolic);
        const ref = await fileState(refPath);
        if (!isRecord(ref) || ref.type !== 'absent')
            throw new ObservationError('HEAD branch reference exists but cannot resolve.');
        head = { state: 'unborn', symbolic, ref };
    }
    const targets = [];
    const coverage: string[] = [];
    for (const target of operation.targets) {
        if (!objectPattern.test(target.objectId))
            throw new InputError('Target object format differs from repository format.');
        if (
            ['head', 'replaced'].includes(target.role) &&
            ['commit', 'amend', 'merge', 'cherry-pick'].includes(operation.kind) &&
            target.objectId !== resolved
        )
            throw new ObservationError('Supplied current/replaced target differs from observed HEAD.');
        const type = await git.text('cat-file', ['-t', target.objectId]);
        if (type !== 'commit') throw new ObservationError('Operation target must resolve to an available commit.');
        const commit = await git.text('cat-file', ['-p', target.objectId]);
        targets.push({ ...target, commit });
        coverage.push(
            ...nulPaths(
                await git.run('diff-tree', [
                    '--root',
                    '--no-commit-id',
                    '--name-only',
                    '-r',
                    '-z',
                    '--no-ext-diff',
                    '--no-textconv',
                    target.objectId,
                    '--',
                ]),
            ),
        );
    }
    const metadata: Record<string, unknown> = {};
    const names = [
        'HEAD',
        'CHERRY_PICK_HEAD',
        'MERGE_HEAD',
        'REBASE_HEAD',
        'ORIG_HEAD',
        'AUTO_MERGE',
        'MERGE_MSG',
        'SQUASH_MSG',
        'sequencer/head',
        'sequencer/todo',
        'sequencer/abort-safety',
        ...['rebase-merge', 'rebase-apply'].flatMap((dir) =>
            [
                'head-name',
                'orig-head',
                'onto',
                'git-rebase-todo',
                'done',
                'msgnum',
                'end',
                'stopped-sha',
                'next',
                'last',
                'original-commit',
            ].map((name) => `${dir}/${name}`),
        ),
    ];
    for (const name of names) metadata[name] = await fileState(path.join(gitDirectory, name), LIMITS.fileBytes);
    const present = (name: string) => isRecord(metadata[name]) && metadata[name].type !== 'absent';
    if (
        (present('MERGE_HEAD') && operation.kind !== 'merge') ||
        (present('CHERRY_PICK_HEAD') && operation.kind !== 'cherry-pick') ||
        (context.phase === 'edit-message' &&
            ((operation.kind === 'merge' && !present('MERGE_HEAD')) ||
                (operation.kind === 'cherry-pick' && !present('CHERRY_PICK_HEAD')) ||
                (operation.kind === 'rebase' &&
                    !present('REBASE_HEAD') &&
                    !present('rebase-merge/onto') &&
                    !present('rebase-apply/onto'))))
    )
        throw new ObservationError('Operation kind and active Git metadata are inconsistent or unsupported.');
    if (operation.kind !== 'commit' && !operation.targets.length)
        throw new ObservationError('This operation requires explicit resolved targets.');
    const objectMetadata = [
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REBASE_HEAD',
        'sequencer/head',
        'sequencer/abort-safety',
        ...['rebase-merge', 'rebase-apply'].flatMap((directory) =>
            ['orig-head', 'onto', 'stopped-sha', 'original-commit'].map((file) => `${directory}/${file}`),
        ),
    ];
    const activeObjects: { locator: string; objectId: string }[] = [];
    for (const name of objectMetadata) {
        if (!present(name)) continue;
        const ids = (
            await readRegularFile(path.join(gitDirectory, name), { maximumBytes: LIMITS.fileBytes, physicalPath: true })
        )
            .toString('utf8')
            .trim()
            .split(/\s+/);
        for (const id of ids) {
            if (!objectPattern.test(id))
                throw new ObservationError('Operation metadata contains invalid object identities.');
            if (
                ['MERGE_HEAD', 'CHERRY_PICK_HEAD'].includes(name) &&
                !operation.targets.some((target) => target.objectId === id)
            )
                throw new ObservationError('Supplied targets omit the actual merge/cherry-pick source.');
            await git.run('cat-file', ['-e', `${id}^{commit}`]);
            activeObjects.push({ locator: name, objectId: id });
            coverage.push(
                ...nulPaths(
                    await git.run('diff-tree', [
                        '--root',
                        '--no-commit-id',
                        '--name-only',
                        '-r',
                        '-z',
                        '--no-ext-diff',
                        '--no-textconv',
                        id,
                        '--',
                    ]),
                ),
            );
        }
    }
    for (const name of [
        'sequencer/todo',
        'rebase-merge/git-rebase-todo',
        'rebase-merge/done',
        'rebase-apply/git-rebase-todo',
        'rebase-apply/done',
    ]) {
        if (!present(name)) continue;
        const contents = new TextDecoder('utf-8', { fatal: true }).decode(
            await readRegularFile(path.join(gitDirectory, name), {
                maximumBytes: LIMITS.fileBytes,
                physicalPath: true,
            }),
        );
        for (const line of contents.split(/\r?\n/)) {
            if (!line.trim() || line.trimStart().startsWith('#')) continue;
            const match = /^(?:pick|reword|edit|squash|fixup|drop)\s+(?:-[cC]\s+)?([a-f0-9]{4,64})(?:\s|$)/.exec(line);
            if (!match?.[1])
                throw new ObservationError('Unsupported sequencer/rebase instruction requires a decision.');
            const id = await git.text('rev-parse', ['--verify', `${match[1]}^{commit}`]);
            if (!objectPattern.test(id))
                throw new ObservationError('Sequencer source cannot resolve to a supported commit.');
            activeObjects.push({ locator: name, objectId: id });
            coverage.push(
                ...nulPaths(
                    await git.run('diff-tree', [
                        '--root',
                        '--no-commit-id',
                        '--name-only',
                        '-r',
                        '-z',
                        '--no-ext-diff',
                        '--no-textconv',
                        id,
                        '--',
                    ]),
                ),
            );
        }
    }
    if (operation.kind === 'squash') {
        const base = operation.targets.find((target) => target.role === 'base');
        const last = operation.targets.find((target) => target.role === 'head' || target.role === 'source');
        if (!base || !last) throw new ObservationError('Squash requires resolved base and head/source target roles.');
        coverage.push(
            ...nulPaths(
                await git.run('diff', [
                    '--name-only',
                    '-z',
                    '--no-ext-diff',
                    '--no-textconv',
                    base.objectId,
                    last.objectId,
                    '--',
                ]),
            ),
        );
    }
    const index = await fileState(path.join(gitDirectory, 'index'));
    const shared = await git.text('rev-parse', ['--shared-index-path']);
    const splitIndex = shared ? await fileState(path.resolve(effective, shared)) : { type: 'absent' };
    const entries = await git.run('ls-files', ['--stage', '-z']);
    const applicable = [...operation.paths];
    if (context.selection === 'index')
        applicable.push(
            ...nulPaths(
                await git.run('diff', ['--cached', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--']),
            ),
        );
    if (context.selection === 'all-tracked')
        applicable.push(...nulPaths(await git.run('ls-files', ['--cached', '-z'])));
    if (context.selection === 'operation-targets' || !['commit', 'amend'].includes(operation.kind))
        applicable.push(...coverage);
    if (['planned-paths', 'specified-paths'].includes(context.selection) && !operation.paths.length)
        throw new ObservationError('Planned/specified selection needs explicit intended paths.');
    const expanded: string[] = [];
    for (const relative of unique(applicable)) {
        const target = path.resolve(top, relative);
        if (!inside(top, target) || relative.split('/').some((part) => part === '.git'))
            throw new InputError('Selected path escapes operation worktree or selects Git metadata.');
        await expand(top, relative, expanded);
    }
    const paths = unique([...applicable, ...expanded]);
    if (paths.length > LIMITS.paths) throw new ObservationError('Operation path budget exceeded.');
    const states = [];
    let bytes = 0;
    for (const relative of paths) {
        const absolute = path.join(top, relative);
        const state = await fileState(absolute, LIMITS.bytes - bytes);
        if (isRecord(state) && typeof state.size === 'number') bytes += state.size;
        states.push({ path: relative, state });
        // An existing nested repository changes instruction applicability; never borrow the outer scope.
        let parent = isRecord(state) && state.type === 'directory' ? absolute : path.dirname(absolute);
        while (parent !== top && inside(top, parent)) {
            if (
                isRecord(await fileState(path.join(parent, '.git'))) &&
                ((await fileState(path.join(parent, '.git'))) as { type: string }).type !== 'absent'
            )
                throw new InputError('Selected path belongs to a nested repository.');
            parent = path.dirname(parent);
        }
    }
    const gitStateDigest = digest({
        format,
        head,
        targets,
        activeObjects,
        index,
        splitIndex,
        entries: byteDigest(entries),
        metadata,
    });
    const pathStateDigest = digest({ paths: states });
    const invocationDigest = digest(context.invocation);
    const scopeDigest = digest({
        version: 1,
        operation,
        context,
        top,
        gitDirectory,
        commonGitDir,
        gitStateDigest,
        pathStateDigest,
        invocationDigest,
    });
    return {
        git,
        worktree: top,
        gitDirectory,
        commonGitDir,
        paths,
        gitStateDigest,
        pathStateDigest,
        invocationDigest,
        scopeDigest,
    };
}
