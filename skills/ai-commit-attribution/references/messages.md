# Message rendering and validation (schema 3)

Before rendering, validating or interpreting message results, read this contract.
First prepare an actual operation and semantic policy decision using the
[policy contract](policy.md). Before preparing a default participation ledger,
read the [record contract](records.md). Repository disclosure policy applies
exclusively; these default Assisted-by rules never supplement or veto it.

## Commands and results

```text
node <installed>/scripts/attribution.mjs render --message <message.txt> --operation <operation.json> --decision <decision.json> [--input <ledger.json>] [--assessment <assessment.json>] [--output <new-message.txt>]
node <installed>/scripts/attribution.mjs validate --message <message.txt> --operation <operation.json> --decision <decision.json> [--input <ledger.json>] [--assessment <assessment.json>]
```

Explicit files resolve against the invocation directory. Installed resources
resolve against the executable, independent of that directory. UTF-8 input is
bounded to 2 MiB per file and checked with descriptor/path identity. Messages
allow LF/CRLF and body tabs; other controls, NUL, bare CR and Unicode line
separators are rejected. Single-line structured fields reject all raw controls
before trimming or normalization. No private session discovery occurs.

Each call validates the explicit operation and schema-2 semantic decision, checks
their scope consistency and dispatches the declared branch before accessing any
default input, assessment or registry. needs-decision returns 20 without a
preview or output file. repository-policy skips every default check, including
required identities, tuple accounting, legacy migration and AI coauthor vetoes.
Unused default paths are not opened, statted or resolved. It reports format,
participation evidence and repository validation as not-run and returns 10.
Render previews/copies the supplied repository candidate unchanged; this
unverified handoff is neither an invalid message nor an approved commit.
The helper never discovers policy, reads decision references, establishes
freshness or executes repository validators. The integrator separately records
actual criteria/checks/outcomes for the operation, read rules and exact
input/final-message hash, with actor/source and remaining limits.

On skill-default only, --input is required and the schema-2 summary owns confirmed identity
canonicalization, tuple ordering and declared blockers. The result
separates format valid/invalid/not-run, participation complete-against-declared-input,
incomplete/not-run, and repository checking not-run.
It includes operation and routing.branch, input hash, issues, limitations and exitCode.
Render adds a JSON-escaped preview, changed flag and output hash only after
success. No single ready/verified/permission flag combines these dimensions.
Declared evidence cannot authenticate dispatch or prove all actors were named.

## Canonical default records and preservation

Each supported tuple produces one line:

```text
Assisted-by: <canonical Agent host>:<actual formal Model>
Assisted-by: <canonical Agent host>:<actual formal Model> (<confirmed native effort>)
```

Angle brackets here are placeholders. Use exact registered host names and model
punctuation. Disabled confirmed native reasoning renders none; unknown or
unsupported optional effort is omitted, without a mandatory question. Distinct absent/none/confirmed values and ordinal sorting are
owned by the record contract. Trailers represent the finite set of tuples and
carry no event or participant count. Existing exact aliases normalize.

The shared identity parser permits colons inside a formal model identifier after
the Agent delimiter. For example, official AWS documentation lists
[amazon.nova-micro-v1:0](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html)
(checked 2026-10-14). This is evidence for preserving model punctuation, not a
model catalogue, actual dispatch proof or an AWS integration claim. Agent labels
still cannot contain the delimiter; optional-suffix and raw-control checks remain.

Raw terminal Assisted-by fields are inspected before Git unfolds them. Folded,
empty, placeholder or malformed required identities fail rather than being
guessed. Existing Agent/model tuples absent from current evidence require a
decision; do not drop them as cleanup. Placeholder or malformed optional suffixes fail validation; confirmed native
strings retain their spelling. Validate distinguishes
syntax corrections (2) from missing supported tuples/required evidence (20).

Git interpret-trailers supplies structural parsing/insertion, always with
--no-divider, controlled stdin and isolated configuration. Span reconciliation
preserves the original title/body, human coauthors and unrelated trailer bytes,
folding, whitespace and order, including body --- lines. Only managed records
or exact authorized migrations change. Managed records form one adjacent sorted
terminal group, and repeated rendering is byte-identical. Mixed body line endings
remain intact; new records use the terminal block's uniform ending, or the last
document ending (LF if none). Mixed endings inside an existing terminal block
are conservatively rejected. A message with no block gains only the needed
separator and a final newline. An existing block without a final newline keeps
that state. Ambiguous Git/raw-span disagreement is rejected, not normalized.

