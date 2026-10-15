import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { byteDigest } from '../src/runtime-support.ts';
import { gitEnvironment, resolveTrustedGit } from '../src/safe-git.ts';

type InstalledResult = {
    stateVersion: number;
    contextId: string;
    current: { ledgerId: string } | null;
    status: string;
    preparationId: string;
    sealedResult: { sha: string };
    idempotent: boolean;
};

async function fixture(
    run: (f: {
        root: string;
        repository: string;
        payload: string;
        git: (args: string[]) => string;
        gitBytes: (args: string[]) => Buffer;
        invoke: (args: string[], code?: number) => InstalledResult;
        json: (name: string, value: unknown) => Promise<string>;
    }) => Promise<void>,
) {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ledger-preparation-installed-')));
    try {
        const repository = path.join(root, 'business');
        const payload = path.join(root, 'installed', 'skill');
        await mkdir(repository);
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
        const executable = await resolveTrustedGit([root]);
        const environment = gitEnvironment();
        const gitBytes = (args: string[]) => {
            const result = spawnSync(
                executable,
                [
                    '-c',
                    'user.name=Synthetic Fixture',
                    '-c',
                    'user.email=fixture@example.invalid',
                    '-c',
                    'commit.gpgSign=false',
                    '-c',
                    'core.hooksPath=',
                    '-c',
                    'core.autocrlf=false',
                    ...args,
                ],
                { cwd: repository, env: environment, windowsHide: true },
            );
            assert.equal(result.status, 0, result.stderr.toString());
            return result.stdout;
        };
        const git = (args: string[]) => gitBytes(args).toString().trim();
        git(['init', '-q']);
        const invoke = (args: string[], code = 0) => {
            const result = spawnSync(process.execPath, [path.join(payload, 'scripts', 'attribution.mjs'), ...args], {
                cwd: root,
                env: environment,
                encoding: 'utf8',
                windowsHide: true,
            });
            assert.equal(result.status, code, result.stderr + result.stdout);
            return JSON.parse(result.stdout || result.stderr);
        };
        const json = async (name: string, value: unknown) => {
            const file = path.join(root, name);
            await writeFile(file, JSON.stringify(value));
            return file;
        };
        await run({ root, repository, payload, git, gitBytes, invoke, json });
    } finally {
        assert.equal(path.dirname(root), await realpath(os.tmpdir()));
        await rm(root, { recursive: true, force: true });
    }
}

