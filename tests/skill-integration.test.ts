import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { MessageResult, Summary } from '../src/message-contract.ts';
import type { Decision, PolicyScan } from '../src/policy-contract.ts';
import type { Event, Evidence } from '../src/records.ts';
import { resolveTrustedGit } from '../src/safe-git.ts';

type Fact = Omit<Event, 'evidence'> & {
    nativeReasoning?: string;
    reasoningObservation?: string;
    mapping?: { route: string; model: string };
};
type Case = {
    id: string;
    policy: string;
    message: string;
    missing?: string;
    alias?: boolean;
    mapped?: boolean;
    participants?: boolean;
    efforts?: boolean;
    stale?: boolean;
    signing?: boolean;
    injection?: boolean;
    finalRewrite?: boolean;
};
type Corpus = {
    tasks: { id: string; request: string; fixtures: Case[] }[];
    eventProfiles: Record<string, Fact[]>;
    additionalFacts: {
        missingParticipant: { id: string; eventIds: string[] };
        unusedProducts: string[];
        knownHostSigning: string;
        changedPolicy: string;
        finalHookMessage: string;
    };
};

/** Finite public corpus, not a native evaluator or a runtime policy implementation. */
test('portable acceptance corpus exercises fifteen copied-bundle workflows with real Git preservation', async (t) => {
    const corpus = JSON.parse(
        await readFile(new URL('../docs/acceptance/scenarios.json', import.meta.url), 'utf8'),
    ) as Corpus;
    const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'skill-integration-')));
    const executable = await resolveTrustedGit([temporary]);
    const environment = {
        ...Object.fromEntries(
            Object.entries(process.env).filter(
                ([key]) => !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$|HOME$|USERPROFILE$|XDG_)/i.test(key),
            ),
        ),
        HOME: temporary,
        USERPROFILE: temporary,
        XDG_CONFIG_HOME: temporary,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        NODE_DISABLE_COMPILE_CACHE: '1',
    };
    const installed = path.join(temporary, 'installed');
    await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), installed, { recursive: true });
    const cli = path.join(installed, 'scripts/attribution.mjs');
    const call = <T>(args: string[]) => {
        const result = spawnSync(process.execPath, [cli, ...args], {
            cwd: temporary,
            env: environment,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 60_000,
        });
        assert.equal(result.signal, null, result.stderr);
        return { status: result.status, result: JSON.parse(result.stdout || result.stderr) as T };
    };
    try {
        for (const task of corpus.tasks)
            for (const item of task.fixtures)
                await t.test(`${task.id}/${item.id}`, async () => {
                    const directory = path.join(temporary, item.id);
                    await mkdir(directory);
                    const business = path.join(directory, 'business');
                    await mkdir(business);
                    const git = (args: string[]) =>
                        execFileSync(executable, args, {
                            cwd: business,
                            env: environment,
                            encoding: 'utf8',
                            windowsHide: true,
                        });
                    git(['init', '--quiet', '--initial-branch=main']);
                    git(['config', 'user.name', 'Synthetic Fixture']);
                    git(['config', 'user.email', 'fixture@example.invalid']);
                    git(['config', 'core.autocrlf', 'false']);
                    if (process.platform === 'win32') git(['config', 'core.longpaths', 'true']);
                    await writeFile(path.join(business, 'CONTRIBUTING.md'), item.policy);
                    await writeFile(path.join(business, 'widget.txt'), 'initial fixture bytes\n');
                    git(['add', '--', 'CONTRIBUTING.md', 'widget.txt']);
                    git(['commit', '--quiet', '-m', 'fixture']);
                    await writeFile(path.join(business, 'widget.txt'), 'pending fixture bytes\n');
                    git(['add', '--', 'widget.txt']);
                    const operation = {
                        schemaVersion: 1 as const,
                        id: item.id,
                        repository: business,
                        worktree: business,
                        commonGitDir: await realpath(path.join(business, '.git')),
                        kind: 'commit',
                        paths: ['widget.txt'],
                        targets: [{ role: 'head', objectId: git(['rev-parse', 'HEAD']).trim() }],
                    };
                    const context = {
                        schemaVersion: 1,
                        phase: 'prepare',
                        selection: 'index',
                        invocation: {
                            kind: 'agent-context',
                            reference: 'synthetic:public-corpus',
                            effectiveDirectory: business,
                        },
                        ...(item.signing
                            ? { additionalCandidatePaths: [path.join(directory, 'host-signing.txt')] }
                            : {}),
                    };
                    if (item.signing)
                        await writeFile(
                            path.join(directory, 'host-signing.txt'),
                            corpus.additionalFacts.knownHostSigning,
                        );
                    const json = async (name: string, value: unknown) => {
                        const file = path.join(directory, `${name}.json`);
                        await writeFile(file, JSON.stringify(value));
                        return file;
                    };
                    const operationFile = await json('operation', operation);
                    const contextFile = await json('context', context);
                    const scanArgs = ['policy', 'scan', '--operation', operationFile, '--context', contextFile];
                    const scan = call<PolicyScan>(scanArgs).result;
                    const repositoryPolicy = [
                        'body-only',
                        'required-ai-coauthor',
                        'no-disclosure',
                        'marker-only',
                        'final-hook-rewrite',
                    ].includes(item.id);
                    const decision = (
                        current: PolicyScan,
                        branch = repositoryPolicy ? 'repository-policy' : 'skill-default',
                    ): Decision => ({
                        schemaVersion: 1,
                        artifact: 'policy-decision',
                        operation: current.operation,
                        binding: current.binding,
                        branch: current.scanStatus === 'incomplete' ? 'needs-decision' : branch,
                        assessments: current.candidates.map((candidate) => ({
                            candidateId: candidate.id,
                            classification:
                                candidate.locator === path.join(business, 'CONTRIBUTING.md') &&
                                branch === 'repository-policy'
                                    ? 'ai-disclosure-policy'
                                    : 'ordinary-format-only',
                            rationale: 'Synthetic test assessment supplied independently of the scanner.',
                        })),
                        selectedCandidateIds:
                            branch === 'repository-policy'
                                ? current.candidates
                                      .filter(
                                          (candidate) => candidate.locator === path.join(business, 'CONTRIBUTING.md'),
                                      )
                                      .map((candidate) => candidate.id)
                                : [],
                        issueIds: current.issues.map((issue) => issue.id),
                        rationale: 'Finite fixture-specific semantic assessment, not a general classifier.',
                        decisionSource: { kind: 'agent-semantic', reference: 'synthetic:public-corpus' },
                    });
                    const decisionFile = await json('decision', decision(scan));
                    const profile = item.participants
                        ? 'participants'
                        : item.efforts
                          ? 'efforts'
                          : item.injection
                            ? 'injection'
                            : item.mapped
                              ? 'mappedRouter'
                              : item.missing === 'router'
                                ? 'unresolvedRouter'
                                : 'base';
                    const events = (corpus.eventProfiles[profile] ?? []).map((fact): Event => {
                        const { nativeReasoning, reasoningObservation, mapping, ...event } = fact;
                        const evidence: Evidence[] = [
                            {
                                fields: ['agent', 'model'],
                                kind: 'synthetic-fixture',
                                observation: 'effective',
                                reference: 'fixture:provided-handoff',
                                ...(mapping ? { mapping } : {}),
                            },
                        ];
                        if (event.reasoning.state === 'confirmed')
                            evidence.push({
                                fields: ['reasoning'],
                                kind: 'synthetic-fixture',
                                observation: reasoningObservation ?? 'effective',
                                reference: 'fixture:provided-setting',
                                ...(nativeReasoning ? { nativeReasoning } : {}),
                            });
                        return { ...event, evidence };
                    });
                    const knownParticipants = events.map((event) => ({
                        id: event.participantId,
                        eventIds: [event.id],
                    }));
                    if (item.missing === 'participant')
                        knownParticipants.push(corpus.additionalFacts.missingParticipant);
                    if (item.missing === 'model') {
                        for (const event of events) {
                            delete event.model;
                            event.evidence = [
                                {
                                    fields: ['agent'],
                                    kind: 'synthetic-fixture',
                                    observation: 'effective',
                                    reference: 'fixture:provided-handoff',
                                },
                            ];
                        }
                    }
                    const ledgerFile = await json('ledger', {
                        schemaVersion: 1,
                        operation,
                        knownParticipants,
                        events,
                        userExceptions: [],
                    });
                    const messageFile = path.join(directory, 'message.txt');
                    await writeFile(messageFile, item.message);
                    const messageArgs = [
                        '--message',
                        messageFile,
                        '--operation',
                        operationFile,
                        '--context',
                        contextFile,
                        '--decision',
                        decisionFile,
                        '--input',
                        ledgerFile,
                    ];
                    if (item.signing) {
                        const candidate = scan.candidates.find(
                            (candidate) => candidate.locator === path.join(directory, 'host-signing.txt'),
                        );
                        assert.ok(candidate);
                        const { createHash } = await import('node:crypto');
                        const assessment = await json('assessment', {
                            schemaVersion: 1,
                            artifact: 'message-assessment',
                            operation,
                            binding: scan.binding,
                            messageSha256: createHash('sha256').update(item.message).digest('hex'),
                            signatures: [
                                {
                                    id: 'automatic',
                                    source: { policyCandidateId: candidate.id },
                                    classification: 'ai-signature',
                                    eventIds: events.map((event) => event.id),
                                    evidenceReferences: ['fixture:effective-host-setting'],
                                    rationale: 'Synthetic exact effective signing evidence.',
                                },
                            ],
                            migrations: [],
                        });
                        messageArgs.push('--assessment', assessment);
                    }
                    if (item.stale)
                        await writeFile(path.join(business, 'CONTRIBUTING.md'), corpus.additionalFacts.changedPolicy);
                    if (item.finalRewrite) {
                        const hook = path.join(operation.commonGitDir, 'hooks/commit-msg');
                        await writeFile(
                            hook,
                            '#!/bin/sh\nprintf "fix: preserve widget state\\n\\nA fixture hook removed the required disclosure.\\n" > "$1"\n',
                        );
                        await chmod(hook, 0o755);
                        // Only the trusted disposable integrator performs this explicitly authorized fixture commit.
                        git(['commit', '--quiet', '-F', messageFile]);
                        const raw = git(['cat-file', '-p', 'HEAD']);
                        const final = raw.slice(raw.indexOf('\n\n') + 2);
                        assert.equal(final, corpus.additionalFacts.finalHookMessage);
                        assert.equal(final.split('\n').includes('AI assistance was used.'), false);
                        await writeFile(messageFile, final);
                        operation.id = 'final-message';
                        operation.targets = [{ role: 'head', objectId: git(['rev-parse', 'HEAD']).trim() }];
                        await json('operation', operation);
                        await json('decision', decision(call<PolicyScan>(scanArgs).result));
                    }
                    const snapshot = async () => ({
                        head: git(['rev-parse', 'HEAD']),
                        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
                        status: git(['status', '--porcelain=v1', '-z']),
                        config: await readFile(path.join(operation.commonGitDir, 'config')),
                        index: await readFile(path.join(operation.commonGitDir, 'index')),
                        widget: await readFile(path.join(business, 'widget.txt')),
                        policy: await readFile(path.join(business, 'CONTRIBUTING.md')),
                    });
                    const before = await snapshot();
                    const result = call<MessageResult>(['render', ...messageArgs]);
                    const expected = item.injection
                        ? 2
                        : item.missing === 'participant' ||
                            item.missing === 'router' ||
                            item.signing ||
                            item.stale ||
                            scan.scanStatus === 'incomplete'
                          ? 20
                          : repositoryPolicy
                            ? 10
                            : 0;
                    assert.equal(result.status, expected, JSON.stringify(result.result));
                    if (expected === 0) {
                        const preview = result.result.message.preview;
                        assert.ok(preview);
                        await writeFile(messageFile, preview);
                        assert.equal(call<MessageResult>(['validate', ...messageArgs]).status, 0);
                        assert.equal(call<MessageResult>(['render', ...messageArgs]).result.message.preview, preview);
                        if (item.alias) {
                            assert.ok(preview.startsWith(item.message));
                            assert.match(preview, /Assisted-by: Pi CLI:fixture\.model-1/);
                        }
                        if (item.mapped) assert.match(preview, /amazon\.nova-micro-v1:0/);
                        if (item.participants) {
                            const summary = call<Summary>([
                                'summarize',
                                '--input',
                                ledgerFile,
                                '--operation',
                                operationFile,
                            ]).result;
                            assert.equal(summary.tuples.length, 4);
                            assert.equal(summary.events.length, 6);
                            for (const unused of corpus.additionalFacts.unusedProducts)
                                assert.equal(preview.includes(unused), false);
                        }
                        if (item.efforts)
                            assert.deepEqual(
                                result.result.participationEvidence.summary?.tuples.map((tuple) => tuple.reasoning),
                                [undefined, 'high', 'none'],
                            );
                    } else if (expected === 10) {
                        assert.equal(
                            result.result.message.preview,
                            item.finalRewrite ? corpus.additionalFacts.finalHookMessage : item.message,
                        );
                        assert.equal(result.result.participationEvidence.status, 'not-run');
                        assert.equal(result.result.repositoryPolicyValidation.status, 'not-run');
                    } else if (expected === 20) assert.equal(result.result.message.preview, undefined);
                    if (item.stale) {
                        await json('decision', decision(call<PolicyScan>(scanArgs).result, 'repository-policy'));
                        await writeFile(messageFile, 'fix: preserve widget state\n\nAI assistance was used.\n');
                        assert.equal(call<MessageResult>(['render', ...messageArgs]).status, 10);
                    }
                    assert.deepEqual(await snapshot(), before);
                    assert.equal(existsSync(path.join(business, 'injected')), false);
                });
    } finally {
        assert.equal(path.dirname(temporary), await realpath(os.tmpdir()));
        await rm(temporary, { recursive: true, force: true });
    }
});
