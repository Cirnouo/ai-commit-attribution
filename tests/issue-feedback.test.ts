import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { issueFeedbackContext, runIssueFeedback } from '../tooling/issue-feedback.ts';
import { createGitHubIssueRequest } from '../tooling/issue-github.ts';

const forms = {
    bugReport: readFileSync(new URL('../.github/ISSUE_TEMPLATE/bug_report.yaml', import.meta.url), 'utf8'),
    featureRequest: readFileSync(new URL('../.github/ISSUE_TEMPLATE/feature_request.yaml', import.meta.url), 'utf8'),
};
const body = `### Problem or use case

I need to identify each participating agent.

### Proposed behavior

Show each participating agent.

### Alternatives considered

_No response_

### Additional context

_No response_
`;
const marker = '<!-- ai-commit-attribution:issue-form-feedback:v1 -->';
const base = '/repos/example/project';
const issuePath = `${base}/issues/7`;
const issueUrl = `https://api.github.com${issuePath}`;
const environment = {
    GITHUB_EVENT_NAME: 'issues',
    GITHUB_REPOSITORY: 'example/project',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REF_TYPE: 'branch',
    GITHUB_SHA: 'a'.repeat(40),
};
const event = {
    action: 'opened',
    repository: {
        id: 12,
        full_name: 'example/project',
        name: 'project',
        owner: { login: 'example' },
        default_branch: 'main',
    },
    issue: { id: 70, node_id: 'I_70', number: 7 },
};
const bot = { id: 41898282, login: 'github-actions[bot]', type: 'Bot' };
function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 70,
        node_id: 'I_70',
        number: 7,
        url: issueUrl,
        repository_url: `https://api.github.com${base}`,
        title: 'A feature request',
        body,
        state: 'open',
        updated_at: '2026-10-06T01:00:00Z',
        labels: [{ name: 'template: feature-request' }, { name: 'help wanted' }],
        ...overrides,
    };
}
function comment(id: number, overrides: Record<string, unknown> = {}) {
    return { id, body: `${marker}\nOld diagnosis`, user: bot, issue_url: issueUrl, ...overrides };
}
interface Call {
    method: string;
    path: string;
    body: unknown;
    headers: Headers;
}
class FakeGitHub {
    provisionedLabels = new Set(['template: bug-report', 'template: feature-request', 'template: invalid']);
    current = issue();
    comments: Record<string, unknown>[] = [];
    calls: Call[] = [];
    reads = 0;
    changeAtRead: ((read: number, current: Record<string, unknown>) => void) | undefined;
    responseOverride: ((call: Call) => Response | undefined) | undefined;
    readonly fetch: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, 'https://api.github.com');
        assert.equal(init?.redirect, 'error');
        const call = {
            method: init?.method ?? 'GET',
            path: url.pathname + url.search,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
            headers: new Headers(init?.headers),
        };
        this.calls.push(call);
        const overridden = this.responseOverride?.(call);
        if (overridden) return overridden;
        if (call.method === 'GET' && url.pathname === issuePath) {
            this.reads += 1;
            this.changeAtRead?.(this.reads, this.current);
            return Response.json(this.current);
        }
        if (call.method === 'GET' && url.pathname.startsWith(`${base}/labels/`)) {
            const name = decodeURIComponent(url.pathname.slice(`${base}/labels/`.length));
            return this.provisionedLabels.has(name) ? Response.json({ name }) : new Response('', { status: 404 });
        }
        if (call.method === 'GET' && url.pathname === `${issuePath}/comments`) {
            assert.equal(url.searchParams.get('per_page'), '100');
            const page = Number(url.searchParams.get('page'));
            return Response.json(this.comments.slice((page - 1) * 100, page * 100));
        }
        if (call.method === 'POST' && url.pathname === `${issuePath}/labels`) {
            assert.deepEqual(call.body, { labels: ['template: invalid'] });
            assert.ok(Array.isArray(this.current.labels));
            this.current.labels.push({ name: 'template: invalid' });
            this.current.updated_at = '2026-10-06T01:00:01Z';
            return Response.json(this.current.labels);
        }
        if (call.method === 'DELETE' && url.pathname === `${issuePath}/labels/template%3A%20invalid`) {
            assert.ok(Array.isArray(this.current.labels));
            this.current.labels = this.current.labels.filter(
                (label: unknown) =>
                    typeof label !== 'object' ||
                    label === null ||
                    !('name' in label) ||
                    label.name !== 'template: invalid',
            );
            this.current.updated_at = '2026-10-06T01:00:01Z';
            return Response.json(this.current.labels);
        }
        assert.ok(
            call.body && typeof call.body === 'object' && 'body' in call.body && typeof call.body.body === 'string',
        );
        if (call.method === 'POST' && url.pathname === `${issuePath}/comments`) {
            const created = comment(500, { body: call.body.body });
            this.comments.push(created);
            return Response.json(created, { status: 201 });
        }
        if (call.method === 'PATCH' && url.pathname.startsWith(`${base}/issues/comments/`)) {
            const id = Number(url.pathname.split('/').at(-1));
            const existing = this.comments.find((entry) => entry.id === id);
            assert.ok(existing);
            existing.body = call.body.body;
            return Response.json(existing);
        }
        assert.fail(`Unexpected HTTP request ${call.method} ${call.path}`);
    };
    writes() {
        return this.calls.filter((call) => call.method !== 'GET');
    }
}
function run(fake: FakeGitHub, source: unknown = event, currentForms = forms) {
    return runIssueFeedback(
        issueFeedbackContext(environment, source),
        currentForms,
        createGitHubIssueRequest('private-token', fake.fetch),
    );
}

