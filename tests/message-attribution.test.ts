import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, cp, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveTrustedGit } from '../src/safe-git.ts';

const registry = {
    schemaVersion: 1,
    hosts: [{ name: 'Codex App', aliases: ['Codex desktop'], family: 'Codex' }],
    ambiguousAliases: [],
    familyAliases: {},
};
async function fixture(policy?: string) {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'message-test-')));
    const repository = path.join(directory, 'business');
    await mkdir(repository);
    const executable = await resolveTrustedGit([directory]);
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    const git = (args: string[]) =>
        execFileSync(executable, args, {
            cwd: repository,
            env: environment,
            encoding: 'utf8',
            windowsHide: true,
        }).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    git(['config', 'user.name', 'Synthetic Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    if (policy) await writeFile(path.join(repository, 'AGENTS.md'), policy);
    const operation = {
        schemaVersion: 1,
        id: 'op',
        repository,
        worktree: repository,
        commonGitDir: await realpath(path.join(repository, '.git')),
        kind: 'commit',
        paths: ['new.txt'],
        targets: [],
    };
    const decision = {
        schemaVersion: 2,
        artifact: 'policy-decision',
        operation,
        branch: policy ? 'repository-policy' : 'skill-default',
        rationale: 'Fixture policy was inspected by the Agent.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture:decision' },
    };
    const event = (_id = 'e', model = 'formal.model-1', reasoning?: string) => ({
        agent: 'Codex App',
        model,
        ...(reasoning ? { reasoning } : {}),
    });
    const ledger = {
        schemaVersion: 2,
        ledgerId: '00000000-0000-4000-8000-000000000001',
        operation,
        identities: [event()],
        blockers: [],
    };
    const snapshot = async () => ({
        head: await readFile(path.join(repository, '.git/HEAD')),
        config: await readFile(path.join(repository, '.git/config')),
        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
        status: git(['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1']),
        identity: git(['var', 'GIT_AUTHOR_IDENT']).replace(/ \d+ [+-]\d+$/, ''),
        committer: git(['var', 'GIT_COMMITTER_IDENT']).replace(/ \d+ [+-]\d+$/, ''),
        index: existsSync(path.join(repository, '.git/index'))
            ? await readFile(path.join(repository, '.git/index'))
            : null,
        worktreeBytes: await Promise.all(
            ['new.txt', 'AGENTS.md'].map(async (file) =>
                existsSync(path.join(repository, file)) ? await readFile(path.join(repository, file)) : null,
            ),
        ),
    });
    return {
        directory,
        repository,
        executable,
        operation,
        decision,
        event,
        ledger,
        git,
        snapshot,
        dispose: async () => {
            assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
            await rm(directory, { recursive: true, force: true });
        },
    };
}
async function runtime() {
    assert.ok(
        existsSync(new URL('../src/message.ts', import.meta.url)),
        'PR6 must implement actual route-first message behavior',
    );
    return import('../src/message.ts');
}

test('message route bypasses every default loader and preserves exclusive policy bytes', async () => {
    const { processMessage } = await runtime();
    for (const policy of [
        'Require AI Co-authored-by.\n',
        'Forbid disclosure.\n',
        'Only AI-Agent is forbidden.\n',
        'Use a body declaration.\n',
    ]) {
        const f = await fixture(policy);
        try {
            const before = await f.snapshot();
            const message = Buffer.from(
                'subject\r\n\r\nCo-authored-by: AI <fixture@example.invalid>\r\nAssisted-by: invalid\r\n',
            );
            for (const mode of ['render', 'validate'] as const) {
                const result = await processMessage({ mode, message, ...f }, async () => {
                    throw new Error('default branch invoked');
                });
                assert.equal(result.exitCode, 10);
                assert.equal(result.format.status, 'not-run');
                assert.equal(result.participationEvidence.status, 'not-run');
                assert.equal(result.repositoryPolicyValidation.status, 'not-run');
                if (mode === 'render') assert.equal(result.message.preview, message.toString());
            }
            assert.deepEqual(await f.snapshot(), before);
        } finally {
            await f.dispose();
        }
    }
});

