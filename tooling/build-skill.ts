import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseRegistry } from '../src/records.ts';
import { bundledPackageNames } from './build-security.ts';
import { isMainModule } from './cli-entry.ts';
import { errorCode, errorMessage, isRecord } from './errors.ts';
import { readRegularFile } from './file-evidence.ts';
import { parseOwnedYaml } from './owned-yaml.ts';
import { PACKAGING_FILES, PACKAGING_RESOURCES, SKILL_DIRECTORIES, SKILL_FILES, SKILL_ROOT } from './skill-inventory.ts';
import { isSemVer } from './version-policy.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, SKILL_ROOT);
const namesEqual = (actual: readonly string[], expected: readonly string[]) =>
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

export function skillFrontmatter(source: string): Record<string, unknown> {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
    if (!match?.[1]) throw new Error('Skill requires one YAML frontmatter block.');
    const value = parseOwnedYaml(match[1], { name: 'Skill frontmatter', documents: 'single' })[0];
    if (
        !isRecord(value) ||
        value.name !== 'ai-commit-attribution' ||
        typeof value.description !== 'string' ||
        !value.description.trim()
    )
        throw new Error('Invalid Skill entry metadata.');
    return value;
}
export function validateSkillLinks(files: Map<string, Buffer>): void {
    const consumed = new Set<string>();
    for (const [name, bytes] of files) {
        if (!name.endsWith('.md')) continue;
        for (const match of bytes.toString('utf8').matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
            const link = match[1];
            if (!link) continue;
            if (/^https:\/\//.test(link)) continue;
            if (/^(?:[a-z]+:|\/|\\)/i.test(link) || link.includes('\\'))
                throw new Error('Escaping installed resource link.');
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), link.split('#')[0] ?? ''));
            if (target.startsWith('../') || !files.has(target))
                throw new Error('Missing or escaping installed resource link.');
            consumed.add(target);
        }
    }
    for (const name of SKILL_FILES)
        if (name !== 'SKILL.md' && !consumed.has(name))
            throw new Error('Installed inventory has an unconsumed resource.');
}

