import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResultReview, parseSealedResult } from '../src/result-review.ts';

function required(value: string | undefined): string {
    assert.ok(value);
    return value;
}
const id = '11111111-1111-4111-8111-111111111111';
const review = {
    schemaVersion: 1,
    artifact: 'result-review',
    contextId: id,
    ledgerId: id,
    preparationId: id,
    sha: 'a'.repeat(40),
    messageSha256: 'b'.repeat(64),
    createdByPreparation: true,
    policyReviewed: true,
    reference: 'Explicit final review',
};
test('portable exact-result review rejects unknown flags and mismatched seal joins', () => {
    assert.deepEqual(parseResultReview(review), review);
    for (const bad of [
        { ...review, policyReviewed: false },
        { ...review, acceptMessageChange: false },
        { ...review, extra: true },
        { ...review, contextId: id.toUpperCase().replace('1111', 'ABCD') },
        { ...review, reference: '\nunsafe' },
    ])
        assert.throws(() => parseResultReview(bad));
    const seal = {
        preparationId: id,
        sha: review.sha,
        messageSha256: review.messageSha256,
        review,
        checks: { parents: true, tree: true, message: 'candidate-equivalent', participation: 'frozen-default-check' },
    };
    assert.deepEqual(parseSealedResult(seal), seal);
    assert.throws(() => parseSealedResult({ ...seal, sha: 'c'.repeat(40) }));
    assert.throws(() => parseSealedResult({ ...seal, checks: { ...seal.checks, tree: false } }));
});

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addIdentities, blockLedger, createLedger } from '../src/ledger.ts';
import { finishLedger, prepareLedger } from '../src/ledger-preparation.ts';
import { initializeState, readState, resolveLedgerContext, transactState } from '../src/ledger-store.ts';
import type { Operation, Registry } from '../src/records.ts';
import { byteDigest } from '../src/runtime-support.ts';
import { gitEnvironment, resolveTrustedGit } from '../src/safe-git.ts';

const registry: Registry = {
    schemaVersion: 1,
    hosts: [{ name: 'Synthetic Agent', aliases: [], family: 'fixture' }],
    ambiguousAliases: [],
    familyAliases: {},
};

test('reviewed Windows metadata and state directory streams cannot receive a prepared candidate', {
    skip: process.platform !== 'win32',
}, async (t) => {
    const f = await fixture(t);
    await f.stage();
    const original = await readFile(f.context.stateFile);
    for (const directory of [
        f.context.locator.gitDirectory,
        f.context.locator.commonGitDir,
        f.context.stateDirectory,
    ]) {
        await assert.rejects(f.prepare({ output: `${directory}:candidate` }), /stream/i);
        assert.deepEqual(await readFile(f.context.stateFile), original);
    }
});
async function fixture(t: test.TestContext) {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ledger-preparation-')));
    const repository = path.join(directory, 'repository');
    await mkdir(repository);
    t.after(async () => {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    });
    const executable = await resolveTrustedGit([]);
    const env = {
        ...gitEnvironment(),
        GIT_AUTHOR_NAME: 'Fixture Author',
        GIT_AUTHOR_EMAIL: 'author@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture Committer',
        GIT_COMMITTER_EMAIL: 'committer@example.invalid',
        GIT_EDITOR: 'true',
        GIT_ALLOW_PROTOCOL: 'file',
    };
    function git(args: string[], input?: string | Buffer, success = true) {
        const result = spawnSync(
            executable,
            [
                '-c',
                'core.hooksPath=',
                '-c',
                'core.autocrlf=false',
                '-c',
                'commit.gpgsign=false',
                '-c',
                'sequence.editor=true',
                ...args,
            ],
            { cwd: repository, env, input, windowsHide: true, shell: false, maxBuffer: 8 * 1024 * 1024 },
        );
        if (success) assert.equal(result.status, 0, result.stderr?.toString());
        return result.stdout.toString().trim();
    }
    git(['init', '--quiet', '--initial-branch=main']);
    const context = await resolveLedgerContext(repository);
    await initializeState(context);
    const ledgerId = randomUUID();
    await transactState(context, 0, (draft) => {
        createLedger(draft, { ledgerId, select: true });
    });
    await transactState(context, 1, (draft) => {
        addIdentities(draft, ledgerId, [{ agent: 'Synthetic Agent', model: 'model-a' }], registry);
    });
    const operation: Operation = {
        schemaVersion: 1,
        id: randomUUID(),
        repository,
        worktree: repository,
        commonGitDir: context.locator.commonGitDir,
        kind: 'commit',
        paths: [],
        targets: [],
    };
    const decision = (branch = 'skill-default') => ({
        schemaVersion: 2,
        artifact: 'policy-decision',
        operation,
        branch,
        rationale: 'Explicit fixture decision',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture' },
    });
    const plan = (parents: string[] = [], form = 'create', target?: string) => ({
        schemaVersion: 1,
        form,
        expectedParents: parents,
        sourceTargets: operation.targets,
        ...(target ? { replacementTarget: target } : {}),
    });
    const head = () => git(['rev-parse', 'HEAD']);
    async function stage(name = 'file', contents = 'one') {
        await writeFile(path.join(repository, name), contents);
        git(['add', '--', name]);
    }
    let number = 0;
    async function prepare(options: Record<string, unknown> = {}) {
        const state = await readState(context);
        return prepareLedger(context, state.stateVersion, {
            ledgerId,
            operation,
            decision: decision(),
            resultPlan: plan(state.preparations.length ? [head()] : []),
            messageBuffer: Buffer.from('Subject\n'),
            output: path.join(directory, `candidate-${++number}`),
            loadRegistry: async () => registry,
            ...options,
        });
    }
    const review = (preparationId: string, sha: string, message: Buffer, extra = {}) => ({
        schemaVersion: 1,
        artifact: 'result-review',
        contextId: '',
        ledgerId,
        preparationId,
        sha,
        messageSha256: byteDigest(message),
        createdByPreparation: true,
        policyReviewed: true,
        reference: 'Exact final result review',
        ...extra,
    });
    return { directory, repository, context, ledgerId, operation, decision, plan, head, stage, git, prepare, review };
}
test('prepare root then finish exact result and retry after switching current', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const prepared = await f.prepare();
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.exitCode, 0);
    assert.ok(prepared.preparationId);
    assert.ok(prepared.outputPath);
    let state = await readState(f.context);
    assert.equal(state.ledgers[0]?.state, 'prepared');
    assert.equal(state.preparations[0]?.revision, state.ledgers[0]?.revision);
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    const sha = f.head();
    const message = (await observeResult(f.repository, sha)).message;
    const review = {
        ...f.review(required(prepared.preparationId), sha, message),
        contextId: state.contextId,
        ledgerId: f.ledgerId,
    };
    const next = randomUUID();
    state = await transactState(f.context, state.stateVersion, (draft) => {
        createLedger(draft, { ledgerId: next, select: true });
    });
    const sealed = await finishLedger(f.context, state.stateVersion, {
        ledgerId: f.ledgerId,
        preparationId: required(prepared.preparationId),
        sha,
        review,
    });
    assert.equal(sealed.status, 'sealed');
    state = await readState(f.context);
    assert.equal(state.current?.ledgerId, next);
    const version = state.stateVersion;
    const retry = await finishLedger(f.context, 0, {
        ledgerId: f.ledgerId,
        preparationId: required(prepared.preparationId),
        sha,
        review,
    });
    assert.equal(retry.status, 'sealed');
    assert.equal(retry.idempotent, true);
    assert.equal((await readState(f.context)).stateVersion, version);
    f.git(['commit', '--quiet', '--allow-empty', '-m', 'Different result']);
    const different = await observeResult(f.repository, f.head());
    await assert.rejects(
        finishLedger(f.context, version, {
            ledgerId: f.ledgerId,
            preparationId: required(prepared.preparationId),
            sha: different.sha,
            review: {
                ...f.review(required(prepared.preparationId), different.sha, different.message),
                contextId: state.contextId,
            },
        }),
        /immutable/i,
    );
});
test('routing stops before default loading and repository policy bypasses blockers', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const no = await f.prepare({
        decision: f.decision('needs-decision'),
        loadRegistry: async () => {
            throw Error('must not load');
        },
    });
    assert.equal(no.exitCode, 20);
    assert.equal((await readState(f.context)).preparations.length, 0);
    await transactState(f.context, 2, (draft) => {
        blockLedger(draft, f.ledgerId, { id: 'gap', reason: 'Unknown required fact' });
    });
    const blocked = await f.prepare();
    assert.equal(blocked.exitCode, 20);
    assert.equal((await readState(f.context)).preparations.length, 0);
    const repo = await f.prepare({
        decision: f.decision('repository-policy'),
        assessment: { broken: true },
        loadRegistry: async () => {
            throw Error('must not load');
        },
    });
    assert.equal(repo.exitCode, 10);
    assert.equal(repo.status, 'prepared');
    assert.equal(await readFile(required(repo.outputPath), 'utf8'), 'Subject\n');
});

