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
var init_file_evidence = __esm({
  "tooling/file-evidence.ts"() {
    "use strict";
  }
});

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
function identity(value, field) {
  checkRaw(value);
  const result = text(value);
  if (/[()<>]|\s/u.test(result) || field === "reasoning" && result.includes(":"))
    throw new InputError("Invalid input: ambiguous single-line identity field.");
  return result;
}
function version(value) {
  if (value !== 1) throw new InputError("Invalid input: schemaVersion must be 1.");
}
function parseOperationShape(value) {
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
  if (!["commit", "amend", "rebase", "cherry-pick", "squash", "merge"].includes(kind))
    throw new InputError("Invalid input scope: unsupported operation kind.");
  return {
    schemaVersion: 1,
    id: opaque(data.id),
    repository: opaque(data.repository),
    worktree: opaque(data.worktree),
    commonGitDir: opaque(data.commonGitDir),
    kind,
    paths,
    targets
  };
}
async function parseOperation(value) {
  const operation = parseOperationShape(value);
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
  return {
    ...operation,
    repository: await physical2(operation.repository),
    worktree: await physical2(operation.worktree),
    commonGitDir: await physical2(operation.commonGitDir)
  };
}
function parseIdentity(value) {
  checkRaw(value);
  const data = record(value, ["agent", "model", "reasoning"]);
  const agent = text(data.agent);
  if (/[:()<>]/u.test(agent) || ["unknown", "n/a", "null"].includes(agent.toLowerCase()))
    throw new InputError("Invalid input: ambiguous Agent host field.");
  const model = identity(data.model, "model");
  if (["auto", "latest", "unknown", "n/a", "null"].includes(model.toLowerCase()))
    throw new InputError("Invalid input: an actual formal model is required.");
  const reasoning = data.reasoning === void 0 ? void 0 : identity(data.reasoning, "reasoning");
  if (reasoning !== void 0 && ["unknown", "off", "n/a", "n-a", "null", "auto", "latest"].includes(reasoning.toLowerCase()))
    throw new InputError("Invalid input: omit unknown reasoning; confirmed disabled reasoning must use none.");
  return { agent, model, ...reasoning !== void 0 ? { reasoning } : {} };
}
function canonicalizeIdentity(value, registry) {
  const parsed = parseIdentity(value);
  const matches = registry.hosts.filter((host2) => host2.name === parsed.agent || host2.aliases.includes(parsed.agent));
  if (matches.length !== 1 || registry.ambiguousAliases.includes(parsed.agent))
    throw new InputError("Invalid input: Agent must be an exact registered host or unique explicit alias.");
  const host = matches[0];
  if (!host) throw new InputError("Invalid input: unregistered Agent host.");
  return parseIdentity({ ...parsed, agent: host.name });
}
function normalizeIdentities(values, registry) {
  const identities = /* @__PURE__ */ new Map();
  for (const value of values) {
    const normalized = canonicalizeIdentity(value, registry);
    identities.set(identityKey(normalized), normalized);
  }
  return [...identities.values()].sort(
    (a, b) => ordinal(a.agent, b.agent) || ordinal(a.model, b.model) || (a.reasoning === void 0 ? b.reasoning === void 0 ? 0 : -1 : b.reasoning === void 0 ? 1 : ordinal(a.reasoning, b.reasoning))
  );
}
async function parseLedger(value) {
  checkRaw(value);
  if (isRecord(value) && value.schemaVersion !== 2)
    throw new InputError(
      "Invalid input: migrate old event ledgers to schemaVersion 2 confirmed identities and blockers."
    );
  const data = record(value, ["schemaVersion", "ledgerId", "operation", "identities", "blockers"]);
  if (data.schemaVersion !== 2) throw new InputError("Invalid input: ledger schemaVersion must be 2.");
  const ledgerId = opaque(data.ledgerId);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ledgerId))
    throw new InputError("Invalid input: ledgerId must be a UUID.");
  const operation = await parseOperation(data.operation);
  const identities = list(data.identities, parseIdentity);
  const blockers = list(data.blockers, (item) => {
    const blocker = record(item, ["id", "reason"]);
    return { id: opaque(blocker.id), reason: text(blocker.reason) };
  });
  if (new Set(blockers.map((blocker) => blocker.id)).size !== blockers.length)
    throw new InputError("Invalid input: duplicate blocker ID.");
  return { schemaVersion: 2, ledgerId, operation, identities, blockers };
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
var InputError, ordinal, unique, identityKey;
var init_records = __esm({
  "src/records.ts"() {
    "use strict";
    init_errors();
    InputError = class extends Error {
    };
    ordinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    unique = (values) => [...new Set(values)].sort(ordinal);
    identityKey = (value) => JSON.stringify([value.agent, value.model, value.reasoning ?? null]);
  }
});

// src/input-contract.ts
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
var INPUT_BYTES;
var init_input_contract = __esm({
  "src/input-contract.ts"() {
    "use strict";
    init_errors();
    init_records();
    INPUT_BYTES = 2 * 1024 * 1024;
  }
});

