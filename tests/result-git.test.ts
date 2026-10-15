import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Operation } from '../src/records.ts';
import { parsePreparedReceipt, parseResultPlan } from '../src/result-contract.ts';
import { observePreparation, observeResult } from '../src/result-git.ts';
import { gitEnvironment, resolveTrustedGit } from '../src/safe-git.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const oid = 'a'.repeat(40);
const plan = (parents: string[] = [], targets: Operation['targets'] = []) => ({
    schemaVersion: 1 as const,
    form: 'create' as const,
    expectedParents: parents,
    sourceTargets: targets,
});
async function fixture(t: test.TestContext, format = 'sha1') {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'result-observer-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const executable = await resolveTrustedGit([]);
    const env = {
        ...gitEnvironment(),
        GIT_AUTHOR_NAME: 'Fixture Author',
        GIT_AUTHOR_EMAIL: 'author@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture Committer',
        GIT_COMMITTER_EMAIL: 'committer@example.invalid',
    };
    function git(args: string[], input?: Buffer | string): Buffer {
        const result = spawnSync(executable, ['-c', 'core.hooksPath=', ...args], {
            cwd: directory,
            env,
            input,
            windowsHide: true,
            shell: false,
            maxBuffer: 32 * 1024 * 1024,
        });
        assert.equal(result.status, 0, result.stderr?.toString());
        return result.stdout;
    }
    git(['init', '--quiet', `--object-format=${format}`]);
    const operation: Operation = {
        schemaVersion: 1,
        id: randomUUID(),
        repository: directory,
        worktree: directory,
        commonGitDir: await realpath(path.join(directory, '.git')),
        kind: 'commit',
        paths: [],
        targets: [],
    };
    const head = () => git(['rev-parse', 'HEAD']).toString().trim();
    async function stage(name = 'file', contents = 'content') {
        await writeFile(path.join(directory, name), contents);
        git(['add', '--', name]);
    }
    return { directory, operation, git, head, stage };
}

test('result plans retain ordered parents and require exact source role/OID joins', () => {
    const targets = [{ role: 'source', objectId: oid }];
    const operation = { targets } as Operation;
    assert.deepEqual(parseResultPlan(plan(['b'.repeat(40), oid], targets), operation).expectedParents, [
        'b'.repeat(40),
        oid,
    ]);
    assert.throws(() => parseResultPlan(plan([], []), operation));
    assert.throws(() => parseResultPlan({ ...plan(), replacementTarget: oid }));
    assert.throws(() => parseResultPlan(plan([oid, 'b'.repeat(64)])));
});