import { parsePreparationArguments, runPreparation } from '../src/ledger-preparation-cli.ts';

test('preparation CLI rejects missing or duplicate flags and defers unused repository assessment', async (t) => {
    assert.throws(() => parsePreparationArguments(['prepare', '--expect-version', '01']));
    assert.throws(() => parsePreparationArguments(['finish', '--expect-version', '0', '--sha', 'a', '--sha', 'b']));
    const f = await fixture(t);
    await f.stage();
    const operationFile = path.join(f.directory, 'operation.json'),
        decisionFile = path.join(f.directory, 'decision.json'),
        planFile = path.join(f.directory, 'plan.json'),
        messageFile = path.join(f.directory, 'message.txt'),
        output = path.join(f.directory, 'cli-message');
    await writeFile(operationFile, JSON.stringify(f.operation));
    await writeFile(decisionFile, JSON.stringify(f.decision('repository-policy')));
    await writeFile(planFile, JSON.stringify(f.plan()));
    await writeFile(messageFile, 'CLI subject\n');
    const prepared = await runPreparation(
        [
            'prepare',
            '--worktree',
            f.repository,
            '--ledger',
            f.ledgerId,
            '--expect-version',
            '2',
            '--operation',
            operationFile,
            '--decision',
            decisionFile,
            '--result-plan',
            planFile,
            '--message',
            messageFile,
            '--output',
            output,
            '--assessment',
            path.join(f.directory, 'missing.json'),
        ],
        async () => {
            throw Error('must not load');
        },
    );
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.exitCode, 10);
});

