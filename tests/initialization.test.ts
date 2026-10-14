import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const validators = new URL('../tooling/repository-audit.ts', import.meta.url);
test('repository text gate grants only the exact GitHub chooser YAML exception', async () => {
    assert.ok(existsSync(validators), 'PR1 repository text validator must exist');
    const { validateTextStyle } = await import('../tooling/repository-audit.ts');
    assert.deepEqual(validateTextStyle('.github/ISSUE_TEMPLATE/config.yml', 'blank_issues_enabled: true\n'), []);
    for (const name of [
        'config.yml',
        '.github/ISSUE_TEMPLATE/bug.yml',
        '.github/workflows/ci.yml',
        '.github/ISSUE_TEMPLATE/CONFIG.yml',
    ]) {
        assert.ok(
            validateTextStyle(name, 'value: true\n').some((error: string) => /\.yaml/.test(error)),
            name,
        );
    }
    assert.deepEqual(validateTextStyle('.github/workflows/ci.yaml', 'name: CI\n'), []);
});

test('raw footer gate rejects a trailer immediately after prose and accepts a separate trailer block', async () => {
    assert.ok(existsSync(new URL('../tooling/commit-footer-rule.ts', import.meta.url)), 'raw footer rule must exist');
    const { validateRawMessage } = await import('../tooling/commit-footer-rule.ts');
    assert.ok(validateRawMessage('chore(governance): initialize\n\nExplain changes.\nAssisted-by: Codex').length > 0);
    assert.deepEqual(validateRawMessage('chore(governance): initialize\n\nExplain changes.\n\nAssisted-by: Codex'), []);
    assert.ok(validateRawMessage(`chore(governance): initialize\n\n${'x'.repeat(101)}`).length > 0);
    assert.deepEqual(validateRawMessage(`chore(governance): initialize\n\nAssisted-by: ${'x'.repeat(110)}`), []);
    assert.ok(validateRawMessage('chore(governance): initialize\n\nAssisted-by: Codex\n continued').length > 0);
});

test('standalone build rejects extra files and directories in its physical output tree', async () => {
    assert.ok(
        existsSync(new URL('../tooling/build-security.ts', import.meta.url)),
        'standalone security build must exist',
    );
    const { verifySecurityFiles } = await import('../tooling/build-security.ts');
    const { mkdtemp, writeFile, mkdir, rm, realpath } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, dirname, resolve } = await import('node:path');
    const root = await realpath(await mkdtemp(join(tmpdir(), 'attribution-inventory-')));
    try {
        const files = new Map([
            ['check-security.mjs', Buffer.from('export {};\n')],
            ['THIRD-PARTY-NOTICES.txt', Buffer.from('notice\n')],
        ]);
        for (const [file, bytes] of files) await writeFile(join(root, file), bytes);
        await verifySecurityFiles(root, files);
        await writeFile(join(root, 'extra.txt'), 'unexpected');
        await assert.rejects(verifySecurityFiles(root, files), /inventory|unexpected/i);
        await rm(join(root, 'extra.txt'));
        await mkdir(join(root, 'empty'));
        await assert.rejects(verifySecurityFiles(root, files), /inventory|directory|unexpected/i);
    } finally {
        assert.equal(dirname(resolve(root)), resolve(await realpath(tmpdir())));
        await rm(root, { recursive: true, force: true });
    }
});

test('raw message syntax preserves ambiguous body labels and multiline breaking notes', async () => {
    const { validateCommitMessage } = await import('../tooling/governance.ts');
    assert.deepEqual(
        validateCommitMessage(
            'docs(governance): explain policy\n\nDescribe behavior.\nobservations: the checks passed',
        ),
        [],
    );
    assert.deepEqual(
        validateCommitMessage('feat(identity): change contract\n\n* BREAKING CHANGE:\ncallers must migrate'),
        [],
    );
    assert.ok(
        validateCommitMessage(
            'docs(governance): explain policy\n\nDescribe behavior.\nobservations: the checks passed\nReviewed-by: Person',
        ).length > 0,
    );
});

test('complete single-line BREAKING CHANGE trailers share the structured length exemption', async () => {
    const { validateRawMessage } = await import('../tooling/commit-footer-rule.ts');
    assert.deepEqual(validateRawMessage(`feat(identity): change contract\n\nBREAKING CHANGE: ${'x'.repeat(110)}`), []);
});

