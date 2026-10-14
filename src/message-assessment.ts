import type { MessageAssessment, MessageRecord, Summary } from './message-contract.ts';
import type { FreshRoutingResult } from './policy-contract.ts';
import { object, parseBinding, strings } from './policy-contract.ts';
import { digest } from './policy-scope.ts';
import { checkRaw, InputError, parseOperation, text, unique } from './records.ts';

const exact = (value: unknown): string => {
    text(value);
    return value as string;
};
function rows(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new InputError('Assessment requires an array.');
    return value;
}
/** Only exact current joins are mechanically checked. This does not authenticate semantic claims or user consent. */
export async function parseAssessment(
    value: unknown,
    route: FreshRoutingResult,
    messageSha256: string,
    records: readonly MessageRecord[],
    summary: Summary,
): Promise<MessageAssessment> {
    if (value === undefined) return { signatures: [], migrations: [], exceptionApplications: [] };
    checkRaw(value);
    const data = object(value, [
        'schemaVersion',
        'artifact',
        'operation',
        'binding',
        'messageSha256',
        'signatures',
        'migrations',
        'exceptionApplications',
    ]);
    if (
        data.schemaVersion !== 1 ||
        data.artifact !== 'message-assessment' ||
        data.messageSha256 !== messageSha256 ||
        digest(await parseOperation(data.operation)) !== digest(route.operation) ||
        digest(parseBinding(data.binding)) !== digest(route.binding)
    )
        throw new InputError('Message assessment is malformed or bound to another message/scope/evidence.');
    const eventIds = new Set(summary.events.map((event) => event.id));
    const signatures = rows(data.signatures).map((item) => {
        const row = object(item, ['id', 'source', 'classification', 'eventIds', 'evidenceReferences', 'rationale']);
        const source = object(row.source, ['messageRecordId', 'policyCandidateId']);
        const classification = text(row.classification);
        if (
            !['ai-signature', 'human-signature', 'unrelated', 'uncertain'].includes(classification) ||
            Object.keys(source).length !== 1
        )
            throw new InputError('Invalid signature assessment source/classification.');
        const location: { messageRecordId?: string; policyCandidateId?: string } = {};
        if (source.messageRecordId !== undefined) {
            location.messageRecordId = exact(source.messageRecordId);
            if (!records.some((record) => record.id === location.messageRecordId))
                throw new InputError('Unknown message record assessment.');
        } else {
            location.policyCandidateId = exact(source.policyCandidateId);
            if (!route.freshScan.candidates.some((candidate) => candidate.id === location.policyCandidateId))
                throw new InputError('Unknown fresh policy candidate assessment.');
        }
        const events = strings(row.eventIds);
        if (events.some((id) => !eventIds.has(id))) throw new InputError('Unknown signature event association.');
        const evidenceReferences = strings(row.evidenceReferences);
        if (!evidenceReferences.length)
            throw new InputError('Signature assessment needs concrete evidence references.');
        return {
            id: exact(row.id),
            source: location,
            classification,
            eventIds: events,
            evidenceReferences,
            rationale: text(row.rationale),
        };
    });
    if (
        new Set(signatures.map((signature) => signature.id)).size !== signatures.length ||
        new Set(signatures.map((signature) => JSON.stringify(signature.source))).size !== signatures.length
    )
        throw new InputError('Duplicate signature assessment ID/source.');
    const migrated = new Set<string>();
    const migrations = rows(data.migrations).map((item) => {
        const row = object(item, ['signatureIds', 'eventIds', 'mappingReferences', 'modificationDecision']);
        const signatureIds = strings(row.signatureIds),
            events = strings(row.eventIds),
            mappingReferences = strings(row.mappingReferences);
        const decision = object(row.modificationDecision, ['operationId', 'reference']);
        if (
            !signatureIds.length ||
            !events.length ||
            !mappingReferences.length ||
            exact(decision.operationId) !== route.operation.id
        )
            throw new InputError(
                'Migration requires exact signatures/events/mapping and a current modification decision.',
            );
        for (const id of signatureIds) {
            const signature = signatures.find((signature) => signature.id === id);
            if (
                signature?.classification !== 'ai-signature' ||
                !signature.source.messageRecordId ||
                migrated.has(id) ||
                !signature.eventIds.length ||
                signature.eventIds.some((eventId) => !events.includes(eventId))
            )
                throw new InputError('Invalid, duplicate or unsupported migration signature mapping.');
            migrated.add(id);
        }
        const joined = unique(
            signatures
                .filter((signature) => signatureIds.includes(signature.id))
                .flatMap((signature) => signature.eventIds),
        );
        if (
            JSON.stringify(joined) !== JSON.stringify(events) ||
            events.some((id) => !summary.tuples.some((tuple) => tuple.eventIds.includes(id)))
        )
            throw new InputError('Migration pairing does not cover exact resolved event evidence.');
        return {
            signatureIds,
            eventIds: events,
            mappingReferences,
            modificationDecision: { operationId: exact(decision.operationId), reference: text(decision.reference) },
        };
    });
    const applied = new Set<string>();
    const exceptionApplications = rows(data.exceptionApplications ?? []).map((item) => {
        const row = object(item, ['operationId', 'reference', 'issueIds', 'action']);
        const operationId = exact(row.operationId),
            reference = exact(row.reference),
            issueIds = strings(row.issueIds);
        if (
            row.action !== 'continue-with-incomplete-disclosure' ||
            operationId !== route.operation.id ||
            !issueIds.length ||
            issueIds.some((id) => applied.has(id)) ||
            !summary.userExceptions.some(
                (exception) =>
                    exception.operationId === operationId &&
                    exception.reference === reference &&
                    issueIds.every((id) => exception.issueIds.includes(id)),
            ) ||
            issueIds.some((id) => !summary.issues.some((issue) => issue.id === id))
        )
            throw new InputError('Invalid exception application scope/reference or concrete issue coverage.');
        issueIds.forEach((id) => {
            applied.add(id);
        });
        return { operationId, reference, issueIds, action: 'continue-with-incomplete-disclosure' };
    });
    return { signatures, migrations, exceptionApplications };
}