test('default render uses stable evidence tuples, aliases, none and exact model punctuation with idempotence', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const events = [
            f.event(),
            f.event('two', 'formal.model-1', 'ultra'),
            f.event('disabled', 'formal.model-1', 'none'),
            f.event('other', 'formal.model.2'),
        ];
        const ledger = { ...f.ledger, identities: [...events, f.event()] };
        const message = Buffer.from(
            'subject\n\nBody --- stays.\n---\npatch-looking body\n\nSigned-off-by: Human <h@example.invalid>\nAssisted-by: Codex desktop:formal.model-1\nCo-authored-by: Human <h@example.invalid>\nAssisted-by: Codex App:formal.model-1\n',
        );
        const expected =
            'subject\n\nBody --- stays.\n---\npatch-looking body\n\nSigned-off-by: Human <h@example.invalid>\nCo-authored-by: Human <h@example.invalid>\nAssisted-by: Codex App:formal.model-1\nAssisted-by: Codex App:formal.model-1 (none)\nAssisted-by: Codex App:formal.model-1 (ultra)\nAssisted-by: Codex App:formal.model.2\n';
        const load = async () => ({ ledger, registry });
        const result = await processMessage({ mode: 'render', message, ...f }, load);
        assert.equal(result.exitCode, 0, JSON.stringify(result.issues));
        assert.equal(result.message.preview, expected);
        const second = await processMessage({ mode: 'render', message: Buffer.from(expected), ...f }, load);
        assert.equal(second.message.preview, expected);
        assert.equal(second.message.changed, false);
        const reversed = await processMessage({ mode: 'render', message, ...f }, async () => ({
            ledger: { ...ledger, identities: [...events].reverse() },
            registry,
        }));
        assert.equal(reversed.message.preview, expected);
        assert.equal(
            (await processMessage({ mode: 'validate', message: Buffer.from(expected), ...f }, load)).exitCode,
            0,
        );
        const missing = await processMessage({ mode: 'validate', message: Buffer.from('subject\n'), ...f }, load);
        assert.equal(missing.exitCode, 20);
        assert.equal(missing.participationEvidence.status, 'complete-against-declared-input');
    } finally {
        await f.dispose();
    }
});

test('message rendering preserves CRLF, mixed body endings, folded unrelated trailers and final-newline contracts', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const load = async () => ({ ledger: f.ledger, registry });
        for (const [source, expected] of [
            ['subject', 'subject\n\nAssisted-by: Codex App:formal.model-1\n'],
            ['subject\r\n\r\nbody\r\n', 'subject\r\n\r\nbody\r\n\r\nAssisted-by: Codex App:formal.model-1\r\n'],
            [
                'subject\n\nbody\r\n\r\nSigned-off-by: Human\r\n continuation\r\n',
                'subject\n\nbody\r\n\r\nSigned-off-by: Human\r\n continuation\r\nAssisted-by: Codex App:formal.model-1\r\n',
            ],
            [
                'subject\n\nSigned-off-by: Human',
                'subject\n\nSigned-off-by: Human\nAssisted-by: Codex App:formal.model-1',
            ],
            [
                'subject\n\nQuoted example: Assisted-by: Example:model\n',
                'subject\n\nQuoted example: Assisted-by: Example:model\n\nAssisted-by: Codex App:formal.model-1\n',
            ],
        ]) {
            assert.equal(typeof source, 'string');
            assert.equal(typeof expected, 'string');
            const result = await processMessage({ mode: 'render', message: Buffer.from(source ?? ''), ...f }, load);
            assert.equal(result.exitCode, 0, JSON.stringify(result.issues));
            assert.equal(result.message.preview, expected);
            assert.equal(
                (await processMessage({ mode: 'render', message: Buffer.from(expected ?? ''), ...f }, load)).message
                    .preview,
                expected,
            );
        }
    } finally {
        await f.dispose();
    }
});

