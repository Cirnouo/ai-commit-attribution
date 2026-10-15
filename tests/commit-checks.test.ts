import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCommitCheckRequest, resolveAuditBranch, validateCommitRecords } from '../tooling/check-commits.ts';
import { validateCommitMessage } from '../tooling/governance.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(?:GIT_|GITHUB_|NODE_TEST_)/i.test(name)),
);
test('PR audit binds only raw and suffixed headers, branch and exact range', () => {
    const event = {
        number: 42,
        pull_request: {
            title: 'chore(governance): initialize',
            body: 'Describe the change.\n\nAssisted-by: Codex',
            head: { ref: 'chore/init', sha: 'head' },
            base: { sha: 'base' },
        },
    };
    const result = buildCommitCheckRequest({ eventName: 'pull_request', event });
    assert.equal(result.range, 'base..head');
    assert.deepEqual(result.branches, ['chore/init']);
    assert.deepEqual(result.directMessages, [
        { label: 'pull request title', message: 'chore(governance): initialize' },
        { label: 'predicted squash header', message: 'chore(governance): initialize (#42)' },
    ]);
    assert.equal(result.includeAncestors, false);
    for (const number of [undefined, '42', 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
        assert.throws(
            () => buildCommitCheckRequest({ eventName: 'pull_request', event: { ...event, number } }),
            /positive safe integer/,
        );
    assert.throws(
        () =>
            buildCommitCheckRequest({
                eventName: 'pull_request',
                event: {
                    ...event,
                    pull_request: { ...event.pull_request, title: 'chore(governance): initialize (#42)' },
                },
            }),
        /Remove/,
    );
    assert.throws(
        () =>
            buildCommitCheckRequest({
                eventName: 'pull_request',
                event: { ...event, pull_request: { ...event.pull_request, body: {} } },
            }),
        /identity/,
    );
});
test('PR header budget includes the actual number while authored references remain intact', () => {
    const base = {
        title: 'chore(governance): initialize',
        head: { ref: 'chore/init', sha: 'head' },
        base: { sha: 'base' },
    };
    for (const [number, subjectLength] of [
        [1, 76],
        [42, 75],
        [123456, 71],
    ] as const) {
        for (const extra of [0, 1]) {
            const title = `chore(governance): ${'x'.repeat(subjectLength + extra)}`;
            const request = buildCommitCheckRequest({
                eventName: 'pull_request',
                event: { number, pull_request: { ...base, title, body: 'x'.repeat(101) } },
            });
            const message = request.directMessages[1]?.message ?? '';
            assert.equal(message.length, 100 + extra);
            assert.equal(validateCommitMessage(message).length === 0, extra === 0, message);
        }
    }
    const title = 'fix(attribution): repair #219 from (#220)';
    const request = buildCommitCheckRequest({
        eventName: 'pull_request',
        event: { number: 42, pull_request: { ...base, title, body: null } },
    });
    assert.deepEqual(
        request.directMessages.map(({ message }) => message),
        [title, `${title} (#42)`],
    );
    for (const direct of request.directMessages) assert.deepEqual(validateCommitMessage(direct.message), []);
});
test('PR titles reject line separators and their own suffix without normalizing authored text', () => {
    const request = (title: string) =>
        buildCommitCheckRequest({
            eventName: 'pull_request',
            event: {
                number: 42,
                pull_request: {
                    title,
                    body: null,
                    head: { ref: 'chore/init', sha: 'head' },
                    base: { sha: 'base' },
                },
            },
        });
    for (const separator of ['\r', '\n', '\u2028', '\u2029']) {
        assert.throws(() => request(`chore(governance): initialize${separator}another line`), /single.line/i);
    }
    for (const suffix of ['(#42)', '(#42) ', '(#42)\t']) {
        assert.throws(() => request(`chore(governance): initialize ${suffix}`), /Remove/);
    }
    const rawTitle = 'chore(governance): initialize  ';
    assert.equal(request(rawTitle).directMessages[0]?.message, rawTitle);
    for (const title of [
        'feature(governance): initialize',
        'chore(unknown): initialize',
        'chore(governance): initialize.',
    ]) {
        const result = request(title);
        assert.equal(result.directMessages[0]?.message, title);
        assert.ok(validateCommitMessage(result.directMessages[0]?.message ?? '').length > 0, title);
    }
});
test('push audits distinguish deletion and complete first-push ancestry', () => {
    const before = '0'.repeat(40);
    assert.deepEqual(
        buildCommitCheckRequest({ eventName: 'push', event: { ref: 'refs/heads/chore/init', before, after: 'head' } }),
        { branches: ['chore/init'], directMessages: [], range: 'head', includeAncestors: true },
    );
    assert.equal(
        buildCommitCheckRequest({ eventName: 'push', event: { ref: 'refs/heads/main', before: 'old', after: before } })
            .range,
        null,
    );
    assert.equal(
        buildCommitCheckRequest({ eventName: 'push', event: { ref: 'refs/heads/main', before: 'old', after: 'head' } })
            .range,
        'old..head',
    );
    assert.throws(() => buildCommitCheckRequest({ eventName: 'push', event: {} }), /push event/);
    assert.throws(() => buildCommitCheckRequest({}), /branch identity/);
});
test('merge exemption uses parent topology rather than a forged merge title', () => {
    assert.deepEqual(validateCommitRecords([{ sha: 'merge', message: "Merge branch 'topic'", parentCount: 2 }]), []);
    assert.ok(validateCommitRecords([{ sha: 'forgery', message: "Merge branch 'topic'", parentCount: 1 }]).length > 0);
});
test('detached scheduled and dispatched checkouts require consistent explicit branch proof', () => {
    assert.equal(
        resolveAuditBranch({
            eventName: 'schedule',
            environment: { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main', GITHUB_REF_TYPE: 'branch' },
        }),
        'main',
    );
    for (const environment of [
        {},
        { GITHUB_REF: 'refs/tags/v1.0.0' },
        { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'other' },
        { GITHUB_REF_NAME: 'main' },
    ])
        assert.equal(resolveAuditBranch({ eventName: 'schedule', environment }), undefined);
    assert.equal(
        resolveAuditBranch({ eventName: 'workflow_dispatch', event: { ref: 'main' }, environment: {} }),
        'main',
    );
    assert.equal(resolveAuditBranch({ environment: {}, localBranch: 'chore/init' }), 'chore/init');
});
test('commit-msg executable enforces shared rules and preserves message bytes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'attribution-message-'));
    try {
        const file = path.join(directory, 'COMMIT_EDITMSG');
        for (const [message, status] of [
            ['chore(governance): initialize\n\nAssisted-by: Codex\n', 0],
            ['invalid message\n', 1],
            [`chore(governance): initialize (#42)\n\n${'x'.repeat(101)}\n`, 1],
            ['chore(governance): initialize (#42)\n\nDescribe behavior.\nRefs: #219\n', 1],
            [`chore(governance): initialize (#42)\n\nDescribe behavior.\n\nAssisted-by: ${'x'.repeat(120)}\n`, 0],
        ] as const) {
            await writeFile(file, message);
            const result = spawnSync(process.execPath, [path.join(root, 'tooling/check-commit-message.ts'), file], {
                cwd: root,
                encoding: 'utf8',
                windowsHide: true,
                env: cleanEnvironment,
            });
            assert.equal(result.status, status, result.stdout + result.stderr);
            assert.deepEqual(await readFile(file), Buffer.from(message, 'utf8'));
        }
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
test('PR CLI accepts rich current Markdown while still checking real topic commits and template obligations', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'attribution-pr-commits-'));
    const git = (args: string[]) =>
        execFileSync('git', args, {
            cwd: directory,
            encoding: 'utf8',
            windowsHide: true,
            env: cleanEnvironment,
        }).trim();
    const commit = (message: string) => {
        git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            '-c',
            `core.hooksPath=${path.join(directory, 'no-hooks')}`,
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            message,
        ]);
        return git(['rev-parse', 'HEAD']);
    };
    const body = `## Problem

The prior gate imposed commit formatting on PR Markdown, making a substantive explanation that exceeds one hundred characters fail unnecessarily.

## Resulting behavior

[Details](https://example.invalid/evidence) and ![Screenshot](https://example.invalid/screenshot.png) remain on the PR.

| Scenario | Result |
| --- | --- |
| Current description | Accepted |

Trailer-looking evidence stays ordinary PR text.
Refs: #219
Assisted-by: synthetic fixture

## Verification

\`\`\`text
isolated fixture checks passed
\`\`\`

- [x] Focused tests and \`pnpm verify:push\` pass.
- [ ] Dependency or build-input changes passed \`pnpm check:security\`, when applicable.
    N/A: Dependencies and build inputs are unchanged.
- [ ] Runtime source changes include verified regenerated distribution output, when applicable.
    N/A: Runtime source is unchanged.

## Documentation

- [x] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.
- [x] The PR title and commits follow the repository policy.
- [x] Version 0.1.0 remains unreleased.
`;
    try {
        git(['init', '--quiet', '--initial-branch=main']);
        // The exact PR range must exclude an unrelated invalid base commit.
        const base = commit('invalid historical base outside the PR range');
        const head = commit('test(governance): exercise PR headers');
        const eventFile = path.join(directory, 'event.json');
        const run = async (
            description: string | null,
            sha = head,
            title = 'test(governance): separate PR and commit messages',
        ) => {
            await writeFile(
                eventFile,
                JSON.stringify({
                    number: 42,
                    pull_request: {
                        title,
                        body: description,
                        head: { ref: 'chore/squash-message-policy', sha },
                        base: { sha: base },
                    },
                }),
            );
            return spawnSync(process.execPath, [path.join(root, 'tooling/check-commits.ts')], {
                cwd: directory,
                encoding: 'utf8',
                windowsHide: true,
                env: { ...cleanEnvironment, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventFile },
            });
        };
        const valid = await run(body);
        assert.equal(valid.status, 0, valid.stdout + valid.stderr);
        for (const title of [
            'feature(governance): separate PR messages',
            'test(unknown): separate PR messages',
            'test(governance): separate PR messages.',
        ]) {
            const invalid = await run(body, head, title);
            assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
            assert.match(invalid.stderr, /pull request title/);
        }
        for (const description of [null, '', body.replace('- [x] Focused tests and `pnpm verify:push` pass.', '')]) {
            const invalid = await run(description);
            assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
            assert.match(invalid.stderr, /body|checklist/i);
        }
        const invalidHead = commit('invalid topic commit');
        const invalidCommit = await run(body, invalidHead);
        assert.equal(invalidCommit.status, 1, invalidCommit.stdout + invalidCommit.stderr);
        assert.ok(invalidCommit.stderr.includes(invalidHead), invalidCommit.stderr);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
test('scheduled checker reads real detached Git ancestry and fails invalid ancestors', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'attribution-commits-'));
    const git = (args: string[]) =>
        execFileSync('git', args, {
            cwd: directory,
            encoding: 'utf8',
            windowsHide: true,
            env: cleanEnvironment,
        }).trim();
    try {
        git(['init', '--quiet', '--initial-branch=main']);
        git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'invalid ancestor',
        ]);
        git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'test(governance): add valid head',
        ]);
        git(['checkout', '--quiet', '--detach']);
        const result = spawnSync(process.execPath, [path.join(root, 'tooling/check-commits.ts')], {
            cwd: directory,
            encoding: 'utf8',
            windowsHide: true,
            env: {
                ...cleanEnvironment,
                GITHUB_EVENT_NAME: 'schedule',
                GITHUB_REF: 'refs/heads/main',
                GITHUB_REF_NAME: 'main',
                GITHUB_REF_TYPE: 'branch',
            },
        });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, /invalid ancestor|type|scope/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
