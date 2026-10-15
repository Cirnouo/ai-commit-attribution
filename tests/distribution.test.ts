import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('installed summary runs business success and failures outside source with unchanged Git state and identity', async (t) => {
    const payload = new URL('../skills/ai-commit-attribution/', import.meta.url);
    assert.ok(existsSync(new URL('scripts/attribution.mjs', payload)), 'PR4 must ship its actual summary bundle');
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'skill-installed-')));
    try {
        const install = path.join(directory, 'home/.agents/skills/ai-commit-attribution');
        const business = path.join(directory, 'business');
        await cp(payload, install, { recursive: true });
        await mkdir(business);
        const git = (args: string[]) =>
            execFileSync('git', args, { cwd: business, encoding: 'utf8', windowsHide: true });
        git(['init', '--quiet']);
        await writeFile(path.join(business, ' report.md'), 'whitespace filename\n');
        await writeFile(path.join(business, 'report.md'), 'distinct filename\n');
        const commonGitDir = await realpath(path.join(business, '.git'));
        const operation = {
            schemaVersion: 1,
            id: 'op',
            repository: business,
            worktree: business,
            commonGitDir,
            kind: 'commit',
            paths: [],
            targets: [],
        };
        const confirmed = { agent: 'Codex App', model: 'gpt-6.1-sol' };
        const input = {
            schemaVersion: 2,
            ledgerId: '00000000-0000-4000-8000-000000000001',
            operation,
            identities: [confirmed],
            blockers: [],
        };
        const ledgerFile = path.join(directory, 'ledger.json');
        const operationFile = path.join(directory, 'operation.json');
        await writeFile(ledgerFile, JSON.stringify(input));
        await writeFile(operationFile, JSON.stringify(operation));
        const env = Object.fromEntries(
            Object.entries(process.env).filter(
                ([key]) => !/^(?:NODE_OPTIONS|NODE_PATH|GIT_|HOME$|USERPROFILE$|XDG_)/i.test(key),
            ),
        );
        Object.assign(env, {
            HOME: path.join(directory, 'home'),
            USERPROFILE: path.join(directory, 'home'),
            XDG_CONFIG_HOME: path.join(directory, 'home/config'),
        });
        const run = (args: string[]) =>
            spawnSync(process.execPath, [path.join(install, 'scripts/attribution.mjs'), ...args], {
                cwd: business,
                env,
                windowsHide: true,
                encoding: 'utf8',
            });
        const args = ['summarize', '--input', ledgerFile, '--operation', operationFile];
        // Empty repositories have no refs/identity; use status-aware reads for the snapshot.
        const state = () =>
            ['status --porcelain=v1', 'show-ref', 'config --show-origin --get-regexp ^user\\.'].map(
                (command) =>
                    spawnSync('git', command.split(' '), { cwd: business, encoding: 'utf8', windowsHide: true }).stdout,
            );
        const before = state();
        const beforeHead = await readFile(path.join(commonGitDir, 'HEAD'));
        const beforeConfig = await readFile(path.join(commonGitDir, 'config'));
        const success = run(args);
        assert.equal(success.status, 0, success.stderr);
        assert.equal(JSON.parse(success.stdout).tuples[0].agent, 'Codex App');
        assert.equal(success.stderr, '');
        assert.equal(existsSync(path.join(directory, 'node_modules')), false);
        await t.test('review F1 installed selected whitespace filename stays exact and mismatch exits 2', async () => {
            const selected = { ...operation, paths: [' report.md'] };
            await writeFile(ledgerFile, JSON.stringify({ ...input, operation: selected }));
            await writeFile(operationFile, JSON.stringify(selected));
            const result = run(args);
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(JSON.parse(result.stdout).operation.paths, [' report.md']);
            await writeFile(operationFile, JSON.stringify({ ...operation, paths: ['report.md'] }));
            assert.equal(run(args).status, 2);
        });
        await t.test(
            'installed schema 2 handles empty sets, exact tuple dedupe, blockers and rejects old schemas',
            async () => {
                await writeFile(operationFile, JSON.stringify(operation));
                await writeFile(ledgerFile, JSON.stringify({ ...input, identities: [] }));
                assert.equal(run(args).status, 0);
                await writeFile(
                    ledgerFile,
                    JSON.stringify({
                        ...input,
                        identities: [confirmed, { ...confirmed, reasoning: 'none' }, confirmed],
                    }),
                );
                const deduped = run(args);
                assert.equal(deduped.status, 0, deduped.stderr);
                assert.deepEqual(JSON.parse(deduped.stdout).tuples, [confirmed, { ...confirmed, reasoning: 'none' }]);
                await writeFile(
                    ledgerFile,
                    JSON.stringify({
                        ...input,
                        blockers: [{ id: 'required:model', reason: 'Required model unresolved.' }],
                    }),
                );
                const blocked = run(args);
                assert.equal(blocked.status, 20);
                assert.equal(JSON.parse(blocked.stdout).issues[0].id, 'required:model');
                await writeFile(
                    ledgerFile,
                    JSON.stringify({
                        schemaVersion: 1,
                        operation,
                        events: [],
                        knownParticipants: [],
                        userExceptions: [],
                    }),
                );
                const legacy = run(args);
                assert.equal(legacy.status, 2);
                assert.match(JSON.parse(legacy.stderr).error, /migrat.*schemaVersion 2/i);
                for (const model of ['auto', 'latest', 'UNKNOWN', 'N/A', 'null']) {
                    await writeFile(ledgerFile, JSON.stringify({ ...input, identities: [{ ...confirmed, model }] }));
                    assert.equal(run(args).status, 2);
                }
            },
        );
        await writeFile(ledgerFile, JSON.stringify(input));
        await writeFile(operationFile, JSON.stringify(operation));
        for (const bad of [
            [],
            ['render'],
            ['summarize'],
            [...args, '--input', ledgerFile],
            [...args, '--unknown', 'value'],
            ['summarize', '--input', '--operation', operationFile],
        ]) {
            const failure = run(bad);
            assert.equal(failure.status, 2, failure.stderr);
            assert.equal(failure.stdout, '');
        }
        await writeFile(
            ledgerFile,
            JSON.stringify({ ...input, blockers: [{ id: 'required:model', reason: 'Required model unresolved.' }] }),
        );
        const missing = run(args);
        assert.equal(missing.status, 20, missing.stderr);
        assert.equal(JSON.parse(missing.stdout).issues[0].code, 'known-blocker');
        await writeFile(operationFile, JSON.stringify({ ...operation, id: 'stale' }));
        assert.equal(run(args).status, 2);
        await writeFile(ledgerFile, '{"secret":"do not echo this"');
        const malformed = run(args);
        assert.equal(malformed.status, 2);
        assert.doesNotMatch(malformed.stderr, /do not echo/);
        assert.deepEqual(state(), before);
        assert.deepEqual(await readFile(path.join(commonGitDir, 'HEAD')), beforeHead);
        assert.deepEqual(await readFile(path.join(commonGitDir, 'config')), beforeConfig);
        assert.equal(existsSync(path.join(commonGitDir, 'index')), false);
        await writeFile(ledgerFile, JSON.stringify(input));
        await writeFile(operationFile, JSON.stringify(operation));
        const registryFile = path.join(install, 'references/agent-registry.json');
        const registry = JSON.parse(await readFile(registryFile, 'utf8'));
        registry.hosts = registry.hosts.filter((host: { name: string }) => host.name !== 'Codex App');
        await writeFile(registryFile, JSON.stringify(registry));
        assert.equal(run(args).status, 2, 'installed registry must be read relative to the entry, not source/cwd');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