test('raw folded or malformed Assisted-by is rejected; unresolved required records and known participants block', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const before = await f.snapshot();
        const load = async () => ({ ledger: f.ledger, registry });
        for (const line of [
            'Assisted-by: Codex App:\n formal.model-1',
            'Assisted-by: Codex App:formal.model-1 ()',
            'Assisted-by: unknown:model',
            'Assisted-by: Codex App:formal.model-1\t',
        ]) {
            const result = await processMessage(
                { mode: 'validate', message: Buffer.from(`subject\n\n${line}\n`), ...f },
                load,
            );
            assert.equal(result.exitCode, 2, line);
            assert.equal(result.format.status, 'invalid');
        }
        const conflict = await processMessage(
            { mode: 'render', message: Buffer.from('subject\n\nAssisted-by: Codex App:other.model\n'), ...f },
            load,
        );
        assert.equal(conflict.exitCode, 20);
        assert.equal(conflict.message.preview, undefined);
        const gap = await processMessage({ mode: 'render', message: Buffer.from('subject\n'), ...f }, async () => ({
            ledger: { ...f.ledger, blockers: [{ id: 'missing:model', reason: 'Required model is unresolved.' }] },
            registry,
        }));
        assert.equal(gap.exitCode, 20);
        assert.equal(gap.participationEvidence.status, 'incomplete');
        const optional = await processMessage(
            {
                mode: 'render',
                message: Buffer.from('subject\n\nAssisted-by: Codex App:formal.model-1 (unknown)\n'),
                ...f,
            },
            load,
        );
        assert.equal(optional.exitCode, 2);
        assert.equal(optional.message.preview, undefined);
        for (const control of ['\r', '\n', '\0', '\u0085', '\u2028', '\u2029']) {
            await assert.rejects(
                processMessage({ mode: 'render', message: Buffer.from('subject\n'), ...f }, async () => ({
                    ledger: { ...f.ledger, identities: [{ ...f.event(), model: ` ${control}bad` }] },
                    registry,
                })),
                /control/,
            );
        }
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('message processing does not recapture target bytes after a declared decision or asynchronous evidence handoff', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        await writeFile(path.join(f.repository, 'new.txt'), 'changed after a wait\n');
        const before = await f.snapshot();
        const result = await processMessage(
            { mode: 'validate', message: Buffer.from('subject\n\nAssisted-by: Codex App:formal.model-1\n'), ...f },
            async () => {
                await writeFile(path.join(f.repository, 'new.txt'), 'changed while evidence was obtained\n');
                return { ledger: f.ledger, registry };
            },
        );
        assert.equal(result.exitCode, 0);
        assert.deepEqual(result.routing, { branch: 'skill-default' });
        assert.deepEqual({ ...(await f.snapshot()), worktreeBytes: before.worktreeBytes }, before);
    } finally {
        await f.dispose();
    }
});

test('explicit output creates only a new file and refuses peers, links, metadata and unsafe parents', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const before = await f.snapshot();
        const message = Buffer.from('subject\n');
        const load = async () => ({ ledger: f.ledger, registry });
        const output = path.join(f.directory, 'new-message.txt');
        const result = await processMessage({ mode: 'render', message, output, ...f }, load);
        assert.equal(result.exitCode, 0);
        assert.equal(await readFile(output, 'utf8'), 'subject\n\nAssisted-by: Codex App:formal.model-1\n');
        const hard = path.join(f.directory, 'hard');
        await link(output, hard);
        const linkedParent = path.join(f.directory, 'junction');
        await symlink(f.repository, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
        for (const destination of [
            output,
            hard,
            path.join(linkedParent, 'new'),
            path.join(f.operation.commonGitDir, 'message'),
            f.directory,
        ]) {
            await assert.rejects(
                processMessage({ mode: 'render', message, output: destination, ...f }, load),
                /output|Output|path|Path/,
            );
        }
        assert.equal(await readFile(output, 'utf8'), result.message.preview);
        await assert.rejects(
            processMessage({ mode: 'validate', message, output: path.join(f.directory, 'invalid'), ...f }, load),
            /output/,
        );
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('unresolved existing host is an identity decision and supported surrounding spacing can be rendered', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const load = async () => ({ ledger: f.ledger, registry });
        const unknown = await processMessage(
            { mode: 'render', message: Buffer.from('subject\n\nAssisted-by: Novel CLI:formal.model-1\n'), ...f },
            load,
        );
        assert.equal(unknown.exitCode, 20);
        assert.equal(unknown.format.status, 'valid');
        const spaced = await processMessage(
            { mode: 'render', message: Buffer.from('subject\n\nassisted-by :  Codex desktop :formal.model-1\n'), ...f },
            load,
        );
        assert.equal(spaced.exitCode, 0);
        assert.equal(spaced.message.preview, 'subject\n\nAssisted-by: Codex App:formal.model-1\n');
    } finally {
        await f.dispose();
    }
});

