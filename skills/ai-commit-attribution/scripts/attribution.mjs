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
  const acquire = io.open ?? (async (name, flags2) => {
    const handle2 = await open(name, flags2);
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
    const bytes2 = await handle.readFile(io.maximumBytes);
    if (!unchanged(before, await handle.stat()) || !unchanged(before, await inspect(file)) || BigInt(bytes2.length) !== before.size)
      throw new Error("Evidence file identity or metadata changed.");
    if (io.physicalPath && !samePhysicalPath(file, await realpath(file)))
      throw new Error("Evidence path changed during descriptor read.");
    return bytes2;
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
  const relative = path3.relative(
    path3.toNamespacedPath(path3.resolve(root)),
    path3.toNamespacedPath(path3.resolve(target))
  );
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
  return command === "rev-parse" && (["--show-toplevel", "--absolute-git-dir", "--git-common-dir"].some((option) => sameArgs(args, [option])) || sameArgs(args, ["--path-format=absolute", "--git-path", "info/exclude"])) || command === "ls-files" && sameArgs(args, ["--cached", "--full-name", "-z"]) || command === "check-ignore" && sameArgs(args, ["--no-index", "--", ".ai-commit-attribution/", ".ai-commit-attribution/state.json"]);
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
            // check-ignore accepts fixed pathnames, not Git pathspec magic (including literal).
            ...command === "check-ignore" ? [] : ["--literal-pathspecs"],
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
async function inspectPathIdentity(file, read, same2) {
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
  const unchanged4 = final && same2(initial, final.info);
  if (!final || final.locator !== absolute || !unchanged4)
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

// src/result-contract.ts
function invalid() {
  throw new InputError("Invalid portable result contract.");
}
function uuid(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) invalid();
  return value;
}
function fullObjectId(value, width) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) || /^0+$/.test(value) || width !== void 0 && value.length !== width)
    invalid();
  return value;
}
function sha256(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}
function parseResultPlan(value, operation) {
  checkRaw(value);
  const data = object(value, ["schemaVersion", "form", "expectedParents", "replacementTarget", "sourceTargets"]);
  if (data.schemaVersion !== 1 || !["create", "replace"].includes(data.form) || !Array.isArray(data.expectedParents) || !Array.isArray(data.sourceTargets))
    invalid();
  const expectedParents = data.expectedParents.map((item) => fullObjectId(item));
  const replacementTarget = data.form === "replace" ? fullObjectId(data.replacementTarget) : void 0;
  if (data.form === "create" && Object.hasOwn(data, "replacementTarget")) invalid();
  const sourceTargets = data.sourceTargets.map((item) => {
    const source = object(item, ["role", "objectId"]);
    const role = text(source.role);
    if (role !== source.role) invalid();
    return { role, objectId: fullObjectId(source.objectId) };
  });
  if (new Set(sourceTargets.map((source) => source.role)).size !== sourceTargets.length) invalid();
  const ids = [
    ...expectedParents,
    ...sourceTargets.map((source) => source.objectId),
    ...replacementTarget ? [replacementTarget] : []
  ];
  if (ids.some((id2) => id2.length !== ids[0]?.length)) invalid();
  if (operation && (sourceTargets.length !== operation.targets.length || sourceTargets.some(
    (source) => !operation.targets.some(
      (target) => source.role === target.role && source.objectId === target.objectId
    )
  )))
    invalid();
  return {
    schemaVersion: 1,
    form: data.form,
    expectedParents,
    ...replacementTarget ? { replacementTarget } : {},
    sourceTargets
  };
}
function parsePreparedReceipt(value) {
  const data = object(value, [
    "schemaVersion",
    "artifact",
    "preparationId",
    "sourceContextId",
    "ledgerId",
    "revision",
    "ledger",
    "decision",
    "resultPlan",
    "observedHead",
    "objectFormat",
    "indexManifestSha256",
    "expectedTree",
    "candidate"
  ]);
  if (data.schemaVersion !== 1 || data.artifact !== "prepared-receipt" || !Number.isSafeInteger(data.revision) || data.revision <= 0)
    invalid();
  const ledgerId = uuid(data.ledgerId);
  const rawLedger = object(data.ledger, ["schemaVersion", "ledgerId", "operation", "identities", "blockers"]);
  checkRaw(rawLedger);
  if (rawLedger.schemaVersion !== 2 || uuid(rawLedger.ledgerId) !== ledgerId || !Array.isArray(rawLedger.identities) || !Array.isArray(rawLedger.blockers))
    invalid();
  const operation = parseOperationShape(rawLedger.operation);
  const blockers = rawLedger.blockers.map((item) => {
    const blocker = object(item, ["id", "reason"]);
    text(blocker.id);
    const id2 = blocker.id;
    return { id: id2, reason: text(blocker.reason) };
  });
  if (new Set(blockers.map((blocker) => blocker.id)).size !== blockers.length) invalid();
  const identities = rawLedger.identities.map(parseIdentity);
  if (new Set(identities.map(identityKey)).size !== identities.length) invalid();
  const ledger = {
    schemaVersion: 2,
    ledgerId,
    operation,
    identities,
    blockers
  };
  const rawDecision = object(data.decision, [
    "schemaVersion",
    "artifact",
    "operation",
    "branch",
    "rationale",
    "decisionSource"
  ]);
  checkRaw(rawDecision);
  const source = object(rawDecision.decisionSource, ["kind", "reference"]);
  if (rawDecision.schemaVersion !== 2 || rawDecision.artifact !== "policy-decision" || !["repository-policy", "skill-default"].includes(rawDecision.branch) || source.kind !== "agent-semantic")
    invalid();
  const decisionOperation = parseOperationShape(rawDecision.operation);
  if (digest(operation) !== digest(decisionOperation)) invalid();
  const decision = {
    schemaVersion: 2,
    artifact: "policy-decision",
    operation: decisionOperation,
    branch: rawDecision.branch,
    rationale: text(rawDecision.rationale),
    decisionSource: { kind: "agent-semantic", reference: text(source.reference) }
  };
  if (data.objectFormat !== "sha1" && data.objectFormat !== "sha256") invalid();
  const width = data.objectFormat === "sha1" ? 40 : 64;
  const resultPlan = parseResultPlan(data.resultPlan, operation);
  const observedHead = data.observedHead === null ? null : fullObjectId(data.observedHead, width);
  for (const id2 of [
    ...resultPlan.expectedParents,
    ...resultPlan.sourceTargets.map((target) => target.objectId),
    ...resultPlan.replacementTarget ? [resultPlan.replacementTarget] : []
  ])
    fullObjectId(id2, width);
  if (resultPlan.form === "create" ? observedHead === null ? resultPlan.expectedParents.length !== 0 : resultPlan.expectedParents[0] !== observedHead : observedHead === null || resultPlan.replacementTarget !== observedHead)
    invalid();
  const candidate = object(data.candidate, ["encoding", "bytes", "byteLength", "sha256"]);
  if (candidate.encoding !== "base64" || typeof candidate.bytes !== "string" || candidate.bytes.length > Math.ceil(INPUT_BYTES / 3) * 4 || !Number.isSafeInteger(candidate.byteLength) || candidate.byteLength < 0 || candidate.byteLength > INPUT_BYTES)
    invalid();
  const bytes2 = Buffer.from(candidate.bytes, "base64");
  if (bytes2.toString("base64") !== candidate.bytes || bytes2.length !== candidate.byteLength || byteDigest(bytes2) !== sha256(candidate.sha256))
    invalid();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes2);
  } catch {
    invalid();
  }
  return {
    schemaVersion: 1,
    artifact: "prepared-receipt",
    preparationId: uuid(data.preparationId),
    sourceContextId: uuid(data.sourceContextId),
    ledgerId,
    revision: data.revision,
    ledger,
    decision,
    resultPlan,
    observedHead,
    objectFormat: data.objectFormat,
    indexManifestSha256: sha256(data.indexManifestSha256),
    expectedTree: fullObjectId(data.expectedTree, width),
    candidate: {
      encoding: "base64",
      bytes: candidate.bytes,
      byteLength: bytes2.length,
      sha256: candidate.sha256
    }
  };
}
var init_result_contract = __esm({
  "src/result-contract.ts"() {
    "use strict";
    init_input_contract();
    init_records();
    init_runtime_support();
  }
});

// src/result-review.ts
function invalid2() {
  throw new InputError("Invalid portable result review.");
}
function uuid2(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) invalid2();
  return value;
}
function sha2562(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid2();
  return value;
}
function parseResultReview(value) {
  checkRaw(value);
  const data = object(value, [
    "schemaVersion",
    "artifact",
    "contextId",
    "ledgerId",
    "preparationId",
    "sha",
    "messageSha256",
    "createdByPreparation",
    "policyReviewed",
    "reference",
    "acceptMessageChange",
    "repositoryPolicyChecked"
  ]);
  if (data.schemaVersion !== 1 || data.artifact !== "result-review" || data.createdByPreparation !== true || data.policyReviewed !== true)
    invalid2();
  for (const key of ["acceptMessageChange", "repositoryPolicyChecked"])
    if (Object.hasOwn(data, key) && data[key] !== true) invalid2();
  text(data.reference);
  return {
    schemaVersion: 1,
    artifact: "result-review",
    contextId: uuid2(data.contextId),
    ledgerId: uuid2(data.ledgerId),
    preparationId: uuid2(data.preparationId),
    sha: fullObjectId(data.sha),
    messageSha256: sha2562(data.messageSha256),
    createdByPreparation: true,
    policyReviewed: true,
    reference: data.reference,
    ...data.acceptMessageChange === true ? { acceptMessageChange: true } : {},
    ...data.repositoryPolicyChecked === true ? { repositoryPolicyChecked: true } : {}
  };
}
function parseSealedResult(value) {
  const data = object(value, ["preparationId", "sha", "messageSha256", "review", "checks"]);
  const review = parseResultReview(data.review);
  const preparationId = uuid2(data.preparationId), sha = fullObjectId(data.sha), messageSha256 = sha2562(data.messageSha256);
  const checks = object(data.checks, ["parents", "tree", "message", "participation"]);
  if (preparationId !== review.preparationId || sha !== review.sha || messageSha256 !== review.messageSha256 || checks.parents !== true || checks.tree !== true || !["candidate-equivalent", "explicit-final-review"].includes(checks.message) || !["frozen-default-check", "repository-rule-declaration"].includes(checks.participation))
    invalid2();
  if (checks.message === "explicit-final-review" && review.acceptMessageChange !== true) invalid2();
  if (checks.participation === "repository-rule-declaration" && review.repositoryPolicyChecked !== true) invalid2();
  return {
    preparationId,
    sha,
    messageSha256,
    review,
    checks: {
      parents: true,
      tree: true,
      message: checks.message,
      participation: checks.participation
    }
  };
}
var init_result_review = __esm({
  "src/result-review.ts"() {
    "use strict";
    init_input_contract();
    init_records();
    init_result_contract();
  }
});

