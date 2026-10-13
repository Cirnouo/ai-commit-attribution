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
test('PR audit binds the raw description, title, suffix, branch and exact range', () => {
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
    assert.equal(
        result.directMessages[1]?.message,
        'chore(governance): initialize (#42)\n\nDescribe the change.\n\nAssisted-by: Codex',
    );
    for (const number of [undefined, '42', 0, -1, NaN, 1.5])
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
test('PR squash validates raw footer boundaries without normalizing or wrapping the body', () => {
    const base = {
        title: 'chore(governance): initialize',
        head: { ref: 'chore/init', sha: 'head' },
        base: { sha: 'base' },
    };
    const request = (body: string) =>
        buildCommitCheckRequest({ eventName: 'pull_request', event: { number: 42, pull_request: { ...base, body } } });
    assert.equal(
        validateCommitMessage(request('Describe behavior.\nAssisted-by: Codex').directMessages[1]?.message ?? '')
            .length > 0,
        true,
    );
    assert.deepEqual(
        validateCommitMessage(
            request(`Describe behavior.\n\nAssisted-by: ${'x'.repeat(120)}`).directMessages[1]?.message ?? '',
        ),
        [],
    );
    assert.ok(validateCommitMessage(request('x'.repeat(101)).directMessages[1]?.message ?? '').length > 0);
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
        ] as const) {
            await writeFile(file, message);
            const result = spawnSync(process.execPath, [path.join(root, 'tooling/check-commit-message.ts'), file], {
                cwd: root,
                encoding: 'utf8',
                windowsHide: true,
                env: cleanEnvironment,
            });
            assert.equal(result.status, status, result.stdout + result.stderr);
            assert.equal(await readFile(file, 'utf8'), message);
        }
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