test('fenced body examples with folded-looking attribution remain literal document bytes', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const body = 'subject\n\n```text\nAssisted-by: Example:\n model\n```\n';
        const result = await processMessage({ mode: 'render', message: Buffer.from(body), ...f }, async () => ({
            ledger: f.ledger,
            registry,
        }));
        assert.equal(result.exitCode, 0);
        assert.equal(result.message.preview, `${body}\nAssisted-by: Codex App:formal.model-1\n`);
    } finally {
        await f.dispose();
    }
});

test('formal colon-bearing model renders and validates without rewriting provider punctuation', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const ledger = { ...f.ledger, identities: [f.event('e', 'amazon.nova-micro-v1:0')] };
        const load = async () => ({ ledger, registry });
        const expected = 'subject\n\nAssisted-by: Codex App:amazon.nova-micro-v1:0\n';
        const result = await processMessage({ mode: 'render', message: Buffer.from('subject\n'), ...f }, load);
        assert.equal(result.exitCode, 0);
        assert.equal(result.message.preview, expected);
        assert.equal(
            (await processMessage({ mode: 'validate', message: Buffer.from(expected), ...f }, load)).exitCode,
            0,
        );
    } finally {
        await f.dispose();
    }
});

test('message success and failures preserve real staged index bytes and unstaged worktree content', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        await writeFile(path.join(f.repository, 'new.txt'), 'staged fixture bytes\n');
        f.git(['add', 'new.txt']);
        await writeFile(path.join(f.repository, 'new.txt'), 'unstaged fixture bytes\n');
        const decision = f.decision;
        const before = await f.snapshot();
        const rendered = await processMessage(
            { mode: 'render', message: Buffer.from('subject\n'), operation: f.operation, decision },
            async () => ({ ledger: f.ledger, registry }),
        );
        assert.equal(rendered.exitCode, 0);
        const failed = await processMessage(
            {
                mode: 'validate',
                message: Buffer.from('subject\n\nAssisted-by: Codex App:\n broken\n'),
                operation: f.operation,
                decision,
            },
            async () => ({ ledger: f.ledger, registry }),
        );
        assert.equal(failed.exitCode, 2);
        assert.deepEqual(await f.snapshot(), before);
        assert.equal(f.git(['show', ':new.txt']), 'staged fixture bytes');
        assert.equal(await readFile(path.join(f.repository, 'new.txt'), 'utf8'), 'unstaged fixture bytes\n');
    } finally {
        await f.dispose();
    }
});