// src/ledger-contract.ts
import path5 from "node:path";
function object2(value, keys) {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new InputError("Invalid ledger state: unexpected object shape.");
  return value;
}
function uuid3(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))
    throw new InputError("Invalid ledger state: UUID must have canonical lowercase spelling.");
  return value;
}
function integer(value, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    throw new InputError("Invalid ledger state: version/revision must be a bounded safe integer.");
  return value;
}
function array(value, parse) {
  if (!Array.isArray(value)) throw new InputError("Invalid ledger state: expected array.");
  return value.map(parse);
}
function distinct(values) {
  if (new Set(values).size !== values.length) throw new InputError("Invalid ledger state: duplicate key/reference.");
}
function parseBlocker(value) {
  checkRaw(value);
  const data = object2(value, ["id", "reason"]);
  if (typeof data.id !== "string" || !data.id.trim())
    throw new InputError("Invalid ledger state: blocker ID is empty.");
  return { id: data.id, reason: text(data.reason) };
}
function parseLocator(value) {
  const data = object2(value, ["worktree", "gitDirectory", "commonGitDir"]);
  const directory = (value2) => {
    if (typeof value2 !== "string" || !path5.isAbsolute(value2) || path5.resolve(value2) !== value2)
      throw new InputError("Invalid ledger state: locator must be a normalized absolute path.");
    return value2;
  };
  return {
    worktree: directory(data.worktree),
    gitDirectory: directory(data.gitDirectory),
    commonGitDir: directory(data.commonGitDir)
  };
}
function parsePlannedLedger(value) {
  const data = object2(value, [
    "ledgerId",
    "contextId",
    "revision",
    "state",
    "ownership",
    "identities",
    "blockers",
    "currentPreparationId",
    "predecessorIds",
    "successorIds",
    "note",
    "work",
    "origin",
    "sealedResult"
  ]);
  if (!["open", "prepared", "sealed", "abandoned"].includes(String(data.state)))
    throw new InputError("Invalid ledger state: lifecycle.");
  const owner = object2(data.ownership, ["kind", "transferId"]);
  let ownership;
  if (owner.kind === "local" && owner.transferId === void 0) ownership = { kind: "local" };
  else if (owner.kind === "exporting" || owner.kind === "exported")
    ownership = { kind: owner.kind, transferId: uuid3(owner.transferId) };
  else throw new InputError("Invalid ledger state: ownership.");
  const identities = array(data.identities, parseIdentity);
  distinct(identities.map(identityKey));
  const blockers = array(data.blockers, parseBlocker);
  distinct(blockers.map((item) => item.id));
  const predecessorIds = array(data.predecessorIds, uuid3);
  const successorIds = array(data.successorIds, uuid3);
  distinct(predecessorIds);
  distinct(successorIds);
  return {
    ledgerId: uuid3(data.ledgerId),
    contextId: uuid3(data.contextId),
    revision: integer(data.revision, 1),
    state: data.state,
    ownership,
    identities,
    blockers,
    currentPreparationId: data.currentPreparationId === null ? null : uuid3(data.currentPreparationId),
    predecessorIds,
    successorIds,
    ...data.note === void 0 ? {} : { note: text(data.note) },
    ...data.work === void 0 ? {} : { work: text(data.work) },
    ...data.origin === void 0 ? {} : { origin: parseOrigin(data.origin) },
    ...data.sealedResult === void 0 ? {} : { sealedResult: parseSealedResult(data.sealedResult) }
  };
}
function parsePreparations(value) {
  const receipts = array(value, parsePreparedReceipt);
  for (const receipt of receipts) {
    uuid3(receipt.preparationId);
    uuid3(receipt.sourceContextId);
    uuid3(receipt.ledgerId);
    distinct(receipt.ledger.identities.map(identityKey));
  }
  distinct(receipts.map((item) => item.preparationId));
  return receipts;
}
function parseOriginEntry(value) {
  const data = object2(value, ["transferId", "sourceContextId", "ledgerId", "revision", "preparations", "source"]);
  const receipts = parsePreparations(data.preparations);
  const ledgerId = uuid3(data.ledgerId);
  const revision = integer(data.revision, 1);
  if (receipts.some((receipt) => receipt.ledgerId !== ledgerId || receipt.revision > revision))
    throw new InputError("Invalid ledger origin preparation history.");
  if (isRecord(data.source) && Object.hasOwn(data.source, "origin"))
    throw new InputError("Origin source history must be flattened.");
  const source = parsePlannedLedger(data.source);
  validateSealedJoin(source, receipts);
  if (source.state === "prepared" !== (source.currentPreparationId !== null))
    throw new InputError("Origin source preparation lifecycle mismatch.");
  if (source.ledgerId !== ledgerId || source.revision !== revision || source.contextId !== data.sourceContextId)
    throw new InputError("Origin source snapshot does not match mapping.");
  if (source.currentPreparationId !== null) {
    const receipt = receipts.find((item) => item.preparationId === source.currentPreparationId);
    if (!receipt || receipt.revision !== revision || digest(receipt.ledger.identities) !== digest(source.identities) || digest(receipt.ledger.blockers) !== digest(source.blockers))
      throw new InputError("Origin current preparation snapshot mismatch.");
  }
  return {
    transferId: uuid3(data.transferId),
    sourceContextId: uuid3(data.sourceContextId),
    ledgerId,
    revision,
    preparations: receipts,
    source
  };
}
function parseOrigin(value) {
  const data = object2(value, [
    "transferId",
    "sourceContextId",
    "ledgerId",
    "revision",
    "preparations",
    "source",
    "history"
  ]);
  const { history, ...entry } = data;
  return { ...parseOriginEntry(entry), history: array(history, parseOriginEntry) };
}
function sha2563(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new InputError("Invalid ledger digest.");
  return value;
}
function parsePortableLocator(value) {
  const data = object2(value, ["worktree", "gitDirectory", "commonGitDir"]);
  const directory = (value2) => {
    checkRaw(value2);
    if (typeof value2 !== "string" || ![path5.posix, path5.win32].some((host) => host.isAbsolute(value2) && host.normalize(value2) === value2))
      throw new InputError("Invalid portable locator.");
    return value2;
  };
  return {
    worktree: directory(data.worktree),
    gitDirectory: directory(data.gitDirectory),
    commonGitDir: directory(data.commonGitDir)
  };
}
function parseCurrent(value, ledgers) {
  if (value === null) return null;
  const data = object2(value, ["ledgerId", "paused"]);
  const ledgerId = uuid3(data.ledgerId);
  const ledger = ledgers.find((item) => item.ledgerId === ledgerId);
  if (typeof data.paused !== "boolean" || !ledger || !["open", "prepared"].includes(ledger.state) || ledger.ownership.kind !== "local" && !data.paused)
    throw new InputError("Invalid ledger state: current reference/lifecycle/ownership.");
  return { ledgerId, paused: data.paused };
}
function parseTransfer(value) {
  const data = object2(value, [
    "transferId",
    "phase",
    "sourceContextId",
    "locator",
    "ledgerIds",
    "preparationIds",
    "current",
    "payloadDigest",
    "bundleDigest",
    "output"
  ]);
  if (data.phase !== "exporting" && data.phase !== "exported") throw new InputError("Invalid transfer phase.");
  const ledgerIds = array(data.ledgerIds, uuid3);
  const preparationIds = array(data.preparationIds, uuid3);
  distinct(ledgerIds);
  distinct(preparationIds);
  if (!ledgerIds.length || typeof data.output !== "string" || !path5.isAbsolute(data.output) || path5.resolve(data.output) !== data.output)
    throw new InputError("Invalid transfer selection/output.");
  let current = null;
  if (data.current !== null) {
    const selected = object2(data.current, ["ledgerId", "paused"]);
    if (typeof selected.paused !== "boolean" || !ledgerIds.includes(uuid3(selected.ledgerId)))
      throw new InputError("Invalid transfer current reference.");
    current = { ledgerId: selected.ledgerId, paused: selected.paused };
  }
  return {
    transferId: uuid3(data.transferId),
    phase: data.phase,
    sourceContextId: uuid3(data.sourceContextId),
    locator: parsePortableLocator(data.locator),
    ledgerIds,
    preparationIds,
    current,
    payloadDigest: sha2563(data.payloadDigest),
    bundleDigest: sha2563(data.bundleDigest),
    output: data.output
  };
}
function parseImport(value) {
  const data = object2(value, ["transferId", "bundleDigest", "sourceContextId", "mode", "mapping", "preparationIds"]);
  if (data.mode !== "resume" && data.mode !== "copy") throw new InputError("Invalid import mode.");
  const mapping = array(data.mapping, (item) => {
    const pair = object2(item, ["sourceId", "targetId"]);
    return { sourceId: uuid3(pair.sourceId), targetId: uuid3(pair.targetId) };
  });
  if (!mapping.length || mapping.some(
    (pair) => data.mode === "resume" ? pair.sourceId !== pair.targetId : pair.sourceId === pair.targetId
  ))
    throw new InputError("Invalid import mapping.");
  distinct(mapping.map((pair) => pair.sourceId));
  distinct(mapping.map((pair) => pair.targetId));
  const preparationIds = array(data.preparationIds, uuid3);
  distinct(preparationIds);
  return {
    transferId: uuid3(data.transferId),
    bundleDigest: sha2563(data.bundleDigest),
    sourceContextId: uuid3(data.sourceContextId),
    mode: data.mode,
    mapping,
    preparationIds
  };
}
function validateLedgerJoins(ledgers, receipts) {
  const byId = new Map(ledgers.map((item) => [item.ledgerId, item]));
  for (const receipt of receipts) {
    const ledger = byId.get(receipt.ledgerId);
    if (ledger && receipt.revision > ledger.revision)
      throw new InputError("Historical preparation revision exceeds ledger.");
  }
  for (const ledger of ledgers) {
    validateSealedJoin(ledger, receipts);
    if (ledger.state === "prepared" !== (ledger.currentPreparationId !== null))
      throw new InputError("Invalid preparation lifecycle reference.");
    if (ledger.currentPreparationId !== null) {
      const receipt = receipts.find((item) => item.preparationId === ledger.currentPreparationId);
      if (!receipt || receipt.ledgerId !== ledger.ledgerId || receipt.revision !== ledger.revision || digest(receipt.ledger.identities) !== digest(ledger.identities) || digest(receipt.ledger.blockers) !== digest(ledger.blockers))
        throw new InputError("Current preparation does not freeze exact ledger revision/set.");
    }
    for (const id2 of ledger.predecessorIds) {
      if (id2 === ledger.ledgerId || !byId.get(id2)?.successorIds.includes(ledger.ledgerId))
        throw new InputError("Invalid ledger state: predecessor reference.");
    }
    for (const id2 of ledger.successorIds) {
      if (id2 === ledger.ledgerId || !byId.get(id2)?.predecessorIds.includes(ledger.ledgerId) || ledger.state !== "abandoned")
        throw new InputError("Invalid ledger state: successor reference.");
    }
  }
}
function validateSealedJoin(ledger, receipts) {
  if (ledger.state === "sealed" !== (ledger.sealedResult !== void 0))
    throw new InputError(
      "Sealed lifecycle requires an explicit sealed result and only sealed records may carry one."
    );
  if (ledger.sealedResult === void 0) return;
  const result = ledger.sealedResult;
  const receipt = receipts.find((item) => item.preparationId === result.preparationId);
  if (ledger.state !== "sealed" || !receipt || receipt.ledgerId !== ledger.ledgerId || result.review.ledgerId !== ledger.ledgerId || receipt.revision + 1 !== ledger.revision || result.sha.length !== (receipt.objectFormat === "sha1" ? 40 : 64) || digest(receipt.ledger.identities) !== digest(ledger.identities) || digest(receipt.ledger.blockers) !== digest(ledger.blockers))
    throw new InputError("Sealed result does not join exact historical preparation/ledger.");
  if (receipt.decision.branch === "repository-policy" !== (result.checks.participation === "repository-rule-declaration"))
    throw new InputError("Sealed participation check does not match historical policy route.");
}
function portableLedger(ledger) {
  return { ...structuredClone(ledger), ownership: { kind: "local" } };
}
function transferPayload(state, receipt) {
  const ledgers = receipt.ledgerIds.map((id2) => {
    const ledger = state.ledgers.find((item) => item.ledgerId === id2);
    if (!ledger) throw new InputError(`Frozen export ledger missing: ${id2}`);
    return portableLedger(ledger);
  });
  const selected = receipt.preparationIds.map((id2) => {
    const preparation = state.preparations.find((item) => item.preparationId === id2);
    if (!preparation) throw new InputError(`Frozen export preparation missing: ${id2}`);
    return preparation;
  });
  return { ledgers, preparations: selected };
}
function parseWorktreeState(value) {
  checkRaw(value);
  const data = object2(value, [
    "schemaVersion",
    "contextId",
    "locator",
    "stateVersion",
    "current",
    "ledgers",
    "preparations",
    "transfers",
    "imports"
  ]);
  if (data.schemaVersion !== 1) throw new InputError("Invalid ledger state: schemaVersion must be 1.");
  const contextId = uuid3(data.contextId);
  const ledgers = array(data.ledgers, parsePlannedLedger);
  distinct(ledgers.map((item) => item.ledgerId));
  const byId = new Map(ledgers.map((item) => [item.ledgerId, item]));
  const prepared = parsePreparations(data.preparations);
  const transfers = array(data.transfers, parseTransfer);
  const imports = array(data.imports, parseImport);
  distinct(transfers.map((item) => item.transferId));
  distinct(imports.map((item) => item.transferId));
  validateLedgerJoins(ledgers, prepared);
  for (const ledger of ledgers) {
    if (ledger.contextId !== contextId) throw new InputError("Invalid ledger state: ledger/context mismatch.");
    if (ledger.sealedResult && ledger.sealedResult.review.contextId !== contextId && !imports.some(
      (receipt) => receipt.mode === "resume" && receipt.mapping.some((pair) => pair.targetId === ledger.ledgerId)
    ))
      throw new InputError("Historical sealed result context requires a resume import receipt.");
    if (ledger.ownership.kind !== "local") {
      const owner = ledger.ownership;
      const transfer = transfers.find((item) => item.transferId === owner.transferId);
      if (!transfer || transfer.phase !== owner.kind || !transfer.ledgerIds.includes(ledger.ledgerId))
        throw new InputError("Invalid ledger transfer ownership reference.");
    }
  }
  for (const receipt of prepared) {
    if (receipt.sourceContextId !== contextId && !imports.some(
      (item) => item.mode === "resume" && item.preparationIds.includes(receipt.preparationId) && item.mapping.some((pair) => pair.targetId === receipt.ledgerId)
    ))
      throw new InputError("Preparation source context requires a validated resume import receipt.");
  }
  for (const receipt of imports) {
    if (receipt.mode === "resume" && receipt.preparationIds.some((id2) => !prepared.some((item) => item.preparationId === id2)))
      throw new InputError("Import preparation reference is missing.");
  }
  for (const transfer of transfers) {
    if (transfer.sourceContextId !== contextId) throw new InputError("Transfer source context mismatch.");
    if (transfer.phase === "exporting") {
      const payload = transferPayload({ ledgers, preparations: prepared }, transfer);
      if (digest(payload) !== transfer.payloadDigest) throw new InputError("Frozen transfer payload changed.");
      if (transfer.ledgerIds.some((id2) => {
        const ledger = byId.get(id2);
        return ledger && ["open", "prepared"].includes(ledger.state) && (ledger.ownership.kind !== "exporting" || ledger.ownership.transferId !== transfer.transferId);
      }))
        throw new InputError("Exporting transfer must freeze unfinished ownership.");
    }
  }
  return {
    schemaVersion: 1,
    contextId,
    locator: parseLocator(data.locator),
    stateVersion: integer(data.stateVersion),
    current: parseCurrent(data.current, ledgers),
    ledgers,
    preparations: prepared,
    transfers,
    imports
  };
}
function encodeState(state) {
  const bytes2 = Buffer.from(`${JSON.stringify(parseWorktreeState(state), null, 4)}
`);
  if (bytes2.length > STATE_BYTES) throw new InputError("Ledger state byte budget exceeded.");
  return bytes2;
}
function ledgerContent(ledger) {
  return {
    identities: ledger.identities,
    blockers: ledger.blockers,
    state: ledger.state,
    currentPreparationId: ledger.currentPreparationId,
    predecessorIds: ledger.predecessorIds,
    successorIds: ledger.successorIds,
    sealedResult: ledger.sealedResult ?? null
  };
}
function validateStateTransition(before, after, mode = "ordinary") {
  for (const collection of ["preparations", "imports"]) {
    for (const old of before[collection]) {
      const id2 = collection === "preparations" ? old.preparationId : old.transferId;
      const next = after[collection].find(
        (item) => collection === "preparations" ? item.preparationId === id2 : item.transferId === id2
      );
      if (!next || digest(old) !== digest(next))
        throw new InputError("Historical preparation/import receipts are immutable.");
    }
  }
  if (mode !== "import" && after.imports.length !== before.imports.length)
    throw new InputError("Import receipts require explicit import mode.");
  for (const old of before.transfers) {
    const next = after.transfers.find((item) => item.transferId === old.transferId);
    if (!next || digest({ ...old, phase: next.phase }) !== digest(next) || old.phase === "exported" && next.phase !== "exported")
      throw new InputError("Transfer receipt is immutable except final publication phase.");
    if (old.phase === "exporting" && digest(transferPayload(before, old)) !== digest(transferPayload(after, old)))
      throw new InputError("Export payload is frozen until publication.");
    if (old.phase === "exporting" && digest(before.preparations.filter((item) => old.ledgerIds.includes(item.ledgerId))) !== digest(after.preparations.filter((item) => old.ledgerIds.includes(item.ledgerId))))
      throw new InputError("Export preparation history is frozen until publication.");
  }
  for (const old of before.ledgers) {
    const next = after.ledgers.find((item) => item.ledgerId === old.ledgerId);
    if (!next) {
      if (mode === "prune" && ["sealed", "abandoned"].includes(old.state)) continue;
      throw new InputError("Ledger records cannot be silently deleted.");
    }
    if (mode === "prune" && digest(old) !== digest(next))
      throw new InputError("Prune cannot edit retained ledger records.");
    if (old.state === "sealed" && digest(old) !== digest(next))
      throw new InputError("Sealed ledger content is immutable.");
    const changed = digest(ledgerContent(old)) !== digest(ledgerContent(next));
    if (next.revision !== (changed ? integer(old.revision + 1, 1) : old.revision))
      throw new InputError("Ledger content revision does not match the declared mutation.");
    if (old.contextId !== next.contextId || digest(old.origin ?? null) !== digest(next.origin ?? null))
      throw new InputError("Ledger owner/origin is immutable.");
    if (old.ownership.kind !== "local") {
      if (digest(portableLedger(old)) !== digest(portableLedger(next)))
        throw new InputError("Nonlocal ledger payload is frozen.");
      if (digest(before.preparations.filter((item) => item.ledgerId === old.ledgerId)) !== digest(after.preparations.filter((item) => item.ledgerId === old.ledgerId)))
        throw new InputError("Nonlocal preparation history is frozen.");
      if (next.ownership.kind === "local" || next.ownership.transferId !== old.ownership.transferId || old.ownership.kind === "exported" && next.ownership.kind !== "exported")
        throw new InputError("Export ownership cannot thaw.");
    }
  }
  for (const next of after.ledgers) {
    if (!before.ledgers.some((item) => item.ledgerId === next.ledgerId) && (before.imports.some((receipt) => receipt.mapping.some((pair) => pair.targetId === next.ledgerId)) || before.transfers.some((receipt) => receipt.ledgerIds.includes(next.ledgerId)) || before.preparations.some((receipt) => receipt.ledgerId === next.ledgerId)))
      throw new InputError("Ledger ID has historical receipts and cannot be reused.");
    if (!before.ledgers.some((item) => item.ledgerId === next.ledgerId) && next.revision !== 1 && !(mode === "import" && after.imports.some(
      (receipt) => receipt.mode === "resume" && receipt.mapping.some((pair) => pair.targetId === next.ledgerId)
    )))
      throw new InputError("New ledger revision must be 1 or covered by explicit resume import.");
  }
}
var STATE_BYTES, sortBlockers;
var init_ledger_contract = __esm({
  "src/ledger-contract.ts"() {
    "use strict";
    init_errors();
    init_records();
    init_result_contract();
    init_result_review();
    init_runtime_support();
    STATE_BYTES = 16 * 1024 * 1024;
    sortBlockers = (values) => [...values].sort((a, b) => ordinal(a.id, b.id));
  }
});

// src/state-path.ts
function isLedgerStatePath(raw, platform = process.platform) {
  const first = raw.subarray(0, raw.indexOf(47) < 0 ? raw.length : raw.indexOf(47)).toString("latin1");
  if (platform === "darwin") return first.toLowerCase() === ".ai-commit-attribution";
  if (platform !== "win32") return first === ".ai-commit-attribution";
  const normalized = first.split(":")[0]?.replace(/[ .]+$/, "").toLowerCase() ?? "";
  return normalized === ".ai-commit-attribution" || /^\.?ai-com~[0-9]+$/.test(normalized);
}
var init_state_path = __esm({
  "src/state-path.ts"() {
    "use strict";
  }
});