test('normal security build rejects a linked output root before changing external bytes', async () => {
    const { writeSecurityFiles } = await import('../tooling/build-security.ts');
    assert.equal(typeof writeSecurityFiles, 'function', 'normal writes need a physical-tree guard');
    const { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, dirname, resolve } = await import('node:path');
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'attribution-write-guard-')));
    try {
        const external = join(parent, 'external');
        await mkdir(external);
        await writeFile(join(external, 'check-security.mjs'), 'external original\n');
        await symlink(external, join(parent, 'output'), process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(
            writeSecurityFiles(
                join(parent, 'output'),
                new Map([
                    ['check-security.mjs', Buffer.from('new bundle\n')],
                    ['THIRD-PARTY-NOTICES.txt', Buffer.from('notice\n')],
                ]),
            ),
            /physical|link|directory/i,
        );
        assert.equal(await readFile(join(external, 'check-security.mjs'), 'utf8'), 'external original\n');
    } finally {
        assert.equal(dirname(resolve(parent)), resolve(await realpath(tmpdir())));
        await rm(parent, { recursive: true, force: true });
    }
});

for (const linkedName of ['check-security.mjs', 'THIRD-PARTY-NOTICES.txt']) {
    test(`round1 builder and verifier reject hard-linked ${linkedName} without modifying any output or peer`, async () => {
        const { writeSecurityFiles, verifySecurityFiles } = await import('../tooling/build-security.ts');
        const { mkdtemp, mkdir, writeFile, readFile, link, realpath, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join, dirname, resolve } = await import('node:path');
        const parent = await realpath(await mkdtemp(join(tmpdir(), 'attribution-hardlink-')));
        const output = join(parent, 'output');
        const original = new Map([
            ['check-security.mjs', Buffer.from('old bundle\n')],
            ['THIRD-PARTY-NOTICES.txt', Buffer.from('old notice\n')],
        ]);
        try {
            await mkdir(output);
            for (const [name, bytes] of original) if (name !== linkedName) await writeFile(join(output, name), bytes);
            const peer = join(parent, 'external-peer');
            const peerBytes = original.get(linkedName);
            assert.ok(peerBytes);
            await writeFile(peer, peerBytes);
            await link(peer, join(output, linkedName));
            await assert.rejects(verifySecurityFiles(output, original), /link/i);
            const next = new Map([
                ['check-security.mjs', Buffer.from('new bundle\n')],
                ['THIRD-PARTY-NOTICES.txt', Buffer.from('new notice\n')],
            ]);
            await assert.rejects(writeSecurityFiles(output, next), /link/i);
            assert.deepEqual(await readFile(peer), original.get(linkedName));
            for (const [name, bytes] of original)
                assert.deepEqual(await readFile(join(output, name)), bytes, `${name} remains unchanged`);
        } finally {
            assert.equal(dirname(resolve(parent)), resolve(await realpath(tmpdir())));
            await rm(parent, { recursive: true, force: true });
        }
    });
}

test('round1 raw and shared message validators reject bare CR but accept CRLF', async () => {
    const { validateRawMessage } = await import('../tooling/commit-footer-rule.ts');
    const { validateCommitMessage } = await import('../tooling/governance.ts');
    const valid = 'chore(governance): initialize\r\n\r\nExplain behavior.\r\n\r\nAssisted-by: Codex\r\n';
    assert.deepEqual(validateRawMessage(valid), []);
    assert.deepEqual(validateCommitMessage(valid), []);
    for (const raw of [
        'chore(governance): initialize\rInjected',
        'chore(governance): initialize\n\nExplain\rInjected',
        'chore(governance): initialize\n\nAssisted-by: Codex\rInjected-by: forged',
    ]) {
        assert.ok(validateRawMessage(raw).length > 0, JSON.stringify(raw));
        assert.ok(validateCommitMessage(raw).length > 0, JSON.stringify(raw));
    }
});

test('round1 immutable dependency evidence permits a hard link while output evidence rejects it', async () => {
    const { readRegularFile } = await import('../tooling/file-evidence.ts');
    const { mkdtemp, writeFile, readFile, link, realpath, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join, dirname, resolve } = await import('node:path');
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'attribution-immutable-link-')));
    try {
        const file = join(parent, 'package-evidence');
        const bytes = Buffer.from('original immutable package bytes\n');
        await writeFile(file, bytes);
        await link(file, join(parent, 'store-peer'));
        assert.deepEqual(await readRegularFile(file), bytes);
        await assert.rejects(readRegularFile(file, { singleLink: true }), /link/i);
        assert.deepEqual(await readFile(join(parent, 'store-peer')), bytes);
    } finally {
        assert.equal(dirname(resolve(parent)), resolve(await realpath(tmpdir())));
        await rm(parent, { recursive: true, force: true });
    }
});