/** The runtime graph is intentionally built-ins only. Any new third-party inclusion requires reviewed original notices. */
export function skillNotices(included: readonly string[]): Buffer {
    if (included.length)
        throw new Error('Unreviewed bundled runtime dependencies; preserve original licenses before adoption.');
    return Buffer.from('No third-party runtime code is included in this Skill bundle.\n');
}
export async function readPackagingInputs(packaging: string): Promise<Map<string, Buffer>> {
    if (!namesEqual(await readdir(packaging), PACKAGING_FILES))
        throw new Error('Unexpected maintained packaging inventory.');
    const inputs = new Map<string, Buffer>();
    for (const name of PACKAGING_FILES)
        inputs.set(name, await readRegularFile(path.join(packaging, name), { physicalPath: true }));
    return inputs;
}
export async function generateSkillFiles(): Promise<Map<string, Buffer>> {
    const inputs = await readPackagingInputs(path.join(root, 'packaging'));
    const manifest: unknown = JSON.parse((await readRegularFile(path.join(root, 'package.json'))).toString('utf8'));
    if (!isRecord(manifest) || !isSemVer(manifest.version)) throw new Error('Root version is invalid.');
    const source = inputs.get('SKILL.md')?.toString('utf8') ?? '';
    const metadata = skillFrontmatter(source);
    if (!namesEqual(Object.keys(metadata), ['name', 'description']))
        throw new Error('Packaging frontmatter must not create a second version or host metadata authority.');
    const entry = source.replace(/\n---\n/, `\nmetadata:\n    version: ${manifest.version}\n---\n`);
    parseRegistry(JSON.parse(inputs.get('agent-registry.json')?.toString('utf8') ?? 'null'));
    const result = await build({
        absWorkingDir: root,
        entryPoints: [path.join(root, 'src/attribution.ts')],
        outfile: path.join(output, 'scripts/attribution.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        packages: 'bundle',
        legalComments: 'none',
        minify: false,
        sourcemap: false,
        metafile: true,
        logLevel: 'warning',
        write: false,
    });
    const bundled = result.outputFiles[0];
    if (result.outputFiles.length !== 1 || !bundled || path.basename(bundled.path) !== 'attribution.mjs')
        throw new Error('Unexpected business bundle inventory.');
    const files = new Map<string, Buffer>([
        ['LICENSE', await readRegularFile(path.join(root, 'LICENSE'))],
        ['SKILL.md', Buffer.from(entry)],
        ['THIRD-PARTY-NOTICES.txt', skillNotices(await bundledPackageNames(result.metafile, root))],
        ['scripts/attribution.mjs', Buffer.from(bundled.contents)],
    ]);
    for (const [input, target] of PACKAGING_RESOURCES) {
        const bytes = inputs.get(input);
        if (!bytes) throw new Error('Missing maintained packaging resource.');
        files.set(target, bytes);
    }
    if (!namesEqual([...files.keys()], SKILL_FILES)) throw new Error('Unexpected expected Skill inventory.');
    validateSkillLinks(files);
    return files;
}

async function physicalDirectory(directory: string): Promise<void> {
    const info = await lstat(directory);
    if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        path.relative(path.resolve(directory), await realpath(directory)) !== ''
    )
        throw new Error('Skill directories must be physical without links.');
}
async function inspectTree(directory: string, complete: boolean): Promise<Map<string, { dev: number; ino: number }>> {
    const identities = new Map<string, { dev: number; ino: number }>();
    let ancestor = path.resolve(directory);
    for (;;) {
        try {
            await physicalDirectory(ancestor);
            break;
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
            ancestor = path.dirname(ancestor);
        }
    }
    const seen: string[] = [];
    async function visit(relative: string): Promise<void> {
        const absolute = path.join(directory, relative);
        try {
            await physicalDirectory(absolute);
        } catch (error) {
            if (!complete && errorCode(error) === 'ENOENT') return;
            throw error;
        }
        const info = await lstat(absolute);
        identities.set(relative, { dev: info.dev, ino: info.ino });
        const children = await readdir(absolute);
        if (relative && children.length === 0) throw new Error('Unexpected empty Skill inventory directory.');
        for (const child of children) {
            const name = relative ? `${relative}/${child}` : child;
            if ((SKILL_DIRECTORIES as readonly string[]).includes(name)) {
                await visit(name);
                continue;
            }
            if (!(SKILL_FILES as readonly string[]).includes(name))
                throw new Error('Unexpected physical Skill inventory.');
            await readRegularFile(path.join(directory, name), { physicalPath: true, singleLink: true });
            seen.push(name);
        }
    }
    await visit('');
    if (complete && !namesEqual(seen, SKILL_FILES)) throw new Error('Missing physical Skill inventory.');
    return identities;
}
export async function verifySkillFiles(directory: string, files: Map<string, Buffer>): Promise<void> {
    if (!namesEqual([...files.keys()], SKILL_FILES)) throw new Error('Unexpected expected Skill inventory.');
    await inspectTree(directory, true);
    for (const name of SKILL_FILES) {
        const bytes = await readRegularFile(path.join(directory, name), { physicalPath: true, singleLink: true });
        if (!files.get(name)?.equals(bytes)) throw new Error(`Stale Skill build: ${name}; run pnpm build:skill.`);
    }
    validateSkillLinks(files);
}
/** Preflight the entire nested tree before any mutation; fresh inodes preserve open descriptors and peer bytes. */
export async function writeSkillFiles(directory: string, files: Map<string, Buffer>): Promise<void> {
    if (!namesEqual([...files.keys()], SKILL_FILES)) throw new Error('Unexpected expected Skill inventory.');
    const target = path.resolve(directory);
    const initial = await inspectTree(target, false);
    await mkdir(path.dirname(target), { recursive: true });
    const staging = await mkdtemp(path.join(path.dirname(target), '.skill-build-'));
    try {
        await physicalDirectory(staging);
        for (const name of SKILL_DIRECTORIES) await mkdir(path.join(staging, name));
        for (const name of SKILL_FILES) {
            const handle = await open(path.join(staging, name), 'wx', 0o644);
            try {
                await handle.writeFile(files.get(name) ?? Buffer.alloc(0));
                await handle.sync();
            } finally {
                await handle.close();
            }
        }
        await verifySkillFiles(staging, files);
        const current = await inspectTree(target, false);
        if (JSON.stringify([...initial]) !== JSON.stringify([...current]))
            throw new Error('Skill directory identity changed before publication.');
        await mkdir(target, { recursive: true });
        for (const name of SKILL_DIRECTORIES) await mkdir(path.join(target, name), { recursive: true });
        for (const name of SKILL_FILES) await rename(path.join(staging, name), path.join(target, name));
    } finally {
        await removeStaging(staging, path.dirname(target));
    }
    await verifySkillFiles(target, files);
}
async function removeStaging(staging: string, parent: string): Promise<void> {
    if (path.dirname(staging) !== parent || !path.basename(staging).startsWith('.skill-build-'))
        throw new Error('Unsafe Skill staging cleanup path.');
    await rm(staging, { recursive: true, force: true });
}
if (isMainModule(import.meta)) {
    try {
        if (process.argv.slice(2).some((value) => value !== '--check') || process.argv.length > 3)
            throw new Error('Usage: build-skill.ts [--check]');
        const files = await generateSkillFiles();
        if (process.argv.includes('--check')) await verifySkillFiles(output, files);
        else await writeSkillFiles(output, files);
        console.log('Skill build and independent physical inventory verified.');
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
