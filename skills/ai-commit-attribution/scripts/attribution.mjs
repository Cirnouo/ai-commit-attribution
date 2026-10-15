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
  const unchanged3 = final && same2(initial, final.info);
  if (!final || final.locator !== absolute || !unchanged3)
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

// src/ledger-contract.ts
import path5 from "node:path";
function object2(value, keys) {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw new InputError("Invalid ledger state: unexpected object shape.");
  return value;
}
function uuid(value) {
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
    "work"
  ]);
  if (!["open", "prepared", "sealed", "abandoned"].includes(String(data.state)))
    throw new InputError("Invalid ledger state: lifecycle.");
  const owner = object2(data.ownership, ["kind", "transferId"]);
  let ownership;
  if (owner.kind === "local" && owner.transferId === void 0) ownership = { kind: "local" };
  else if (owner.kind === "exporting" || owner.kind === "exported")
    ownership = { kind: owner.kind, transferId: uuid(owner.transferId) };
  else throw new InputError("Invalid ledger state: ownership.");
  const identities = array(data.identities, parseIdentity);
  distinct(identities.map(identityKey));
  const blockers = array(data.blockers, parseBlocker);
  distinct(blockers.map((item) => item.id));
  const predecessorIds = array(data.predecessorIds, uuid);
  const successorIds = array(data.successorIds, uuid);
  distinct(predecessorIds);
  distinct(successorIds);
  return {
    ledgerId: uuid(data.ledgerId),
    contextId: uuid(data.contextId),
    revision: integer(data.revision, 1),
    state: data.state,
    ownership,
    identities,
    blockers,
    currentPreparationId: data.currentPreparationId === null ? null : uuid(data.currentPreparationId),
    predecessorIds,
    successorIds,
    ...data.note === void 0 ? {} : { note: text(data.note) },
    ...data.work === void 0 ? {} : { work: text(data.work) }
  };
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
  const contextId = uuid(data.contextId);
  const ledgers = array(data.ledgers, parsePlannedLedger);
  distinct(ledgers.map((item) => item.ledgerId));
  const byId = new Map(ledgers.map((item) => [item.ledgerId, item]));
  for (const ledger of ledgers) {
    if (ledger.contextId !== contextId) throw new InputError("Invalid ledger state: ledger/context mismatch.");
    if (ledger.currentPreparationId !== null || ledger.state === "prepared")
      throw new InputError("Invalid ledger state: preparation receipts are not yet supported.");
    if (ledger.ownership.kind !== "local")
      throw new InputError("Invalid ledger state: transfer receipts are not yet supported.");
    for (const id of ledger.predecessorIds) {
      const source = byId.get(id);
      if (id === ledger.ledgerId || !source?.successorIds.includes(ledger.ledgerId))
        throw new InputError("Invalid ledger state: predecessor reference.");
    }
    for (const id of ledger.successorIds) {
      const target = byId.get(id);
      if (id === ledger.ledgerId || !target?.predecessorIds.includes(ledger.ledgerId) || ledger.state !== "abandoned")
        throw new InputError("Invalid ledger state: successor reference.");
    }
  }
  let current = null;
  if (data.current !== null) {
    const selected = object2(data.current, ["ledgerId", "paused"]);
    const ledgerId = uuid(selected.ledgerId);
    if (typeof selected.paused !== "boolean" || !byId.has(ledgerId) || !["open", "prepared"].includes(byId.get(ledgerId)?.state ?? ""))
      throw new InputError("Invalid ledger state: current reference/lifecycle.");
    current = { ledgerId, paused: selected.paused };
  }
  for (const key of ["preparations", "transfers", "imports"]) {
    if (!Array.isArray(data[key]) || data[key].length !== 0)
      throw new InputError("Invalid ledger state: reserved receipts must be empty.");
  }
  return {
    schemaVersion: 1,
    contextId,
    locator: parseLocator(data.locator),
    stateVersion: integer(data.stateVersion),
    current,
    ledgers,
    preparations: [],
    transfers: [],
    imports: []
  };
}
function encodeState(state) {
  const bytes = Buffer.from(`${JSON.stringify(parseWorktreeState(state), null, 4)}
`);
  if (bytes.length > STATE_BYTES) throw new InputError("Ledger state byte budget exceeded.");
  return bytes;
}
function ledgerContent(ledger) {
  return {
    identities: ledger.identities,
    blockers: ledger.blockers,
    state: ledger.state,
    predecessorIds: ledger.predecessorIds,
    successorIds: ledger.successorIds
  };
}
function validateStateTransition(before, after) {
  for (const old of before.ledgers) {
    const next = after.ledgers.find((item) => item.ledgerId === old.ledgerId);
    if (!next) throw new InputError("Ledger records cannot be silently deleted.");
    if (old.state === "sealed" && digest(old) !== digest(next))
      throw new InputError("Sealed ledger content is immutable.");
    const changed = digest(ledgerContent(old)) !== digest(ledgerContent(next));
    if (next.revision !== (changed ? integer(old.revision + 1, 1) : old.revision))
      throw new InputError("Ledger content revision does not match the declared mutation.");
    if (old.ownership.kind !== "local" && changed) throw new InputError("Nonlocal ledger content is frozen.");
  }
  for (const next of after.ledgers) {
    if (!before.ledgers.some((item) => item.ledgerId === next.ledgerId) && next.revision !== 1)
      throw new InputError("New ledger revision must be 1.");
  }
}
var STATE_BYTES, sortBlockers;
var init_ledger_contract = __esm({
  "src/ledger-contract.ts"() {
    "use strict";
    init_errors();
    init_records();
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
  initializeState: () => initializeState,
  readState: () => readState,
  resolveLedgerContext: () => resolveLedgerContext,
  transactState: () => transactState
});
import { randomUUID } from "node:crypto";
import { constants as constants2 } from "node:fs";
import { lstat as lstat4, mkdir, open as open2, readdir, rename, unlink } from "node:fs/promises";
import path6 from "node:path";
import { setTimeout as delay } from "node:timers/promises";
async function completeWrite(handle, bytes, io) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = io.write ? await io.write(handle, bytes, offset) : (await handle.write(bytes, offset, bytes.length - offset, offset)).bytesWritten;
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset)
      throw new InputError("State write made no valid progress; candidate preserved.");
    offset += count;
  }
}
async function regular(file, maximumBytes) {
  await inspectPath(file);
  const info = await lstat4(file, { bigint: true });
  const bytes = await readRegularFile(file, { physicalPath: true, singleLink: true, maximumBytes });
  if (!unchanged2(info, await lstat4(file, { bigint: true })))
    throw new InputError("State file identity changed during reading.");
  return { bytes, info };
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
async function stateEvidence(context) {
  await checkDirectory(context);
  const observed = await regular(context.stateFile, STATE_BYTES);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observed.bytes));
  } catch {
    throw new InputError("Ledger state is malformed UTF-8 JSON.");
  }
  const state = parseWorktreeState(value);
  if (!sameLocator(state.locator, context.locator))
    throw new InputError(
      "Stored locator/context does not match this physical worktree; explicit rebind is required."
    );
  return { ...observed, state };
}
async function publish(file, bytes, previous, guard, io = {}) {
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
    await completeWrite(handle, bytes, io);
    await handle.sync();
    const completed = await regular(candidate, bytes.length);
    if (!same(owned, completed.info) || !completed.bytes.equals(bytes) || !unchanged2(completed.info, await handle.stat({ bigint: true })))
      throw new InputError("Candidate bytes/identity changed during publication.");
    await guard();
    const current = await optionalRegular(file, Math.max(STATE_BYTES, bytes.length));
    if (previous ? !current || !unchanged2(previous.info, current.info) || !previous.bytes.equals(current.bytes) : current !== void 0)
      throw new InputError("Original file changed before atomic publication.");
    if (!same(parentInfo, await lstat4(parent, { bigint: true })))
      throw new InputError("Publication parent was replaced.");
    await physicalDirectory(parent);
    await handle.close();
    await (io.rename ?? rename)(candidate, file);
    const final = await regular(file, bytes.length);
    if (!same(completed.info, final.info) || !final.bytes.equals(bytes))
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
  const bytes = previous?.bytes ?? Buffer.alloc(0);
  const fixed = "/.ai-commit-attribution/";
  if (bytes.toString("utf8").split(/\r?\n/).includes(fixed)) return;
  const newline = bytes.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
  const suffix = `${bytes.length && bytes.at(-1) !== 10 ? newline : ""}${fixed}${newline}`;
  await publish(context.excludeFile, Buffer.concat([bytes, Buffer.from(suffix)]), previous, guard);
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
  integer(expectedStateVersion);
  const context = await actualContext(contextValue);
  const git = await checkTracked(context);
  await checkIgnore(git);
  const before = await stateEvidence(context);
  if (before.state.stateVersion !== expectedStateVersion) throw new InputError("Ledger state version is stale.");
  return withLock(path6.join(context.stateDirectory, "state.lock"), async (guard) => {
    const locked = await stateEvidence(context);
    if (locked.state.stateVersion !== expectedStateVersion || !unchanged2(before.info, locked.info) || !before.bytes.equals(locked.bytes))
      throw new InputError("Ledger state changed while obtaining lock.");
    const draft = structuredClone(locked.state);
    const returned = transform(draft);
    if (returned !== void 0) throw new InputError("State transform must be synchronous and return no value.");
    if (draft.stateVersion !== expectedStateVersion || draft.contextId !== locked.state.contextId || !sameLocator(draft.locator, locked.state.locator))
      throw new InputError("Transform may not change state version or context locator.");
    draft.stateVersion = integer(expectedStateVersion + 1);
    validateStateTransition(locked.state, draft);
    const bytes = encodeState(draft);
    await publish(context.stateFile, bytes, locked, guard, io);
    return (await stateEvidence(context)).state;
  });
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
function find(state, id) {
  const ledger = state.ledgers.find((item) => item.ledgerId === uuid(id));
  if (!ledger) throw new InputError("Ledger ID does not exist in this context.");
  return ledger;
}
function local(ledger) {
  if (ledger.ownership.kind !== "local") throw new InputError("Ledger ownership must be local.");
}
function active(state, id) {
  if (!state.current || state.current.ledgerId !== id || state.current.paused)
    throw new InputError("Mutation requires the exact active current ledger selection.");
}
function open3(state, id) {
  const ledger = find(state, id);
  local(ledger);
  active(state, id);
  if (ledger.state !== "open") throw new InputError("Recording requires an open ledger.");
  return ledger;
}
function reviseLedger(ledger) {
  ledger.revision = integer(ledger.revision + 1, 1);
}
function createLedger(state, options = {}) {
  checkRaw(options);
  const ledgerId = uuid(options.ledgerId ?? randomUUID2());
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
function selectLedger(state, id) {
  const ledger = find(state, id);
  local(ledger);
  if (!["open", "prepared"].includes(ledger.state))
    throw new InputError("Selection requires open or prepared ledger.");
  state.current = { ledgerId: ledger.ledgerId, paused: false };
}
function addIdentities(state, id, identities, registry) {
  const ledger = open3(state, id);
  const next = normalizeIdentities([...ledger.identities, ...identities], registry);
  if (JSON.stringify(next) !== JSON.stringify(ledger.identities)) {
    reviseLedger(ledger);
    ledger.identities = next;
  }
}
function removeIdentities(state, id, identities, registry) {
  const ledger = open3(state, id);
  const keys = new Set(normalizeIdentities(identities, registry).map(identityKey));
  const next = ledger.identities.filter((item) => !keys.has(identityKey(item)));
  if (next.length !== ledger.identities.length) {
    reviseLedger(ledger);
    ledger.identities = next;
  }
}
function blockLedger(state, id, value) {
  const ledger = open3(state, id);
  const blocker = parseBlocker(value);
  if (ledger.blockers.some((item) => item.id === blocker.id))
    throw new InputError("Blocker ID already exists; explicitly unblock first.");
  reviseLedger(ledger);
  ledger.blockers = sortBlockers([...ledger.blockers, blocker]);
}
function unblockLedger(state, id, blockerId) {
  checkRaw(blockerId);
  const ledger = open3(state, id);
  if (!ledger.blockers.some((item) => item.id === blockerId)) throw new InputError("Blocker ID does not exist.");
  reviseLedger(ledger);
  ledger.blockers = ledger.blockers.filter((item) => item.id !== blockerId);
}
function pauseLedger(state, id) {
  const ledger = find(state, id);
  local(ledger);
  active(state, id);
  state.current = { ledgerId: id, paused: true };
}
function resumeLedger(state, id) {
  if (!state.current || state.current.ledgerId !== id || !state.current.paused)
    throw new InputError("Resume requires the exact paused current selection.");
  const ledger = find(state, id);
  local(ledger);
  if (!["open", "prepared"].includes(ledger.state)) throw new InputError("Resume requires an unfinished ledger.");
  state.current = { ledgerId: id, paused: false };
}
function reopenLedger(state, id, declaration) {
  const ledger = find(state, id);
  local(ledger);
  if (!["prepared", "abandoned"].includes(ledger.state))
    throw new InputError("Only prepared or abandoned ledgers can reopen; sealed ledgers are immutable.");
  if (ledger.successorIds.length) throw new InputError("A replaced ledger cannot reopen while it has successors.");
  if (ledger.state === "prepared" && declaration.reviewedNoResult !== true)
    throw new InputError("Prepared reopen requires an explicit reviewed-no-result declaration.");
  reviseLedger(ledger);
  ledger.state = "open";
  ledger.currentPreparationId = null;
}
function abandonLedger(state, id) {
  const ledger = find(state, id);
  local(ledger);
  if (ledger.state === "sealed") throw new InputError("Sealed ledgers are immutable.");
  if (ledger.state !== "abandoned") {
    reviseLedger(ledger);
    ledger.state = "abandoned";
    ledger.currentPreparationId = null;
  }
  if (state.current?.ledgerId === id) state.current = null;
}
function replaceLedgers(state, sourceIds, outputs, registry) {
  if (!sourceIds.length || !outputs.length || sourceIds.length !== 1 && outputs.length !== 1)
    throw new InputError("Split/combine requires one source or one output.");
  if (new Set(sourceIds).size !== sourceIds.length || new Set(outputs.map((item) => item.ledgerId)).size !== outputs.length)
    throw new InputError("Duplicate split/combine IDs.");
  const sources = sourceIds.map((id) => {
    const ledger = find(state, id);
    local(ledger);
    if (ledger.state !== "open") throw new InputError("Split/combine requires local open sources.");
    integer(ledger.revision + 1, 1);
    return ledger;
  });
  const planned = outputs.map((output2) => {
    checkRaw(output2);
    uuid(output2.ledgerId);
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
  const id = expectedLedgerId === void 0 ? useCurrent ? state.current?.ledgerId : void 0 : uuid(expectedLedgerId);
  if (!id) throw new InputError("Snapshot requires an explicit ledger ID or active current selection.");
  if (state.current && state.current.ledgerId !== id)
    throw new InputError("Expected ledger does not match current selection; explicitly select before proceeding.");
  const ledger = find(state, id);
  local(ledger);
  if (!["open", "prepared"].includes(ledger.state))
    throw new InputError("Snapshot requires an open or prepared ledger.");
  return {
    schemaVersion: 2,
    ledgerId: id,
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

// src/ledger-cli.ts
var ledger_cli_exports = {};
__export(ledger_cli_exports, {
  parseLedgerArguments: () => parseLedgerArguments,
  runLedger: () => runLedger
});
import { fileURLToPath } from "node:url";
function parseLedgerArguments(args) {
  const command = args[0] ?? "";
  if (!Object.hasOwn(commandFlags, command)) throw new InputError("Unknown ledger command.");
  const mutation = command !== "init" && command !== "status";
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
async function json(file) {
  const bytes = await readRegularFile(typeof file === "string" ? file : fileURLToPath(file), {
    physicalPath: true,
    singleLink: true,
    maximumBytes: INPUT_BYTES
  });
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InputError("Ledger input must be strict UTF-8 JSON.");
  }
}
function output(value) {
  checkRaw(value);
  const data = object2(value, ["ledgerId", "identities", "blockers", "note", "work"]);
  return {
    ledgerId: uuid(data.ledgerId),
    identities: array(data.identities, parseIdentity),
    blockers: array(data.blockers, parseBlocker),
    ...data.note === void 0 ? {} : { note: text(data.note) },
    ...data.work === void 0 ? {} : { work: text(data.work) }
  };
}
async function runLedger(args, loadRegistry = async () => parseRegistry(await json(new URL("../references/agent-registry.json", import.meta.url)))) {
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
  const version2 = Number(value("--expect-version"));
  let transform;
  if (command === "create") {
    const ledgerId = options.has("--ledger") ? uuid(value("--ledger")) : void 0;
    transform = (draft) => {
      createLedger(draft, {
        ...ledgerId === void 0 ? {} : { ledgerId },
        select: options.has("--select"),
        ...options.has("--note") ? { note: value("--note") } : {},
        ...options.has("--work") ? { work: value("--work") } : {}
      });
    };
  } else if (command === "split" || command === "combine") {
    const data = object2(await json(value("--input")), ["sourceIds", "outputs"]);
    const sourceIds = array(data.sourceIds, uuid);
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
    const ledgerId = uuid(value("--ledger"));
    if (command === "add" || command === "remove") {
      const data = object2(await json(value("--input")), ["identities"]);
      const identities = array(data.identities, parseIdentity);
      const registry = await loadRegistry();
      transform = (draft) => {
        (command === "add" ? addIdentities : removeIdentities)(draft, ledgerId, identities, registry);
      };
    } else if (command === "block") {
      const blocker = parseBlocker(await json(value("--input")));
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
      combine: ["--input"]
    };
    switches = ["--select", "--reviewed-no-result"];
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
import { constants as constants3 } from "node:fs";
import { lstat as lstat5, open as open4, unlink as unlink2 } from "node:fs/promises";
import path7 from "node:path";
async function writeNewMessage(file, bytes, scope, consumed, signal) {
  const cancelled = () => {
    if (signal?.aborted) throw new Error("Output publication cancelled.");
  };
  cancelled();
  checkRaw(file);
  if (!file) throw new InputError("Explicit output path is empty.");
  const destination = path7.resolve(file);
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
  const unchanged3 = (a, b) => same2(a, b) && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
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
    await handle.writeFile(bytes);
    await handle.sync();
    cancelled();
    const after = await handle.stat({ bigint: true });
    if (!same2(owned, after) || after.nlink !== 1n || after.size !== BigInt(bytes.length) || !unchanged3(after, await lstat5(destination, { bigint: true })) || !same2(before, await lstat5(parent, { bigint: true })))
      throw new Error("Output identity or length changed during writing.");
    await physical(destination);
    if (!(await readRegularFile(destination, { physicalPath: true, singleLink: true, maximumBytes: bytes.length })).equals(bytes) || !unchanged3(after, await handle.stat({ bigint: true })) || !unchanged3(after, await lstat5(destination, { bigint: true })))
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
        if (current.isFile() && current.nlink === 1n && unchanged3(cleanupState, current) && same2(before, await lstat5(parent, { bigint: true }))) {
          const actual = await readRegularFile(destination, {
            physicalPath: true,
            singleLink: true,
            maximumBytes: bytes.length
          });
          const final = await lstat5(destination, { bigint: true });
          if (actual.equals(bytes) && unchanged3(cleanupState, final)) await unlink2(destination);
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
  if (path8.dirname(directory) !== parent || !path8.basename(directory).startsWith("attribution-trailer-"))
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
import { fileURLToPath as fileURLToPath2 } from "node:url";

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
  let bytes;
  try {
    bytes = await readRegularFile(typeof file === "string" ? file : fileURLToPath2(file), {
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
  if (args[0] === "ledger") {
    const { runLedger: runLedger2 } = await Promise.resolve().then(() => (init_ledger_cli(), ledger_cli_exports));
    return { ...await runLedger2(args.slice(1)), exitCode: 0 };
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
        consumedPaths.push(fileURLToPath2(registryFile), ...assessment ? [assessment] : []);
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