test('portable prepared receipt verifies candidate bytes without touching historical directories', () => {
    const operation = {
        schemaVersion: 1,
        id: randomUUID(),
        repository: '/removed/repository',
        worktree: '/removed/worktree',
        commonGitDir: '/removed/git',
        kind: 'commit',
        paths: [],
        targets: [],
    };
    const ledgerId = randomUUID();
    const bytes = Buffer.from('Subject\n\nBody\n');
    const receipt = {
        schemaVersion: 1,
        artifact: 'prepared-receipt',
        preparationId: randomUUID(),
        sourceContextId: randomUUID(),
        ledgerId,
        revision: 1,
        ledger: { schemaVersion: 2, ledgerId, operation, identities: [], blockers: [] },
        decision: {
            schemaVersion: 2,
            artifact: 'policy-decision',
            operation,
            branch: 'repository-policy',
            rationale: 'Declared',
            decisionSource: { kind: 'agent-semantic', reference: 'caller review' },
        },
        resultPlan: plan(),
        observedHead: null,
        objectFormat: 'sha1',
        indexManifestSha256: hash(Buffer.alloc(0)),
        expectedTree: oid,
        candidate: {
            encoding: 'base64',
            bytes: bytes.toString('base64'),
            byteLength: bytes.length,
            sha256: hash(bytes),
        },
    };
    assert.equal(parsePreparedReceipt(receipt).candidate.bytes, bytes.toString('base64'));
    assert.throws(() =>
        parsePreparedReceipt({
            ...receipt,
            candidate: { ...receipt.candidate, bytes: `${receipt.candidate.bytes}\n` },
        }),
    );
    assert.throws(() =>
        parsePreparedReceipt({ ...receipt, decision: { ...receipt.decision, branch: 'needs-decision' } }),
    );
    assert.throws(() => parsePreparedReceipt({ ...receipt, ledgerId: randomUUID() }));
    const withIdentity = {
        ...receipt,
        ledger: {
            ...receipt.ledger,
            identities: [{ agent: 'Fixture', model: 'model-1' }],
            blockers: [{ id: 'known-gap', reason: 'Declared gap' }],
        },
    };
    assert.equal(parsePreparedReceipt(withIdentity).ledger.blockers[0]?.id, 'known-gap');
    const opaqueBlockers = {
        ...withIdentity,
        ledger: {
            ...withIdentity.ledger,
            blockers: [
                { id: ' gap ', reason: 'Declared' },
                { id: 'gap', reason: 'Distinct ID' },
            ],
        },
    };
    assert.deepEqual(
        parsePreparedReceipt(opaqueBlockers).ledger.blockers.map((blocker) => blocker.id),
        [' gap ', 'gap'],
    );
    assert.throws(() =>
        parsePreparedReceipt({
            ...withIdentity,
            ledger: {
                ...withIdentity.ledger,
                identities: [withIdentity.ledger.identities[0], withIdentity.ledger.identities[0]],
            },
        }),
    );
    for (const patch of [
        { schemaVersion: 2 },
        { artifact: 'other' },
        { revision: 0 },
        { revision: 1.5 },
        { preparationId: 'bad' },
        { objectFormat: 'other' },
        { expectedTree: 'a'.repeat(64) },
        { expectedTree: '0'.repeat(40) },
        { indexManifestSha256: 'bad' },
        { ledger: { ...receipt.ledger, schemaVersion: 1 } },
        { ledger: { ...receipt.ledger, identities: null } },
        { ledger: { ...receipt.ledger, blockers: [{ id: '   ', reason: 'Declared' }] } },
        {
            ledger: {
                ...receipt.ledger,
                blockers: [
                    { id: 'gap', reason: 'One' },
                    { id: 'gap', reason: 'Two' },
                ],
            },
        },
        { decision: { ...receipt.decision, schemaVersion: 1 } },
        { decision: { ...receipt.decision, artifact: 'other' } },
        { decision: { ...receipt.decision, operation: { ...operation, id: randomUUID() } } },
        { decision: { ...receipt.decision, decisionSource: { kind: 'scanner', reference: 'reference' } } },
        { observedHead: oid },
        { resultPlan: plan([oid]) },
        { resultPlan: { ...plan(), form: 'replace', replacementTarget: oid } },
        { candidate: { ...receipt.candidate, encoding: 'utf8' } },
        { candidate: { ...receipt.candidate, bytes: null } },
        { candidate: { ...receipt.candidate, byteLength: -1 } },
        { candidate: { ...receipt.candidate, byteLength: 2 ** 32 } },
        { candidate: { ...receipt.candidate, byteLength: bytes.length + 1 } },
        { candidate: { ...receipt.candidate, sha256: '0'.repeat(64) } },
        { candidate: { encoding: 'base64', bytes: '/w==', byteLength: 1, sha256: hash(Buffer.from([255])) } },
        { unknown: true },
    ])
        assert.throws(() => parsePreparedReceipt({ ...receipt, ...patch }));
    assert.equal(parsePreparedReceipt({ ...receipt, observedHead: oid, resultPlan: plan([oid]) }).observedHead, oid);
    assert.equal(
        parsePreparedReceipt({
            ...receipt,
            observedHead: oid,
            resultPlan: { ...plan(), form: 'replace', replacementTarget: oid },
        }).resultPlan.form,
        'replace',
    );
});

