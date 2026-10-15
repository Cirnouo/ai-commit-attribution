import { object, strings } from './input-contract.ts';
import type { MessageAssessment, MessageRecord, Summary } from './message-contract.ts';
import type { PolicyRoute } from './policy-contract.ts';
import { checkRaw, InputError, identityKey, parseOperation, text, unique } from './records.ts';
import { digest } from './runtime-support.ts';

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
    route: PolicyRoute,
    messageSha256: string,
    records: readonly MessageRecord[],
    summary: Summary,
): Promise<MessageAssessment> {
    if (value === undefined) return { signatures: [], migrations: [] };
    checkRaw(value);
    let data: Record<string, unknown>;
    try {
        data = object(value, ['schemaVersion', 'artifact', 'operation', 'messageSha256', 'signatures', 'migrations']);
    } catch {
        throw new InputError(
            'Invalid message assessment shape; migrate to schemaVersion 3 confirmed-identity assessment inputs without event or exception fields.',
        );
    }
    if (
        data.schemaVersion !== 3 ||
        data.artifact !== 'message-assessment' ||
        data.messageSha256 !== messageSha256 ||
        digest(await parseOperation(data.operation)) !== digest(route.operation)
    )
        throw new InputError(
            'Message assessment requires schemaVersion 3 and exact declared operation/message association; migrate old AI decision/assessment inputs.',
        );
    const identityKeys = new Set(summary.tuples.map(identityKey));
    const signatures = rows(data.signatures).map((item) => {
        const row = object(item, ['id', 'source', 'classification', 'identityKeys', 'evidenceReferences', 'rationale']);
        let source: Record<string, unknown>;
        try {
            source = object(row.source, ['kind', 'messageRecordId', 'reference']);
        } catch {
            throw new InputError(
                'Invalid signature source; migrate to schemaVersion 3 message-record or automatic-signing sources.',
            );
        }
        const classification = text(row.classification);
        if (
            !['ai-signature', 'human-signature', 'unrelated', 'uncertain'].includes(classification) ||
            Object.keys(source).length !== 2
        )
            throw new InputError(
                'Invalid signature assessment source/classification; schemaVersion 3 requires an explicit source kind.',
            );
        let location: MessageAssessment['signatures'][number]['source'];
        if (source.kind === 'message-record' && source.reference === undefined) {
            location = { kind: 'message-record', messageRecordId: exact(source.messageRecordId) };
            const messageRecordId = location.messageRecordId;
            if (!records.some((record) => record.id === messageRecordId))
                throw new InputError('Unknown message record assessment.');
        } else if (source.kind === 'automatic-signing' && source.messageRecordId === undefined)
            location = { kind: 'automatic-signing', reference: exact(source.reference) };
        else
            throw new InputError(
                'Invalid signature source; schemaVersion 3 requires message-record or automatic-signing.',
            );
        const keys = strings(row.identityKeys);
        if (keys.some((id) => !identityKeys.has(id))) throw new InputError('Unknown signature identity association.');
        const evidenceReferences = strings(row.evidenceReferences);
        if (!evidenceReferences.length)
            throw new InputError('Signature assessment needs concrete evidence references.');
        return {
            id: exact(row.id),
            source: location,
            classification,
            identityKeys: keys,
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
        const row = object(item, ['signatureIds', 'identityKeys', 'mappingReferences', 'modificationDecision']);
        const signatureIds = strings(row.signatureIds),
            keys = strings(row.identityKeys),
            mappingReferences = strings(row.mappingReferences);
        const decision = object(row.modificationDecision, ['operationId', 'reference']);
        if (
            !signatureIds.length ||
            !keys.length ||
            !mappingReferences.length ||
            exact(decision.operationId) !== route.operation.id
        )
            throw new InputError(
                'Migration requires exact signatures/keys/mapping and a current modification decision.',
            );
        for (const id of signatureIds) {
            const signature = signatures.find((signature) => signature.id === id);
            if (
                signature?.classification !== 'ai-signature' ||
                signature.source.kind !== 'message-record' ||
                migrated.has(id) ||
                !signature.identityKeys.length ||
                signature.identityKeys.some((key) => !keys.includes(key))
            )
                throw new InputError('Invalid, duplicate or unsupported migration signature mapping.');
            migrated.add(id);
        }
        const joined = unique(
            signatures
                .filter((signature) => signatureIds.includes(signature.id))
                .flatMap((signature) => signature.identityKeys),
        );
        if (JSON.stringify(joined) !== JSON.stringify(keys) || keys.some((id) => !identityKeys.has(id)))
            throw new InputError('Migration pairing does not cover exact resolved identity keys.');
        return {
            signatureIds,
            identityKeys: keys,
            mappingReferences,
            modificationDecision: { operationId: exact(decision.operationId), reference: text(decision.reference) },
        };
    });
    return { signatures, migrations };
}
