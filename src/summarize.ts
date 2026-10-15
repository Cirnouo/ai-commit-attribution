import { InputError, normalizeIdentities, ordinal, parseLedger, parseOperation, parseRegistry } from './records.ts';

/** Normalize a finite confirmed set for one explicit operation; this is never permission or policy validation. */
export async function summarize(input: unknown, currentOperation: unknown, registryInput: unknown) {
    const ledger = await parseLedger(input);
    const operation = await parseOperation(currentOperation);
    if (JSON.stringify(ledger.operation) !== JSON.stringify(operation))
        throw new InputError('Invalid input scope: ledger and current operation differ.');
    const registry = parseRegistry(registryInput);
    const tuples = normalizeIdentities(ledger.identities, registry);
    const blockers = [...ledger.blockers].sort((a, b) => ordinal(a.id, b.id));
    return {
        schemaVersion: 2 as const,
        ledgerId: ledger.ledgerId,
        operation,
        tuples,
        blockers,
        issues: blockers.map((blocker) => ({ id: blocker.id, code: 'known-blocker', detail: blocker.reason })),
        limitations: [
            'Confirmed identities and blockers are supplied declarations; this summary cannot authenticate facts or user authority.',
            'The finite declared set cannot prove that no contributing actors were omitted.',
            'Matching supplied physical scope does not prove the live Git operation or its freshness.',
            'Summary completion is not repository-policy validation or authorization to commit or modify Git state.',
        ],
        exitCode: blockers.length ? 20 : 0,
    };
}