The isolated trailer process uses trusted absolute Git and a private temporary
non-repository directory, isolated system/global/home/XDG configuration and a
discovery ceiling. Inherited Git/config/command/trace/routing variables are
removed. Calls are bounded to 10 seconds and 4 MiB output; no shell, hooks,
filters, transport or repository scripts are requested. Git semantics and cmd/command
configuration are documented in the official
[Git 2.56.0 trailer manual](https://git-scm.com/docs/git-interpret-trailers/2.56.0),
checked 2026-10-14; isolation/preservation require actual tests, not this citation.

## Existing signatures and exact assessment handoff

Human and undetermined coauthors are preserved. Email/name spelling, hook
presence and product-like words never classify a signature as AI. Default output
adds no AI coauthor or AI-Agent/AI-Model/AI-Reasoning-Effort. Exact legacy records
need supported full-identity pairing and current message-modification authority before
removal; separate legacy fields are never paired by line order. Concrete
automatic AI signing conflicts stop rather than being hidden by another line.
Read definitions as data; never execute them to discover their intent or modify
global/user/repository identity/configuration to make validation pass.

An optional MessageAssessment has exactly schemaVersion 3, artifact
message-assessment, operation, messageSha256, signatures and migrations. It must match the explicit operation and exact input
message. Each signature has exact opaque id, source, classification
ai-signature/human-signature/unrelated/uncertain, identityKeys, nonempty
evidenceReferences and rationale. source has one of these exact shapes:

```json
{ "kind": "message-record", "messageRecordId": "<exact returned record id>" }
```

```json
{ "kind": "automatic-signing", "reference": "<actual inspected signing evidence>" }
```

Message record IDs are returned in concrete signature issues and bind the message
hash, original span and raw bytes. Default results expose record IDs, keys,
raw-byte hashes and lengths under message.records for precise assessment of an
existing coauthor. Automatic-signing references declare evidence inspected by the
Agent; the helper never opens or executes the reference. All identityKeys join the current summary full tuple keys, encoded as
JSON.stringify([agent, model, reasoning ?? null]). Unknown, duplicate or mismatched joins fail.

Migrations have signatureIds, identityKeys, nonempty mappingReferences, and
modificationDecision with current operationId and reference. They cover exact
AI-classified message records and resolved current identities; overlapping or guessed
pairings fail. Render removes only those exact records. Validate never migrates.
An automatic-signing AI signature remains a blocker because a message edit cannot
disable the declared automatic behavior. Uncertain supplied signature assessment
also requires a decision. Supplied classifications and references are declarations,
not authenticated evidence or modification authority. The integrator must inspect
actual evidence and current user/session authority.

Schema-1 and schema-2 assessments, eventIds, binding, policyCandidateId and
exceptionApplications are rejected with exit 2. Recreate the confirmed mapping
using schema 3 and explicit source kinds; there is no legacy adapter. Message
results use schema 3 with routing.branch. Ledger and summary use schema 2;
Operation and registry remain schema 1 and PolicyDecision remains schema 2.

## Questions, required blockers and actual operations

Required Agent/model or known participant gaps stop. The integrator obtains
missing facts in its authorized scope, then uses the actually available native
question tool when needed. Unavailable/failed/cancelled questions, a request,
saved notification or elapsed waiting are not consent; preserve work and stop.
The finite CLI does not implement interactive questions, waiting or polling.
After a genuine response, follow the [policy review procedure](policy.md#review-after-waiting-or-changes).

Known required gaps persist as ledger blockers. Resolve the facts and inclusion
judgment before clearing them; the helper offers no incomplete-disclosure
exception continuation. It cannot authenticate consent or grant Git authority.

Only render with --output performs a minimal trusted lookup of the actual Git
administrative directories for output protection. It does not inspect HEAD,
index, target commits, changed paths, policy documents or hook/template
configuration. Preview and validate do not query the target repository through
Git; they check explicit input declarations. Default trailer processing still
uses Git in an isolated non-repository directory. Matching supplied scope does
not establish actual Git state or freshness.

Render previews by default; validate never writes. --output creates only an
explicit absent new regular file under a safe physical existing parent. It
rejects existing files/directories, links/reparse points, hardlinks, consumed
input aliases and Git administrative paths. No overwrite, in-place edit,
recursive replacement or repair occurs. Failure cleanup removes a file only
after its exact full bytes were verified and its recorded identity, metadata and
parent remain unchanged. Failed/interrupted or short writes leave uncertain
artifacts intact, including empty or candidate-prefix content; inspect the
explicit output path after an execution failure. No file is created on a
pre-publication blocker/input error. Repository handoff may explicitly copy
unchanged bytes with exit 10. Unused default paths remain opaque and are not opened/statted/resolved on that route.

Exit 0 completes a default message goal against the confirmed finite set; 10 is an unverified repository handoff;
20 needs a decision/evidence; 2 is invalid input or default syntax; other nonzero
is execution failure. Before consuming decisions, after waits or changes and
before/after actual operations, follow the [policy review procedure](policy.md#review-after-waiting-or-changes).
Mechanical scope matching cannot establish live state or freshness. Helpers never
commit/push/change refs/index/history/identity or grant operation authority.
Follow that review procedure for final-message checks and host/hook mismatches.
