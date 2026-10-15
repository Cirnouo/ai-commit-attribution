import { object } from './input-contract.ts';
import type { Decision, PolicyBranch, PolicyRoute } from './policy-contract.ts';
import { checkRaw, InputError, parseOperation, text } from './records.ts';
import { digest } from './runtime-support.ts';

export const DECISION_MIGRATION =
    'Use a schemaVersion 2 AI policy-decision with operation, branch, rationale and decisionSource; policy scan, --context and scanner fields are no longer supported.';

export async function parseDecision(value: unknown): Promise<Decision> {
    checkRaw(value);
    let data: Record<string, unknown>;
    try {
        data = object(value, ['schemaVersion', 'artifact', 'operation', 'branch', 'rationale', 'decisionSource']);
    } catch {
        throw new InputError(`Invalid policy decision shape. ${DECISION_MIGRATION}`);
    }
    if (data.schemaVersion !== 2 || data.artifact !== 'policy-decision')
        throw new InputError(`Invalid policy decision version/artifact. ${DECISION_MIGRATION}`);
    const branch = text(data.branch);
    if (!['repository-policy', 'skill-default', 'needs-decision'].includes(branch))
        throw new InputError('Invalid policy decision branch.');
    const source = object(data.decisionSource, ['kind', 'reference']);
    if (source.kind !== 'agent-semantic') throw new InputError('A semantic Agent decision record is required.');
    return {
        schemaVersion: 2,
        artifact: 'policy-decision',
        operation: await parseOperation(data.operation),
        branch: branch as PolicyBranch,
        rationale: text(data.rationale),
        decisionSource: { kind: 'agent-semantic', reference: text(source.reference) },
    };
}

/** Check declared scope joins only. The Agent owns policy discovery, meaning, freshness and authorization. */
export async function checkRouting(input: { operation: unknown; decision: unknown }): Promise<PolicyRoute> {
    const decision = await parseDecision(input.decision);
    const operation = await parseOperation(input.operation);
    if (digest(operation) !== digest(decision.operation))
        throw new InputError('Decision and supplied operation scopes differ.');
    return {
        operation,
        branch: decision.branch,
        issues: [],
        limitations: [
            'Routing checks declared operation consistency only; it does not discover or interpret repository policy, inspect actual Git state or verify freshness.',
            'Agent semantic decisions and references are declarations, not authenticated policy truth or user authorization.',
            'Repository-policy validation is not performed; repository-policy and needs-decision routes do not load default identity evidence.',
        ],
        exitCode: decision.branch === 'repository-policy' ? 10 : decision.branch === 'skill-default' ? 0 : 20,
    };
}