test('fresh valid typed Issue reads current state and makes no write', async () => {
    const fake = new FakeGitHub();
    assert.equal((await run(fake)).status, 'valid');
    assert.deepEqual(fake.writes(), []);
    assert.ok(fake.calls.every((call) => call.headers.get('Authorization') === 'Bearer private-token'));
});

test('invalid Issue adds only diagnostic label and publishes field-specific repair guidance', async () => {
    const fake = new FakeGitHub();
    fake.current.body = body.replace('Show each participating agent.', '_No response_');
    assert.equal((await run(fake)).status, 'invalid');
    assert.deepEqual(
        fake.writes().map(({ method, path }) => [method, path]),
        [
            ['POST', `${issuePath}/labels`],
            ['POST', `${issuePath}/comments`],
        ],
    );
    assert.deepEqual(fake.current.labels, [
        { name: 'template: feature-request' },
        { name: 'help wanted' },
        { name: 'template: invalid' },
    ]);
    assert.match(String(fake.comments[0]?.body), /Proposed behavior requires a nonempty response/);
    assert.ok(String(fake.comments[0]?.body).startsWith(marker));
    assert.ok(fake.reads >= 3, 'own label update must be confirmed before comment publication');
});

test('repeat invalid run updates one deterministic owned comment and preserves unrelated content', async () => {
    const fake = new FakeGitHub();
    fake.current.body = 'broken';
    fake.current.labels = [{ name: 'template: feature-request' }, { name: 'template: invalid' }, { name: 'triage' }];
    fake.comments = [
        comment(90),
        comment(20),
        comment(10, { user: { id: 9, login: 'human', type: 'User' } }),
        comment(11, { body: 'Other bot content' }),
    ];
    assert.equal((await run(fake)).status, 'invalid');
    assert.deepEqual(
        fake.writes().map(({ method, path }) => [method, path]),
        [['PATCH', `${base}/issues/comments/20`]],
    );
    assert.equal(fake.comments[0]?.body, `${marker}\nOld diagnosis`);
    assert.equal(fake.comments[2]?.body, `${marker}\nOld diagnosis`);
    assert.equal(fake.comments[3]?.body, 'Other bot content');
    assert.match(String(fake.comments[1]?.body), /H3 field heading/);
});

