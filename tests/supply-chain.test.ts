import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { checkSecurity } from '../tooling/check-security.ts';
import {
    assessAudit,
    evaluateFindings,
    readLockInventory,
    validateExceptions,
    validateSignatures,
} from '../tooling/security/audit-policy.ts';
import {
    fingerprintInputs,
    INSTALL_POLICY,
    validateInstallPolicy,
    verifyInstalledTree,
} from '../tooling/security/security-evidence.ts';

function required<T>(value: T | undefined): T {
    assert.notEqual(value, undefined);
    assert.ok(value !== undefined);
    return value;
}
type AuditFixture = {
    advisories: Record<
        number,
        {
            findings: { version: string; paths: string[]; dev: boolean; optional: boolean; bundled: boolean }[];
            id: number;
            title: string;
            module_name: string;
            vulnerable_versions: string;
            patched_versions: null;
            severity: string;
            github_advisory_id: string;
            url: string;
        }
    >;
    metadata: {
        vulnerabilities: Record<string, number>;
        dependencies: number;
        devDependencies: number;
        optionalDependencies: number;
        totalDependencies: number;
    };
};

const lock = `---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm: {specifier: 12.4.2, version: 12.4.2}
packages:
  pnpm@12.4.2:
    resolution: {integrity: sha512-dG9vbA==}
snapshots:
  pnpm@12.4.2: {}
---
lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      ws: {specifier: 8.22.0, version: 8.22.0}
packages:
  ws@8.22.0:
    resolution: {integrity: sha512-d3M=}
  helper@1.0.0:
    resolution: {integrity: sha512-aGVscGVy}
snapshots:
  ws@8.22.0:
    optionalDependencies: {helper: 1.0.0}
  helper@1.0.0: {optional: true}
`;
const inventory = [
    { name: 'helper', version: '1.0.0', integrity: 'sha512-aGVscGVy' },
    { name: 'pnpm', version: '12.4.2', integrity: 'sha512-dG9vbA==' },
    { name: 'ws', version: '8.22.0', integrity: 'sha512-d3M=' },
];
const ghsa = 'GHSA-35jh-r3h4-6jhm';
const now = new Date('2026-09-30T00:00:00.000Z');
const fingerprints = { code: 'a'.repeat(64), configuration: 'b'.repeat(64), dependencies: 'c'.repeat(64) };
function audit(severity = 'high', version = '8.22.0', count = 3): AuditFixture {
    return {
        advisories: {
            1: {
                findings: [{ version, paths: ['.>ws'], dev: true, optional: false, bundled: false }],
                id: 1,
                title: 'Controlled vulnerability',
                module_name: 'ws',
                vulnerable_versions: '<9',
                patched_versions: null,
                severity,
                github_advisory_id: ghsa,
                url: `https://github.com/advisories/${ghsa}`,
            },
        },
        metadata: {
            vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, [severity]: 1 },
            dependencies: 1,
            devDependencies: count - 2,
            optionalDependencies: 1,
            totalDependencies: count,
        },
    };
}
function waiver() {
    return {
        ghsa,
        package: 'ws',
        version: '8.22.0',
        scope: 'repository',
        reason: 'The affected API is not used in the reviewed application.',
        triggerConditions: 'Untrusted data passed to the affected API.',
        evidence: ['src/adapters/cdp-router.ts'],
        reviewedBy: 'Security reviewer',
        reviewedAt: '2026-09-29T00:00:00.000Z',
        expiresAt: '2026-10-10T00:00:00.000Z',
        fingerprints,
    };
}
function findings(severity = 'high') {
    return assessAudit({ stdout: JSON.stringify(audit(severity)), exitCode: 1 }, inventory);
}