test('root and exact result bind complete tree and raw message without writing the index', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const before = await readFile(path.join(f.directory, '.git/index'));
    const preparation = await observePreparation(f.operation, plan());
    assert.equal(preparation.observedHead, null);
    assert.deepEqual(await readFile(path.join(f.directory, '.git/index')), before);
    f.git(['commit', '--quiet', '-m', 'First']);
    const sha = f.head();
    const result = await observeResult(f.directory, sha);
    assert.deepEqual(result.parents, []);
    assert.equal(result.tree, preparation.expectedTree);
    assert.equal(result.indexManifestSha256, preparation.indexManifestSha256);
    assert.equal(result.message.toString(), 'First\n');
    f.git(['commit', '--quiet', '--allow-empty', '-m', 'Next']);
    assert.equal((await observeResult(f.directory, sha)).sha, sha);
    await assert.rejects(observeResult(f.directory, 'HEAD'));
});

test('staged empty file is allowed while intent-to-add is rejected', async (t) => {
    const f = await fixture(t);
    await f.stage('empty', '');
    await observePreparation(f.operation, plan());
    await writeFile(path.join(f.directory, 'intent'), '');
    f.git(['add', '-N', 'intent']);
    await assert.rejects(observePreparation(f.operation, plan()), /intent|ITA/i);
});

test('stable absent index supports an empty root and root replacement', async (t) => {
    const f = await fixture(t);
    const before = await observePreparation(f.operation, plan());
    assert.equal(before.expectedTree, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    f.git(['commit', '--quiet', '--allow-empty', '-m', 'Empty']);
    assert.equal((await observeResult(f.directory, f.head())).tree, before.expectedTree);
    await observePreparation(f.operation, { ...plan(), form: 'replace', replacementTarget: f.head() });
    await assert.rejects(observePreparation(f.operation, plan()), /parent/i);
});

test('actual v2, extended v3, compressed v4, skipHash and SHA256 indexes remain unchanged', async (t) => {
    for (const format of ['sha1', 'sha256'])
        for (const version of [2, 3, 4])
            await t.test(`${format} v${version}`, async (child) => {
                const f = await fixture(child, format);
                await f.stage('prefix-one', '');
                await f.stage('prefix-two', 'two');
                if (version === 3) f.git(['update-index', '--skip-worktree', 'prefix-one']);
                f.git(['update-index', `--index-version=${version}`]);
                if (version === 4) {
                    f.git(['config', 'index.skipHash', 'true']);
                    f.git(['update-index', '--force-write-index']);
                }
                const file = path.join(f.directory, '.git/index');
                const bytes = await readFile(file);
                assert.equal(bytes.readUInt32BE(4), version);
                if (version === 4)
                    assert.ok(bytes.subarray(-(format === 'sha1' ? 20 : 32)).every((byte) => byte === 0));
                const preparation = await observePreparation(f.operation, plan());
                assert.deepEqual(await readFile(file), bytes);
                f.git(['commit', '--quiet', '-m', 'Formats']);
                assert.equal((await observeResult(f.directory, f.head())).tree, preparation.expectedTree);
            });
});

test('missing ordinary blobs fail but parent-ODB-missing gitlinks can be committed', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const blob = f.git(['rev-parse', ':file']).toString().trim();
    await rm(path.join(f.directory, '.git/objects', blob.slice(0, 2), blob.slice(2)));
    await assert.rejects(observePreparation(f.operation, plan()), /missing|unavailable/i);
    f.git(['update-index', '--force-remove', 'file']);
    f.git(['update-index', '--add', '--cacheinfo', `160000,${oid},submodule`]);
    const preparation = await observePreparation(f.operation, plan());
    f.git(['commit', '--quiet', '-m', 'Gitlink']);
    assert.equal((await observeResult(f.directory, f.head())).tree, preparation.expectedTree);
});