// src/ledger-store.ts
var ledger_store_exports = {};
__export(ledger_store_exports, {
  importState: () => importState,
  initializeState: () => initializeState,
  pruneState: () => pruneState,
  readState: () => readState,
  rebindState: () => rebindState,
  resolveLedgerContext: () => resolveLedgerContext,
  transactState: () => transactState
});
import { randomUUID } from "node:crypto";
import { constants as constants2 } from "node:fs";
import { lstat as lstat4, mkdir, open as open2, readdir, rename, unlink } from "node:fs/promises";
import path6 from "node:path";
import { setTimeout as delay } from "node:timers/promises";
async function completeWrite(handle, bytes2, io) {
  let offset = 0;
  while (offset < bytes2.length) {
    const count = io.write ? await io.write(handle, bytes2, offset) : (await handle.write(bytes2, offset, bytes2.length - offset, offset)).bytesWritten;
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes2.length - offset)
      throw new InputError("State write made no valid progress; candidate preserved.");
    offset += count;
  }
}
async function regular(file, maximumBytes) {
  await inspectPath(file);
  const info = await lstat4(file, { bigint: true });
  const bytes2 = await readRegularFile(file, { physicalPath: true, singleLink: true, maximumBytes });
  if (!unchanged2(info, await lstat4(file, { bigint: true })))
    throw new InputError("State file identity changed during reading.");
  return { bytes: bytes2, info };
}
async function optionalRegular(file, maximumBytes) {
  if (!await inspectPath(file)) return void 0;
  return regular(file, maximumBytes);
}
async function withLock(file, operation) {
  const parent = path6.dirname(file);
  await physicalDirectory(parent);
  let handle;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      handle = await open2(file, constants2.O_RDWR | constants2.O_CREAT | constants2.O_EXCL | noFollow, 384);
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (attempt === 49)
        throw new InputError(
          "Ledger lock is occupied; its owner or residual artifact must be reviewed. No lock was stolen."
        );
      await delay(20);
    }
  }
  if (!handle) throw new InputError("Could not acquire ledger lock.");
  const token = Buffer.from(`${randomUUID()}
`);
  let owned;
  let failure;
  let result;
  const guard = async () => {
    if (!owned) throw new InputError("Lock ownership is uncertain; artifact preserved.");
    const current = await regular(file, token.length);
    if (!unchanged2(owned, current.info) || !current.bytes.equals(token) || !unchanged2(owned, await handle.stat({ bigint: true })))
      throw new InputError("Lock was replaced or changed; replacement preserved.");
    await physicalDirectory(parent);
  };
  try {
    await completeWrite(handle, token, {});
    await handle.sync();
    owned = await handle.stat({ bigint: true });
    await guard();
    result = await operation(guard);
    await guard();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (owned) {
    try {
      const current = await regular(file, token.length);
      if (!unchanged2(owned, current.info) || !current.bytes.equals(token))
        throw new InputError("Lock changed; replacement preserved.");
      await unlink(file);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== void 0) throw failure;
  return result;
}
async function resolveLedgerContext(directory) {
  checkRaw(directory);
  const actual = await physicalDirectory(path6.resolve(directory));
  const git = new SafeGit(await resolveTrustedGit([actual]), actual);
  await git.guard();
  const worktree = await physicalDirectory(path6.resolve(await git.text("rev-parse", ["--show-toplevel"])));
  const gitDirectory = await physicalDirectory(path6.resolve(await git.text("rev-parse", ["--absolute-git-dir"])));
  const commonGitDir = await physicalDirectory(
    path6.resolve(actual, await git.text("rev-parse", ["--git-common-dir"]))
  );
  const excludeFile = path6.resolve(
    await git.text("rev-parse", ["--path-format=absolute", "--git-path", "info/exclude"])
  );
  await physicalDirectory(path6.dirname(excludeFile));
  await inspectPath(excludeFile);
  const stateDirectory = path6.join(worktree, ".ai-commit-attribution");
  return {
    locator: { worktree, gitDirectory, commonGitDir },
    excludeFile,
    stateDirectory,
    stateFile: path6.join(stateDirectory, "state.json")
  };
}
function sameLocator(left, right) {
  return ["worktree", "gitDirectory", "commonGitDir"].every(
    (key) => samePhysicalPath(left[key], right[key])
  );
}
async function actualContext(context) {
  const actual = await resolveLedgerContext(context.locator.worktree);
  if (!sameLocator(context.locator, actual.locator) || !samePhysicalPath(context.excludeFile, actual.excludeFile) || !samePhysicalPath(context.stateDirectory, actual.stateDirectory) || !samePhysicalPath(context.stateFile, actual.stateFile))
    throw new InputError("Ledger context locator no longer matches actual Git worktree.");
  return actual;
}
async function checkTracked(context) {
  const git = new SafeGit(
    await resolveTrustedGit([context.locator.worktree, context.locator.commonGitDir]),
    context.locator.worktree
  );
  const entries = await git.run("ls-files", ["--cached", "--full-name", "-z"]);
  let start = 0;
  for (let index = 0; index < entries.length; index++) {
    if (entries[index] !== 0) continue;
    if (isLedgerStatePath(entries.subarray(start, index)))
      throw new InputError("Ledger state path conflicts with tracked/staged content.");
    start = index + 1;
  }
  if (start !== entries.length)
    throw new InputError("Tracked Git paths are incomplete; state cannot be safely observed.");
  return git;
}
async function checkIgnore(git) {
  const ignored = (await git.run(
    "check-ignore",
    ["--no-index", "--", ".ai-commit-attribution/", ".ai-commit-attribution/state.json"],
    true
  )).toString("utf8").split(/\r?\n/);
  if (!ignored.includes(".ai-commit-attribution/") || !ignored.includes(".ai-commit-attribution/state.json"))
    throw new InputError("Ledger directory and state must be effectively ignored by Git.");
}
async function checkDirectory(context) {
  if (!(await inspectPath(context.stateDirectory))?.isDirectory())
    throw new InputError("Ledger state directory is missing or unsafe.");
  await physicalDirectory(context.stateDirectory);
  const entries = await readdir(context.stateDirectory);
  if (entries.some(
    (entry) => entry !== "state.json" && entry !== "state.lock" && !/^state\.candidate-[a-f0-9-]{36}$/.test(entry)
  ))
    throw new InputError("Ledger state directory contains unknown occupancy; preserve and review it.");
}
async function stateEvidence(context, rebind = false) {
  await checkDirectory(context);
  const observed = await regular(context.stateFile, STATE_BYTES);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observed.bytes));
  } catch {
    throw new InputError("Ledger state is malformed UTF-8 JSON.");
  }
  const state = parseWorktreeState(value);
  if (!rebind && !sameLocator(state.locator, context.locator))
    throw new InputError(
      "Stored locator/context does not match this physical worktree; explicit rebind is required."
    );
  return { ...observed, state };
}
async function publish(file, bytes2, previous, guard, io = {}) {
  const parent = path6.dirname(file);
  const parentInfo = await lstat4(await physicalDirectory(parent), { bigint: true });
  const candidate = path6.join(
    parent,
    `${path6.basename(file) === "state.json" ? "state" : path6.basename(file)}.candidate-${randomUUID()}`
  );
  const handle = await open2(candidate, constants2.O_RDWR | constants2.O_CREAT | constants2.O_EXCL | noFollow, 384);
  let primary;
  try {
    const owned = await handle.stat({ bigint: true });
    await completeWrite(handle, bytes2, io);
    await handle.sync();
    const completed = await regular(candidate, bytes2.length);
    if (!same(owned, completed.info) || !completed.bytes.equals(bytes2) || !unchanged2(completed.info, await handle.stat({ bigint: true })))
      throw new InputError("Candidate bytes/identity changed during publication.");
    await guard();
    const current = await optionalRegular(file, Math.max(STATE_BYTES, bytes2.length));
    if (previous ? !current || !unchanged2(previous.info, current.info) || !previous.bytes.equals(current.bytes) : current !== void 0)
      throw new InputError("Original file changed before atomic publication.");
    if (!same(parentInfo, await lstat4(parent, { bigint: true })))
      throw new InputError("Publication parent was replaced.");
    await physicalDirectory(parent);
    await handle.close();
    await (io.rename ?? rename)(candidate, file);
    const final = await regular(file, bytes2.length);
    if (!same(completed.info, final.info) || !final.bytes.equals(bytes2))
      throw new InputError("Publication final readback failed; reread authority before retrying.");
  } catch (error) {
    primary = error;
  }
  try {
    await handle.close();
  } catch (error) {
    primary ??= error;
  }
  if (primary !== void 0) throw primary;
}
async function appendExclusion(context, guard) {
  const previous = await optionalRegular(context.excludeFile, STATE_BYTES);
  const bytes2 = previous?.bytes ?? Buffer.alloc(0);
  const fixed = "/.ai-commit-attribution/";
  if (bytes2.toString("utf8").split(/\r?\n/).includes(fixed)) return;
  const newline = bytes2.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
  const suffix = `${bytes2.length && bytes2.at(-1) !== 10 ? newline : ""}${fixed}${newline}`;
  await publish(context.excludeFile, Buffer.concat([bytes2, Buffer.from(suffix)]), previous, guard);
}
async function initializeState(contextValue) {
  const context = await actualContext(contextValue);
  const git = await checkTracked(context);
  return withLock(`${context.excludeFile}.ai-commit-attribution.lock`, async (excludeGuard) => {
    await checkTracked(context);
    const existing = await inspectPath(context.stateDirectory);
    if (existing) {
      await checkDirectory(context);
      const state = (await stateEvidence(context)).state;
      await appendExclusion(context, excludeGuard);
      await checkIgnore(git);
      return state;
    }
    await appendExclusion(context, excludeGuard);
    await checkIgnore(git);
    await excludeGuard();
    await mkdir(context.stateDirectory, { mode: 448 });
    return withLock(path6.join(context.stateDirectory, "state.lock"), async (stateGuard) => {
      await checkTracked(context);
      await checkIgnore(git);
      const state = {
        schemaVersion: 1,
        contextId: randomUUID(),
        locator: context.locator,
        stateVersion: 0,
        current: null,
        ledgers: [],
        preparations: [],
        transfers: [],
        imports: []
      };
      await publish(context.stateFile, encodeState(state), void 0, async () => {
        await excludeGuard();
        await stateGuard();
      });
      return (await stateEvidence(context)).state;
    });
  });
}
async function readState(contextValue) {
  const context = await actualContext(contextValue);
  const git = await checkTracked(context);
  await checkIgnore(git);
  return (await stateEvidence(context)).state;
}
async function transactState(contextValue, expectedStateVersion, transform, io = {}) {
  return transaction(contextValue, expectedStateVersion, transform, io, "ordinary");
}
async function transaction(contextValue, expectedStateVersion, transform, io, mode) {
  integer(expectedStateVersion);
  const context = await actualContext(contextValue);
  const git = await checkTracked(context);
  await checkIgnore(git);
  const before = await stateEvidence(context, mode === "rebind");
  if (before.state.stateVersion !== expectedStateVersion) throw new InputError("Ledger state version is stale.");
  return withLock(path6.join(context.stateDirectory, "state.lock"), async (guard) => {
    const locked = await stateEvidence(context, mode === "rebind");
    if (locked.state.stateVersion !== expectedStateVersion || !unchanged2(before.info, locked.info) || !before.bytes.equals(locked.bytes))
      throw new InputError("Ledger state changed while obtaining lock.");
    const draft = structuredClone(locked.state);
    const returned = transform(draft);
    if (returned !== void 0) throw new InputError("State transform must be synchronous and return no value.");
    if (draft.stateVersion !== expectedStateVersion || draft.contextId !== locked.state.contextId || (mode === "rebind" ? !sameLocator(draft.locator, context.locator) : !sameLocator(draft.locator, locked.state.locator)))
      throw new InputError("Transform may not change state version or context locator.");
    draft.stateVersion = integer(expectedStateVersion + 1);
    validateStateTransition(locked.state, draft, mode);
    const bytes2 = encodeState(draft);
    await publish(context.stateFile, bytes2, locked, guard, io);
    return (await stateEvidence(context)).state;
  });
}
async function rebindState(context, expectedStateVersion, declaration) {
  if (declaration.movedOriginal !== true)
    throw new InputError("Rebind requires an explicit moved-original declaration.");
  return transaction(
    context,
    expectedStateVersion,
    (draft) => {
      if (draft.contextId !== declaration.contextId) throw new InputError("Rebind stored context ID mismatch.");
      draft.locator = structuredClone(context.locator);
    },
    {},
    "rebind"
  );
}
async function pruneState(context, expectedStateVersion, ledgerIds) {
  return transaction(
    context,
    expectedStateVersion,
    (draft) => {
      if (!ledgerIds.length || new Set(ledgerIds).size !== ledgerIds.length)
        throw new InputError("Prune requires a nonempty distinct selection.");
      for (const id2 of ledgerIds) {
        const ledger = draft.ledgers.find((item) => item.ledgerId === id2);
        if (!ledger || !["sealed", "abandoned"].includes(ledger.state))
          throw new InputError("Prune requires selected terminal ledgers.");
        const missing = [...ledger.predecessorIds, ...ledger.successorIds].filter(
          (linked) => !ledgerIds.includes(linked)
        );
        if (missing.length)
          throw new InputError(`Prune requires complete terminal link closure: ${missing.join(", ")}`);
        if (draft.transfers.some((receipt) => receipt.phase === "exporting" && receipt.ledgerIds.includes(id2)))
          throw new InputError("Pending export must finish before terminal prune.");
      }
      draft.ledgers = draft.ledgers.filter((item) => !ledgerIds.includes(item.ledgerId));
    },
    {},
    "prune"
  );
}
async function importState(context, expectedStateVersion, receipt, ledgers, preparations, current) {
  return transaction(
    context,
    expectedStateVersion,
    (draft) => {
      if (draft.imports.some((item) => item.transferId === receipt.transferId))
        throw new InputError("Transfer import already exists; reread before retry.");
      if (ledgers.some((ledger) => draft.ledgers.some((item) => item.ledgerId === ledger.ledgerId)))
        throw new InputError("Imported ledger ID collision.");
      for (const preparation of preparations) {
        const existing = draft.preparations.find((item) => item.preparationId === preparation.preparationId);
        if (existing && digest(existing) !== digest(preparation))
          throw new InputError("Imported preparation ID collision.");
        if (!existing) draft.preparations.push(structuredClone(preparation));
      }
      draft.ledgers.push(...structuredClone(ledgers));
      draft.imports.push(structuredClone(receipt));
      if (!draft.current && current) draft.current = { ledgerId: current.ledgerId, paused: true };
    },
    {},
    "import"
  );
}
var same, unchanged2, noFollow;
var init_ledger_store = __esm({
  "src/ledger-store.ts"() {
    "use strict";
    init_errors();
    init_file_evidence();
    init_ledger_contract();
    init_records();
    init_runtime_support();
    init_safe_git();
    init_state_path();
    same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
    unchanged2 = (a, b) => same(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
    noFollow = constants2.O_NOFOLLOW ?? 0;
  }
});

// src/ledger.ts
var ledger_exports = {};
__export(ledger_exports, {
  abandonLedger: () => abandonLedger,
  addIdentities: () => addIdentities,
  blockLedger: () => blockLedger,
  createLedger: () => createLedger,
  pauseLedger: () => pauseLedger,
  removeIdentities: () => removeIdentities,
  reopenLedger: () => reopenLedger,
  replaceLedgers: () => replaceLedgers,
  resumeLedger: () => resumeLedger,
  reviseLedger: () => reviseLedger,
  selectLedger: () => selectLedger,
  selectedLedgerSnapshot: () => selectedLedgerSnapshot,
  unblockLedger: () => unblockLedger
});
import { randomUUID as randomUUID2 } from "node:crypto";
function find(state, id2) {
  const ledger = state.ledgers.find((item) => item.ledgerId === uuid3(id2));
  if (!ledger) throw new InputError("Ledger ID does not exist in this context.");
  return ledger;
}
function local(ledger) {
  if (ledger.ownership.kind !== "local") throw new InputError("Ledger ownership must be local.");
}
function active(state, id2) {
  if (!state.current || state.current.ledgerId !== id2 || state.current.paused)
    throw new InputError("Mutation requires the exact active current ledger selection.");
}
function open3(state, id2) {
  const ledger = find(state, id2);
  local(ledger);
  active(state, id2);
  if (ledger.state !== "open") throw new InputError("Recording requires an open ledger.");
  return ledger;
}
function reviseLedger(ledger) {
  ledger.revision = integer(ledger.revision + 1, 1);
}
function createLedger(state, options = {}) {
  checkRaw(options);
  const ledgerId = uuid3(options.ledgerId ?? randomUUID2());
  if (state.ledgers.some((item) => item.ledgerId === ledgerId)) throw new InputError("Ledger ID already exists.");
  const ledger = {
    ledgerId,
    contextId: state.contextId,
    revision: 1,
    state: "open",
    ownership: { kind: "local" },
    identities: [],
    blockers: [],
    currentPreparationId: null,
    predecessorIds: [],
    successorIds: [],
    ...options.note === void 0 ? {} : { note: text(options.note) },
    ...options.work === void 0 ? {} : { work: text(options.work) }
  };
  state.ledgers.push(ledger);
  if (options.select) selectLedger(state, ledgerId);
  return ledgerId;
}
function selectLedger(state, id2) {
  const ledger = find(state, id2);
  local(ledger);
  if (!["open", "prepared"].includes(ledger.state))
    throw new InputError("Selection requires open or prepared ledger.");
  state.current = { ledgerId: ledger.ledgerId, paused: false };
}
function addIdentities(state, id2, identities, registry) {
  const ledger = open3(state, id2);
  const next = normalizeIdentities([...ledger.identities, ...identities], registry);
  if (JSON.stringify(next) !== JSON.stringify(ledger.identities)) {
    reviseLedger(ledger);
    ledger.identities = next;
  }
}
function removeIdentities(state, id2, identities, registry) {
  const ledger = open3(state, id2);
  const keys = new Set(normalizeIdentities(identities, registry).map(identityKey));
  const next = ledger.identities.filter((item) => !keys.has(identityKey(item)));
  if (next.length !== ledger.identities.length) {
    reviseLedger(ledger);
    ledger.identities = next;
  }
}
function blockLedger(state, id2, value) {
  const ledger = open3(state, id2);
  const blocker = parseBlocker(value);
  if (ledger.blockers.some((item) => item.id === blocker.id))
    throw new InputError("Blocker ID already exists; explicitly unblock first.");
  reviseLedger(ledger);
  ledger.blockers = sortBlockers([...ledger.blockers, blocker]);
}
function unblockLedger(state, id2, blockerId) {
  checkRaw(blockerId);
  const ledger = open3(state, id2);
  if (!ledger.blockers.some((item) => item.id === blockerId)) throw new InputError("Blocker ID does not exist.");
  reviseLedger(ledger);
  ledger.blockers = ledger.blockers.filter((item) => item.id !== blockerId);
}
function pauseLedger(state, id2) {
  const ledger = find(state, id2);
  local(ledger);
  active(state, id2);
  state.current = { ledgerId: id2, paused: true };
}
function resumeLedger(state, id2) {
  if (!state.current || state.current.ledgerId !== id2 || !state.current.paused)
    throw new InputError("Resume requires the exact paused current selection.");
  const ledger = find(state, id2);
  local(ledger);
  if (!["open", "prepared"].includes(ledger.state)) throw new InputError("Resume requires an unfinished ledger.");
  state.current = { ledgerId: id2, paused: false };
}
function reopenLedger(state, id2, declaration) {
  const ledger = find(state, id2);
  local(ledger);
  if (!["prepared", "abandoned"].includes(ledger.state))
    throw new InputError("Only prepared or abandoned ledgers can reopen; sealed ledgers are immutable.");
  if (ledger.successorIds.length) throw new InputError("A replaced ledger cannot reopen while it has successors.");
  if ((ledger.state === "prepared" || state.preparations.some((receipt) => receipt.ledgerId === id2)) && declaration.reviewedNoResult !== true)
    throw new InputError("Prepared reopen requires an explicit reviewed-no-result declaration.");
  reviseLedger(ledger);
  ledger.state = "open";
  ledger.currentPreparationId = null;
}
function abandonLedger(state, id2) {
  const ledger = find(state, id2);
  local(ledger);
  if (ledger.state === "sealed") throw new InputError("Sealed ledgers are immutable.");
  if (ledger.state !== "abandoned") {
    reviseLedger(ledger);
    ledger.state = "abandoned";
    ledger.currentPreparationId = null;
  }
  if (state.current?.ledgerId === id2) state.current = null;
}
function replaceLedgers(state, sourceIds, outputs, registry) {
  if (!sourceIds.length || !outputs.length || sourceIds.length !== 1 && outputs.length !== 1)
    throw new InputError("Split/combine requires one source or one output.");
  if (new Set(sourceIds).size !== sourceIds.length || new Set(outputs.map((item) => item.ledgerId)).size !== outputs.length)
    throw new InputError("Duplicate split/combine IDs.");
  const sources = sourceIds.map((id2) => {
    const ledger = find(state, id2);
    local(ledger);
    if (ledger.state !== "open") throw new InputError("Split/combine requires local open sources.");
    integer(ledger.revision + 1, 1);
    return ledger;
  });
  const planned = outputs.map((output2) => {
    checkRaw(output2);
    uuid3(output2.ledgerId);
    if (state.ledgers.some((item) => item.ledgerId === output2.ledgerId))
      throw new InputError("Replacement ID already exists.");
    const blockers = output2.blockers.map(parseBlocker);
    if (new Set(blockers.map((item) => item.id)).size !== blockers.length)
      throw new InputError("Duplicate blocker ID.");
    return {
      ...output2,
      identities: normalizeIdentities(output2.identities, registry),
      blockers: sortBlockers(blockers),
      ...output2.note === void 0 ? {} : { note: text(output2.note) },
      ...output2.work === void 0 ? {} : { work: text(output2.work) }
    };
  });
  for (const source of sources) {
    abandonLedger(state, source.ledgerId);
    source.successorIds = planned.map((item) => item.ledgerId);
  }
  for (const output2 of planned) {
    createLedger(state, { ...output2, select: false });
    const ledger = find(state, output2.ledgerId);
    ledger.identities = output2.identities;
    ledger.blockers = output2.blockers;
    ledger.predecessorIds = [...sourceIds];
  }
}
function selectedLedgerSnapshot(state, operationValue, expectedLedgerId, useCurrent = false) {
  const operation = parseOperationShape(operationValue);
  if (!samePhysicalPath(state.locator.worktree, operation.worktree) || !samePhysicalPath(state.locator.worktree, operation.repository) || !samePhysicalPath(state.locator.commonGitDir, operation.commonGitDir))
    throw new InputError("Operation scope does not match ledger context.");
  if (useCurrent && (!state.current || state.current.paused))
    throw new InputError("Snapshot requires an active current selection; current is missing or paused.");
  const id2 = expectedLedgerId === void 0 ? useCurrent ? state.current?.ledgerId : void 0 : uuid3(expectedLedgerId);
  if (!id2) throw new InputError("Snapshot requires an explicit ledger ID or active current selection.");
  if (state.current && state.current.ledgerId !== id2)
    throw new InputError("Expected ledger does not match current selection; explicitly select before proceeding.");
  const ledger = find(state, id2);
  local(ledger);
  if (!["open", "prepared"].includes(ledger.state))
    throw new InputError("Snapshot requires an open or prepared ledger.");
  return {
    schemaVersion: 2,
    ledgerId: id2,
    operation,
    identities: structuredClone(ledger.identities),
    blockers: structuredClone(ledger.blockers)
  };
}
var init_ledger = __esm({
  "src/ledger.ts"() {
    "use strict";
    init_file_evidence();
    init_ledger_contract();
    init_records();
  }
});

// src/message-assessment.ts
function rows(value) {
  if (!Array.isArray(value)) throw new InputError("Assessment requires an array.");
  return value;
}
async function parseAssessment(value, route, messageSha256, records2, summary) {
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
      if (!records2.some((record2) => record2.id === messageRecordId))
        throw new InputError("Unknown message record assessment.");
    } else if (source.kind === "automatic-signing" && source.messageRecordId === void 0)
      location = { kind: "automatic-signing", reference: exact(source.reference) };
    else
      throw new InputError(
        "Invalid signature source; schemaVersion 3 requires message-record or automatic-signing."
      );
    const keys = strings(row.identityKeys);
    if (keys.some((id2) => !identityKeys.has(id2))) throw new InputError("Unknown signature identity association.");
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
    for (const id2 of signatureIds) {
      const signature = signatures.find((signature2) => signature2.id === id2);
      if (signature?.classification !== "ai-signature" || signature.source.kind !== "message-record" || migrated.has(id2) || !signature.identityKeys.length || signature.identityKeys.some((key) => !keys.includes(key)))
        throw new InputError("Invalid, duplicate or unsupported migration signature mapping.");
      migrated.add(id2);
    }
    const joined = unique(
      signatures.filter((signature) => signatureIds.includes(signature.id)).flatMap((signature) => signature.identityKeys)
    );
    if (JSON.stringify(joined) !== JSON.stringify(keys) || keys.some((id2) => !identityKeys.has(id2)))
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
import { constants as constants3 } from "node:fs";
import { lstat as lstat5, open as open4, unlink as unlink2 } from "node:fs/promises";
import path7 from "node:path";
function checkOrdinaryOutputPath(destination) {
  if (process.platform !== "win32") return;
  const ordinary = destination.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\(?=[a-z]:\\)/i, "");
  if (/^\\\\[?.]\\/.test(ordinary)) throw new InputError("Output uses an unsupported Windows device namespace.");
  if (ordinary.replace(/^[a-z]:/i, "").includes(":"))
    throw new InputError("Output must be an ordinary file, not a Windows stream.");
}
async function writeNewMessage(file, bytes2, scope, consumed, signal) {
  const cancelled = () => {
    if (signal?.aborted) throw new Error("Output publication cancelled.");
  };
  cancelled();
  checkRaw(file);
  if (!file) throw new InputError("Explicit output path is empty.");
  const destination = path7.resolve(file);
  checkOrdinaryOutputPath(destination);
  if (consumed.some((input) => samePhysicalPath(path7.resolve(input), destination)) || inside(scope.gitDirectory, destination) || inside(scope.commonGitDir, destination) || destination.split(path7.sep).some((part) => part.toLowerCase() === ".git"))
    throw new InputError("Output aliases a consumed input or protected Git metadata.");
  let parent;
  try {
    if (await inspectPath(destination)) throw new Error("exists");
    parent = await physical(path7.dirname(destination));
    if (!(await lstat5(parent)).isDirectory()) throw new Error("parent");
  } catch {
    throw new InputError("Output requires an absent leaf and an existing safe physical parent directory.");
  }
  const before = await lstat5(parent, { bigint: true });
  const same2 = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
  const unchanged4 = (a, b) => same2(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
  cancelled();
  const handle = await open4(
    destination,
    constants3.O_WRONLY | constants3.O_CREAT | constants3.O_EXCL | (constants3.O_NOFOLLOW ?? 0),
    384
  );
  let owned;
  let cleanupState;
  let complete = false;
  try {
    owned = await handle.stat({ bigint: true });
    if (!owned.isFile() || owned.nlink !== 1n || !same2(owned, await lstat5(destination, { bigint: true })) || !same2(before, await lstat5(parent, { bigint: true })) || !await physical(parent))
      throw new Error("Output identity changed during exclusive creation.");
    await handle.writeFile(bytes2);
    await handle.sync();
    cancelled();
    const after = await handle.stat({ bigint: true });
    if (!same2(owned, after) || after.nlink !== 1n || after.size !== BigInt(bytes2.length) || !unchanged4(after, await lstat5(destination, { bigint: true })) || !same2(before, await lstat5(parent, { bigint: true })))
      throw new Error("Output identity or length changed during writing.");
    await physical(destination);
    if (!(await readRegularFile(destination, { physicalPath: true, singleLink: true, maximumBytes: bytes2.length })).equals(bytes2) || !unchanged4(after, await handle.stat({ bigint: true })) || !unchanged4(after, await lstat5(destination, { bigint: true })))
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
        const current = await lstat5(destination, { bigint: true });
        if (current.isFile() && current.nlink === 1n && unchanged4(cleanupState, current) && same2(before, await lstat5(parent, { bigint: true }))) {
          const actual = await readRegularFile(destination, {
            physicalPath: true,
            singleLink: true,
            maximumBytes: bytes2.length
          });
          const final = await lstat5(destination, { bigint: true });
          if (actual.equals(bytes2) && unchanged4(cleanupState, final)) await unlink2(destination);
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
import { mkdir as mkdir2, mkdtemp, realpath as realpath5, rm } from "node:fs/promises";
import os from "node:os";
import path8 from "node:path";
async function runTrailers(message, options) {
  if (message.length > INPUT_BYTES) throw new InputError("Message byte budget exceeded.");
  options.additions?.forEach(checkRaw);
  const executable = await resolveTrustedGit(options.excluded, options.environment);
  const parent = await physicalDirectory(await realpath5(os.tmpdir()));
  if (options.excluded.some((root) => inside(root, parent)))
    throw new Error("Trailer temporary directory is inside an excluded scope.");
  const directory = await mkdtemp(path8.join(parent, "attribution-trailer-"));
  try {
    await physical(directory);
    const home = path8.join(directory, "home");
    await mkdir2(home);
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
      for (const line2 of options.additions) {
        if (!line2.startsWith("Assisted-by: ")) throw new InputError("Unsupported generated trailer key.");
        args.push("--trailer", line2);
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
  if (path8.dirname(directory) !== parent || !path8.basename(directory).startsWith("attribution-trailer-"))
    throw new Error("Unsafe trailer temporary cleanup.");
  await rm(directory, { recursive: true, force: true });
}
function decodeMessage(bytes2) {
  let message;
  try {
    message = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes2);
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
  const start = lines.findLastIndex((line2) => line2.trim() === "");
  if (start < 0) return;
  const suffix = lines.slice(start + 1);
  if (!suffix.every((line2) => /^[A-Za-z0-9][A-Za-z0-9 -]*?[ \t]*:/.test(line2) || /^[ \t]/.test(line2))) return;
  for (let index = 0; index < suffix.length; index++) {
    const line2 = suffix[index] ?? "";
    if (!/^assisted\s*-\s*by\s*:/i.test(line2)) continue;
    checkRaw(line2);
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
  const records2 = [];
  for (const line2 of suffix) {
    const match = /^([A-Za-z0-9][A-Za-z0-9 -]*?)[ \t]*:[ \t]*(.*)$/.exec(line2.text);
    if (match?.[1] && match[2] !== void 0) {
      records2.push({
        id: "",
        key: match[1],
        value: match[2],
        raw: line2.raw,
        start: line2.start,
        end: line2.end,
        folded: false
      });
    } else if (/^[ \t]/.test(line2.text) && records2.length) {
      const previous = records2.at(-1);
      if (previous) {
        previous.raw += line2.raw;
        previous.end = line2.end;
        previous.folded = true;
      }
    } else if (parsed.trim()) throw new InputError("Ambiguous terminal trailer spans cannot be preserved safely.");
  }
  const hasAssisted = suffix.some((line2) => /^assisted\s*-\s*by\s*:/i.test(line2.text));
  if (!parsed.trim()) {
    if (hasAssisted && first > 0 && suffix.every((line2) => /^[A-Za-z0-9][A-Za-z0-9 -]*?[ \t]*:/.test(line2.text) || /^[ \t]/.test(line2.text)))
      throw new InputError("Malformed terminal Assisted-by trailer block.");
    return { records: [], start: message.length, end: message.length, eol };
  }
  if (first === 0 || records2.length !== parsed.trimEnd().split("\n").length)
    throw new InputError("Ambiguous terminal trailer structure cannot be preserved safely.");
  for (const record2 of records2)
    record2.id = digest([
      "message-record-v1",
      byteDigest(Buffer.from(message)),
      record2.start,
      record2.end,
      record2.raw
    ]);
  const endings = new Set(records2.flatMap((record2) => [...record2.raw.matchAll(/\r?\n/g)].map((match) => match[0])));
  if (endings.size > 1)
    throw new InputError("Mixed terminal trailer line endings require a decision before rewriting.");
  return {
    records: records2,
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
import path9 from "node:path";
async function resolveOutputScope(operation) {
  const worktree = await physicalDirectory(operation.worktree);
  const executable = await resolveTrustedGit([operation.repository, worktree, operation.commonGitDir]);
  const git = new SafeGit(executable, worktree);
  await git.guard();
  const top = await physicalDirectory(await git.text("rev-parse", ["--show-toplevel"]));
  const gitDirectory = await physicalDirectory(await git.text("rev-parse", ["--absolute-git-dir"]));
  const commonGitDir = await physicalDirectory(
    path9.resolve(worktree, await git.text("rev-parse", ["--git-common-dir"]))
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
    let invalid3 = false;
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
            const line2 = `Assisted-by: ${tuple.agent}:${tuple.model}${tuple.reasoning ? ` (${tuple.reasoning})` : ""}`;
            actual.push(line2);
            if (!canonical2.includes(line2) || record2.key !== "Assisted-by" || record2.raw.replace(/\r?\n$/, "") !== line2)
              invalid3 = true;
            removed.add(record2.id);
          }
        } catch (error) {
          if (!(error instanceof InputError)) throw error;
          invalid3 = true;
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
    if (formatIssues.length || input.mode === "validate" && invalid3) {
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
    if (canonical2.some((line2) => !interpreted.split("\n").includes(line2)))
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
    issue = (id2, code, detail) => ({ id: id2, code, detail });
  }
});

// src/result-git.ts
import { execFile as execFile3 } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { lstat as lstat6 } from "node:fs/promises";
import path10 from "node:path";
function fail(detail) {
  throw new ObservationError(`Result observation failed: ${detail}.`);
}
function id(value, format) {
  try {
    return fullObjectId(value, format === "sha1" ? 40 : 64);
  } catch {
    fail("invalid full storage object ID");
  }
}
function line(bytes2) {
  const result = new TextDecoder("utf-8", { fatal: true }).decode(bytes2);
  if (!/^[^\r\n]+\r?\n$/.test(result)) fail("invalid single-line Git response");
  return result.replace(/\r?\n$/, "");
}
function pathCheck(name, sparse = false) {
  if (!name.length || name.includes(0) || name[0] === 47 || process.platform === "win32" && name.includes(92))
    fail("invalid raw Git path");
  const raw = sparse && name.at(-1) === 47 ? name.subarray(0, -1) : name;
  const parts = raw.toString("latin1").split("/");
  if (parts.length > 256) fail("path depth budget exceeded");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git") || /^[A-Za-z]:/.test(parts[0] ?? ""))
    fail("unsafe raw Git path");
}
function leaves(entries) {
  if (entries.length > MAX_ENTRIES) fail("entry count budget exceeded");
  const sorted = [...entries].sort((a, b) => Buffer.compare(a.name, b.name));
  const names = /* @__PURE__ */ new Set();
  for (const entry of sorted) {
    pathCheck(entry.name);
    if (![33188, 33261, 40960, 57344].includes(entry.mode) || entry.stage !== 0)
      fail("unsupported mode or unmerged entry");
    const key = entry.name.toString("hex");
    if (names.has(key)) fail("duplicate raw path");
    names.add(key);
    for (let index = entry.name.indexOf(47); index >= 0; index = entry.name.indexOf(47, index + 1))
      if (names.has(entry.name.subarray(0, index).toString("hex"))) fail("file and directory path conflict");
  }
  return sorted;
}
function integer2(value) {
  const bytes2 = Buffer.alloc(4);
  bytes2.writeUInt32BE(value);
  return bytes2;
}
function manifest(entries, format) {
  const hash = createHash2("sha256").update(`ai-commit-attribution:index-manifest:1\0${format}\0`).update(integer2(entries.length));
  for (const entry of leaves(entries))
    hash.update(integer2(entry.name.length)).update(entry.name).update(integer2(entry.mode)).update(Buffer.from(entry.oid, "hex"));
  return hash.digest("hex");
}
function treeId(entries, format) {
  const root = /* @__PURE__ */ new Map();
  for (const entry of leaves(entries)) {
    const components = [];
    let start = 0;
    for (let cursor = 0; cursor <= entry.name.length; cursor++)
      if (cursor === entry.name.length || entry.name[cursor] === 47) {
        components.push(entry.name.subarray(start, cursor));
        start = cursor + 1;
      }
    let current = root;
    components.forEach((name, index) => {
      const key = name.toString("hex");
      if (index === components.length - 1) current.set(key, { name, leaf: entry });
      else {
        let item = current.get(key);
        if (!item) {
          item = { name, directory: /* @__PURE__ */ new Map() };
          current.set(key, item);
        }
        if (!item.directory) fail("tree path conflict");
        current = item.directory;
      }
    });
  }
  function encode(directory) {
    const chunks = [...directory.values()].sort(
      (a, b) => Buffer.compare(
        Buffer.concat([a.name, a.directory ? Buffer.from("/") : Buffer.alloc(0)]),
        Buffer.concat([b.name, b.directory ? Buffer.from("/") : Buffer.alloc(0)])
      )
    ).map(
      (item) => Buffer.concat([
        Buffer.from(`${item.directory ? "40000" : item.leaf?.mode.toString(8)} `),
        item.name,
        Buffer.from([0]),
        Buffer.from(item.directory ? encode(item.directory) : item.leaf?.oid ?? "", "hex")
      ])
    );
    const body = Buffer.concat(chunks);
    return createHash2(format).update(`tree ${body.length}\0`).update(body).digest("hex");
  }
  return encode(root);
}
function records(bytes2) {
  if (!bytes2.length) return [];
  if (bytes2.at(-1) !== 0) fail("unterminated raw path manifest");
  const rows2 = [];
  let start = 0;
  for (let cursor = 0; cursor < bytes2.length; cursor++)
    if (bytes2[cursor] === 0) {
      rows2.push(bytes2.subarray(start, cursor));
      start = cursor + 1;
      if (rows2.length > MAX_ENTRIES * 2) fail("manifest count budget exceeded");
    }
  return rows2;
}
function parseStage(bytes2, format) {
  return leaves(
    records(bytes2).map((row) => {
      const tab = row.indexOf(9);
      const match = /^([0-7]{6}) ([a-f0-9]+) ([0-3])$/.exec(row.subarray(0, tab).toString("ascii"));
      if (tab < 0 || !match) fail("invalid stage manifest");
      return {
        name: Buffer.from(row.subarray(tab + 1)),
        mode: Number.parseInt(match[1] ?? "", 8),
        oid: id(match[2], format),
        stage: Number(match[3])
      };
    })
  );
}
function parseIndex(bytes2, format) {
  const width = format === "sha1" ? 20 : 32;
  const end = bytes2.length - width;
  if (bytes2.length < 12 + width || bytes2.subarray(0, 4).toString("ascii") !== "DIRC") fail("invalid index header");
  const version2 = bytes2.readUInt32BE(4);
  const count = bytes2.readUInt32BE(8);
  if (![2, 3, 4].includes(version2) || count > MAX_ENTRIES) fail("unsupported index version or count");
  const checksum = bytes2.subarray(end);
  if (checksum.some((byte) => byte !== 0) && !createHash2(format).update(bytes2.subarray(0, end)).digest().equals(checksum))
    fail("index checksum mismatch");
  let cursor = 12;
  let previous = Buffer.alloc(0);
  const result = [];
  function need(length) {
    if (length < 0 || cursor + length > end) fail("truncated binary index");
  }
  for (let index = 0; index < count; index++) {
    const start = cursor;
    need(42 + width);
    const mode = bytes2.readUInt32BE(cursor + 24);
    const oid = id(bytes2.subarray(cursor + 40, cursor + 40 + width).toString("hex"), format);
    const flags2 = bytes2.readUInt16BE(cursor + 40 + width);
    cursor += 42 + width;
    let extended = 0;
    if (flags2 & 16384) {
      if (version2 === 2) fail("extended flags in v2 index");
      need(2);
      extended = bytes2.readUInt16BE(cursor);
      cursor += 2;
      if (extended & ~24576) fail("unsupported extended index flags");
    }
    if (extended & 8192) fail("intent-to-add index entry");
    const stage = flags2 >>> 12 & 3;
    if (stage) fail("unmerged index");
    let remove = 0;
    if (version2 === 4) {
      need(1);
      let byte = bytes2[cursor++] ?? 0;
      remove = byte & 127;
      let groups = 1;
      while (byte & 128) {
        if (++groups > 5) fail("index v4 prefix integer overflow");
        need(1);
        byte = bytes2[cursor++] ?? 0;
        remove = (remove + 1) * 128 + (byte & 127);
      }
      if (remove > previous.length) fail("invalid index v4 prefix");
    }
    const nul = bytes2.indexOf(0, cursor);
    if (nul < cursor || nul >= end) fail("unterminated binary index path");
    const name = version2 === 4 ? Buffer.concat([previous.subarray(0, previous.length - remove), bytes2.subarray(cursor, nul)]) : Buffer.from(bytes2.subarray(cursor, nul));
    cursor = nul + 1;
    if (version2 !== 4) {
      const padding = (8 - (cursor - start) % 8) % 8;
      need(padding);
      if (bytes2.subarray(cursor, cursor + padding).some((byte) => byte !== 0)) fail("invalid index padding");
      cursor += padding;
    }
    if ((flags2 & 4095) !== Math.min(name.length, 4095)) fail("index path length flags mismatch");
    if (index > 0 && Buffer.compare(previous, name) >= 0) fail("binary index names are not in ascending order");
    const sparse = mode === 16384 && !!(extended & 16384) && name.at(-1) === 47;
    result.push({ name, mode, oid, stage, ...sparse ? { sparse: true } : {} });
    previous = name;
  }
  let sparseExtension = false;
  while (cursor < end) {
    need(8);
    const signature = bytes2.subarray(cursor, cursor + 4).toString("latin1");
    const length = bytes2.readUInt32BE(cursor + 4);
    cursor += 8;
    need(length);
    if (signature === "link") fail("split index is unsupported");
    if (signature === "sdir") {
      if (sparseExtension || length !== 0) fail("invalid sparse index extension");
      sparseExtension = true;
    } else if (!/^[A-Z]/.test(signature)) fail("unsupported required index extension");
    cursor += length;
  }
  if (result.some((entry) => entry.sparse) && !sparseExtension) fail("sparse index extension missing");
  const names = /* @__PURE__ */ new Set();
  for (const entry of result) {
    pathCheck(entry.name, entry.sparse);
    const key = entry.name.toString("hex");
    if (names.has(key)) fail("duplicate binary index path");
    names.add(key);
    if (!entry.sparse && ![33188, 33261, 40960, 57344].includes(entry.mode))
      fail("unsupported binary index mode");
  }
  return result;
}
async function indexSnapshot(file) {
  const identity2 = await inspectPath(file);
  if (!identity2) return { bytes: null, identity: void 0 };
  if (!identity2.isFile()) fail("index is not a physical regular file");
  try {
    const bytes2 = await readRegularFile(file, { physicalPath: true, maximumBytes: MAX_BYTES });
    if (!sameObserved(identity2, await lstat6(file))) fail("index changed during read");
    return { bytes: bytes2, identity: identity2 };
  } catch (error) {
    if (error instanceof ObservationError) throw error;
    fail(errorCode(error) === "ENOENT" ? "index disappeared" : "unsafe or unreadable index");
  }
}
async function observer(directory) {
  const physical2 = await physicalDirectory(directory);
  const git = new ResultGit(await resolveTrustedGit([physical2]), physical2);
  await git.run(["--version"]);
  const worktree = await physicalDirectory(await git.text(["rev-parse", "--show-toplevel"]));
  const gitDir = await physicalDirectory(await git.text(["rev-parse", "--absolute-git-dir"]));
  const commonGitDir = await physicalDirectory(
    path10.resolve(physical2, await git.text(["rev-parse", "--git-common-dir"]))
  );
  if (await resolveTrustedGit([worktree, gitDir, commonGitDir]) !== git.executable)
    fail("trusted Git scope changed");
  if (!inside(worktree, physical2)) fail("current directory must be inside the physical worktree");
  git.directory = worktree;
  return { git, worktree, gitDir, commonGitDir };
}
async function actualTree(git, tree, format) {
  const directories = /* @__PURE__ */ new Map();
  const entries = [];
  for (const row of records((await git.run(["ls-tree", "-r", "-t", "-z", "--full-tree", tree])).bytes)) {
    const tab = row.indexOf(9);
    const match = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]+)$/.exec(row.subarray(0, tab).toString("ascii"));
    if (tab < 0 || !match) fail("invalid tree manifest");
    const name = Buffer.from(row.subarray(tab + 1));
    pathCheck(name);
    const mode = Number.parseInt(match[1] ?? "", 8);
    const oid = id(match[3], format);
    if (mode === 16384 && match[2] === "tree") {
      const key = name.toString("hex");
      if (directories.has(key)) fail("duplicate tree directory");
      directories.set(key, name);
    } else {
      if (match[2] !== (mode === 57344 ? "commit" : "blob")) fail("tree mode/type mismatch");
      entries.push({ name, mode, oid, stage: 0 });
    }
  }
  const sorted = leaves(entries);
  const occupied = /* @__PURE__ */ new Set();
  for (const entry of sorted)
    for (let cursor = entry.name.indexOf(47); cursor >= 0; cursor = entry.name.indexOf(47, cursor + 1)) {
      const key = entry.name.subarray(0, cursor).toString("hex");
      if (!directories.has(key)) fail("missing tree ancestor");
      occupied.add(key);
    }
  for (const key of directories.keys()) if (!occupied.has(key)) fail("empty or inconsistent tree directory");
  if (treeId(sorted, format) !== tree) fail("noncanonical root tree");
  await git.objects(
    sorted.filter((entry) => entry.mode !== 57344).map((entry) => entry.oid),
    format,
    "blob"
  );
  return sorted;
}
async function observePreparation(operation, inputPlan) {
  const plan = parseResultPlan(inputPlan, operation);
  const scope = await observer(operation.worktree);
  const { git } = scope;
  if (!samePhysicalPath(scope.worktree, operation.repository) || !samePhysicalPath(scope.worktree, operation.worktree) || !samePhysicalPath(scope.commonGitDir, operation.commonGitDir))
    fail("operation physical scope mismatch");
  const objectFormat = await git.format();
  const observedHead = await git.head(objectFormat);
  const oids = [
    ...plan.expectedParents,
    ...plan.sourceTargets.map((source) => source.objectId),
    ...plan.replacementTarget ? [plan.replacementTarget] : []
  ];
  await git.objects(oids, objectFormat, "commit");
  if (plan.form === "create") {
    if (observedHead === null ? plan.expectedParents.length !== 0 : plan.expectedParents[0] !== observedHead)
      fail("create parent must match observed HEAD");
  } else {
    if (!observedHead || plan.replacementTarget !== observedHead)
      fail("replacement target must match observed HEAD");
    const original = await git.commit(observedHead, objectFormat);
    if (JSON.stringify(original.parents) !== JSON.stringify(plan.expectedParents))
      fail("replacement ordered parents mismatch");
  }
  const index = await git.text(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  if (!samePhysicalPath(index, path10.join(scope.gitDir, "index"))) fail("unexpected resolved index path");
  const before = await indexSnapshot(index);
  const binary = before.bytes ? parseIndex(before.bytes, objectFormat) : [];
  const entries = parseStage((await git.run(["ls-files", "--stage", "--full-name", "-z"])).bytes, objectFormat);
  const expanded = /* @__PURE__ */ new Set();
  const entryMap = new Map(entries.map((entry) => [entry.name.toString("hex"), entry]));
  const sparseChildren = /* @__PURE__ */ new Map();
  const sparseNames = new Set(binary.filter((entry) => entry.sparse).map((entry) => entry.name.toString("hex")));
  for (const entry of entries)
    for (let cursor = entry.name.indexOf(47); cursor >= 0; cursor = entry.name.indexOf(47, cursor + 1)) {
      const key = entry.name.subarray(0, cursor + 1).toString("hex");
      if (sparseNames.has(key)) {
        const children = sparseChildren.get(key) ?? [];
        children.push(entry);
        sparseChildren.set(key, children);
      }
    }
  for (const entry of binary) {
    if (entry.sparse) {
      const children = sparseChildren.get(entry.name.toString("hex")) ?? [];
      if (!children.length || treeId(
        children.map((child) => ({ ...child, name: child.name.subarray(entry.name.length) })),
        objectFormat
      ) !== entry.oid)
        fail("sparse index expansion mismatch");
      for (const child of children) expanded.add(child.name.toString("hex"));
    } else {
      const actual = entryMap.get(entry.name.toString("hex"));
      if (!actual || actual.mode !== entry.mode || actual.oid !== entry.oid || actual.stage !== entry.stage)
        fail("binary index and Git manifest mismatch");
      expanded.add(entry.name.toString("hex"));
    }
  }
  if (expanded.size !== entries.length) fail("index manifest contains unbound entries");
  if (entries.some((entry) => isLedgerStatePath(entry.name))) fail("local state namespace is staged");
  await git.objects(
    entries.filter((entry) => entry.mode !== 57344).map((entry) => entry.oid),
    objectFormat,
    "blob"
  );
  const expectedTree = treeId(entries, objectFormat);
  const indexManifestSha256 = manifest(entries, objectFormat);
  const after = await indexSnapshot(index);
  if (before.bytes === null ? after.bytes !== null : after.bytes === null || !before.bytes.equals(after.bytes) || !before.identity || !after.identity || !sameObserved(before.identity, after.identity))
    fail("index changed during observation");
  if (observedHead !== await git.head(objectFormat) || objectFormat !== await git.format() || !samePhysicalPath(await git.text(["rev-parse", "--show-toplevel"]), scope.worktree) || !samePhysicalPath(await git.text(["rev-parse", "--absolute-git-dir"]), scope.gitDir) || !samePhysicalPath(
    path10.resolve(scope.worktree, await git.text(["rev-parse", "--git-common-dir"])),
    scope.commonGitDir
  ))
    fail("Git scope or HEAD changed during observation");
  return { observedHead, objectFormat, indexManifestSha256, expectedTree };
}
async function observeResult(currentDirectory, sha) {
  fullObjectId(sha);
  const { git } = await observer(currentDirectory);
  const objectFormat = await git.format();
  id(sha, objectFormat);
  const commit = await git.commit(sha, objectFormat);
  const entries = await actualTree(git, commit.tree, objectFormat);
  return {
    sha,
    ...commit,
    indexManifestSha256: manifest(entries, objectFormat),
    messageSha256: byteDigest(commit.message),
    objectFormat
  };
}
var MAX_BYTES, MAX_ENTRIES, ResultGit;
var init_result_git = __esm({
  "src/result-git.ts"() {
    "use strict";
    init_errors();
    init_file_evidence();
    init_input_contract();
    init_result_contract();
    init_runtime_support();
    init_safe_git();
    init_state_path();
    MAX_BYTES = 16 * 1024 * 1024;
    MAX_ENTRIES = 1e5;
    ResultGit = class {
      executable;
      directory;
      started = performance.now();
      environment = gitEnvironment();
      consumed = 0;
      constructor(executable, directory) {
        this.executable = executable;
        this.directory = directory;
      }
      async run(args, input, accepted = [0]) {
        const remaining = 3e4 - (performance.now() - this.started);
        if (remaining <= 0) fail("time budget exceeded");
        if (input !== void 0 && (!/^(?:[a-f0-9]{40}\n|[a-f0-9]{64}\n)+$/.test(input) || input.length > MAX_BYTES))
          fail("invalid object query");
        return new Promise((resolve, reject) => {
          const child = execFile3(
            this.executable,
            [
              "--no-pager",
              "--no-replace-objects",
              "--no-lazy-fetch",
              "--no-optional-locks",
              "--literal-pathspecs",
              "-c",
              "core.fsmonitor=false",
              "-c",
              "core.untrackedCache=false",
              "-c",
              "core.hooksPath=",
              "-c",
              "core.pager=cat",
              "-c",
              "diff.external=",
              ...args
            ],
            {
              cwd: this.directory,
              env: this.environment,
              shell: false,
              windowsHide: true,
              encoding: "buffer",
              timeout: Math.min(1e4, remaining),
              maxBuffer: MAX_BYTES
            },
            (error, stdout, stderr) => {
              const code = error && "code" in error && typeof error.code === "number" ? error.code : error ? -1 : 0;
              this.consumed += stdout.length + stderr.length;
              if (!accepted.includes(code) || this.consumed > 64 * 1024 * 1024)
                reject(
                  new ObservationError(
                    "Git observation failed, timed out, exceeded output budget or required object is unavailable."
                  )
                );
              else resolve({ bytes: stdout, code });
            }
          );
          child.stdin?.on("error", () => {
          });
          child.stdin?.end(input);
        });
      }
      async text(args) {
        return line((await this.run(args)).bytes);
      }
      async format() {
        const format = await this.text(["rev-parse", "--show-object-format=storage"]);
        if (format !== "sha1" && format !== "sha256") fail("unsupported object format");
        return format;
      }
      async head(format) {
        const head = await this.run(
          ["rev-parse", "--verify", "--quiet", "--end-of-options", "HEAD"],
          void 0,
          [0, 1]
        );
        if (head.code === 0) {
          const oid = id(line(head.bytes), format);
          await this.objects([oid], format, "commit");
          return oid;
        }
        if (head.bytes.length) fail("unexpected missing HEAD output");
        const reference = await this.text(["symbolic-ref", "--quiet", "HEAD"]);
        if (!reference.startsWith("refs/heads/") || /[\x00-\x20\x7f~^:?*[\\]/u.test(reference) || reference.includes("@{") || reference.includes("..") || reference.endsWith("/") || reference.includes("//") || reference.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock") || part.endsWith(".")))
          fail("invalid unborn branch");
        const exists = await this.run(["show-ref", "--exists", reference], void 0, [0, 2]);
        if (exists.code !== 2) fail("HEAD is not a valid unborn branch");
        return null;
      }
      async objects(oids, format, type) {
        const unique2 = [...new Set(oids)];
        if (!unique2.length) return;
        if (unique2.length > MAX_ENTRIES) fail("object count budget exceeded");
        for (const oid of unique2) id(oid, format);
        const output2 = (await this.run(
          ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
          `${unique2.join("\n")}
`
        )).bytes.toString("ascii").split("\n");
        if (output2.pop() !== "" || output2.length !== unique2.length) fail("invalid object metadata framing");
        output2.forEach((value, index) => {
          const match = /^([a-f0-9]+) (blob|commit|tree|tag) ([0-9]+)$/.exec(value);
          if (!match || match[1] !== unique2[index] || match[2] !== type || !Number.isSafeInteger(Number(match[3])))
            fail("missing object or wrong object type");
        });
        if (type === "blob") {
          const bytes2 = (await this.run(["cat-file", "--batch"], `${unique2.join("\n")}
`)).bytes;
          let cursor = 0;
          for (const oid of unique2) {
            const end = bytes2.indexOf(10, cursor);
            if (end < cursor) fail("invalid blob framing");
            const header = /^([a-f0-9]+) blob ([0-9]+)$/.exec(bytes2.subarray(cursor, end).toString("ascii"));
            const size = Number(header?.[2]);
            const finish = end + 1 + size;
            if (!header || header[1] !== oid || !Number.isSafeInteger(size) || size > MAX_BYTES || finish >= bytes2.length || bytes2[finish] !== 10)
              fail("invalid blob object or framing");
            if (createHash2(format).update(`blob ${size}\0`).update(bytes2.subarray(end + 1, finish)).digest("hex") !== oid)
              fail("corrupt blob object");
            cursor = finish + 1;
          }
          if (cursor !== bytes2.length) fail("unexpected blob batch bytes");
        }
      }
      async commit(oid, format) {
        id(oid, format);
        const bytes2 = (await this.run(["cat-file", "--batch"], `${oid}
`)).bytes;
        const end = bytes2.indexOf(10);
        if (end < 0) fail("invalid commit framing");
        const header = /^([a-f0-9]+) commit ([0-9]+)$/.exec(bytes2.subarray(0, end).toString("ascii"));
        const size = Number(header?.[2]);
        if (!header || header[1] !== oid || !Number.isSafeInteger(size) || size > MAX_BYTES - 256 || bytes2.length !== end + 1 + size + 1 || bytes2.at(-1) !== 10)
          fail("invalid commit object or framing");
        const raw = bytes2.subarray(end + 1, end + 1 + size);
        const separator = raw.indexOf(Buffer.from("\n\n"));
        if (createHash2(format).update(`commit ${size}\0`).update(raw).digest("hex") !== oid)
          fail("corrupt commit object");
        if (separator < 0) fail("invalid raw commit header");
        let tree;
        const parents = [];
        let previous = false;
        for (const row of raw.subarray(0, separator).toString("latin1").split("\n")) {
          if (row.startsWith(" ")) {
            if (!previous) fail("orphan commit header continuation");
            continue;
          }
          if (!/^[a-zA-Z0-9-]+ [^\x00\r]*$/.test(row)) fail("malformed commit header");
          previous = true;
          if (row.startsWith("tree ")) {
            if (tree) fail("duplicate root tree");
            tree = id(row.slice(5), format);
          }
          if (row.startsWith("parent ")) {
            parents.push(id(row.slice(7), format));
            if (parents.length > MAX_ENTRIES) fail("parent count budget exceeded");
          }
        }
        if (!tree) fail("missing root tree");
        const message = Buffer.from(raw.subarray(separator + 2));
        if (message.length > INPUT_BYTES) fail("message byte budget exceeded");
        return { tree, parents, message };
      }
    };
  }
});

// src/ledger-preparation.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import path11 from "node:path";
import { fileURLToPath } from "node:url";
async function defaultRegistry(consumedPaths) {
  const registryFile = fileURLToPath(new URL("../references/agent-registry.json", import.meta.url));
  consumedPaths.push(registryFile);
  const bytes2 = await readRegularFile(registryFile, {
    physicalPath: true,
    singleLink: true,
    maximumBytes: INPUT_BYTES
  });
  try {
    return parseRegistry(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes2)));
  } catch {
    throw new InputError("Default registry must be valid bounded UTF-8 JSON.");
  }
}
function ledgerIn(state, id2) {
  const ledger = state.ledgers.find((item) => item.ledgerId === uuid3(id2));
  if (!ledger || ledger.contextId !== state.contextId || ledger.ownership.kind !== "local")
    throw new InputError("Preparation requires an existing locally owned ledger.");
  return ledger;
}
function unchanged3(initial, draft) {
  if (digest(initial) !== digest(draft)) throw new InputError("Frozen lifecycle state changed during observation.");
}
function boundReview(state, options) {
  const review = parseResultReview(options.review);
  if (review.contextId !== state.contextId || review.ledgerId !== options.ledgerId || review.preparationId !== options.preparationId || review.sha !== options.sha)
    throw new InputError("Final review must bind this current context, ledger, preparation and exact SHA.");
  return review;
}
async function prepareLedger(context, expectedStateVersion, options, hooks = {}) {
  integer(expectedStateVersion);
  const ledgerId = uuid3(options.ledgerId);
  const decision = await parseDecision(options.decision);
  const route = await checkRouting({ operation: options.operation, decision });
  const base = { artifact: "ledger-preparation", ledgerId };
  if (route.branch === "needs-decision") return { ...base, status: "needs-decision", exitCode: 20 };
  const message = Buffer.from(options.messageBuffer);
  const plan = parseResultPlan(options.resultPlan, route.operation);
  const consumedPaths = [context.stateFile, ...options.consumedPaths ?? []];
  if (route.operation.id === ledgerId)
    throw new InputError("Operation ID must be distinct from the stable ledger ID.");
  const initial = await readState(context);
  if (initial.stateVersion !== expectedStateVersion) throw new InputError("Ledger state version is stale.");
  const historical = [
    ...initial.preparations,
    ...initial.ledgers.flatMap(
      (item) => item.origin ? [item.origin, ...item.origin.history].flatMap((origin) => origin.preparations) : []
    )
  ];
  if (historical.some(
    (receipt2) => receipt2.ledger.operation.id === route.operation.id && digest(receipt2.ledger.operation) !== digest(route.operation)
  ))
    throw new InputError(
      "Operation ID was already bound to a different normalized scope; supply a new operation ID."
    );
  const planned = ledgerIn(initial, ledgerId);
  if (planned.state !== "open" || initial.current?.ledgerId !== ledgerId || initial.current.paused)
    throw new InputError("Prepare requires the exact active current open ledger.");
  const snapshot = selectedLedgerSnapshot(initial, route.operation, ledgerId, true);
  let frozenLedger = snapshot;
  const rendered = await processMessage(
    { mode: "render", message, operation: route.operation, decision },
    async () => ({
      ledger: snapshot,
      registry: await (options.loadRegistry ?? defaultRegistry)(consumedPaths),
      assessment: options.loadAssessment ? await options.loadAssessment(consumedPaths) : options.assessment
    })
  );
  if (![0, 10].includes(rendered.exitCode))
    return { ...base, status: "blocked", exitCode: rendered.exitCode, messageResult: rendered };
  if (route.branch === "skill-default") {
    const tuples = rendered.participationEvidence.summary?.tuples;
    if (!tuples) throw new InputError("Default preparation lacks a complete finite identity summary.");
    frozenLedger = { ...snapshot, identities: tuples };
  }
  const observation = await observePreparation(route.operation, plan);
  if (rendered.message.preview === void 0) throw new InputError("Preparation candidate is unavailable.");
  const candidate = Buffer.from(rendered.message.preview);
  const preparationId = randomUUID3();
  const receipt = parsePreparedReceipt({
    schemaVersion: 1,
    artifact: "prepared-receipt",
    preparationId,
    sourceContextId: initial.contextId,
    ledgerId,
    revision: integer(planned.revision + 1, 1),
    ledger: frozenLedger,
    decision,
    resultPlan: plan,
    ...observation,
    candidate: {
      encoding: "base64",
      bytes: candidate.toString("base64"),
      byteLength: candidate.length,
      sha256: byteDigest(candidate)
    }
  });
  if (inside(context.stateDirectory, path11.resolve(options.output)))
    throw new InputError("Candidate output may not enter the owned state directory.");
  const outputPath = await writeNewMessage(options.output, candidate, context.locator, consumedPaths);
  try {
    await hooks.beforePrepareTransaction?.();
    const state = await transactState(
      context,
      expectedStateVersion,
      (draft) => {
        unchanged3(initial, draft);
        const current = ledgerIn(draft, ledgerId);
        reviseLedger(current);
        current.identities = structuredClone(frozenLedger.identities);
        current.state = "prepared";
        current.currentPreparationId = preparationId;
        draft.preparations.push(receipt);
      },
      hooks.stateIO
    );
    return {
      ...base,
      status: "prepared",
      exitCode: route.exitCode,
      preparationId,
      outputPath,
      stateVersion: state.stateVersion,
      messageResult: rendered
    };
  } catch {
    return {
      ...base,
      status: "candidate-unprepared",
      exitCode: 2,
      outputPath,
      detail: "Candidate was published, but preparation persistence failed. Preserve the candidate and inspect ledger status before recovery."
    };
  }
}
function equivalent(candidate, actual) {
  const normalize = (bytes2) => new TextDecoder("utf-8", { fatal: true }).decode(bytes2).replaceAll("\r\n", "\n").replace(/\n$/, "");
  try {
    return normalize(candidate) === normalize(actual);
  } catch {
    return false;
  }
}
function frozenRegistry(receipt) {
  return {
    schemaVersion: 1,
    hosts: [...new Set(receipt.ledger.identities.map((item) => item.agent))].map((name) => ({
      name,
      aliases: [],
      family: "frozen-identity"
    })),
    ambiguousAliases: [],
    familyAliases: {}
  };
}
async function finishLedger(context, expectedStateVersion, options, hooks = {}) {
  integer(expectedStateVersion);
  const ledgerId = uuid3(options.ledgerId), preparationId = uuid3(options.preparationId);
  fullObjectId(options.sha);
  const initial = await readState(context), planned = ledgerIn(initial, ledgerId);
  const review = boundReview(initial, options);
  const base = { artifact: "ledger-finish", ledgerId, preparationId };
  if (planned.state === "sealed") {
    const stored = planned.sealedResult;
    if (!stored || stored.preparationId !== preparationId || stored.sha !== options.sha || stored.messageSha256 !== review.messageSha256)
      throw new InputError(
        "Sealed result is immutable; retry must name the same preparation, SHA and message hash."
      );
    return {
      ...base,
      status: "sealed",
      exitCode: stored.checks.participation === "repository-rule-declaration" ? 10 : 0,
      sealedResult: stored,
      stateVersion: initial.stateVersion,
      idempotent: true
    };
  }
  if (initial.stateVersion !== expectedStateVersion) throw new InputError("Ledger state version is stale.");
  const receipt = initial.preparations.find((item) => item.preparationId === preparationId);
  if (planned.state !== "prepared" || planned.currentPreparationId !== preparationId || !receipt || receipt.ledgerId !== ledgerId || receipt.revision !== planned.revision || digest(receipt.ledger.identities) !== digest(planned.identities) || digest(receipt.ledger.blockers) !== digest(planned.blockers))
    throw new InputError("Finish requires the exact current preparation and frozen ledger revision/set.");
  if ([
    receipt.observedHead,
    receipt.resultPlan.replacementTarget,
    ...receipt.resultPlan.sourceTargets.map((item) => item.objectId)
  ].includes(options.sha))
    throw new InputError(
      "Result is an obviously preexisting source or observed HEAD; an actual newly created result is required."
    );
  const actual = await observeResult(context.locator.worktree, options.sha);
  if (actual.messageSha256 !== review.messageSha256)
    throw new InputError("Final review message digest differs from the actual commit.");
  if (actual.objectFormat !== receipt.objectFormat || actual.tree !== receipt.expectedTree || actual.indexManifestSha256 !== receipt.indexManifestSha256 || digest(actual.parents) !== digest(receipt.resultPlan.expectedParents))
    throw new InputError(
      "Actual result parents, tree, manifest or object format differ from the frozen preparation."
    );
  const sameMessage = equivalent(Buffer.from(receipt.candidate.bytes, "base64"), actual.message);
  if (!sameMessage && review.acceptMessageChange !== true)
    return {
      ...base,
      status: "prepared",
      exitCode: 20,
      detail: "Final message changed; supply a fresh exact-result review accepting this actual message."
    };
  let messageResult;
  const repository = receipt.decision.branch === "repository-policy";
  if (repository) {
    if (review.repositoryPolicyChecked !== true)
      return {
        ...base,
        status: "prepared",
        exitCode: 20,
        detail: "Repository policy requires a fresh exact-result repositoryPolicyChecked declaration."
      };
  } else {
    const operation = {
      ...receipt.ledger.operation,
      repository: context.locator.worktree,
      worktree: context.locator.worktree,
      commonGitDir: context.locator.commonGitDir
    };
    messageResult = await processMessage(
      { mode: "validate", message: actual.message, operation, decision: { ...receipt.decision, operation } },
      async () => ({
        ledger: { ...receipt.ledger, operation },
        registry: frozenRegistry(receipt),
        assessment: options.loadAssessment ? await options.loadAssessment([]) : options.assessment
      })
    );
    if (messageResult.exitCode !== 0)
      return { ...base, status: "prepared", exitCode: messageResult.exitCode, messageResult };
  }
  const sealedResult = parseSealedResult({
    preparationId,
    sha: actual.sha,
    messageSha256: actual.messageSha256,
    review,
    checks: {
      parents: true,
      tree: true,
      message: sameMessage ? "candidate-equivalent" : "explicit-final-review",
      participation: repository ? "repository-rule-declaration" : "frozen-default-check"
    }
  });
  try {
    await hooks.beforeFinishTransaction?.();
    const state = await transactState(
      context,
      expectedStateVersion,
      (draft) => {
        unchanged3(initial, draft);
        const current = ledgerIn(draft, ledgerId);
        reviseLedger(current);
        current.state = "sealed";
        current.currentPreparationId = null;
        current.sealedResult = sealedResult;
        if (draft.current?.ledgerId === ledgerId) draft.current = null;
      },
      hooks.stateIO
    );
    return {
      ...base,
      status: "sealed",
      exitCode: repository ? 10 : 0,
      sealedResult,
      stateVersion: state.stateVersion,
      ...messageResult ? { messageResult } : {}
    };
  } catch {
    return {
      ...base,
      status: "prepared",
      exitCode: 2,
      detail: "Result was observed, but sealing persistence failed. Inspect ledger status and retry the same preparation and exact SHA."
    };
  }
}
var init_ledger_preparation = __esm({
  "src/ledger-preparation.ts"() {
    "use strict";
    init_file_evidence();
    init_input_contract();
    init_ledger();
    init_ledger_contract();
    init_ledger_store();
    init_message();
    init_message_output();
    init_policy();
    init_records();
    init_result_contract();
    init_result_git();
    init_result_review();
    init_runtime_support();
    init_safe_git();
  }
});

// src/ledger-preparation-cli.ts
var ledger_preparation_cli_exports = {};
__export(ledger_preparation_cli_exports, {
  parsePreparationArguments: () => parsePreparationArguments,
  runPreparation: () => runPreparation
});
function parsePreparationArguments(args) {
  const command = args[0];
  if (command !== "prepare" && command !== "finish") throw new InputError("Unknown preparation command.");
  const options = /* @__PURE__ */ new Map();
  for (let index = 1; index < args.length; index++) {
    const flag = args[index] ?? "", value = args[++index];
    if (!flags[command].includes(flag) || options.has(flag) || !value || value.startsWith("--"))
      throw new InputError("Unknown, duplicate or missing preparation flag.");
    checkRaw(value);
    options.set(flag, value);
  }
  const version2 = options.get("--expect-version");
  if (!version2 || !/^(?:0|[1-9][0-9]*)$/.test(version2))
    throw new InputError("Preparation requires --expect-version <nonnegative integer>.");
  integer(Number(version2));
  const required = command === "prepare" ? ["--ledger", "--message", "--operation", "--decision", "--result-plan", "--output"] : ["--ledger", "--preparation", "--sha", "--review"];
  if (required.some((flag) => !options.has(flag)))
    throw new InputError("Preparation command is missing a required flag.");
  return { command, options };
}
async function bytes(file) {
  return readRegularFile(file, { physicalPath: true, singleLink: true, maximumBytes: INPUT_BYTES });
}
async function json(file) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(file)));
  } catch {
    throw new InputError("Lifecycle input must be bounded strict UTF-8 JSON.");
  }
}
async function runPreparation(args, loadRegistry) {
  const { command, options } = parsePreparationArguments(args);
  const get = (flag) => {
    const value = options.get(flag);
    if (value === void 0) throw new InputError("Required preparation option missing.");
    return value;
  };
  const directory = options.get("--worktree") ?? process.cwd(), version2 = Number(get("--expect-version"));
  const ledgerId = uuid3(get("--ledger"));
  const assessment = options.get("--assessment");
  const defaults = assessment === void 0 ? {} : {
    loadAssessment: (consumedPaths) => {
      consumedPaths.push(assessment);
      return json(assessment);
    }
  };
  if (command === "finish") {
    const context2 = await resolveLedgerContext(directory);
    return finishLedger(context2, version2, {
      ledgerId,
      preparationId: uuid3(get("--preparation")),
      sha: get("--sha"),
      review: await json(get("--review")),
      ...defaults
    });
  }
  const operation = await json(get("--operation")), decision = await json(get("--decision"));
  const route = await checkRouting({ operation, decision });
  if (route.branch === "needs-decision")
    return { artifact: "ledger-preparation", ledgerId, status: "needs-decision", exitCode: 20 };
  const context = await resolveLedgerContext(directory);
  return prepareLedger(context, version2, {
    ledgerId,
    operation,
    decision,
    resultPlan: await json(get("--result-plan")),
    messageBuffer: await bytes(get("--message")),
    output: get("--output"),
    consumedPaths: [get("--operation"), get("--decision"), get("--result-plan"), get("--message")],
    ...loadRegistry ? { loadRegistry } : {},
    ...defaults
  });
}
var flags;
var init_ledger_preparation_cli = __esm({
  "src/ledger-preparation-cli.ts"() {
    "use strict";
    init_file_evidence();
    init_input_contract();
    init_ledger_contract();
    init_ledger_preparation();
    init_ledger_store();
    init_policy();
    init_records();
    flags = {
      prepare: [
        "--worktree",
        "--ledger",
        "--expect-version",
        "--message",
        "--operation",
        "--decision",
        "--result-plan",
        "--output",
        "--assessment"
      ],
      finish: ["--worktree", "--ledger", "--preparation", "--sha", "--review", "--expect-version", "--assessment"]
    };
  }
});

// src/ledger-transfer.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import path12 from "node:path";
function parseTransferBundle(value) {
  checkRaw(value);
  const data = object2(value, [
    "schemaVersion",
    "artifact",
    "transferId",
    "sourceContextId",
    "locator",
    "current",
    "ledgers",
    "preparations",
    "payloadDigest"
  ]);
  if (data.schemaVersion !== 1 || data.artifact !== "ledger-transfer")
    throw new InputError("Invalid transfer bundle schema/artifact.");
  const sourceContextId = uuid3(data.sourceContextId);
  const ledgers = array(data.ledgers, parsePlannedLedger);
  const preparations = parsePreparations(data.preparations);
  if (!ledgers.length) throw new InputError("Transfer bundle requires a nonempty selection.");
  distinct(ledgers.map((ledger) => ledger.ledgerId));
  distinct(preparations.map((receipt) => uuid3(receipt.preparationId)));
  for (const receipt of preparations) {
    uuid3(receipt.sourceContextId);
    uuid3(receipt.ledgerId);
    if (!ledgers.some((ledger) => ledger.ledgerId === receipt.ledgerId))
      throw new InputError("Transfer preparation has no selected ledger.");
  }
  if (ledgers.some((ledger) => ledger.contextId !== sourceContextId || ledger.ownership.kind !== "local"))
    throw new InputError("Transfer snapshot context/ownership mismatch.");
  validateLedgerJoins(ledgers, preparations);
  const payloadDigest = sha2563(data.payloadDigest);
  if (digest({ ledgers, preparations }) !== payloadDigest) throw new InputError("Transfer payload digest mismatch.");
  return {
    schemaVersion: 1,
    artifact: "ledger-transfer",
    transferId: uuid3(data.transferId),
    sourceContextId,
    locator: parsePortableLocator(data.locator),
    current: parseCurrent(data.current, ledgers),
    ledgers,
    preparations,
    payloadDigest
  };
}
function encodeTransferBundle(bundle) {
  const bytes2 = Buffer.from(`${JSON.stringify(parseTransferBundle(bundle), null, 4)}
`);
  if (bytes2.length > BUNDLE_BYTES) throw new InputError("Transfer bundle byte budget exceeded.");
  return bytes2;
}
async function readBundle(file) {
  const bytes2 = await readRegularFile(path12.resolve(file), {
    physicalPath: true,
    singleLink: true,
    maximumBytes: BUNDLE_BYTES
  });
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes2));
  } catch {
    throw new InputError("Transfer bundle must be strict UTF-8 JSON.");
  }
  return { bundle: parseTransferBundle(value), bytes: bytes2, bundleDigest: byteDigest(bytes2) };
}
async function externalOutput(context, file) {
  checkRaw(file);
  if (!file) throw new InputError("Explicit transfer output path is empty.");
  const output2 = path12.resolve(file);
  checkOrdinaryOutputPath(output2);
  if (inside(context.locator.worktree, output2) || inside(context.locator.gitDirectory, output2) || inside(context.locator.commonGitDir, output2) || output2.split(path12.sep).some((part) => part.toLowerCase() === ".git"))
    throw new InputError("Transfer output must be outside the worktree and protected Git metadata.");
  await physicalDirectory(path12.dirname(output2));
  await inspectPath(output2);
  return output2;
}
function selectedIds(state, input) {
  const ids = input.map(uuid3).sort(ordinal);
  distinct(ids);
  if (!ids.length) throw new InputError("Export requires a nonempty explicit ledger selection.");
  for (const id2 of ids) {
    const ledger = state.ledgers.find((item) => item.ledgerId === id2);
    if (!ledger) throw new InputError(`Selected ledger does not exist: ${id2}`);
    const missing = [...ledger.predecessorIds, ...ledger.successorIds].filter((linked) => !ids.includes(linked));
    if (missing.length)
      throw new InputError(`Export requires complete replacement link closure: ${missing.join(", ")}`);
  }
  return ids;
}
function reconstruct(state, receipt) {
  const payload = transferPayload(state, receipt);
  if (digest(payload) !== receipt.payloadDigest)
    throw new InputError("Frozen export payload changed; cannot reconstruct original bundle.");
  return {
    schemaVersion: 1,
    artifact: "ledger-transfer",
    transferId: receipt.transferId,
    sourceContextId: receipt.sourceContextId,
    locator: receipt.locator,
    current: receipt.current,
    ...payload,
    payloadDigest: receipt.payloadDigest
  };
}
async function exportLedgers(contextValue, expectedStateVersion, options, io = {}) {
  integer(expectedStateVersion);
  const context = await resolveLedgerContext(contextValue.locator.worktree);
  let state = await readState(contextValue);
  if (state.stateVersion !== expectedStateVersion) throw new InputError("Ledger state version is stale.");
  const output2 = await externalOutput(context, options.output);
  const ledgerIds = selectedIds(state, options.ledgerIds);
  let receipt;
  let bytes2;
  if (options.transferId !== void 0) {
    const found2 = state.transfers.find((item) => item.transferId === uuid3(options.transferId));
    if (!found2 || digest(found2.ledgerIds) !== digest(ledgerIds) || !samePhysicalPath(found2.output, output2))
      throw new InputError("Retry requires the exact owned transfer ID, selection and output path.");
    receipt = found2;
    bytes2 = encodeTransferBundle(reconstruct(state, receipt));
    if (byteDigest(bytes2) !== receipt.bundleDigest)
      throw new InputError("Retry bundle bytes differ from frozen receipt.");
  } else {
    if (await inspectPath(output2))
      throw new InputError("Transfer output is occupied; explicit owned transfer retry is required.");
    if (ledgerIds.some((id2) => state.ledgers.find((item) => item.ledgerId === id2)?.ownership.kind !== "local"))
      throw new InputError("Export requires local ownership or an explicit owned transfer retry.");
    const preparationIds = state.preparations.filter((item) => ledgerIds.includes(item.ledgerId)).map((item) => item.preparationId).sort(ordinal);
    const payload = transferPayload(state, { ledgerIds, preparationIds });
    receipt = {
      transferId: randomUUID4(),
      phase: "exporting",
      sourceContextId: state.contextId,
      locator: structuredClone(state.locator),
      ledgerIds,
      preparationIds,
      current: state.current && ledgerIds.includes(state.current.ledgerId) ? structuredClone(state.current) : null,
      payloadDigest: digest(payload),
      bundleDigest: "",
      output: output2
    };
    bytes2 = encodeTransferBundle({
      schemaVersion: 1,
      artifact: "ledger-transfer",
      transferId: receipt.transferId,
      sourceContextId: receipt.sourceContextId,
      locator: receipt.locator,
      current: receipt.current,
      ...payload,
      payloadDigest: receipt.payloadDigest
    });
    receipt.bundleDigest = byteDigest(bytes2);
    state = await transactState(context, expectedStateVersion, (draft) => {
      if (digest(transferPayload(draft, receipt)) !== receipt.payloadDigest)
        throw new InputError("Selected export payload changed before freeze.");
      draft.transfers.push(structuredClone(receipt));
      for (const ledger of draft.ledgers)
        if (ledgerIds.includes(ledger.ledgerId) && ["open", "prepared"].includes(ledger.state))
          ledger.ownership = { kind: "exporting", transferId: receipt.transferId };
      if (draft.current && ledgerIds.includes(draft.current.ledgerId)) draft.current.paused = true;
    });
  }
  await io.afterFreeze?.();
  await externalOutput(context, output2);
  if (await inspectPath(output2)) {
    const published2 = await readBundle(output2);
    if (published2.bundle.transferId !== receipt.transferId || published2.bundleDigest !== receipt.bundleDigest || !published2.bytes.equals(bytes2))
      throw new InputError("Occupied transfer output does not match the exact owned retry bytes.");
  } else {
    await writeNewMessage(output2, bytes2, context.locator, [context.stateFile]);
  }
  const published = await readBundle(output2);
  if (published.bundleDigest !== receipt.bundleDigest || !published.bytes.equals(bytes2))
    throw new InputError("Published transfer bundle readback differs from frozen bytes.");
  await io.afterPublish?.();
  state = await readState(context);
  const found = state.transfers.find((item) => item.transferId === receipt.transferId);
  if (!found || digest({ ...found, phase: receipt.phase }) !== digest(receipt))
    throw new InputError("Frozen transfer receipt changed before final publication mark.");
  if (found.phase !== "exported") {
    state = await transactState(context, state.stateVersion, (draft) => {
      const current = draft.transfers.find((item) => item.transferId === receipt.transferId);
      if (!current || digest(transferPayload(draft, current)) !== current.payloadDigest)
        throw new InputError("Frozen transfer payload changed before final publication mark.");
      current.phase = "exported";
      for (const ledger of draft.ledgers)
        if (ledger.ownership.kind === "exporting" && ledger.ownership.transferId === receipt.transferId)
          ledger.ownership = { kind: "exported", transferId: receipt.transferId };
    });
  }
  return {
    stateVersion: state.stateVersion,
    transferId: receipt.transferId,
    bundleDigest: receipt.bundleDigest,
    path: output2
  };
}
async function importLedgers(context, expectedStateVersion, options) {
  if (options.mode !== "resume" && options.mode !== "copy")
    throw new InputError("Import mode must be resume or copy.");
  if (options.mode === "resume" && options.singleAuthority !== true)
    throw new InputError("Resume import requires an explicit single-authority declaration.");
  const { bundle, bundleDigest } = await readBundle(options.input);
  const state = await readState(context);
  if (state.stateVersion !== integer(expectedStateVersion)) throw new InputError("Ledger state version is stale.");
  const existing = state.imports.find((item) => item.transferId === bundle.transferId);
  if (existing) {
    if (existing.bundleDigest !== bundleDigest || existing.mode !== options.mode)
      throw new InputError("Transfer ID conflicts with existing import digest/mode.");
    return {
      stateVersion: state.stateVersion,
      transferId: bundle.transferId,
      bundleDigest,
      ledgerIds: existing.mapping.map((pair) => pair.targetId),
      idempotent: true
    };
  }
  if (bundle.sourceContextId === state.contextId)
    throw new InputError("Import target must have a distinct context ID.");
  const mapping = bundle.ledgers.map((ledger) => ({
    sourceId: ledger.ledgerId,
    targetId: options.mode === "resume" ? ledger.ledgerId : randomUUID4()
  }));
  const targetId = (id2) => {
    const pair = mapping.find((item) => item.sourceId === id2);
    if (!pair) throw new InputError("Imported link target missing.");
    return pair.targetId;
  };
  const ledgers = bundle.ledgers.map((source) => {
    const ledger = portableLedger(source);
    ledger.contextId = state.contextId;
    if (options.mode === "copy") {
      ledger.ledgerId = targetId(source.ledgerId);
      ledger.revision = 1;
      ledger.state = "open";
      ledger.currentPreparationId = null;
      delete ledger.sealedResult;
      ledger.predecessorIds = [];
      ledger.successorIds = [];
      const { origin: priorOrigin, ...originalSnapshot } = portableLedger(source);
      ledger.origin = {
        transferId: bundle.transferId,
        sourceContextId: bundle.sourceContextId,
        ledgerId: source.ledgerId,
        revision: source.revision,
        preparations: structuredClone(bundle.preparations.filter((item) => item.ledgerId === source.ledgerId)),
        source: originalSnapshot,
        history: priorOrigin ? [
          {
            transferId: priorOrigin.transferId,
            sourceContextId: priorOrigin.sourceContextId,
            ledgerId: priorOrigin.ledgerId,
            revision: priorOrigin.revision,
            preparations: priorOrigin.preparations,
            source: priorOrigin.source
          },
          ...priorOrigin.history
        ] : []
      };
    }
    return ledger;
  });
  const receipt = {
    transferId: bundle.transferId,
    bundleDigest,
    sourceContextId: bundle.sourceContextId,
    mode: options.mode,
    mapping,
    preparationIds: options.mode === "resume" ? bundle.preparations.map((item) => item.preparationId) : []
  };
  const imported = await importState(
    context,
    expectedStateVersion,
    receipt,
    ledgers,
    options.mode === "resume" ? bundle.preparations : [],
    bundle.current ? { ledgerId: targetId(bundle.current.ledgerId), paused: true } : null
  );
  return {
    stateVersion: imported.stateVersion,
    transferId: bundle.transferId,
    bundleDigest,
    ledgerIds: mapping.map((pair) => pair.targetId),
    idempotent: false
  };
}
async function pruneLedgers(context, expectedStateVersion, options) {
  return pruneState(context, expectedStateVersion, options.ledgerIds.map(uuid3));
}
async function checkRemoval(context) {
  const state = await readState(context);
  const details = [];
  const evidence = /* @__PURE__ */ new Map();
  for (const receipt of state.transfers.filter((item) => item.phase === "exported")) {
    try {
      await externalOutput(context, receipt.output);
      const observed = await readBundle(receipt.output);
      if (observed.bundleDigest !== receipt.bundleDigest || observed.bundle.transferId !== receipt.transferId || observed.bundle.payloadDigest !== receipt.payloadDigest)
        throw new InputError("Export bytes/identity no longer match confirmed receipt.");
      evidence.set(receipt.transferId, observed.bundle);
    } catch (error) {
      evidence.set(receipt.transferId, error instanceof Error ? error : new Error("External export unreadable."));
    }
  }
  for (const ledger of state.ledgers.filter((item) => ["open", "prepared"].includes(item.state))) {
    let covered;
    let reason = "No confirmed successful external export covers the current complete payload.";
    for (const receipt of state.transfers.filter(
      (item) => item.phase === "exported" && item.ledgerIds.includes(ledger.ledgerId)
    )) {
      const bundle = evidence.get(receipt.transferId);
      if (bundle instanceof Error) {
        reason = bundle.message;
        continue;
      }
      const snapshot = bundle?.ledgers.find((item) => item.ledgerId === ledger.ledgerId);
      const history = state.preparations.filter((item) => item.ledgerId === ledger.ledgerId).sort((a, b) => ordinal(a.preparationId, b.preparationId));
      const exportedHistory = bundle?.preparations.filter((item) => item.ledgerId === ledger.ledgerId).sort((a, b) => ordinal(a.preparationId, b.preparationId));
      if (snapshot && digest(snapshot) === digest(portableLedger(ledger)) && digest(history) === digest(exportedHistory)) {
        covered = receipt.transferId;
        break;
      }
    }
    details.push({
      ledgerId: ledger.ledgerId,
      covered: covered !== void 0,
      reason: covered ? "Current complete payload is covered by a verified external export." : reason,
      ...covered ? { transferId: covered } : {}
    });
  }
  const safe = details.every((item) => item.covered);
  return { stateVersion: state.stateVersion, safe, details, exitCode: safe ? 0 : 1 };
}
var BUNDLE_BYTES;
var init_ledger_transfer = __esm({
  "src/ledger-transfer.ts"() {
    "use strict";
    init_file_evidence();
    init_ledger_contract();
    init_ledger_store();
    init_message_output();
    init_records();
    init_runtime_support();
    init_safe_git();
    BUNDLE_BYTES = STATE_BYTES;
  }
});

