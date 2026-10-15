import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PolicyScan } from '../src/policy-contract.ts';
import { resolveTrustedGit } from '../src/safe-git.ts';

test('installed render/validate execute actual default, policy, invalid, gap and stale paths with new-file safety', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'message-installed-')));
    try {
        const business = path.join(directory, 'business'),
            payload = path.join(directory, 'home/skill');
        await mkdir(business);
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
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
        const executable = await resolveTrustedGit([directory]);
        const git = (args: string[]) =>
            execFileSync(executable, args, { cwd: business, env, encoding: 'utf8', windowsHide: true }).trim();
        git(['init', '--quiet', '--initial-branch=main']);
        git(['config', 'user.name', 'Synthetic Fixture']);
        git(['config', 'user.email', 'fixture@example.invalid']);
        const operation = {
            schemaVersion: 1,
            id: 'installed-message',
            repository: business,
            worktree: business,
            commonGitDir: await realpath(path.join(business, '.git')),
            kind: 'commit',
            paths: ['new.txt'],
            targets: [],
        };
        const context = {
            schemaVersion: 1,
            phase: 'prepare',
            selection: 'planned-paths',
            invocation: { kind: 'agent-context', reference: 'fixture:installed', effectiveDirectory: business },
        };
        const files = Object.fromEntries(
            ['message', 'operation', 'context', 'decision', 'input', 'assessment'].map((name) => [
                name,
                path.join(directory, name),
            ]),
        );
        const save = async (key: string, value: unknown) => writeFile(files[key] ?? '', JSON.stringify(value));
        await save('operation', operation);
        await save('context', context);
        const ledger = {
            schemaVersion: 1,
            operation,
            knownParticipants: [{ id: 'actor', eventIds: ['event'] }],
            events: [
                {
                    id: 'event',
                    participantId: 'actor',
                    task: 'test',
                    agent: 'Codex App',
                    model: 'gpt-6.1-sol',
                    reasoning: { state: 'confirmed', value: 'high' },
                    evidence: [
                        {
                            fields: ['agent', 'model', 'reasoning'],
                            kind: 'synthetic fixture',
                            observation: 'effective',
                            reference: 'fixture:dispatch',
                            nativeReasoning: 'enabled',
                        },
                    ],
                },
            ],
            userExceptions: [],
        };
        await save('input', ledger);
        const candidate =
            'subject\r\n\r\nBody\r\n---\r\nstill body\r\n\r\nCo-authored-by: Human <h@example.invalid>\r\n';
        await writeFile(files.message ?? '', candidate);
        const entry = path.join(payload, 'scripts/attribution.mjs');
        const run = (args: string[]) =>
            spawnSync(process.execPath, [entry, ...args], { cwd: directory, env, encoding: 'utf8', windowsHide: true });
        const scanArgs = ['policy', 'scan', '--operation', files.operation ?? '', '--context', files.context ?? ''];
        const decide = async (branch = 'skill-default') => {
            const response = run(scanArgs);
            assert.equal(response.status, 0, response.stderr);
            const scan = JSON.parse(response.stdout) as PolicyScan;
            await save('decision', {
                schemaVersion: 1,
                artifact: 'policy-decision',
                operation: scan.operation,
                binding: scan.binding,
                branch,
                assessments: scan.candidates.map((candidate) => ({
                    candidateId: candidate.id,
                    classification:
                        branch === 'repository-policy' && candidate.sourceKind === 'applicable-instruction'
                            ? 'ai-disclosure-policy'
                            : 'unrelated',
                    rationale: 'Synthetic inspected fixture meaning.',
                })),
                selectedCandidateIds:
                    branch === 'repository-policy'
                        ? scan.candidates
                              .filter((candidate) => candidate.sourceKind === 'applicable-instruction')
                              .map((candidate) => candidate.id)
                        : [],
                issueIds: [],
                rationale: 'Fixture routing.',
                decisionSource: { kind: 'agent-semantic', reference: 'fixture:decision' },
            });
        };
        await decide();
        const args = [
            '--message',
            files.message ?? '',
            '--operation',
            files.operation ?? '',
            '--context',
            files.context ?? '',
            '--decision',
            files.decision ?? '',
            '--input',
            files.input ?? '',
        ];
        const snapshot = async () => ({
            head: await readFile(path.join(business, '.git/HEAD')),
            config: await readFile(path.join(business, '.git/config')),
            refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
            status: git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1']),
            author: git(['var', 'GIT_AUTHOR_IDENT']).replace(/ \d+ [+-]\d+$/, ''),
            committer: git(['var', 'GIT_COMMITTER_IDENT']).replace(/ \d+ [+-]\d+$/, ''),
        });
        const before = await snapshot();
        const success = run(['render', ...args]);
        assert.equal(success.status, 0, success.stderr + success.stdout);
        const expected = `${candidate}Assisted-by: Codex App:gpt-6.1-sol (high)\r\n`;
        assert.equal(JSON.parse(success.stdout).message.preview, expected);
        assert.equal(JSON.parse(success.stdout).participationEvidence.status, 'complete-against-declared-input');
        const trailerParent = path.join(directory, 'shared-trailer-parent');
        await mkdir(trailerParent);
        const observation = path.join(directory, 'trailer-observations');
        const fsWrapper = `export * from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';
let injected=false;
export async function lstat(file,...args){
 const before=await fs.lstat(file,...args);
 if(!injected&&file===${JSON.stringify(trailerParent)}){
  injected=true;await setTimeout(25);await fs.mkdtemp(path.join(file,'unrelated-child-'));
  const after=await fs.lstat(file);
  assert.equal(before.dev,after.dev);assert.equal(before.ino,after.ino);assert.equal(before.mode,after.mode);
  assert.ok(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs);
  await fs.writeFile(${JSON.stringify(observation)},'real child mutation observed');
 }
 return before;
}`;
        const osWrapper = `import os from 'node:os';export default {...os,tmpdir:()=>${JSON.stringify(trailerParent)}};`;
        const preload = path.join(directory, 'trailer-boundary.mjs');
        await writeFile(
            preload,
            `import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){
 if(c.parentURL===${JSON.stringify(pathToFileURL(entry).href)}){
  if(s==='node:fs/promises')return {url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(fsWrapper)}`)},shortCircuit:true};
  if(s==='node:os')return {url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(osWrapper)}`)},shortCircuit:true};
 }
 return n(s,c);
}});
`,
        );
        const busyParent = spawnSync(
            process.execPath,
            ['--import', pathToFileURL(preload).href, entry, 'render', ...args],
            {
                cwd: directory,
                env,
                encoding: 'utf8',
                windowsHide: true,
            },
        );
        assert.equal(busyParent.status, 0, busyParent.stderr + busyParent.stdout);
        assert.equal(JSON.parse(busyParent.stdout).message.preview, expected);
        assert.equal(await readFile(observation, 'utf8'), 'real child mutation observed');
        assert.deepEqual(await snapshot(), before);
        const output = path.join(directory, 'new-message.txt');
        const written = run(['render', ...args, '--output', output]);
        assert.equal(written.status, 0, written.stderr);
        assert.equal(await readFile(output, 'utf8'), expected);
        assert.equal(run(['render', ...args, '--output', output]).status, 2);
        assert.equal(await readFile(output, 'utf8'), expected);
        assert.equal(
            run(['validate', ...args]).status,
            20,
            'valid message missing a supported tuple needs evidence/decision',
        );
        await writeFile(files.message ?? '', expected);
        assert.equal(run(['validate', ...args]).status, 0);
        const nova = 'amazon.nova-micro-v1:0';
        await save('input', {
            ...ledger,
            events: [{ ...ledger.events[0], model: nova, reasoning: { state: 'unknown' } }],
        });
        await writeFile(files.message ?? '', 'subject\n');
        const formal = run(['render', ...args]);
        assert.equal(formal.status, 0, formal.stderr);
        const novaMessage = 'subject\n\nAssisted-by: Codex App:amazon.nova-micro-v1:0\n';
        assert.equal(JSON.parse(formal.stdout).message.preview, novaMessage);
        await writeFile(files.message ?? '', novaMessage);
        assert.equal(run(['validate', ...args]).status, 0);
        await save('input', ledger);
        await writeFile(files.message ?? '', expected);
        for (const bad of [
            ['validate', ...args, '--output', output],
            ['render', ...args, '--unknown', 'x'],
            ['render', ...args, '--input', 'duplicate'],
            ['render', '--message', 'x'],
        ])
            assert.equal(run(bad).status, 2);
        await writeFile(files.message ?? '', 'subject\n\nAssisted-by: Codex App:\n gpt-6.1-sol\n');
        assert.equal(run(['validate', ...args]).status, 2);
        await writeFile(files.message ?? '', Buffer.from([0xff]));
        assert.equal(run(['render', ...args]).status, 2);
        await writeFile(files.message ?? '', candidate);
        await save('input', { ...ledger, events: [] });
        const blocked = path.join(directory, 'blocked');
        assert.equal(run(['render', ...args, '--output', blocked]).status, 20);
        assert.equal(existsSync(blocked), false);
        await writeFile(files.input ?? '', '{"secret":"DO-NOT-ECHO"');
        const malformed = run(['render', ...args]);
        assert.equal(malformed.status, 2);
        assert.doesNotMatch(malformed.stderr, /DO-NOT-ECHO/);
        await save('input', ledger);
        assert.deepEqual(await snapshot(), before);
        assert.equal(existsSync(path.join(business, '.git/index')), false);
        await writeFile(path.join(business, 'new.txt'), 'changed while waiting\n');
        assert.equal(run(['render', ...args, '--output', blocked]).status, 20);
        assert.equal(existsSync(blocked), false);
        await writeFile(path.join(business, 'AGENTS.md'), 'AI Co-authored-by is required; no model field required.\n');
        await decide('repository-policy');
        await writeFile(files.input ?? '', 'unusable ledger');
        await writeFile(files.assessment ?? '', 'unusable assessment');
        await writeFile(path.join(payload, 'references/agent-registry.json'), 'unusable registry');
        const policyBefore = await snapshot();
        const policyOut = path.join(directory, 'policy-copy');
        assert.equal(
            run(['render', ...args, '--assessment', files.assessment ?? '', '--output', policyOut]).status,
            10,
        );
        assert.equal(await readFile(policyOut, 'utf8'), candidate);
        assert.equal(run(['validate', ...args, '--assessment', files.assessment ?? '']).status, 10);
        const loader = path.join(directory, 'deny-default.mjs');
        await writeFile(
            loader,
            `import {registerHooks} from 'node:module';registerHooks({resolve(s,c,n){if(s==='./summarize.ts'||s.endsWith('/summarize.ts'))throw new Error('DEFAULT SUMMARY IMPORTED');return n(s,c);}});\n`,
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
        assert.deepEqual(await snapshot(), policyBefore);
        assert.equal(existsSync(path.join(directory, 'node_modules')), false);
    } finally {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