test('automatic signing declarations need no loaded source and cannot be migrated by editing a message', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const message = Buffer.from('subject\n\nCo-authored-by: Unclassified <person@example.invalid>\n');
        const assessment = {
            schemaVersion: 3,
            artifact: 'message-assessment',
            operation: f.operation,
            messageSha256: (await import('node:crypto')).createHash('sha256').update(message).digest('hex'),
            signatures: [
                {
                    id: 'auto',
                    source: { kind: 'automatic-signing', reference: path.join(f.directory, 'absent-source') },
                    classification: 'ai-signature',
                    identityKeys: ['["Codex App","formal.model-1",null]'],
                    evidenceReferences: ['fixture:observed-host'],
                    rationale: 'An independently supplied host-signing declaration.',
                },
            ],
            migrations: [],
        };
        const input = { mode: 'render' as const, message, operation: f.operation, decision: f.decision };
        const before = await f.snapshot();
        const result = await processMessage(input, async () => ({ ledger: f.ledger, registry, assessment }));
        assert.equal(result.exitCode, 20);
        assert.equal(
            result.issues.some((issue) => issue.code === 'automatic-ai-signature'),
            true,
        );
        await assert.rejects(
            processMessage(input, async () => ({
                ledger: f.ledger,
                registry,
                assessment: {
                    ...assessment,
                    migrations: [
                        {
                            signatureIds: ['auto'],
                            identityKeys: ['["Codex App","formal.model-1",null]'],
                            mappingReferences: ['fixture:map'],
                            modificationDecision: { operationId: 'op', reference: 'fixture:modify' },
                        },
                    ],
                },
            })),
            /migration/i,
        );
        await assert.rejects(
            processMessage(input, async () => ({
                ledger: f.ledger,
                registry,
                assessment: {
                    ...assessment,
                    signatures: [{ ...assessment.signatures[0], identityKeys: ['other-key'] }],
                },
            })),
            /identity/,
        );
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('separate synthetic integrator observes a real hook rewrite and halts without helper repair', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const candidate = path.join(f.directory, 'candidate');
        const rendered = await processMessage(
            { mode: 'render', message: Buffer.from('subject\n'), output: candidate, ...f },
            async () => ({ ledger: f.ledger, registry }),
        );
        assert.equal(rendered.exitCode, 0);
        const hook = path.join(f.operation.commonGitDir, 'hooks/commit-msg');
        await writeFile(hook, '#!/bin/sh\nprintf "\\nAssisted-by: Codex App:unrecorded.model\\n" >> "$1"\n');
        await chmod(hook, 0o755);
        // Only this explicitly controlled disposable integrator invokes the real commit/hook.
        f.git(['commit', '--quiet', '--allow-empty', '-F', candidate]);
        const head = f.git(['rev-parse', 'HEAD']);
        const final = f.git(['log', '-1', '--format=%B']);
        const operation = { ...f.operation, id: 'final-operation', targets: [{ role: 'head', objectId: head }] };
        const decision = { ...f.decision, operation };
        const before = await f.snapshot();
        const checked = await processMessage(
            { mode: 'validate', message: Buffer.from(final), operation, decision },
            async () => ({ ledger: { ...f.ledger, operation }, registry }),
        );
        let subsequentActions = 0;
        if (checked.exitCode === 0) subsequentActions++;
        assert.equal(checked.exitCode, 20);
        assert.equal(subsequentActions, 0);
        assert.equal(f.git(['rev-parse', 'HEAD']), head);
        assert.deepEqual(await f.snapshot(), before);
        assert.match(f.git(['log', '-1', '--format=%B']), /unrecorded\.model/);
    } finally {
        await f.dispose();
    }
});

test('installed render performs repository handoff with unusable default resources outside the checkout', async () => {
    const f = await fixture('AI Co-authored-by is required.\n');
    try {
        const install = path.join(f.directory, 'home/skill');
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), install, { recursive: true });
        await writeFile(path.join(install, 'references/agent-registry.json'), 'unusable registry');
        const files = {
            message: 'subject\n\nCo-authored-by: AI <fixture@example.invalid>\n',
            operation: JSON.stringify(f.operation),
            decision: JSON.stringify(f.decision),
        };
        const args = ['render'];
        for (const [name, content] of Object.entries(files)) {
            const file = path.join(f.directory, name);
            await writeFile(file, content);
            args.push(`--${name}`, file);
        }
        args.push(
            '--input',
            path.join(f.directory, 'absent-ledger'),
            '--assessment',
            path.join(f.directory, 'absent-assessment'),
        );
        const environment = Object.fromEntries(
            Object.entries(process.env).filter(
                ([key]) => !/^(?:GIT_|NODE_OPTIONS|NODE_PATH|HOME$|USERPROFILE$|XDG_)/i.test(key),
            ),
        );
        const result = spawnSync(process.execPath, [path.join(install, 'scripts/attribution.mjs'), ...args], {
            cwd: f.repository,
            env: { ...environment, HOME: path.join(f.directory, 'home'), USERPROFILE: path.join(f.directory, 'home') },
            encoding: 'utf8',
            windowsHide: true,
        });
        assert.equal(result.status, 10, result.stderr);
        assert.equal(JSON.parse(result.stdout).message.preview, files.message);
        assert.equal(existsSync(path.join(f.directory, 'node_modules')), false);
    } finally {
        await f.dispose();
    }
});

