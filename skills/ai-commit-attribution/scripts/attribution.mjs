var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// tooling/errors.ts
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorCode(error) {
  return isRecord(error) && typeof error.code === "string" ? error.code : void 0;
}
var init_errors = __esm({
  "tooling/errors.ts"() {
    "use strict";
  }
});

// src/records.ts
import { realpath as realpath2, stat } from "node:fs/promises";
import path2 from "node:path";
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
  async function physical2(value2) {
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
    const objectId2 = text(target.objectId);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(objectId2))
      throw new InputError("Invalid input scope: unresolved target object.");
    return { role: text(target.role), objectId: objectId2 };
  }).sort((a, b) => ordinal(a.role, b.role) || ordinal(a.objectId, b.objectId));
  if (new Set(targets.map((target) => target.role)).size !== targets.length)
    throw new InputError("Invalid input scope: duplicate target role.");
  const kind = text(data.kind);
  if (!["commit", "amend", "rebase", "cherry-pick", "squash", "merge"].includes(kind))
    throw new InputError("Invalid input scope: unsupported operation kind.");
  return {
    schemaVersion: 1,
    id: opaque(data.id),
    repository: await physical2(data.repository),
    worktree: await physical2(data.worktree),
    commonGitDir: await physical2(data.commonGitDir),
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
var InputError, ordinal, unique;
var init_records = __esm({
  "src/records.ts"() {
    "use strict";
    init_errors();
    InputError = class extends Error {
    };
    ordinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    unique = (values) => [...new Set(values)].sort(ordinal);
  }
});

// src/summarize.ts
var summarize_exports = {};
__export(summarize_exports, {
  summarize: () => summarize
});
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
var init_summarize = __esm({
  "src/summarize.ts"() {
    "use strict";
    init_records();
  }
});

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
function samePhysicalPath(expected, actual) {
  return path.relative(path.toNamespacedPath(path.resolve(expected)), path.toNamespacedPath(actual)) === "";
}
async function readRegularFile(file, io = {}) {
  const inspect = io.lstat ?? ((name) => lstat(name, { bigint: true }));
  const acquire = io.open ?? (async (name, flags) => {
    const handle2 = await open(name, flags);
    return {
      stat: () => handle2.stat({ bigint: true }),
      readFile: async (maximumBytes) => {
        if (maximumBytes === void 0) return handle2.readFile();
        const chunks = [];
        let length = 0;
        for (; ; ) {
          const chunk = Buffer.alloc(Math.min(64 * 1024, maximumBytes - length + 1));
          const { bytesRead } = await handle2.read(chunk, 0, chunk.length, null);
          if (!bytesRead) return Buffer.concat(chunks, length);
          length += bytesRead;
          if (length > maximumBytes) throw new Error("Evidence byte budget exceeded.");
          chunks.push(chunk.subarray(0, bytesRead));
        }
      },
      close: () => handle2.close()
    };
  });
  const handle = await acquire(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Evidence must be a regular file without links.");
    if (io.maximumBytes !== void 0 && (!Number.isSafeInteger(io.maximumBytes) || io.maximumBytes < 0 || before.size > BigInt(io.maximumBytes)))
      throw new Error("Evidence byte budget exceeded.");
    if (io.singleLink && before.nlink !== 1n) throw new Error("Output evidence must have a single link.");
    if (!unchanged(before, await inspect(file))) throw new Error("Evidence file identity or metadata changed.");
    if (io.physicalPath && !samePhysicalPath(file, await realpath(file)))
      throw new Error("Evidence path must be physical and contain no links.");
    const bytes = await handle.readFile(io.maximumBytes);
    if (!unchanged(before, await handle.stat()) || !unchanged(before, await inspect(file)) || BigInt(bytes.length) !== before.size)
      throw new Error("Evidence file identity or metadata changed.");
    if (io.physicalPath && !samePhysicalPath(file, await realpath(file)))
      throw new Error("Evidence path changed during descriptor read.");
    return bytes;
  } finally {
    await handle.close();
  }
}

// src/policy-contract.ts
init_errors();
init_records();
import path3 from "node:path";
var LIMITS = Object.freeze({
  profile: "policy-scan-v1",
  inputBytes: 2 * 1024 * 1024,
  paths: 1e4,
  files: 128,
  fileBytes: 256 * 1024,
  bytes: 4 * 1024 * 1024,
  candidates: 256,
  ancestors: 64,
  directoryLevels: 16,
  referenceHops: 8,
  entries: 4096
});
function object(value, keys) {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new InputError("Invalid policy input shape or unknown member.");
  return value;
}
function strings(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new InputError("Invalid policy string list.");
  value.forEach(checkRaw);
  const result = value.map((item) => {
    text(item);
    return item;
  });
  if (new Set(result).size !== result.length) throw new InputError("Duplicate policy identifier.");
  return unique(result);
}
function absolute(value) {
  text(value);
  const result = value;
  if (!path3.isAbsolute(result)) throw new InputError("Policy locator must be absolute.");
  return result;
}
function parseContext(value) {
  checkRaw(value);
  const data = object(value, ["schemaVersion", "phase", "selection", "additionalCandidatePaths", "invocation"]);
  if (data.schemaVersion !== 1 || !["prepare", "edit-message"].includes(text(data.phase)) || !["index", "specified-paths", "all-tracked", "operation-targets", "planned-paths"].includes(
    text(data.selection)
  ))
    throw new InputError("Unsupported scope context version, phase or selection.");
  const supplied = object(data.invocation, [
    "kind",
    "reference",
    "effectiveDirectory",
    "repositoryPath",
    "gitDirectory",
    "worktreePath",
    "adapter"
  ]);
  const invocation = {
    kind: text(supplied.kind),
    reference: text(supplied.reference),
    effectiveDirectory: absolute(supplied.effectiveDirectory)
  };
  if (!["direct-git", "wrapper-adapter", "agent-context"].includes(invocation.kind))
    throw new InputError("Unsupported invocation kind.");
  for (const field of ["repositoryPath", "gitDirectory", "worktreePath"])
    if (supplied[field] !== void 0) invocation[field] = absolute(supplied[field]);
  if (supplied.adapter !== void 0) invocation.adapter = text(supplied.adapter);
  const context = {
    schemaVersion: 1,
    phase: text(data.phase),
    selection: text(data.selection),
    invocation
  };
  if (data.additionalCandidatePaths !== void 0)
    context.additionalCandidatePaths = strings(data.additionalCandidatePaths).map(absolute);
  return context;
}
function parseBinding(value) {
  const data = object(value, [
    "canonicalizationVersion",
    "gitDirectory",
    "commonGitDir",
    "scopeDigest",
    "gitStateDigest",
    "pathStateDigest",
    "invocationDigest",
    "evidenceDigest",
    "scanDigest"
  ]);
  checkRaw(data);
  if (data.canonicalizationVersion !== 1) throw new InputError("Unsupported binding canonicalization version.");
  const result = {
    canonicalizationVersion: 1,
    gitDirectory: absolute(data.gitDirectory),
    commonGitDir: absolute(data.commonGitDir),
    scopeDigest: "",
    gitStateDigest: "",
    pathStateDigest: "",
    invocationDigest: "",
    evidenceDigest: "",
    scanDigest: ""
  };
  for (const field of [
    "scopeDigest",
    "gitStateDigest",
    "pathStateDigest",
    "invocationDigest",
    "evidenceDigest",
    "scanDigest"
  ]) {
    const digest2 = text(data[field]);
    if (!/^[a-f0-9]{64}$/.test(digest2)) throw new InputError("Invalid policy binding digest.");
    result[field] = digest2;
  }
  return result;
}
var LIMITATIONS = [
  "Finite bounded discovery records checked locations; it cannot prove no undiscovered policy exists.",
  "Agent semantic assessments and invocation references are declarations, not authenticated policy truth, wrapper intent or user authorization.",
  "Observed bytes and identity checks are not an atomic snapshot and cannot prevent later races; repeat freshness checks before consumption and after waiting.",
  "Repository-policy validation is not performed; no default identity, registry, summary or message validation is run by policy commands."
];

// src/policy-evidence.ts
import { lstat as lstat4, opendir as opendir2 } from "node:fs/promises";
import path6 from "node:path";

// src/policy-scope.ts
init_errors();
import { createHash } from "node:crypto";
import { lstat as lstat3, opendir, realpath as realpath4 } from "node:fs/promises";
import path5 from "node:path";
init_records();

// src/safe-git.ts
import { execFile } from "node:child_process";
import { lstat as lstat2, realpath as realpath3 } from "node:fs/promises";
import path4 from "node:path";
var ObservationError = class extends Error {
};
function inside(root, target) {
  const relative = path4.relative(root, target);
  return relative === "" || !relative.startsWith(`..${path4.sep}`) && relative !== ".." && !path4.isAbsolute(relative);
}
async function resolveTrustedGit(excluded, environment = process.env) {
  const candidates = process.platform === "win32" ? [environment.ProgramFiles, environment["ProgramFiles(x86)"]].filter((item) => !!item && path4.isAbsolute(item)).map((base) => path4.join(base, "Git/cmd/git.exe")) : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];
  for (const candidate of candidates) {
    try {
      const actual = await realpath3(candidate);
      if (excluded.some((root) => inside(root, actual)) || !(await lstat2(actual)).isFile()) continue;
      return actual;
    } catch {
    }
  }
  throw new ObservationError("Trusted Git installation unavailable; no PATH or cwd lookup fallback.");
}
function gitEnvironment(environment = process.env) {
  const result = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !/^(?:GIT_|HOME$|USERPROFILE$|XDG_|SSH_|NODE_OPTIONS$|NODE_PATH$|LD_|DYLD_)/i.test(key)
    )
  );
  return {
    ...result,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GIT_ALLOW_PROTOCOL: "",
    LC_ALL: "C"
  };
}
var sameArgs = (actual, expected) => actual.length === expected.length && actual.every((value, index) => value === expected[index]);
var objectId = (value) => value !== void 0 && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
function readOnlyArguments(command, args) {
  switch (command) {
    case "symbolic-ref":
      return sameArgs(args, ["--quiet", "HEAD"]);
    case "rev-parse":
      return args.length === 1 && [
        "--show-toplevel",
        "--absolute-git-dir",
        "--git-common-dir",
        "--show-object-format",
        "--shared-index-path"
      ].includes(args[0] ?? "") || sameArgs(args, ["--verify", "--quiet", "HEAD"]) || args.length === 2 && args[0] === "--verify" && /^[a-f0-9]{4,64}\^\{commit\}$/.test(args[1] ?? "");
    case "rev-list":
      return args.length === 2 && args[0] === "--max-count=10001" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})\.\.(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(args[1] ?? "");
    case "ls-files":
      return sameArgs(args, ["--stage", "-z"]) || sameArgs(args, ["--cached", "-z"]);
    case "cat-file":
      return args.length === 2 && (["-t", "-p"].includes(args[0] ?? "") && objectId(args[1]) || args[0] === "-e" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})\^\{commit\}$/.test(args[1] ?? ""));
    case "diff":
      return sameArgs(args, ["--cached", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--"]) || args.length === 7 && sameArgs(args.slice(0, 4), ["--name-only", "-z", "--no-ext-diff", "--no-textconv"]) && objectId(args[4]) && objectId(args[5]) && args[6] === "--";
    case "diff-tree": {
      const prefix = args.includes("-m") ? ["--root", "-m", "--no-commit-id", "--name-only", "-r", "-z", "--no-ext-diff", "--no-textconv"] : ["--root", "--no-commit-id", "--name-only", "-r", "-z", "--no-ext-diff", "--no-textconv"];
      return args.length === prefix.length + 2 && sameArgs(args.slice(0, prefix.length), prefix) && objectId(args[prefix.length]) && args.at(-1) === "--";
    }
    case "config": {
      if (sameArgs(args.slice(0, 2), ["--no-includes", "--file"]) && path4.isAbsolute(args[2] ?? ""))
        return sameArgs(args.slice(3), ["--get-regexp", "^includeIf\\..*\\.path$"]) || sameArgs(args.slice(3), ["--bool", "--get", "extensions.worktreeConfig"]);
      return args.length === 6 && sameArgs(args.slice(0, 3), ["--no-includes", "--null", "--file"]) && path4.isAbsolute(args[3] ?? "") && args[4] === "--get-all" && ["core.hooksPath", "commit.template", "include.path"].includes(args[5] ?? "");
    }
    default:
      return false;
  }
}
var SafeGit = class {
  executable;
  directory;
  environment;
  started = performance.now();
  constructor(executable, directory, environment = process.env) {
    if (!path4.isAbsolute(executable)) throw new ObservationError("Git executable must be trusted and absolute.");
    this.executable = executable;
    this.directory = directory;
    this.environment = gitEnvironment(environment);
  }
  async #execute(args, allowMissing = false) {
    const remaining = 3e4 - (performance.now() - this.started);
    if (remaining <= 0) throw new ObservationError("Git observation total time budget exceeded.");
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.executable,
        args,
        {
          cwd: this.directory,
          env: this.environment,
          encoding: "buffer",
          windowsHide: true,
          shell: false,
          timeout: Math.min(1e4, remaining),
          maxBuffer: 4 * 1024 * 1024
        },
        (error, stdout) => {
          if (error && !(allowMissing && "code" in error && error.code === 1))
            reject(
              new ObservationError(
                "Git observation failed, timed out, exceeded output budget or required object is unavailable."
              )
            );
          else resolve(stdout);
        }
      );
      child.stdin?.end();
    });
  }
  async guard() {
    await this.#execute(["--no-lazy-fetch", "--version"]);
  }
  async run(command, args, allowMissing = false) {
    if (!readOnlyArguments(command, args)) throw new ObservationError("Unsupported read-only Git argv.");
    return this.#execute(
      [
        "--no-lazy-fetch",
        "--no-optional-locks",
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        "core.pager=cat",
        "-c",
        "core.quotePath=false",
        "-c",
        "diff.external=",
        "-c",
        "core.hooksPath=",
        command,
        ...args
      ],
      allowMissing
    );
  }
  async text(command, args, allowMissing = false) {
    return new TextDecoder("utf-8", { fatal: true }).decode(await this.run(command, args, allowMissing)).replace(/\r?\n$/, "");
  }
};

