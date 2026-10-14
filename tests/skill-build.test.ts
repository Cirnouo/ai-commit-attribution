import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, cp, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('business build has a separate exact inventory, native version, original license and no invented notices', async () => {
    assert.ok(
        existsSync(new URL('../tooling/build-skill.ts', import.meta.url)),
        'PR4 must build its real business payload',
    );
    const { generateSkillFiles, verifySkillFiles, writeSkillFiles } = await import('../tooling/build-skill.ts');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'skill-build-')));
    try {
        const files = await generateSkillFiles();
        assert.deepEqual([...files.keys()].sort(), [
            'LICENSE',
            'SKILL.md',
            'THIRD-PARTY-NOTICES.txt',
            'references/agent-registry.json',
            'references/hosts.md',
            'references/integration.md',
            'references/messages.md',
            'references/policy.md',
            'references/records.md',
            'scripts/attribution.mjs',
        ]);
        assert.deepEqual(files.get('LICENSE'), await readFile(new URL('../LICENSE', import.meta.url)));
        assert.equal(
            files.get('THIRD-PARTY-NOTICES.txt')?.toString(),
            'No third-party runtime code is included in this Skill bundle.\n',
        );
        assert.match(files.get('SKILL.md')?.toString() ?? '', /version: 0\.1\.0/);
        await writeSkillFiles(directory, files);
        await verifySkillFiles(directory, files);
        for (const file of files.keys()) {
            const output = path.join(directory, file);
            const original = await readFile(output);
            await writeFile(output, 'drift\n');
            await assert.rejects(verifySkillFiles(directory, files), /Stale/);
            assert.equal(await readFile(output, 'utf8'), 'drift\n');
            await writeFile(output, original);
        }
        await mkdir(path.join(directory, 'empty'));
        await assert.rejects(verifySkillFiles(directory, files), /inventory/);
        await assert.rejects(writeSkillFiles(directory, files), /inventory/);
        await rm(path.join(directory, 'empty'), { recursive: true });
        await writeFile(path.join(directory, 'extra'), 'peer\n');
        await assert.rejects(writeSkillFiles(directory, files), /inventory/);
        assert.equal(await readFile(path.join(directory, 'extra'), 'utf8'), 'peer\n');
        await rm(path.join(directory, 'extra'));
        await rm(path.join(directory, 'references'), { recursive: true });
        await mkdir(path.join(directory, 'references'));
        await assert.rejects(writeSkillFiles(directory, files), /empty.*inventory/);
        await rm(path.join(directory, 'references'), { recursive: true });
        await writeSkillFiles(directory, files);
        await rm(path.join(directory, 'SKILL.md'));
        await assert.rejects(verifySkillFiles(directory, files), /inventory/);
        await writeSkillFiles(directory, files);
        const peer = path.join(path.dirname(directory), `${path.basename(directory)}-peer`);
        try {
            await copyFile(path.join(directory, 'references/records.md'), peer);
            await rm(path.join(directory, 'references/records.md'));
            await link(peer, path.join(directory, 'references/records.md'));
            const before = await readFile(path.join(directory, 'SKILL.md'));
            await assert.rejects(writeSkillFiles(directory, files), /physical|link/);
            assert.deepEqual(await readFile(path.join(directory, 'SKILL.md')), before);
            assert.deepEqual(await readFile(peer), files.get('references/records.md'));
            await assert.rejects(verifySkillFiles(directory, files), /physical|link/);
            await rm(path.join(directory, 'references/records.md'));
            await writeSkillFiles(directory, files);
            await rm(path.join(directory, 'references'), { recursive: true });
            const external = `${directory}-external`;
            await mkdir(external);
            await writeFile(path.join(external, 'sentinel'), 'external\n');
            try {
                await symlink(
                    external,
                    path.join(directory, 'references'),
                    process.platform === 'win32' ? 'junction' : 'dir',
                );
                await assert.rejects(writeSkillFiles(directory, files), /physical|link/);
                assert.equal(await readFile(path.join(external, 'sentinel'), 'utf8'), 'external\n');
                await rm(path.join(directory, 'references'), { recursive: true });
            } finally {
                await rm(external, { recursive: true, force: true });
            }
        } finally {
            await rm(peer, { force: true });
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('maintained packaging input inventory, metadata, installed links and runtime notices fail closed', async () => {
    const {
        generateSkillFiles,
        readPackagingInputs,
        skillFrontmatter,
        skillNotices,
        validateSkillLinks,
        verifySkillFiles,
    } = await import('../tooling/build-skill.ts');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'skill-inputs-')));
    try {
        const packaging = path.join(directory, 'packaging');
        await cp(new URL('../packaging/', import.meta.url), packaging, { recursive: true });
        await readPackagingInputs(packaging);
        await writeFile(path.join(packaging, 'extra.md'), 'extra\n');
        await assert.rejects(readPackagingInputs(packaging), /inventory/);
        await rm(path.join(packaging, 'extra.md'));
        await rm(path.join(packaging, 'records.md'));
        await assert.rejects(readPackagingInputs(packaging), /inventory/);
        await mkdir(path.join(packaging, 'records.md'));
        await assert.rejects(readPackagingInputs(packaging), /regular|directory|EISDIR/i);
        for (const source of [
            'no frontmatter',
            '---\nname: other\ndescription: valid\n---\n',
            '---\nname: ai-commit-attribution\nname: other\ndescription: valid\n---\n',
            '---\nname: ai-commit-attribution\ndescription: !unknown value\n---\n',
        ])
            assert.throws(() => skillFrontmatter(source), /Skill|YAML/);
        assert.throws(() => skillNotices(['unreviewed-runtime']), /Unreviewed/);
        const files = await generateSkillFiles();
        for (const link of [
            '../../escape',
            '/absolute',
            'file:///private',
            'references/missing.md',
            'references\\records.md',
        ]) {
            const broken = new Map(files);
            broken.set('SKILL.md', Buffer.from(`[resource](${link})\n`));
            assert.throws(() => validateSkillLinks(broken), /link/);
        }
        const unconsumed = new Map(files);
        unconsumed.set('SKILL.md', Buffer.from('No resource links.\n'));
        assert.throws(() => validateSkillLinks(unconsumed), /unconsumed/);
        const wrongInventory = new Map(files);
        wrongInventory.set('../escape', Buffer.from('unsafe'));
        await assert.rejects(verifySkillFiles(directory, wrongInventory), /inventory/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