import { pauseLedger, reopenLedger } from '../src/ledger.ts';
import type { PreparationResult } from '../src/ledger-preparation.ts';
import { observeResult } from '../src/result-git.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function finish(f: Fixture, prepared: PreparationResult, extra: Record<string, unknown> = {}, hooks = {}) {
    const state = await readState(f.context),
        sha = f.head(),
        observed = await observeResult(f.repository, sha);
    return finishLedger(
        f.context,
        state.stateVersion,
        {
            ledgerId: f.ledgerId,
            preparationId: required(prepared.preparationId),
            sha,
            review: {
                ...f.review(required(prepared.preparationId), sha, observed.message, extra),
                contextId: state.contextId,
                ledgerId: f.ledgerId,
            },
        },
        hooks,
    );
}
async function nextLedger(f: Fixture) {
    const current = await readState(f.context);
    f.ledgerId = randomUUID();
    await transactState(f.context, current.stateVersion, (draft) => {
        createLedger(draft, { ledgerId: f.ledgerId, select: true });
    });
    await transactState(f.context, current.stateVersion + 1, (draft) => {
        addIdentities(draft, f.ledgerId, [{ agent: 'Synthetic Agent', model: 'model-a' }], registry);
    });
    f.operation.id = randomUUID();
}
async function preparedFor(f: Fixture, kind: string, parents: string[], form = 'create', target?: string) {
    f.operation.kind = kind;
    f.operation.id = randomUUID();
    return f.prepare({ ledgerId: f.ledgerId, decision: f.decision(), resultPlan: f.plan(parents, form, target) });
}
test('all plain output forms include empty root, next commit, root amend and moved HEAD finish', async (t) => {
    const f = await fixture(t);
    const root = await preparedFor(f, 'commit', []);
    assert.equal(root.status, 'prepared');
    f.git(['commit', '--quiet', '--allow-empty', '-F', required(root.outputPath)]);
    assert.equal((await finish(f, root)).status, 'sealed');
    const rootSha = f.head();
    await nextLedger(f);
    const amend = await preparedFor(f, 'amend', [], 'replace', rootSha);
    f.git(['commit', '--quiet', '--amend', '--allow-empty', '-F', required(amend.outputPath)]);
    assert.equal((await finish(f, amend)).status, 'sealed');
    await nextLedger(f);
    await f.stage('next', 'two');
    const prior = f.head(),
        normal = await preparedFor(f, 'commit', [prior]);
    f.git(['commit', '--quiet', '-F', required(normal.outputPath)]);
    const sha = f.head();
    f.git(['commit', '--quiet', '--allow-empty', '-m', 'Later independent commit']);
    const state = await readState(f.context),
        actual = await observeResult(f.repository, sha);
    const done = await finishLedger(f.context, state.stateVersion, {
        ledgerId: f.ledgerId,
        preparationId: required(normal.preparationId),
        sha,
        review: {
            ...f.review(required(normal.preparationId), sha, actual.message),
            contextId: state.contextId,
            ledgerId: f.ledgerId,
        },
    });
    assert.equal(done.status, 'sealed');
});
test('message rewrite requires exact approval but approval cannot remove frozen footer', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const prepared = await f.prepare();
    const candidate = await readFile(required(prepared.outputPath), 'utf8');
    f.git(['commit', '--quiet', '-F', '-'], candidate.replace('Subject', 'Rewritten subject'));
    assert.equal((await finish(f, prepared)).exitCode, 20);
    assert.equal((await readState(f.context)).ledgers[0]?.state, 'prepared');
    assert.equal((await finish(f, prepared, { acceptMessageChange: true })).status, 'sealed');
    await nextLedger(f);
    await f.stage('next', 'next');
    const second = await preparedFor(f, 'commit', [f.head()]);
    f.git(['commit', '--quiet', '-m', 'Missing frozen footer']);
    const failed = await finish(f, second, { acceptMessageChange: true });
    assert.equal(failed.status, 'prepared');
    assert.equal(failed.exitCode, 20);
});
test('prepare and finish failed replacement preserve candidate and exact SHA retry', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const output = path.join(f.directory, 'retained-candidate');
    const failed = await prepareLedger(
        f.context,
        2,
        {
            ledgerId: f.ledgerId,
            operation: f.operation,
            decision: f.decision(),
            resultPlan: f.plan(),
            messageBuffer: Buffer.from('Subject\n'),
            output,
            loadRegistry: async () => registry,
        },
        {
            stateIO: {
                rename: async () => {
                    throw Error('injected replacement failure');
                },
            },
        },
    );
    assert.equal(failed.status, 'candidate-unprepared');
    assert.equal(failed.exitCode, 2);
    assert.match(await readFile(output, 'utf8'), /Assisted-by/);
    let state = await readState(f.context);
    assert.equal(state.ledgers[0]?.state, 'open');
    assert.equal(state.preparations.length, 0);
    const prepared = await f.prepare();
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    const no = await finish(
        f,
        prepared,
        {},
        {
            stateIO: {
                rename: async () => {
                    throw Error('injected sealing failure');
                },
            },
        },
    );
    assert.equal(no.exitCode, 2);
    state = await readState(f.context);
    assert.equal(state.ledgers[0]?.state, 'prepared');
    assert.equal((await finish(f, prepared)).status, 'sealed');
});
test('prepare rejects occupied output, state-directory aliases, paused and stale child selection', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const occupied = path.join(f.directory, 'occupied');
    await writeFile(occupied, 'keep');
    await assert.rejects(f.prepare({ output: occupied }), /absent/i);
    assert.equal(await readFile(occupied, 'utf8'), 'keep');
    await assert.rejects(f.prepare({ output: path.join(f.context.stateDirectory, 'candidate') }), /state directory/i);
    await transactState(f.context, 2, (draft) => {
        pauseLedger(draft, f.ledgerId);
    });
    await assert.rejects(f.prepare(), /active current/i);
    await transactState(f.context, 3, (draft) => {
        createLedger(draft, { ledgerId: randomUUID(), select: true });
    });
    await assert.rejects(f.prepare(), /active current/i);
    assert.equal((await readState(f.context)).preparations.length, 0);
});
test('switching and pausing preserve receipts while reopen invalidates their finish eligibility', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const prepared = await f.prepare();
    let state = await readState(f.context);
    await transactState(f.context, state.stateVersion, (draft) => {
        pauseLedger(draft, f.ledgerId);
    });
    state = await readState(f.context);
    assert.equal(state.preparations.length, 1);
    await transactState(f.context, state.stateVersion, (draft) => {
        reopenLedger(draft, f.ledgerId, { reviewedNoResult: true });
    });
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    await assert.rejects(finish(f, prepared), /current preparation/i);
    assert.equal((await readState(f.context)).preparations.length, 1);
});
test('repository-policy finish requires fresh exact declaration and retains exit ten', async (t) => {
    const f = await fixture(t);
    await f.stage();
    await transactState(f.context, 2, (draft) => {
        blockLedger(draft, f.ledgerId, { id: 'known-gap', reason: 'Needs factual confirmation' });
    });
    const prepared = await f.prepare({
        decision: f.decision('repository-policy'),
        assessment: { broken: true },
        loadRegistry: async () => {
            throw Error('must not load');
        },
    });
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    assert.equal((await finish(f, prepared)).exitCode, 20);
    const state = await readState(f.context),
        sha = f.head(),
        actual = await observeResult(f.repository, sha);
    const sealed = await finishLedger(f.context, state.stateVersion, {
        ledgerId: f.ledgerId,
        preparationId: required(prepared.preparationId),
        sha,
        review: {
            ...f.review(required(prepared.preparationId), sha, actual.message, { repositoryPolicyChecked: true }),
            contextId: state.contextId,
            ledgerId: f.ledgerId,
        },
        loadAssessment: async () => {
            throw Error('must not load');
        },
    });
    assert.equal(sealed.exitCode, 10);
    assert.equal(sealed.status, 'sealed');
    assert.equal((await readState(f.context)).ledgers[0]?.blockers.length, 1);
});

