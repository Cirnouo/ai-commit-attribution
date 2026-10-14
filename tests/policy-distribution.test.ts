import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveTrustedGit } from '../src/safe-git.ts';

test('installed policy scan and freshness run outside source with no default registry/summary access', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-installed-')));
    try {
        const payload = path.join(directory, 'home/.agents/skills/ai-commit-attribution');
        const business = path.join(directory, 'business');
        await mkdir(business);
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
        // Any registry read would fail, so repository handoff cannot hide a default identity veto.
        await writeFile(path.join(payload, 'references/agent-registry.json'), 'THROWING INVALID REGISTRY');
        const executable = await resolveTrustedGit([directory]);
        const env = {
            ...Object.fromEntries(
                Object.entries(process.env).filter(
                    ([key]) => !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$|HOME$|USERPROFILE$|XDG_)/i.test(key),
                ),
            ),
            HOME: path.join(directory, 'home'),
            USERPROFILE: path.join(directory, 'home'),
            XDG_CONFIG_HOME: path.join(directory, 'home/config'),
        };
        const git = (args: string[]) =>
            execFileSync(executable, args, { cwd: business, env, encoding: 'utf8', windowsHide: true });
        git(['init', '--quiet']);
        await writeFile(path.join(business, 'AGENTS.md'), 'AI Co-authored-by is permitted. No model is required.\n');
        const operation = {
            schemaVersion: 1,
            id: 'installed',
            repository: business,
            worktree: business,
            commonGitDir: await realpath(path.join(business, '.git')),
            kind: 'commit',
            paths: [' planned.txt'],
            targets: [],
        };
        const context = {
            schemaVersion: 1,
            phase: 'prepare',
            selection: 'planned-paths',
            invocation: { kind: 'agent-context', reference: 'installed fixture', effectiveDirectory: business },
        };
        const operationFile = path.join(directory, 'operation.json'),
            contextFile = path.join(directory, 'context.json'),
            decisionFile = path.join(directory, 'decision.json');
        await writeFile(operationFile, JSON.stringify(operation));
        await writeFile(contextFile, JSON.stringify(context));
        const args = ['policy', 'scan', '--operation', operationFile, '--context', contextFile];
        const run = (values: string[]) =>
            spawnSync(process.execPath, [path.join(payload, 'scripts/attribution.mjs'), ...values], {
                cwd: business,
                env,
                encoding: 'utf8',
                windowsHide: true,
            });
        const before = {
            head: await readFile(path.join(business, '.git/HEAD')),
            config: await readFile(path.join(business, '.git/config')),
            status: git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1']),
        };
        const scanResult = run(args);
        assert.equal(scanResult.status, 0, scanResult.stderr + scanResult.stdout);
        const scan = JSON.parse(scanResult.stdout);
        const selected = scan.candidates.filter(
            (item: { sourceKind: string }) => item.sourceKind === 'applicable-instruction',
        );
        const decision = {
            schemaVersion: 1,
            artifact: 'policy-decision',
            operation: scan.operation,
            binding: scan.binding,
            branch: 'repository-policy',
            assessments: scan.candidates.map((item: { id: string; sourceKind: string }) => ({
                candidateId: item.id,
                classification: item.sourceKind === 'applicable-instruction' ? 'ai-disclosure-policy' : 'unrelated',
                rationale: 'Agent read this explicit repository rule.',
            })),
            selectedCandidateIds: selected.map((item: { id: string }) => item.id),
            issueIds: [],
            rationale: 'Repository explicitly permits AI coauthors without model.',
            decisionSource: { kind: 'agent-semantic', reference: 'fixture' },
        };
        await writeFile(decisionFile, JSON.stringify(decision));
        const routed = run([...args, '--decision', decisionFile]);
        assert.equal(routed.status, 10, routed.stderr + routed.stdout);
        assert.equal(JSON.parse(routed.stdout).defaultValidation, 'not-run');
        assert.equal(JSON.parse(routed.stdout).repositoryPolicyValidation, 'not-run');
        assert.equal(Object.hasOwn(JSON.parse(routed.stdout), 'freshScan'), false);
        assert.equal(existsSync(path.join(directory, 'node_modules')), false);
        assert.equal(existsSync(path.join(business, '.git/index')), false);
        assert.deepEqual(await readFile(path.join(business, '.git/HEAD')), before.head);
        assert.deepEqual(await readFile(path.join(business, '.git/config')), before.config);
        assert.equal(git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1']), before.status);
        await writeFile(path.join(business, ' planned.txt'), 'changed after wait\n');
        assert.equal(run([...args, '--decision', decisionFile]).status, 20);
        for (const bad of [
            ['policy'],
            ['policy', 'render'],
            [...args, '--unknown', 'x'],
            [...args, '--operation', operationFile],
            ['policy', 'scan', '--operation', operationFile],
            ['policy', 'scan', '--operation', '--context', contextFile],
        ])
            assert.equal(run(bad).status, 2);
        await writeFile(contextFile, Buffer.alloc(2 * 1024 * 1024 + 1, 65));
        assert.equal(run(args).status, 2);
        // Real source module import sentinel proves policy dispatch never imports summarize.ts.
        const loader = path.join(directory, 'deny-summary.mjs');
        await writeFile(
            loader,
            `import {registerHooks} from 'node:module';\nregisterHooks({resolve(specifier,context,next){if(specifier.endsWith('/summarize.ts')||specifier==='./summarize.ts')throw new Error('DEFAULT SUMMARY IMPORTED');return next(specifier,context);}});\n`,
        );
        await writeFile(contextFile, JSON.stringify(context));
        const source = spawnSync(
            process.execPath,
            [
                '--import',
                pathToFileURL(loader).href,
                fileURLToPath(new URL('../src/attribution.ts', import.meta.url)),
                ...args,
            ],
            { cwd: business, env, encoding: 'utf8', windowsHide: true },
        );
        assert.equal(source.status, 0, source.stderr + source.stdout);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
