import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { isRecord } from '../tooling/errors.ts';
import { parseOwnedYaml } from '../tooling/owned-yaml.ts';

test('Release workflow queues new tag pushes behind same-commit CI with one minimal write job', () => {
    const file = new URL('../.github/workflows/release.yaml', import.meta.url);
    assert.ok(existsSync(file), 'tag publication workflow must exist');
    const [workflow] = parseOwnedYaml(readFileSync(file, 'utf8'), { name: 'release workflow', documents: 'single' });
    assert.ok(isRecord(workflow));
    assert.deepEqual(workflow.on, { push: { tags: ['v[0-9]+.[0-9]+.[0-9]+', 'v[0-9]+.[0-9]+.[0-9]+-*'] } });
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.deepEqual(workflow.concurrency, { group: `release-\${{ github.ref }}`, 'cancel-in-progress': false });
    assert.ok(isRecord(workflow.jobs));
    assert.deepEqual(Object.keys(workflow.jobs), ['verify', 'publish']);
    const { verify, publish } = workflow.jobs;
    assert.ok(isRecord(verify) && isRecord(publish));
    assert.equal(verify.if, 'github.event.created && !github.event.deleted && !github.event.forced');
    assert.equal(verify.uses, './.github/workflows/ci.yaml');
    assert.deepEqual(verify.permissions, { contents: 'read' });
    assert.equal(verify.secrets, undefined);
    assert.equal(publish.needs, 'verify');
    assert.equal(publish['runs-on'], 'ubuntu-latest');
    assert.deepEqual(publish.permissions, { contents: 'write' });
    assert.deepEqual(publish.env, { PNPM_CONFIG_IGNORE_PNPMFILE: 'true', PNPM_CONFIG_CONFIG_DEPENDENCIES: '{}' });
    assert.ok(Array.isArray(publish.steps));
    const steps = publish.steps.map((step: unknown) => {
        assert.ok(isRecord(step));
        return step;
    });
    assert.deepEqual(steps.map((step) => step.run).filter(Boolean), [
        'pnpm install --frozen-lockfile',
        'node tooling/release.ts',
    ]);
    assert.deepEqual(
        steps.filter((step) => step.uses).map((step) => step.uses),
        [
            'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
            'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
            'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        ],
    );
    assert.deepEqual(steps[0]?.with, { 'fetch-depth': 0, ref: `\${{ github.sha }}`, 'persist-credentials': false });
    assert.deepEqual(steps[1]?.with, { version: '12.4.2' });
    assert.deepEqual(steps[2]?.with, { 'node-version': '24.21.0', cache: 'pnpm' });
    assert.deepEqual(
        steps.filter((step) => step.env).map((step) => step.env),
        [{ GH_TOKEN: `\${{ github.token }}` }],
    );
    assert.equal(steps.at(-1)?.run, 'node tooling/release.ts');
    for (const item of [...Object.values(workflow.jobs), ...steps]) {
        assert.ok(isRecord(item));
        assert.equal(item['continue-on-error'], undefined);
        if (typeof item.if === 'string') assert.doesNotMatch(item.if, /always\s*\(/);
    }
});