test('actual two-parent and octopus merges preserve ordered parents through amend', async (t) => {
    for (const count of [2, 3]) {
        const f = await fixture(t);
        await f.stage('base', 'base');
        f.git(['commit', '--quiet', '-m', 'Base']);
        const base = f.head(),
            parents = [base];
        for (let i = 1; i < count; i++) {
            f.git(['checkout', '--quiet', '-b', `side-${i}`, base]);
            await f.stage(`side-${i}`, `${i}`);
            f.git(['commit', '--quiet', '-m', `Side ${i}`]);
            parents.push(f.head());
        }
        f.git(['checkout', '--quiet', 'main']);
        f.git(['merge', '--no-ff', '--no-commit', ...Array.from({ length: count - 1 }, (_, i) => `side-${i + 1}`)]);
        const prepared = await preparedFor(f, 'merge', parents);
        f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
        assert.equal((await finish(f, prepared)).status, 'sealed');
        assert.deepEqual((await observeResult(f.repository, f.head())).parents, parents);
        await nextLedger(f);
        const target = f.head(),
            amend = await preparedFor(f, 'amend', parents, 'replace', target);
        f.git(['commit', '--quiet', '--amend', '-F', required(amend.outputPath)]);
        assert.equal((await finish(f, amend)).status, 'sealed');
    }
});
test('actual cherry-pick conflict continuation and no-commit aggregate create independent outputs', async (t) => {
    const f = await fixture(t);
    await f.stage('file', 'base\n');
    f.git(['commit', '--quiet', '-m', 'Base']);
    const base = f.head();
    f.git(['checkout', '--quiet', '-b', 'topic']);
    await f.stage('file', 'topic\n');
    f.git(['commit', '--quiet', '-m', 'Source']);
    const source = f.head();
    f.git(['checkout', '--quiet', 'main']);
    await f.stage('file', 'main\n');
    f.git(['commit', '--quiet', '-m', 'Main']);
    const parent = f.head();
    f.git(['cherry-pick', source], undefined, false);
    assert.ok(f.git(['ls-files', '--unmerged']));
    await f.stage('file', 'resolved\n');
    f.operation.targets = [{ role: 'original-source', objectId: source }];
    const prepared = await preparedFor(f, 'cherry-pick', [parent]);
    await writeFile(
        path.join(f.context.locator.gitDirectory, 'MERGE_MSG'),
        await readFile(required(prepared.outputPath)),
    );
    f.git(['cherry-pick', '--continue']);
    assert.equal((await finish(f, prepared)).status, 'sealed');
    f.git(['checkout', '--quiet', '-b', 'aggregate-source', base]);
    await f.stage('one', 'one');
    f.git(['commit', '--quiet', '-m', 'One']);
    const one = f.head();
    await f.stage('two', 'two');
    f.git(['commit', '--quiet', '-m', 'Two']);
    const two = f.head();
    f.git(['checkout', '--quiet', 'main']);
    await nextLedger(f);
    const main = f.head();
    f.git(['cherry-pick', '--no-commit', one, two]);
    f.operation.targets = [
        { role: 'source-one', objectId: one },
        { role: 'source-two', objectId: two },
    ];
    const aggregate = await preparedFor(f, 'cherry-pick', [main]);
    f.git(['commit', '--quiet', '-F', required(aggregate.outputPath)]);
    assert.equal((await finish(f, aggregate)).status, 'sealed');
});
test('actual rebase conflict create and edit replacement use original source declarations', async (t) => {
    const f = await fixture(t);
    await f.stage('file', 'base\n');
    f.git(['commit', '--quiet', '-m', 'Base']);
    f.git(['checkout', '--quiet', '-b', 'topic']);
    await f.stage('file', 'topic\n');
    f.git(['commit', '--quiet', '-m', 'Source']);
    const source = f.head();
    f.git(['checkout', '--quiet', 'main']);
    await f.stage('file', 'main\n');
    f.git(['commit', '--quiet', '-m', 'Main']);
    const main = f.head();
    f.git(['checkout', '--quiet', 'topic']);
    f.git(['rebase', 'main'], undefined, false);
    assert.ok(f.git(['ls-files', '--unmerged']));
    await f.stage('file', 'resolved\n');
    f.operation.targets = [{ role: 'original-source', objectId: source }];
    const prepared = await preparedFor(f, 'rebase', [main]);
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    f.git(['rebase', '--continue']);
    assert.equal((await finish(f, prepared)).status, 'sealed');
    const replay = f.head();
    await nextLedger(f);
    const editor = path.join(f.directory, 'edit-todo.cjs');
    await writeFile(
        editor,
        "const fs=require('node:fs');const p=process.argv[2];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^pick /m,'edit '));",
    );
    f.git([
        '-c',
        `sequence.editor="${process.execPath.replaceAll('\\', '/')}" "${editor.replaceAll('\\', '/')}"`,
        'rebase',
        '--interactive',
        main,
    ]);
    assert.match(await readFile(path.join(f.context.locator.gitDirectory, 'rebase-merge', 'done'), 'utf8'), /^edit /m);
    assert.equal(f.head(), replay);
    await f.stage('edited', 'edit');
    f.operation.targets = [{ role: 'original-source', objectId: source }];
    const edit = await preparedFor(f, 'rebase', [main], 'replace', replay);
    f.git(['commit', '--quiet', '--amend', '-F', required(edit.outputPath)]);
    f.git(['rebase', '--continue']);
    assert.equal((await finish(f, edit)).status, 'sealed');
    assert.equal((await readState(f.context)).preparations[1]?.resultPlan.sourceTargets[0]?.objectId, source);
});
test('actual merge squash and interactive squash/fixup replace accumulator', async (t) => {
    const f = await fixture(t);
    await f.stage('base', 'base');
    f.git(['commit', '--quiet', '-m', 'Base']);
    const base = f.head();
    f.git(['checkout', '--quiet', '-b', 'topic']);
    await f.stage('one', 'one');
    f.git(['commit', '--quiet', '-m', 'One']);
    const one = f.head();
    await f.stage('two', 'two');
    f.git(['commit', '--quiet', '-m', 'Two']);
    const two = f.head();
    f.git(['checkout', '--quiet', 'main']);
    f.git(['merge', '--squash', 'topic']);
    f.operation.targets = [{ role: 'source', objectId: two }];
    const squash = await preparedFor(f, 'squash', [base]);
    f.git(['commit', '--quiet', '-F', required(squash.outputPath)]);
    assert.equal((await finish(f, squash)).status, 'sealed');
    for (const mode of ['squash', 'fixup']) {
        f.git(['checkout', '--quiet', '-B', `interactive-${mode}`, two]);
        await nextLedger(f);
        // Real interactive porcelain pauses before its declared fold command so the caller can prepare it.
        const editor = path.join(f.directory, `todo-${mode}.cjs`);
        await writeFile(
            editor,
            `const fs=require('node:fs');const p=process.argv[2];const s=fs.readFileSync(p,'utf8');const lines=s.split('\\n');let seen=0;fs.writeFileSync(p,lines.flatMap(l=>l.startsWith('pick ')?(++seen===2?['break',l.replace(/^pick /,'${mode} ')]:[l]):[l]).join('\\n'));`,
        );
        f.git([
            '-c',
            `sequence.editor="${process.execPath.replaceAll('\\', '/')}" "${editor.replaceAll('\\', '/')}"`,
            'rebase',
            '--interactive',
            base,
        ]);
        assert.equal(f.head(), one);
        f.git(['cherry-pick', '--no-commit', two]);
        f.operation.targets = [{ role: 'original-source', objectId: two }];
        const fold = await preparedFor(f, 'squash', [base], 'replace', one);
        f.git(['reset', '--hard', one]);
        f.git(['rebase', '--continue']);
        f.git(['commit', '--quiet', '--amend', '-F', required(fold.outputPath)]);
        assert.equal((await finish(f, fold)).status, 'sealed');
    }
});

