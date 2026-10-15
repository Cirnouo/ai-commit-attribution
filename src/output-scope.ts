import path from 'node:path';
import { samePhysicalPath } from '../tooling/file-evidence.ts';
import type { Operation } from './records.ts';
import { InputError } from './records.ts';
import { physicalDirectory } from './runtime-support.ts';
import { resolveTrustedGit, SafeGit } from './safe-git.ts';

export type OutputScope = { gitDirectory: string; commonGitDir: string };

/** Locate protected metadata only for a requested new-file publication; no operation-state observation. */
export async function resolveOutputScope(operation: Operation): Promise<OutputScope> {
    const worktree = await physicalDirectory(operation.worktree);
    const executable = await resolveTrustedGit([operation.repository, worktree, operation.commonGitDir]);
    const git = new SafeGit(executable, worktree);
    await git.guard();
    const top = await physicalDirectory(await git.text('rev-parse', ['--show-toplevel']));
    const gitDirectory = await physicalDirectory(await git.text('rev-parse', ['--absolute-git-dir']));
    const commonGitDir = await physicalDirectory(
        path.resolve(worktree, await git.text('rev-parse', ['--git-common-dir'])),
    );
    if (
        !samePhysicalPath(top, operation.repository) ||
        !samePhysicalPath(top, worktree) ||
        !samePhysicalPath(commonGitDir, operation.commonGitDir)
    )
        throw new InputError('Explicit output scope differs from the actual Git directories.');
    return { gitDirectory, commonGitDir };
}
