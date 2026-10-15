import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as records from '../src/records.ts';

test('confirmed identity parsing rejects unsafe and placeholder inputs rather than inventing mappings', () => {
    const parse = Reflect.get(records, 'parseIdentity');
    assert.equal(typeof parse, 'function');
    for (const invalid of [
        null,
        {},
        { agent: 'Codex App' },
        { agent: 'Codex App', model: 'auto' },
        ...['latest', 'UNKNOWN', 'n/a', 'null'].map((model) => ({ agent: 'Codex App', model })),
        ...['unknown', 'off', 'N/A', 'null'].map((reasoning) => ({
            agent: 'Codex App',
            model: 'formal.model',
            reasoning,
        })),
        ...['\r', '\n', '\0', '\u0085', '\u2028', '\u2029'].map((control) => ({
            agent: 'Codex App',
            model: ` ${control}bad`,
        })),
        { agent: 'Codex App', model: 'formal.model', modelRoute: 'gateway/route' },
        { agent: 'Codex App', model: 'formal.model', evidence: [] },
        { agent: 'Codex App', model: 'formal model' },
        { agent: 'Bad:Agent', model: 'formal.model' },
        { agent: 'Codex App', model: 'formal.model', reasoning: 'high:extra' },
    ])
        assert.throws(() => parse(invalid));
    assert.deepEqual(parse({ agent: 'Codex App', model: 'Provider.Model-2026:0', reasoning: 'native-enabled' }), {
        agent: 'Codex App',
        model: 'Provider.Model-2026:0',
        reasoning: 'native-enabled',
    });
});

test('full identity keys distinguish absent effort, confirmed none and punctuation without collisions', () => {
    const key = Reflect.get(records, 'identityKey');
    assert.equal(typeof key, 'function');
    assert.equal(key({ agent: 'Codex App', model: 'Provider.Model:0' }), '["Codex App","Provider.Model:0",null]');
    assert.equal(
        key({ agent: 'Codex App', model: 'Provider.Model:0', reasoning: 'none' }),
        '["Codex App","Provider.Model:0","none"]',
    );
});

test('portable Operation shape remains readable after source directories disappear and never authorizes local scope', async () => {
    const parse = Reflect.get(records, 'parseOperationShape');
    assert.equal(typeof parse, 'function');
    const source = await realpath(await mkdtemp(path.join(os.tmpdir(), 'operation-history-')));
    const local = {
        schemaVersion: 1,
        id: 'historical',
        repository: source,
        worktree: source,
        commonGitDir: source,
        kind: 'commit',
        paths: [],
        targets: [],
    };
    const observed = await records.parseOperation(local);
    await rm(source, { recursive: true });
    assert.deepEqual(parse(observed), observed);
    await assert.rejects(records.parseOperation(observed), /physical/);
    const historical = {
        schemaVersion: 1,
        id: 'portable-operation',
        repository: 'Z:\\unavailable-source',
        worktree: 'Z:\\unavailable-source',
        commonGitDir: 'Z:\\unavailable-git',
        kind: 'commit',
        paths: [' b', 'a', 'a'],
        targets: [],
    };
    assert.deepEqual(parse(historical), { ...historical, paths: [' b', 'a'] });
    await assert.rejects(records.parseOperation(historical), /physical|scope/);
    assert.throws(() => parse({ ...historical, repository: ' ' }), /input/i);
    assert.throws(() => parse({ ...historical, paths: ['../escape'] }), /scope/);
});
