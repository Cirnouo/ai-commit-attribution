import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { errorCode } from '../tooling/errors.ts';
import { readRegularFile, samePhysicalPath } from '../tooling/file-evidence.ts';
import { INPUT_BYTES } from './input-contract.ts';
import type { Operation } from './records.ts';
import { fullObjectId, parseResultPlan, type ResultPlan } from './result-contract.ts';
import { byteDigest, inspectPath, physicalDirectory, sameObserved } from './runtime-support.ts';
import { gitEnvironment, inside, ObservationError, resolveTrustedGit } from './safe-git.ts';
import { isLedgerStatePath } from './state-path.ts';

type Format = 'sha1' | 'sha256';
type Entry = { name: Buffer; mode: number; oid: string; stage: number; sparse?: boolean };
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
function fail(detail: string): never {
    throw new ObservationError(`Result observation failed: ${detail}.`);
}
function id(value: unknown, format: Format): string {
    try {
        return fullObjectId(value, format === 'sha1' ? 40 : 64);
    } catch {
        fail('invalid full storage object ID');
    }
}
function line(bytes: Buffer): string {
    const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/^[^\r\n]+\r?\n$/.test(result)) fail('invalid single-line Git response');
    return result.replace(/\r?\n$/, '');
}
/** Private transport: only fixed templates below call this, never caller argv. */
class ResultGit {
    readonly executable: string;
    directory: string;
    readonly started = performance.now();
    readonly environment = gitEnvironment();
    consumed = 0;
    constructor(executable: string, directory: string) {
        this.executable = executable;
        this.directory = directory;
    }
    async run(args: string[], input?: string, accepted = [0]): Promise<{ bytes: Buffer; code: number }> {
        const remaining = 30_000 - (performance.now() - this.started);
        if (remaining <= 0) fail('time budget exceeded');
        if (input !== undefined && (!/^(?:[a-f0-9]{40}\n|[a-f0-9]{64}\n)+$/.test(input) || input.length > MAX_BYTES))
            fail('invalid object query');
        return new Promise((resolve, reject) => {
            const child = execFile(
                this.executable,
                [
                    '--no-pager',
                    '--no-replace-objects',
                    '--no-lazy-fetch',
                    '--no-optional-locks',
                    '--literal-pathspecs',
                    '-c',
                    'core.fsmonitor=false',
                    '-c',
                    'core.untrackedCache=false',
                    '-c',
                    'core.hooksPath=',
                    '-c',
                    'core.pager=cat',
                    '-c',
                    'diff.external=',
                    ...args,
                ],
                {
                    cwd: this.directory,
                    env: this.environment,
                    shell: false,
                    windowsHide: true,
                    encoding: 'buffer',
                    timeout: Math.min(10_000, remaining),
                    maxBuffer: MAX_BYTES,
                },
                (error, stdout, stderr) => {
                    const code =
                        error && 'code' in error && typeof error.code === 'number' ? error.code : error ? -1 : 0;
                    this.consumed += stdout.length + stderr.length;
                    if (!accepted.includes(code) || this.consumed > 64 * 1024 * 1024)
                        reject(
                            new ObservationError(
                                'Git observation failed, timed out, exceeded output budget or required object is unavailable.',
                            ),
                        );
                    else resolve({ bytes: stdout, code });
                },
            );
            child.stdin?.on('error', () => {
                /* execFile reports bounded child failure. */
            });
            child.stdin?.end(input);
        });
    }
    async text(args: string[]): Promise<string> {
        return line((await this.run(args)).bytes);
    }
    async format(): Promise<Format> {
        const format = await this.text(['rev-parse', '--show-object-format=storage']);
        if (format !== 'sha1' && format !== 'sha256') fail('unsupported object format');
        return format;
    }
    async head(format: Format): Promise<string | null> {
        const head = await this.run(
            ['rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD'],
            undefined,
            [0, 1],
        );
        if (head.code === 0) {
            const oid = id(line(head.bytes), format);
            await this.objects([oid], format, 'commit');
            return oid;
        }
        if (head.bytes.length) fail('unexpected missing HEAD output');
        const reference = await this.text(['symbolic-ref', '--quiet', 'HEAD']);
        if (
            !reference.startsWith('refs/heads/') ||
            /[\x00-\x20\x7f~^:?*[\\]/u.test(reference) ||
            reference.includes('@{') ||
            reference.includes('..') ||
            reference.endsWith('/') ||
            reference.includes('//') ||
            reference.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock') || part.endsWith('.'))
        )
            fail('invalid unborn branch');
        const exists = await this.run(['show-ref', '--exists', reference], undefined, [0, 2]);
        if (exists.code !== 2) fail('HEAD is not a valid unborn branch');
        return null;
    }
    async objects(oids: string[], format: Format, type: 'blob' | 'commit'): Promise<void> {
        const unique = [...new Set(oids)];
        if (!unique.length) return;
        if (unique.length > MAX_ENTRIES) fail('object count budget exceeded');
        for (const oid of unique) id(oid, format);
        const output = (
            await this.run(
                ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
                `${unique.join('\n')}\n`,
            )
        ).bytes
            .toString('ascii')
            .split('\n');
        if (output.pop() !== '' || output.length !== unique.length) fail('invalid object metadata framing');
        output.forEach((value, index) => {
            const match = /^([a-f0-9]+) (blob|commit|tree|tag) ([0-9]+)$/.exec(value);
            if (!match || match[1] !== unique[index] || match[2] !== type || !Number.isSafeInteger(Number(match[3])))
                fail('missing object or wrong object type');
        });
        if (type === 'blob') {
            const bytes = (await this.run(['cat-file', '--batch'], `${unique.join('\n')}\n`)).bytes;
            let cursor = 0;
            for (const oid of unique) {
                const end = bytes.indexOf(10, cursor);
                if (end < cursor) fail('invalid blob framing');
                const header = /^([a-f0-9]+) blob ([0-9]+)$/.exec(bytes.subarray(cursor, end).toString('ascii'));
                const size = Number(header?.[2]);
                const finish = end + 1 + size;
                if (
                    !header ||
                    header[1] !== oid ||
                    !Number.isSafeInteger(size) ||
                    size > MAX_BYTES ||
                    finish >= bytes.length ||
                    bytes[finish] !== 10
                )
                    fail('invalid blob object or framing');
                if (
                    createHash(format)
                        .update(`blob ${size}\0`)
                        .update(bytes.subarray(end + 1, finish))
                        .digest('hex') !== oid
                )
                    fail('corrupt blob object');
                cursor = finish + 1;
            }
            if (cursor !== bytes.length) fail('unexpected blob batch bytes');
        }
    }
    async commit(oid: string, format: Format): Promise<{ tree: string; parents: string[]; message: Buffer }> {
        id(oid, format);
        const bytes = (await this.run(['cat-file', '--batch'], `${oid}\n`)).bytes;
        const end = bytes.indexOf(10);
        if (end < 0) fail('invalid commit framing');
        const header = /^([a-f0-9]+) commit ([0-9]+)$/.exec(bytes.subarray(0, end).toString('ascii'));
        const size = Number(header?.[2]);
        if (
            !header ||
            header[1] !== oid ||
            !Number.isSafeInteger(size) ||
            size > MAX_BYTES - 256 ||
            bytes.length !== end + 1 + size + 1 ||
            bytes.at(-1) !== 10
        )
            fail('invalid commit object or framing');
        const raw = bytes.subarray(end + 1, end + 1 + size);
        const separator = raw.indexOf(Buffer.from('\n\n'));
        if (createHash(format).update(`commit ${size}\0`).update(raw).digest('hex') !== oid)
            fail('corrupt commit object');
        if (separator < 0) fail('invalid raw commit header');
        let tree: string | undefined;
        const parents: string[] = [];
        let previous = false;
        for (const row of raw.subarray(0, separator).toString('latin1').split('\n')) {
            if (row.startsWith(' ')) {
                if (!previous) fail('orphan commit header continuation');
                continue;
            }
            if (!/^[a-zA-Z0-9-]+ [^\x00\r]*$/.test(row)) fail('malformed commit header');
            previous = true;
            if (row.startsWith('tree ')) {
                if (tree) fail('duplicate root tree');
                tree = id(row.slice(5), format);
            }
            if (row.startsWith('parent ')) {
                parents.push(id(row.slice(7), format));
                if (parents.length > MAX_ENTRIES) fail('parent count budget exceeded');
            }
        }
        if (!tree) fail('missing root tree');
        const message = Buffer.from(raw.subarray(separator + 2));
        if (message.length > INPUT_BYTES) fail('message byte budget exceeded');
        return { tree, parents, message };
    }
}
function pathCheck(name: Buffer, sparse = false): void {
    if (!name.length || name.includes(0) || name[0] === 47 || (process.platform === 'win32' && name.includes(92)))
        fail('invalid raw Git path');
    const raw = sparse && name.at(-1) === 47 ? name.subarray(0, -1) : name;
    const parts = raw.toString('latin1').split('/');
    if (parts.length > 256) fail('path depth budget exceeded');
    if (
        parts.some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') ||
        /^[A-Za-z]:/.test(parts[0] ?? '')
    )
        fail('unsafe raw Git path');
}
function leaves(entries: Entry[]): Entry[] {
    if (entries.length > MAX_ENTRIES) fail('entry count budget exceeded');
    const sorted = [...entries].sort((a, b) => Buffer.compare(a.name, b.name));
    const names = new Set<string>();
    for (const entry of sorted) {
        pathCheck(entry.name);
        if (![0o100644, 0o100755, 0o120000, 0o160000].includes(entry.mode) || entry.stage !== 0)
            fail('unsupported mode or unmerged entry');
        const key = entry.name.toString('hex');
        if (names.has(key)) fail('duplicate raw path');
        names.add(key);
        for (let index = entry.name.indexOf(47); index >= 0; index = entry.name.indexOf(47, index + 1))
            if (names.has(entry.name.subarray(0, index).toString('hex'))) fail('file and directory path conflict');
    }
    return sorted;
}
function integer(value: number): Buffer {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value);
    return bytes;
}
function manifest(entries: Entry[], format: Format): string {
    const hash = createHash('sha256')
        .update(`ai-commit-attribution:index-manifest:1\0${format}\0`)
        .update(integer(entries.length));
    for (const entry of leaves(entries))
        hash.update(integer(entry.name.length))
            .update(entry.name)
            .update(integer(entry.mode))
            .update(Buffer.from(entry.oid, 'hex'));
    return hash.digest('hex');
}
/** Computes canonical Git trees in memory, never writes objects or index. */
function treeId(entries: Entry[], format: Format): string {
    type Directory = Map<string, { name: Buffer; leaf?: Entry; directory?: Directory }>;
    const root: Directory = new Map();
    for (const entry of leaves(entries)) {
        const components: Buffer[] = [];
        let start = 0;
        for (let cursor = 0; cursor <= entry.name.length; cursor++)
            if (cursor === entry.name.length || entry.name[cursor] === 47) {
                components.push(entry.name.subarray(start, cursor));
                start = cursor + 1;
            }
        let current = root;
        components.forEach((name, index) => {
            const key = name.toString('hex');
            if (index === components.length - 1) current.set(key, { name, leaf: entry });
            else {
                let item = current.get(key);
                if (!item) {
                    item = { name, directory: new Map() };
                    current.set(key, item);
                }
                if (!item.directory) fail('tree path conflict');
                current = item.directory;
            }
        });
    }
    function encode(directory: Directory): string {
        const chunks = [...directory.values()]
            .sort((a, b) =>
                Buffer.compare(
                    Buffer.concat([a.name, a.directory ? Buffer.from('/') : Buffer.alloc(0)]),
                    Buffer.concat([b.name, b.directory ? Buffer.from('/') : Buffer.alloc(0)]),
                ),
            )
            .map((item) =>
                Buffer.concat([
                    Buffer.from(`${item.directory ? '40000' : item.leaf?.mode.toString(8)} `),
                    item.name,
                    Buffer.from([0]),
                    Buffer.from(item.directory ? encode(item.directory) : (item.leaf?.oid ?? ''), 'hex'),
                ]),
            );
        const body = Buffer.concat(chunks);
        return createHash(format).update(`tree ${body.length}\0`).update(body).digest('hex');
    }
    return encode(root);
}
function records(bytes: Buffer): Buffer[] {
    if (!bytes.length) return [];
    if (bytes.at(-1) !== 0) fail('unterminated raw path manifest');
    const rows: Buffer[] = [];
    let start = 0;
    for (let cursor = 0; cursor < bytes.length; cursor++)
        if (bytes[cursor] === 0) {
            rows.push(bytes.subarray(start, cursor));
            start = cursor + 1;
            if (rows.length > MAX_ENTRIES * 2) fail('manifest count budget exceeded');
        }
    return rows;
}
function parseStage(bytes: Buffer, format: Format): Entry[] {
    return leaves(
        records(bytes).map((row) => {
            const tab = row.indexOf(9);
            const match = /^([0-7]{6}) ([a-f0-9]+) ([0-3])$/.exec(row.subarray(0, tab).toString('ascii'));
            if (tab < 0 || !match) fail('invalid stage manifest');
            return {
                name: Buffer.from(row.subarray(tab + 1)),
                mode: Number.parseInt(match[1] ?? '', 8),
                oid: id(match[2], format),
                stage: Number(match[3]),
            };
        }),
    );
}
function parseIndex(bytes: Buffer, format: Format): Entry[] {
    const width = format === 'sha1' ? 20 : 32;
    const end = bytes.length - width;
    if (bytes.length < 12 + width || bytes.subarray(0, 4).toString('ascii') !== 'DIRC') fail('invalid index header');
    const version = bytes.readUInt32BE(4);
    const count = bytes.readUInt32BE(8);
    if (![2, 3, 4].includes(version) || count > MAX_ENTRIES) fail('unsupported index version or count');
    const checksum = bytes.subarray(end);
    if (
        checksum.some((byte) => byte !== 0) &&
        !createHash(format).update(bytes.subarray(0, end)).digest().equals(checksum)
    )
        fail('index checksum mismatch');
    let cursor = 12;
    let previous = Buffer.alloc(0);
    const result: Entry[] = [];
    function need(length: number): void {
        if (length < 0 || cursor + length > end) fail('truncated binary index');
    }
    for (let index = 0; index < count; index++) {
        const start = cursor;
        need(42 + width);
        const mode = bytes.readUInt32BE(cursor + 24);
        const oid = id(bytes.subarray(cursor + 40, cursor + 40 + width).toString('hex'), format);
        const flags = bytes.readUInt16BE(cursor + 40 + width);
        cursor += 42 + width;
        let extended = 0;
        if (flags & 0x4000) {
            if (version === 2) fail('extended flags in v2 index');
            need(2);
            extended = bytes.readUInt16BE(cursor);
            cursor += 2;
            if (extended & ~0x6000) fail('unsupported extended index flags');
        }
        if (extended & 0x2000) fail('intent-to-add index entry');
        const stage = (flags >>> 12) & 3;
        if (stage) fail('unmerged index');
        let remove = 0;
        if (version === 4) {
            need(1);
            let byte = bytes[cursor++] ?? 0;
            remove = byte & 0x7f;
            let groups = 1;
            while (byte & 0x80) {
                if (++groups > 5) fail('index v4 prefix integer overflow');
                need(1);
                byte = bytes[cursor++] ?? 0;
                remove = (remove + 1) * 128 + (byte & 0x7f);
            }
            if (remove > previous.length) fail('invalid index v4 prefix');
        }
        const nul = bytes.indexOf(0, cursor);
        if (nul < cursor || nul >= end) fail('unterminated binary index path');
        const name =
            version === 4
                ? Buffer.concat([previous.subarray(0, previous.length - remove), bytes.subarray(cursor, nul)])
                : Buffer.from(bytes.subarray(cursor, nul));
        cursor = nul + 1;
        if (version !== 4) {
            const padding = (8 - ((cursor - start) % 8)) % 8;
            need(padding);
            if (bytes.subarray(cursor, cursor + padding).some((byte) => byte !== 0)) fail('invalid index padding');
            cursor += padding;
        }
        if ((flags & 0xfff) !== Math.min(name.length, 0xfff)) fail('index path length flags mismatch');
        if (index > 0 && Buffer.compare(previous, name) >= 0) fail('binary index names are not in ascending order');
        const sparse = mode === 0o40000 && !!(extended & 0x4000) && name.at(-1) === 47;
        result.push({ name, mode, oid, stage, ...(sparse ? { sparse: true } : {}) });
        previous = name;
    }
    let sparseExtension = false;
    while (cursor < end) {
        need(8);
        const signature = bytes.subarray(cursor, cursor + 4).toString('latin1');
        const length = bytes.readUInt32BE(cursor + 4);
        cursor += 8;
        need(length);
        if (signature === 'link') fail('split index is unsupported');
        if (signature === 'sdir') {
            if (sparseExtension || length !== 0) fail('invalid sparse index extension');
            sparseExtension = true;
        } else if (!/^[A-Z]/.test(signature)) fail('unsupported required index extension');
        cursor += length;
    }
    if (result.some((entry) => entry.sparse) && !sparseExtension) fail('sparse index extension missing');
    const names = new Set<string>();
    for (const entry of result) {
        pathCheck(entry.name, entry.sparse);
        const key = entry.name.toString('hex');
        if (names.has(key)) fail('duplicate binary index path');
        names.add(key);
        if (!entry.sparse && ![0o100644, 0o100755, 0o120000, 0o160000].includes(entry.mode))
            fail('unsupported binary index mode');
    }
    return result;
}
async function indexSnapshot(file: string): Promise<{ bytes: Buffer | null; identity: Stats | undefined }> {
    const identity = await inspectPath(file);
    if (!identity) return { bytes: null, identity: undefined };
    if (!identity.isFile()) fail('index is not a physical regular file');
    try {
        const bytes = await readRegularFile(file, { physicalPath: true, maximumBytes: MAX_BYTES });
        if (!sameObserved(identity, await lstat(file))) fail('index changed during read');
        return { bytes, identity };
    } catch (error) {
        if (error instanceof ObservationError) throw error;
        fail(errorCode(error) === 'ENOENT' ? 'index disappeared' : 'unsafe or unreadable index');
    }
}
async function observer(
    directory: string,
): Promise<{ git: ResultGit; worktree: string; gitDir: string; commonGitDir: string }> {
    const physical = await physicalDirectory(directory);
    const git = new ResultGit(await resolveTrustedGit([physical]), physical);
    await git.run(['--version']);
    const worktree = await physicalDirectory(await git.text(['rev-parse', '--show-toplevel']));
    const gitDir = await physicalDirectory(await git.text(['rev-parse', '--absolute-git-dir']));
    const commonGitDir = await physicalDirectory(
        path.resolve(physical, await git.text(['rev-parse', '--git-common-dir'])),
    );
    if ((await resolveTrustedGit([worktree, gitDir, commonGitDir])) !== git.executable)
        fail('trusted Git scope changed');
    if (!inside(worktree, physical)) fail('current directory must be inside the physical worktree');
    git.directory = worktree;
    return { git, worktree, gitDir, commonGitDir };
}
async function actualTree(git: ResultGit, tree: string, format: Format): Promise<Entry[]> {
    const directories = new Map<string, Buffer>();
    const entries: Entry[] = [];
    for (const row of records((await git.run(['ls-tree', '-r', '-t', '-z', '--full-tree', tree])).bytes)) {
        const tab = row.indexOf(9);
        const match = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]+)$/.exec(row.subarray(0, tab).toString('ascii'));
        if (tab < 0 || !match) fail('invalid tree manifest');
        const name = Buffer.from(row.subarray(tab + 1));
        pathCheck(name);
        const mode = Number.parseInt(match[1] ?? '', 8);
        const oid = id(match[3], format);
        if (mode === 0o40000 && match[2] === 'tree') {
            const key = name.toString('hex');
            if (directories.has(key)) fail('duplicate tree directory');
            directories.set(key, name);
        } else {
            if (match[2] !== (mode === 0o160000 ? 'commit' : 'blob')) fail('tree mode/type mismatch');
            entries.push({ name, mode, oid, stage: 0 });
        }
    }
    const sorted = leaves(entries);
    const occupied = new Set<string>();
    for (const entry of sorted)
        for (let cursor = entry.name.indexOf(47); cursor >= 0; cursor = entry.name.indexOf(47, cursor + 1)) {
            const key = entry.name.subarray(0, cursor).toString('hex');
            if (!directories.has(key)) fail('missing tree ancestor');
            occupied.add(key);
        }
    for (const key of directories.keys()) if (!occupied.has(key)) fail('empty or inconsistent tree directory');
    if (treeId(sorted, format) !== tree) fail('noncanonical root tree');
    await git.objects(
        sorted.filter((entry) => entry.mode !== 0o160000).map((entry) => entry.oid),
        format,
        'blob',
    );
    return sorted;
}
export async function observePreparation(
    operation: Operation,
    inputPlan: ResultPlan,
): Promise<{ observedHead: string | null; objectFormat: Format; indexManifestSha256: string; expectedTree: string }> {
    const plan = parseResultPlan(inputPlan, operation);
    const scope = await observer(operation.worktree);
    const { git } = scope;
    if (
        !samePhysicalPath(scope.worktree, operation.repository) ||
        !samePhysicalPath(scope.worktree, operation.worktree) ||
        !samePhysicalPath(scope.commonGitDir, operation.commonGitDir)
    )
        fail('operation physical scope mismatch');
    const objectFormat = await git.format();
    const observedHead = await git.head(objectFormat);
    const oids = [
        ...plan.expectedParents,
        ...plan.sourceTargets.map((source) => source.objectId),
        ...(plan.replacementTarget ? [plan.replacementTarget] : []),
    ];
    await git.objects(oids, objectFormat, 'commit');
    if (plan.form === 'create') {
        if (observedHead === null ? plan.expectedParents.length !== 0 : plan.expectedParents[0] !== observedHead)
            fail('create parent must match observed HEAD');
    } else {
        if (!observedHead || plan.replacementTarget !== observedHead)
            fail('replacement target must match observed HEAD');
        const original = await git.commit(observedHead, objectFormat);
        if (JSON.stringify(original.parents) !== JSON.stringify(plan.expectedParents))
            fail('replacement ordered parents mismatch');
    }
    const index = await git.text(['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    if (!samePhysicalPath(index, path.join(scope.gitDir, 'index'))) fail('unexpected resolved index path');
    const before = await indexSnapshot(index);
    const binary = before.bytes ? parseIndex(before.bytes, objectFormat) : [];
    const entries = parseStage((await git.run(['ls-files', '--stage', '--full-name', '-z'])).bytes, objectFormat);
    const expanded = new Set<string>();
    const entryMap = new Map(entries.map((entry) => [entry.name.toString('hex'), entry]));
    const sparseChildren = new Map<string, Entry[]>();
    const sparseNames = new Set(binary.filter((entry) => entry.sparse).map((entry) => entry.name.toString('hex')));
    for (const entry of entries)
        for (let cursor = entry.name.indexOf(47); cursor >= 0; cursor = entry.name.indexOf(47, cursor + 1)) {
            const key = entry.name.subarray(0, cursor + 1).toString('hex');
            if (sparseNames.has(key)) {
                const children = sparseChildren.get(key) ?? [];
                children.push(entry);
                sparseChildren.set(key, children);
            }
        }
    for (const entry of binary) {
        if (entry.sparse) {
            const children = sparseChildren.get(entry.name.toString('hex')) ?? [];
            if (
                !children.length ||
                treeId(
                    children.map((child) => ({ ...child, name: child.name.subarray(entry.name.length) })),
                    objectFormat,
                ) !== entry.oid
            )
                fail('sparse index expansion mismatch');
            for (const child of children) expanded.add(child.name.toString('hex'));
        } else {
            const actual = entryMap.get(entry.name.toString('hex'));
            if (!actual || actual.mode !== entry.mode || actual.oid !== entry.oid || actual.stage !== entry.stage)
                fail('binary index and Git manifest mismatch');
            expanded.add(entry.name.toString('hex'));
        }
    }
    if (expanded.size !== entries.length) fail('index manifest contains unbound entries');
    if (entries.some((entry) => isLedgerStatePath(entry.name))) fail('local state namespace is staged');
    await git.objects(
        entries.filter((entry) => entry.mode !== 0o160000).map((entry) => entry.oid),
        objectFormat,
        'blob',
    );
    const expectedTree = treeId(entries, objectFormat);
    const indexManifestSha256 = manifest(entries, objectFormat);
    const after = await indexSnapshot(index);
    if (
        before.bytes === null
            ? after.bytes !== null
            : after.bytes === null ||
              !before.bytes.equals(after.bytes) ||
              !before.identity ||
              !after.identity ||
              !sameObserved(before.identity, after.identity)
    )
        fail('index changed during observation');
    if (
        observedHead !== (await git.head(objectFormat)) ||
        objectFormat !== (await git.format()) ||
        !samePhysicalPath(await git.text(['rev-parse', '--show-toplevel']), scope.worktree) ||
        !samePhysicalPath(await git.text(['rev-parse', '--absolute-git-dir']), scope.gitDir) ||
        !samePhysicalPath(
            path.resolve(scope.worktree, await git.text(['rev-parse', '--git-common-dir'])),
            scope.commonGitDir,
        )
    )
        fail('Git scope or HEAD changed during observation');
    return { observedHead, objectFormat, indexManifestSha256, expectedTree };
}
export async function observeResult(
    currentDirectory: string,
    sha: string,
): Promise<{
    sha: string;
    parents: string[];
    tree: string;
    indexManifestSha256: string;
    message: Buffer;
    messageSha256: string;
    objectFormat: Format;
}> {
    fullObjectId(sha);
    const { git } = await observer(currentDirectory);
    const objectFormat = await git.format();
    id(sha, objectFormat);
    const commit = await git.commit(sha, objectFormat);
    const entries = await actualTree(git, commit.tree, objectFormat);
    return {
        sha,
        ...commit,
        indexManifestSha256: manifest(entries, objectFormat),
        messageSha256: byteDigest(commit.message),
        objectFormat,
    };
}
