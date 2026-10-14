import type { Decision, FreshRoutingResult, PolicyScan } from './policy-contract.ts';
import { LIMITATIONS, LIMITS, object, parseBinding, parseContext, strings } from './policy-contract.ts';
import { EvidenceSearch } from './policy-evidence.ts';
import { captureScope, digest } from './policy-scope.ts';
import { checkRaw, InputError, parseOperation, text } from './records.ts';
import { ObservationError } from './safe-git.ts';

export async function scanPolicy(input: { operation: unknown; context: unknown }): Promise<PolicyScan> {
    const operation = await parseOperation(input.operation);
    const context = parseContext(input.context);
    const search = new EvidenceSearch();
    let gitDirectory = operation.commonGitDir;
    let scopeDigest = digest({ operation, context, unresolved: true });
    let gitStateDigest = digest(null),
        pathStateDigest = digest(null),
        invocationDigest = digest(context.invocation);
    try {
        const scope = await captureScope(operation, context);
        search.entries = scope.enumerationEntries;
        ({ gitDirectory, scopeDigest, gitStateDigest, pathStateDigest, invocationDigest } = scope);
        await search.discover(operation, context, scope);
    } catch (error) {
        if (error instanceof InputError) throw error;
        search.issue(
            'scope-observation',
            context.invocation.effectiveDirectory,
            error instanceof ObservationError
                ? error.message
                : 'Live Git/path observation failed safe identity/type/encoding checks.',
        );
    }
    const evidenceDigest = search.bindingDigest();
    const partial = {
        canonicalizationVersion: 1 as const,
        gitDirectory,
        commonGitDir: operation.commonGitDir,
        scopeDigest,
        gitStateDigest,
        pathStateDigest,
        invocationDigest,
        evidenceDigest,
    };
    const binding = { ...partial, scanDigest: digest({ ...partial, profile: LIMITS }) };
    return {
        schemaVersion: 1,
        artifact: 'policy-scan',
        operation,
        context,
        binding,
        scanStatus: search.issues.length ? 'incomplete' : 'complete',
        candidates: search.candidates,
        checkedLocations: search.checkedLocations,
        issues: search.issues,
        limits: {
            profile: LIMITS.profile,
            files: search.files,
            bytes: search.bytes,
            candidates: search.candidates.length,
            referenceHops: search.referenceHops,
        },
        limitations: [...LIMITATIONS, ...search.limitations],
        exitCode: search.issues.length ? 20 : 0,
    };
}
async function parseDecision(value: unknown): Promise<Decision> {
    checkRaw(value);
    const data = object(value, [
        'schemaVersion',
        'artifact',
        'operation',
        'binding',
        'branch',
        'assessments',
        'selectedCandidateIds',
        'issueIds',
        'rationale',
        'decisionSource',
    ]);
    if (
        data.schemaVersion !== 1 ||
        data.artifact !== 'policy-decision' ||
        !['repository-policy', 'skill-default', 'needs-decision'].includes(text(data.branch))
    )
        throw new InputError('Invalid policy decision version/artifact/branch.');
    if (!Array.isArray(data.assessments)) throw new InputError('Invalid policy assessments.');
    const assessments = data.assessments.map((item) => {
        const row = object(item, ['candidateId', 'classification', 'rationale']);
        const classification = text(row.classification);
        if (!['ai-disclosure-policy', 'ordinary-format-only', 'unrelated', 'uncertain'].includes(classification))
            throw new InputError('Unsupported semantic classification.');
        return { candidateId: text(row.candidateId), classification, rationale: text(row.rationale) };
    });
    // Single-line decision fields reject controls without rejecting newlines in policy documents.
    const source = object(data.decisionSource, ['kind', 'reference']);
    if (source.kind !== 'agent-semantic') throw new InputError('A semantic Agent decision record is required.');
    const result: Decision = {
        schemaVersion: 1,
        artifact: 'policy-decision',
        operation: await parseOperation(data.operation),
        binding: parseBinding(data.binding),
        branch: text(data.branch),
        assessments,
        selectedCandidateIds: strings(data.selectedCandidateIds),
        issueIds: strings(data.issueIds),
        rationale: text(data.rationale),
        decisionSource: { kind: 'agent-semantic', reference: text(source.reference) },
    };
    checkRaw(result);
    if (new Set(assessments.map((item) => item.candidateId)).size !== assessments.length)
        throw new InputError('Duplicate candidate assessment.');
    return result;
}
/** Recapture immediately before PR6 consumes routing. This module never imports default summary/registry. */
export async function checkFreshRouting(input: {
    operation: unknown;
    context: unknown;
    decision: unknown;
}): Promise<FreshRoutingResult> {
    const decision = await parseDecision(input.decision);
    const operation = await parseOperation(input.operation);
    if (JSON.stringify(operation) !== JSON.stringify(decision.operation))
        throw new InputError('Decision and supplied operation scopes differ.');
    const scan = await scanPolicy({ operation, context: input.context });
    const same = digest(scan.binding) === digest(decision.binding);
    // IDs are checked only against matching evidence. Changed evidence correctly produces stale, not an unknown-ID input error.
    if (same) {
        const candidates = new Set(scan.candidates.map((item) => item.id));
        const issues = new Set(scan.issues.map((item) => item.id));
        if (
            decision.assessments.length !== candidates.size ||
            decision.assessments.some((item) => !candidates.has(item.candidateId)) ||
            decision.selectedCandidateIds.some((id) => !candidates.has(id)) ||
            decision.issueIds.some((id) => !issues.has(id))
        )
            throw new InputError('Decision has missing/unknown candidate or issue references.');
        const selected = decision.assessments.filter((item) =>
            decision.selectedCandidateIds.includes(item.candidateId),
        );
        if (
            decision.branch === 'repository-policy' &&
            (!selected.length || selected.some((item) => item.classification !== 'ai-disclosure-policy'))
        )
            throw new InputError('Repository-policy requires selected applicable evidence.');
        if (
            decision.branch === 'skill-default' &&
            (decision.selectedCandidateIds.length ||
                decision.assessments.some((item) => item.classification === 'ai-disclosure-policy'))
        )
            throw new InputError('Default decision conflicts with applicable AI-policy assessment.');
    }
    const unresolved =
        scan.scanStatus === 'incomplete' ||
        decision.assessments.some((item) => item.classification === 'uncertain') ||
        decision.branch === 'needs-decision';
    const branch = !same || unresolved ? 'needs-decision' : decision.branch;
    return {
        schemaVersion: 1,
        artifact: 'policy-route-check',
        operation,
        binding: scan.binding,
        freshness: same ? (unresolved ? 'unresolved' : 'current') : 'stale',
        branch,
        defaultValidation: branch === 'skill-default' ? 'eligible' : 'not-run',
        repositoryPolicyValidation: 'not-run',
        selectedCandidateIds: branch === 'repository-policy' ? decision.selectedCandidateIds : [],
        issues: [
            ...scan.issues,
            ...(!same
                ? [
                      {
                          id: digest(['stale']),
                          code: 'stale-decision',
                          detail: 'Observed scope/evidence binding changed; obtain a new semantic decision.',
                      },
                  ]
                : []),
        ],
        limitations: scan.limitations,
        exitCode: branch === 'repository-policy' ? 10 : branch === 'skill-default' ? 0 : 20,
        freshScan: scan,
    };
}
