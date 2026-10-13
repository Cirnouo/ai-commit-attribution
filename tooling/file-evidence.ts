import { type BigIntStats, constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

interface EvidenceHandle {
    stat(): Promise<BigIntStats>;
    readFile(): Promise<Buffer>;
    close(): Promise<void>;
}

function sameFile(expected: BigIntStats, actual: BigIntStats) {
    return actual.isFile() && !actual.isSymbolicLink() && expected.dev === actual.dev && expected.ino === actual.ino;
}

function unchanged(expected: BigIntStats, actual: BigIntStats) {
    return (
        sameFile(expected, actual) &&
        expected.size === actual.size &&
        expected.mtimeNs === actual.mtimeNs &&
        expected.ctimeNs === actual.ctimeNs
    );
}

/** Regular-file evidence I/O, shared by release and review fingerprint verification. */
export async function readRegularFile(
    file: string,
    io: {
        lstat?: (file: string) => Promise<BigIntStats>;
        open?: (file: string, flags: number) => Promise<EvidenceHandle>;
    } = {},
): Promise<Buffer> {
    const inspect = io.lstat ?? ((name) => lstat(name, { bigint: true }));
    const acquire =
        io.open ??
        (async (name, flags) => {
            const handle = await open(name, flags);
            return {
                stat: () => handle.stat({ bigint: true }),
                readFile: () => handle.readFile(),
                close: () => handle.close(),
            };
        });
    // Unix rejects final-component links and opens special files without waiting.
    // Windows does not expose these flags; descriptor/path evidence remains mandatory.
    const handle = await acquire(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const before = await handle.stat();
        if (!before.isFile()) throw new Error('Evidence must be a regular file without links.');
        if (!unchanged(before, await inspect(file))) throw new Error('Evidence file identity or metadata changed.');
        const bytes = await handle.readFile();
        if (
            !unchanged(before, await handle.stat()) ||
            !unchanged(before, await inspect(file)) ||
            BigInt(bytes.length) !== before.size
        )
            throw new Error('Evidence file identity or metadata changed.');
        return bytes;
    } finally {
        await handle.close();
    }
}
