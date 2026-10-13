import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitHubReleaseRequest, GitHubApiError } from '../tooling/release.ts';

test('Release REST adapter binds the public origin, built-in token, API version and timeout', async (context) => {
    const calls: { url: string; options: RequestInit | undefined }[] = [];
    const timeouts: number[] = [];
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
        timeouts.push(milliseconds);
        return timeout(milliseconds);
    });
    const fetcher: typeof fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response('{"body":"generated"}');
    };
    const request = createGitHubReleaseRequest('fixture-token', fetcher);
    assert.deepEqual(await request('POST', '/repos/example/project/releases/generate-notes', { tag_name: 'v1.2.3' }), {
        body: 'generated',
    });
    assert.equal(calls[0]?.url, 'https://api.github.com/repos/example/project/releases/generate-notes');
    assert.deepEqual(calls[0]?.options?.headers, {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer fixture-token',
        'X-GitHub-Api-Version': '2026-03-10',
        'Content-Type': 'application/json',
    });
    assert.equal(calls[0]?.options?.body, '{"tag_name":"v1.2.3"}');
    assert.equal(calls[0]?.options?.redirect, 'error');
    assert.ok(calls[0]?.options?.signal instanceof AbortSignal);
    assert.equal(calls[0].options.signal.aborted, false);
    await request('GET', '/repos/example/project/releases/latest');
    assert.equal(calls[1]?.options?.body, undefined);
    assert.equal(new Headers(calls[1]?.options?.headers).get('content-type'), null);
    assert.deepEqual(timeouts, [30_000, 30_000]);
    assert.throws(() => createGitHubReleaseRequest('  '), /token/);
});

test('Release REST adapter rejects endpoint escapes before transport', async () => {
    let calls = 0;
    const request = createGitHubReleaseRequest('fixture-token', async () => {
        calls++;
        return new Response('{}');
    });
    for (const endpoint of [
        'https://evil.invalid/repos/x/y',
        '//evil.invalid/repos/x/y',
        '/users/me',
        '/repos/x/y#secret',
    ])
        await assert.rejects(request('GET', endpoint), /endpoint/);
    assert.equal(calls, 0);
});

test('Release REST distinguishes HTTP absence from errors without leaking response or token causes', async () => {
    for (const status of [404, 403, 429, 500, 503]) {
        const request = createGitHubReleaseRequest(
            'fixture-token',
            async () => new Response('fixture-token private error', { status }),
        );
        await assert.rejects(request('GET', '/repos/example/project/releases/latest'), (error: unknown) => {
            assert.ok(error instanceof GitHubApiError);
            assert.equal(error.status, status);
            assert.equal(error.cause, undefined);
            assert.doesNotMatch(error.message, /fixture-token|private/);
            return true;
        });
    }
    for (const fault of [
        new Error('redirect fixture-token'),
        new DOMException('timeout fixture-token', 'TimeoutError'),
    ]) {
        const request = createGitHubReleaseRequest('fixture-token', async () => {
            throw fault;
        });
        await assert.rejects(request('GET', '/repos/example/project/releases/latest'), (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /transport/);
            assert.doesNotMatch(error.message, /fixture-token/);
            assert.equal(error.cause, undefined);
            return true;
        });
    }
    const request = createGitHubReleaseRequest('fixture-token', async () => new Response('fixture-token not JSON'));
    await assert.rejects(request('GET', '/repos/example/project/releases/latest'), /malformed JSON/);
});
