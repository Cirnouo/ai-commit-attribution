import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('maintained host registry distinguishes actual surfaces and explicit family ambiguities', async () => {
    const file = new URL('../packaging/agent-registry.json', import.meta.url);
    assert.ok(existsSync(file), 'PR4 must provide its researched production registry');
    const registry = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(registry.schemaVersion, 1);
    const names = registry.hosts.map((host: { name: string }) => host.name);
    for (const name of ['Codex CLI', 'Codex App', 'Codex IDE Extension', 'Pi CLI', 'oh-my-pi CLI'])
        assert.ok(names.includes(name), `Missing independently identified host ${name}`);
    const aliases = new Map<string, string>();
    for (const host of registry.hosts) {
        assert.equal(typeof host.host, 'string');
        assert.ok(host.officialProduct && host.sources.length);
        for (const alias of [host.name, ...host.aliases]) {
            assert.ok(!aliases.has(alias), `Ambiguous registered alias ${alias}`);
            assert.ok(!registry.ambiguousAliases.includes(alias));
            aliases.set(alias, host.name);
        }
    }
    assert.equal(aliases.get('pi CLI'), 'Pi CLI');
    assert.equal(aliases.get('omp CLI'), 'oh-my-pi CLI');
    for (const family of ['Codex', 'Copilot', 'Pi']) assert.ok(registry.ambiguousAliases.includes(family));
    for (const role of ['planner', 'reviewer', 'worker']) assert.ok(!aliases.has(role));
});
