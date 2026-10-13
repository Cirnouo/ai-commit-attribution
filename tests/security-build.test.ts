import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSecurityNotices } from '../tooling/build-security.ts';
import { isRecord } from '../tooling/errors.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = path.join(root, 'tooling/security/dist/check-security.mjs');

test('committed security checker includes its parser and fails closed without node_modules', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-bundle-')));
    try {
        await assert.doesNotReject(readFile(bundle), 'commit a standalone security entry before installation');
        await copyFile(bundle, path.join(directory, 'check-security.mjs'));
        execFileSync('git', ['init', '--quiet', directory], { windowsHide: true });
        await mkdir(path.join(directory, 'docs/policies'), { recursive: true });
        await writeFile(path.join(directory, 'package.json'), '{}');
        await writeFile(path.join(directory, 'pnpm-lock.yaml'), 'invalid: [');
        await writeFile(
            path.join(directory, 'docs/policies/security-exceptions.json'),
            '{"schemaVersion":1,"exceptions":[]}',
        );
        let failure: unknown;
        try {
            execFileSync(process.execPath, ['check-security.mjs', '--phase', 'lockfile', '--root', directory], {
                cwd: directory,
                windowsHide: true,
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (error) {
            failure = error;
        }
        assert.ok(isRecord(failure));
        assert.equal(failure.status, 1);
        assert.equal(typeof failure.stderr, 'string');
        const result: unknown = JSON.parse(String(failure.stderr));
        assert.ok(isRecord(result) && typeof result.error === 'string');
        assert.equal(result.ok, false);
        assert.match(result.error, /Malformed lockfile YAML/);
        assert.doesNotMatch(result.error, /module|package.*not found/i);
        for (const args of [
            [],
            ['--phase', 'lockfile'],
            ['--phase', 'unknown'],
            ['--phase', 'lockfile', '--phase', 'complete'],
            ['--root'],
            ['--unexpected', 'value'],
        ]) {
            let error: unknown;
            try {
                execFileSync(process.execPath, ['check-security.mjs', ...args], {
                    cwd: directory,
                    windowsHide: true,
                    encoding: 'utf8',
                    stdio: 'pipe',
                });
            } catch (failure) {
                error = failure;
            }
            assert.ok(isRecord(error));
            assert.equal(error.status, 1);
            const result: unknown = JSON.parse(String(error.stderr));
            assert.ok(isRecord(result) && typeof result.error === 'string');
            assert.match(result.error, /Unknown security phase|Usage:/);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('security build comparison rejects drift without repairing it', async () => {
    const { generateSecurityFiles, verifySecurityFiles, writeSecurityFiles } = await import(
        '../tooling/build-security.ts'
    );
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-security-build-')));
    try {
        const files = await generateSecurityFiles();
        assert.deepEqual([...files.keys()].sort(), ['THIRD-PARTY-NOTICES.txt', 'check-security.mjs']);
        const license = files.get('THIRD-PARTY-NOTICES.txt')?.toString();
        const yamlLicense = await readFile(path.join(root, 'node_modules/yaml/LICENSE'), 'utf8');
        const semverLicense = await readFile(path.join(root, 'node_modules/semver/LICENSE'), 'utf8');
        assert.equal(
            license,
            `--- yaml@2.9.1 (ISC) ---\n\n${yamlLicense}\n--- semver@7.8.5 (ISC) ---\n\n${semverLicense}\n`,
        );
        await writeSecurityFiles(directory, files);
        await verifySecurityFiles(directory, files);
        await writeFile(path.join(directory, 'check-security.mjs'), 'throw new Error("drift");\n');
        await assert.rejects(verifySecurityFiles(directory, files), /Stale security build/);
        assert.equal(await readFile(path.join(directory, 'check-security.mjs'), 'utf8'), 'throw new Error("drift");\n');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

for (const name of ['yaml', 'semver']) {
    test(`security notices reject changed ${name} identity, version, license metadata and original text`, async () => {
        const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-security-notices-')));
        try {
            for (const dependency of ['yaml', 'semver']) {
                await mkdir(path.join(directory, dependency));
                for (const file of ['LICENSE', 'package.json'])
                    await copyFile(
                        path.join(root, 'node_modules', dependency, file),
                        path.join(directory, dependency, file),
                    );
            }
            const metadataPath = path.join(directory, name, 'package.json');
            const originalMetadata = await readFile(metadataPath, 'utf8');
            const metadata: unknown = JSON.parse(originalMetadata);
            assert.ok(isRecord(metadata));
            for (const changes of [{ name: 'other' }, { version: '0.0.0' }, { license: 'MIT' }]) {
                await writeFile(metadataPath, JSON.stringify({ ...metadata, ...changes }));
                await assert.rejects(readSecurityNotices(directory, ['yaml', 'semver']), /dependency license changed/);
            }
            await writeFile(metadataPath, originalMetadata);
            const licensePath = path.join(directory, name, 'LICENSE');
            const originalLicense = await readFile(licensePath, 'utf8');
            await writeFile(licensePath, `${originalLicense}\nModified notice\n`);
            await assert.rejects(readSecurityNotices(directory, ['yaml', 'semver']), /dependency license changed/);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
}

test('standalone security checker reaches strict version validation with valid YAML and no dependencies', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-standalone-version-')));
    try {
        await copyFile(bundle, path.join(directory, 'check-security.mjs'));
        execFileSync('git', ['init', '--quiet', directory], { windowsHide: true });
        await mkdir(path.join(directory, 'docs/policies'), { recursive: true });
        await mkdir(path.join(directory, 'src'));
        await writeFile(path.join(directory, 'src/evidence.ts'), 'export const safe = true;\n');
        await writeFile(path.join(directory, 'package.json'), '{}');
        await writeFile(
            path.join(directory, 'docs/policies/security-exceptions.json'),
            '{"schemaVersion":1,"exceptions":[]}',
        );
        await writeFile(
            path.join(directory, 'pnpm-lock.yaml'),
            `lockfileVersion: '9.0'
importers:
    .: {}
packages:
    helper@1.2.3-alpha..1:
        resolution: {integrity: sha512-aGVscGVy}
snapshots:
    helper@1.2.3-alpha..1: {}
`,
        );
        let failure: unknown;
        try {
            execFileSync(process.execPath, ['check-security.mjs', '--phase', 'lockfile', '--root', directory], {
                cwd: directory,
                windowsHide: true,
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (error) {
            failure = error;
        }
        assert.ok(isRecord(failure));
        assert.equal(failure.status, 1);
        const result: unknown = JSON.parse(String(failure.stderr));
        assert.ok(isRecord(result) && typeof result.error === 'string');
        assert.equal(result.ok, false);
        assert.match(result.error, /Non-registry or unpinned dependency: helper@1\.2\.3-alpha\.\.1/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('standalone lockfile preflight validates a real lock without release evidence or installed dependencies', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dct-standalone-preflight-')));
    try {
        await copyFile(bundle, path.join(directory, 'check-security.mjs'));
        await copyFile(path.join(root, 'pnpm-lock.yaml'), path.join(directory, 'pnpm-lock.yaml'));
        execFileSync('git', ['init', '--quiet', directory], { windowsHide: true });
        await mkdir(path.join(directory, 'docs/policies'), { recursive: true });
        await mkdir(path.join(directory, 'src'));
        await writeFile(path.join(directory, 'src/evidence.ts'), 'export const safe = true;\n');
        await writeFile(path.join(directory, 'package.json'), '{}');
        await writeFile(
            path.join(directory, 'docs/policies/security-exceptions.json'),
            '{"schemaVersion":1,"exceptions":[]}',
        );
        let failure: unknown;
        try {
            execFileSync(process.execPath, ['check-security.mjs', '--phase', 'lockfile', '--root', directory], {
                cwd: directory,
                windowsHide: true,
                encoding: 'utf8',
                stdio: 'pipe',
            });
        } catch (error) {
            failure = error;
        }
        assert.ok(isRecord(failure));
        assert.equal(failure.status, 1);
        const result: unknown = JSON.parse(String(failure.stderr));
        assert.ok(isRecord(result) && typeof result.error === 'string');
        assert.match(result.error, /Lockfile importer differs from manifest/);
        assert.doesNotMatch(result.error, /ENOENT|module|official-server-release|node_modules/i);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