test('sparse index expands complete leaves without changing the physical index', async (t) => {
    const f = await fixture(t);
    await mkdir(path.join(f.directory, 'visible'));
    await mkdir(path.join(f.directory, 'hidden'));
    await f.stage('visible/file');
    await f.stage('hidden/file', 'hidden');
    f.git(['commit', '--quiet', '-m', 'Directories']);
    f.git(['sparse-checkout', 'set', '--cone', '--sparse-index', 'visible']);
    const file = path.join(f.directory, '.git/index');
    const before = await readFile(file);
    assert.ok(before.includes(Buffer.from('sdir')));
    const preparation = await observePreparation(f.operation, plan([f.head()]));
    assert.deepEqual(await readFile(file), before);
    assert.equal(preparation.expectedTree, (await observeResult(f.directory, f.head())).tree);
});

test('forced state staging, split indexes and conflicts fail without writes', async (t) => {
    await t.test('state namespace', async (child) => {
        const f = await fixture(child);
        await mkdir(path.join(f.directory, '.ai-commit-attribution'));
        await f.stage('.ai-commit-attribution/state.json', '{}');
        await assert.rejects(observePreparation(f.operation, plan()), /state namespace/i);
    });
    await t.test('split index', async (child) => {
        const f = await fixture(child);
        await f.stage();
        f.git(['update-index', '--split-index']);
        await assert.rejects(observePreparation(f.operation, plan()), /split index/i);
    });
    await t.test('unmerged', async (child) => {
        const f = await fixture(child);
        const blob = f.git(['hash-object', '-w', '--stdin'], 'conflict').toString().trim();
        f.git(
            ['update-index', '--index-info'],
            `100644 ${blob} 1\tconflict\n100644 ${blob} 2\tconflict\n100644 ${blob} 3\tconflict\n`,
        );
        await assert.rejects(observePreparation(f.operation, plan()), /unmerged/i);
    });
});

test('real octopus merge and replacement preserve exact complete parent order', async (t) => {
    const f = await fixture(t);
    await f.stage('base');
    f.git(['commit', '--quiet', '-m', 'Base']);
    const base = f.head();
    const sources: string[] = [];
    for (const branch of ['one', 'two']) {
        f.git(['checkout', '--quiet', '-b', branch, base]);
        await f.stage(branch);
        f.git(['commit', '--quiet', '-m', branch]);
        sources.push(f.head());
    }
    f.git(['checkout', '--quiet', '-B', 'destination', base]);
    f.git(['merge', '--no-ff', '--no-commit', 'one', 'two']);
    const parents = [base, ...sources];
    const prepared = await observePreparation(f.operation, plan(parents));
    f.git(['commit', '--quiet', '-m', 'Octopus']);
    const target = f.head();
    assert.deepEqual((await observeResult(f.directory, target)).parents, parents);
    assert.equal((await observeResult(f.directory, target)).tree, prepared.expectedTree);
    await observePreparation(f.operation, { ...plan(parents), form: 'replace', replacementTarget: target });
    await assert.rejects(
        observePreparation(f.operation, {
            ...plan([base, ...sources.reverse()]),
            form: 'replace',
            replacementTarget: target,
        }),
        /ordered parents/i,
    );
});

test('noncanonical empty and duplicate tree directories are rejected', async (t) => {
    const f = await fixture(t);
    const empty = f.git(['mktree'], '').toString().trim();
    const tree = f.git(['mktree'], `040000 tree ${empty}\tempty\n`).toString().trim();
    const sha = f.git(['commit-tree', tree], 'Extra empty directory\n').toString().trim();
    await assert.rejects(observeResult(f.directory, sha), /empty|canonical/i);
    const blob = f.git(['hash-object', '-w', '--stdin'], 'leaf').toString().trim();
    const subtree = f.git(['mktree'], `100644 blob ${blob}\tleaf\n`).toString().trim();
    const duplicate = Buffer.concat([
        Buffer.from('40000 same\0'),
        Buffer.from(subtree, 'hex'),
        Buffer.from('40000 same\0'),
        Buffer.from(subtree, 'hex'),
    ]);
    const duplicateTree = f
        .git(['hash-object', '--literally', '-w', '-t', 'tree', '--stdin'], duplicate)
        .toString()
        .trim();
    const duplicateCommit = f.git(['commit-tree', duplicateTree], 'Duplicate directory\n').toString().trim();
    await assert.rejects(observeResult(f.directory, duplicateCommit), /duplicate/i);
});

