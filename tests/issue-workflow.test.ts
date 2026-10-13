import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { isRecord } from '../tooling/errors.ts';

const file = new URL('../.github/workflows/issues.yaml', import.meta.url);
function workflow() {
    assert.ok(existsSync(file), 'remote Issue feedback workflow must exist');
    const value: unknown = parse(readFileSync(file, 'utf8'));
    assert.ok(isRecord(value));
    assert.ok(isRecord(value.on) && isRecord(value.on.issues));
    assert.ok(isRecord(value.jobs));
    return value;
}
function steps(job: unknown): Record<string, unknown>[] {
    assert.ok(isRecord(job) && Array.isArray(job.steps));
    return job.steps.map((step: unknown) => {
        assert.ok(isRecord(step));
        return step;
    });
}

test('Issue workflow queues body and classification changes and excludes diagnostic-label recursion', () => {
    const value = workflow();
    assert.deepEqual(value.on, { issues: { types: ['opened', 'edited', 'reopened', 'labeled', 'unlabeled'] } });
    assert.deepEqual(value.permissions, { contents: 'read' });
    assert.deepEqual(value.concurrency, {
        group: `issues-\${{ github.repository }}-\${{ github.event.issue.number }}`,
        'cancel-in-progress': false,
    });
    assert.ok(isRecord(value.jobs));
    assert.deepEqual(Object.keys(value.jobs), ['supply-chain-security', 'issue-feedback']);
    const security = value.jobs['supply-chain-security'];
    const feedback = value.jobs['issue-feedback'];
    assert.ok(isRecord(security) && isRecord(feedback));
    assert.equal(security.name, 'Issue supply chain security');
    assert.equal(feedback.name, 'Issue form validation');
    assert.equal(
        security.if,
        "github.event.action != 'labeled' && github.event.action != 'unlabeled' || github.event.label.name != 'template: invalid'",
    );
    assert.equal(feedback.needs, 'supply-chain-security');
    assert.deepEqual(feedback.permissions, { contents: 'read', issues: 'write' });
    assert.equal(security.permissions, undefined);
    assert.equal(security['continue-on-error'], undefined);
    assert.equal(feedback['continue-on-error'], undefined);
});

test('both Issue jobs execute the same trusted SHA with pinned reviewed Actions and toolchain', () => {
    const value = workflow();
    assert.ok(isRecord(value.jobs));
    const approved = new Set([
        'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
        'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
    ]);
    for (const job of Object.values(value.jobs)) {
        const all = steps(job);
        assert.ok(isRecord(job));
        assert.equal(job['runs-on'], 'ubuntu-latest');
        assert.deepEqual(job.env, { PNPM_CONFIG_IGNORE_PNPMFILE: 'true', PNPM_CONFIG_CONFIG_DEPENDENCIES: '{}' });
        for (const step of all) {
            assert.equal(step['continue-on-error'], undefined);
            if (step.uses !== undefined) {
                assert.equal(typeof step.uses, 'string');
                assert.ok(approved.has(String(step.uses)));
            }
        }
        assert.deepEqual(all.find((step) => String(step.uses).startsWith('actions/checkout@'))?.with, {
            ref: `\${{ github.sha }}`,
            'persist-credentials': false,
        });
        assert.deepEqual(all.find((step) => String(step.uses).startsWith('pnpm/action-setup@'))?.with, {
            version: '12.4.2',
        });
        assert.deepEqual(all.find((step) => String(step.uses).startsWith('actions/setup-node@'))?.with, {
            'node-version': '24.21.0',
            cache: 'pnpm',
        });
        assert.ok(
            all.every((step) => typeof step.run !== 'string' || !step.run.includes('${{')),
            'event values must not execute through shell interpolation',
        );
    }
});

test('read-only supply-chain gate precedes disabled-script install and writer binds token only to publisher', () => {
    const value = workflow();
    assert.ok(isRecord(value.jobs));
    const gate = steps(value.jobs['supply-chain-security']);
    const publisher = steps(value.jobs['issue-feedback']);
    const commands = gate.flatMap((step) => (typeof step.run === 'string' ? [step.run] : []));
    assert.deepEqual(commands, [
        'node tooling/security/dist/check-security.mjs --phase lockfile --root .',
        'pnpm install --frozen-lockfile --ignore-scripts',
        'pnpm check:security',
        'pnpm check:security:build',
    ]);
    assert.ok(gate.every((step) => step.env === undefined));
    const runs = publisher.flatMap((step) => (typeof step.run === 'string' ? [step.run] : []));
    assert.deepEqual(runs, ['pnpm install --frozen-lockfile --ignore-scripts', 'node tooling/issue-feedback.ts']);
    assert.deepEqual(publisher.at(-1)?.env, { GH_TOKEN: `\${{ github.token }}` });
    assert.ok(publisher.slice(0, -1).every((step) => step.env === undefined));
    assert.ok(
        publisher.every((step) => step.if === undefined),
        'invalid validation must not skip a separate feedback step',
    );
});