test('preparation freezes its checked decision before a lazy loader can mutate caller data', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const decision = f.decision();
    const prepared = await f.prepare({
        decision,
        loadRegistry: async () => {
            decision.branch = 'repository-policy';
            return registry;
        },
    });
    assert.equal(prepared.status, 'prepared');
    assert.equal((await readState(f.context)).preparations[0]?.decision.branch, 'skill-default');
});
test('needs-decision CLI does not read result plan, message or default assessment', async (t) => {
    const f = await fixture(t),
        op = path.join(f.directory, 'operation.json'),
        decision = path.join(f.directory, 'decision.json');
    await writeFile(op, JSON.stringify(f.operation));
    await writeFile(decision, JSON.stringify(f.decision('needs-decision')));
    const no = await runPreparation([
        'prepare',
        '--worktree',
        path.join(f.directory, 'absent-context'),
        '--ledger',
        f.ledgerId,
        '--expect-version',
        '2',
        '--operation',
        op,
        '--decision',
        decision,
        '--result-plan',
        path.join(f.directory, 'absent-plan'),
        '--message',
        path.join(f.directory, 'absent-message'),
        '--output',
        path.join(f.directory, 'candidate'),
    ]);
    assert.equal(no.status, 'needs-decision');
    assert.equal(no.exitCode, 20);
});

import { exportLedgers, importLedgers } from '../src/ledger-transfer.ts';

