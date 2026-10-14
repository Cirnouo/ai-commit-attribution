import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '../tooling/errors.ts';

export class InputError extends Error {}
export const ordinal = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
export const unique = (values: readonly string[]): string[] => [...new Set(values)].sort(ordinal);

export type Operation = {
    schemaVersion: 1;
    id: string;
    repository: string;
    worktree: string;
    commonGitDir: string;
    kind: string;
    paths: string[];
    targets: { role: string; objectId: string }[];
};
export type Evidence = {
    fields: string[];
    kind: string;
    observation: string;
    reference: string;
    detail?: string;
    nativeReasoning?: string;
    mapping?: { route: string; model: string };
};
export type Event = {
    id: string;
    participantId: string;
    task: string;
    agent?: string;
    host?: string;
    model?: string;
    modelRoute?: string;
    reasoning: { state: 'unknown' } | { state: 'confirmed'; value: string };
    evidence: Evidence[];
};
export type UserException = { operationId: string; issueIds: string[]; decision: string; reference: string };
export type Ledger = {
    schemaVersion: 1;
    operation: Operation;
    knownParticipants: { id: string; eventIds: string[] }[];
    events: Event[];
    userExceptions: UserException[];
};
export type Registry = {
    schemaVersion: 1;
    hosts: { name: string; aliases: string[]; family: string }[];
    ambiguousAliases: string[];
    familyAliases: Record<string, string>;
};

/** Inspect raw strings before any normalization can hide a control. Never echo input data in diagnostics. */
export function checkRaw(value: unknown): void {
    if (typeof value === 'string' && /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))
        throw new InputError('Invalid input: raw field contains a control or line separator.');
    if (Array.isArray(value)) value.forEach(checkRaw);
    else if (isRecord(value))
        Object.entries(value).forEach(([key, item]) => {
            checkRaw(key);
            checkRaw(item);
        });
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
        throw new InputError('Invalid input: unexpected object shape.');
    return value;
}
export function text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new InputError('Invalid input: expected a nonempty string.');
    return value.trim();
}
/** Opaque keys are exact association data, never whitespace-normalized into another key. */
function opaque(value: unknown): string {
    text(value);
    return value as string;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
    if (!Array.isArray(value)) throw new InputError('Invalid input: expected an array.');
    return value.map(parse);
}
export function identity(value: unknown, field: 'model' | 'reasoning'): string {
    checkRaw(value);
    const result = text(value);
    if (/[()<>]|\s/u.test(result) || (field === 'reasoning' && result.includes(':')))
        throw new InputError('Invalid input: ambiguous single-line identity field.');
    return result;
}
function version(value: unknown): void {
    if (value !== 1) throw new InputError('Invalid input: schemaVersion must be 1.');
}

/** Shared scope normalization. It validates supplied physical paths, not live Git state or freshness. */
export async function parseOperation(value: unknown): Promise<Operation> {
    checkRaw(value);
    const data = record(value, [
        'schemaVersion',
        'id',
        'repository',
        'worktree',
        'commonGitDir',
        'kind',
        'paths',
        'targets',
    ]);
    version(data.schemaVersion);
    async function physical(value: unknown): Promise<string> {
        const directory = opaque(value);
        if (!path.isAbsolute(directory))
            throw new InputError('Invalid input scope: paths must be physical absolute directories.');
        try {
            const actual = await realpath(directory);
            if (path.relative(path.resolve(directory), actual) !== '' || !(await stat(actual)).isDirectory())
                throw new Error('physical');
            return actual;
        } catch {
            throw new InputError('Invalid input scope: directory is missing or not physical.');
        }
    }
    const paths = unique(
        list(data.paths, (item) => {
            if (typeof item !== 'string' || item.length === 0) throw new InputError('Invalid input scope: empty path.');
            const file = item;
            if (
                file.includes('\\') ||
                path.posix.isAbsolute(file) ||
                /^[A-Za-z]:/.test(file) ||
                file.split('/').some((part) => !part || part === '.' || part === '..')
            )
                throw new InputError('Invalid input scope: paths must be repository-relative.');
            return file;
        }),
    );
    const targets = list(data.targets, (item) => {
        const target = record(item, ['role', 'objectId']);
        const objectId = text(target.objectId);
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId))
            throw new InputError('Invalid input scope: unresolved target object.');
        return { role: text(target.role), objectId };
    }).sort((a, b) => ordinal(a.role, b.role) || ordinal(a.objectId, b.objectId));
    if (new Set(targets.map((target) => target.role)).size !== targets.length)
        throw new InputError('Invalid input scope: duplicate target role.');
    const kind = text(data.kind);
    if (!['commit', 'amend', 'rebase', 'cherry-pick', 'squash', 'merge'].includes(kind))
        throw new InputError('Invalid input scope: unsupported operation kind.');
    return {
        schemaVersion: 1,
        id: opaque(data.id),
        repository: await physical(data.repository),
        worktree: await physical(data.worktree),
        commonGitDir: await physical(data.commonGitDir),
        kind,
        paths,
        targets,
    };
}

