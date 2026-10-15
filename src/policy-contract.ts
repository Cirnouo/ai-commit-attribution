import type { Operation } from './records.ts';

export type Issue = { id: string; code: string; locator?: string; detail: string };
export type PolicyBranch = 'repository-policy' | 'skill-default' | 'needs-decision';
export type Decision = {
    schemaVersion: 2;
    artifact: 'policy-decision';
    operation: Operation;
    branch: PolicyBranch;
    rationale: string;
    decisionSource: { kind: 'agent-semantic'; reference: string };
};
export type PolicyRoute = {
    operation: Operation;
    branch: PolicyBranch;
    issues: Issue[];
    limitations: string[];
    exitCode: number;
};