// src/policy-scope.ts
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value).sort(ordinal).map((key) => [key, canonical(value[key])])
    );
  return value;
}
var digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
var byteDigest = (value) => createHash("sha256").update(value).digest("hex");
function sameObserved(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
async function inspectPath(file) {
  const absolute2 = path5.resolve(file);
  let initial;
  try {
    initial = await lstat3(absolute2);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const root = path5.parse(absolute2).root;
  const parts = path5.relative(root, absolute2).split(path5.sep).filter(Boolean);
  const observed = [];
  let missing;
  let current = root;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path5.join(current, parts[index] ?? "");
    const locator = index === -1 && current.startsWith("\\\\?\\") && current.length === 7 && current[5] === ":" ? current.slice(4) : current;
    let info;
    try {
      info = await lstat3(locator);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      if (initial) throw new ObservationError("Observed present path disappeared during component checks.");
      missing = current;
      break;
    }
    if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory())
      throw new ObservationError("Observed path has a linked or non-directory ancestor/component.");
    observed.push({ locator, info });
  }
  for (const item of observed) {
    const after = await lstat3(item.locator);
    if (after.isSymbolicLink() || item.info.dev !== after.dev || item.info.ino !== after.ino || item.info.mode !== after.mode)
      throw new ObservationError("Observed path component identity changed.");
  }
  if (!initial) {
    if (!missing) throw new ObservationError("Initially absent path appeared during component checks.");
    try {
      await lstat3(missing);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return void 0;
      throw error;
    }
    throw new ObservationError("Initially absent path component appeared during checks.");
  }
  const final = observed.at(-1);
  if (!final || final.locator !== absolute2 || !sameObserved(initial, final.info))
    throw new ObservationError("Observed path identity changed during component checks.");
  return initial;
}
async function physical(file) {
  if (!await inspectPath(file)) throw new ObservationError("Observed physical path is missing.");
  const actual = await realpath4(file);
  if (!samePhysicalPath(file, actual))
    throw new ObservationError("Observed path contains a link or is not physical.");
  return actual;
}
async function fileState(file, maximumBytes = LIMITS.bytes, expected) {
  const info = await inspectPath(file);
  if (expected === null && info) throw new ObservationError("Observed absent path appeared after traversal.");
  if (expected && (!info || !sameObserved(expected, info)))
    throw new ObservationError("Observed path changed after traversal.");
  if (!info) return { type: "absent" };
  await physical(file);
  if (info.isDirectory()) return { type: "directory" };
  if (!info.isFile()) throw new ObservationError("Observed path has an unsupported file type.");
  const bytes = await readRegularFile(file, { physicalPath: true, maximumBytes });
  const after = await inspectPath(file);
  if (!after || !sameObserved(info, after))
    throw new ObservationError("Observed present file changed/disappeared during read.");
  return { type: "file", size: bytes.length, sha256: byteDigest(bytes), executable: (info.mode & 73) !== 0 };
}
function nulPaths(bytes) {
  const values = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0").filter(Boolean);
  values.forEach(checkRaw);
  if (values.length > LIMITS.paths) throw new ObservationError("Operation path budget exceeded.");
  return unique(values);
}
async function expand(directory, relative, traversal, depth = 0) {
  const count = () => {
    if (++traversal.entries > LIMITS.entries)
      throw new ObservationError("Scope traversal enumeration/visit budget exceeded.");
  };
  count();
  if (traversal.observed.has(relative)) return;
  if (traversal.observed.size >= LIMITS.paths || depth > LIMITS.directoryLevels)
    throw new ObservationError("Directory/path enumeration budget exceeded.");
  const target = path5.join(directory, relative);
  const info = await inspectPath(target);
  traversal.observed.set(relative, info);
  if (info?.isDirectory()) {
    const children = [];
    for await (const child of await opendir(target)) {
      count();
      checkRaw(child.name);
      children.push(child.name);
    }
    children.sort(ordinal);
    traversal.inventory.push({ directory: relative, children });
    for (const child of children) {
      if ([".git", "node_modules", ".pnpm", "vendor"].includes(child)) continue;
      await expand(directory, `${relative}/${child}`, traversal, depth + 1);
    }
    const after = await inspectPath(target);
    if (!after || !sameObserved(info, after))
      throw new ObservationError("Directory changed during scope traversal.");
  } else if (info && !info.isFile()) throw new ObservationError("Unsupported scope path type.");
}
async function captureScope(operation, context) {
  if (operation.paths.length > LIMITS.paths) throw new ObservationError("Operation path budget exceeded.");
  const invocation = context.invocation;
  if (invocation.kind === "wrapper-adapter" && !["explicit-scope-v1"].includes(invocation.adapter ?? ""))
    throw new ObservationError("Unsupported wrapper adapter; actual input semantics require a decision.");
  const effective2 = await physical(invocation.effectiveDirectory);
  if (!(await lstat3(effective2)).isDirectory())
    throw new InputError("Invocation effectiveDirectory must be a physical directory.");
  const executable = await resolveTrustedGit([operation.repository, operation.worktree, operation.commonGitDir]);
  const git = new SafeGit(executable, effective2);
  await git.guard();
  if (invocation.gitDirectory) git.environment.GIT_DIR = await physical(invocation.gitDirectory);
  if (invocation.worktreePath) git.environment.GIT_WORK_TREE = await physical(invocation.worktreePath);
  const top = await physical(await git.text("rev-parse", ["--show-toplevel"]));
  const gitDirectory = await physical(await git.text("rev-parse", ["--absolute-git-dir"]));
  const commonGitDir = await physical(path5.resolve(effective2, await git.text("rev-parse", ["--git-common-dir"])));
  if (top !== operation.repository || top !== operation.worktree || commonGitDir !== operation.commonGitDir || invocation.repositoryPath && await physical(invocation.repositoryPath) !== top || invocation.worktreePath && await physical(invocation.worktreePath) !== top || invocation.gitDirectory && await physical(invocation.gitDirectory) !== gitDirectory)
    throw new InputError("Explicit operation/invocation scope differs from physical Git identity.");
  const format = await git.text("rev-parse", ["--show-object-format"]);
  if (!["sha1", "sha256"].includes(format)) throw new ObservationError("Unsupported repository object format.");
  const objectPattern = format === "sha1" ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/;
  const symbolic = await git.text("symbolic-ref", ["--quiet", "HEAD"], true);
  const resolved = await git.text("rev-parse", ["--verify", "--quiet", "HEAD"], true);
  let head;
  if (resolved) {
    if (!objectPattern.test(resolved)) throw new ObservationError("Invalid HEAD object identity.");
    if (await git.text("cat-file", ["-t", resolved]) !== "commit")
      throw new ObservationError("HEAD does not resolve to an available commit object.");
    head = {
      state: "resolved",
      objectId: resolved,
      symbolic,
      parents: await git.text("cat-file", ["-p", resolved])
    };
  } else {
    if (!symbolic.startsWith("refs/heads/") || operation.kind !== "commit" || operation.targets.length)
      throw new ObservationError("Missing HEAD is not a supported unborn commit operation.");
    const refPath = path5.join(commonGitDir, symbolic);
    const ref = await fileState(refPath);
    if (!isRecord(ref) || ref.type !== "absent")
      throw new ObservationError("HEAD branch reference exists but cannot resolve.");
    head = { state: "unborn", symbolic, ref };
  }
  const targets = [];
  const coverage = /* @__PURE__ */ new Set();
  const cover = (...paths2) => {
    for (const file of paths2) {
      coverage.add(file);
      if (coverage.size > LIMITS.paths) throw new ObservationError("Affected operation path budget exceeded.");
    }
  };
  for (const target of operation.targets) {
    if (!objectPattern.test(target.objectId))
      throw new InputError("Target object format differs from repository format.");
    if (["head", "replaced"].includes(target.role) && ["commit", "amend", "merge", "cherry-pick"].includes(operation.kind) && target.objectId !== resolved)
      throw new ObservationError("Supplied current/replaced target differs from observed HEAD.");
    const type = await git.text("cat-file", ["-t", target.objectId]);
    if (type !== "commit") throw new ObservationError("Operation target must resolve to an available commit.");
    const commit = await git.text("cat-file", ["-p", target.objectId]);
    targets.push({ ...target, commit });
    cover(
      ...nulPaths(
        await git.run("diff-tree", [
          "--root",
          "-m",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          "--no-ext-diff",
          "--no-textconv",
          target.objectId,
          "--"
        ])
      )
    );
  }
  if (operation.kind === "amend" && resolved && !operation.targets.some((target) => target.objectId === resolved)) {
    cover(
      ...nulPaths(
        await git.run("diff-tree", [
          "--root",
          "-m",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          "--no-ext-diff",
          "--no-textconv",
          resolved,
          "--"
        ])
      )
    );
  }
  const metadata = {};
  const names = [
    "HEAD",
    "CHERRY_PICK_HEAD",
    "MERGE_HEAD",
    "REBASE_HEAD",
    "ORIG_HEAD",
    "AUTO_MERGE",
    "MERGE_MSG",
    "SQUASH_MSG",
    "sequencer/head",
    "sequencer/todo",
    "sequencer/abort-safety",
    ...["rebase-merge", "rebase-apply"].flatMap(
      (dir) => [
        "head-name",
        "orig-head",
        "onto",
        "git-rebase-todo",
        "done",
        "msgnum",
        "end",
        "stopped-sha",
        "next",
        "last",
        "original-commit"
      ].map((name) => `${dir}/${name}`)
    )
  ];
  for (const name of names) metadata[name] = await fileState(path5.join(gitDirectory, name), LIMITS.fileBytes);
  const present = (name) => isRecord(metadata[name]) && metadata[name].type !== "absent";
  if (present("MERGE_HEAD") && operation.kind !== "merge" || present("CHERRY_PICK_HEAD") && operation.kind !== "cherry-pick" || context.phase === "edit-message" && (operation.kind === "merge" && !present("MERGE_HEAD") || operation.kind === "cherry-pick" && !present("CHERRY_PICK_HEAD") || operation.kind === "rebase" && !present("REBASE_HEAD") && !present("rebase-merge/onto") && !present("rebase-apply/onto")))
    throw new ObservationError("Operation kind and active Git metadata are inconsistent or unsupported.");
  if (operation.kind !== "commit" && !operation.targets.length)
    throw new ObservationError("This operation requires explicit resolved targets.");
  const objectMetadata = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REBASE_HEAD",
    "sequencer/head",
    "sequencer/abort-safety",
    ...["rebase-merge", "rebase-apply"].flatMap(
      (directory) => ["orig-head", "onto", "stopped-sha", "original-commit"].map((file) => `${directory}/${file}`)
    )
  ];
  const activeObjects = [];
  for (const name of objectMetadata) {
    if (!present(name)) continue;
    const ids = (await readRegularFile(path5.join(gitDirectory, name), { maximumBytes: LIMITS.fileBytes, physicalPath: true })).toString("utf8").trim().split(/\s+/);
    for (const id of ids) {
      if (!objectPattern.test(id))
        throw new ObservationError("Operation metadata contains invalid object identities.");
      if (["MERGE_HEAD", "CHERRY_PICK_HEAD"].includes(name) && !operation.targets.some((target) => target.objectId === id))
        throw new ObservationError("Supplied targets omit the actual merge/cherry-pick source.");
      await git.run("cat-file", ["-e", `${id}^{commit}`]);
      activeObjects.push({ locator: name, objectId: id });
      cover(
        ...nulPaths(
          await git.run("diff-tree", [
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            id,
            "--"
          ])
        )
      );
    }
  }
  for (const name of [
    "sequencer/todo",
    "rebase-merge/git-rebase-todo",
    "rebase-merge/done",
    "rebase-apply/git-rebase-todo",
    "rebase-apply/done"
  ]) {
    if (!present(name)) continue;
    const contents = new TextDecoder("utf-8", { fatal: true }).decode(
      await readRegularFile(path5.join(gitDirectory, name), {
        maximumBytes: LIMITS.fileBytes,
        physicalPath: true
      })
    );
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const match = /^(?:pick|reword|edit|squash|fixup|drop)\s+(?:-[cC]\s+)?([a-f0-9]{4,64})(?:\s|$)/.exec(line);
      if (!match?.[1])
        throw new ObservationError("Unsupported sequencer/rebase instruction requires a decision.");
      const id = await git.text("rev-parse", ["--verify", `${match[1]}^{commit}`]);
      if (!objectPattern.test(id))
        throw new ObservationError("Sequencer source cannot resolve to a supported commit.");
      activeObjects.push({ locator: name, objectId: id });
      cover(
        ...nulPaths(
          await git.run("diff-tree", [
            "--root",
            "--no-commit-id",
            "--name-only",
            "-r",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            id,
            "--"
          ])
        )
      );
    }
  }
  if (operation.kind === "squash") {
    const base = operation.targets.find((target) => target.role === "base");
    const last = operation.targets.find((target) => target.role === "head" || target.role === "source");
    if (!base || !last) throw new ObservationError("Squash requires resolved base and head/source target roles.");
    cover(
      ...nulPaths(
        await git.run("diff", [
          "--name-only",
          "-z",
          "--no-ext-diff",
          "--no-textconv",
          base.objectId,
          last.objectId,
          "--"
        ])
      )
    );
  }
  if (operation.kind === "merge") {
    if (!resolved) throw new ObservationError("Merge coverage requires an available current HEAD.");
    const sources = unique([
      ...activeObjects.filter((item) => item.locator === "MERGE_HEAD").map((item) => item.objectId),
      ...operation.targets.filter((target) => target.role.startsWith("source")).map((target) => target.objectId)
    ]);
    if (!sources.length) throw new ObservationError("Merge coverage requires actual source targets.");
    for (const source of sources) {
      const commits = (await git.text("rev-list", ["--max-count=10001", `${resolved}..${source}`])).split("\n").filter(Boolean);
      if (commits.length > LIMITS.paths) throw new ObservationError("Merge range object budget exceeded.");
      for (const id of commits) {
        if (!objectPattern.test(id)) throw new ObservationError("Merge range has an invalid commit identity.");
        cover(
          ...nulPaths(
            await git.run("diff-tree", [
              "--root",
              "-m",
              "--no-commit-id",
              "--name-only",
              "-r",
              "-z",
              "--no-ext-diff",
              "--no-textconv",
              id,
              "--"
            ])
          )
        );
      }
    }
  }
  const index = await fileState(path5.join(gitDirectory, "index"));
  const shared = await git.text("rev-parse", ["--shared-index-path"]);
  const splitIndex = shared ? await fileState(path5.resolve(effective2, shared)) : { type: "absent" };
  const entries = await git.run("ls-files", ["--stage", "-z"]);
  const applicable = [...operation.paths];
  if (context.selection === "index" || operation.kind === "merge")
    applicable.push(
      ...nulPaths(
        await git.run("diff", ["--cached", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--"])
      )
    );
  if (context.selection === "all-tracked")
    applicable.push(...nulPaths(await git.run("ls-files", ["--cached", "-z"])));
  if (context.selection === "operation-targets" || operation.kind !== "commit") applicable.push(...coverage);
  if (["planned-paths", "specified-paths"].includes(context.selection) && !operation.paths.length)
    throw new ObservationError("Planned/specified selection needs explicit intended paths.");
  const traversal = { entries: 0, observed: /* @__PURE__ */ new Map(), inventory: [] };
  for (const relative of unique(applicable)) {
    const target = path5.resolve(top, relative);
    if (!inside(top, target) || relative.split("/").some((part) => part === ".git"))
      throw new InputError("Selected path escapes operation worktree or selects Git metadata.");
    await expand(top, relative, traversal);
  }
  const paths = unique([...applicable, ...traversal.observed.keys()]);
  if (paths.length > LIMITS.paths) throw new ObservationError("Operation path budget exceeded.");
  const states = [];
  let bytes = 0;
  for (const relative of paths) {
    const absolute2 = path5.join(top, relative);
    const state = await fileState(absolute2, LIMITS.bytes - bytes, traversal.observed.get(relative) ?? null);
    if (isRecord(state) && typeof state.size === "number") bytes += state.size;
    states.push({ path: relative, state });
    let parent = isRecord(state) && state.type === "directory" ? absolute2 : path5.dirname(absolute2);
    while (parent !== top && inside(top, parent)) {
      if (await inspectPath(path5.join(parent, ".git")))
        throw new InputError("Selected path belongs to a nested repository.");
      parent = path5.dirname(parent);
    }
  }
  const gitStateDigest = digest({
    format,
    head,
    targets,
    activeObjects,
    index,
    splitIndex,
    entries: byteDigest(entries),
    metadata
  });
  const pathStateDigest = digest({ paths: states, traversal: traversal.inventory, enumerationLimit: LIMITS.entries });
  const invocationDigest = digest(context.invocation);
  const scopeDigest = digest({
    version: 1,
    operation,
    context,
    top,
    gitDirectory,
    commonGitDir,
    gitStateDigest,
    pathStateDigest,
    invocationDigest
  });
  return {
    git,
    enumerationEntries: traversal.entries,
    worktree: top,
    gitDirectory,
    commonGitDir,
    paths,
    gitStateDigest,
    pathStateDigest,
    invocationDigest,
    scopeDigest
  };
}

// src/policy-evidence.ts
init_records();
var EvidenceSearch = class {
  candidates = [];
  checkedLocations = [];
  issues = [];
  fingerprints = [];
  seen = /* @__PURE__ */ new Set();
  scopeUses = /* @__PURE__ */ new Map();
  directories = /* @__PURE__ */ new Set();
  repository;
  limitations = [];
  files = 0;
  bytes = 0;
  referenceHops = 0;
  entries = 0;
  issue(code, locator, detail) {
    const id = digest([code, locator]);
    if (!this.issues.some((item) => item.id === id)) this.issues.push({ id, code, locator, detail });
  }
  count() {
    if (++this.entries > LIMITS.entries) throw new ObservationError("Evidence enumeration budget exceeded.");
  }
  async directoryEntries(directory) {
    const entries = [];
    for await (const entry of await opendir2(directory)) {
      this.count();
      checkRaw(entry.name);
      entries.push(entry);
    }
    return entries.sort((a, b) => ordinal(a.name, b.name));
  }
  async read(locator, sourceKind, scopeBasis, required = false, depth = 0, stack = [], display) {
    if (stack.includes(locator)) {
      this.issue("reference-cycle", locator, "Adopted evidence reference cycle.");
      return;
    }
    const uses = this.scopeUses.get(locator) ?? /* @__PURE__ */ new Set();
    uses.add(scopeBasis);
    this.scopeUses.set(locator, uses);
    try {
      this.count();
      if (this.seen.has(locator)) {
        const cached = this.candidates.find((item) => item.locator === locator);
        if (cached) cached.scopeBasis = unique([...uses]).join("; ");
        if (required && this.checkedLocations.some((item) => item.locator === locator && item.status === "absent")) {
          const detail = `An explicitly referenced policy/configuration target is missing. Scope: ${unique([...uses]).join("; ")}`;
          this.issue("missing-reference", locator, detail);
          const issue = this.issues.find((item) => item.id === digest(["missing-reference", locator]));
          if (issue) issue.detail = detail;
        }
        return cached;
      }
      this.seen.add(locator);
      const info = await inspectPath(locator);
      if (!info) {
        this.checkedLocations.push({ locator, status: "absent" });
        if (required)
          this.issue(
            "missing-reference",
            locator,
            `An explicitly referenced policy/configuration target is missing. Scope: ${unique([...uses]).join("; ")}`
          );
        return;
      }
      if (!info.isFile() || info.isSymbolicLink())
        throw new ObservationError("Policy evidence is not a regular physical file.");
      if (++this.files > LIMITS.files || this.candidates.length >= LIMITS.candidates)
        throw new ObservationError("Policy file/candidate budget exceeded.");
      const bytes = await readRegularFile(locator, {
        physicalPath: true,
        maximumBytes: Math.min(LIMITS.fileBytes, LIMITS.bytes - this.bytes)
      });
      const after = await lstat4(locator);
      if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs)
        throw new ObservationError("Evidence identity changed across bounded observation.");
      this.bytes += bytes.length;
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(decoded))
        throw new ObservationError("Policy evidence contains unsupported document controls.");
      const id = digest(["candidate", locator]);
      const candidate = {
        id,
        locator,
        sourceKind,
        scopeBasis,
        sha256: byteDigest(bytes),
        byteLength: bytes.length,
        text: display ?? decoded,
        referenceIds: []
      };
      this.fingerprints.push({
        locator,
        dev: info.dev,
        ino: info.ino,
        size: bytes.length,
        sha256: candidate.sha256,
        sourceKind,
        scopeBasis
      });
      this.candidates.push(candidate);
      this.checkedLocations.push({ locator, status: "present" });
      if (display !== void 0) return candidate;
      for (const match of decoded.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const link = match[1];
        if (!link || link.startsWith("#")) continue;
        this.referenceHops = Math.max(this.referenceHops, depth + 1);
        if (depth >= LIMITS.referenceHops) {
          this.issue("reference-budget", locator, "Adopted reference hop budget exceeded.");
          break;
        }
        if (/^https?:\/\//i.test(link)) {
          this.limitations.push(`Unfetched network evidence locator: ${link}`);
          continue;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^[a-z]:[/\\]/i.test(link)) {
          this.issue("unsupported-reference", locator, "Unsupported adopted evidence locator scheme.");
          continue;
        }
        let decodedLink;
        try {
          decodedLink = decodeURIComponent(link.split("#")[0] ?? "");
          checkRaw(decodedLink);
        } catch {
          this.issue("invalid-reference", locator, "Adopted reference has invalid encoding or controls.");
          continue;
        }
        const target = path6.resolve(path6.dirname(locator), decodedLink);
        const targetInfo = await inspectPath(target);
        if (targetInfo?.isDirectory()) {
          if (!this.repository || !inside(this.repository, target))
            this.issue(
              "external-directory-reference",
              target,
              "External directory navigation is unresolved; only exact external file targets may be read."
            );
          else {
            await this.docs(target, 0, depth + 1, [...stack, locator], true);
            candidate.referenceIds.push(
              ...this.candidates.filter((item) => inside(target, item.locator)).map((item) => item.id)
            );
          }
          continue;
        }
        const child = await this.read(
          target,
          "adopted-reference",
          `Explicit link from ${locator}`,
          true,
          depth + 1,
          [...stack, locator]
        );
        if (child) candidate.referenceIds.push(child.id);
      }
      candidate.referenceIds = unique(candidate.referenceIds);
      return candidate;
    } catch (error) {
      this.checkedLocations.push({ locator, status: "failed" });
      this.issue(
        "unsafe-evidence",
        locator,
        error instanceof ObservationError ? error.message : "Evidence read failed identity/type/encoding/byte-budget checks."
      );
      return;
    }
  }
  async docs(directory, depth = 0, referenceDepth = 0, stack = [], required = false) {
    try {
      this.count();
      if (depth > LIMITS.directoryLevels) throw new ObservationError("Policy directory level budget exceeded.");
      if (stack.includes(directory)) throw new ObservationError("Adopted directory reference cycle.");
      const info = await inspectPath(directory);
      if (!info) {
        if (required) throw new ObservationError("Observed/adopted directory disappeared before discovery.");
        this.checkedLocations.push({ locator: directory, status: "absent" });
        return;
      }
      if (!info.isDirectory()) throw new ObservationError("Policy discovery root must be a physical directory.");
      if (this.directories.has(directory)) return;
      this.directories.add(directory);
      const entries = await this.directoryEntries(directory);
      this.checkedLocations.push({ locator: directory, status: "present" });
      this.fingerprints.push({
        directory,
        dev: info.dev,
        ino: info.ino,
        entries: entries.map((entry) => entry.name)
      });
      for (const entry of entries) {
        if ([
          ".git",
          "node_modules",
          ".pnpm",
          "vendor",
          "third_party",
          "third-party",
          "dist",
          "coverage"
        ].includes(entry.name))
          continue;
        const target = path6.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          this.issue("unsafe-directory-entry", target, "Policy discovery encountered a linked path.");
          continue;
        }
        if (entry.isDirectory())
          await this.docs(target, depth + 1, referenceDepth, [...stack, directory], true);
        else if (/\.(?:md|txt|ya?ml|json)$/i.test(entry.name) && (referenceDepth > 0 || /readme|contribut|commit|policy|attribution|disclos|(^|[._-])ai([._-]|$)/i.test(entry.name) || directory.endsWith(`${path6.sep}.github${path6.sep}workflows`)))
          await this.read(
            target,
            "repository-document",
            `Bounded contribution/policy document discovery under ${directory}`,
            false,
            referenceDepth,
            [...stack, directory]
          );
      }
      const after = await inspectPath(directory);
      if (!after || info.dev !== after.dev || info.ino !== after.ino || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs)
        throw new ObservationError("Policy directory changed/disappeared during discovery.");
    } catch {
      this.checkedLocations.push({ locator: directory, status: "failed" });
      this.issue(
        "directory-observation",
        directory,
        "Directory discovery failed or exceeded its enumeration/level budget."
      );
    }
  }
  async configuration(scope) {
    const keys = ["core.hooksPath", "commit.template", "include.path"];
    const visited = /* @__PURE__ */ new Set();
    const active = /* @__PURE__ */ new Set();
    const settings = /* @__PURE__ */ new Map();
    const inspect = async (file, depth = 0) => {
      if (active.has(file) || depth > LIMITS.referenceHops) {
        this.issue("config-cycle-budget", file, "Configuration include cycle/depth is unsupported.");
        return;
      }
      if (visited.has(file)) return;
      visited.add(file);
      active.add(file);
      const candidate = await this.read(
        file,
        "git-configuration",
        "Actual local/worktree/include configuration; only policy locator keys are displayed.",
        depth > 0,
        0,
        [],
        "Configuration bytes are bound; unrelated and secret values are omitted."
      );
      if (!candidate) {
        active.delete(file);
        return;
      }
      try {
        const conditional = await scope.git.text(
          "config",
          ["--no-includes", "--file", file, "--get-regexp", "^includeIf\\..*\\.path$"],
          true
        );
        if (conditional) {
          this.issue(
            "conditional-config",
            file,
            "Conditional include semantics require an explicit decision; no include is guessed."
          );
        }
        const selected = [];
        for (const key of keys) {
          const bytes = await scope.git.run(
            "config",
            ["--no-includes", "--null", "--file", file, "--get-all", key],
            true
          );
          const values = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0").filter(Boolean);
          for (const value of values) {
            checkRaw(value);
            selected.push(`${key}=${value}`);
            if (key === "include.path") {
              this.issue(
                "config-include-order",
                file,
                "Included configuration is bound as data; its effective inline precedence requires a decision."
              );
              if (value.startsWith("~") || !value || /\$|%/.test(value)) {
                this.issue(
                  "config-locator",
                  file,
                  "Unsupported include path expansion requires a decision."
                );
                continue;
              }
              const target = path6.resolve(path6.dirname(file), value);
              const child = await this.read(
                target,
                "git-configuration",
                `Exact include referenced by ${file}`,
                true,
                0,
                [],
                "Included configuration bytes are bound; unrelated and secret values are omitted."
              );
              if (child) candidate.referenceIds.push(child.id);
              await inspect(target, depth + 1);
            } else settings.set(key, value);
          }
        }
        candidate.text = selected.join("\n");
      } catch {
        this.issue("config-read", file, "Malformed or unsupported configuration cannot be safely resolved.");
      }
      active.delete(file);
    };
    await inspect(path6.join(scope.commonGitDir, "config"));
    const worktreeConfig = await scope.git.text(
      "config",
      [
        "--no-includes",
        "--file",
        path6.join(scope.commonGitDir, "config"),
        "--bool",
        "--get",
        "extensions.worktreeConfig"
      ],
      true
    );
    if (worktreeConfig === "true") await inspect(path6.join(scope.gitDirectory, "config.worktree"));
    const hookSetting = settings.get("core.hooksPath");
    if (hookSetting?.startsWith("~") || settings.get("commit.template")?.startsWith("~")) {
      this.issue(
        "config-locator",
        scope.gitDirectory,
        "Home-relative policy locators need an explicit exact candidate."
      );
      return;
    }
    const hooks = hookSetting ? path6.resolve(scope.worktree, hookSetting) : path6.join(scope.commonGitDir, "hooks");
    for (const name of ["prepare-commit-msg", "commit-msg"])
      await this.read(
        path6.join(hooks, name),
        "message-hook",
        "Effective message-related hook definition, read as data"
      );
    const template = settings.get("commit.template");
    if (template)
      await this.read(
        path6.resolve(scope.git.directory, template),
        "commit-template",
        "Effective explicitly configured commit template",
        true
      );
  }
  async discover(operation, context, scope) {
    this.repository = operation.worktree;
    const dirs = /* @__PURE__ */ new Set();
    let current = operation.worktree;
    let steps = 0;
    for (; ; ) {
      if (++steps > LIMITS.ancestors) {
        this.issue("ancestor-budget", current, "Applicable ancestor instruction budget exceeded.");
        break;
      }
      dirs.add(current);
      const parent = path6.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const relative of scope.paths) {
      let parent = path6.dirname(path6.join(operation.worktree, relative));
      const state = await inspectPath(path6.join(operation.worktree, relative));
      if (state?.isDirectory()) parent = path6.join(operation.worktree, relative);
      let depth = 0;
      while (inside(operation.worktree, parent)) {
        if (++depth > LIMITS.directoryLevels) {
          this.issue("local-depth-budget", parent, "Applicable local instruction depth budget exceeded.");
          break;
        }
        dirs.add(parent);
        if (parent === operation.worktree) break;
        parent = path6.dirname(parent);
      }
    }
    for (const directory of [...dirs].sort(ordinal))
      for (const name of ["AGENTS.md", "CLAUDE.md"])
        await this.read(
          path6.join(directory, name),
          "applicable-instruction",
          "Exact ancestor/local instruction of worktree or selected/intended path"
        );
    try {
      for (const entry of await this.directoryEntries(operation.worktree)) {
        if (/^(?:README|CONTRIBUTING)(?:[._-].*)?$/i.test(entry.name))
          await this.read(
            path6.join(operation.worktree, entry.name),
            "contribution-entry",
            "Root contribution/navigation entry"
          );
      }
    } catch {
      this.issue("root-discovery", operation.worktree, "Root entry discovery failed.");
    }
    for (const name of ["README.md", "CONTRIBUTING.md"])
      await this.read(
        path6.join(operation.worktree, name),
        "contribution-entry",
        "Expected root contribution/navigation entry"
      );
    await this.docs(path6.join(operation.worktree, "docs"));
    await this.docs(path6.join(operation.worktree, ".github/workflows"));
    await this.configuration(scope);
    for (const locator of context.additionalCandidatePaths ?? [])
      await this.read(locator, "explicit-candidate", "Exact candidate supplied by caller", true);
  }
  bindingDigest() {
    this.candidates.sort((a, b) => ordinal(a.id, b.id));
    this.checkedLocations.sort((a, b) => ordinal(a.locator, b.locator) || ordinal(a.status, b.status));
    this.issues.sort((a, b) => ordinal(a.id, b.id));
    return digest({
      profile: LIMITS,
      enumerationLimit: LIMITS.entries,
      scopeUses: [...this.scopeUses].sort(([a], [b]) => ordinal(a, b)).map(([locator, uses]) => ({ locator, uses: unique([...uses]) })),
      candidates: this.candidates,
      checkedLocations: this.checkedLocations,
      issues: this.issues,
      fingerprints: this.fingerprints.sort((a, b) => ordinal(JSON.stringify(a), JSON.stringify(b))),
      limitations: unique(this.limitations)
    });
  }
};

