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
        assert.equal(dirname(resolve(root)), resolve(tmpdir()));
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
