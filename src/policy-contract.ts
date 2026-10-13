import path from 'node:path';
import { isRecord } from '../tooling/errors.ts';
import type { Operation } from './records.ts';
import { checkRaw, InputError, text, unique } from './records.ts';

export const LIMITS = Object.freeze({
    profile: 'policy-scan-v1' as const,
    inputBytes: 2 * 1024 * 1024,
    paths: 10_000,
    files: 128,
    fileBytes: 256 * 1024,
    bytes: 4 * 1024 * 1024,
    candidates: 256,
    ancestors: 64,
    directoryLevels: 16,
    referenceHops: 8,
});
export type ScopeContext = {
    schemaVersion: 1;
    phase: string;
    selection: string;
    additionalCandidatePaths?: string[];
    invocation: {
        kind: string;
        reference: string;
        effectiveDirectory: string;
        repositoryPath?: string;
        gitDirectory?: string;
        worktreePath?: string;
        adapter?: string;
    };
};
export type Issue = { id: string; code: string; locator?: string; detail: string };
export type Candidate = {
    id: string;
    locator: string;
    sourceKind: string;
    scopeBasis: string;
    sha256: string;
    byteLength: number;
    text: string;
    referenceIds: string[];
};
export type Binding = {
    canonicalizationVersion: 1;
    gitDirectory: string;
    commonGitDir: string;
    scopeDigest: string;
    gitStateDigest: string;
    pathStateDigest: string;
    invocationDigest: string;
    evidenceDigest: string;
    scanDigest: string;
};
export type PolicyScan = {
    schemaVersion: 1;
    artifact: 'policy-scan';
    operation: Operation;
    context: ScopeContext;
    binding: Binding;
    scanStatus: 'complete' | 'incomplete';
    candidates: Candidate[];
    checkedLocations: { locator: string; status: 'present' | 'absent' | 'failed' }[];
    issues: Issue[];
    limits: { profile: 'policy-scan-v1'; files: number; bytes: number; candidates: number; referenceHops: number };
    limitations: string[];
    exitCode: number;
};
export type Decision = {
    schemaVersion: 1;
    artifact: 'policy-decision';
    operation: Operation;
    binding: Binding;
    branch: string;
    assessments: { candidateId: string; classification: string; rationale: string }[];
    selectedCandidateIds: string[];
    issueIds: string[];
    rationale: string;
    decisionSource: { kind: string; reference: string };
};
export type PolicyRouteCheck = {
    schemaVersion: 1;
    artifact: 'policy-route-check';
    operation: Operation;
    binding: Binding;
    freshness: 'current' | 'stale' | 'unresolved';
    branch: string;
    defaultValidation: 'not-run' | 'eligible';
    repositoryPolicyValidation: 'not-run';
    selectedCandidateIds: string[];
    issues: Issue[];
    limitations: string[];
    exitCode: number;
};
export type FreshRoutingResult = PolicyRouteCheck & { freshScan: PolicyScan };
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
        throw new InputError('Invalid policy input shape or unknown member.');
    return value;
}
export function strings(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        throw new InputError('Invalid policy string list.');
    value.forEach(checkRaw);
    const result = value.map((item) => {
        text(item);
        return item as string;
    });
    if (new Set(result).size !== result.length) throw new InputError('Duplicate policy identifier.');
    return unique(result);
}
function absolute(value: unknown): string {
    const result = text(value);
    if (!path.isAbsolute(result)) throw new InputError('Policy locator must be absolute.');
    return result;
}
export function parseContext(value: unknown): ScopeContext {
    checkRaw(value);
    const data = object(value, ['schemaVersion', 'phase', 'selection', 'additionalCandidatePaths', 'invocation']);
    if (
        data.schemaVersion !== 1 ||
        !['prepare', 'edit-message'].includes(text(data.phase)) ||
        !['index', 'specified-paths', 'all-tracked', 'operation-targets', 'planned-paths'].includes(
            text(data.selection),
        )
    )
        throw new InputError('Unsupported scope context version, phase or selection.');
    const supplied = object(data.invocation, [
        'kind',
        'reference',
        'effectiveDirectory',
        'repositoryPath',
        'gitDirectory',
        'worktreePath',
        'adapter',
    ]);
    const invocation: ScopeContext['invocation'] = {
        kind: text(supplied.kind),
        reference: text(supplied.reference),
        effectiveDirectory: absolute(supplied.effectiveDirectory),
    };
    if (!['direct-git', 'wrapper-adapter', 'agent-context'].includes(invocation.kind))
        throw new InputError('Unsupported invocation kind.');
    for (const field of ['repositoryPath', 'gitDirectory', 'worktreePath'] as const)
        if (supplied[field] !== undefined) invocation[field] = absolute(supplied[field]);
    if (supplied.adapter !== undefined) invocation.adapter = text(supplied.adapter);
    const context: ScopeContext = {
        schemaVersion: 1,
        phase: text(data.phase),
        selection: text(data.selection),
        invocation,
    };
    if (data.additionalCandidatePaths !== undefined)
        context.additionalCandidatePaths = strings(data.additionalCandidatePaths).map(absolute);
    return context;
}
export function parseBinding(value: unknown): Binding {
    const data = object(value, [
        'canonicalizationVersion',
        'gitDirectory',
        'commonGitDir',
        'scopeDigest',
        'gitStateDigest',
        'pathStateDigest',
        'invocationDigest',
        'evidenceDigest',
        'scanDigest',
    ]);
    checkRaw(data);
    if (data.canonicalizationVersion !== 1) throw new InputError('Unsupported binding canonicalization version.');
    const result: Binding = {
        canonicalizationVersion: 1,
        gitDirectory: absolute(data.gitDirectory),
        commonGitDir: absolute(data.commonGitDir),
        scopeDigest: '',
        gitStateDigest: '',
        pathStateDigest: '',
        invocationDigest: '',
        evidenceDigest: '',
        scanDigest: '',
    };
    for (const field of [
        'scopeDigest',
        'gitStateDigest',
        'pathStateDigest',
        'invocationDigest',
        'evidenceDigest',
        'scanDigest',
    ] as const) {
        const digest = text(data[field]);
        if (!/^[a-f0-9]{64}$/.test(digest)) throw new InputError('Invalid policy binding digest.');
        result[field] = digest;
    }
    return result;
}
export const LIMITATIONS = [
    'Finite bounded discovery records checked locations; it cannot prove no undiscovered policy exists.',
    'Agent semantic assessments and invocation references are declarations, not authenticated policy truth, wrapper intent or user authorization.',
    'Observed bytes and identity checks are not an atomic snapshot and cannot prevent later races; repeat freshness checks before consumption and after waiting.',
    'Repository-policy validation is not performed; no default identity, registry, summary or message validation is run by policy commands.',
];
