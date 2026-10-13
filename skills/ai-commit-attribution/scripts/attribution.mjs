// src/attribution.ts
import { fileURLToPath } from "node:url";

// tooling/cli-entry.ts
function isMainModule(metadata) {
  if (typeof metadata.main !== "boolean")
    throw new Error("CLI entry detection requires the supported Node 24 runtime with import.meta.main.");
  return metadata.main;
}

// tooling/file-evidence.ts
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
function sameFile(expected, actual) {
  return actual.isFile() && !actual.isSymbolicLink() && expected.dev === actual.dev && expected.ino === actual.ino;
}
function unchanged(expected, actual) {
  return sameFile(expected, actual) && expected.size === actual.size && expected.mtimeNs === actual.mtimeNs && expected.ctimeNs === actual.ctimeNs;
}
async function readRegularFile(file, io = {}) {
  const inspect = io.lstat ?? ((name) => lstat(name, { bigint: true }));
  const acquire = io.open ?? (async (name, flags) => {
    const handle2 = await open(name, flags);
    return {
      stat: () => handle2.stat({ bigint: true }),
      readFile: () => handle2.readFile(),
      close: () => handle2.close()
    };
  });
  const handle = await acquire(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Evidence must be a regular file without links.");
    if (io.singleLink && before.nlink !== 1n) throw new Error("Output evidence must have a single link.");
    if (!unchanged(before, await inspect(file))) throw new Error("Evidence file identity or metadata changed.");
    if (io.physicalPath && path.relative(path.resolve(file), await realpath(file)) !== "")
      throw new Error("Evidence path must be physical and contain no links.");
    const bytes = await handle.readFile();
    if (!unchanged(before, await handle.stat()) || !unchanged(before, await inspect(file)) || BigInt(bytes.length) !== before.size)
      throw new Error("Evidence file identity or metadata changed.");
    if (io.physicalPath && path.relative(path.resolve(file), await realpath(file)) !== "")
      throw new Error("Evidence path changed during descriptor read.");
    return bytes;
  } finally {
    await handle.close();
  }
}

// src/records.ts
import { realpath as realpath2, stat } from "node:fs/promises";
import path2 from "node:path";

