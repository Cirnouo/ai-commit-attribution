import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildScriptCheckPlan } from '../tooling/check-scripts.ts';
import { isRecord } from '../tooling/errors.ts';
import { auditRepository } from '../tooling/repository-audit.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
test('CI runs real gates in the trusted-install order and pins every action to a complete SHA', async () => {
    const ci: unknown = parse(await readFile(path.join(root, '.github/workflows/ci.yaml'), 'utf8'));
    assert.ok(isRecord(ci) && isRecord(ci.jobs) && isRecord(ci.on));
    assert.ok(
        isRecord(ci.on.pull_request) &&
            Array.isArray(ci.on.pull_request.types) &&
            ci.on.pull_request.types.includes('edited'),
    );
    assert.ok(isRecord(ci.permissions));
    assert.deepEqual(ci.permissions, { contents: 'read' });
    const jobs = ci.jobs;
    for (const job of Object.values(jobs)) {
        assert.ok(isRecord(job) && Array.isArray(job.steps));
        for (const step of job.steps) {
            assert.ok(isRecord(step));
            if (step.uses !== undefined) assert.match(String(step.uses), /^[\w./-]+@[a-f0-9]{40}$/);
        }
    }
    const security = jobs['supply-chain-security'];
    assert.ok(isRecord(security) && Array.isArray(security.steps));
    const commands = security.steps
        .filter(isRecord)
        .map((step) => step.run)
        .filter((value): value is string => typeof value === 'string');
    assert.deepEqual(commands, [
        'node tooling/security/dist/check-security.mjs --phase lockfile --root .',
        'pnpm install --frozen-lockfile --ignore-scripts',
        'pnpm check:security',
        'pnpm check:security:build',
    ]);
    for (const name of ['quality', 'commit-messages']) {
        assert.ok(isRecord(jobs[name]));
        assert.equal(jobs[name].needs, 'supply-chain-security');
    }
    for (const name of ['windows-tests', 'portable-tests', 'node-compatibility']) {
        assert.ok(isRecord(jobs[name]));
        assert.deepEqual(jobs[name].needs, ['quality', 'commit-messages']);
    }
    assert.ok(
        isRecord(jobs['portable-tests']) &&
            isRecord(jobs['portable-tests'].strategy) &&
            isRecord(jobs['portable-tests'].strategy.matrix),
    );
    assert.deepEqual(jobs['portable-tests'].strategy.matrix.os, ['ubuntu-latest', 'macos-latest']);
});
test('CodeQL analyzes maintained JavaScript/TypeScript and Actions with security-extended queries', async () => {
    const workflow: unknown = parse(await readFile(path.join(root, '.github/workflows/codeql.yaml'), 'utf8'));
    assert.ok(isRecord(workflow) && isRecord(workflow.jobs) && isRecord(workflow.jobs.analyze));
    const job = workflow.jobs.analyze;
    assert.ok(isRecord(job.strategy) && isRecord(job.strategy.matrix) && Array.isArray(job.strategy.matrix.include));
    assert.deepEqual(
        job.strategy.matrix.include.filter(isRecord).map((item) => item.language),
        ['javascript-typescript', 'actions'],
    );
    const config: unknown = parse(await readFile(path.join(root, '.github/codeql-config.yaml'), 'utf8'));
    assert.ok(isRecord(config));
    assert.deepEqual(config.queries, [{ uses: 'security-extended' }]);
    assert.deepEqual(config['paths-ignore'], ['skills/**', 'tooling/security/dist/**', '**/node_modules/**']);
});
test('root toolchain pins and native TypeScript syntax plan cover maintained files', async () => {
    const data: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    assert.ok(isRecord(data) && isRecord(data.devDependencies));
    for (const [name, version] of Object.entries({
        typescript: '7.0.2',
        esbuild: '0.28.2',
        '@biomejs/biome': '2.5.14',
        husky: '9.1.7',
        'lint-staged': '17.5.1',
        '@commitlint/cli': '21.2.2',
        yaml: '2.9.1',
        semver: '7.8.5',
        skills: '1.7.2',
    }))
        assert.equal(data.devDependencies[name], version);
    assert.ok(!Object.hasOwn(data.devDependencies, 'chrome-devtools-mcp'));
    assert.deepEqual(
        buildScriptCheckPlan({
            files: ['tooling/check-security.ts', 'tooling/security/dist/check-security.mjs'],
            platform: process.platform,
        }).map((step) => step.kind),
        ['typescript', 'node'],
    );
    const result = spawnSync(process.execPath, [path.join(root, 'tooling/check-scripts.ts')], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /TypeScript sources, 1 generated JavaScript/);
});
test('repository audit rejects duplicate keys, multiple owned YAML documents and invalid UTF8', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'attribution-repository-')));
    try {
        execFileSync('git', ['init', '--quiet', directory], { windowsHide: true });
        await mkdir(path.join(directory, '.github'));
        await writeFile(path.join(directory, '.github/bad.yaml'), 'name: one\nname: two\n');
        assert.ok(
            (await auditRepository(directory)).some((error) => /bad.yaml.*unique|bad.yaml.*Map keys/i.test(error)),
        );
        await writeFile(path.join(directory, '.github/bad.yaml'), 'name: one\n---\nname: two\n');
        assert.ok((await auditRepository(directory)).some((error) => /bad.yaml.*exactly one document/i.test(error)));
        await writeFile(path.join(directory, '.github/bad.yaml'), Buffer.from([0xff, 10]));
        assert.ok((await auditRepository(directory)).some((error) => /bad.yaml.*UTF.?8/i.test(error)));
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(await realpath(os.tmpdir())));
        await rm(directory, { recursive: true, force: true });
    }
});

