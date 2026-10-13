import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Metafile } from 'esbuild';
import { build } from 'esbuild';
import { errorCode, isRecord } from './errors.ts';
import { readRegularFile } from './file-evidence.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'tooling/security/dist');
export const SECURITY_OUTPUTS = Object.freeze(['THIRD-PARTY-NOTICES.txt', 'check-security.mjs']);
const LICENSES = Object.freeze([
    { name: 'yaml', version: '2.9.1', sha256: '5bba27375d93e9119f76c1015f7672cf9ad5f70952296e0842fb2243d6376869' },
    { name: 'semver', version: '7.8.5', sha256: '4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b' },
]);

export async function bundledPackageNames(metafile: Metafile, directory: string): Promise<string[]> {
    const names = new Set<string>();
    for (const input of Object.keys(metafile.inputs)) {
        if (!input.split(/[\\/]/).includes('node_modules')) continue;
        let current = path.dirname(path.resolve(directory, input));
        const boundary = path.resolve(directory);
        for (;;) {
            if (path.relative(boundary, current).startsWith('..') || current === path.dirname(current))
                throw new Error(`Bundled dependency metadata missing: ${input}`);
            try {
                const metadata: unknown = JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8'));
                if (isRecord(metadata) && typeof metadata.name === 'string') {
                    names.add(metadata.name);
                    break;
                }
            } catch (error) {
                if (!isRecord(error) || error.code !== 'ENOENT') throw error;
            }
            current = path.dirname(current);
        }
    }
    return [...names].sort();
}

export async function readSecurityNotices(dependencies: string, included: readonly string[]): Promise<Buffer> {
    const expected = LICENSES.map((dependency) => dependency.name).sort();
    if (JSON.stringify([...included].sort()) !== JSON.stringify(expected))
        throw new Error('Unreviewed bundled dependency inventory.');
    const notices: Buffer[] = [];
    for (const dependency of LICENSES) {
        const license = await readFile(path.join(dependencies, dependency.name, 'LICENSE'));
        const metadata: unknown = JSON.parse(
            await readFile(path.join(dependencies, dependency.name, 'package.json'), 'utf8'),
        );
        if (
            !isRecord(metadata) ||
            metadata.name !== dependency.name ||
            metadata.version !== dependency.version ||
            metadata.license !== 'ISC' ||
            createHash('sha256').update(license).digest('hex') !== dependency.sha256
        )
            throw new Error(`The bundled ${dependency.name} dependency license changed.`);
        if (notices.length) notices.push(Buffer.from('\n'));
        notices.push(Buffer.from(`--- ${dependency.name}@${dependency.version} (ISC) ---\n\n`), license);
    }
    return Buffer.concat(notices);
}

export async function generateSecurityFiles(): Promise<Map<string, Buffer>> {
    const result = await build({
        absWorkingDir: root,
        entryPoints: [path.join(root, 'tooling/check-security.ts')],
        outfile: path.join(output, 'check-security.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        packages: 'bundle',
        legalComments: 'none',
        minify: false,
        sourcemap: false,
        metafile: true,
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
        logLevel: 'warning',
        write: false,
    });
    const bundledFile = result.outputFiles[0];
    if (result.outputFiles.length !== 1 || !bundledFile || path.basename(bundledFile.path) !== 'check-security.mjs')
        throw new Error('The security build produced an unexpected output inventory.');
    const included = await bundledPackageNames(result.metafile, root);
    return new Map([
        ['check-security.mjs', Buffer.from(bundledFile.contents)],
        ['THIRD-PARTY-NOTICES.txt', await readSecurityNotices(path.join(root, 'node_modules'), included)],
    ]);
}

export async function verifySecurityFiles(directory: string, files: Map<string, Buffer>): Promise<void> {
    if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(SECURITY_OUTPUTS))
        throw new Error('Unexpected expected security inventory.');
    const stat = await lstat(directory);
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        path.relative(path.resolve(directory), await realpath(directory)) !== ''
    )
        throw new Error('Security output must be a physical directory without links.');
    const actual = await readdir(directory);
    if (JSON.stringify(actual.sort()) !== JSON.stringify(SECURITY_OUTPUTS))
        throw new Error('Unexpected physical security inventory.');
    for (const name of SECURITY_OUTPUTS) {
        const expected = files.get(name);
        const actualBytes = await readRegularFile(path.join(directory, name), { singleLink: true });
        if (!expected?.equals(actualBytes)) throw new Error(`Stale security build: ${name}; run pnpm build:security.`);
    }
}

/** Fail before writing if any existing output path can redirect or add bytes. */
export async function writeSecurityFiles(directory: string, files: Map<string, Buffer>): Promise<void> {
    if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(SECURITY_OUTPUTS))
        throw new Error('Unexpected expected security inventory.');
    let ancestor = path.resolve(directory);
    for (;;) {
        try {
            const stat = await lstat(ancestor);
            if (
                !stat.isDirectory() ||
                stat.isSymbolicLink() ||
                path.relative(ancestor, await realpath(ancestor)) !== ''
            )
                throw new Error('Security output must be a physical directory without links.');
            break;
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
            const parent = path.dirname(ancestor);
            if (parent === ancestor) throw error;
            ancestor = parent;
        }
    }
    try {
        for (const name of await readdir(directory)) {
            if (!SECURITY_OUTPUTS.includes(name))
                throw new Error('Unexpected physical security inventory before write.');
            const absolute = path.join(directory, name);
            const stat = await lstat(absolute);
            if (
                !stat.isFile() ||
                stat.nlink !== 1 ||
                stat.isSymbolicLink() ||
                path.relative(path.resolve(absolute), await realpath(absolute)) !== ''
            )
                throw new Error('Security output entries must be physical regular files without links.');
        }
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
    }
    await mkdir(directory, { recursive: true });
    for (const name of SECURITY_OUTPUTS) {
        const absolute = path.join(directory, name);
        let exists = true;
        try {
            await lstat(absolute);
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
            exists = false;
        }
        const flags =
            constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0) | (exists ? 0 : constants.O_CREAT | constants.O_EXCL);
        const handle = await open(absolute, flags, 0o644);
        try {
            const before = await handle.stat();
            const current = await lstat(absolute);
            if (
                !before.isFile() ||
                before.nlink !== 1 ||
                current.nlink !== 1 ||
                !current.isFile() ||
                current.isSymbolicLink() ||
                before.dev !== current.dev ||
                before.ino !== current.ino ||
                path.relative(path.resolve(absolute), await realpath(absolute)) !== ''
            )
                throw new Error('Security output file identity changed before writing.');
            const bytes = files.get(name);
            if (!bytes) throw new Error('Missing expected security output.');
            await handle.truncate(0);
            await handle.writeFile(bytes);
        } finally {
            await handle.close();
        }
    }
    await verifySecurityFiles(directory, files);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = await generateSecurityFiles();
    if (process.argv.includes('--check')) {
        await verifySecurityFiles(output, files);
        console.log('Committed security checker exactly matches source and physical inventory.');
    } else {
        await writeSecurityFiles(output, files);
        console.log('Standalone security checker built and verified.');
    }
}