test('repair removes only diagnostic label and resolves the existing owned comment', async () => {
    const fake = new FakeGitHub();
    fake.current.labels = [{ name: 'template: feature-request' }, { name: 'template: invalid' }, { name: 'triage' }];
    fake.comments = [comment(20)];
    assert.equal((await run(fake)).status, 'valid');
    assert.deepEqual(
        fake.writes().map(({ method, path }) => [method, path]),
        [
            ['DELETE', `${issuePath}/labels/template%3A%20invalid`],
            ['PATCH', `${base}/issues/comments/20`],
        ],
    );
    assert.deepEqual(fake.current.labels, [{ name: 'template: feature-request' }, { name: 'triage' }]);
    assert.match(String(fake.comments[0]?.body), /now satisfies/);
});

test('ordinary Issue remains exempt and cleans old diagnosis without creating a comment', async () => {
    const fake = new FakeGitHub();
    fake.current.body = 'any freeform content';
    fake.current.labels = [{ name: 'template: invalid' }, { name: 'triage' }];
    fake.comments = [comment(20)];
    assert.equal((await run(fake)).status, 'skipped');
    assert.match(String(fake.comments[0]?.body), /ordinary freeform Issue/);
    assert.deepEqual(fake.current.labels, [{ name: 'triage' }]);
    const fresh = new FakeGitHub();
    fresh.current.body = null;
    fresh.current.labels = [{ name: 'bug' }];
    assert.equal((await run(fresh)).status, 'skipped');
    assert.deepEqual(fresh.writes(), []);
});

test('human or mismatched bot identities cannot claim feedback through marker text', async () => {
    for (const user of [
        { id: 9, login: 'human', type: 'User' },
        { ...bot, id: 9 },
        { ...bot, type: 'User' },
        { ...bot, login: 'other[bot]' },
    ]) {
        const fake = new FakeGitHub();
        fake.current.body = 'broken';
        fake.comments = [comment(20, { user })];
        await run(fake);
        assert.equal(fake.comments[0]?.body, `${marker}\nOld diagnosis`);
        assert.equal(fake.writes().at(-1)?.method, 'POST');
    }
});

test('paginated comments find owned diagnosis after first hundred', async () => {
    const fake = new FakeGitHub();
    fake.current.body = 'broken';
    fake.comments = Array.from({ length: 100 }, (_, index) =>
        comment(index + 1, { body: 'unrelated', user: { id: 9, login: 'human', type: 'User' } }),
    );
    fake.comments.push(comment(120));
    await run(fake);
    assert.ok(fake.calls.some((call) => call.path === `${issuePath}/comments?per_page=100&page=2`));
    assert.equal(fake.writes().at(-1)?.path, `${base}/issues/comments/120`);
    assert.equal(fake.comments.length, 101);
});

test('malformed comment author fails before any diagnostic write', async () => {
    const malformed = new FakeGitHub();
    malformed.current.body = 'broken';
    malformed.comments = [comment(20, { user: {} })];
    await assert.rejects(run(malformed));
    assert.deepEqual(malformed.writes(), []);
});

test('repeated pagination identities fail before any diagnostic write', async () => {
    const repeated = new FakeGitHub();
    repeated.current.body = 'broken';
    repeated.comments = Array.from({ length: 101 }, () => comment(20));
    await assert.rejects(run(repeated));
    assert.deepEqual(repeated.writes(), []);
});

test('closed Issues and own diagnostic label events make no writes', async () => {
    const closed = new FakeGitHub();
    closed.current.state = 'closed';
    assert.equal((await run(closed)).status, 'closed');
    assert.deepEqual(closed.writes(), []);
    for (const action of ['labeled', 'unlabeled']) {
        const fake = new FakeGitHub();
        assert.equal((await run(fake, { ...event, action, label: { name: 'template: invalid' } })).status, 'ignored');
        assert.deepEqual(fake.calls, []);
    }
});

test('classification label events validate the fetched latest body rather than event content', async () => {
    const fake = new FakeGitHub();
    fake.current.body = 'broken';
    assert.equal(
        (
            await run(fake, {
                ...event,
                action: 'labeled',
                label: { name: 'template: feature-request' },
                issue: { ...event.issue, body },
            })
        ).status,
        'invalid',
    );
});