test('malformed binary index framing, checksum and bounds fail closed', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const file = path.join(f.directory, '.git/index');
    const original = await readFile(file);
    for (const mutate of [
        (bytes: Buffer) => {
            bytes[0] = 0;
        },
        (bytes: Buffer) => {
            bytes.writeUInt32BE(5, 4);
        },
        (bytes: Buffer) => {
            bytes.writeUInt32BE(0xffffffff, 8);
        },
        (bytes: Buffer) => {
            bytes[20] = (bytes[20] ?? 0) ^ 1;
        },
    ]) {
        const bytes = Buffer.from(original);
        mutate(bytes);
        await writeFile(file, bytes);
        await assert.rejects(observePreparation(f.operation, plan()));
        assert.deepEqual(await readFile(file), bytes);
    }
    await writeFile(file, Buffer.alloc(16 * 1024 * 1024 + 1));
    await assert.rejects(observePreparation(f.operation, plan()), /unsafe|unreadable/i);
    for (const mutate of [
        (bytes: Buffer) => {
            bytes.writeUInt32BE(0o100600, 36);
        },
        (bytes: Buffer) => {
            bytes.writeUInt16BE(0x4004, 72);
        },
        (bytes: Buffer) => {
            bytes.writeUInt16BE(3, 72);
        },
        (bytes: Buffer) => {
            bytes[79] = 1;
        },
        (bytes: Buffer) => {
            bytes[74] = 47;
        },
    ]) {
        const bytes = Buffer.from(original);
        mutate(bytes);
        bytes.fill(0, bytes.length - 20);
        await writeFile(file, bytes);
        await assert.rejects(observePreparation(f.operation, plan()));
    }
    for (const extension of [
        Buffer.from('abcd\0\0\0\0'),
        Buffer.from('sdir\0\0\0\x01x'),
        Buffer.from('ABCD\0\0\0\x10'),
    ]) {
        await writeFile(file, Buffer.concat([original.subarray(0, -20), extension, Buffer.alloc(20)]));
        await assert.rejects(observePreparation(f.operation, plan()));
    }
});

test('bounded unknown index extensions are optional solely by their uppercase first byte', async (t) => {
    const f = await fixture(t);
    await f.stage('file');
    const file = path.join(f.directory, '.git/index');
    const original = await readFile(file);
    const body = Buffer.concat([original.subarray(0, -20), Buffer.from('X___\0\0\0\0')]);
    const extended = Buffer.concat([body, createHash('sha1').update(body).digest()]);
    await writeFile(file, extended);
    assert.match(f.git(['ls-files', '--stage']).toString(), /file/);
    await observePreparation(f.operation, plan());
    assert.deepEqual(await readFile(file), extended);
});

test('out-of-order binary index names are rejected before sorted manifests can hide them', async (t) => {
    const f = await fixture(t);
    await f.stage('a');
    await f.stage('b');
    f.git(['update-index', '--index-version=2']);
    const file = path.join(f.directory, '.git/index');
    const original = await readFile(file);
    assert.equal(original.readUInt32BE(4), 2);
    assert.equal(original.readUInt32BE(8), 2);
    const body = Buffer.concat([
        original.subarray(0, 12),
        original.subarray(76, 140),
        original.subarray(12, 76),
        original.subarray(140, -20),
    ]);
    const reversed = Buffer.concat([body, createHash('sha1').update(body).digest()]);
    await writeFile(file, reversed);
    assert.match(f.git(['ls-files', '--stage']).toString(), /b[\r\n]+100644 .*a/);
    await assert.rejects(observePreparation(f.operation, plan()), /order/i);
    assert.deepEqual(await readFile(file), reversed);
});