// src/safe-git.ts
import { execFile } from "node:child_process";
import { lstat as lstat2, realpath as realpath3 } from "node:fs/promises";
import path3 from "node:path";
function inside(root, target) {
  const relative = path3.relative(root, target);
  return relative === "" || !relative.startsWith(`..${path3.sep}`) && relative !== ".." && !path3.isAbsolute(relative);
}
async function resolveTrustedGit(excluded, environment = process.env) {
  const windowsRoot = (name) => {
    const values = Object.entries(environment).filter(([key]) => key.toLowerCase() === name).map(([, value]) => value);
    if (new Set(values).size > 1)
      throw new ObservationError("Conflicting Windows host installation root environment keys.");
    return values[0];
  };
  const candidates = process.platform === "win32" ? [windowsRoot("programfiles"), windowsRoot("programfiles(x86)")].filter((item) => !!item && path3.isAbsolute(item)).map((base) => path3.join(base, "Git/cmd/git.exe")) : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];
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
function readOnlyArguments(command, args) {
  return command === "rev-parse" && ["--show-toplevel", "--absolute-git-dir", "--git-common-dir"].some((option) => sameArgs(args, [option]));
}
var ObservationError, sameArgs, SafeGit;
var init_safe_git = __esm({
  "src/safe-git.ts"() {
    "use strict";
    ObservationError = class extends Error {
    };
    sameArgs = (actual, expected) => actual.length === expected.length && actual.every((value, index) => value === expected[index]);
    SafeGit = class {
      executable;
      directory;
      environment;
      started = performance.now();
      constructor(executable, directory, environment = process.env) {
        if (!path3.isAbsolute(executable)) throw new ObservationError("Git executable must be trusted and absolute.");
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
  }
});

// src/runtime-support.ts
import { createHash } from "node:crypto";
import { lstat as lstat3, realpath as realpath4 } from "node:fs/promises";
import path4 from "node:path";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value).sort(ordinal).map((key) => [key, canonical(value[key])])
    );
  return value;
}
function sameObserved(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
async function inspectPath(file) {
  return inspectPathIdentity(file, (locator) => lstat3(locator), sameObserved);
}
async function inspectPathIdentity(file, read, same) {
  const absolute = path4.resolve(file);
  let initial;
  try {
    initial = await read(absolute);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const root = path4.parse(absolute).root;
  const parts = path4.relative(root, absolute).split(path4.sep).filter(Boolean);
  const observed = [];
  let missing;
  let current = root;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path4.join(current, parts[index] ?? "");
    const locator = index === -1 && current.startsWith("\\\\?\\") && current.length === 7 && current[5] === ":" ? current.slice(4) : current;
    let info;
    try {
      info = await read(locator);
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
    const after = await read(item.locator);
    if (after.isSymbolicLink() || item.info.dev !== after.dev || item.info.ino !== after.ino || item.info.mode !== after.mode)
      throw new ObservationError("Observed path component identity changed.");
  }
  if (!initial) {
    if (!missing) throw new ObservationError("Initially absent path appeared during component checks.");
    try {
      await read(missing);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return void 0;
      throw error;
    }
    throw new ObservationError("Initially absent path component appeared during checks.");
  }
  const final = observed.at(-1);
  const unchanged2 = final && same(initial, final.info);
  if (!final || final.locator !== absolute || !unchanged2)
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
async function physicalDirectory(file) {
  const info = await inspectPathIdentity(
    file,
    (locator) => lstat3(locator, { bigint: true }),
    (initial, final) => initial.isDirectory() && final.isDirectory() && initial.dev === final.dev && initial.ino === final.ino && initial.mode === final.mode
  );
  if (!info?.isDirectory()) throw new ObservationError("Observed physical directory is missing or not a directory.");
  const actual = await realpath4(file);
  if (!samePhysicalPath(file, actual))
    throw new ObservationError("Observed directory contains a link or is not physical.");
  return actual;
}
var digest, byteDigest;
var init_runtime_support = __esm({
  "src/runtime-support.ts"() {
    "use strict";
    init_errors();
    init_file_evidence();
    init_records();
    init_safe_git();
    digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
    byteDigest = (value) => createHash("sha256").update(value).digest("hex");
  }
});

// src/policy.ts
async function parseDecision(value) {
  checkRaw(value);
  let data;
  try {
    data = object(value, ["schemaVersion", "artifact", "operation", "branch", "rationale", "decisionSource"]);
  } catch {
    throw new InputError(`Invalid policy decision shape. ${DECISION_MIGRATION}`);
  }
  if (data.schemaVersion !== 2 || data.artifact !== "policy-decision")
    throw new InputError(`Invalid policy decision version/artifact. ${DECISION_MIGRATION}`);
  const branch = text(data.branch);
  if (!["repository-policy", "skill-default", "needs-decision"].includes(branch))
    throw new InputError("Invalid policy decision branch.");
  const source = object(data.decisionSource, ["kind", "reference"]);
  if (source.kind !== "agent-semantic") throw new InputError("A semantic Agent decision record is required.");
  return {
    schemaVersion: 2,
    artifact: "policy-decision",
    operation: await parseOperation(data.operation),
    branch,
    rationale: text(data.rationale),
    decisionSource: { kind: "agent-semantic", reference: text(source.reference) }
  };
}
async function checkRouting(input) {
  const decision = await parseDecision(input.decision);
  const operation = await parseOperation(input.operation);
  if (digest(operation) !== digest(decision.operation))
    throw new InputError("Decision and supplied operation scopes differ.");
  return {
    operation,
    branch: decision.branch,
    issues: [],
    limitations: [
      "Routing checks declared operation consistency only; it does not discover or interpret repository policy, inspect actual Git state or verify freshness.",
      "Agent semantic decisions and references are declarations, not authenticated policy truth or user authorization.",
      "Repository-policy validation is not performed; repository-policy and needs-decision routes do not load default identity evidence."
    ],
    exitCode: decision.branch === "repository-policy" ? 10 : decision.branch === "skill-default" ? 0 : 20
  };
}
var DECISION_MIGRATION;
var init_policy = __esm({
  "src/policy.ts"() {
    "use strict";
    init_input_contract();
    init_records();
    init_runtime_support();
    DECISION_MIGRATION = "Use a schemaVersion 2 AI policy-decision with operation, branch, rationale and decisionSource; policy scan, --context and scanner fields are no longer supported.";
  }
});

// src/message-assessment.ts
function rows(value) {
  if (!Array.isArray(value)) throw new InputError("Assessment requires an array.");
  return value;
}
async function parseAssessment(value, route, messageSha256, records, summary) {
  if (value === void 0) return { signatures: [], migrations: [] };
  checkRaw(value);
  let data;
  try {
    data = object(value, ["schemaVersion", "artifact", "operation", "messageSha256", "signatures", "migrations"]);
  } catch {
    throw new InputError(
      "Invalid message assessment shape; migrate to schemaVersion 3 confirmed-identity assessment inputs without event or exception fields."
    );
  }
  if (data.schemaVersion !== 3 || data.artifact !== "message-assessment" || data.messageSha256 !== messageSha256 || digest(await parseOperation(data.operation)) !== digest(route.operation))
    throw new InputError(
      "Message assessment requires schemaVersion 3 and exact declared operation/message association; migrate old AI decision/assessment inputs."
    );
  const identityKeys = new Set(summary.tuples.map(identityKey));
  const signatures = rows(data.signatures).map((item) => {
    const row = object(item, ["id", "source", "classification", "identityKeys", "evidenceReferences", "rationale"]);
    let source;
    try {
      source = object(row.source, ["kind", "messageRecordId", "reference"]);
    } catch {
      throw new InputError(
        "Invalid signature source; migrate to schemaVersion 3 message-record or automatic-signing sources."
      );
    }
    const classification = text(row.classification);
    if (!["ai-signature", "human-signature", "unrelated", "uncertain"].includes(classification) || Object.keys(source).length !== 2)
      throw new InputError(
        "Invalid signature assessment source/classification; schemaVersion 3 requires an explicit source kind."
      );
    let location;
    if (source.kind === "message-record" && source.reference === void 0) {
      location = { kind: "message-record", messageRecordId: exact(source.messageRecordId) };
      const messageRecordId = location.messageRecordId;
      if (!records.some((record2) => record2.id === messageRecordId))
        throw new InputError("Unknown message record assessment.");
    } else if (source.kind === "automatic-signing" && source.messageRecordId === void 0)
      location = { kind: "automatic-signing", reference: exact(source.reference) };
    else
      throw new InputError(
        "Invalid signature source; schemaVersion 3 requires message-record or automatic-signing."
      );
    const keys = strings(row.identityKeys);
    if (keys.some((id) => !identityKeys.has(id))) throw new InputError("Unknown signature identity association.");
    const evidenceReferences = strings(row.evidenceReferences);
    if (!evidenceReferences.length)
      throw new InputError("Signature assessment needs concrete evidence references.");
    return {
      id: exact(row.id),
      source: location,
      classification,
      identityKeys: keys,
      evidenceReferences,
      rationale: text(row.rationale)
    };
  });
  if (new Set(signatures.map((signature) => signature.id)).size !== signatures.length || new Set(signatures.map((signature) => JSON.stringify(signature.source))).size !== signatures.length)
    throw new InputError("Duplicate signature assessment ID/source.");
  const migrated = /* @__PURE__ */ new Set();
  const migrations = rows(data.migrations).map((item) => {
    const row = object(item, ["signatureIds", "identityKeys", "mappingReferences", "modificationDecision"]);
    const signatureIds = strings(row.signatureIds), keys = strings(row.identityKeys), mappingReferences = strings(row.mappingReferences);
    const decision = object(row.modificationDecision, ["operationId", "reference"]);
    if (!signatureIds.length || !keys.length || !mappingReferences.length || exact(decision.operationId) !== route.operation.id)
      throw new InputError(
        "Migration requires exact signatures/keys/mapping and a current modification decision."
      );
    for (const id of signatureIds) {
      const signature = signatures.find((signature2) => signature2.id === id);
      if (signature?.classification !== "ai-signature" || signature.source.kind !== "message-record" || migrated.has(id) || !signature.identityKeys.length || signature.identityKeys.some((key) => !keys.includes(key)))
        throw new InputError("Invalid, duplicate or unsupported migration signature mapping.");
      migrated.add(id);
    }
    const joined = unique(
      signatures.filter((signature) => signatureIds.includes(signature.id)).flatMap((signature) => signature.identityKeys)
    );
    if (JSON.stringify(joined) !== JSON.stringify(keys) || keys.some((id) => !identityKeys.has(id)))
      throw new InputError("Migration pairing does not cover exact resolved identity keys.");
    return {
      signatureIds,
      identityKeys: keys,
      mappingReferences,
      modificationDecision: { operationId: exact(decision.operationId), reference: text(decision.reference) }
    };
  });
  return { signatures, migrations };
}
var exact;
var init_message_assessment = __esm({
  "src/message-assessment.ts"() {
    "use strict";
    init_input_contract();
    init_records();
    init_runtime_support();
    exact = (value) => {
      text(value);
      return value;
    };
  }
});

// src/message-output.ts
import { constants as constants2 } from "node:fs";
import { lstat as lstat4, open as open2, unlink } from "node:fs/promises";
import path5 from "node:path";
async function writeNewMessage(file, bytes, scope, consumed, signal) {
  const cancelled = () => {
    if (signal?.aborted) throw new Error("Output publication cancelled.");
  };
  cancelled();
  checkRaw(file);
  if (!file) throw new InputError("Explicit output path is empty.");
  const destination = path5.resolve(file);
  if (consumed.some((input) => samePhysicalPath(path5.resolve(input), destination)) || inside(scope.gitDirectory, destination) || inside(scope.commonGitDir, destination) || destination.split(path5.sep).some((part) => part.toLowerCase() === ".git"))
    throw new InputError("Output aliases a consumed input or protected Git metadata.");
  let parent;
  try {
    if (await inspectPath(destination)) throw new Error("exists");
    parent = await physical(path5.dirname(destination));
    if (!(await lstat4(parent)).isDirectory()) throw new Error("parent");
  } catch {
    throw new InputError("Output requires an absent leaf and an existing safe physical parent directory.");
  }
  const before = await lstat4(parent, { bigint: true });
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
  const unchanged2 = (a, b) => same(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
  cancelled();
  const handle = await open2(
    destination,
    constants2.O_WRONLY | constants2.O_CREAT | constants2.O_EXCL | (constants2.O_NOFOLLOW ?? 0),
    384
  );
  let owned;
  let cleanupState;
  let complete = false;
  try {
    owned = await handle.stat({ bigint: true });
    if (!owned.isFile() || owned.nlink !== 1n || !same(owned, await lstat4(destination, { bigint: true })) || !same(before, await lstat4(parent, { bigint: true })) || !await physical(parent))
      throw new Error("Output identity changed during exclusive creation.");
    await handle.writeFile(bytes);
    await handle.sync();
    cancelled();
    const after = await handle.stat({ bigint: true });
    if (!same(owned, after) || after.nlink !== 1n || after.size !== BigInt(bytes.length) || !unchanged2(after, await lstat4(destination, { bigint: true })) || !same(before, await lstat4(parent, { bigint: true })))
      throw new Error("Output identity or length changed during writing.");
    await physical(destination);
    if (!(await readRegularFile(destination, { physicalPath: true, singleLink: true, maximumBytes: bytes.length })).equals(bytes) || !unchanged2(after, await handle.stat({ bigint: true })) || !unchanged2(after, await lstat4(destination, { bigint: true })))
      throw new Error("Output bytes changed during publication.");
    cleanupState = after;
    cancelled();
    await handle.close();
    cancelled();
    complete = true;
    return destination;
  } finally {
    if (!complete)
      await handle.close().catch(() => {
      });
    if (!complete && cleanupState) {
      try {
        const current = await lstat4(destination, { bigint: true });
        if (current.isFile() && current.nlink === 1n && unchanged2(cleanupState, current) && same(before, await lstat4(parent, { bigint: true }))) {
          const actual = await readRegularFile(destination, {
            physicalPath: true,
            singleLink: true,
            maximumBytes: bytes.length
          });
          const final = await lstat4(destination, { bigint: true });
          if (actual.equals(bytes) && unchanged2(cleanupState, final)) await unlink(destination);
        }
      } catch {
      }
    }
  }
}
var init_message_output = __esm({
  "src/message-output.ts"() {
    "use strict";
    init_file_evidence();
    init_records();
    init_runtime_support();
    init_safe_git();
  }
});

// src/message-trailers.ts
import { execFile as execFile2 } from "node:child_process";
import { mkdir, mkdtemp, realpath as realpath5, rm } from "node:fs/promises";
import os from "node:os";
import path6 from "node:path";
async function runTrailers(message, options) {
  if (message.length > INPUT_BYTES) throw new InputError("Message byte budget exceeded.");
  options.additions?.forEach(checkRaw);
  const executable = await resolveTrustedGit(options.excluded, options.environment);
  const parent = await physicalDirectory(await realpath5(os.tmpdir()));
  if (options.excluded.some((root) => inside(root, parent)))
    throw new Error("Trailer temporary directory is inside an excluded scope.");
  const directory = await mkdtemp(path6.join(parent, "attribution-trailer-"));
  try {
    await physical(directory);
    const home = path6.join(directory, "home");
    await mkdir(home);
    const environment = {
      ...gitEnvironment(options.environment),
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CEILING_DIRECTORIES: parent,
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "0"
    };
    const args = ["--no-optional-locks", "interpret-trailers", "--no-divider"];
    if (options.additions !== void 0) {
      args.push("--where=end", "--if-exists=addIfDifferent", "--if-missing=add");
      for (const line of options.additions) {
        if (!line.startsWith("Assisted-by: ")) throw new InputError("Unsupported generated trailer key.");
        args.push("--trailer", line);
      }
    } else args.push("--parse");
    return await new Promise((resolve, reject) => {
      const child = execFile2(
        executable,
        args,
        {
          cwd: directory,
          env: environment,
          shell: false,
          windowsHide: true,
          encoding: "buffer",
          timeout: 1e4,
          maxBuffer: INPUT_BYTES * 2,
          ...options.signal ? { signal: options.signal } : {}
        },
        (error, stdout) => {
          if (error)
            reject(
              new Error("Trailer processing failed, cancelled, timed out or exceeded its output budget.")
            );
          else resolve(stdout);
        }
      );
      child.stdin?.on("error", () => {
      });
      child.stdin?.end(message);
    });
  } finally {
    await removeTemporary(directory, parent);
  }
}
async function removeTemporary(directory, parent) {
  if (path6.dirname(directory) !== parent || !path6.basename(directory).startsWith("attribution-trailer-"))
    throw new Error("Unsafe trailer temporary cleanup.");
  await rm(directory, { recursive: true, force: true });
}
function decodeMessage(bytes) {
  let message;
  try {
    message = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new InputError("Message must be strict UTF-8.");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]|\r(?!\n)/u.test(message))
    throw new InputError("Message contains unsupported controls or line separators.");
  return message;
}
function preflightAssisted(message) {
  const lines = message.split(/\r?\n/);
  while (lines.at(-1)?.trim() === "") lines.pop();
  const start = lines.findLastIndex((line) => line.trim() === "");
  if (start < 0) return;
  const suffix = lines.slice(start + 1);
  if (!suffix.every((line) => /^[A-Za-z0-9][A-Za-z0-9 -]*?[ \t]*:/.test(line) || /^[ \t]/.test(line))) return;
  for (let index = 0; index < suffix.length; index++) {
    const line = suffix[index] ?? "";
    if (!/^assisted\s*-\s*by\s*:/i.test(line)) continue;
    checkRaw(line);
    if (/^[ \t]/.test(suffix[index + 1] ?? ""))
      throw new InputError("Folded Assisted-by is not a single-line record.");
  }
}
function messageLayout(message, parsed) {
  const lines = [...message.matchAll(/([^\n]*)(?:\n|$)/g)].filter((match) => match[0] !== "").map((match) => ({
    raw: match[0],
    text: (match[1] ?? "").replace(/\r$/, ""),
    start: match.index,
    end: match.index + match[0].length
  }));
  const eol = [...message.matchAll(/\r?\n/g)].at(-1)?.[0] ?? "\n";
  let last = lines.length - 1;
  while (last >= 0 && lines[last]?.text.trim() === "") last--;
  let first = last;
  while (first > 0 && lines[first - 1]?.text.trim() !== "") first--;
  const suffix = lines.slice(first, last + 1);
  const records = [];
  for (const line of suffix) {
    const match = /^([A-Za-z0-9][A-Za-z0-9 -]*?)[ \t]*:[ \t]*(.*)$/.exec(line.text);
    if (match?.[1] && match[2] !== void 0) {
      records.push({
        id: "",
        key: match[1],
        value: match[2],
        raw: line.raw,
        start: line.start,
        end: line.end,
        folded: false
      });
    } else if (/^[ \t]/.test(line.text) && records.length) {
      const previous = records.at(-1);
      if (previous) {
        previous.raw += line.raw;
        previous.end = line.end;
        previous.folded = true;
      }
    } else if (parsed.trim()) throw new InputError("Ambiguous terminal trailer spans cannot be preserved safely.");
  }
  const hasAssisted = suffix.some((line) => /^assisted\s*-\s*by\s*:/i.test(line.text));
  if (!parsed.trim()) {
    if (hasAssisted && first > 0 && suffix.every((line) => /^[A-Za-z0-9][A-Za-z0-9 -]*?[ \t]*:/.test(line.text) || /^[ \t]/.test(line.text)))
      throw new InputError("Malformed terminal Assisted-by trailer block.");
    return { records: [], start: message.length, end: message.length, eol };
  }
  if (first === 0 || records.length !== parsed.trimEnd().split("\n").length)
    throw new InputError("Ambiguous terminal trailer structure cannot be preserved safely.");
  for (const record2 of records)
    record2.id = digest([
      "message-record-v1",
      byteDigest(Buffer.from(message)),
      record2.start,
      record2.end,
      record2.raw
    ]);
  const endings = new Set(records.flatMap((record2) => [...record2.raw.matchAll(/\r?\n/g)].map((match) => match[0])));
  if (endings.size > 1)
    throw new InputError("Mixed terminal trailer line endings require a decision before rewriting.");
  return {
    records,
    start: suffix[0]?.start ?? message.length,
    end: suffix.at(-1)?.end ?? message.length,
    eol: [...endings][0] ?? eol
  };
}
function reconcileSpans(message, layout, removed, additions) {
  if (!removed.size && !additions.length) return message;
  if (!layout.records.length) {
    if (!additions.length) return message;
    let prefix2 = message;
    if (!prefix2.endsWith("\n")) prefix2 += layout.eol;
    if (!/\r?\n[ \t]*\r?\n$/.test(prefix2)) prefix2 += layout.eol;
    return prefix2 + additions.join(layout.eol) + layout.eol;
  }
  const prefix = message.slice(0, layout.start);
  let retained = layout.records.filter((record2) => !removed.has(record2.id)).map((record2) => record2.raw).join("");
  if (additions.length) {
    if (retained && !retained.endsWith("\n")) retained += layout.eol;
    retained += additions.join(layout.eol);
    if (message.slice(0, layout.end).endsWith("\n")) retained += layout.eol;
  }
  return prefix + retained + message.slice(layout.end);
}
var init_message_trailers = __esm({
  "src/message-trailers.ts"() {
    "use strict";
    init_input_contract();
    init_records();
    init_runtime_support();
    init_safe_git();
  }
});

// src/output-scope.ts
import path7 from "node:path";
async function resolveOutputScope(operation) {
  const worktree = await physicalDirectory(operation.worktree);
  const executable = await resolveTrustedGit([operation.repository, worktree, operation.commonGitDir]);
  const git = new SafeGit(executable, worktree);
  await git.guard();
  const top = await physicalDirectory(await git.text("rev-parse", ["--show-toplevel"]));
  const gitDirectory = await physicalDirectory(await git.text("rev-parse", ["--absolute-git-dir"]));
  const commonGitDir = await physicalDirectory(
    path7.resolve(worktree, await git.text("rev-parse", ["--git-common-dir"]))
  );
  if (!samePhysicalPath(top, operation.repository) || !samePhysicalPath(top, worktree) || !samePhysicalPath(commonGitDir, operation.commonGitDir))
    throw new InputError("Explicit output scope differs from the actual Git directories.");
  return { gitDirectory, commonGitDir };
}
var init_output_scope = __esm({
  "src/output-scope.ts"() {
    "use strict";
    init_file_evidence();
    init_records();
    init_runtime_support();
    init_safe_git();
  }
});

// src/summarize.ts
var summarize_exports = {};
__export(summarize_exports, {
  summarize: () => summarize
});
async function summarize(input, currentOperation, registryInput) {
  const ledger = await parseLedger(input);
  const operation = await parseOperation(currentOperation);
  if (JSON.stringify(ledger.operation) !== JSON.stringify(operation))
    throw new InputError("Invalid input scope: ledger and current operation differ.");
  const registry = parseRegistry(registryInput);
  const tuples = normalizeIdentities(ledger.identities, registry);
  const blockers = [...ledger.blockers].sort((a, b) => ordinal(a.id, b.id));
  return {
    schemaVersion: 2,
    ledgerId: ledger.ledgerId,
    operation,
    tuples,
    blockers,
    issues: blockers.map((blocker) => ({ id: blocker.id, code: "known-blocker", detail: blocker.reason })),
    limitations: [
      "Confirmed identities and blockers are supplied declarations; this summary cannot authenticate facts or user authority.",
      "The finite declared set cannot prove that no contributing actors were omitted.",
      "Matching supplied physical scope does not prove the live Git operation or its freshness.",
      "Summary completion is not repository-policy validation or authorization to commit or modify Git state."
    ],
    exitCode: blockers.length ? 20 : 0
  };
}
var init_summarize = __esm({
  "src/summarize.ts"() {
    "use strict";
    init_records();
  }
});

// src/message.ts
var message_exports = {};
__export(message_exports, {
  processMessage: () => processMessage
});
function assisted(record2, registry) {
  checkRaw(record2.key);
  checkRaw(record2.value);
  if (record2.folded) throw new InputError("Folded Assisted-by is not a single-line record.");
  const match = /^([^:()<>]+):([^\s()<>]+)(?: \(([^\s:()<>]+)\))?$/.exec(record2.value);
  if (!match?.[1] || !match[2] || ["unknown", "n/a", "null", "auto", "latest"].includes(match[2].toLowerCase()))
    throw new InputError("Malformed default Assisted-by identity or optional suffix.");
  const agent = match[1].trim();
  if (!agent || ["unknown", "n/a", "null"].includes(agent.toLowerCase()))
    throw new InputError("Malformed default Assisted-by Agent placeholder.");
  const parsed = parseIdentity({ agent, model: match[2], ...match[3] ? { reasoning: match[3] } : {} });
  const host = registry.hosts.find((host2) => host2.name === agent || host2.aliases.includes(agent));
  return {
    agent: host?.name ?? agent,
    model: parsed.model,
    ...parsed.reasoning ? { reasoning: parsed.reasoning } : {}
  };
}
async function processMessage(input, loadDefault) {
  if (!["render", "validate"].includes(input.mode) || input.mode === "validate" && input.output !== void 0)
    throw new InputError("Invalid message command or validate output option.");
  checkRaw(input.output);
  if (input.message.length > INPUT_BYTES) throw new InputError("Message byte budget exceeded.");
  const message = decodeMessage(input.message);
  const route = await checkRouting(input);
  const result = {
    schemaVersion: 3,
    artifact: input.mode === "render" ? "message-render" : "message-validation",
    operation: route.operation,
    routing: { branch: route.branch },
    message: { inputSha256: byteDigest(input.message) },
    format: {
      status: "not-run",
      convention: route.branch === "repository-policy" ? "repository-policy" : "undetermined"
    },
    participationEvidence: { status: "not-run" },
    repositoryPolicyValidation: { status: "not-run" },
    issues: [...route.issues],
    limitations: [
      ...route.limitations,
      "Message results cannot authenticate declared participation, semantic signature mappings or actual user decisions; they never grant operation permission.",
      "Unobserved host signing and ordinary repository commit-format criteria remain integrator responsibilities."
    ],
    exitCode: route.exitCode
  };
  if (route.branch === "needs-decision") return result;
  const cancelled = () => {
    if (input.signal?.aborted) throw new Error("Message processing cancelled before completion.");
  };
  cancelled();
  let candidate = message;
  if (route.branch === "skill-default") {
    const defaults = await loadDefault();
    cancelled();
    const { summarize: summarize2 } = await Promise.resolve().then(() => (init_summarize(), summarize_exports));
    const summary = await summarize2(defaults.ledger, route.operation, defaults.registry);
    const registry = parseRegistry(defaults.registry);
    for (const host of registry.hosts) {
      checkRaw(host.name);
      if (/[:()<>]/.test(host.name))
        throw new InputError("Registry host cannot be expressed as a default trailer.");
    }
    result.format = { status: "valid", convention: "skill-default" };
    result.participationEvidence = {
      status: summary.issues.length ? "incomplete" : "complete-against-declared-input",
      summary
    };
    const summaryIssues = new Set(
      summary.issues.map(
        (item) => issue(item.id, item.code, "A declared required identity or inclusion blocker remains unresolved.")
      )
    );
    result.issues.push(...summaryIssues);
    const excluded = [route.operation.repository, route.operation.worktree, route.operation.commonGitDir];
    let layout;
    try {
      preflightAssisted(message);
      const parsed = decodeMessage(
        await runTrailers(Buffer.from(message.replaceAll("\r\n", "\n")), {
          excluded,
          ...input.signal ? { signal: input.signal } : {}
        })
      );
      layout = messageLayout(message, parsed);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      result.format.status = "invalid";
      result.exitCode = 2;
      result.issues.push(
        issue(digest(["format", result.message.inputSha256]), "invalid-trailer-layout", error.message)
      );
      return result;
    }
    const assessment = await parseAssessment(
      defaults.assessment,
      route,
      result.message.inputSha256,
      layout.records,
      summary
    );
    result.message.records = layout.records.map((record2) => ({
      id: record2.id,
      key: record2.key,
      sha256: byteDigest(Buffer.from(record2.raw)),
      byteLength: Buffer.byteLength(record2.raw)
    }));
    const removed = /* @__PURE__ */ new Set();
    const canonical2 = summary.tuples.map(
      (tuple) => `Assisted-by: ${tuple.agent}:${tuple.model}${tuple.reasoning ? ` (${tuple.reasoning})` : ""}`
    );
    const actual = [];
    let invalid = false;
    for (const record2 of layout.records) {
      if (/^assisted\s*-\s*by$/i.test(record2.key)) {
        try {
          const tuple = assisted(record2, registry);
          const matching = summary.tuples.filter(
            (expected) => expected.agent === tuple.agent && expected.model === tuple.model
          );
          if (!matching.length) {
            result.issues.push(
              issue(
                record2.id,
                "unresolved-existing-identity",
                "Existing Agent/model has no supported current identity association."
              )
            );
          } else {
            const line = `Assisted-by: ${tuple.agent}:${tuple.model}${tuple.reasoning ? ` (${tuple.reasoning})` : ""}`;
            actual.push(line);
            if (!canonical2.includes(line) || record2.key !== "Assisted-by" || record2.raw.replace(/\r?\n$/, "") !== line)
              invalid = true;
            removed.add(record2.id);
          }
        } catch (error) {
          if (!(error instanceof InputError)) throw error;
          invalid = true;
          result.issues.push(issue(record2.id, "invalid-assisted-by", error.message));
        }
      } else if (/^AI-(?:Agent|Model|Reasoning-Effort)$/i.test(record2.key)) {
        const signature = assessment.signatures.find(
          (signature2) => signature2.source.kind === "message-record" && signature2.source.messageRecordId === record2.id
        );
        const migration = signature && assessment.migrations.find((migration2) => migration2.signatureIds.includes(signature.id));
        if (migration && input.mode === "render") removed.add(record2.id);
        else
          result.issues.push(
            issue(
              record2.id,
              "legacy-signature",
              "Legacy signature needs an exact identity mapping and current modification decision."
            )
          );
      }
    }
    for (const signature of assessment.signatures) {
      if (signature.classification === "uncertain")
        result.issues.push(
          issue(
            signature.id,
            "uncertain-signature",
            "A concrete supplied signature assessment remains uncertain."
          )
        );
      if (signature.classification !== "ai-signature") continue;
      if (signature.source.kind === "automatic-signing") {
        result.issues.push(
          issue(
            signature.id,
            "automatic-ai-signature",
            "Declared automatic AI signing conflicts with the default route; resolve it without changing identity or global configuration."
          )
        );
      } else {
        const messageRecordId = signature.source.messageRecordId;
        const record2 = layout.records.find((record3) => record3.id === messageRecordId);
        if (record2 && !/^assisted\s*-\s*by$/i.test(record2.key) && !removed.has(record2.id)) {
          if (input.mode === "render" && assessment.migrations.some((migration) => migration.signatureIds.includes(signature.id)))
            removed.add(record2.id);
          else if (!/^AI-(?:Agent|Model|Reasoning-Effort)$/i.test(record2.key))
            result.issues.push(
              issue(
                record2.id,
                "ai-signature-conflict",
                "Known AI signature needs exact authorized migration before default completion."
              )
            );
        }
      }
    }
    const formatIssues = result.issues.filter((item) => item.code === "invalid-assisted-by");
    const blockers = result.issues.filter((item) => !formatIssues.includes(item));
    if (formatIssues.length || input.mode === "validate" && invalid) {
      result.format.status = "invalid";
      result.exitCode = 2;
      if (!formatIssues.length)
        result.issues.push(
          issue(
            digest(["canonical", result.message.inputSha256]),
            "noncanonical-assisted-by",
            "Default records need canonical names, spacing and supported optional effort."
          )
        );
      return result;
    }
    if (blockers.length) {
      result.exitCode = 20;
      return result;
    }
    if (input.mode === "validate") {
      const expected = canonical2.join("\n");
      const indexes = layout.records.flatMap(
        (record2, index) => /^assisted\s*-\s*by$/i.test(record2.key) ? [index] : []
      );
      const adjacent = indexes.every(
        (index, position) => position === 0 || index === (indexes[position - 1] ?? 0) + 1
      );
      if (actual.join("\n") !== expected || !adjacent) {
        result.exitCode = actual.length === new Set(actual).size && actual.length < canonical2.length ? 20 : 2;
        result.format.status = result.exitCode === 2 ? "invalid" : "valid";
        result.issues.push(
          issue(
            digest(["tuples", result.message.inputSha256]),
            "missing-or-unsorted-tuples",
            "Actual trailer group differs from the canonical supported current tuples."
          )
        );
      } else result.exitCode = 0;
      cancelled();
      return result;
    }
    const retained = reconcileSpans(message, layout, removed, []);
    const inserted = decodeMessage(
      await runTrailers(Buffer.from(retained.replaceAll("\r\n", "\n")), {
        excluded,
        additions: canonical2,
        ...input.signal ? { signal: input.signal } : {}
      })
    );
    const interpreted = decodeMessage(
      await runTrailers(Buffer.from(inserted), { excluded, ...input.signal ? { signal: input.signal } : {} })
    );
    if (canonical2.some((line) => !interpreted.split("\n").includes(line)))
      throw new Error("Trailer insertion did not retain canonical supplied records.");
    candidate = reconcileSpans(message, layout, removed, canonical2);
    const finalParsed = decodeMessage(
      await runTrailers(Buffer.from(candidate.replaceAll("\r\n", "\n")), {
        excluded,
        ...input.signal ? { signal: input.signal } : {}
      })
    );
    const finalLayout = messageLayout(candidate, finalParsed);
    const final = finalLayout.records.filter((record2) => /^Assisted-by$/i.test(record2.key)).map((record2) => record2.raw.replace(/\r?\n$/, ""));
    if (JSON.stringify(final) !== JSON.stringify(canonical2))
      throw new Error("Final canonical trailer semantics differ from the supported tuple set.");
    result.exitCode = 0;
  }
  if (input.mode === "render") {
    cancelled();
    result.message.outputSha256 = byteDigest(Buffer.from(candidate));
    result.message.preview = candidate;
    result.message.changed = candidate !== message;
    if (input.output !== void 0)
      result.message.outputPath = await writeNewMessage(
        input.output,
        Buffer.from(candidate),
        await resolveOutputScope(route.operation),
        input.consumedPaths ?? [],
        input.signal
      );
  }
  return result;
}
var issue;
var init_message = __esm({
  "src/message.ts"() {
    "use strict";
    init_input_contract();
    init_message_assessment();
    init_message_output();
    init_message_trailers();
    init_output_scope();
    init_policy();
    init_records();
    init_runtime_support();
    issue = (id, code, detail) => ({ id, code, detail });
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

// src/attribution.ts
init_file_evidence();
init_input_contract();
init_policy();
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
      maximumBytes: INPUT_BYTES
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
async function run(args) {
  if (args[0] === "policy" || args.includes("--context")) throw new InputError(DECISION_MIGRATION);
  if (args[0] === "render" || args[0] === "validate") {
    const mode = args[0];
    const options2 = /* @__PURE__ */ new Map();
    for (let index = 1; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1];
      if (!flag || !["--message", "--operation", "--decision", "--input", "--assessment", "--output"].includes(flag) || options2.has(flag) || !value || value.startsWith("--") || mode === "validate" && flag === "--output")
        throw new InputError("Invalid message flag, duplicate or missing value.");
      checkRaw(value);
      options2.set(flag, value);
    }
    const messageFile = options2.get("--message"), operationFile = options2.get("--operation"), decisionFile = options2.get("--decision");
    if (!messageFile || !operationFile || !decisionFile)
      throw new InputError(
        "Message commands require explicit message, operation and schemaVersion 2 AI decision files."
      );
    const operation2 = await jsonFile(operationFile), decision = await jsonFile(decisionFile);
    const message = await readRegularFile(messageFile, { physicalPath: true, maximumBytes: INPUT_BYTES });
    const consumedPaths = [messageFile, operationFile, decisionFile];
    const { processMessage: processMessage2 } = await Promise.resolve().then(() => (init_message(), message_exports));
    const output = options2.get("--output");
    return processMessage2(
      { mode, message, operation: operation2, decision, consumedPaths, ...output ? { output } : {} },
      async () => {
        const input = options2.get("--input");
        if (!input) throw new InputError("Current skill-default message requires an explicit ledger input.");
        const registryFile = new URL("../references/agent-registry.json", import.meta.url);
        const assessment = options2.get("--assessment");
        consumedPaths.push(input, fileURLToPath(registryFile), ...assessment ? [assessment] : []);
        return {
          ledger: await jsonFile(input),
          registry: await jsonFile(registryFile),
          ...assessment ? { assessment: await jsonFile(assessment) } : {}
        };
      }
    );
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
      JSON.stringify({
        error: input ? error.message : process.argv.includes("--output") ? "Attribution execution failed. Check the explicit output location for a residual artifact; uncertain ownership is preserved." : "Attribution execution failed.",
        exitCode: input ? 2 : 1
      })
    );
    process.exitCode = input ? 2 : 1;
  }
}
export {
  parseArguments,
  run
};