test('wrong event, repository, ref, number, identity and PR objects fail without HTTP', () => {
    for (const source of [
        null,
        { ...event, action: 'deleted' },
        { ...event, repository: { ...event.repository, full_name: 'other/project' } },
        { ...event, issue: { ...event.issue, number: 0 } },
        { ...event, issue: { ...event.issue, id: '70' } },
        { ...event, issue: { ...event.issue, pull_request: {} } },
        { ...event, action: 'labeled' },
    ]) {
        assert.throws(() => issueFeedbackContext(environment, source));
    }
    for (const env of [
        { ...environment, GITHUB_EVENT_NAME: 'pull_request' },
        { ...environment, GITHUB_REF: 'refs/heads/user-ref' },
        { ...environment, GITHUB_SHA: '' },
        { ...environment, GITHUB_REPOSITORY: '../project' },
    ]) {
        assert.throws(() => issueFeedbackContext(env, event));
    }
});

test('malformed or mismatched latest Issue fails without feedback writes', async () => {
    for (const overrides of [
        { id: 99 },
        { node_id: 'I_99' },
        { number: 8 },
        { url: 'https://evil.invalid/issues/7' },
        { repository_url: 'https://api.github.com/repos/other/project' },
        { pull_request: {} },
        { body: {} },
        { labels: ['template: feature-request'] },
        { state: 'unknown' },
        { updated_at: 'bad date' },
    ]) {
        const fake = new FakeGitHub();
        Object.assign(fake.current, overrides);
        await assert.rejects(run(fake));
        assert.deepEqual(fake.writes(), []);
    }
});

test('changes to source snapshot before publication discard stale result', async () => {
    for (const overrides of [
        { body },
        { title: 'changed' },
        { state: 'closed' },
        { updated_at: '2026-10-06T01:00:02Z' },
        { labels: [{ name: 'template: bug-report' }] },
    ]) {
        const fake = new FakeGitHub();
        fake.current.body = 'broken';
        fake.changeAtRead = (read, current) => {
            if (read === 2) Object.assign(current, overrides);
        };
        assert.equal((await run(fake)).status, 'stale');
        assert.deepEqual(fake.writes(), []);
    }
});

test('edit after known own label mutation prevents stale comment publication', async () => {
    const fake = new FakeGitHub();
    fake.current.body = 'broken';
    fake.changeAtRead = (read, current) => {
        if (read === 3) current.body = body;
    };
    assert.equal((await run(fake)).status, 'stale');
    assert.deepEqual(
        fake.writes().map((call) => call.method),
        ['POST'],
    );
    assert.equal(fake.comments.length, 0);
});

test('configuration, missing diagnostic label, transport and malformed comments fail before marking author invalid', async () => {
    const configuration = new FakeGitHub();
    configuration.current.body = 'broken';
    await assert.rejects(run(configuration, event, { ...forms, featureRequest: 'broken: [' }));
    assert.deepEqual(configuration.writes(), []);
    for (const [path, response] of [
        [`${base}/labels/template%3A%20invalid`, new Response('private error', { status: 404 })],
        [`${issuePath}/comments?per_page=100&page=1`, Response.json({ malformed: true })],
        [issuePath, new Response('private body', { status: 403 })],
    ] as const) {
        const fake = new FakeGitHub();
        fake.current.body = 'broken';
        fake.responseOverride = (call) => (call.path === path ? response : undefined);
        await assert.rejects(run(fake), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.doesNotMatch(error.message, /private error|private body|private-token/);
            return true;
        });
        assert.deepEqual(fake.writes(), []);
    }
});

test('failed label or comment writes cannot fabricate confirmed invalid feedback', async () => {
    for (const path of [`${issuePath}/labels`, `${issuePath}/comments`]) {
        const fake = new FakeGitHub();
        fake.current.body = 'broken';
        fake.responseOverride = (call) =>
            call.method === 'POST' && call.path === path ? new Response('private error', { status: 500 }) : undefined;
        await assert.rejects(run(fake));
        assert.equal(fake.comments.length, 0);
        if (path === `${issuePath}/comments`) {
            assert.deepEqual(
                fake.current.labels,
                [{ name: 'template: feature-request' }, { name: 'help wanted' }, { name: 'template: invalid' }],
                'a confirmed label survives later comment failure without changing other labels',
            );
            fake.responseOverride = undefined;
            assert.equal((await run(fake)).status, 'invalid');
            assert.equal(fake.comments.length, 1, 'a rerun resumes diagnosis after the partial failure');
            assert.doesNotMatch(String(fake.comments[0]?.body), /Resolved:/);
        }
    }
});