test('copied CLI prepares and seals a root result without source or development packages', async () => {
    await fixture(async ({ root, repository, git, gitBytes, invoke, json }) => {
        const ledger = (command: string, args: string[] = []) =>
            invoke(['ledger', command, '--worktree', repository, ...args]);
        ledger('init');
        const created = ledger('create', ['--select', '--expect-version', '0']);
        assert.ok(created.current);
        const ledgerId = created.current.ledgerId;
        const identities = await json('identities.json', {
            identities: [
                { agent: 'Codex App', model: 'fixture-model:1', reasoning: 'none' },
                { agent: 'Codex App', model: 'fixture-model:1', reasoning: 'none' },
            ],
        });
        const added = ledger('add', ['--ledger', ledgerId, '--input', identities, '--expect-version', '1']);
        await writeFile(path.join(repository, 'example.txt'), 'synthetic result\n');
        git(['add', '--', 'example.txt']);
        const operation = {
            schemaVersion: 1,
            id: 'installed-root-output',
            repository,
            worktree: repository,
            commonGitDir: path.join(repository, '.git'),
            kind: 'commit',
            paths: ['example.txt'],
            targets: [],
        };
        const op = await json('operation.json', operation);
        const decision = await json('decision.json', {
            schemaVersion: 2,
            artifact: 'policy-decision',
            operation,
            branch: 'skill-default',
            rationale: 'Synthetic ordinary-format-only repository.',
            decisionSource: { kind: 'agent-semantic', reference: 'fixture:policy-review' },
        });
        const plan = await json('result-plan.json', {
            schemaVersion: 1,
            form: 'create',
            expectedParents: [],
            sourceTargets: [],
        });
        const message = path.join(root, 'message.txt');
        const candidate = path.join(root, 'candidate.txt');
        await writeFile(
            message,
            'feat(attribution): demonstrate persisted preparation\n\nCo-authored-by: Human Fixture <human@example.invalid>\n',
        );
        const config = await readFile(path.join(repository, '.git', 'config'));
        const index = await readFile(path.join(repository, '.git', 'index'));
        const prepareArgs = [
            'prepare',
            '--worktree',
            repository,
            '--ledger',
            ledgerId,
            '--expect-version',
            String(added.stateVersion),
            '--message',
            message,
            '--operation',
            op,
            '--decision',
            decision,
            '--result-plan',
            plan,
            '--output',
            candidate,
        ];
        if (process.platform === 'win32') {
            invoke([...prepareArgs.slice(0, -1), `${path.join(repository, '.git')}:candidate`], 2);
            assert.equal(ledger('status').stateVersion, added.stateVersion);
        }
        const prepared = invoke(prepareArgs);
        assert.equal(prepared.status, 'prepared');
        const candidateBytes = await readFile(candidate);
        assert.match(candidateBytes.toString(), /Co-authored-by: Human Fixture/);
        assert.equal(candidateBytes.toString().split('Assisted-by: Codex App:fixture-model:1 (none)').length, 2);
        assert.deepEqual(await readFile(path.join(repository, '.git', 'index')), index);
        assert.deepEqual(await readFile(path.join(repository, '.git', 'config')), config);
        assert.equal(git(['status', '--porcelain']), 'A  example.txt');
        git(['commit', '-q', '-F', candidate]);
        const sha = git(['rev-parse', 'HEAD']);
        const rawCommit = gitBytes(['cat-file', 'commit', sha]);
        const separator = rawCommit.indexOf(Buffer.from('\n\n'));
        assert.ok(separator > 0);
        const finalMessage = rawCommit.subarray(separator + 2);
        assert.deepEqual(finalMessage, candidateBytes);
        const review = await json('review.json', {
            schemaVersion: 1,
            artifact: 'result-review',
            contextId: added.contextId,
            ledgerId,
            preparationId: prepared.preparationId,
            sha,
            messageSha256: byteDigest(finalMessage),
            createdByPreparation: true,
            policyReviewed: true,
            reference: 'fixture:actual-final-message-review',
        });
        const args = [
            'finish',
            '--worktree',
            repository,
            '--ledger',
            ledgerId,
            '--preparation',
            prepared.preparationId,
            '--sha',
            sha,
            '--review',
            review,
            '--expect-version',
            String(prepared.stateVersion),
        ];
        const sealed = invoke(args);
        assert.equal(sealed.status, 'sealed');
        assert.equal(sealed.sealedResult.sha, sha);
        assert.equal(ledger('status').current, null);
        assert.equal(invoke(args).idempotent, true);
        assert.equal(git(['rev-parse', 'HEAD']), sha);
        assert.equal(git(['status', '--porcelain']), '');
        assert.deepEqual(await readFile(path.join(repository, '.git', 'config')), config);
    });
});

test('copied CLI routes needs-decision before missing worktree and auxiliary input reads', async () => {
    await fixture(async ({ root, repository, invoke, json }) => {
        const operation = {
            schemaVersion: 1,
            id: 'installed-pending',
            repository,
            worktree: repository,
            commonGitDir: path.join(repository, '.git'),
            kind: 'commit',
            paths: [],
            targets: [],
        };
        const op = await json('operation.json', operation);
        const decision = await json('decision.json', {
            schemaVersion: 2,
            artifact: 'policy-decision',
            operation,
            branch: 'needs-decision',
            rationale: 'Synthetic unresolved policy.',
            decisionSource: { kind: 'agent-semantic', reference: 'fixture:unresolved' },
        });
        const missing = path.join(root, 'missing');
        const result = invoke(
            [
                'prepare',
                '--worktree',
                missing,
                '--ledger',
                '00000000-0000-4000-8000-000000000001',
                '--expect-version',
                '0',
                '--message',
                missing,
                '--operation',
                op,
                '--decision',
                decision,
                '--result-plan',
                missing,
                '--assessment',
                missing,
                '--output',
                missing,
            ],
            20,
        );
        assert.equal(result.status, 'needs-decision');
    });
});

