import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLockInventory } from '../tooling/security/audit-policy.ts';

test('installer evidence rejects changed original notices and bundled bytes without executing CLI', async () => {
    assert.ok(
        existsSync(new URL('../tooling/security/installer-evidence.ts', import.meta.url)),
        'installer evidence verifier must exist',
    );
    const { verifyInstallerEvidence } = await import('../tooling/security/installer-evidence.ts');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const inventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'attribution-installer-'));
    try {
        await cp(path.join(root, 'node_modules/skills'), path.join(temporary, 'skills'), {
            recursive: true,
            dereference: true,
            filter: (name) =>
                !path.relative(path.join(root, 'node_modules/skills'), name).split(path.sep).includes('node_modules'),
        });
        const evidence = JSON.parse(
            await readFile(path.join(root, 'tooling/security/installer-evidence.json'), 'utf8'),
        ) as unknown;
        await verifyInstallerEvidence(path.join(temporary, 'skills'), inventory, evidence);
        const notice = path.join(temporary, 'skills/ThirdPartyNoticeText.txt');
        await writeFile(notice, 'fabricated notices\n');
        await assert.rejects(
            verifyInstallerEvidence(path.join(temporary, 'skills'), inventory, evidence),
            /digest|fingerprint|bytes/,
        );
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
        await rm(temporary, { recursive: true, force: true });
    }
});

test('audited skills CLI repository-root discovery copies the complete generated payload instead of packaging inputs', async () => {
    const { verifyInstallerEvidence } = await import('../tooling/security/installer-evidence.ts');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const installer = await realpath(path.join(root, 'node_modules/skills'));
    const inventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    await verifyInstallerEvidence(
        installer,
        inventory,
        JSON.parse(await readFile(path.join(root, 'tooling/security/installer-evidence.json'), 'utf8')),
    );
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'skill-discovery-')));
    const source = path.join(temporary, 'source');
    const home = path.join(temporary, 'home');
    const scratch = path.join(temporary, 'scratch');
    const cwd = path.join(temporary, 'business');
    try {
        for (const directory of [source, home, scratch, cwd]) await mkdir(directory);
        await cp(path.join(root, 'packaging'), path.join(source, 'packaging'), { recursive: true });
        const payload = path.join(source, 'skills/ai-commit-attribution');
        await cp(path.join(root, 'skills/ai-commit-attribution'), payload, { recursive: true });
        const environment: NodeJS.ProcessEnv = {
            ...Object.fromEntries(
                Object.entries(process.env).filter(([key]) => /^(?:SystemRoot|windir|ComSpec)$/i.test(key)),
            ),
            PATH: path.dirname(process.execPath),
            HOME: home,
            USERPROFILE: home,
            HOMEDRIVE: path.parse(home).root.replace(/[\\/]$/, ''),
            HOMEPATH: home.slice(path.parse(home).root.length - 1),
            APPDATA: path.join(home, 'AppData/Roaming'),
            LOCALAPPDATA: path.join(home, 'AppData/Local'),
            TEMP: scratch,
            TMP: scratch,
            TMPDIR: scratch,
            XDG_CONFIG_HOME: path.join(home, 'config'),
            XDG_CACHE_HOME: path.join(home, 'cache'),
            XDG_DATA_HOME: path.join(home, 'data'),
            XDG_STATE_HOME: path.join(home, 'state'),
            CODEX_HOME: path.join(home, '.codex'),
            GH_CONFIG_DIR: path.join(home, 'gh'),
            npm_config_cache: path.join(home, 'npm-cache'),
            PNPM_HOME: path.join(home, 'pnpm'),
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'protocol.allow',
            GIT_CONFIG_VALUE_0: 'never',
            GIT_TERMINAL_PROMPT: '0',
            GCM_INTERACTIVE: 'never',
            DISABLE_TELEMETRY: '1',
            DO_NOT_TRACK: '1',
            NODE_DISABLE_COMPILE_CACHE: '1',
        };
        const run = (args: string[]) => {
            const result = spawnSync(process.execPath, args, {
                cwd,
                env: environment,
                encoding: 'utf8',
                windowsHide: true,
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
            });
            assert.equal(result.error, undefined, result.error?.message);
            assert.equal(result.status, 0, result.stderr + result.stdout);
            return JSON.parse(result.stdout);
        };
        const probe = run([
            '--input-type=module',
            '-e',
            "import os from 'node:os'; console.log(JSON.stringify({home:os.homedir(),tmp:os.tmpdir(),cwd:process.cwd()}));",
        ]);
        assert.deepEqual(probe, { home, tmp: scratch, cwd });
        const result = run([
            path.join(installer, 'bin/cli.mjs'),
            'add',
            source,
            '--skill',
            'ai-commit-attribution',
            '--agent',
            'codex',
            '--global',
            '--copy',
            '--yes',
            '--json',
        ]);
        const installed = path.join(home, '.agents/skills/ai-commit-attribution');
        assert.equal(result.length, 1);
        assert.equal(result[0].status, 'installed');
        assert.equal(result[0].source, source);
        assert.equal(result[0].scope, 'global');
        assert.equal(result[0].mode, 'copy');
        assert.equal(result[0].path, installed);
        const files: string[] = [];
        async function visit(relative: string): Promise<void> {
            const entries = await readdir(path.join(installed, relative), { withFileTypes: true });
            assert.ok(entries.length > 0, 'installed payload must not contain empty directories');
            for (const entry of entries) {
                const name = relative ? `${relative}/${entry.name}` : entry.name;
                assert.equal(entry.isSymbolicLink(), false, name);
                if (entry.isDirectory()) await visit(name);
                else {
                    assert.equal(entry.isFile(), true, name);
                    files.push(name);
                }
            }
        }
        await visit('');
        assert.deepEqual(files.sort(), [
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
        for (const file of files)
            assert.deepEqual(
                await readFile(path.join(installed, file)),
                await readFile(path.join(payload, file)),
                file,
            );
        const lock = JSON.parse(await readFile(path.join(home, 'state/skills/.skill-lock.json'), 'utf8'));
        assert.deepEqual(Object.keys(lock.skills), ['ai-commit-attribution']);
        assert.equal(lock.skills['ai-commit-attribution'].sourceType, 'local');
        assert.equal(lock.skills['ai-commit-attribution'].sourceUrl, source);
        assert.deepEqual(await readdir(path.join(home, '.agents/skills')), ['ai-commit-attribution']);
        assert.equal(existsSync(path.join(home, '.codex/skills')), false);
    } finally {
        assert.equal(path.dirname(temporary), await realpath(os.tmpdir()));
        await rm(temporary, { recursive: true, force: true });
    }
});
