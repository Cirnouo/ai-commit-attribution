# Policy scan and routing contract (schema 1)

Before preparing or editing a commit message, identify its actual operation and
read this contract. Repository AI disclosure policy applies exclusively. A rule
allowing/requiring AI Co-authored-by, forbidding disclosure, declaring disclosure
unnecessary or forbidding only one marker still owns that branch. Ordinary
Conventional Commits, language and length rules alone do not replace the default
AI disclosure rules. The scanner finds candidates; the Agent reads them and
makes the semantic applicability and precedence decision.

## Inputs and commands

Read the [record contract](records.md) before preparing Operation. Schema 1 now
also accepts kind merge, in addition to the five existing kinds. All existing
ledgers remain compatible. repository/worktree are the physical active worktree
top; commonGitDir is its physical shared Git metadata directory. Never infer a
primary checkout from a .git parent. Targets contain real resolved commit IDs;
use distinct roles such as head, source, base, onto or original. A squash needs
base and head/source roles. An amend/replay/merge/squash needs actual targets.

Supply ScopeContext JSON with exactly schemaVersion 1, phase (prepare or
edit-message), selection (index, specified-paths, all-tracked, operation-targets
or planned-paths), invocation and optional additionalCandidatePaths. Paths and
targets remain in Operation; do not duplicate them here. invocation has kind
(direct-git, wrapper-adapter or agent-context), a nonempty reference and physical
absolute effectiveDirectory. Optional repositoryPath, gitDirectory and worktreePath
are physical absolute locators, validated against observed Git. Optional adapter
names a supported wrapper contract. additionalCandidatePaths lists exact absolute
external/local evidence files the caller has adopted, never directories to crawl.
Absolute locators retain exact spelling, including filename whitespace. Path
records from Git lose only their record terminator, never filename whitespace.

```text
node <installed>/scripts/attribution.mjs policy scan --operation <operation.json> --context <context.json>
node <installed>/scripts/attribution.mjs policy scan --operation <operation.json> --context <context.json> --decision <decision.json>
```

The first command returns PolicyScan JSON. It does not choose a branch. The second
freshly recaptures scope/evidence and returns PolicyRouteCheck. A host integrates
the same boundary through checkFreshRouting before future default rendering or
validation, and repeats it after waiting, clarification or material changes.
Standalone summarize is declared evidence processing; it does not perform routing.

effectiveDirectory represents the actual effective Git -C directory. Explicit
Git directory/worktree locators are reconstructed after inherited routing is
cleared. The explicit-scope-v1 wrapper adapter accepts these already-derived
locators, selection and Operation targets/paths; the integrating Agent must
derive them from its actual supported wrapper inputs. An executable name, adapter
label or JSON reference cannot prove actual invocation. Other adapters and ambiguous
selection require a decision. No wrapper command is executed to discover intent.

## Observation and discovery

Capture binds physical worktree/per-worktree/shared Git identity, object format,
HEAD/ref resolution, full index and split-index bytes, selected/intended raw path
bytes/types and relevant known operation metadata. Target commit contents bind
parents; replay/merge/squash coverage includes target paths. Message-only amend
includes the replaced commit's affected paths even with a clean index. Merge
includes the source history not already in HEAD and actual staged resolution
paths, rather than only the source tip's last change. Directories expand
within limits, including unstaged/untracked/deleted/absent intended paths. A valid
symbolic unborn branch with absent ref/index is supported for a commit with empty
targets. Detached/corrupt/missing required objects require a decision without fetch.
edit-message merge/cherry-pick/rebase requires consistent active operation state.

Discovery reads exact ancestor/local AGENTS.md and CLAUDE.md for the actual
worktree and selected/intended paths, root README/CONTRIBUTING entry files, bounded
contribution/commit/policy documents under docs and workflow definitions, adopted
local Markdown links, effective message hooks and explicit commit template, and
exact additional candidates. Dependency/vendor/generated directories and unrelated
sibling instruction files are excluded. Missing expected locations are recorded;
missing adopted references and unsafe/unreadable known evidence are issues.
A cached expected absence becomes a missing-reference issue when later adopted
or explicitly supplied. Multiple applicable scope/reference uses remain bound.
Adopted repository directory navigation is discovered within the same limits;
external directory links require a decision and never authorize a descendant crawl.
Network links are reported unfetched and never retrieved. The Agent must resolve
known relevant external policy before selecting a branch; locator presence alone
does not establish policy applicability or complete evidence.

Git configuration bytes are hashed in full, while output exposes only policy
locator keys. Includes are inspected as exact bounded data; inline include
precedence, conditional includes and unsupported path expansion require a decision.
No home directory is enumerated. Symbolic links/reparse points and unsafe intermediate
links are rejected; hard-linked input may be read with descriptor/path identity
checks. Hook, template, workflow, configuration values and policy scripts are data.
Ordinary absence requires an initially missing target with all existing ancestor
components inspected by lstat without following links. A dangling component or
disappearance after observed presence is an unsafe observation, not absence.

