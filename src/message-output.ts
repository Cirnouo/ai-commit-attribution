import { type BigIntStats, constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { readRegularFile, samePhysicalPath } from '../tooling/file-evidence.ts';
import type { Binding } from './policy-contract.ts';
import { checkRaw, InputError } from './records.ts';
import { inspectPath, physical } from './runtime-support.ts';
import { inside } from './safe-git.ts';

/** Create only an absent new leaf; peer paths and any uncertain partial artifact remain untouched. */
export async function writeNewMessage(
    file: string,
    bytes: Buffer,
    binding: Binding,
    consumed: readonly string[],
    signal?: AbortSignal,
): Promise<string> {
    const cancelled = () => {
        if (signal?.aborted) throw new Error('Output publication cancelled.');
    };
    cancelled();
    checkRaw(file);
    if (!file) throw new InputError('Explicit output path is empty.');
    const destination = path.resolve(file);
    if (
        consumed.some((input) => samePhysicalPath(path.resolve(input), destination)) ||
        inside(binding.gitDirectory, destination) ||
        inside(binding.commonGitDir, destination) ||
        destination.split(path.sep).some((part) => part.toLowerCase() === '.git')
    )
        throw new InputError('Output aliases a consumed input or protected Git metadata.');
    let parent: string;
    try {
        if (await inspectPath(destination)) throw new Error('exists');
        parent = await physical(path.dirname(destination));
        if (!(await lstat(parent)).isDirectory()) throw new Error('parent');
    } catch {
        throw new InputError('Output requires an absent leaf and an existing safe physical parent directory.');
    }
    const before = await lstat(parent, { bigint: true });
    const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
    const unchanged = (a: BigIntStats, b: BigIntStats) =>
        same(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
    cancelled();
    const handle = await open(
        destination,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
    );
    let owned: BigIntStats | undefined;
    let cleanupState: BigIntStats | undefined;
    let complete = false;
    try {
        owned = await handle.stat({ bigint: true });
        if (
            !owned.isFile() ||
            owned.nlink !== 1n ||
            !same(owned, await lstat(destination, { bigint: true })) ||
            !same(before, await lstat(parent, { bigint: true })) ||
            !(await physical(parent))
        )
            throw new Error('Output identity changed during exclusive creation.');
        await handle.writeFile(bytes);
        await handle.sync();
        cancelled();
        const after = await handle.stat({ bigint: true });
        if (
            !same(owned, after) ||
            after.nlink !== 1n ||
            after.size !== BigInt(bytes.length) ||
            !unchanged(after, await lstat(destination, { bigint: true })) ||
            !same(before, await lstat(parent, { bigint: true }))
        )
            throw new Error('Output identity or length changed during writing.');
        await physical(destination);
        if (
            !(
                await readRegularFile(destination, { physicalPath: true, singleLink: true, maximumBytes: bytes.length })
            ).equals(bytes) ||
            !unchanged(after, await handle.stat({ bigint: true })) ||
            !unchanged(after, await lstat(destination, { bigint: true }))
        )
            throw new Error('Output bytes changed during publication.');
        // A failed or interrupted write has no exact known owned state and must leave its artifact intact.
        cleanupState = after;
        cancelled();
        await handle.close();
        cancelled();
        complete = true;
        return destination;
    } finally {
        if (!complete)
            await handle.close().catch(() => {
                /* Preserve the primary failure and attempt only owned cleanup. */
            });
        if (!complete && cleanupState) {
            try {
                const current = await lstat(destination, { bigint: true });
                if (
                    current.isFile() &&
                    current.nlink === 1n &&
                    unchanged(cleanupState, current) &&
                    same(before, await lstat(parent, { bigint: true }))
                ) {
                    const actual = await readRegularFile(destination, {
                        physicalPath: true,
                        singleLink: true,
                        maximumBytes: bytes.length,
                    });
                    const final = await lstat(destination, { bigint: true });
                    if (actual.equals(bytes) && unchanged(cleanupState, final)) await unlink(destination);
                }
            } catch {
                /* Uncertain ownership: preserve and report the failed output operation. */
            }
        }
    }
}
