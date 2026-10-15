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
export type ConfirmedIdentity = { agent: string; model: string; reasoning?: string };
export type Blocker = { id: string; reason: string };
export type Ledger = {
    schemaVersion: 2;
    ledgerId: string;
    operation: Operation;
    identities: ConfirmedIdentity[];
    blockers: Blocker[];
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

/** Portable historical shape only: this never establishes local physical scope or Git authority. */
export function parseOperationShape(value: unknown): Operation {
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
        repository: opaque(data.repository),
        worktree: opaque(data.worktree),
        commonGitDir: opaque(data.commonGitDir),
        kind,
        paths,
        targets,
    };
}

/** Current scope additionally requires existing physical local directories, never merely a portable shape. */
export async function parseOperation(value: unknown): Promise<Operation> {
    const operation = parseOperationShape(value);
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
    return {
        ...operation,
        repository: await physical(operation.repository),
        worktree: await physical(operation.worktree),
        commonGitDir: await physical(operation.commonGitDir),
    };
}

/** Inputs are already confirmed by the caller; parsing never infers dispatch or native settings. */
export function parseIdentity(value: unknown): ConfirmedIdentity {
    checkRaw(value);
    const data = record(value, ['agent', 'model', 'reasoning']);
    const agent = text(data.agent);
    if (/[:()<>]/u.test(agent) || ['unknown', 'n/a', 'null'].includes(agent.toLowerCase()))
        throw new InputError('Invalid input: ambiguous Agent host field.');
    const model = identity(data.model, 'model');
    if (['auto', 'latest', 'unknown', 'n/a', 'null'].includes(model.toLowerCase()))
        throw new InputError('Invalid input: an actual formal model is required.');
    const reasoning = data.reasoning === undefined ? undefined : identity(data.reasoning, 'reasoning');
    if (
        reasoning !== undefined &&
        ['unknown', 'off', 'n/a', 'n-a', 'null', 'auto', 'latest'].includes(reasoning.toLowerCase())
    )
        throw new InputError('Invalid input: omit unknown reasoning; confirmed disabled reasoning must use none.');
    return { agent, model, ...(reasoning !== undefined ? { reasoning } : {}) };
}

export function canonicalizeIdentity(value: ConfirmedIdentity, registry: Registry): ConfirmedIdentity {
    const parsed = parseIdentity(value);
    const matches = registry.hosts.filter((host) => host.name === parsed.agent || host.aliases.includes(parsed.agent));
    if (matches.length !== 1 || registry.ambiguousAliases.includes(parsed.agent))
        throw new InputError('Invalid input: Agent must be an exact registered host or unique explicit alias.');
    const host = matches[0];
    if (!host) throw new InputError('Invalid input: unregistered Agent host.');
    return parseIdentity({ ...parsed, agent: host.name });
}
export const identityKey = (value: ConfirmedIdentity): string =>
    JSON.stringify([value.agent, value.model, value.reasoning ?? null]);
export function normalizeIdentities(values: readonly ConfirmedIdentity[], registry: Registry): ConfirmedIdentity[] {
    const identities = new Map<string, ConfirmedIdentity>();
    for (const value of values) {
        const normalized = canonicalizeIdentity(value, registry);
        identities.set(identityKey(normalized), normalized);
    }
    return [...identities.values()].sort(
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
    );
}

export async function parseLedger(value: unknown): Promise<Ledger> {
    checkRaw(value);
    if (isRecord(value) && value.schemaVersion !== 2)
        throw new InputError(
            'Invalid input: migrate old event ledgers to schemaVersion 2 confirmed identities and blockers.',
        );
    const data = record(value, ['schemaVersion', 'ledgerId', 'operation', 'identities', 'blockers']);
    if (data.schemaVersion !== 2) throw new InputError('Invalid input: ledger schemaVersion must be 2.');
    const ledgerId = opaque(data.ledgerId);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ledgerId))
        throw new InputError('Invalid input: ledgerId must be a UUID.');
    const operation = await parseOperation(data.operation);
    const identities = list(data.identities, parseIdentity);
    const blockers = list(data.blockers, (item) => {
        const blocker = record(item, ['id', 'reason']);
        return { id: opaque(blocker.id), reason: text(blocker.reason) };
    });
    if (new Set(blockers.map((blocker) => blocker.id)).size !== blockers.length)
        throw new InputError('Invalid input: duplicate blocker ID.');
    return { schemaVersion: 2, ledgerId, operation, identities, blockers };
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
