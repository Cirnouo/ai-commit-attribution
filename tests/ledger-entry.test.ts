import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArguments, run } from '../src/attribution.ts';
import { gitEnvironment, resolveTrustedGit } from '../src/safe-git.ts';

test('summary accepts an explicit ID or current context without guessing an input file', () => {
    assert.deepEqual(parseArguments(['summarize', '--ledger', 'ledger-id', '--operation', 'operation']), {
        ledger: 'ledger-id',
        operation: 'operation',
    });
    assert.deepEqual(parseArguments(['summarize', '--current', 'worktree', '--operation', 'operation']), {
        current: 'worktree',
        operation: 'operation',
    });
    for (const source of [
        ['--input', 'file', '--ledger', 'id'],
        ['--input', 'file', '--current', 'worktree'],
        ['--ledger', 'id', '--current', 'worktree'],
    ])
        assert.throws(() => parseArguments(['summarize', ...source, '--operation', 'operation']));
});

test('copied bundle persists selection and rejects a late child without source dependencies', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ledger-installed-')));
    try {
        const repository = path.join(directory, 'business');
        const payload = path.join(directory, 'home', 'skill');
        await mkdir(repository);
        const executable = await resolveTrustedGit([directory]);
        const environment = gitEnvironment();
        const git = (args: string[]) => {
            const response = spawnSync(executable, args, {
                cwd: repository,
                env: environment,
                encoding: 'utf8',
                windowsHide: true,
            });
            assert.equal(response.status, 0, response.stderr);
            return response.stdout.trim();
        };
        git(['init', '-q']);
        const metadata = path.join(repository, '.git');
        const originalConfig = await readFile(path.join(metadata, 'config'));
        const originalHead = await readFile(path.join(metadata, 'HEAD'));
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
        const entry = path.join(payload, 'scripts', 'attribution.mjs');
        const invoke = (args: string[], code = 0) => {
            const response = spawnSync(process.execPath, [entry, ...args], {
                cwd: directory,
                env: environment,
                encoding: 'utf8',
                windowsHide: true,
            });
            assert.equal(response.status, code, response.stderr + response.stdout);
            return JSON.parse(code === 2 ? response.stderr : response.stdout);
        };
        const ledger = (command: string, args: string[] = [], code = 0) =>
            invoke(['ledger', command, '--worktree', repository, ...args], code);
        const firstId = '00000000-0000-4000-8000-000000000001';
        const secondId = '00000000-0000-4000-8000-000000000002';
        const initial = ledger('init');
        assert.equal(initial.stateVersion, 0);
        assert.equal(ledger('init').contextId, initial.contextId);
        ledger('create', ['--ledger', firstId, '--select', '--expect-version', '0']);
        const identities = path.join(directory, 'identities.json');
        await writeFile(
            identities,
            JSON.stringify({
                identities: [
                    { agent: 'Codex App', model: 'model-fixture-1', reasoning: 'high' },
                    { agent: 'Codex App', model: 'model-fixture-1', reasoning: 'high' },
                ],
            }),
        );
        ledger('add', ['--ledger', firstId, '--input', identities, '--expect-version', '1']);
        const operation = {
            schemaVersion: 1,
            id: 'installed-selection',
            repository,
            worktree: repository,
            commonGitDir: metadata,
            kind: 'commit',
            paths: [],
            targets: [],
        };
        const operationFile = path.join(directory, 'operation.json');
        await writeFile(operationFile, JSON.stringify(operation));
        const summarize = (source: string[], code = 0) =>
            invoke(['summarize', ...source, '--operation', operationFile], code);
        assert.equal(summarize(['--current', repository]).ledgerId, firstId);
        assert.equal(summarize(['--ledger', firstId]).tuples.length, 1);
        ledger('pause', ['--ledger', firstId, '--expect-version', '2']);
        summarize(['--current', repository], 2);
        assert.equal(summarize(['--ledger', firstId]).tuples.length, 1);
        ledger('create', ['--ledger', secondId, '--select', '--expect-version', '3']);
        ledger('add', ['--ledger', firstId, '--input', identities, '--expect-version', '4'], 2);
        ledger('resume', ['--ledger', firstId, '--expect-version', '4'], 2);
        summarize(['--ledger', firstId], 2);
        ledger('select', ['--ledger', firstId, '--expect-version', '4']);
        ledger('add', ['--ledger', firstId, '--input', identities, '--expect-version', '1'], 2);
        const final = ledger('status');
        assert.equal(final.stateVersion, 5);
        assert.equal(final.current.ledgerId, firstId);
        assert.equal(final.ledgers[0].identities.length, 1);
        assert.deepEqual(await readFile(path.join(metadata, 'config')), originalConfig);
        assert.deepEqual(await readFile(path.join(metadata, 'HEAD')), originalHead);
        assert.equal(existsSync(path.join(metadata, 'index')), false);
        assert.equal(existsSync(path.join(directory, 'node_modules')), false);
        assert.equal(
            (await readFile(path.join(metadata, 'info', 'exclude'), 'utf8')).split('/.ai-commit-attribution/').length,
            2,
        );
    } finally {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});

test('repository-policy and needs-decision do not locate an unused current ledger', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ledger-entry-')));
    try {
        const metadata = path.join(directory, 'declared-admin');
        await mkdir(metadata);
        const operation = {
            schemaVersion: 1,
            id: 'exclusive-current-selector',
            repository: directory,
            worktree: directory,
            commonGitDir: metadata,
            kind: 'commit',
            paths: [],
            targets: [],
        };
        const operationFile = path.join(directory, 'operation.json');
        const decisionFile = path.join(directory, 'decision.json');
        const messageFile = path.join(directory, 'message.txt');
        await writeFile(operationFile, JSON.stringify(operation));
        await writeFile(messageFile, 'subject\n\nAssisted-by: invalid\n');
        for (const [branch, expected] of [
            ['repository-policy', 10],
            ['needs-decision', 20],
        ] as const) {
            await writeFile(
                decisionFile,
                JSON.stringify({
                    schemaVersion: 2,
                    artifact: 'policy-decision',
                    operation,
                    branch,
                    rationale: 'Synthetic explicit semantic decision.',
                    decisionSource: { kind: 'agent-semantic', reference: 'fixture:decision' },
                }),
            );
            for (const mode of ['render', 'validate']) {
                const result = await run([
                    mode,
                    '--message',
                    messageFile,
                    '--operation',
                    operationFile,
                    '--decision',
                    decisionFile,
                    '--current',
                    path.join(directory, 'missing-worktree'),
                    '--assessment',
                    path.join(directory, 'missing-assessment'),
                ]);
                assert.equal(result.exitCode, expected);
                assert.equal('participationEvidence' in result && result.participationEvidence.status, 'not-run');
            }
        }
    } finally {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