// tooling/errors.ts
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/records.ts
var InputError = class extends Error {
};
var ordinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var unique = (values) => [...new Set(values)].sort(ordinal);
function checkRaw(value) {
  if (typeof value === "string" && /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))
    throw new InputError("Invalid input: raw field contains a control or line separator.");
  if (Array.isArray(value)) value.forEach(checkRaw);
  else if (isRecord(value))
    Object.entries(value).forEach(([key, item]) => {
      checkRaw(key);
      checkRaw(item);
    });
}
function record(value, keys) {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new InputError("Invalid input: unexpected object shape.");
  return value;
}
function text(value) {
  if (typeof value !== "string" || !value.trim()) throw new InputError("Invalid input: expected a nonempty string.");
  return value.trim();
}
function opaque(value) {
  text(value);
  return value;
}
function list(value, parse) {
  if (!Array.isArray(value)) throw new InputError("Invalid input: expected an array.");
  return value.map(parse);
}
function identity(value) {
  const result = text(value);
  if (/[:()<>]|\s/u.test(result)) throw new InputError("Invalid input: ambiguous single-line identity field.");
  return result;
}
function version(value) {
  if (value !== 1) throw new InputError("Invalid input: schemaVersion must be 1.");
}
async function parseOperation(value) {
  checkRaw(value);
  const data = record(value, [
    "schemaVersion",
    "id",
    "repository",
    "worktree",
    "commonGitDir",
    "kind",
    "paths",
    "targets"
  ]);
  version(data.schemaVersion);
  async function physical(value2) {
    const directory = opaque(value2);
    if (!path2.isAbsolute(directory))
      throw new InputError("Invalid input scope: paths must be physical absolute directories.");
    try {
      const actual = await realpath2(directory);
      if (path2.relative(path2.resolve(directory), actual) !== "" || !(await stat(actual)).isDirectory())
        throw new Error("physical");
      return actual;
    } catch {
      throw new InputError("Invalid input scope: directory is missing or not physical.");
    }
  }
  const paths = unique(
    list(data.paths, (item) => {
      if (typeof item !== "string" || item.length === 0) throw new InputError("Invalid input scope: empty path.");
      const file = item;
      if (file.includes("\\") || path2.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split("/").some((part) => !part || part === "." || part === ".."))
        throw new InputError("Invalid input scope: paths must be repository-relative.");
      return file;
    })
  );
  const targets = list(data.targets, (item) => {
    const target = record(item, ["role", "objectId"]);
    const objectId = text(target.objectId);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId))
      throw new InputError("Invalid input scope: unresolved target object.");
    return { role: text(target.role), objectId };
  }).sort((a, b) => ordinal(a.role, b.role) || ordinal(a.objectId, b.objectId));
  if (new Set(targets.map((target) => target.role)).size !== targets.length)
    throw new InputError("Invalid input scope: duplicate target role.");
  const kind = text(data.kind);
  if (!["commit", "amend", "rebase", "cherry-pick", "squash"].includes(kind))
    throw new InputError("Invalid input scope: unsupported operation kind.");
  return {
    schemaVersion: 1,
    id: opaque(data.id),
    repository: await physical(data.repository),
    worktree: await physical(data.worktree),
    commonGitDir: await physical(data.commonGitDir),
    kind,
    paths,
    targets
  };
}
function parseEvidence(value) {
  const data = record(value, ["fields", "kind", "observation", "reference", "detail", "nativeReasoning", "mapping"]);
  const fields = unique(list(data.fields, text));
  if (!fields.length || fields.some((field) => !["agent", "host", "model", "reasoning"].includes(field)))
    throw new InputError("Invalid input: unsupported evidence field.");
  const observation = text(data.observation);
  if (!["effective", "requested", "capability", "display"].includes(observation))
    throw new InputError("Invalid input: unsupported observation.");
  const evidence = { fields, kind: text(data.kind), observation, reference: text(data.reference) };
  if (data.detail !== void 0) evidence.detail = text(data.detail);
  if (data.nativeReasoning !== void 0) {
    evidence.nativeReasoning = text(data.nativeReasoning);
    if (!["enabled", "disabled"].includes(evidence.nativeReasoning))
      throw new InputError("Invalid input: unsupported native reasoning observation.");
  }
  if (data.mapping !== void 0) {
    const mapping = record(data.mapping, ["route", "model"]);
    evidence.mapping = { route: text(mapping.route), model: identity(mapping.model) };
  }
  return evidence;
}
function parseEvent(value) {
  const data = record(value, [
    "id",
    "participantId",
    "task",
    "agent",
    "host",
    "model",
    "modelRoute",
    "reasoning",
    "evidence"
  ]);
  const reasoning = record(data.reasoning, ["state", "value"]);
  if (reasoning.state !== "unknown" && reasoning.state !== "confirmed")
    throw new InputError("Invalid input: unsupported reasoning state.");
  if (reasoning.state === "unknown" && reasoning.value !== void 0)
    throw new InputError("Invalid input: unknown reasoning has no value.");
  const event = {
    id: opaque(data.id),
    participantId: opaque(data.participantId),
    task: text(data.task),
    reasoning: reasoning.state === "unknown" ? { state: "unknown" } : { state: "confirmed", value: identity(reasoning.value) },
    evidence: list(data.evidence, parseEvidence)
  };
  for (const field of ["agent", "host", "model", "modelRoute"])
    if (data[field] !== void 0) event[field] = field === "model" ? identity(data[field]) : text(data[field]);
  if ([event.agent, event.host].some((field) => field && /[:()<>]/u.test(field)))
    throw new InputError("Invalid input: ambiguous Agent host field.");
  return event;
}
async function parseLedger(value) {
  checkRaw(value);
  const data = record(value, ["schemaVersion", "operation", "knownParticipants", "events", "userExceptions"]);
  version(data.schemaVersion);
  const operation = await parseOperation(data.operation);
  const knownParticipants = list(data.knownParticipants, (item) => {
    const participant = record(item, ["id", "eventIds"]);
    return { id: opaque(participant.id), eventIds: unique(list(participant.eventIds, opaque)) };
  });
  if (new Set(knownParticipants.map((item) => item.id)).size !== knownParticipants.length)
    throw new InputError("Invalid input: duplicate participant.");
  const events = list(data.events, parseEvent);
  const associations = /* @__PURE__ */ new Map();
  for (const event of events) {
    const association = JSON.stringify([event.participantId, event.task]);
    if (associations.has(event.id) && associations.get(event.id) !== association)
      throw new InputError("Invalid input: conflicting event association.");
    associations.set(event.id, association);
  }
  for (const participant of knownParticipants)
    for (const id of participant.eventIds)
      if (events.some((event) => event.id === id && event.participantId !== participant.id))
        throw new InputError("Invalid input: participant/event join mismatch.");
  const userExceptions = list(data.userExceptions, (item) => {
    const exception = record(item, ["operationId", "issueIds", "decision", "reference"]);
    const result = {
      operationId: opaque(exception.operationId),
      issueIds: unique(list(exception.issueIds, opaque)),
      decision: text(exception.decision),
      reference: text(exception.reference)
    };
    if (result.operationId !== operation.id) throw new InputError("Invalid input scope: stale user exception.");
    if (!result.issueIds.length) throw new InputError("Invalid input: exception needs concrete issue IDs.");
    return result;
  });
  return { schemaVersion: 1, operation, events, knownParticipants, userExceptions };
}
function parseRegistry(value) {
  checkRaw(value);
  if (!isRecord(value)) throw new InputError("Invalid input: registry shape.");
  version(value.schemaVersion);
  const aliases = /* @__PURE__ */ new Set();
  const ambiguousAliases = unique(list(value.ambiguousAliases, text));
  const hosts = list(value.hosts, (item) => {
    if (!isRecord(item)) throw new InputError("Invalid input: registry host.");
    const name = text(item.name);
    const hostAliases = list(item.aliases, text);
    for (const alias of [name, ...hostAliases]) {
      if (aliases.has(alias) || ambiguousAliases.includes(alias))
        throw new InputError("Invalid input: ambiguous registry alias.");
      aliases.add(alias);
    }
    return { name, aliases: hostAliases, family: text(item.family) };
  });
  const familyAliases = {};
  const suppliedAliases = value.familyAliases ?? {};
  if (!isRecord(suppliedAliases)) throw new InputError("Invalid input: family alias mapping.");
  for (const [alias, family] of Object.entries(suppliedAliases)) {
    if (!ambiguousAliases.includes(alias) || typeof family !== "string" || !hosts.some((host) => host.family === family) || aliases.has(alias))
      throw new InputError("Invalid input: family alias must identify one registered ambiguous family.");
    Object.defineProperty(familyAliases, alias, { value: family, enumerable: true });
  }
  return { schemaVersion: 1, hosts, ambiguousAliases, familyAliases };
}