test('malformed successful write responses cannot fabricate confirmed feedback', async () => {
    for (const [path, response] of [
        [`${issuePath}/labels`, Response.json([{ name: 'triage' }])],
        [`${issuePath}/comments`, Response.json(comment(500, { user: { ...bot, id: 9 } }))],
        [`${issuePath}/comments`, Response.json(comment(500, { body: 'different content' }))],
        [
            `${issuePath}/comments`,
            Response.json(comment(500, { issue_url: 'https://api.github.com/repos/other/project/issues/7' })),
        ],
    ] as const) {
        const fake = new FakeGitHub();
        fake.current.body = 'broken';
        fake.responseOverride = (call) => (call.method === 'POST' && call.path === path ? response : undefined);
        await assert.rejects(run(fake));
    }
});

test('stale update after own-label confirmation still prevents comment write', async () => {
    const fake = new FakeGitHub();
    fake.current.body = 'broken';
    fake.changeAtRead = (read, current) => {
        if (read === 4) current.updated_at = '2026-10-06T01:00:02Z';
    };
    assert.equal((await run(fake)).status, 'stale');
    assert.deepEqual(
        fake.writes().map((call) => call.method),
        ['POST'],
    );
});

test('HTTP adapter keeps token inside fixed-origin requests and sanitizes network and JSON failures', async () => {
    const request = createGitHubIssueRequest('private-token', async () => {
        throw new Error('private-token private-body');
    });
    await assert.rejects(request('GET', issuePath), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /private-token|private-body/);
        return true;
    });
    for (const endpoint of ['https://evil.invalid', '//evil.invalid/repos/project', '/repos/example/project#secret']) {
        await assert.rejects(request('GET', endpoint), /Invalid Issue feedback API endpoint/);
    }
    const malformed = createGitHubIssueRequest(
        'private-token',
        async () => new Response('private body', { status: 200 }),
    );
    await assert.rejects(malformed('GET', issuePath), /malformed JSON/);
});

test('simulated CI entry publishes feedback before invalid exit and keeps body and token out of logs', () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'issue-entry-'));
    try {
        const eventFile = path.join(temporary, 'event.json');
        const fixtureFile = path.join(temporary, 'http.json');
        const transcript = path.join(temporary, 'calls.json');
        writeFileSync(eventFile, JSON.stringify(event), 'utf8');
        writeFileSync(
            fixtureFile,
            JSON.stringify({ issue: issue({ body: 'private-body-that-is-invalid' }), transcript }),
            'utf8',
        );
        const result = spawnSync(
            process.execPath,
            [
                '--import',
                new URL('./fixtures/issue-feedback-http.ts', import.meta.url).href,
                fileURLToPath(new URL('../tooling/issue-feedback.ts', import.meta.url)),
            ],
            {
                env: {
                    ...process.env,
                    ...environment,
                    GITHUB_EVENT_PATH: eventFile,
                    GH_TOKEN: 'private-token',
                    ATTRIBUTION_ISSUE_HTTP_STATE: fixtureFile,
                },
                encoding: 'utf8',
                timeout: 10_000,
                windowsHide: true,
            },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, 1);
        assert.match(result.stdout, /validation: invalid; feedback: published/);
        assert.equal(result.stderr, '');
        assert.doesNotMatch(result.stdout + result.stderr, /private-token|private-body-that-is-invalid/);
        const calls: unknown = JSON.parse(readFileSync(transcript, 'utf8'));
        assert.ok(Array.isArray(calls));
        assert.deepEqual(
            calls.filter(
                (call: unknown) =>
                    typeof call === 'object' && call !== null && 'method' in call && call.method !== 'GET',
            ),
            [
                { method: 'POST', path: `${issuePath}/labels` },
                { method: 'POST', path: `${issuePath}/comments` },
            ],
        );
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
        rmSync(temporary, { recursive: true, force: true });
    }
});

