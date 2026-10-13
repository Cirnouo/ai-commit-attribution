import type { Event, Registry } from './records.ts';
import { InputError, ordinal, parseLedger, parseOperation, parseRegistry, unique } from './records.ts';

type Issue = { id: string; code: string; eventId?: string; participantId?: string };
type Tuple = { agent: string; model: string; reasoning?: string; participantIds: string[]; eventIds: string[] };

function effective(event: Event, field: string): boolean {
    return event.evidence.some((item) => item.observation === 'effective' && item.fields.includes(field));
}
function resolveAgent(event: Event, registry: Registry, hostNames: readonly string[]): string | undefined {
    if (!event.agent || !effective(event, 'agent')) return;
    const exact = registry.hosts.find((host) => host.name === event.agent || host.aliases.includes(event.agent ?? ''));
    const contextual = hostNames.length === 1 ? registry.hosts.find((host) => host.name === hostNames[0]) : undefined;
    if (exact) return !contextual || exact.name === contextual.name ? exact.name : undefined;
    if (
        contextual &&
        registry.ambiguousAliases.includes(event.agent) &&
        contextual.family ===
            (Object.hasOwn(registry.familyAliases, event.agent) ? registry.familyAliases[event.agent] : event.agent)
    )
        return contextual.name;
    return;
}
function formalCandidate(value: string | undefined): value is string {
    return value !== undefined && !['auto', 'latest', 'unknown', 'n/a', 'null'].includes(value.toLowerCase());
}
/** Every effective declaration participates before same-event enrichment can select a model. */
function resolveModels(records: readonly Event[]): { values: string[]; conflict: boolean } {
    const observations = records.filter((event) => effective(event, 'model'));
    const candidates = unique(observations.map((event) => event.model).filter(formalCandidate));
    const routes = unique(observations.map((event) => event.modelRoute).filter((route) => route !== undefined));
    const mappings = observations.flatMap((event) =>
        event.evidence
            .filter((item) => item.observation === 'effective' && item.fields.includes('model'))
            .flatMap((item) => (item.mapping ? [{ event, mapping: item.mapping }] : [])),
    );
    const values = unique([...candidates, ...mappings.map((item) => item.mapping.model).filter(formalCandidate)]);
    const conflict =
        values.length > 1 ||
        mappings.some(
            ({ event, mapping }) =>
                !formalCandidate(mapping.model) ||
                (formalCandidate(event.model) && event.model !== mapping.model) ||
                (event.modelRoute !== undefined ? event.modelRoute !== mapping.route : !routes.includes(mapping.route)),
        );
    const covered = routes.every((route) =>
        mappings.some(({ mapping }) => mapping.route === route && mapping.model === candidates[0]),
    );
    return { values: covered ? candidates : [], conflict };
}
function resolveReasoning(event: Event): { value?: string; conflict: boolean } {
    if (event.reasoning.state !== 'confirmed') return { conflict: false };
    const value = event.reasoning.value;
    const native = unique(
        event.evidence
            .filter(
                (item) => item.observation === 'effective' && item.fields.includes('reasoning') && item.nativeReasoning,
            )
            .map((item) => item.nativeReasoning ?? ''),
    );
    if (native.length > 1) return { conflict: true };
    if (native[0] === 'disabled') return { value: 'none', conflict: false };
    if (native[0] === 'enabled' && !['none', 'unknown', 'N/A', 'null', 'off'].includes(value))
        return { value, conflict: false };
    return { conflict: false };
}