test('Windows state namespace case aliases cannot bypass the staged-state guard', {
    skip: process.platform !== 'win32',
}, async (t) => {
    const f = await fixture(t);
    const blob = f.git(['hash-object', '-w', '--stdin'], '{}').toString().trim();
    f.git(['update-index', '--index-info'], `100644 ${blob}\t.AI-COMMIT-ATTRIBUTION/file\n`);
    assert.match(f.git(['ls-files', '--stage']).toString(), /AI-COMMIT-ATTRIBUTION/);
    await assert.rejects(observePreparation(f.operation, plan()), /state namespace/i);
});

test('corrupt blob contents cannot pass metadata-only observation', async (t) => {
    const f = await fixture(t);
    await f.stage('file', 'blob contents long enough to truncate the compressed body');
    const blob = f.git(['rev-parse', ':file']).toString().trim();
    const file = path.join(f.directory, '.git/objects', blob.slice(0, 2), blob.slice(2));
    const bytes = await readFile(file);
    await rm(file);
    await writeFile(file, bytes.subarray(0, bytes.length - 8));
    await assert.rejects(observePreparation(f.operation, plan()), /object|unavailable|corrupt/i);
});

test('legal Unicode unborn branch names are accepted', async (t) => {
    const f = await fixture(t);
    f.git(['symbolic-ref', 'HEAD', 'refs/heads/分支']);
    assert.equal((await observePreparation(f.operation, plan())).observedHead, null);
});

test('POSIX tab, newline and backslash filenames retain complete byte identity', {
    skip: process.platform === 'win32',
}, async (t) => {
    const f = await fixture(t);
    const names = [Buffer.from('back\\slash'), Buffer.from('line\nname'), Buffer.from('tab\tname')];
    for (const name of names) {
        await writeFile(Buffer.concat([Buffer.from(`${f.directory}/`), name]), 'raw path');
    }
    f.git(['add', '--all']);
    const staged = Buffer.concat(
        names.map((name) =>
            Buffer.concat([Buffer.from('100644 28ec5107160d05ea96eed05f5aff1a0db4f27f99 0\t'), name, Buffer.from([0])]),
        ),
    );
    assert.deepEqual(f.git(['ls-files', '--stage', '-z']), staged);
    const prepared = await observePreparation(f.operation, plan());
    f.git(['commit', '--quiet', '-m', 'Raw paths']);
    const result = await observeResult(f.directory, f.head());
    assert.equal(result.tree, prepared.expectedTree);
    assert.equal(result.indexManifestSha256, prepared.indexManifestSha256);
});

test('raw commit parser ignores signature continuation parent text and preserves final message bytes', async (t) => {
    const f = await fixture(t);
    f.git(['commit', '--quiet', '--allow-empty', '-m', 'Root']);
    const parent = f.head();
    const tree = f.git(['rev-parse', 'HEAD^{tree}']).toString().trim();
    const message = Buffer.from('Subject\r\n\r\nBody  \n\n');
    const raw = Buffer.concat([
        Buffer.from(
            `tree ${tree}\nparent ${parent}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\ngpgsig fake\n parent ${oid}\n\n`,
        ),
        message,
    ]);
    const sha = f.git(['hash-object', '-w', '-t', 'commit', '--stdin'], raw).toString().trim();
    const result = await observeResult(f.directory, sha);
    assert.deepEqual(result.parents, [parent]);
    assert.deepEqual(result.message, message);
    assert.equal(result.messageSha256, hash(message));
    await assert.rejects(observeResult(f.directory, tree));
    await assert.rejects(observeResult(f.directory, sha.slice(0, 10)));
});