test('owned YAML uses core YAML1.2 and bounded resolved aliases without custom tag extensions', async () => {
    const { validateTextStyle } = await import('../tooling/repository-audit.ts');
    for (const source of [
        'value: !unreviewed text\n',
        '%TAG !e! tag:example.com,2026:\n---\nvalue: !e!custom text\n',
        '%YAML 1.1\n---\non: true\n',
        'value: *missing\n',
    ])
        assert.ok(validateTextStyle('fixture.yaml', source).length > 0, source);
    assert.deepEqual(validateTextStyle('fixture.yaml', 'on: true\nvalue: &safe plain\ncopy: *safe\n'), []);
    const bomb = [
        'a: &a [one, two, three, four, five, six, seven, eight, nine, ten]',
        'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
        'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]',
    ]
        .concat('')
        .join('\n');
    assert.ok(validateTextStyle('fixture.yaml', bomb).length > 0);
});

test('round1 CodeQL includes actual maintained root configs and test sources', async () => {
    const config: unknown = parse(await readFile(path.join(root, '.github/codeql-config.yaml'), 'utf8'));
    assert.ok(isRecord(config));
    const include = config.paths;
    assert.ok(include === undefined || (Array.isArray(include) && include.every((value) => typeof value === 'string')));
    const maintained = execFileSync('git', ['ls-files', '--', '*.ts'], { cwd: root, encoding: 'utf8' })
        .trim()
        .split('\n');
    assert.ok(maintained.includes('commitlint.config.ts'));
    assert.ok(maintained.includes('tests/security-build.test.ts'));
    for (const file of maintained)
        assert.ok(
            include === undefined || include.some((prefix: string) => file === prefix || file.startsWith(`${prefix}/`)),
            `${file} must be eligible for CodeQL`,
        );
});

test('round1 shared YAML profile retains the on key and bounded value alias with single and all documents', async () => {
    const { parseOwnedYaml } = await import('../tooling/owned-yaml.ts');
    const values = parseOwnedYaml('on: &safe true\ncopy: *safe\n', { name: 'fixture', documents: 'single' });
    assert.deepEqual(values, [{ on: true, copy: true }]);
    assert.deepEqual(parseOwnedYaml('on: true\n---\non: false\n', { name: 'fixture', documents: 'all' }), [
        { on: true },
        { on: false },
    ]);
    assert.throws(
        () => parseOwnedYaml('on: true\n---\non: false\n', { name: 'fixture', documents: 'single' }),
        /exactly one/,
    );
});