// src/ledger-cli.ts
var ledger_cli_exports = {};
__export(ledger_cli_exports, {
  parseLedgerArguments: () => parseLedgerArguments,
  runLedger: () => runLedger
});
import { fileURLToPath as fileURLToPath2 } from "node:url";
function parseLedgerArguments(args) {
  const command = args[0] ?? "";
  if (!Object.hasOwn(commandFlags, command)) throw new InputError("Unknown ledger command.");
  const mutation = !["init", "status", "check-removal"].includes(command);
  const allowed = ["--worktree", ...mutation ? ["--expect-version"] : [], ...commandFlags[command] ?? []];
  const options = /* @__PURE__ */ new Map();
  for (let index = 1; index < args.length; index++) {
    const flag = args[index] ?? "";
    if (!allowed.includes(flag) || options.has(flag)) throw new InputError("Unknown or duplicate ledger flag.");
    if (switches.includes(flag)) options.set(flag, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new InputError("Ledger flag is missing its value.");
      checkRaw(value);
      options.set(flag, value);
    }
  }
  if (mutation) {
    const version2 = options.get("--expect-version");
    if (typeof version2 !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(version2))
      throw new InputError("Ledger mutation requires --expect-version <nonnegative integer>.");
    integer(Number(version2));
  }
  return { command, options };
}
async function json2(file) {
  const bytes2 = await readRegularFile(typeof file === "string" ? file : fileURLToPath2(file), {
    physicalPath: true,
    singleLink: true,
    maximumBytes: INPUT_BYTES
  });
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes2));
  } catch {
    throw new InputError("Ledger input must be strict UTF-8 JSON.");
  }
}
function output(value) {
  checkRaw(value);
  const data = object2(value, ["ledgerId", "identities", "blockers", "note", "work"]);
  return {
    ledgerId: uuid3(data.ledgerId),
    identities: array(data.identities, parseIdentity),
    blockers: array(data.blockers, parseBlocker),
    ...data.note === void 0 ? {} : { note: text(data.note) },
    ...data.work === void 0 ? {} : { work: text(data.work) }
  };
}
async function runLedger(args, loadRegistry = async () => parseRegistry(await json2(new URL("../references/agent-registry.json", import.meta.url)))) {
  const { command, options } = parseLedgerArguments(args);
  const value = (flag) => {
    const found = options.get(flag);
    if (typeof found !== "string") throw new InputError(`Ledger command requires ${flag}.`);
    return found;
  };
  const context = await resolveLedgerContext(
    typeof options.get("--worktree") === "string" ? value("--worktree") : process.cwd()
  );
  if (command === "init") return initializeState(context);
  if (command === "status") return readState(context);
  if (command === "check-removal") return checkRemoval(context);
  const version2 = Number(value("--expect-version"));
  if (command === "rebind")
    return rebindState(context, version2, {
      contextId: uuid3(value("--context-id")),
      movedOriginal: options.has("--moved-original")
    });
  if (command === "import") {
    const mode = value("--mode");
    if (mode !== "resume" && mode !== "copy") throw new InputError("Import mode must be resume or copy.");
    return importLedgers(context, version2, {
      input: value("--input"),
      mode,
      singleAuthority: options.has("--single-authority")
    });
  }
  if (command === "export" || command === "prune") {
    const selection = object2(await json2(value("--input")), ["ledgerIds"]);
    const ledgerIds = array(selection.ledgerIds, uuid3);
    if (command === "prune") return pruneLedgers(context, version2, { ledgerIds });
    return exportLedgers(context, version2, {
      ledgerIds,
      output: value("--output"),
      ...options.has("--transfer-id") ? { transferId: uuid3(value("--transfer-id")) } : {}
    });
  }
  let transform;
  if (command === "create") {
    const ledgerId = options.has("--ledger") ? uuid3(value("--ledger")) : void 0;
    transform = (draft) => {
      createLedger(draft, {
        ...ledgerId === void 0 ? {} : { ledgerId },
        select: options.has("--select"),
        ...options.has("--note") ? { note: value("--note") } : {},
        ...options.has("--work") ? { work: value("--work") } : {}
      });
    };
  } else if (command === "split" || command === "combine") {
    const data = object2(await json2(value("--input")), ["sourceIds", "outputs"]);
    const sourceIds = array(data.sourceIds, uuid3);
    const outputs = array(data.outputs, output);
    if (command === "split" ? sourceIds.length !== 1 || outputs.length < 2 : sourceIds.length < 2 || outputs.length !== 1)
      throw new InputError(
        "Split requires one source and at least two outputs; combine requires at least two sources and one output."
      );
    const registry = await loadRegistry();
    transform = (draft) => {
      replaceLedgers(draft, sourceIds, outputs, registry);
    };
  } else {
    const ledgerId = uuid3(value("--ledger"));
    if (command === "add" || command === "remove") {
      const data = object2(await json2(value("--input")), ["identities"]);
      const identities = array(data.identities, parseIdentity);
      const registry = await loadRegistry();
      transform = (draft) => {
        (command === "add" ? addIdentities : removeIdentities)(draft, ledgerId, identities, registry);
      };
    } else if (command === "block") {
      const blocker = parseBlocker(await json2(value("--input")));
      transform = (draft) => {
        blockLedger(draft, ledgerId, blocker);
      };
    } else if (command === "unblock") {
      const blockerId = value("--blocker");
      transform = (draft) => {
        unblockLedger(draft, ledgerId, blockerId);
      };
    } else if (command === "reopen") {
      transform = (draft) => {
        reopenLedger(draft, ledgerId, { reviewedNoResult: options.has("--reviewed-no-result") });
      };
    } else {
      const action = { select: selectLedger, pause: pauseLedger, resume: resumeLedger, abandon: abandonLedger }[command];
      if (!action) throw new InputError("Unsupported ledger mutation.");
      transform = (draft) => {
        action(draft, ledgerId);
      };
    }
  }
  return transactState(context, version2, transform);
}
var commandFlags, switches;
var init_ledger_cli = __esm({
  "src/ledger-cli.ts"() {
    "use strict";
    init_file_evidence();
    init_input_contract();
    init_ledger();
    init_ledger_contract();
    init_ledger_store();
    init_ledger_transfer();
    init_records();
    commandFlags = {
      init: [],
      status: [],
      create: ["--ledger", "--select", "--note", "--work"],
      select: ["--ledger"],
      add: ["--ledger", "--input"],
      remove: ["--ledger", "--input"],
      block: ["--ledger", "--input"],
      unblock: ["--ledger", "--blocker"],
      pause: ["--ledger"],
      resume: ["--ledger"],
      reopen: ["--ledger", "--reviewed-no-result"],
      abandon: ["--ledger"],
      split: ["--input"],
      combine: ["--input"],
      export: ["--input", "--output", "--transfer-id"],
      import: ["--input", "--mode", "--single-authority"],
      rebind: ["--context-id", "--moved-original"],
      "check-removal": [],
      prune: ["--input"]
    };
    switches = ["--select", "--reviewed-no-result", "--single-authority", "--moved-original"];
  }
});