async function lockProject() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-preflight-'));
    execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
    await mkdir(path.join(root, 'docs/policies'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src/evidence.ts'), 'export const safe = true;\n');
    await writeFile(path.join(root, 'docs/policies/security-exceptions.json'), '{"schemaVersion":1,"exceptions":[]}');
    await writeFile(path.join(root, 'package.json'), '{"devDependencies":{"ws":"8.22.0"}}');
    await writeFile(path.join(root, 'pnpm-lock.yaml'), lock);
    await writeFile(
        path.join(root, 'pnpm-workspace.yaml'),
        stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
    );
    return root;
}

test('lockfile preflight audits all dependencies without an installed tree or upstream resolution', async () => {
    const root = await lockProject();
    const calls: string[][] = [];
    try {
        const before = await readFile(path.join(root, 'pnpm-lock.yaml'));
        const result = await checkSecurity(root, {
            phase: 'lockfile',
            now,
            async execute(args, { cwd }) {
                assert.equal(cwd, root);
                assert.equal(args.includes('--ignore-pnpmfile'), true);
                assert.equal(args.includes('--config.configDependencies={}'), true);
                calls.push(args);
                if (args[0] === 'config')
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
                    };
                if (args[0] === 'install') {
                    assert.equal(args.includes('--lockfile-only'), true);
                    assert.equal(args.includes('--frozen-lockfile'), true);
                    assert.equal(args.includes('--ignore-scripts'), true);
                    return { exitCode: 0, stdout: '' };
                }
                if (args.includes('signatures'))
                    return { exitCode: 0, stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}' };
                return { exitCode: 1, stdout: JSON.stringify(audit('moderate')) };
            },
        });
        assert.equal(result.ok, true);
        assert.deepEqual(Object.keys(result.scopes), ['repository']);
        assert.deepEqual(
            calls.map((args) => args[0]),
            ['config', 'install', 'audit', 'audit'],
        );
        assert.equal(result.scopes.repository.reported[0]?.severity, 'moderate');
        assert.deepEqual(before, await readFile(path.join(root, 'pnpm-lock.yaml')));
        await assert.rejects(access(path.join(root, 'node_modules')), /ENOENT/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('preflight rejects manifest mismatches before executing pnpm', async () => {
    const root = await lockProject();
    let calls = 0;
    try {
        await writeFile(path.join(root, 'package.json'), '{"devDependencies":{"ws":"8.21.0"}}');
        await assert.rejects(
            checkSecurity(root, {
                phase: 'lockfile',
                execute: async () => {
                    calls++;
                    throw new Error('must not execute');
                },
            }),
            /importer|declaration|manifest/i,
        );
        assert.equal(calls, 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('preflight rejects executable configuration dependencies before any pnpm command', async () => {
    for (const location of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
        const root = await lockProject();
        let calls = 0;
        try {
            if (location === 'pnpm-lock.yaml') {
                await writeFile(
                    path.join(root, location),
                    lock.replace(
                        'packageManagerDependencies:',
                        'configDependencies: {plugin: 1.0.0}\n    packageManagerDependencies:',
                    ),
                );
            } else {
                await writeFile(
                    path.join(root, location),
                    stringify({ ...INSTALL_POLICY, configDependencies: { plugin: '1.0.0' } }),
                );
            }
            await assert.rejects(
                checkSecurity(root, {
                    phase: 'lockfile',
                    execute: async () => {
                        calls++;
                        throw new Error('must not execute');
                    },
                }),
                /configuration dependencies/i,
            );
            assert.equal(calls, 0);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});

test('lock-only validation cannot create an installation tree or mutate locked inputs', async () => {
    for (const change of ['node_modules', 'pnpm-lock.yaml', 'package.json']) {
        const root = await lockProject();
        try {
            await assert.rejects(
                checkSecurity(root, {
                    phase: 'lockfile',
                    async execute(args) {
                        if (args[0] === 'config')
                            return {
                                exitCode: 0,
                                stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
                            };
                        assert.equal(args[0], 'install');
                        if (change === 'node_modules') await mkdir(path.join(root, change));
                        else await writeFile(path.join(root, change), '{}');
                        return { exitCode: 0, stdout: '' };
                    },
                }),
                /changed|created|installation/i,
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }
});

test('lock inventory reads every YAML document including package-manager and optional dependencies', () => {
    assert.deepEqual(readLockInventory(lock).packages, inventory);
    for (const source of [
        '',
        '---\nimporters: {}\n',
        `${lock}\npackages: [`,
        lock.replace('ws@8.22.0:', 'ws@latest:'),
    ]) {
        assert.throws(() => readLockInventory(source));
    }
});

test('scoped and nested peer annotations do not corrupt the dependency identity', () => {
    const source = lock.replace(
        '  ws@8.22.0:\n    optionalDependencies:',
        '  ws@8.22.0(@types/node@24.13.0)(nested@1.0.0(other@2.0.0)):\n    optionalDependencies:',
    );
    assert.deepEqual(readLockInventory(source).packages, inventory);
});

for (const version of ['01.2.3', '1.2.3-01', '1.2.3-alpha..1', '1.2.3+build..1']) {
    test(`lock inventory rejects malformed SemVer ${version}`, () => {
        assert.throws(() => readLockInventory(lock.replaceAll('8.22.0', version)), /Non-registry or unpinned/);
    });
    test(`review exceptions reject malformed SemVer ${version}`, () => {
        assert.throws(
            () => validateExceptions({ schemaVersion: 1, exceptions: [{ ...waiver(), version }] }, now),
            /exact GHSA, package, version and scope/,
        );
    });
}

test('security identities preserve arbitrary legal prerelease and build versions', () => {
    for (const version of ['1.2.3-any-Channel.42+Build.001', '1.2.3+Build.001', '1.2.3-900719925474099200000']) {
        assert.deepEqual(readLockInventory(lock.replaceAll('8.22.0', version)).packages, [
            inventory[0],
            inventory[1],
            { name: 'ws', version, integrity: 'sha512-d3M=' },
        ]);
        const exceptions = validateExceptions({ schemaVersion: 1, exceptions: [{ ...waiver(), version }] }, now);
        assert.equal(exceptions[0]?.version, version);
    }
});

test('audit blocks high and critical dependencies but retains lower-severity reports', () => {
    for (const severity of ['high', 'critical', 'moderate', 'low', 'info']) {
        const result = evaluateFindings(findings(severity), [], { repository: fingerprints });
        assert.equal(result.blocked.length, ['high', 'critical'].includes(severity) ? 1 : 0);
        assert.equal(result.reported.length, 1);
        assert.equal(result.reported[0]?.scope, 'repository');
    }
});

test('an audit with no advisories still must cover the entire lock inventory', () => {
    const report = audit();
    report.advisories = {};
    report.metadata.vulnerabilities.high = 0;
    assert.deepEqual(assessAudit({ stdout: JSON.stringify(report), exitCode: 0 }, inventory), []);
    report.metadata.totalDependencies = 0;
    assert.throws(() => assessAudit({ stdout: JSON.stringify(report), exitCode: 0 }, inventory), /inventory|coverage/i);
});

test('audit failures, unknown identities, severity mismatches and filtered reports fail closed', () => {
    for (const result of [
        { stdout: '{', exitCode: 1 },
        { stdout: JSON.stringify({ error: { code: 'ENETUNREACH' } }), exitCode: 1 },
        { stdout: JSON.stringify(audit()), exitCode: 2 },
        { stdout: JSON.stringify(audit('high', '8.21.0')), exitCode: 1 },
        { stdout: JSON.stringify({ ...audit(), advisories: {} }), exitCode: 1 },
        { stdout: JSON.stringify({ ...audit(), ignored: ['hidden'] }), exitCode: 1 },
    ])
        assert.throws(() => assessAudit(result, inventory));
    const report = audit();
    required(report.advisories[1]).severity = 'unknown';
    assert.throws(() => assessAudit({ stdout: JSON.stringify(report), exitCode: 1 }, inventory));
});

test('signature checks reject zero coverage, missing or invalid signatures and command failures', () => {
    assert.doesNotThrow(() =>
        validateSignatures({ stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}', exitCode: 0 }, 3),
    );
    for (const report of [
        { audited: 0, verified: 0, invalid: [], missing: [] },
        { audited: 3, verified: 2, invalid: [], missing: ['ws'] },
        { audited: 3, verified: 2, invalid: ['ws'], missing: [] },
        { audited: 3, verified: 3 },
    ])
        assert.throws(() => validateSignatures({ stdout: JSON.stringify(report), exitCode: 0 }, 3));
    assert.throws(() => validateSignatures({ stdout: '{}', exitCode: 1 }, 3));
});

test('an exact reviewed waiver releases only its matching advisory, scope, version and evidence', () => {
    const exceptions = validateExceptions({ schemaVersion: 1, exceptions: [waiver()] }, now);
    const result = evaluateFindings(findings(), exceptions, { repository: fingerprints });
    assert.equal(result.blocked.length, 0);
    assert.equal(result.waived.length, 1);
    const first = findings()[0];
    assert.ok(first);
    const other = [{ ...first, version: '8.21.0' }];
    assert.equal(evaluateFindings(other, exceptions, { repository: fingerprints }).blocked.length, 1);
    assert.throws(
        () => validateExceptions({ schemaVersion: 1, exceptions: [{ ...waiver(), scope: 'upstream' }] }, now),
        /scope|exception/i,
    );
    assert.throws(
        () => evaluateFindings(findings(), exceptions, { repository: { ...fingerprints, code: 'd'.repeat(64) } }),
        /fingerprint/i,
    );
});

test('waivers reject expired, future, wildcard, duplicated, incomplete or more-than-30-day reviews', () => {
    for (const replacement of [
        { expiresAt: '2026-09-30T00:00:00.000Z' },
        { reviewedAt: '2026-10-01T00:00:00.000Z' },
        { expiresAt: '2026-11-01T00:00:00.000Z' },
        { reviewedAt: '2026-02-30T00:00:00.000Z' },
        { version: '*' },
        { version: '^8.22.0' },
        { package: null },
        { evidence: [] },
        { reviewedBy: '' },
        { scope: 'all' },
        { fingerprints: { ...fingerprints, code: 'unknown' } },
    ])
        assert.throws(() =>
            validateExceptions({ schemaVersion: 1, exceptions: [{ ...waiver(), ...replacement }] }, now),
        );
    assert.throws(() => validateExceptions({ schemaVersion: 1, exceptions: [waiver(), waiver()] }, now));
});

test('installation policy has no cooldown exemptions, ignored advisories or trust bypass', () => {
    const safe = {
        minimumReleaseAge: 1440,
        minimumReleaseAgeStrict: true,
        minimumReleaseAgeIgnoreMissingTime: false,
        trustLockfile: false,
        trustPolicy: 'no-downgrade',
        blockExoticSubdeps: true,
        strictDepBuilds: true,
        allowBuilds: { 'esbuild@0.28.2': true },
    };
    assert.doesNotThrow(() => validateInstallPolicy(safe));
    for (const changed of [
        { minimumReleaseAge: 0 },
        { trustLockfile: true },
        { trustPolicy: 'off' },
        { minimumReleaseAgeExclude: ['skills@1.6.0'] },
        { auditConfig: { ignoreGhsas: [ghsa] } },
        { audit: { ignore: [ghsa] } },
        { audit: { level: 'high' } },
        { ignoreUnfixable: true },
        { optional: false },
        { ignoredOptionalDependencies: ['helper'] },
        { allowBuilds: { '*': true } },
        { onlyBuiltDependencies: ['anything'] },
        { configDependencies: { plugin: '1.0.0' } },
    ]) {
        assert.throws(() => validateInstallPolicy({ ...safe, ...changed }));
    }
});

test('installed tree evidence includes development and optional dependencies, not just roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dct-inventory-'));
    try {
        await mkdir(path.join(root, 'node_modules/.pnpm'), { recursive: true });
        await writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { ws: '8.22.0' } }));
        const modules = { included: { dependencies: true, devDependencies: true, optionalDependencies: true } };
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await writeFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), required(lock.split('---')[2]));
        await verifyInstalledTree(root, readLockInventory(lock));
        modules.included.devDependencies = false;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await assert.rejects(verifyInstalledTree(root, readLockInventory(lock)), /installed|included/i);
        modules.included.devDependencies = true;
        await writeFile(path.join(root, 'node_modules/.modules.yaml'), JSON.stringify(modules));
        await writeFile(
            path.join(root, 'node_modules/.pnpm/lock.yaml'),
            required(lock.split('---')[2]).replaceAll('8.22.0', '8.21.0'),
        );
        await assert.rejects(verifyInstalledTree(root, readLockInventory(lock)), /installed|graph/i);
        const before = await fingerprintInputs(
            root,
            ['package.json'],
            ['node_modules/.modules.yaml'],
            readLockInventory(lock),
        );
        await writeFile(path.join(root, 'package.json'), '{}');
        const after = await fingerprintInputs(
            root,
            ['package.json'],
            ['node_modules/.modules.yaml'],
            readLockInventory(lock),
        );
        assert.notEqual(before.code, after.code);
        assert.equal(before.dependencies, after.dependencies);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('review exceptions do not fingerprint their own record and remain bound to independent evidence', async () => {
    const root = await lockProject();
    const execute: import('../tooling/security/security-runner.ts').PnpmExecutor = async (args) => {
        if (args[0] === 'config')
            return {
                exitCode: 0,
                stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
            };
        if (args[0] === 'install') return { exitCode: 0, stdout: '' };
        if (args.includes('signatures'))
            return { exitCode: 0, stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}' };
        return { exitCode: 1, stdout: JSON.stringify(audit('high')) };
    };
    try {
        const first = await checkSecurity(root, { phase: 'lockfile', now, execute });
        assert.equal(first.ok, false);
        await writeFile(
            path.join(root, 'docs/policies/security-exceptions.json'),
            JSON.stringify({
                schemaVersion: 1,
                exceptions: [
                    {
                        ...waiver(),
                        scope: 'repository',
                        evidence: ['src/evidence.ts'],
                        fingerprints: first.scopes.repository.fingerprints,
                    },
                ],
            }),
        );
        const reviewed = await checkSecurity(root, { phase: 'lockfile', now, execute });
        assert.equal(reviewed.ok, true);
        assert.equal(reviewed.scopes.repository.waived.length, 1);
        assert.deepEqual(reviewed.scopes.repository.fingerprints, first.scopes.repository.fingerprints);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

const round1YamlInputs = [
    'reviewExtension: !unreviewed text\n',
    '%TAG !e! tag:example.com,2026:\n---\nreviewExtension: !e!custom text\n',
    '%YAML 1.1\n---\n',
    'reviewExtension:\n    ? [complex, key]\n    : value\n',
    'reviewExtension: *missing\n',
    'reviewExtension:\n    true: value\n',
    'a: &a [one, two, three, four, five, six, seven, eight, nine, ten]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\n',
    'reviewExtension: one\nreviewExtension: two\n',
];
for (const location of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    test(`round1 preflight rejects unsafe ${location} YAML before any pnpm invocation`, async () => {
        for (const extension of round1YamlInputs) {
            const root = await lockProject();
            let calls = 0;
            try {
                const file = path.join(root, location);
                const original = await readFile(file, 'utf8');
                const candidate =
                    location === 'pnpm-lock.yaml' ? extension + original.replace(/^---\n/, '') : extension + original;
                await writeFile(file, candidate);
                await assert.rejects(
                    checkSecurity(root, {
                        phase: 'lockfile',
                        now,
                        execute: async () => {
                            calls++;
                            throw new Error('Unexpected pnpm invocation');
                        },
                    }),
                );
                assert.equal(calls, 0, `${location} ${extension}`);
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        }
    });
}
test('round1 preflight accepts all lock documents and YAML1.2 on key with safe aliases', async () => {
    const root = await lockProject();
    let calls = 0;
    try {
        const workspace = path.join(root, 'pnpm-workspace.yaml');
        await writeFile(workspace, `on: &setting true\nreviewAlias: *setting\n${await readFile(workspace, 'utf8')}`);
        const lockfile = path.join(root, 'pnpm-lock.yaml');
        await writeFile(lockfile, lock.replace('---\n', '%YAML 1.2\n---\n'));
        const result = await checkSecurity(root, {
            phase: 'lockfile',
            now,
            execute: async (args) => {
                calls++;
                if (args[0] === 'config')
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
                    };
                if (args[0] === 'install') return { exitCode: 0, stdout: '' };
                if (args.includes('signatures'))
                    return { exitCode: 0, stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}' };
                return { exitCode: 1, stdout: JSON.stringify(audit('moderate')) };
            },
        });
        assert.equal(result.ok, true);
        assert.equal(calls, 4);
        assert.equal(readLockInventory(await readFile(lockfile, 'utf8')).documents.length, 2);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('round1 workspace rejects multiple documents before any pnpm invocation', async () => {
    const root = await lockProject();
    let calls = 0;
    try {
        const file = path.join(root, 'pnpm-workspace.yaml');
        await writeFile(file, `${await readFile(file, 'utf8')}---\non: true\n`);
        await assert.rejects(
            checkSecurity(root, {
                phase: 'lockfile',
                now,
                execute: async () => {
                    calls++;
                    throw new Error('Unexpected pnpm invocation');
                },
            }),
        );
        assert.equal(calls, 0);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('Issue chooser is fingerprinted only at its exact approved YAML exception path', async () => {
    const root = await lockProject();
    const execute: import('../tooling/security/security-runner.ts').PnpmExecutor = async (args) => {
        if (args[0] === 'config')
            return {
                exitCode: 0,
                stdout: JSON.stringify({ ...INSTALL_POLICY, allowBuilds: { 'esbuild@0.28.2': true } }),
            };
        if (args[0] === 'install') return { exitCode: 0, stdout: '' };
        if (args.includes('signatures'))
            return { exitCode: 0, stdout: '{"audited":3,"verified":3,"invalid":[],"missing":[]}' };
        return { exitCode: 1, stdout: JSON.stringify(audit('moderate')) };
    };
    try {
        await mkdir(path.join(root, '.github/ISSUE_TEMPLATE'), { recursive: true });
        const chooser = path.join(root, '.github/ISSUE_TEMPLATE/config.yml');
        await writeFile(chooser, 'blank_issues_enabled: true\n');
        const first = await checkSecurity(root, { phase: 'lockfile', now, execute });
        await writeFile(chooser, 'blank_issues_enabled: false\n');
        const changed = await checkSecurity(root, { phase: 'lockfile', now, execute });
        assert.notEqual(
            first.scopes.repository.fingerprints.configuration,
            changed.scopes.repository.fingerprints.configuration,
        );
        assert.equal(first.scopes.repository.fingerprints.code, changed.scopes.repository.fingerprints.code);
        await writeFile(path.join(root, '.github/config.yml'), 'unapproved: one\n');
        const wrong = await checkSecurity(root, { phase: 'lockfile', now, execute });
        assert.equal(
            changed.scopes.repository.fingerprints.configuration,
            wrong.scopes.repository.fingerprints.configuration,
        );
        await mkdir(path.join(root, '.github/workflows'), { recursive: true });
        const release = path.join(root, '.github/workflows/release.yaml');
        await writeFile(release, 'name: Release\npermissions:\n  contents: read\n');
        const releaseBefore = await checkSecurity(root, { phase: 'lockfile', now, execute });
        await writeFile(release, 'name: Release\npermissions:\n  contents: write\n');
        const releaseAfter = await checkSecurity(root, { phase: 'lockfile', now, execute });
        assert.notEqual(
            releaseBefore.scopes.repository.fingerprints.configuration,
            releaseAfter.scopes.repository.fingerprints.configuration,
        );
        assert.equal(
            releaseBefore.scopes.repository.fingerprints.code,
            releaseAfter.scopes.repository.fingerprints.code,
        );
        assert.equal(
            releaseBefore.scopes.repository.fingerprints.dependencies,
            releaseAfter.scopes.repository.fingerprints.dependencies,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
