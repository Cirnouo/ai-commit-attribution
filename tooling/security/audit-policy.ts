import { parseAllDocuments } from 'yaml';
import { isSemVer } from '../version-policy.ts';

export type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';
export type AuditScope = 'repository';
export interface PackageIdentity {
    name: string;
    version: string;
    integrity: string;
}
export interface LockReference {
    specifier?: string;
    version: string;
}
export interface LockImporter {
    configDependencies?: unknown;
    dependencies?: Record<string, LockReference>;
    devDependencies?: Record<string, LockReference>;
    optionalDependencies?: Record<string, LockReference>;
    packageManagerDependencies?: Record<string, LockReference>;
}
export interface LockDocument {
    lockfileVersion: string;
    configDependencies?: unknown;
    importers: Record<string, LockImporter>;
    packages: Record<string, { resolution: { integrity: string; tarball?: string } }>;
    snapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
}
export interface LockInventory {
    packages: PackageIdentity[];
    documents: LockDocument[];
}
export interface AuditCommandResult {
    exitCode: number;
    stdout: string;
    stderr?: string;
}
export interface Finding {
    ghsa: string;
    package: string;
    version: string;
    severity: Severity;
    title: string;
}
export interface Fingerprints {
    code: string;
    configuration: string;
    dependencies: string;
}
export interface ReviewException {
    ghsa: string;
    package: string;
    version: string;
    scope: AuditScope;
    reason: string;
    triggerConditions: string;
    evidence: string[];
    reviewedBy: string;
    reviewedAt: string;
    expiresAt: string;
    fingerprints: Fingerprints;
}
export type ScopedFinding = Finding & { scope: AuditScope };
export interface FindingDecision {
    blocked: ScopedFinding[];
    waived: ScopedFinding[];
    reported: ScopedFinding[];
}
const SEVERITIES: Severity[] = ['info', 'low', 'moderate', 'high', 'critical'];
const SCOPES = ['repository'];
const PACKAGE = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/;
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const MAX_REVIEW_MS = 30 * 24 * 60 * 60 * 1000;

