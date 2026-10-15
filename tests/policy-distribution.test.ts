import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('installed schema 2 policy routes bypass default resources without actual Git state', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-installed-')));
    try {
        const payload = path.join(directory, 'home/skill');
        const repository = path.join(directory, 'business');
        const commonGitDir = path.join(directory, 'declared-admin');
        await mkdir(repository);
        await mkdir(commonGitDir);
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
        await writeFile(path.join(payload, 'references/agent-registry.json'), 'UNUSABLE REGISTRY');
        const operation = {
            schemaVersion: 1,
            id: 'installed-decision',
            repository,
            worktree: repository,
            commonGitDir,
            kind: 'amend',
            paths: ['declared.txt'],
            targets: [{ role: 'head', objectId: 'f'.repeat(40) }],
        };
        const decision = {
            schemaVersion: 2,
            artifact: 'policy-decision',
            operation,
            branch: 'repository-policy',
            rationale: 'The Agent read the applicable instructions.',
            decisionSource: { kind: 'agent-semantic', reference: path.join(directory, 'unread-reference') },
        };
        const message = Buffer.from(
            'subject\r\n\r\nAssisted-by: invalid\r\nCo-authored-by: AI <ai@example.invalid>\r\n',
        );
        const files = {
            operation: path.join(directory, 'operation'),
            decision: path.join(directory, 'decision'),
            message: path.join(directory, 'message'),
        };
        await writeFile(files.operation, JSON.stringify(operation));
        await writeFile(files.decision, JSON.stringify(decision));
        await writeFile(files.message, message);
        const env = Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$)/i.test(key)),
        );
        const entry = path.join(payload, 'scripts/attribution.mjs');
        const run = (args: string[]) =>
            spawnSync(process.execPath, [entry, ...args], { cwd: directory, env, encoding: 'utf8', windowsHide: true });
        const args = Object.entries(files).flatMap(([key, value]) => [`--${key}`, value]);
        args.push(
            '--input',
            path.join(directory, 'absent-ledger'),
            '--assessment',
            path.join(directory, 'absent-assessment'),
        );
        for (const mode of ['render', 'validate']) {
            const response = run([mode, ...args]);
            assert.equal(response.status, 10, response.stderr + response.stdout);
            const result = JSON.parse(response.stdout);
            assert.equal(result.schemaVersion, 2);
            assert.deepEqual(result.routing, { branch: 'repository-policy' });
            assert.equal(result.participationEvidence.status, 'not-run');
            assert.equal(result.repositoryPolicyValidation.status, 'not-run');
            assert.equal(result.message.preview, mode === 'render' ? message.toString() : undefined);
        }
        await writeFile(files.decision, JSON.stringify({ ...decision, branch: 'needs-decision' }));
        const output = path.join(directory, 'candidate');
        const unresolved = run(['render', ...args, '--output', output]);
        assert.equal(unresolved.status, 20, unresolved.stderr);
        assert.equal(JSON.parse(unresolved.stdout).message.preview, undefined);
        assert.equal(existsSync(output), false);
        await writeFile(files.decision, JSON.stringify(decision));
        for (const legacy of [
            ['policy', 'scan', '--operation', 'unread', '--context', 'unread'],
            ['render', ...args, '--context', 'unread'],
            ['validate', ...args, '--context', 'unread'],
        ]) {
            const response = run(legacy);
            assert.equal(response.status, 2, response.stderr);
            assert.match(JSON.parse(response.stderr).error, /schemaVersion 2 AI policy-decision/);
        }
        for (const change of [{ schemaVersion: 1 }, { binding: {} }, { candidates: [] }, { freshness: 'current' }]) {
            await writeFile(files.decision, JSON.stringify({ ...decision, ...change }));
            const response = run(['render', ...args]);
            assert.equal(response.status, 2, response.stderr);
            assert.match(JSON.parse(response.stderr).error, /schemaVersion 2 AI policy-decision/);
        }
        await writeFile(files.decision, JSON.stringify(decision));
        const loader = path.join(directory, 'deny-default.mjs');
        await writeFile(
            loader,
            `import {registerHooks} from 'node:module';registerHooks({resolve(s,c,n){if(s.endsWith('/summarize.ts')||s==='./summarize.ts')throw new Error('DEFAULT SUMMARY IMPORTED');return n(s,c);}});\n`,
        );
        const source = spawnSync(
            process.execPath,
            [
                '--import',
                pathToFileURL(loader).href,
                fileURLToPath(new URL('../src/attribution.ts', import.meta.url)),
                'render',
                ...args,
            ],
            { cwd: directory, env, encoding: 'utf8', windowsHide: true },
        );
        assert.equal(source.status, 10, source.stderr);
        assert.deepEqual(await readFile(files.message), message);
        assert.deepEqual(await readFile(files.operation), Buffer.from(JSON.stringify(operation)));
        assert.equal(existsSync(path.join(directory, 'node_modules')), false);
        assert.equal(existsSync(path.join(repository, '.git')), false);
    } finally {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