test('known blockers stop default output without exception continuation', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const output = path.join(f.directory, 'blocked-candidate');
        const result = await processMessage(
            { mode: 'render', message: Buffer.from('subject\n'), output, ...f },
            async () => ({
                ledger: { ...f.ledger, blockers: [{ id: 'required:model', reason: 'Required model unresolved.' }] },
                registry,
            }),
        );
        assert.equal(result.exitCode, 20);
        assert.equal(result.schemaVersion, 3);
        assert.equal(result.participationEvidence.status, 'incomplete');
        assert.equal('appliedExceptionIssueIds' in result.participationEvidence, false);
        assert.equal(result.message.preview, undefined);
        assert.equal(existsSync(output), false);
    } finally {
        await f.dispose();
    }
});

test('exact legacy migration mappings are required and human coauthors remain byte-identical', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const message = Buffer.from(
            'subject\n\nAI-Agent: old-name\nAI-Model: old-route\nCo-authored-by: Human <h@example.invalid>\n',
        );
        const load = async () => ({ ledger: f.ledger, registry });
        const blocked = await processMessage({ mode: 'render', message, ...f }, load);
        assert.equal(blocked.exitCode, 20);
        const recordIds = blocked.issues.filter((issue) => issue.code === 'legacy-signature').map((issue) => issue.id);
        assert.equal(recordIds.length, 2);
        const assessment = {
            schemaVersion: 3,
            artifact: 'message-assessment',
            operation: f.operation,
            messageSha256: (await import('node:crypto')).createHash('sha256').update(message).digest('hex'),
            signatures: recordIds.map((id, index) => ({
                id: `s${index}`,
                source: { kind: 'message-record', messageRecordId: id },
                classification: 'ai-signature',
                identityKeys: ['["Codex App","formal.model-1",null]'],
                evidenceReferences: ['fixture:exact-pairing'],
                rationale: 'Fixture mapping was independently supplied.',
            })),
            migrations: [
                {
                    signatureIds: ['s0', 's1'],
                    identityKeys: ['["Codex App","formal.model-1",null]'],
                    mappingReferences: ['fixture:pair'],
                    modificationDecision: { operationId: 'op', reference: 'user:fixture-modification' },
                },
            ],
        };
        const result = await processMessage({ mode: 'render', message, ...f }, async () => ({
            ...(await load()),
            assessment,
        }));
        assert.equal(result.exitCode, 0, JSON.stringify(result.issues));
        assert.equal(
            result.message.preview,
            'subject\n\nCo-authored-by: Human <h@example.invalid>\nAssisted-by: Codex App:formal.model-1\n',
        );
        const unmapped = await processMessage({ mode: 'render', message, ...f }, async () => ({
            ...(await load()),
            assessment: { ...assessment, migrations: [] },
        }));
        assert.equal(unmapped.exitCode, 20);
        await assert.rejects(
            processMessage({ mode: 'render', message, ...f }, async () => ({
                ...(await load()),
                assessment: { ...assessment, messageSha256: 'a'.repeat(64) },
            })),
            /assessment|Assessment/,
        );
    } finally {
        await f.dispose();
    }
});

