import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'attribution-cli-entry-')));
const alias = path.join(directory, 'checkout-alias');
const environment = Object.fromEntries(
    Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith('GIT_') && !key.startsWith('GITHUB_') && key !== 'GH_TOKEN',
    ),
);
const emptyConfig = path.join(directory, 'empty-config');
await writeFile(emptyConfig, '');
environment.GIT_CONFIG_NOSYSTEM = '1';
environment.GIT_CONFIG_GLOBAL = emptyConfig;
execFileSync('git', ['init', '--quiet', '--initial-branch=main', directory], { env: environment, windowsHide: true });
await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
await writeFile(path.join(directory, 'bad.md'), '# Missing newline');
await writeFile(path.join(directory, 'bad.ts'), 'const value: = ;\n');

after(async () => {
    assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('attribution-cli-entry-'));
    await rm(directory, { recursive: true, force: true });
});

const entries = [
    { file: 'build-security.ts', args: ['--check'], status: 0, output: /Committed security checker exactly matches/ },
    { file: 'check-text-style.ts', args: ['bad.md'], status: 1, output: /newline/i },
    { file: 'check-security.ts', args: [], status: 1, output: /Usage:/ },
    { file: 'check-scripts.ts', args: [], status: 1, output: /Unexpected token/ },
    { file: 'check-commits.ts', args: [], status: 1, output: /HEAD|revision|fatal/i },
    { file: 'release.ts', args: [], status: 1, output: /requires.*event.*token/ },
    { file: 'issue-feedback.ts', args: [], status: 1, output: /requires.*event.*token/ },
    { file: 'repository-audit.ts', args: [], status: 1, output: /Required.*missing|Ignore policy missing/ },
] as const;

for (const entry of entries) {
    test(`aliased ${entry.file} executes its real CLI validation`, async () => {
        const file = path.join(alias, 'tooling', entry.file);
        assert.notEqual(
            file,
            await realpath(file),
            'the process entry path must actually differ from its resolved module',
        );
        const result = spawnSync(process.execPath, [file, ...entry.args], {
            cwd: directory,
            env: environment,
            encoding: 'utf8',
            windowsHide: true,
        });
        assert.equal(result.status, entry.status, result.stdout + result.stderr);
        assert.match(result.stdout + result.stderr, entry.output);
    });

    test(`importing aliased ${entry.file} does not execute its CLI`, () => {
        const file = path.join(alias, 'tooling', entry.file);
        const script = `process.argv = [process.execPath, ${JSON.stringify(file)}, '--check']; await import(${JSON.stringify(pathToFileURL(file).href)}); console.log('import completed');`;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: directory,
            env: environment,
            encoding: 'utf8',
            windowsHide: true,
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(result.stdout.trim(), 'import completed');
        assert.equal(result.stderr, '');
    });
}

test('aliased standalone security checker audits malformed input before any installation', async () => {
    const fixture = path.join(directory, 'preinstallation');
    await mkdir(path.join(fixture, 'docs/policies'), { recursive: true });
    execFileSync('git', ['init', '--quiet', fixture], { env: environment, windowsHide: true });
    await writeFile(path.join(fixture, 'package.json'), '{}\n');
    await writeFile(path.join(fixture, 'pnpm-lock.yaml'), 'invalid: [');
    await writeFile(
        path.join(fixture, 'docs/policies/security-exceptions.json'),
        '{"schemaVersion":1,"exceptions":[]}\n',
    );
    const standalone = path.join(directory, 'standalone');
    const standaloneAlias = path.join(directory, 'standalone-alias');
    await mkdir(standalone);
    await copyFile(
        path.join(root, 'tooling/security/dist/check-security.mjs'),
        path.join(standalone, 'check-security.mjs'),
    );
    await symlink(standalone, standaloneAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const entry = path.join(standaloneAlias, 'check-security.mjs');
    assert.notEqual(entry, await realpath(entry));
    await assert.rejects(readFile(path.join(standalone, 'node_modules')), /ENOENT/);
    const pnpmProbe = path.join(directory, 'pnpm-probe.cjs');
    const pnpmSentinel = path.join(directory, 'pnpm-executed');
    await writeFile(
        pnpmProbe,
        "require('node:fs').writeFileSync(process.env.ATTRIBUTION_PNPM_SENTINEL, 'unexpected execution'); process.exit(97);\n",
    );
    const result = spawnSync(process.execPath, [entry, '--phase', 'lockfile', '--root', fixture], {
        cwd: fixture,
        env: { ...environment, npm_execpath: pnpmProbe, ATTRIBUTION_PNPM_SENTINEL: pnpmSentinel },
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const error: unknown = JSON.parse(result.stderr);
    assert.ok(error !== null && typeof error === 'object' && 'ok' in error && 'error' in error);
    assert.equal(error.ok, false);
    assert.match(String(error.error), /Malformed lockfile YAML/);
    assert.doesNotMatch(result.stderr, /module.*not found|Cannot find package/);
    await assert.rejects(readFile(pnpmSentinel), /ENOENT/);
});

test('missing native entry capability fails closed in source and preinstallation security CLIs', async () => {
    const preload = path.join(directory, 'missing-native-main.mjs');
    await writeFile(
        preload,
        `
        import { registerHooks } from 'node:module';
        registerHooks({ load(url, context, nextLoad) {
            const result = nextLoad(url, context);
            if (url.endsWith('/check-security.ts') || url.endsWith('/check-security.mjs'))
                return { ...result, source: 'import.meta.main = undefined;\\n' + result.source.toString() };
            return result;
        } });
    `,
    );
    const standalone = path.join(directory, 'missing-capability-standalone');
    const standaloneAlias = path.join(directory, 'missing-capability-alias');
    await mkdir(standalone);
    await copyFile(
        path.join(root, 'tooling/security/dist/check-security.mjs'),
        path.join(standalone, 'check-security.mjs'),
    );
    await symlink(standalone, standaloneAlias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const entry of [
        path.join(alias, 'tooling/check-security.ts'),
        path.join(standaloneAlias, 'check-security.mjs'),
    ]) {
        const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, entry], {
            cwd: directory,
            env: environment,
            encoding: 'utf8',
            windowsHide: true,
        });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, /supported Node.*import\.meta\.main/);
        assert.equal(result.stdout, '');
    }
});
