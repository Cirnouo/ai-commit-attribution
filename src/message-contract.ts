import type { Binding, Issue } from './policy-contract.ts';
import type { Operation } from './records.ts';
import type { summarize } from './summarize.ts';

export type Summary = Awaited<ReturnType<typeof summarize>>;
export type MessageRecord = {
    id: string;
    key: string;
    value: string;
    raw: string;
    start: number;
    end: number;
    folded: boolean;
};
export type MessageAssessment = {
    signatures: {
        id: string;
        source: { messageRecordId?: string; policyCandidateId?: string };
        classification: string;
        eventIds: string[];
        evidenceReferences: string[];
        rationale: string;
    }[];
    migrations: {
        signatureIds: string[];
        eventIds: string[];
        mappingReferences: string[];
        modificationDecision: { operationId: string; reference: string };
    }[];
    exceptionApplications: { operationId: string; reference: string; issueIds: string[]; action: string }[];
};
export type MessageResult = {
    schemaVersion: 1;
    artifact: 'message-render' | 'message-validation';
    operation: Operation;
    binding: Binding;
    routing: { branch: string; freshness: 'current' | 'stale' | 'unresolved' };
    message: {
        inputSha256: string;
        outputSha256?: string;
        preview?: string;
        changed?: boolean;
        outputPath?: string;
        records?: { id: string; key: string; sha256: string; byteLength: number }[];
    };
    format: {
        status: 'valid' | 'invalid' | 'not-run';
        convention: 'skill-default' | 'repository-policy' | 'undetermined';
    };
    participationEvidence: {
        status: 'complete-against-declared-input' | 'incomplete' | 'incomplete-with-user-exception' | 'not-run';
        summary?: Summary;
        appliedExceptionIssueIds: string[];
    };
    repositoryPolicyValidation: { status: 'not-run' };
    issues: Issue[];
    limitations: string[];
    exitCode: number;
};