test('hostile environment and executable Git configuration do not execute or change Git state', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const sentinel = path.join(f.directory, 'sentinel');
    const hookSentinel = path.join(f.directory, 'hook-sentinel');
    const script = path.join(f.directory, 'hostile-monitor');
    await writeFile(script, `#!/bin/sh\necho executed > sentinel\n`, { mode: 0o755 });
    const command = './hostile-monitor';
    f.git(['config', 'core.fsmonitor', command]);
    f.git(['config', 'diff.external', command]);
    f.git(['config', 'core.hooksPath', f.directory]);
    await writeFile(path.join(f.directory, 'post-index-change'), `#!/bin/sh\necho executed > hook-sentinel\n`, {
        mode: 0o755,
    });
    f.git(['ls-files', '--stage']);
    assert.equal((await readFile(sentinel, 'utf8')).trim(), 'executed');
    const hookControl = spawnSync(
        await resolveTrustedGit([]),
        ['-c', 'core.fsmonitor=false', 'update-index', '--force-write-index'],
        {
            cwd: f.directory,
            env: gitEnvironment(),
            windowsHide: true,
            shell: false,
        },
    );
    assert.equal(hookControl.status, 0, hookControl.stderr.toString());
    assert.equal((await readFile(hookSentinel, 'utf8')).trim(), 'executed');
    await rm(sentinel);
    await rm(hookSentinel);
    const index = path.join(f.directory, '.git/index');
    const beforeIndex = await readFile(index);
    const beforeConfig = await readFile(path.join(f.directory, '.git/config'));
    const saved = { ...process.env };
    try {
        process.env.GIT_INDEX_FILE = path.join(f.directory, 'missing');
        process.env.GIT_CONFIG_COUNT = '1';
        process.env.GIT_CONFIG_KEY_0 = 'core.fsmonitor';
        process.env.GIT_CONFIG_VALUE_0 = command;
        process.env.GIT_EXTERNAL_DIFF = command;
        process.env.NODE_OPTIONS = '--require=missing-injection';
        await observePreparation(f.operation, plan());
    } finally {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
    }
    assert.deepEqual(await readFile(index), beforeIndex);
    assert.deepEqual(await readFile(path.join(f.directory, '.git/config')), beforeConfig);
    await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
    await assert.rejects(readFile(hookSentinel), { code: 'ENOENT' });
});

test('linked worktrees use their own index and nested result invocations bind the root tree', async (t) => {
    const f = await fixture(t);
    await f.stage();
    f.git(['commit', '--quiet', '-m', 'Base']);
    const linked = path.join(f.directory, 'linked');
    f.git(['worktree', 'add', '--quiet', '-b', 'linked-fixture', linked]);
    const gitDirectory = f.git(['-C', linked, 'rev-parse', '--absolute-git-dir']).toString().trim();
    const commonGitDir = await realpath(path.join(f.directory, '.git'));
    const operation = { ...f.operation, repository: linked, worktree: linked, commonGitDir };
    const mainIndex = await readFile(path.join(commonGitDir, 'index'));
    await mkdir(path.join(linked, 'nested'));
    await writeFile(path.join(linked, 'nested/other'), 'linked contents');
    f.git(['-C', linked, 'add', '--all']);
    const linkedIndex = await readFile(path.join(gitDirectory, 'index'));
    const prepared = await observePreparation(operation, plan([f.head()]));
    assert.deepEqual(await readFile(path.join(gitDirectory, 'index')), linkedIndex);
    assert.deepEqual(await readFile(path.join(commonGitDir, 'index')), mainIndex);
    f.git(['-C', linked, 'commit', '--quiet', '-m', 'Linked']);
    const sha = f.git(['-C', linked, 'rev-parse', 'HEAD']).toString().trim();
    assert.equal((await observeResult(path.join(linked, 'nested'), sha)).tree, prepared.expectedTree);
});

