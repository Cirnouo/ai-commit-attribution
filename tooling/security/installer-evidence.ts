import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../errors.ts';
import { readRegularFile } from '../file-evidence.ts';
import type { LockInventory } from './audit-policy.ts';

const IDENTITY = Object.freeze({
    name: 'skills',
    version: '1.7.2',
    integrity: 'sha512-j+GzyF/oNahsjjjup6y3lJpFkC1lQjIkf4kAMXICA1hboBqi0fAGXAGoE4x9FRZiP1br/YE9+L3/Tqq6PIAe0A==',
    gitHead: '671e8c320810d36fed80fac5f1a2c1bf7e82d812',
});
export function verifyInstallerRegistry(metadata: unknown): void {
    if (
        !isRecord(metadata) ||
        !isRecord(metadata.dist) ||
        metadata.name !== IDENTITY.name ||
        metadata.version !== IDENTITY.version ||
        metadata.gitHead !== IDENTITY.gitHead ||
        metadata.dist.integrity !== IDENTITY.integrity ||
        metadata.dist.fileCount !== 19 ||
        metadata.dist.tarball !== 'https://registry.npmjs.org/skills/-/skills-1.7.2.tgz'
    )
        throw new Error('Published skills installer registry identity changed.');
}

export async function verifyInstallerEvidence(
    directory: string,
    inventory: LockInventory,
    data: unknown,
): Promise<void> {
    if (
        !isRecord(data) ||
        data.schemaVersion !== 1 ||
        !Array.isArray(data.files) ||
        data.files.length !== 19 ||
        data.name !== IDENTITY.name ||
        data.version !== IDENTITY.version ||
        data.gitHead !== IDENTITY.gitHead ||
        data.integrity !== IDENTITY.integrity ||
        !Array.isArray(data.noticeComponents) ||
        !data.files.every(
            (file) =>
                isRecord(file) &&
                typeof file.path === 'string' &&
                typeof file.bytes === 'number' &&
                Number.isSafeInteger(file.bytes) &&
                file.bytes > 0 &&
                typeof file.sha256 === 'string' &&
                /^[a-f0-9]{64}$/.test(file.sha256) &&
                !file.path.includes('\\') &&
                !file.path.split('/').some((part: string) => ['', '.', '..', 'node_modules'].includes(part)),
        )
    )
        throw new Error('Invalid published installer evidence.');
    const locked = inventory.packages.find((entry) => entry.name === IDENTITY.name);
    if (!locked || locked.version !== IDENTITY.version || locked.integrity !== IDENTITY.integrity)
        throw new Error('Installer evidence differs from the locked package identity.');
    const actual: string[] = [];
    async function visit(relative: string): Promise<void> {
        const children = await readdir(path.join(directory, relative));
        if (relative && children.length === 0)
            throw new Error('Installer physical inventory contains an empty directory.');
        for (const name of children) {
            // pnpm supplies this installation-only dependency routing directory; it is outside the npm tarball.
            if (!relative && name === 'node_modules') continue;
            const file = relative ? `${relative}/${name}` : name;
            const stat = await lstat(path.join(directory, file));
            if (stat.isSymbolicLink()) throw new Error('Installer physical inventory contains a link.');
            if (stat.isDirectory()) await visit(file);
            else if (stat.isFile()) actual.push(file);
            else throw new Error('Installer physical inventory contains a nonregular file.');
        }
    }
    await visit('');
    const expected = data.files.map((file: { path: string }) => file.path);
    if (new Set(expected).size !== 19 || JSON.stringify(actual.sort()) !== JSON.stringify([...expected].sort()))
        throw new Error('Installer physical file inventory changed.');
    for (const file of data.files) {
        const bytes = await readRegularFile(path.join(directory, file.path));
        if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
            throw new Error(`Installer original bytes digest changed: ${file.path}`);
    }
    const metadata: unknown = JSON.parse(
        (await readRegularFile(path.join(directory, 'package.json'))).toString('utf8'),
    );
    if (
        !isRecord(metadata) ||
        metadata.name !== IDENTITY.name ||
        metadata.version !== IDENTITY.version ||
        metadata.license !== 'MIT'
    )
        throw new Error('Installer package metadata changed.');
    const notice = (await readRegularFile(path.join(directory, 'ThirdPartyNoticeText.txt'))).toString('utf8');
    const components = [...notice.matchAll(/^Package: (.+)$/gm)].map((match) => match[1]?.trim());
    if (components.length === 0 || JSON.stringify(components) !== JSON.stringify(data.noticeComponents))
        throw new Error('Installer original third-party notice component inventory changed.');
}