test('same-version external mutation after candidate publication fails the frozen-state comparison', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const output = path.join(f.directory, 'raced-candidate');
    const result = await prepareLedger(
        f.context,
        2,
        {
            ledgerId: f.ledgerId,
            operation: f.operation,
            decision: f.decision(),
            resultPlan: f.plan(),
            messageBuffer: Buffer.from('Subject\n'),
            output,
            loadRegistry: async () => registry,
        },
        {
            beforePrepareTransaction: async () => {
                const state = JSON.parse(await readFile(f.context.stateFile, 'utf8'));
                state.current.paused = true;
                await writeFile(f.context.stateFile, JSON.stringify(state));
            },
        },
    );
    assert.equal(result.status, 'candidate-unprepared');
    assert.match(await readFile(output, 'utf8'), /Assisted-by/);
    const state = await readState(f.context);
    assert.equal(state.stateVersion, 2);
    assert.equal(state.preparations.length, 0);
    assert.equal(state.current?.paused, true);
});
test('finish rejects whole-tree path, mode, OID and ordered parent differences and old-source adoption', async (t) => {
    const f = await fixture(t);
    await f.stage('base', 'base');
    f.git(['commit', '--quiet', '-m', 'Base']);
    const parent = f.head();
    await f.stage('one', 'expected');
    const prepared = await preparedFor(f, 'commit', [parent]);
    const expectedTree = f.git(['write-tree']);
    const message = await readFile(required(prepared.outputPath));
    for (const change of ['oid', 'path', 'mode']) {
        f.git(['read-tree', expectedTree]);
        if (change === 'oid') await f.stage('one', 'different');
        if (change === 'path') {
            f.git(['update-index', '--force-remove', 'one']);
            await f.stage('renamed', 'expected');
        }
        if (change === 'mode') f.git(['update-index', '--chmod=+x', 'one']);
        const tree = f.git(['write-tree']),
            sha = f.git(['commit-tree', tree, '-p', parent], message);
        const state = await readState(f.context),
            actual = await observeResult(f.repository, sha);
        await assert.rejects(
            finishLedger(f.context, state.stateVersion, {
                ledgerId: f.ledgerId,
                preparationId: required(prepared.preparationId),
                sha,
                review: {
                    ...f.review(required(prepared.preparationId), sha, actual.message),
                    contextId: state.contextId,
                },
            }),
            /parents, tree, manifest/i,
        );
    }
    const wrongParent = f.git(['commit-tree', expectedTree], message),
        state = await readState(f.context),
        actual = await observeResult(f.repository, wrongParent);
    await assert.rejects(
        finishLedger(f.context, state.stateVersion, {
            ledgerId: f.ledgerId,
            preparationId: required(prepared.preparationId),
            sha: wrongParent,
            review: {
                ...f.review(required(prepared.preparationId), wrongParent, actual.message),
                contextId: state.contextId,
            },
        }),
        /parents, tree, manifest/i,
    );
    await assert.rejects(
        finishLedger(f.context, state.stateVersion, {
            ledgerId: f.ledgerId,
            preparationId: required(prepared.preparationId),
            sha: parent,
            review: { ...f.review(required(prepared.preparationId), parent, message), contextId: state.contextId },
        }),
        /preexisting/i,
    );
    assert.equal((await readState(f.context)).ledgers[0]?.state, 'prepared');
});
test('prepared resume finishes after source removal with fresh target review; copy cannot reuse preparation', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const prepared = await f.prepare();
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    const sha = f.head(),
        actual = await observeResult(f.repository, sha),
        sourceState = await readState(f.context),
        bundle = path.join(f.directory, 'transfer.json');
    await exportLedgers(f.context, sourceState.stateVersion, { ledgerIds: [f.ledgerId], output: bundle });
    const targetPath = path.join(f.directory, 'target'),
        copyPath = path.join(f.directory, 'copy');
    f.git(['clone', '--quiet', f.repository, targetPath]);
    f.git(['clone', '--quiet', f.repository, copyPath]);
    const target = await resolveLedgerContext(targetPath),
        copy = await resolveLedgerContext(copyPath);
    await initializeState(target);
    await initializeState(copy);
    await importLedgers(target, 0, { input: bundle, mode: 'resume', singleAuthority: true });
    const copied = await importLedgers(copy, 0, { input: bundle, mode: 'copy' });
    assert.equal(path.dirname(f.repository), f.directory);
    await rm(f.repository, { recursive: true, force: true });
    const state = await readState(target),
        review = { ...f.review(required(prepared.preparationId), sha, actual.message), contextId: state.contextId };
    await assert.rejects(
        finishLedger(target, state.stateVersion, {
            ledgerId: f.ledgerId,
            preparationId: required(prepared.preparationId),
            sha,
            review: { ...review, contextId: sourceState.contextId },
        }),
        /current context/i,
    );
    const sealed = await finishLedger(target, state.stateVersion, {
        ledgerId: f.ledgerId,
        preparationId: required(prepared.preparationId),
        sha,
        review,
    });
    assert.equal(sealed.status, 'sealed');
    const copyState = await readState(copy),
        copyId = required(copied.ledgerIds[0]);
    await assert.rejects(
        finishLedger(copy, copyState.stateVersion, {
            ledgerId: copyId,
            preparationId: required(prepared.preparationId),
            sha,
            review: { ...review, contextId: copyState.contextId, ledgerId: copyId },
        }),
        /current preparation/i,
    );
});
test('actual rebase-merges accepts explicit rewritten ordered parents', async (t) => {
    const f = await fixture(t);
    await f.stage('base', 'base');
    f.git(['commit', '--quiet', '-m', 'Base']);
    const base = f.head();
    f.git(['checkout', '--quiet', '-b', 'side']);
    await f.stage('side', 'side');
    f.git(['commit', '--quiet', '-m', 'Side']);
    f.git(['checkout', '--quiet', 'main']);
    await f.stage('main', 'main');
    f.git(['commit', '--quiet', '-m', 'Main']);
    f.git(['merge', '--no-ff', '-m', 'Original merge', 'side']);
    const original = f.head();
    f.git(['checkout', '--quiet', '-b', 'new-base', base]);
    await f.stage('new-base', 'new base');
    f.git(['commit', '--quiet', '-m', 'New base']);
    f.git(['checkout', '--quiet', 'main']);
    const editor = path.join(f.directory, 'merge-todo.cjs');
    await writeFile(
        editor,
        "const fs=require('node:fs');const p=process.argv[2];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^merge /m,'break\\nmerge '));",
    );
    f.git([
        '-c',
        `sequence.editor="${process.execPath.replaceAll('\\', '/')}" "${editor.replaceAll('\\', '/')}"`,
        'rebase',
        '--interactive',
        '--rebase-merges',
        '--onto',
        'new-base',
        base,
    ]);
    const todo = await readFile(path.join(f.context.locator.gitDirectory, 'rebase-merge', 'git-rebase-todo'), 'utf8'),
        line = todo.split('\n').find((line) => line.startsWith('merge '));
    assert.ok(line);
    const label = required(line.split(' ')[3]);
    const rewritten = f.git(['rev-parse', `refs/rewritten/${label}`]),
        parent = f.head();
    f.git(['merge', '--no-ff', '--no-commit', rewritten]);
    f.operation.targets = [{ role: 'original-source', objectId: original }];
    const prepared = await preparedFor(f, 'rebase', [parent, rewritten]);
    f.git(['merge', '--abort']);
    f.git(['rebase', '--continue']);
    f.git(['commit', '--quiet', '--amend', '-F', required(prepared.outputPath)]);
    assert.deepEqual((await observeResult(f.repository, f.head())).parents, [parent, rewritten]);
    assert.equal((await finish(f, prepared)).status, 'sealed');
});
test('finish compares complete ordered parent lists rather than a set', async (t) => {
    const f = await fixture(t);
    await f.stage('base', 'base');
    f.git(['commit', '--quiet', '-m', 'Base']);
    const base = f.head();
    f.git(['checkout', '--quiet', '-b', 'side']);
    await f.stage('side', 'side');
    f.git(['commit', '--quiet', '-m', 'Side']);
    const side = f.head();
    f.git(['checkout', '--quiet', 'main']);
    await f.stage('expected', 'expected');
    const prepared = await preparedFor(f, 'merge', [base, side]);
    const tree = f.git(['write-tree']),
        sha = f.git(['commit-tree', tree, '-p', side, '-p', base], await readFile(required(prepared.outputPath))),
        actual = await observeResult(f.repository, sha),
        state = await readState(f.context);
    await assert.rejects(
        finishLedger(f.context, state.stateVersion, {
            ledgerId: f.ledgerId,
            preparationId: required(prepared.preparationId),
            sha,
            review: { ...f.review(required(prepared.preparationId), sha, actual.message), contextId: state.contextId },
        }),
        /parents, tree, manifest/i,
    );
    assert.equal((await readState(f.context)).ledgers[0]?.state, 'prepared');
});

import { selectedLedgerSnapshot } from '../src/ledger.ts';
import { processMessage } from '../src/message.ts';