// src/attribution.ts
import { fileURLToPath as fileURLToPath3 } from "node:url";

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
function ledgerSource(options, required) {
  const supplied = ["--input", "--ledger", "--current"].filter((flag2) => options.has(flag2));
  if (supplied.length > 1 || required && supplied.length !== 1)
    throw new InputError("Supply exactly one explicit input, ledger ID or current worktree selector.");
  const flag = supplied[0];
  return flag ? { [flag.slice(2)]: options.get(flag) } : {};
}
function parseArguments(args) {
  const values = [...args];
  if (values.shift() !== "summarize")
    throw new InputError(
      "Usage: attribution.mjs summarize (--input <json> | --ledger <UUID> | --current <worktree>) --operation <json>"
    );
  const options = /* @__PURE__ */ new Map();
  while (values.length) {
    const flag = values.shift();
    const value = values.shift();
    if (!flag || !["--input", "--ledger", "--current", "--operation"].includes(flag) || options.has(flag) || !value || value.startsWith("--"))
      throw new InputError("Invalid input: unknown/duplicate flag or missing value.");
    checkRaw(value);
    options.set(flag, value);
  }
  const operation = options.get("--operation");
  if (!operation) throw new InputError("Invalid input: a current operation file is required.");
  return { ...ledgerSource(options, true), operation };
}
async function jsonFile(file) {
  let bytes2;
  try {
    bytes2 = await readRegularFile(typeof file === "string" ? file : fileURLToPath3(file), {
      physicalPath: true,
      maximumBytes: INPUT_BYTES
    });
  } catch {
    throw new InputError("Invalid input: cannot safely read the explicit JSON resource.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes2));
  } catch {
    throw new InputError("Invalid input: malformed UTF-8 JSON resource.");
  }
}
async function loadLedger(source, operationValue, consumed) {
  if (source.input) {
    consumed.push(source.input);
    return jsonFile(source.input);
  }
  if (!source.ledger && !source.current)
    throw new InputError(
      "Current skill-default message requires an explicit input, ledger ID or current worktree."
    );
  const operation = await parseOperation(operationValue);
  const { resolveLedgerContext: resolveLedgerContext2, readState: readState2 } = await Promise.resolve().then(() => (init_ledger_store(), ledger_store_exports));
  const { selectedLedgerSnapshot: selectedLedgerSnapshot2 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const context = await resolveLedgerContext2(source.current ?? operation.worktree);
  const state = await readState2(context);
  consumed.push(context.stateFile);
  return selectedLedgerSnapshot2(state, operation, source.ledger, source.current !== void 0);
}
async function run(args) {
  if (args[0] === "policy" || args.includes("--context")) throw new InputError(DECISION_MIGRATION);
  if (args[0] === "prepare" || args[0] === "finish") {
    const { runPreparation: runPreparation2 } = await Promise.resolve().then(() => (init_ledger_preparation_cli(), ledger_preparation_cli_exports));
    return runPreparation2(args, async (consumedPaths) => {
      const registryFile = new URL("../references/agent-registry.json", import.meta.url);
      consumedPaths.push(fileURLToPath3(registryFile));
      return parseRegistry(await jsonFile(registryFile));
    });
  }
  if (args[0] === "ledger") {
    const { runLedger: runLedger2 } = await Promise.resolve().then(() => (init_ledger_cli(), ledger_cli_exports));
    return { exitCode: 0, ...await runLedger2(args.slice(1)) };
  }
  if (args[0] === "render" || args[0] === "validate") {
    const mode = args[0];
    const options2 = /* @__PURE__ */ new Map();
    for (let index = 1; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1];
      if (!flag || ![
        "--message",
        "--operation",
        "--decision",
        "--input",
        "--ledger",
        "--current",
        "--assessment",
        "--output"
      ].includes(flag) || options2.has(flag) || !value || value.startsWith("--") || mode === "validate" && flag === "--output")
        throw new InputError("Invalid message flag, duplicate or missing value.");
      checkRaw(value);
      options2.set(flag, value);
    }
    const messageFile = options2.get("--message"), operationFile = options2.get("--operation"), decisionFile = options2.get("--decision");
    if (!messageFile || !operationFile || !decisionFile)
      throw new InputError(
        "Message commands require explicit message, operation and schemaVersion 2 AI decision files."
      );
    const source = ledgerSource(options2, false);
    const operation2 = await jsonFile(operationFile), decision = await jsonFile(decisionFile);
    const message = await readRegularFile(messageFile, { physicalPath: true, maximumBytes: INPUT_BYTES });
    const consumedPaths = [messageFile, operationFile, decisionFile];
    const { processMessage: processMessage2 } = await Promise.resolve().then(() => (init_message(), message_exports));
    const output2 = options2.get("--output");
    return processMessage2(
      { mode, message, operation: operation2, decision, consumedPaths, ...output2 ? { output: output2 } : {} },
      async () => {
        const registryFile = new URL("../references/agent-registry.json", import.meta.url);
        const assessment = options2.get("--assessment");
        consumedPaths.push(fileURLToPath3(registryFile), ...assessment ? [assessment] : []);
        return {
          ledger: await loadLedger(source, operation2, consumedPaths),
          registry: await jsonFile(registryFile),
          ...assessment ? { assessment: await jsonFile(assessment) } : {}
        };
      }
    );
  }
  const options = parseArguments(args);
  const operation = await jsonFile(options.operation);
  const [ledger, registry] = await Promise.all([
    loadLedger(options, operation, []),
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