for (const heldName of ['check-security.mjs', 'THIRD-PARTY-NOTICES.txt']) {
    test(`codeql atomic output replacement preserves an open descriptor for old ${heldName}`, async () => {
        const { writeSecurityFiles, verifySecurityFiles } = await import('../tooling/build-security.ts');
        const { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, open, stat, rm } = await import(
            'node:fs/promises'
        );
        const { tmpdir } = await import('node:os');
        const { join, dirname, resolve } = await import('node:path');
        const parent = await realpath(await mkdtemp(join(tmpdir(), 'attribution-atomic-output-')));
        const output = join(parent, 'output');
        const oldFiles = new Map([
            ['check-security.mjs', Buffer.from('original bundle\n')],
            ['THIRD-PARTY-NOTICES.txt', Buffer.from('original notice\n')],
        ]);
        const next = new Map([
            ['check-security.mjs', Buffer.from('new bundle\n')],
            ['THIRD-PARTY-NOTICES.txt', Buffer.from('new notice\n')],
        ]);
        try {
            await mkdir(output);
            for (const [name, bytes] of oldFiles) await writeFile(join(output, name), bytes);
            const held = await open(join(output, heldName), 'r');
            const originalInode = (await held.stat({ bigint: true })).ino;
            let failure: unknown;
            try {
                try {
                    await writeSecurityFiles(output, next);
                } catch (error) {
                    failure = error;
                }
                if (failure) {
                    assert.equal(process.platform, 'win32', 'only Windows busy-target rename may fail here');
                    assert.ok(
                        typeof failure === 'object' &&
                            failure !== null &&
                            'code' in failure &&
                            failure.code === 'EPERM',
                    );
                } else {
                    assert.notEqual((await stat(join(output, heldName), { bigint: true })).ino, originalInode);
                }
                assert.deepEqual(
                    await held.readFile(),
                    oldFiles.get(heldName),
                    'publishing must replace the directory entry, preserving old inode bytes',
                );
            } finally {
                await held.close();
            }
            if (failure) {
                // A failed Windows replacement retains the old entry until this fresh-inode retry.
                await writeSecurityFiles(output, next);
                assert.notEqual((await stat(join(output, heldName), { bigint: true })).ino, originalInode);
            }
            for (const [name, bytes] of next) assert.deepEqual(await readFile(join(output, name)), bytes);
            await verifySecurityFiles(output, next);
            assert.deepEqual(await readdir(parent), ['output'], 'staging directories must be cleaned');
        } finally {
            assert.equal(dirname(resolve(parent)), resolve(await realpath(tmpdir())));
            await rm(parent, {
                recursive: true,
                force: true,
                maxRetries: process.platform === 'win32' ? 3 : 0,
                retryDelay: 100,
            });
        }
    });
}

test('codeql descriptor evidence rejects linked ancestors and detects a real path swap during read', async () => {
    const { readRegularFile } = await import('../tooling/file-evidence.ts');
    const { mkdtemp, realpath, mkdir, writeFile, rename, readFile, symlink, lstat, open, rm } = await import(
        'node:fs/promises'
    );
    const { tmpdir } = await import('node:os');
    const { join, dirname, resolve } = await import('node:path');
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'attribution-evidence-race-')));
    try {
        const physical = join(parent, 'physical');
        await mkdir(physical);
        const file = join(physical, 'evidence');
        await writeFile(file, 'original evidence\n');
        const alias = join(parent, 'alias');
        await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(readRegularFile(join(alias, 'evidence'), { physicalPath: true }), /physical|link|path/i);
        let inspections = 0;
        let closed = false;
        let descriptorBytes: Buffer | undefined;
        await assert.rejects(
            readRegularFile(file, {
                physicalPath: true,
                lstat: async (name) => {
                    const stat = await lstat(name, { bigint: true });
                    if (inspections++ === 0) {
                        await rename(file, join(physical, 'original-inode'));
                        await writeFile(file, 'replacement evidence\n');
                    }
                    return stat;
                },
                open: async (name, flags) => {
                    const handle = await open(name, flags);
                    return {
                        stat: () => handle.stat({ bigint: true }),
                        readFile: async () => {
                            descriptorBytes = await handle.readFile();
                            return descriptorBytes;
                        },
                        close: async () => {
                            closed = true;
                            await handle.close();
                        },
                    };
                },
            }),
            /identity|metadata|changed/i,
        );
        assert.equal(closed, true);
        assert.deepEqual(descriptorBytes, Buffer.from('original evidence\n'));
        assert.equal(await readFile(file, 'utf8'), 'replacement evidence\n');
    } finally {
        assert.equal(dirname(resolve(parent)), resolve(await realpath(tmpdir())));
        await rm(parent, { recursive: true, force: true });
    }
});