test('preview leaves lifecycle open and mechanical final CRLF preserves the frozen identity gate', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const initial = await readState(f.context);
    const preview = await processMessage(
        { mode: 'render', message: Buffer.from('Subject\n'), operation: f.operation, decision: f.decision() },
        async () => ({ ledger: selectedLedgerSnapshot(initial, f.operation, f.ledgerId, true), registry }),
    );
    assert.equal(preview.exitCode, 0);
    assert.deepEqual(await readState(f.context), initial);
    const prepared = await f.prepare(),
        candidate = await readFile(required(prepared.outputPath), 'utf8');
    f.git(['commit', '--quiet', '--cleanup=verbatim', '-F', '-'], candidate.replaceAll('\n', '\r\n'));
    assert.equal((await finish(f, prepared)).status, 'sealed');
});
test('finish persistence rejects same-version external changes and preserves the prepared receipt', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const prepared = await f.prepare();
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    const result = await finish(
        f,
        prepared,
        {},
        {
            beforeFinishTransaction: async () => {
                const state = JSON.parse(await readFile(f.context.stateFile, 'utf8'));
                state.current.paused = true;
                await writeFile(f.context.stateFile, JSON.stringify(state));
            },
        },
    );
    assert.equal(result.status, 'prepared');
    assert.equal(result.exitCode, 2);
    assert.equal((await readState(f.context)).ledgers[0]?.state, 'prepared');
    assert.equal((await finish(f, prepared)).status, 'sealed');
});
test('no-result fast-forward and skipped replay do not consume an open plan', async (t) => {
    const f = await fixture(t);
    await f.stage('file', 'base');
    f.git(['commit', '--quiet', '-m', 'Base']);
    const base = f.head(),
        initial = await readState(f.context);
    f.git(['checkout', '--quiet', '-b', 'source']);
    await f.stage('file', 'source');
    f.git(['commit', '--quiet', '-m', 'Source']);
    const source = f.head();
    f.git(['checkout', '--quiet', 'main']);
    f.git(['merge', '--ff-only', 'source']);
    assert.deepEqual(await readState(f.context), initial);
    f.git(['checkout', '--quiet', '-B', 'skip', base]);
    await f.stage('file', 'conflict');
    f.git(['commit', '--quiet', '-m', 'Conflict']);
    f.git(['cherry-pick', source], undefined, false);
    assert.ok(f.git(['ls-files', '--unmerged']));
    f.git(['cherry-pick', '--skip']);
    assert.deepEqual(await readState(f.context), initial);
    const editor = path.join(f.directory, 'drop-todo.cjs');
    await writeFile(
        editor,
        "const fs=require('node:fs');const p=process.argv[2];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^pick /gm,'drop '));",
    );
    f.git([
        '-c',
        `sequence.editor="${process.execPath.replaceAll('\\', '/')}" "${editor.replaceAll('\\', '/')}"`,
        'rebase',
        '--interactive',
        base,
    ]);
    assert.equal(f.head(), base);
    assert.deepEqual(await readState(f.context), initial);
});
test('prepare rejects stable ledger IDs as operation IDs and changed reuse while permitting identical reopened scope', async (t) => {
    const alias = await fixture(t);
    await alias.stage();
    alias.operation.id = alias.ledgerId;
    await assert.rejects(alias.prepare(), /operation ID/i);
    const f = await fixture(t);
    await f.stage();
    const first = await f.prepare();
    let state = await readState(f.context);
    await transactState(f.context, state.stateVersion, (draft) => {
        reopenLedger(draft, f.ledgerId, { reviewedNoResult: true });
    });
    f.operation.kind = 'amend';
    state = await readState(f.context);
    const options = () => ({
        ledgerId: f.ledgerId,
        operation: f.operation,
        decision: f.decision(),
        resultPlan: f.plan(),
        messageBuffer: Buffer.from('Subject\n'),
        output: path.join(f.directory, `fresh-${randomUUID()}`),
        loadRegistry: async () => registry,
    });
    await assert.rejects(prepareLedger(f.context, state.stateVersion, options()), /operation ID/i);
    f.operation.kind = 'commit';
    const second = await prepareLedger(f.context, state.stateVersion, options());
    assert.equal(second.status, 'prepared');
    assert.notEqual(second.preparationId, first.preparationId);
    assert.equal((await readState(f.context)).preparations.length, 2);
});
test('finish CLI binds an exact full result and skips unused repository assessment', async (t) => {
    const f = await fixture(t);
    await f.stage();
    const prepared = await f.prepare({ decision: f.decision('repository-policy') });
    f.git(['commit', '--quiet', '-F', required(prepared.outputPath)]);
    const actual = await observeResult(f.repository, f.head()),
        state = await readState(f.context),
        reviewPath = path.join(f.directory, 'review.json');
    await writeFile(
        reviewPath,
        JSON.stringify({
            ...f.review(required(prepared.preparationId), actual.sha, actual.message, {
                repositoryPolicyChecked: true,
            }),
            contextId: state.contextId,
        }),
    );
    const sealed = await runPreparation([
        'finish',
        '--worktree',
        f.repository,
        '--ledger',
        f.ledgerId,
        '--preparation',
        required(prepared.preparationId),
        '--sha',
        actual.sha,
        '--review',
        reviewPath,
        '--expect-version',
        String(state.stateVersion),
        '--assessment',
        path.join(f.directory, 'missing.json'),
    ]);
    assert.equal(sealed.status, 'sealed');
    assert.equal(sealed.exitCode, 10);
});

import { cp, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resumeLedger } from '../src/ledger.ts';
import { parseRegistry } from '../src/records.ts';