// src/policy.ts
init_records();
async function scanPolicy(input) {
  const operation = await parseOperation(input.operation);
  const context = parseContext(input.context);
  const search = new EvidenceSearch();
  let gitDirectory = operation.commonGitDir;
  let scopeDigest = digest({ operation, context, unresolved: true });
  let gitStateDigest = digest(null), pathStateDigest = digest(null), invocationDigest = digest(context.invocation);
  try {
    const scope = await captureScope(operation, context);
    search.entries = scope.enumerationEntries;
    ({ gitDirectory, scopeDigest, gitStateDigest, pathStateDigest, invocationDigest } = scope);
    await search.discover(operation, context, scope);
  } catch (error) {
    if (error instanceof InputError) throw error;
    search.issue(
      "scope-observation",
      context.invocation.effectiveDirectory,
      error instanceof ObservationError ? error.message : "Live Git/path observation failed safe identity/type/encoding checks."
    );
  }
  const evidenceDigest = search.bindingDigest();
  const partial = {
    canonicalizationVersion: 1,
    gitDirectory,
    commonGitDir: operation.commonGitDir,
    scopeDigest,
    gitStateDigest,
    pathStateDigest,
    invocationDigest,
    evidenceDigest
  };
  const binding = { ...partial, scanDigest: digest({ ...partial, profile: LIMITS }) };
  return {
    schemaVersion: 1,
    artifact: "policy-scan",
    operation,
    context,
    binding,
    scanStatus: search.issues.length ? "incomplete" : "complete",
    candidates: search.candidates,
    checkedLocations: search.checkedLocations,
    issues: search.issues,
    limits: {
      profile: LIMITS.profile,
      files: search.files,
      bytes: search.bytes,
      candidates: search.candidates.length,
      referenceHops: search.referenceHops
    },
    limitations: [...LIMITATIONS, ...search.limitations],
    exitCode: search.issues.length ? 20 : 0
  };
}
async function parseDecision(value) {
  checkRaw(value);
  const data = object(value, [
    "schemaVersion",
    "artifact",
    "operation",
    "binding",
    "branch",
    "assessments",
    "selectedCandidateIds",
    "issueIds",
    "rationale",
    "decisionSource"
  ]);
  if (data.schemaVersion !== 1 || data.artifact !== "policy-decision" || !["repository-policy", "skill-default", "needs-decision"].includes(text(data.branch)))
    throw new InputError("Invalid policy decision version/artifact/branch.");
  if (!Array.isArray(data.assessments)) throw new InputError("Invalid policy assessments.");
  const assessments = data.assessments.map((item) => {
    const row = object(item, ["candidateId", "classification", "rationale"]);
    const classification = text(row.classification);
    if (!["ai-disclosure-policy", "ordinary-format-only", "unrelated", "uncertain"].includes(classification))
      throw new InputError("Unsupported semantic classification.");
    return { candidateId: text(row.candidateId), classification, rationale: text(row.rationale) };
  });
  const source = object(data.decisionSource, ["kind", "reference"]);
  if (source.kind !== "agent-semantic") throw new InputError("A semantic Agent decision record is required.");
  const result = {
    schemaVersion: 1,
    artifact: "policy-decision",
    operation: await parseOperation(data.operation),
    binding: parseBinding(data.binding),
    branch: text(data.branch),
    assessments,
    selectedCandidateIds: strings(data.selectedCandidateIds),
    issueIds: strings(data.issueIds),
    rationale: text(data.rationale),
    decisionSource: { kind: "agent-semantic", reference: text(source.reference) }
  };
  checkRaw(result);
  if (new Set(assessments.map((item) => item.candidateId)).size !== assessments.length)
    throw new InputError("Duplicate candidate assessment.");
  return result;
}
async function checkFreshRouting(input) {
  const decision = await parseDecision(input.decision);
  const operation = await parseOperation(input.operation);
  if (JSON.stringify(operation) !== JSON.stringify(decision.operation))
    throw new InputError("Decision and supplied operation scopes differ.");
  const scan = await scanPolicy({ operation, context: input.context });
  const same = digest(scan.binding) === digest(decision.binding);
  if (same) {
    const candidates = new Set(scan.candidates.map((item) => item.id));
    const issues = new Set(scan.issues.map((item) => item.id));
    if (decision.assessments.length !== candidates.size || decision.assessments.some((item) => !candidates.has(item.candidateId)) || decision.selectedCandidateIds.some((id) => !candidates.has(id)) || decision.issueIds.some((id) => !issues.has(id)))
      throw new InputError("Decision has missing/unknown candidate or issue references.");
    const selected = decision.assessments.filter(
      (item) => decision.selectedCandidateIds.includes(item.candidateId)
    );
    if (decision.branch === "repository-policy" && (!selected.length || selected.some((item) => item.classification !== "ai-disclosure-policy")))
      throw new InputError("Repository-policy requires selected applicable evidence.");
    if (decision.branch === "skill-default" && (decision.selectedCandidateIds.length || decision.assessments.some((item) => item.classification === "ai-disclosure-policy")))
      throw new InputError("Default decision conflicts with applicable AI-policy assessment.");
  }
  const unresolved = scan.scanStatus === "incomplete" || decision.assessments.some((item) => item.classification === "uncertain") || decision.branch === "needs-decision";
  const branch = !same || unresolved ? "needs-decision" : decision.branch;
  return {
    schemaVersion: 1,
    artifact: "policy-route-check",
    operation,
    binding: scan.binding,
    freshness: same ? unresolved ? "unresolved" : "current" : "stale",
    branch,
    defaultValidation: branch === "skill-default" ? "eligible" : "not-run",
    repositoryPolicyValidation: "not-run",
    selectedCandidateIds: branch === "repository-policy" ? decision.selectedCandidateIds : [],
    issues: [
      ...scan.issues,
      ...!same ? [
        {
          id: digest(["stale"]),
          code: "stale-decision",
          detail: "Observed scope/evidence binding changed; obtain a new semantic decision."
        }
      ] : []
    ],
    limitations: scan.limitations,
    exitCode: branch === "repository-policy" ? 10 : branch === "skill-default" ? 0 : 20,
    freshScan: scan
  };
}