test('real isolated trailer parsing and insertion ignore hostile config, includes and inherited repository routes', async () => {
    const { runTrailers } = await import('../src/message-trailers.ts');
    const f = await fixture();
    try {
        const sentinel = path.join(f.directory, 'executed');
        const trap = path.join(f.directory, 'trap.sh');
        await writeFile(trap, `echo executed > '${sentinel.replaceAll('\\', '/')}'\n`);
        const command = `sh '${trap.replaceAll('\\', '/')}'`;
        const config = path.join(f.directory, 'hostile-config');
        await writeFile(
            config,
            `[trailer "arbitrary"]\n cmd = ${command}\n[trailer "Assisted-by"]\n command = ${command}\n[include]\n path = ${path.join(f.directory, 'cycle').replaceAll('\\', '/')}\n`,
        );
        await writeFile(path.join(f.directory, 'cycle'), `[include]\n path = ${config.replaceAll('\\', '/')}\n`);
        await writeFile(path.join(f.operation.commonGitDir, 'config'), await readFile(config));
        const environment = {
            ...process.env,
            GIT_DIR: f.operation.commonGitDir,
            GIT_WORK_TREE: f.repository,
            GIT_CONFIG_GLOBAL: config,
            GIT_CONFIG_SYSTEM: config,
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'trailer.evil.cmd',
            GIT_CONFIG_VALUE_0: command,
            GIT_CONFIG_PARAMETERS: `'trailer.evil.command=${command}'`,
            GIT_TRACE: path.join(f.directory, 'trace'),
        };
        const input = Buffer.from('subject\n\nSigned-off-by: Human\n');
        assert.equal(
            (await runTrailers(input, { excluded: [f.repository, f.operation.commonGitDir], environment })).toString(),
            'Signed-off-by: Human\n',
        );
        const output = await runTrailers(input, {
            excluded: [f.repository, f.operation.commonGitDir],
            environment,
            additions: ['Assisted-by: Codex App:formal.model-1'],
        });
        assert.match(output.toString(), /Assisted-by: Codex App:formal.model-1/);
        assert.equal(existsSync(sentinel), false);
        assert.equal(existsSync(path.join(f.directory, 'trace')), false);
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(runTrailers(input, { excluded: [f.directory], signal: abort.signal }), /Trailer|trailer/);
        await assert.rejects(
            runTrailers(input, { excluded: [f.directory], additions: ['Assisted-by: bad\nInjected: yes'] }),
            /control/,
        );
    } finally {
        await f.dispose();
    }
});

test('migration joins the exact resolved full tuple keys including absent versus none', async () => {
    const { processMessage } = await runtime();
    const f = await fixture();
    try {
        const message = Buffer.from('subject\n\nAI-Agent: old-name\n');
        const ledger = {
            ...f.ledger,
            identities: [
                { agent: 'Codex App', model: 'formal.model-1' },
                { agent: 'Codex App', model: 'formal.model-1', reasoning: 'none' },
            ],
        };
        const load = async () => ({ ledger, registry });
        const blocked = await processMessage({ mode: 'render', message, ...f }, load);
        const recordId = blocked.issues.find((issue) => issue.code === 'legacy-signature')?.id;
        assert.ok(recordId);
        const absent = '["Codex App","formal.model-1",null]';
        const none = '["Codex App","formal.model-1","none"]';
        const assessment = {
            schemaVersion: 3,
            artifact: 'message-assessment',
            operation: f.operation,
            messageSha256: (await import('node:crypto')).createHash('sha256').update(message).digest('hex'),
            signatures: [
                {
                    id: 'legacy',
                    source: { kind: 'message-record', messageRecordId: recordId },
                    classification: 'ai-signature',
                    identityKeys: [absent],
                    evidenceReferences: ['fixture:exact'],
                    rationale: 'Explicit fixture mapping.',
                },
            ],
            migrations: [
                {
                    signatureIds: ['legacy'],
                    identityKeys: [absent],
                    mappingReferences: ['fixture:map'],
                    modificationDecision: { operationId: 'op', reference: 'fixture:authorized' },
                },
            ],
        };
        const run = (change: unknown) =>
            processMessage({ mode: 'render', message, ...f }, async () => ({ ...(await load()), assessment: change }));
        assert.equal(
            (await run(assessment)).message.preview,
            'subject\n\nAssisted-by: Codex App:formal.model-1\nAssisted-by: Codex App:formal.model-1 (none)\n',
        );
        await assert.rejects(
            run({ ...assessment, migrations: [{ ...assessment.migrations[0], identityKeys: [none] }] }),
            /migration|pairing/i,
        );
        await assert.rejects(
            run({ ...assessment, signatures: [{ ...assessment.signatures[0], identityKeys: ['e'] }] }),
            /identity/i,
        );
        await assert.rejects(
            run({ ...assessment, migrations: [{ ...assessment.migrations[0], identityKeys: [absent, none] }] }),
            /pairing/i,
        );
        const human = {
            ...assessment,
            signatures: [{ ...assessment.signatures[0], classification: 'human-signature' }],
        };
        await assert.rejects(run(human), /migration/i);
        await assert.rejects(
            run({
                ...assessment,
                migrations: [
                    {
                        ...assessment.migrations[0],
                        modificationDecision: { operationId: 'stale', reference: 'fixture:old' },
                    },
                ],
            }),
            /current/i,
        );
    } finally {
        await f.dispose();
    }
});
