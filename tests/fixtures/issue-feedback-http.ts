import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { isRecord } from '../../tooling/errors.ts';

// Subprocess-only HTTP boundary. No real network request can leave this fixture.
const fixturePath = process.env.ATTRIBUTION_ISSUE_HTTP_STATE;
assert.ok(fixturePath);
const fixture: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
assert.ok(isRecord(fixture) && isRecord(fixture.issue) && typeof fixture.transcript === 'string');
const current = fixture.issue;
const transcript = fixture.transcript;
const calls: { method: string; path: string }[] = [];
globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname });
    writeFileSync(transcript, JSON.stringify(calls), 'utf8');
    if (method === 'GET' && url.pathname.endsWith('/issues/7')) return Response.json(current);
    if (method === 'GET' && url.pathname.endsWith('/comments')) return Response.json([]);
    if (method === 'GET' && url.pathname.endsWith('/labels/template%3A%20invalid'))
        return Response.json({ name: 'template: invalid' });
    if (method === 'POST' && url.pathname.endsWith('/labels')) {
        assert.ok(Array.isArray(current.labels));
        current.labels.push({ name: 'template: invalid' });
        current.updated_at = '2026-10-06T01:00:01Z';
        return Response.json(current.labels);
    }
    if (method === 'POST' && url.pathname.endsWith('/comments')) {
        const requestBody = init?.body;
        assert.equal(typeof requestBody, 'string');
        const payload: unknown = JSON.parse(String(requestBody));
        assert.ok(isRecord(payload) && typeof payload.body === 'string');
        return Response.json(
            {
                id: 500,
                body: payload.body,
                issue_url: current.url,
                user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
            },
            { status: 201 },
        );
    }
    assert.fail('Unexpected Issue entry HTTP request.');
};