// src/attribution.ts
init_records();
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
    bytes = await readRegularFile(typeof file === "string" ? file : fileURLToPath(file), {
      physicalPath: true,
      maximumBytes: LIMITS.inputBytes
    });
  } catch {
    throw new InputError("Invalid input: cannot safely read the explicit JSON resource.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InputError("Invalid input: malformed UTF-8 JSON resource.");
  }
}
function parsePolicyArguments(args) {
  if (args[0] !== "policy" || args[1] !== "scan")
    throw new InputError(
      "Usage: attribution.mjs policy scan --operation <operation.json> --context <context.json> [--decision <decision.json>]"
    );
  const options = /* @__PURE__ */ new Map();
  for (let index = 2; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !["--operation", "--context", "--decision"].includes(flag) || options.has(flag) || !value || value.startsWith("--"))
      throw new InputError("Invalid policy flag or missing value.");
    options.set(flag, value);
  }
  const operation = options.get("--operation"), context = options.get("--context"), decision = options.get("--decision");
  if (!operation || !context) throw new InputError("Policy scan requires explicit operation and scope context.");
  return { operation, context, ...decision ? { decision } : {} };
}
async function run(args) {
  if (args[0] === "policy") {
    const options2 = parsePolicyArguments(args);
    const operation2 = await jsonFile(options2.operation), context = await jsonFile(options2.context);
    if (!options2.decision) return scanPolicy({ operation: operation2, context });
    const { freshScan: _freshScan, ...route } = await checkFreshRouting({
      operation: operation2,
      context,
      decision: await jsonFile(options2.decision)
    });
    return route;
  }
  const options = parseArguments(args);
  const [ledger, operation, registry] = await Promise.all([
    jsonFile(options.input),
    jsonFile(options.operation),
    jsonFile(new URL("../references/agent-registry.json", import.meta.url))
  ]);
  const { summarize: summarize2 } = await Promise.resolve().then(() => (init_summarize(), summarize_exports));
  return summarize2(ledger, operation, registry);
}
if (isMainModule(import.meta)) {
  try {
    const result = await run(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 4));
    process.exitCode = result.exitCode;
  } catch (error) {
    const input = error instanceof InputError;
    console.error(
      JSON.stringify({ error: input ? error.message : "Attribution execution failed.", exitCode: input ? 2 : 1 })
    );
    process.exitCode = input ? 2 : 1;
  }
}
export {
  parseArguments,
  parsePolicyArguments,
  run
};