function demand(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: unknown, expected: readonly string[], context: string): asserts value is Record<string, unknown> {
    demand(
        object(value) && Object.keys(value).sort().join() === [...expected].sort().join(),
        `Invalid ${context} fields.`,
    );
}
function nonempty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
function identity(key: string) {
    const match = /^((?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)@([^()]+)(?:\(.*\))?$/.exec(key);
    demand(
        match?.[1] && match[2] && PACKAGE.test(match[1]) && isSemVer(match[2]),
        `Non-registry or unpinned dependency: ${key}`,
    );
    return { name: match[1], version: match[2] };
}

export function validateConfigurationDependencies(value: unknown) {
    demand(
        value === undefined || (object(value) && Object.keys(value).length === 0),
        'Unreviewed configuration dependencies are prohibited.',
    );
}

export function readLockInventory(source: string): LockInventory {
    const parsed = parseAllDocuments(source);
    demand(parsed.length > 0 && parsed.every((doc) => doc.errors.length === 0), 'Malformed lockfile YAML.');
    const values: unknown[] = parsed.map((doc) => doc.toJS() as unknown);
    const documents: LockDocument[] = [];
    const all = new Map<string, PackageIdentity>();
    for (const doc of values) {
        demand(
            object(doc) &&
                doc.lockfileVersion === '9.0' &&
                object(doc.importers) &&
                object(doc.importers['.']) &&
                object(doc.packages) &&
                object(doc.snapshots),
            'Incomplete lockfile inventory.',
        );
        validateConfigurationDependencies(doc.configDependencies);
        const packageKeys = new Set();
        for (const [key, value] of Object.entries(doc.packages)) {
            const { name, version } = identity(key);
            demand(object(value) && object(value.resolution), `Invalid resolution: ${key}`);
            const integrity = value.resolution.integrity;
            demand(
                nonempty(integrity) && /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity),
                `Missing registry integrity: ${key}`,
            );
            demand(
                !value.resolution.tarball ||
                    (typeof value.resolution.tarball === 'string' &&
                        value.resolution.tarball.startsWith('https://registry.npmjs.org/')),
                `Non-standard dependency source: ${key}`,
            );
            const previous = all.get(`${name}@${version}`);
            demand(!previous || previous.integrity === integrity, `Conflicting dependency integrity: ${key}`);
            all.set(`${name}@${version}`, { name, version, integrity });
            packageKeys.add(`${name}@${version}`);
        }
        const snapshotKeys = new Set(
            Object.keys(doc.snapshots).map((key) => {
                const item = identity(key);
                const plain = `${item.name}@${item.version}`;
                demand(packageKeys.has(plain), `Snapshot missing from inventory: ${key}`);
                return plain;
            }),
        );
        demand(snapshotKeys.size === packageKeys.size, 'Lockfile graph omits packages.');
        for (const snapshot of Object.values(doc.snapshots)) {
            demand(object(snapshot), 'Invalid dependency snapshot.');
            for (const field of ['dependencies', 'optionalDependencies']) {
                const dependencies = snapshot[field] ?? {};
                demand(object(dependencies), 'Invalid snapshot dependencies.');
                for (const [name, version] of Object.entries(dependencies)) {
                    demand(typeof version === 'string', 'Invalid dependency version.');
                    const item = identity(`${name}@${version}`);
                    demand(
                        packageKeys.has(`${item.name}@${item.version}`),
                        `Graph references missing dependency: ${name}@${version}`,
                    );
                }
            }
        }
        for (const importer of Object.values(doc.importers)) {
            demand(object(importer), 'Invalid lock importer.');
            validateConfigurationDependencies(importer.configDependencies);
            for (const field of [
                'dependencies',
                'devDependencies',
                'optionalDependencies',
                'packageManagerDependencies',
            ]) {
                const dependencies = importer[field] ?? {};
                demand(object(dependencies), 'Invalid importer dependencies.');
                for (const [name, value] of Object.entries(dependencies)) {
                    demand(
                        object(value) &&
                            typeof value.version === 'string' &&
                            (value.specifier === undefined || typeof value.specifier === 'string'),
                        'Invalid importer reference.',
                    );
                    const item = identity(`${name}@${value.version}`);
                    demand(
                        packageKeys.has(`${item.name}@${item.version}`),
                        `Importer references missing dependency: ${name}`,
                    );
                }
            }
        }
        // All nested lock identities and references were checked above.
        documents.push({
            ...doc,
            lockfileVersion: '9.0',
            importers: doc.importers as Record<string, LockImporter>,
            packages: doc.packages as LockDocument['packages'],
            snapshots: doc.snapshots as LockDocument['snapshots'],
        });
    }
    demand(all.size > 0, 'Empty dependency inventory.');
    return {
        packages: [...all.values()].sort((a, b) =>
            `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'),
        ),
        documents,
    };
}

function report(result: AuditCommandResult, allowedExitCodes: number[]) {
    demand(
        allowedExitCodes.includes(result.exitCode),
        `Audit command failed (exit ${result.exitCode}): ${result.stderr ?? ''}`,
    );
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        throw new Error('Malformed audit JSON report.');
    }
    demand(
        object(parsed) && !parsed.error && !parsed.errors && !parsed.ignored,
        'Audit failed or report contains ignored findings.',
    );
    return parsed;
}

export function assessAudit(result: AuditCommandResult, inventory: PackageIdentity[]): Finding[] {
    const data = report(result, [0, 1]);
    keys(data, ['advisories', 'metadata'], 'audit report');
    demand(object(data.advisories) && object(data.metadata), 'Invalid advisory report.');
    demand(
        inventory.length > 0 && data.metadata.totalDependencies === inventory.length,
        'Audit coverage differs from complete lock inventory.',
    );
    keys(data.metadata.vulnerabilities, SEVERITIES, 'vulnerability counts');
    const counts: Record<Severity, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    const findings = new Map<string, Finding>();
    for (const advisory of Object.values(data.advisories)) {
        demand(
            object(advisory) &&
                typeof advisory.severity === 'string' &&
                SEVERITIES.some((severity) => severity === advisory.severity) &&
                typeof advisory.module_name === 'string' &&
                typeof advisory.github_advisory_id === 'string' &&
                PACKAGE.test(advisory.module_name) &&
                GHSA.test(advisory.github_advisory_id) &&
                nonempty(advisory.title),
            'Invalid advisory identity or severity.',
        );
        demand(Array.isArray(advisory.findings) && advisory.findings.length > 0, 'Advisory omits affected versions.');
        const severity = advisory.severity as Severity;
        counts[severity]++;
        for (const finding of advisory.findings as unknown[]) {
            demand(object(finding) && typeof finding.version === 'string', 'Invalid affected version.');
            demand(
                inventory.some((pkg) => pkg.name === advisory.module_name && pkg.version === finding.version),
                'Advisory version not in inventory.',
            );
            demand(
                Array.isArray(finding.paths) && finding.paths.length > 0 && finding.paths.every(nonempty),
                'Advisory omits dependency paths.',
            );
            const item: Finding = {
                ghsa: advisory.github_advisory_id,
                package: advisory.module_name,
                version: finding.version,
                severity,
                title: advisory.title,
            };
            const key = `${item.ghsa}:${item.package}:${item.version}`;
            demand(
                !findings.has(key) || findings.get(key)?.severity === item.severity,
                'Conflicting advisory severities.',
            );
            findings.set(key, item);
        }
    }
    for (const severity of SEVERITIES)
        demand(
            Number.isInteger(data.metadata.vulnerabilities[severity]) &&
                data.metadata.vulnerabilities[severity] === counts[severity],
            'Advisory severity counts do not match report.',
        );
    demand(
        result.exitCode === (Object.values(counts).some((count) => count > 0) ? 1 : 0),
        'Audit exit code conflicts with report.',
    );
    return [...findings.values()];
}

export function validateSignatures(result: AuditCommandResult, expectedCount: number) {
    const data = report(result, [0]);
    keys(data, ['audited', 'verified', 'invalid', 'missing'], 'signature report');
    demand(
        Number.isInteger(expectedCount) &&
            expectedCount > 0 &&
            data.audited === expectedCount &&
            data.verified === expectedCount,
        'Signature coverage differs from lock inventory.',
    );
    demand(
        Array.isArray(data.invalid) &&
            data.invalid.length === 0 &&
            Array.isArray(data.missing) &&
            data.missing.length === 0,
        'Missing or invalid registry signatures.',
    );
}

function utc(value: unknown) {
    demand(
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value),
        'Review dates must be UTC ISO timestamps.',
    );
    const date = new Date(value);
    demand(Number.isFinite(date.getTime()) && date.toISOString() === value, 'Invalid review date.');
    return date.getTime();
}
export function validateExceptions(data: unknown, now = new Date()): ReviewException[] {
    keys(data, ['schemaVersion', 'exceptions'], 'exception manifest');
    demand(data.schemaVersion === 1 && Array.isArray(data.exceptions), 'Invalid exception schema.');
    const seen = new Set();
    for (const item of data.exceptions as unknown[]) {
        keys(
            item,
            [
                'ghsa',
                'package',
                'version',
                'scope',
                'reason',
                'triggerConditions',
                'evidence',
                'reviewedBy',
                'reviewedAt',
                'expiresAt',
                'fingerprints',
            ],
            'exception',
        );
        demand(
            typeof item.ghsa === 'string' &&
                typeof item.version === 'string' &&
                typeof item.scope === 'string' &&
                GHSA.test(item.ghsa) &&
                typeof item.package === 'string' &&
                PACKAGE.test(item.package) &&
                isSemVer(item.version) &&
                SCOPES.includes(item.scope),
            'Exception needs an exact GHSA, package, version and scope.',
        );
        for (const field of ['reason', 'triggerConditions', 'reviewedBy'])
            demand(nonempty(item[field]), `Exception omits ${field}.`);
        demand(
            Array.isArray(item.evidence) &&
                item.evidence.length > 0 &&
                item.evidence.every(
                    (file: unknown) =>
                        nonempty(file) &&
                        !file.startsWith('/') &&
                        !file.includes('..') &&
                        !file.includes('\\') &&
                        !file.includes(':'),
                ),
            'Exception needs repository-relative evidence files.',
        );
        keys(item.fingerprints, ['code', 'configuration', 'dependencies'], 'fingerprint');
        demand(
            Object.values(item.fingerprints).every(
                (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
            ),
            'Invalid SHA-256 fingerprint.',
        );
        const reviewed = utc(item.reviewedAt);
        const expires = utc(item.expiresAt);
        demand(
            reviewed <= now.getTime() &&
                expires > now.getTime() &&
                expires > reviewed &&
                expires - reviewed <= MAX_REVIEW_MS,
            'Expired, future or over-30-day exception.',
        );
        const key = `${item.scope}:${item.ghsa}:${item.package}:${item.version}`;
        demand(!seen.has(key), 'Duplicate exception.');
        seen.add(key);
    }
    // Exact fields, identities, dates, evidence and fingerprints validated.
    return data.exceptions as ReviewException[];
}

export function evaluateFindings(
    findings: Finding[],
    exceptions: ReviewException[],
    contexts: Partial<Record<AuditScope, Fingerprints>>,
): FindingDecision {
    const scope = Object.keys(contexts)[0];
    demand(Object.keys(contexts).length === 1 && scope && SCOPES.includes(scope), 'Choose exactly one audit scope.');
    const checkedScope = scope as AuditScope;
    const context = contexts[checkedScope];
    demand(context, 'Missing audit context.');
    const result: FindingDecision = {
        blocked: [],
        waived: [],
        reported: findings.map((item) => ({ ...item, scope: checkedScope })),
    };
    for (const exception of exceptions.filter((item) => item.scope === scope)) {
        demand(
            (['code', 'configuration', 'dependencies'] as const).every(
                (key) => exception.fingerprints[key] === context[key],
            ),
            'Exception evidence fingerprint changed; review required.',
        );
    }
    for (const item of result.reported) {
        const waived = exceptions.some(
            (exception) =>
                exception.scope === scope &&
                exception.ghsa === item.ghsa &&
                exception.package === item.package &&
                exception.version === item.version,
        );
        if (waived) result.waived.push(item);
        else if (['high', 'critical'].includes(item.severity)) result.blocked.push(item);
    }
    return result;
}