function parseEvidence(value: unknown): Evidence {
    const data = record(value, ['fields', 'kind', 'observation', 'reference', 'detail', 'nativeReasoning', 'mapping']);
    const fields = unique(list(data.fields, text));
    if (!fields.length || fields.some((field) => !['agent', 'host', 'model', 'reasoning'].includes(field)))
        throw new InputError('Invalid input: unsupported evidence field.');
    const observation = text(data.observation);
    if (!['effective', 'requested', 'capability', 'display'].includes(observation))
        throw new InputError('Invalid input: unsupported observation.');
    const evidence: Evidence = { fields, kind: text(data.kind), observation, reference: text(data.reference) };
    if (data.detail !== undefined) evidence.detail = text(data.detail);
    if (data.nativeReasoning !== undefined) {
        evidence.nativeReasoning = text(data.nativeReasoning);
        if (!['enabled', 'disabled'].includes(evidence.nativeReasoning))
            throw new InputError('Invalid input: unsupported native reasoning observation.');
    }
    if (data.mapping !== undefined) {
        const mapping = record(data.mapping, ['route', 'model']);
        evidence.mapping = { route: text(mapping.route), model: identity(mapping.model, 'model') };
    }
    return evidence;
}
function parseEvent(value: unknown): Event {
    const data = record(value, [
        'id',
        'participantId',
        'task',
        'agent',
        'host',
        'model',
        'modelRoute',
        'reasoning',
        'evidence',
    ]);
    const reasoning = record(data.reasoning, ['state', 'value']);
    if (reasoning.state !== 'unknown' && reasoning.state !== 'confirmed')
        throw new InputError('Invalid input: unsupported reasoning state.');
    if (reasoning.state === 'unknown' && reasoning.value !== undefined)
        throw new InputError('Invalid input: unknown reasoning has no value.');
    const event: Event = {
        id: opaque(data.id),
        participantId: opaque(data.participantId),
        task: text(data.task),
        reasoning:
            reasoning.state === 'unknown'
                ? { state: 'unknown' }
                : { state: 'confirmed', value: identity(reasoning.value, 'reasoning') },
        evidence: list(data.evidence, parseEvidence),
    };
    for (const field of ['agent', 'host', 'model', 'modelRoute'] as const)
        if (data[field] !== undefined)
            event[field] = field === 'model' ? identity(data[field], 'model') : text(data[field]);
    if ([event.agent, event.host].some((field) => field && /[:()<>]/u.test(field)))
        throw new InputError('Invalid input: ambiguous Agent host field.');
    return event;
}

export async function parseLedger(value: unknown): Promise<Ledger> {
    checkRaw(value);
    const data = record(value, ['schemaVersion', 'operation', 'knownParticipants', 'events', 'userExceptions']);
    version(data.schemaVersion);
    const operation = await parseOperation(data.operation);
    const knownParticipants = list(data.knownParticipants, (item) => {
        const participant = record(item, ['id', 'eventIds']);
        return { id: opaque(participant.id), eventIds: unique(list(participant.eventIds, opaque)) };
    });
    if (new Set(knownParticipants.map((item) => item.id)).size !== knownParticipants.length)
        throw new InputError('Invalid input: duplicate participant.');
    const events = list(data.events, parseEvent);
    const associations = new Map<string, string>();
    for (const event of events) {
        const association = JSON.stringify([event.participantId, event.task]);
        if (associations.has(event.id) && associations.get(event.id) !== association)
            throw new InputError('Invalid input: conflicting event association.');
        associations.set(event.id, association);
    }
    for (const participant of knownParticipants)
        for (const id of participant.eventIds)
            if (events.some((event) => event.id === id && event.participantId !== participant.id))
                throw new InputError('Invalid input: participant/event join mismatch.');
    const userExceptions = list(data.userExceptions, (item) => {
        const exception = record(item, ['operationId', 'issueIds', 'decision', 'reference']);
        const result = {
            operationId: opaque(exception.operationId),
            issueIds: unique(list(exception.issueIds, opaque)),
            decision: text(exception.decision),
            reference: text(exception.reference),
        };
        if (result.operationId !== operation.id) throw new InputError('Invalid input scope: stale user exception.');
        if (!result.issueIds.length) throw new InputError('Invalid input: exception needs concrete issue IDs.');
        return result;
    });
    return { schemaVersion: 1, operation, events, knownParticipants, userExceptions };
}

export function parseRegistry(value: unknown): Registry {
    checkRaw(value);
    if (!isRecord(value)) throw new InputError('Invalid input: registry shape.');
    version(value.schemaVersion);
    const aliases = new Set<string>();
    const ambiguousAliases = unique(list(value.ambiguousAliases, text));
    const hosts = list(value.hosts, (item) => {
        if (!isRecord(item)) throw new InputError('Invalid input: registry host.');
        const name = text(item.name);
        const hostAliases = list(item.aliases, text);
        for (const alias of [name, ...hostAliases]) {
            if (aliases.has(alias) || ambiguousAliases.includes(alias))
                throw new InputError('Invalid input: ambiguous registry alias.');
            aliases.add(alias);
        }
        return { name, aliases: hostAliases, family: text(item.family) };
    });
    const familyAliases: Record<string, string> = {};
    const suppliedAliases = value.familyAliases ?? {};
    if (!isRecord(suppliedAliases)) throw new InputError('Invalid input: family alias mapping.');
    for (const [alias, family] of Object.entries(suppliedAliases)) {
        if (
            !ambiguousAliases.includes(alias) ||
            typeof family !== 'string' ||
            !hosts.some((host) => host.family === family) ||
            aliases.has(alias)
        )
            throw new InputError('Invalid input: family alias must identify one registered ambiguous family.');
        Object.defineProperty(familyAliases, alias, { value: family, enumerable: true });
    }
    return { schemaVersion: 1, hosts, ambiguousAliases, familyAliases };
}