// src/summarize.ts
function effective(event, field) {
  return event.evidence.some((item) => item.observation === "effective" && item.fields.includes(field));
}
function resolveAgent(event, registry, hostNames) {
  if (!event.agent || !effective(event, "agent")) return;
  const exact = registry.hosts.find((host) => host.name === event.agent || host.aliases.includes(event.agent ?? ""));
  const contextual = hostNames.length === 1 ? registry.hosts.find((host) => host.name === hostNames[0]) : void 0;
  if (exact) return !contextual || exact.name === contextual.name ? exact.name : void 0;
  if (contextual && registry.ambiguousAliases.includes(event.agent) && contextual.family === (Object.hasOwn(registry.familyAliases, event.agent) ? registry.familyAliases[event.agent] : event.agent))
    return contextual.name;
  return;
}
function formalCandidate(value) {
  return value !== void 0 && !["auto", "latest", "unknown", "n/a", "null"].includes(value.toLowerCase());
}
function resolveModels(records) {
  const observations = records.filter((event) => effective(event, "model"));
  const candidates = unique(observations.map((event) => event.model).filter(formalCandidate));
  const routes = unique(observations.map((event) => event.modelRoute).filter((route) => route !== void 0));
  const mappings = observations.flatMap(
    (event) => event.evidence.filter((item) => item.observation === "effective" && item.fields.includes("model")).flatMap((item) => item.mapping ? [{ event, mapping: item.mapping }] : [])
  );
  const values = unique([...candidates, ...mappings.map((item) => item.mapping.model).filter(formalCandidate)]);
  const conflict = values.length > 1 || mappings.some(
    ({ event, mapping }) => !formalCandidate(mapping.model) || formalCandidate(event.model) && event.model !== mapping.model || (event.modelRoute !== void 0 ? event.modelRoute !== mapping.route : !routes.includes(mapping.route))
  );
  const covered = routes.every(
    (route) => mappings.some(({ mapping }) => mapping.route === route && mapping.model === candidates[0])
  );
  return { values: covered ? candidates : [], conflict };
}
function resolveReasoning(event) {
  if (event.reasoning.state !== "confirmed") return { conflict: false };
  const value = event.reasoning.value;
  const native = unique(
    event.evidence.filter(
      (item) => item.observation === "effective" && item.fields.includes("reasoning") && item.nativeReasoning
    ).map((item) => item.nativeReasoning ?? "")
  );
  if (native.length > 1) return { conflict: true };
  if (native[0] === "disabled") return { value: "none", conflict: false };
  if (native[0] === "enabled" && !["none", "unknown", "N/A", "null", "off"].includes(value))
    return { value, conflict: false };
  return { conflict: false };
}
async function summarize(input, currentOperation, registryInput) {
  const ledger = await parseLedger(input);
  const operation = await parseOperation(currentOperation);
  if (JSON.stringify(ledger.operation) !== JSON.stringify(operation))
    throw new InputError("Invalid input scope: ledger and current operation differ.");
  const registry = parseRegistry(registryInput);
  const issues = [];
  const diagnostics = [];
  const tuples = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  for (const event of ledger.events) groups.set(event.id, [...groups.get(event.id) ?? [], event]);
  const participants = unique([
    ...ledger.knownParticipants.map((item) => item.id),
    ...ledger.events.map((item) => item.participantId)
  ]).map((id) => ({
    id,
    declared: ledger.knownParticipants.some((item) => item.id === id),
    eventIds: unique(ledger.events.filter((event) => event.participantId === id).map((event) => event.id))
  }));
  for (const participant of ledger.knownParticipants) {
    for (const eventId of participant.eventIds)
      if (!groups.has(eventId))
        issues.push({
          id: JSON.stringify(["participant", participant.id, "event", eventId]),
          code: "missing-event",
          participantId: participant.id,
          eventId
        });
    if (!ledger.events.some((event) => event.participantId === participant.id))
      issues.push({
        id: JSON.stringify(["participant", participant.id, "events"]),
        code: "missing-participant-event",
        participantId: participant.id
      });
  }
  const events = [...groups].sort(([a], [b]) => ordinal(a, b)).map(([eventId, records]) => {
    const first = records[0];
    if (!first) throw new Error("Event grouping failed.");
    const hostCandidates = records.filter((event) => event.host && effective(event, "host")).map((event) => event.host);
    const hostNames = unique(
      hostCandidates.map(
        (candidate) => registry.hosts.find(
          (host) => host.name === candidate || host.aliases.includes(candidate ?? "")
        )?.name
      ).filter((value) => value !== void 0)
    );
    const candidateAgents = records.filter((event) => event.agent && effective(event, "agent")).map((event) => resolveAgent(event, registry, hostNames));
    const invalidHost = hostNames.length > 1 || hostCandidates.some(
      (candidate) => !registry.hosts.some(
        (host) => host.name === candidate || host.aliases.includes(candidate ?? "")
      )
    );
    const agents = invalidHost || candidateAgents.some((agent2) => agent2 === void 0) ? [] : unique(candidateAgents.filter((value) => value !== void 0));
    const modelResolution = resolveModels(records);
    const models = modelResolution.values;
    const reasoningObservations = records.map(resolveReasoning);
    const efforts = unique(
      reasoningObservations.map((item) => item.value).filter((value) => value !== void 0)
    );
    const reasoningConflict = efforts.length > 1 || reasoningObservations.some((item) => item.conflict);
    for (const [field, values] of [
      ["agent", agents],
      ["model", models]
    ]) {
      if (values.length !== 1 || field === "model" && modelResolution.conflict)
        issues.push({
          id: JSON.stringify(["event", eventId, field]),
          code: values.length > 1 || field === "model" && modelResolution.conflict ? `conflicting-${field}` : `unresolved-${field}`,
          eventId,
          participantId: first.participantId
        });
    }
    const reasoning = !reasoningConflict && efforts.length === 1 ? efforts[0] : void 0;
    if (!reasoning)
      diagnostics.push({
        id: JSON.stringify(["event", eventId, "reasoning"]),
        code: reasoningConflict ? "conflicting-reasoning" : "unknown-reasoning",
        eventId,
        participantId: first.participantId
      });
    const agent = agents.length === 1 ? agents[0] : void 0;
    const model = !modelResolution.conflict && models.length === 1 ? models[0] : void 0;
    if (agent && model) {
      const key = JSON.stringify([agent, model, reasoning ?? null]);
      const tuple = tuples.get(key) ?? {
        agent,
        model,
        ...reasoning ? { reasoning } : {},
        participantIds: [],
        eventIds: []
      };
      tuple.participantIds = unique([...tuple.participantIds, first.participantId]);
      tuple.eventIds = unique([...tuple.eventIds, eventId]);
      tuples.set(key, tuple);
    }
    return {
      id: eventId,
      participantId: first.participantId,
      task: first.task,
      ...agent ? { agent } : {},
      ...model ? { model } : {},
      ...reasoning ? { reasoning } : {},
      records: records.map((event) => ({ ...event, evidence: event.evidence.map((item) => ({ ...item })) }))
    };
  });
  const issueIds = new Set(issues.map((issue) => issue.id));
  if (ledger.userExceptions.some((exception) => exception.issueIds.some((id) => !issueIds.has(id))))
    throw new InputError("Invalid input: exception references an absent concrete issue.");
  return {
    schemaVersion: 1,
    operation,
    exitCode: issues.length ? 20 : 0,
    tuples: [...tuples.values()].sort(
      (a, b) => ordinal(a.agent, b.agent) || ordinal(a.model, b.model) || (a.reasoning === void 0 ? b.reasoning === void 0 ? 0 : -1 : b.reasoning === void 0 ? 1 : ordinal(a.reasoning, b.reasoning))
    ),
    events,
    participants,
    issues: issues.sort((a, b) => ordinal(a.id, b.id)),
    diagnostics,
    userExceptions: ledger.userExceptions,
    limitations: [
      "Supplied evidence is a declaration; this summary cannot authenticate runtime dispatch, handoffs, mappings or user consent.",
      "Declared participant accounting cannot prove that no contributing actors were undisclosed.",
      "Matching supplied physical scope does not prove the live Git operation or its freshness.",
      "Summary completion is not repository-policy validation or authorization to commit or modify Git state."
    ]
  };
}