test('reviewed consumed registry disappearance cannot become API or CLI candidate output', async (t) => {
    for (const mode of ['api', 'cli']) {
        const f = await fixture(t),
            registryFile = path.join(f.directory, 'registry.json');
        await f.stage();
        await writeFile(registryFile, JSON.stringify(registry));
        const loader = async (consumedPaths?: string[]) => {
            consumedPaths?.push(registryFile);
            const parsed = parseRegistry(JSON.parse(await readFile(registryFile, 'utf8')));
            await unlink(registryFile);
            return parsed;
        };
        if (mode === 'api')
            await assert.rejects(f.prepare({ output: registryFile, loadRegistry: loader }), /consumed input/i);
        else {
            const operation = path.join(f.directory, 'operation.json'),
                decision = path.join(f.directory, 'decision.json'),
                plan = path.join(f.directory, 'plan.json'),
                message = path.join(f.directory, 'message.txt');
            await writeFile(operation, JSON.stringify(f.operation));
            await writeFile(decision, JSON.stringify(f.decision()));
            await writeFile(plan, JSON.stringify(f.plan()));
            await writeFile(message, 'Subject\n');
            await assert.rejects(
                runPreparation(
                    [
                        'prepare',
                        '--worktree',
                        f.repository,
                        '--ledger',
                        f.ledgerId,
                        '--expect-version',
                        '2',
                        '--operation',
                        operation,
                        '--decision',
                        decision,
                        '--result-plan',
                        plan,
                        '--message',
                        message,
                        '--output',
                        registryFile,
                    ],
                    loader,
                ),
                /consumed input/i,
            );
        }
        await assert.rejects(readFile(registryFile), { code: 'ENOENT' });
        const state = await readState(f.context);
        assert.equal(state.preparations.length, 0);
        assert.equal(state.ledgers[0]?.state, 'open');
    }
});
test('reviewed built-in registry loader protects its consumed path after successful read', async (t) => {
    const f = await fixture(t),
        runtime = path.join(f.directory, 'runtime');
    await mkdir(runtime);
    await mkdir(path.join(runtime, 'references'));
    await mkdir(path.join(runtime, 'tooling'));
    await cp(fileURLToPath(new URL('../src', import.meta.url)), path.join(runtime, 'src'), { recursive: true });
    for (const file of ['errors.ts', 'file-evidence.ts'])
        await cp(fileURLToPath(new URL(`../tooling/${file}`, import.meta.url)), path.join(runtime, 'tooling', file));
    await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module' }));
    const registryFile = path.join(runtime, 'references', 'agent-registry.json');
    await writeFile(registryFile, JSON.stringify(registry));
    await f.stage();
    const { prepareLedger: isolatedPrepare } = await import(
        pathToFileURL(path.join(runtime, 'src', 'ledger-preparation.ts')).href
    );
    await assert.rejects(
        isolatedPrepare(f.context, 2, {
            ledgerId: f.ledgerId,
            operation: f.operation,
            decision: f.decision(),
            resultPlan: f.plan(),
            messageBuffer: Buffer.from('Subject\n'),
            output: registryFile,
            loadAssessment: async () => {
                await unlink(registryFile);
                return undefined;
            },
        }),
        /consumed input/i,
    );
    await assert.rejects(readFile(registryFile), { code: 'ENOENT' });
    assert.equal((await readState(f.context)).preparations.length, 0);
});
test('reviewed unused repository assessment path is not a consumed-input veto', async (t) => {
    const f = await fixture(t),
        operation = path.join(f.directory, 'operation.json'),
        decision = path.join(f.directory, 'decision.json'),
        plan = path.join(f.directory, 'plan.json'),
        message = path.join(f.directory, 'message.txt'),
        output = path.join(f.directory, 'unused-assessment.json');
    await writeFile(operation, JSON.stringify(f.operation));
    await writeFile(decision, JSON.stringify(f.decision('repository-policy')));
    await writeFile(plan, JSON.stringify(f.plan()));
    await writeFile(message, 'Subject\n');
    const prepared = await runPreparation(
        [
            'prepare',
            '--worktree',
            f.repository,
            '--ledger',
            f.ledgerId,
            '--expect-version',
            '2',
            '--operation',
            operation,
            '--decision',
            decision,
            '--result-plan',
            plan,
            '--message',
            message,
            '--output',
            output,
            '--assessment',
            output,
        ],
        async () => {
            throw Error('must not load registry');
        },
    );
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.exitCode, 10);
    assert.equal(await readFile(output, 'utf8'), 'Subject\n');
});
test('reviewed repeated copy retains original Operation ID scope collision protection', async (t) => {
    const f = await fixture(t);
    const prepared = await f.prepare(),
        ab = path.join(f.directory, 'ab.json'),
        bc = path.join(f.directory, 'bc.json');
    assert.equal(prepared.status, 'prepared');
    await exportLedgers(f.context, 3, { ledgerIds: [f.ledgerId], output: ab });
    const middlePath = path.join(f.directory, 'middle'),
        targetPath = path.join(f.directory, 'target');
    f.git(['init', '--quiet', '--initial-branch=main', middlePath]);
    f.git(['init', '--quiet', '--initial-branch=main', targetPath]);
    const middle = await resolveLedgerContext(middlePath),
        target = await resolveLedgerContext(targetPath);
    await initializeState(middle);
    await initializeState(target);
    const middleCopy = await importLedgers(middle, 0, { input: ab, mode: 'copy' });
    await exportLedgers(middle, middleCopy.stateVersion, { ledgerIds: middleCopy.ledgerIds, output: bc });
    const targetCopy = await importLedgers(target, 0, { input: bc, mode: 'copy' }),
        targetId = required(targetCopy.ledgerIds[0]);
    const state = await transactState(target, targetCopy.stateVersion, (draft) => {
        resumeLedger(draft, targetId);
    });
    const origin = state.ledgers[0]?.origin;
    assert.ok(origin);
    assert.equal(origin.preparations.length, 0);
    assert.equal(origin.history[0]?.preparations[0]?.ledger.operation.id, f.operation.id);
    const operation = {
            ...f.operation,
            repository: targetPath,
            worktree: targetPath,
            commonGitDir: target.locator.commonGitDir,
            kind: 'merge',
            paths: ['changed'],
        },
        decision = { ...f.decision(), operation };
    await assert.rejects(
        prepareLedger(target, state.stateVersion, {
            ledgerId: targetId,
            operation,
            decision,
            resultPlan: f.plan(),
            messageBuffer: Buffer.from('Subject\n'),
            output: path.join(f.directory, 'reused-operation'),
            loadRegistry: async () => registry,
        }),
        /operation ID.*different normalized scope/i,
    );
    assert.equal((await readState(target)).preparations.length, 0);
    assert.equal((await readState(target)).ledgers[0]?.state, 'open');
});

import { abandonLedger } from '../src/ledger.ts';

test('reviewed abandoning a prepared ledger cannot bypass no-result review on reopen', async (t) => {
    const f = await fixture(t);
    await f.stage();
    assert.equal((await f.prepare()).status, 'prepared');
    let state = await readState(f.context);
    state = await transactState(f.context, state.stateVersion, (draft) => {
        abandonLedger(draft, f.ledgerId);
    });
    assert.equal(state.ledgers[0]?.state, 'abandoned');
    assert.equal(state.ledgers[0]?.currentPreparationId, null);
    await assert.rejects(
        transactState(f.context, state.stateVersion, (draft) => {
            reopenLedger(draft, f.ledgerId, { reviewedNoResult: false });
        }),
        /reviewed-no-result/i,
    );
    const reopened = await transactState(f.context, state.stateVersion, (draft) => {
        reopenLedger(draft, f.ledgerId, { reviewedNoResult: true });
    });
    assert.equal(reopened.ledgers[0]?.state, 'open');
    assert.equal(reopened.preparations.length, 1);
});
test('reviewed Windows namespaced state-directory output cannot bypass preparation publication guard', {
    skip: process.platform !== 'win32',
}, async (t) => {
    const f = await fixture(t);
    await f.stage();
    const output = path.toNamespacedPath(path.join(f.context.stateDirectory, 'candidate'));
    await assert.rejects(f.prepare({ output }), /owned state directory/i);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    const state = await readState(f.context);
    assert.equal(state.stateVersion, 2);
    assert.equal(state.ledgers[0]?.state, 'open');
    assert.equal(state.preparations.length, 0);
});