Limits are versioned policy-scan-v1: 2 MiB JSON input, 10,000 operation paths,
128 opened files, 256 KiB per evidence file, 4 MiB total evidence bytes,
256 candidates, 64 ancestor steps, 16 directory levels, 8 reference hops and
4,096 shared scope/evidence enumeration entries and visits, including empty
directories and skipped entries. Traversal checks types without preliminary leaf
hashing; selected raw leaf reads run once under a cumulative 4 MiB path-byte
budget. Git calls have 10 seconds each and 30 seconds total,
with bounded output. No scan is completed by truncating. File/type/read/encoding/
control/race/budget issues require a decision. Document newlines are retained;
single-line fields reject raw controls before normalization.

The safe runner resolves Git from reviewed host installation roots independently
of repository cwd/PATH: ProgramFiles Git/cmd on Windows, system /usr/bin,
/usr/local/bin or /opt/homebrew/bin on Unix. The host bootstrap environment is
the trust boundary for those installation roots. Repository-controlled candidates
and relative/drive-relative PATH entries are never used. An unavailable installation
or unsupported --no-lazy-fetch guard requires a decision without fallback. The
guard runs before repository observation. Every call uses absolute Git, structured
argv, controlled stdin/environment, no shell, no optional locks, disabled fsmonitor,
untracked cache/external diff and no lazy fetch/transport. It never executes hooks,
filters, textconv, trailer commands, credentials or repository policy scripts.
Exported runner calls accept only the exact reviewed read-only argv forms;
symbolic-ref writing/deletion modes are rejected before launching Git.

## Artifacts, semantic decision and freshness

PolicyScan contains schemaVersion 1, artifact policy-scan, canonical operation and
context, binding, scanStatus complete/incomplete, candidates, checkedLocations,
issues, limits/counters, limitations and exitCode. Each candidate has id, locator,
sourceKind, scopeBasis, full raw-byte sha256/byteLength, safely decoded relevant
text and referenceIds. Locations record present/absent/failed. Issues retain
stable id, code, optional locator and non-secret detail.

Binding has canonicalizationVersion 1, physical gitDirectory/commonGitDir and
lowercase SHA-256 scopeDigest, gitStateDigest, pathStateDigest, invocationDigest,
evidenceDigest and scanDigest. One ordinal key-sorted JSON serialization owns
digests; canonical set ordering preserves exact filenames and opaque operation IDs.
Evidence includes raw byte hashes, descriptor/path identity, inventory presence/
absence, issues and limit profile. Timestamps are not the freshness source.

PolicyDecision has exactly schemaVersion 1, artifact policy-decision, operation,
binding, branch (repository-policy, skill-default or needs-decision), assessments,
selectedCandidateIds, issueIds, rationale and decisionSource. decisionSource is
{kind: agent-semantic, reference: nonempty string}. Copy operation/binding from
the scan. Assess every candidate once, with candidateId, classification
(ai-disclosure-policy, ordinary-format-only, unrelated or uncertain) and rationale.
Select at least one applicable candidate for repository-policy. skill-default
requires a complete reasonable scan and no applicable/uncertain AI-policy assessment.
Cite concrete evidence and its actual precedence/applicability. Unknown IDs,
unknown members/versions, malformed fields and incompatible scopes are input errors.
Incomplete scans, unresolved applicability/conflicts and explicit needs-decision
stop downstream work. JSON cannot authenticate semantic judgment or user consent.

PolicyRouteCheck reports schemaVersion 1, artifact policy-route-check, operation,
new binding, freshness current/stale/unresolved, effective branch, defaultValidation
not-run/eligible, repositoryPolicyValidation not-run, selectedCandidateIds, issues,
limitations and exitCode. Any changed binding makes an old decision stale and
needs-decision. Obtain a new semantic assessment; do not silently keep its branch.

repository-policy bypasses default registry, required identity, summary, tuple
rules and Assisted-by/AI Co-authored-by vetoes entirely. It does not mean repository
policy was validated. Before rendering or validating a message, read the
[message contract](messages.md); those commands repeat actual fresh routing
before accessing any default evidence or applying default trailer rules.
needs-decision stops the operation. A request, timeout, failed/cancelled question
or saved decision is not consent. Independent operation authorization still applies.

Exit 0 completes scanning without choosing policy, or confirms a current default
decision eligible for later checks. Exit 10 hands off current repository policy,
unverified and with default checks skipped. Exit 20 needs a decision. Exit 2 is
invalid input/explicit scope. Other nonzero exits are execution failure. Helpers
never commit/push/write refs/index/history/configuration/identity or grant permission.
These observations are not atomic and cannot eliminate later races; recheck before
consumption. A finite search proves only what was checked. The Agent remains
responsible for actual provenance, known relevant unresolved sources and authorization.
