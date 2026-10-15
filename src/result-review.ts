import { object } from './input-contract.ts';
import { checkRaw, InputError, text } from './records.ts';
import { fullObjectId } from './result-contract.ts';
export type ResultReview = {
    schemaVersion: 1;
    artifact: 'result-review';
    contextId: string;
    ledgerId: string;
    preparationId: string;
    sha: string;
    messageSha256: string;
    createdByPreparation: true;
    policyReviewed: true;
    reference: string;
    acceptMessageChange?: true;
    repositoryPolicyChecked?: true;
};
export type SealedResult = {
    preparationId: string;
    sha: string;
    messageSha256: string;
    review: ResultReview;
    checks: {
        parents: true;
        tree: true;
        message: 'candidate-equivalent' | 'explicit-final-review';
        participation: 'frozen-default-check' | 'repository-rule-declaration';
    };
};
function invalid(): never {
    throw new InputError('Invalid portable result review.');
}
function uuid(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) invalid();
    return value;
}
function sha256(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid();
    return value;
}
/** Caller declarations bound to an exact result; shape validation authenticates no facts. */
export function parseResultReview(value: unknown): ResultReview {
    checkRaw(value);
    const data = object(value, [
        'schemaVersion',
        'artifact',
        'contextId',
        'ledgerId',
        'preparationId',
        'sha',
        'messageSha256',
        'createdByPreparation',
        'policyReviewed',
        'reference',
        'acceptMessageChange',
        'repositoryPolicyChecked',
    ]);
    if (
        data.schemaVersion !== 1 ||
        data.artifact !== 'result-review' ||
        data.createdByPreparation !== true ||
        data.policyReviewed !== true
    )
        invalid();
    for (const key of ['acceptMessageChange', 'repositoryPolicyChecked'])
        if (Object.hasOwn(data, key) && data[key] !== true) invalid();
    text(data.reference);
    return {
        schemaVersion: 1,
        artifact: 'result-review',
        contextId: uuid(data.contextId),
        ledgerId: uuid(data.ledgerId),
        preparationId: uuid(data.preparationId),
        sha: fullObjectId(data.sha),
        messageSha256: sha256(data.messageSha256),
        createdByPreparation: true,
        policyReviewed: true,
        reference: data.reference as string,
        ...(data.acceptMessageChange === true ? { acceptMessageChange: true as const } : {}),
        ...(data.repositoryPolicyChecked === true ? { repositoryPolicyChecked: true as const } : {}),
    };
}
/** Portable historical data only; no filesystem reads or new-action authority. */
export function parseSealedResult(value: unknown): SealedResult {
    const data = object(value, ['preparationId', 'sha', 'messageSha256', 'review', 'checks']);
    const review = parseResultReview(data.review);
    const preparationId = uuid(data.preparationId),
        sha = fullObjectId(data.sha),
        messageSha256 = sha256(data.messageSha256);
    const checks = object(data.checks, ['parents', 'tree', 'message', 'participation']);
    if (
        preparationId !== review.preparationId ||
        sha !== review.sha ||
        messageSha256 !== review.messageSha256 ||
        checks.parents !== true ||
        checks.tree !== true ||
        !['candidate-equivalent', 'explicit-final-review'].includes(checks.message as string) ||
        !['frozen-default-check', 'repository-rule-declaration'].includes(checks.participation as string)
    )
        invalid();
    if (checks.message === 'explicit-final-review' && review.acceptMessageChange !== true) invalid();
    if (checks.participation === 'repository-rule-declaration' && review.repositoryPolicyChecked !== true) invalid();
    return {
        preparationId,
        sha,
        messageSha256,
        review,
        checks: {
            parents: true,
            tree: true,
            message: checks.message as SealedResult['checks']['message'],
            participation: checks.participation as SealedResult['checks']['participation'],
        },
    };
}