test('copied CLI seals repository-policy results while unused defaults remain opaque', async () => {
    await fixture(async ({ root, repository, payload, git, gitBytes, invoke, json }) => {
        const ledger = (command: string, args: string[] = []) =>
            invoke(['ledger', command, '--worktree', repository, ...args]);
        ledger('init');
        const created = ledger('create', ['--select', '--expect-version', '0']);
        assert.ok(created.current);
        const ledgerId = created.current.ledgerId;
        const gap = await json('blocker.json', { id: 'known-default-gap', reason: 'Synthetic missing default model' });
        const blocked = ledger('block', ['--ledger', ledgerId, '--input', gap, '--expect-version', '1']);
        await writeFile(path.join(payload, 'references', 'agent-registry.json'), 'UNUSABLE REGISTRY');
        const operation = {
            schemaVersion: 1,
            id: 'installed-repository-output',
            repository,
            worktree: repository,
            commonGitDir: path.join(repository, '.git'),
            kind: 'commit',
            paths: [],
            targets: [],
        };
        const op = await json('operation.json', operation);
        const decision = await json('decision.json', {
            schemaVersion: 2,
            artifact: 'policy-decision',
            operation,
            branch: 'repository-policy',
            rationale: 'Synthetic repository marker rule owns disclosure.',
            decisionSource: { kind: 'agent-semantic', reference: 'fixture:repository-marker' },
        });
        const plan = await json('result-plan.json', {
            schemaVersion: 1,
            form: 'create',
            expectedParents: [],
            sourceTargets: [],
        });
        const message = path.join(root, 'message.txt');
        const candidate = path.join(root, 'candidate.txt');
        await writeFile(message, 'feat(attribution): follow the repository marker\n\nAI-assisted: yes\n');
        const prepared = invoke(
            [
                'prepare',
                '--worktree',
                repository,
                '--ledger',
                ledgerId,
                '--expect-version',
                String(blocked.stateVersion),
                '--message',
                message,
                '--operation',
                op,
                '--decision',
                decision,
                '--result-plan',
                plan,
                '--output',
                candidate,
                '--assessment',
                candidate,
            ],
            10,
        );
        assert.equal(prepared.status, 'prepared');
        assert.deepEqual(await readFile(candidate), await readFile(message));
        git(['commit', '-q', '--allow-empty', '-F', candidate]);
        const sha = git(['rev-parse', 'HEAD']);
        const commit = gitBytes(['cat-file', 'commit', sha]);
        const separator = commit.indexOf(Buffer.from('\n\n'));
        assert.ok(separator > 0);
        const review = await json('review.json', {
            schemaVersion: 1,
            artifact: 'result-review',
            contextId: created.contextId,
            ledgerId,
            preparationId: prepared.preparationId,
            sha,
            messageSha256: byteDigest(commit.subarray(separator + 2)),
            createdByPreparation: true,
            policyReviewed: true,
            repositoryPolicyChecked: true,
            reference: 'fixture:actual-final-repository-marker-check',
        });
        const sealed = invoke(
            [
                'finish',
                '--worktree',
                repository,
                '--ledger',
                ledgerId,
                '--preparation',
                prepared.preparationId,
                '--sha',
                sha,
                '--review',
                review,
                '--expect-version',
                String(prepared.stateVersion),
                '--assessment',
                path.join(root, 'missing-assessment'),
            ],
            10,
        );
        assert.equal(sealed.status, 'sealed');
        assert.equal(sealed.sealedResult.sha, sha);
        assert.equal(ledger('status').current, null);
    });
});