test('feedback preserves original title/body and an idempotent recovery creates no duplicate comment', async () => {
    const fake = new FakeGitHub();
    const original = { title: 'Private original title', body: 'Private original body without generated fields' };
    Object.assign(fake.current, original);
    fake.responseOverride = (call) =>
        call.method === 'POST' && call.path === `${issuePath}/comments`
            ? new Response('unlogged failure', { status: 500 })
            : undefined;
    await assert.rejects(run(fake));
    assert.equal(fake.current.title, original.title);
    assert.equal(fake.current.body, original.body);
    fake.responseOverride = undefined;
    assert.equal((await run(fake)).status, 'invalid');
    assert.equal(fake.comments.length, 1);
    assert.equal((await run(fake)).feedback, 'unchanged');
    assert.equal(fake.comments.length, 1);
    assert.equal(fake.current.title, original.title);
    assert.equal(fake.current.body, original.body);
    assert.ok(
        fake.writes().every((call) => call.path === `${issuePath}/labels` || call.path === `${issuePath}/comments`),
    );
});

for (const label of ['template: bug-report', 'template: feature-request']) {
    test(
        'round1 rejects absent, renamed and malformed current classification label ' +
            label +
            ' without clearing diagnosis',
        async () => {
            for (const response of [
                () => new Response('', { status: 404 }),
                () => Response.json({ name: 'renamed' }),
                () => Response.json({}),
                () => Response.json(null),
            ]) {
                const fake = new FakeGitHub();
                fake.current.labels = [{ name: 'template: invalid' }, { name: 'triage' }];
                fake.comments = [comment(20)];
                const before = structuredClone({ issue: fake.current, comments: fake.comments });
                fake.responseOverride = (call) =>
                    call.path === `${base}/labels/${encodeURIComponent(label)}` ? response() : undefined;
                await assert.rejects(run(fake));
                assert.deepEqual(fake.writes(), []);
                assert.deepEqual({ issue: fake.current, comments: fake.comments }, before);
            }
        },
    );
}

test('round1 current changed classification label must be remotely provisioned before ordinary or invalid success', async () => {
    const changed = { ...forms, bugReport: forms.bugReport.replace('template: bug-report', 'template: defect') };
    for (const labels of [[{ name: 'template: bug-report' }], [{ name: 'template: defect' }]]) {
        const fake = new FakeGitHub();
        fake.current.labels = labels;
        fake.current.body = 'ordinary or invalid private content';
        fake.responseOverride = (call) =>
            call.path === `${base}/labels/${encodeURIComponent('template: defect')}`
                ? new Response('', { status: 404 })
                : undefined;
        await assert.rejects(run(fake, event, changed));
        assert.deepEqual(fake.writes(), []);
    }
});

test('round1 missing diagnostic configuration fails closed even for fresh valid and ordinary Issues', async () => {
    for (const ordinary of [false, true]) {
        const fake = new FakeGitHub();
        if (ordinary) {
            fake.current.labels = [{ name: 'bug' }];
            fake.current.body = null;
        }
        fake.responseOverride = (call) =>
            call.path === `${base}/labels/${encodeURIComponent('template: invalid')}`
                ? new Response('', { status: 404 })
                : undefined;
        await assert.rejects(run(fake));
        assert.deepEqual(fake.writes(), []);
        assert.deepEqual(fake.comments, []);
    }
});

test('round1 a provisioned current form label uses the same configuration for API checks and body classification', async () => {
    const changed = {
        ...forms,
        featureRequest: forms.featureRequest.replace('template: feature-request', 'template: proposal'),
    };
    const fake = new FakeGitHub();
    fake.provisionedLabels.delete('template: feature-request');
    fake.provisionedLabels.add('template: proposal');
    fake.current.labels = [{ name: 'template: proposal' }];
    assert.equal((await run(fake, event, changed)).status, 'valid');
    assert.deepEqual(fake.writes(), []);
    assert.deepEqual(
        fake.calls
            .filter((call) => call.path.startsWith(`${base}/labels/`))
            .map((call) => decodeURIComponent(call.path.slice(`${base}/labels/`.length))),
        ['template: bug-report', 'template: proposal', 'template: invalid'],
    );
});