test('whole-index witness binds file mode, path, symlink and deletion changes', async (t) => {
    const f = await fixture(t);
    await f.stage('file');
    const original = await observePreparation(f.operation, plan());
    f.git(['update-index', '--chmod=+x', 'file']);
    const executable = await observePreparation(f.operation, plan());
    assert.notEqual(executable.expectedTree, original.expectedTree);
    assert.notEqual(executable.indexManifestSha256, original.indexManifestSha256);
    const blob = f.git(['rev-parse', ':file']).toString().trim();
    f.git(['update-index', '--force-remove', 'file']);
    f.git(['update-index', '--add', '--cacheinfo', `120000,${blob},link`]);
    const symlink = await observePreparation(f.operation, plan());
    assert.notEqual(symlink.expectedTree, executable.expectedTree);
    f.git(['commit', '--quiet', '-m', 'Symlink']);
    assert.equal((await observeResult(f.directory, f.head())).tree, symlink.expectedTree);
    f.git(['update-index', '--force-remove', 'link']);
    assert.equal(
        (await observePreparation(f.operation, plan([f.head()]))).expectedTree,
        '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    );
});

test('nonUTF8 Git index and object paths retain exact bytes across storage formats', async (t) => {
    // Known vectors use three mode-100644 leaves containing "raw path", in the explicit byte order below.
    // Manifest v1 framing binds count 3, raw path lengths 4/2/2, leaf modes and the storage-width blob IDs.
    const vectors = [
        {
            format: 'sha1',
            blob: '28ec5107160d05ea96eed05f5aff1a0db4f27f99',
            tree: 'bd947e25388568cf94e70291da3c256680d346a5',
            manifest: 'cdfd21b2fb44f7dfa113ae9f6da0d948dd122c738634af503adb9e718cdfe186',
        },
        {
            format: 'sha256',
            blob: 'bf9fb7e02aa74f47f43469371d35912560254f8cd2399f7be944c76e72157980',
            tree: '033519a321394aa9970596e059b4054862f1b720d916f963d274635ac537ada4',
            manifest: 'da2f6525eca43ce71a86ef26c28901e92fd7fcc22a343b9121087c116f077260',
        },
    ];
    for (const vector of vectors)
        await t.test(vector.format, async (child) => {
            const f = await fixture(child, vector.format);
            // Explicit raw order distinguishes both invalid byte spellings from UTF-8 U+FFFD.
            const names = [Buffer.from([0x66, 0xef, 0xbf, 0xbd]), Buffer.from([0x66, 0xfe]), Buffer.from([0x66, 0xff])];
            const blob = f.git(['hash-object', '-w', '--stdin'], 'raw path').toString().trim();
            assert.equal(blob, vector.blob);
            // NUL-framed index metadata needs no host filesystem representation for these names.
            f.git(
                ['update-index', '-z', '--index-info'],
                Buffer.concat(
                    names.map((name) => Buffer.concat([Buffer.from(`100644 ${blob}\t`), name, Buffer.from([0])])),
                ),
            );
            const staged = Buffer.concat(
                names.map((name) => Buffer.concat([Buffer.from(`100644 ${vector.blob} 0\t`), name, Buffer.from([0])])),
            );
            assert.deepEqual(f.git(['ls-files', '--stage', '-z']), staged);
            const tree = f.git(['write-tree']).toString().trim();
            assert.equal(tree, vector.tree);
            const indexFile = path.join(f.directory, '.git', 'index'),
                index = await readFile(indexFile);
            const prepared = await observePreparation(f.operation, plan());
            assert.equal(prepared.expectedTree, vector.tree);
            assert.equal(prepared.indexManifestSha256, vector.manifest);
            assert.deepEqual(await readFile(indexFile), index);
            const leaves = Buffer.concat(
                names.map((name) =>
                    Buffer.concat([Buffer.from(`100644 blob ${vector.blob}\t`), name, Buffer.from([0])]),
                ),
            );
            assert.deepEqual(f.git(['ls-tree', '-z', tree]), leaves);
            const sha = f.git(['commit-tree', tree], Buffer.from('Raw paths\n')).toString().trim(),
                result = await observeResult(f.directory, sha);
            assert.equal(result.tree, vector.tree);
            assert.equal(result.indexManifestSha256, vector.manifest);
            assert.deepEqual(result.parents, []);
            assert.deepEqual(result.message, Buffer.from('Raw paths\n'));
            assert.deepEqual(await readFile(indexFile), index);
        });
});
