import { createHash } from 'node:crypto';
import type { BigIntStats, Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, isRecord } from '../tooling/errors.ts';
import { samePhysicalPath } from '../tooling/file-evidence.ts';
import { ordinal } from './records.ts';
import { ObservationError } from './safe-git.ts';

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
export function sameObserved(left: Stats, right: Stats): boolean {
    return (
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.mode === right.mode &&
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs
    );
}
/** Initial absence is allowed only after every existing ancestor was lstat-checked without following links. */
export async function inspectPath(file: string): Promise<Stats | undefined> {
    return inspectPathIdentity(file, (locator) => lstat(locator), sameObserved);
}
async function inspectPathIdentity<T extends Stats | BigIntStats>(
    file: string,
    read: (locator: string) => Promise<T>,
    same: (left: T, right: T) => boolean,
): Promise<T | undefined> {
    const absolute = path.resolve(file);
    let initial: T | undefined;
    try {
        initial = await read(absolute);
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
    }
    const root = path.parse(absolute).root;
    const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
    const observed: { locator: string; info: T }[] = [];
    let missing: string | undefined;
    let current = root;
    for (let index = -1; index < parts.length; index++) {
        if (index >= 0) current = path.join(current, parts[index] ?? '');
        // Node on Windows reports EISDIR for lstat of an extended drive root; its ordinary root is identical.
        const locator =
            index === -1 && current.startsWith('\\\\?\\') && current.length === 7 && current[5] === ':'
                ? current.slice(4)
                : current;
        let info: T;
        try {
            info = await read(locator);
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
            if (initial) throw new ObservationError('Observed present path disappeared during component checks.');
            missing = current;
            break;
        }
        if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory()))
            throw new ObservationError('Observed path has a linked or non-directory ancestor/component.');
        observed.push({ locator, info });
    }
    for (const item of observed) {
        const after = await read(item.locator);
        if (
            after.isSymbolicLink() ||
            item.info.dev !== after.dev ||
            item.info.ino !== after.ino ||
            item.info.mode !== after.mode
        )
            throw new ObservationError('Observed path component identity changed.');
    }
    if (!initial) {
        if (!missing) throw new ObservationError('Initially absent path appeared during component checks.');
        try {
            await read(missing);
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return undefined;
            throw error;
        }
        throw new ObservationError('Initially absent path component appeared during checks.');
    }
    const final = observed.at(-1);
    const unchanged = final && same(initial, final.info);
    if (!final || final.locator !== absolute || !unchanged)
        throw new ObservationError('Observed path identity changed during component checks.');
    return initial;
}
export async function physical(file: string): Promise<string> {
    if (!(await inspectPath(file))) throw new ObservationError('Observed physical path is missing.');
    const actual = await realpath(file);
    if (!samePhysicalPath(file, actual))
        throw new ObservationError('Observed path contains a link or is not physical.');
    return actual;
}
/** Shared temporary parents need stable physical directory identity, not stable child metadata. */
export async function physicalDirectory(file: string): Promise<string> {
    const info = await inspectPathIdentity(
        file,
        (locator) => lstat(locator, { bigint: true }),
        (initial, final) =>
            initial.isDirectory() &&
            final.isDirectory() &&
            initial.dev === final.dev &&
            initial.ino === final.ino &&
            initial.mode === final.mode,
    );
    if (!info?.isDirectory()) throw new ObservationError('Observed physical directory is missing or not a directory.');
    const actual = await realpath(file);
    if (!samePhysicalPath(file, actual))
        throw new ObservationError('Observed directory contains a link or is not physical.');
    return actual;
}