/** Resolve declared evidence within one explicit operation; this is never a permission or policy decision. */
export async function summarize(input: unknown, currentOperation: unknown, registryInput: unknown) {
    const ledger = await parseLedger(input);
    const operation = await parseOperation(currentOperation);
    if (JSON.stringify(ledger.operation) !== JSON.stringify(operation))
        throw new InputError('Invalid input scope: ledger and current operation differ.');
    const registry = parseRegistry(registryInput);
    const issues: Issue[] = [];
    const diagnostics: Issue[] = [];
    const tuples = new Map<string, Tuple>();
    const groups = new Map<string, Event[]>();
    for (const event of ledger.events) groups.set(event.id, [...(groups.get(event.id) ?? []), event]);
    const participants = unique([
        ...ledger.knownParticipants.map((item) => item.id),
        ...ledger.events.map((item) => item.participantId),
    ]).map((id) => ({
        id,
        declared: ledger.knownParticipants.some((item) => item.id === id),
        eventIds: unique(ledger.events.filter((event) => event.participantId === id).map((event) => event.id)),
    }));
    for (const participant of ledger.knownParticipants) {
        for (const eventId of participant.eventIds)
            if (!groups.has(eventId))
                issues.push({
                    id: JSON.stringify(['participant', participant.id, 'event', eventId]),
                    code: 'missing-event',
                    participantId: participant.id,
                    eventId,
                });
        if (!ledger.events.some((event) => event.participantId === participant.id))
            issues.push({
                id: JSON.stringify(['participant', participant.id, 'events']),
                code: 'missing-participant-event',
                participantId: participant.id,
            });
    }
    const events = [...groups]
        .sort(([a], [b]) => ordinal(a, b))
        .map(([eventId, records]) => {
            const first = records[0];
            if (!first) throw new Error('Event grouping failed.');
            const hostCandidates = records
                .filter((event) => event.host && effective(event, 'host'))
                .map((event) => event.host);
            const hostNames = unique(
                hostCandidates
                    .map(
                        (candidate) =>
                            registry.hosts.find(
                                (host) => host.name === candidate || host.aliases.includes(candidate ?? ''),
                            )?.name,
                    )
                    .filter((value) => value !== undefined),
            );
            const candidateAgents = records
                .filter((event) => event.agent && effective(event, 'agent'))
                .map((event) => resolveAgent(event, registry, hostNames));
            const invalidHost =
                hostNames.length > 1 ||
                hostCandidates.some(
                    (candidate) =>
                        !registry.hosts.some(
                            (host) => host.name === candidate || host.aliases.includes(candidate ?? ''),
                        ),
                );
            const agents =
                invalidHost || candidateAgents.some((agent) => agent === undefined)
                    ? []
                    : unique(candidateAgents.filter((value) => value !== undefined));
            const modelResolution = resolveModels(records);
            const models = modelResolution.values;
            const reasoningObservations = records.map(resolveReasoning);
            const efforts = unique(
                reasoningObservations.map((item) => item.value).filter((value) => value !== undefined),
            );
            const reasoningConflict = efforts.length > 1 || reasoningObservations.some((item) => item.conflict);
            for (const [field, values] of [
                ['agent', agents],
                ['model', models],
            ] as const) {
                if (values.length !== 1 || (field === 'model' && modelResolution.conflict))
                    issues.push({
                        id: JSON.stringify(['event', eventId, field]),
                        code:
                            values.length > 1 || (field === 'model' && modelResolution.conflict)
                                ? `conflicting-${field}`
                                : `unresolved-${field}`,
                        eventId,
                        participantId: first.participantId,
                    });
            }
            const reasoning = !reasoningConflict && efforts.length === 1 ? efforts[0] : undefined;
            if (!reasoning)
                diagnostics.push({
                    id: JSON.stringify(['event', eventId, 'reasoning']),
                    code: reasoningConflict ? 'conflicting-reasoning' : 'unknown-reasoning',
                    eventId,
                    participantId: first.participantId,
                });
            const agent = agents.length === 1 ? agents[0] : undefined;
            const model = !modelResolution.conflict && models.length === 1 ? models[0] : undefined;
            if (agent && model) {
                const key = JSON.stringify([agent, model, reasoning ?? null]);
                const tuple = tuples.get(key) ?? {
                    agent,
                    model,
                    ...(reasoning ? { reasoning } : {}),
                    participantIds: [],
                    eventIds: [],
                };
                tuple.participantIds = unique([...tuple.participantIds, first.participantId]);
                tuple.eventIds = unique([...tuple.eventIds, eventId]);
                tuples.set(key, tuple);
            }
            return {
                id: eventId,
                participantId: first.participantId,
                task: first.task,
                ...(agent ? { agent } : {}),
                ...(model ? { model } : {}),
                ...(reasoning ? { reasoning } : {}),
                records: records.map((event) => ({ ...event, evidence: event.evidence.map((item) => ({ ...item })) })),
            };
        });
    const issueIds = new Set(issues.map((issue) => issue.id));
    if (ledger.userExceptions.some((exception) => exception.issueIds.some((id) => !issueIds.has(id))))
        throw new InputError('Invalid input: exception references an absent concrete issue.');
    return {
        schemaVersion: 1,
        operation,
        exitCode: issues.length ? 20 : 0,
        tuples: [...tuples.values()].sort(
            (a, b) =>
                ordinal(a.agent, b.agent) ||
                ordinal(a.model, b.model) ||
                (a.reasoning === undefined
                    ? b.reasoning === undefined
                        ? 0
                        : -1
                    : b.reasoning === undefined
                      ? 1
                      : ordinal(a.reasoning, b.reasoning)),
        ),
        events,
        participants,
        issues: issues.sort((a, b) => ordinal(a.id, b.id)),
        diagnostics,
        userExceptions: ledger.userExceptions,
        limitations: [
            'Supplied evidence is a declaration; this summary cannot authenticate runtime dispatch, handoffs, mappings or user consent.',
            'Declared participant accounting cannot prove that no contributing actors were undisclosed.',
            'Matching supplied physical scope does not prove the live Git operation or its freshness.',
            'Summary completion is not repository-policy validation or authorization to commit or modify Git state.',
        ],
    };
}
