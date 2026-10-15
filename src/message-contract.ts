import type { Issue, PolicyBranch } from './policy-contract.ts';
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
        source: { kind: 'message-record'; messageRecordId: string } | { kind: 'automatic-signing'; reference: string };
        classification: string;
        identityKeys: string[];
        evidenceReferences: string[];
        rationale: string;
    }[];
    migrations: {
        signatureIds: string[];
        identityKeys: string[];
        mappingReferences: string[];
        modificationDecision: { operationId: string; reference: string };
    }[];
};
export type MessageResult = {
    schemaVersion: 3;
    artifact: 'message-render' | 'message-validation';
    operation: Operation;
    routing: { branch: PolicyBranch };
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
        status: 'complete-against-declared-input' | 'incomplete' | 'not-run';
        summary?: Summary;
    };
    repositoryPolicyValidation: { status: 'not-run' };
    issues: Issue[];
    limitations: string[];
    exitCode: number;
};