// src/attribution.ts
function parseArguments(args) {
  const values = [...args];
  if (values.shift() !== "summarize")
    throw new InputError("Usage: attribution.mjs summarize --input <ledger.json> --operation <operation.json>");
  const options = /* @__PURE__ */ new Map();
  while (values.length) {
    const flag = values.shift();
    const value = values.shift();
    if (!flag || !["--input", "--operation"].includes(flag) || options.has(flag) || !value || value.startsWith("--"))
      throw new InputError("Invalid input: unknown/duplicate flag or missing value.");
    options.set(flag, value);
  }
  const input = options.get("--input");
  const operation = options.get("--operation");
  if (!input || !operation)
    throw new InputError("Invalid input: explicit ledger and current operation files are required.");
  return { input, operation };
}
async function jsonFile(file) {
  let bytes;
  try {
    bytes = await readRegularFile(typeof file === "string" ? file : fileURLToPath(file), { physicalPath: true });
  } catch {
    throw new InputError("Invalid input: cannot safely read the explicit JSON resource.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InputError("Invalid input: malformed UTF-8 JSON resource.");
  }
}
async function run(args) {
  const options = parseArguments(args);
  const [ledger, operation, registry] = await Promise.all([
    jsonFile(options.input),
    jsonFile(options.operation),
    jsonFile(new URL("../references/agent-registry.json", import.meta.url))
  ]);
  return summarize(ledger, operation, registry);
}
if (isMainModule(import.meta)) {
  try {
    const result = await run(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 4));
    process.exitCode = result.exitCode;
  } catch (error) {
    const input = error instanceof InputError;
    console.error(
      JSON.stringify({ error: input ? error.message : "Summary execution failed.", exitCode: input ? 2 : 1 })
    );
    process.exitCode = input ? 2 : 1;
  }
}
export {
  parseArguments,
  run
};
