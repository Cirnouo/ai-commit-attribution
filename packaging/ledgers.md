# Worktree ledger state, lifecycle and transfer

Before initializing or changing a worktree ledger, read this contract. One
ledger UUID names one planned output commit before its eventual commit SHA
exists. Creating a ledger does not bind an operation. The caller declares
contribution, inclusion, identity and required gaps; helpers do not discover
actors or infer allocations from prose, diffs, history or model routing.

## Initialization and recovery

Run `node <installed-skill>/scripts/attribution.mjs ledger init --worktree <path>`
explicitly in an ordinary or linked Git worktree. A child directory resolves to
its actual physical worktree root. Bare repositories and linked filesystem
paths are rejected. Each worktree has its own `.ai-commit-attribution/state.json`,
context UUID, version and current selection. Linked worktrees share Git's
effective `info/exclude`; initialization appends only `/.ai-commit-attribution/`,
preserving all existing bytes and their newline style. The safe exclusion stays
in place if a later initialization step fails.

Initialization refuses tracked or force-staged ledger paths, unknown directory
occupancy, links, hardlinked authority and ineffective ignore rules. An existing
valid state is returned without replacement. A directory left without state is
an interrupted initialization requiring explicit inspection; it is not rebuilt
automatically. State copied to another checkout is rejected by its stored
physical locator. There is no implicit move/copy recognition or global store.
The reserved first path component includes case variants on Windows/macOS and
Windows stream, trailing-dot/space and short-name aliases. This deliberately
reserves case variants even on a case-sensitive macOS volume.

`ledger status --worktree <path>` returns the complete state, including
stateVersion, contextId, current and every ledger record. Missing state or current
selection never creates an empty ledger. Preserve uncertain locks and candidate
files for review. Lock timeouts do not steal locks based on age. A failed write
may leave a complete or partial candidate beside the old authority; a failed
final observation may mean publication occurred. Read status before retrying
with a fresh version. Helpers never commit, push, alter Git identity or execute
repository policy scripts.

## Commands and exact declarations

Every mutation below requires `--expect-version <nonnegative integer>` from the
last observed status. `--worktree <path>` defaults to the current directory.
Unknown, duplicate or command-inapplicable flags are errors. A persisted command,
including a content no-op, increases stateVersion once. Stale versions fail.

| Command | Additional arguments and behavior |
| --- | --- |
| `create` | Optional `--ledger <lowercase UUID>`, `--select`, `--note <text>`, `--work <text>`. Otherwise generates an ID; selection is explicit. |
| `select` | `--ledger <UUID>` selects a local open/prepared ledger, deliberately switching away from any paused or prepared selection. |
| `add`, `remove` | `--ledger <UUID> --input <json>`; input is exactly `{"identities":[{"agent":"Codex App","model":"formal-model","reasoning":"none"}]}`. reasoning is optional. |
| `block` | `--ledger <UUID> --input <json>`; input is exactly `{"id":"required-gap","reason":"Confirm actual model"}`. |
| `unblock` | `--ledger <UUID> --blocker <exact opaque ID>`. |
| `pause`, `resume` | `--ledger <UUID>` must equal the actual active/paused current ID respectively. Pause retains the ID. |
| `reopen` | `--ledger <UUID>`; local prepared or abandoned only. Prepared, or abandoned with preparation history, requires `--reviewed-no-result`, the caller's explicit declaration that no result needs recording. |
| `abandon` | `--ledger <UUID>` retains a local nonsealed record and conditionally clears only that same current ID. |
| `split`, `combine` | `--input <json>` with the exact allocation shape below. Sources must be local open ledgers. |

Add/remove/block/unblock require the exact active current ID. A late child carrying
an older ID cannot redirect its mutation after another ledger becomes current.
Select, reopen and abandon are explicit administrative targets; reopening does
not select, and abandoning a different target does not clear the current ledger.

Identity aliases are canonicalized through the installed registry. Each complete
tuple includes Agent, actual formal model and optional confirmed reasoning.
Absent reasoning differs from confirmed `none`. Sets deduplicate within each
ledger; there is no global signature set. Remove targets complete tuples. Adding
an identity does not clear a blocker. Blocker IDs are exact, unique opaque keys;
changing an existing blocker requires explicit unblock then block.

Split requires one source and at least two outputs; combine requires at least
two sources and one output. Input members are exactly sourceIds and outputs.
Each output provides a new lowercase UUID, complete identities and complete
blockers, with optional note/work strings:

```json
{
    "sourceIds": ["11111111-1111-1111-1111-111111111111"],
    "outputs": [
        {
            "ledgerId": "22222222-2222-2222-2222-222222222222",
            "identities": [{"agent": "Codex App", "model": "formal-model-a"}],
            "blockers": []
        },
        {
            "ledgerId": "33333333-3333-3333-3333-333333333333",
            "identities": [{"agent": "Codex App", "model": "formal-model-a"}],
            "blockers": [{"id": "model-gap", "reason": "Confirm another actor"}]
        }
    ]
}
```

One transaction abandons sources, links predecessors/successors and creates all
outputs. The same identity can appear in AB and AC independently; abandoning AB
does not change AC. Replacement sources retain their history and cannot reopen
while they have successors. Exported/exporting ownership never silently becomes
local through ordinary lifecycle commands. Sealed records are immutable.

## Selection and state contract

Low-level summarize/render/validate may select `--ledger <UUID>` using the supplied
operation's worktree, or `--current <worktree>`. These selectors and `--input` are
mutually exclusive. Current-based access requires an active current selection.
An explicit ID permits preview of the same paused ledger or an open plan when
current is absent; it rejects a different current ID. Neither selector selects
or creates a ledger. The current operation must match the actual state context.
Repository-policy routing keeps unused default ledger selectors opaque.

State schemaVersion 1 uses a separate monotonically increasing stateVersion and
per-ledger positive revision. Identity, blocker, lifecycle, current preparation,
sealed result and predecessor/successor changes increase content revision once per transaction. Note/work,
selection, pause and ownership changes do not. Every stored UUID uses lowercase;
local references must exist and reciprocal replacement links must agree.
The complete file has an independent 16 MiB UTF-8 byte limit. Strict shape,
controls, versions, reference consistency and physical locator are validated.

Short exclusive locks protect exact-byte and file-identity compare-and-swap.
Publication uses a same-parent exclusive candidate, complete write, sync,
readback, original-byte/identity recheck, atomic rename and final readback.
Failure preserves old authority or a recoverable candidate. This protocol
coordinates cooperating writers; it does not authenticate declarations or
provide a filesystem primitive against arbitrary hostile local concurrent writers.

Preparations, transfer receipts and import receipts have strict typed contracts.
A current preparation freezes the exact ledger ID, revision, identities,
blockers and declared operation; older preparations remain immutable history
after reopen, pause or selection changes. Historical operation paths are parsed
without requiring the old directories to exist. Sealed result history joins an
immutable preparation and caller review to the ledger, SHA and final message
digest. Every persisted sealed record requires this explicit result; other
lifecycles cannot carry one. Shape validation does not authenticate contribution, authorship or
policy decisions. These historical contracts grant no authority for a new Git
action. The explicit preparation and result commands below bind these contracts without inferring either action from Git history.

## Prepare one planned result

Use top-level `prepare` and `finish` around each separately authorized Git output.
Ordinary render/validate remain previews/checks: they never freeze or consume a
ledger. Before preparation or final review, read the [policy contract](policy.md)
and [message contract](messages.md). Agent review determines participation,
applicable rules and authority; the observer only checks finite Git objects.

Prepare requires the exact active current local open ledger and current
stateVersion. A separate schema-1 Operation and schema-2 PolicyDecision must
agree. Use a fresh operation ID when scope changes, distinct from this stable
ledger UUID. Known immutable preparations, including copied-origin history,
reject reusing an operation ID with a different normalized scope. This is a
local consistency check, not global ID freshness or policy discovery.

Supply result-plan.json separately from Operation. Its exact members are
schemaVersion, form, expectedParents, sourceTargets and, for replace only,
replacementTarget. For an unborn ordinary commit:

```json
{
    "schemaVersion": 1,
    "form": "create",
    "expectedParents": [],
    "sourceTargets": []
}
```

Use complete lowercase nonzero object IDs of the repository's storage format
(40 digits for SHA-1, 64 for SHA-256). expectedParents preserves the complete order;
never sort it. sourceTargets contains exact role/objectId pairs covering the
complete Operation.targets set; sources do not automatically become parents.
For create, observed HEAD must be the first parent, or parents must be empty
when HEAD is unborn. Additional parents are explicit. For replace, the target
must be observed HEAD and expectedParents must preserve that commit's complete
ordered parents. Operation.kind alone never chooses form or parent order.

| Caller stop or output | ResultPlan |
| --- | --- |
| Ordinary/root commit | create; parent HEAD, or empty for root. |
| Amend, including root/merge/octopus | replace HEAD; retain all ordered parents. |
| Cherry-pick conflict or `-n` aggregate | create at current HEAD; list sources separately. |
| Rebase conflict before continue | create at current HEAD. |
| Rebase edit after replay | replace the replayed HEAD; original commit remains a source. |
| Merge/octopus or rebase-merges | Explicit actual ordered parents, including rewritten parents. |
| `merge --squash` | create with HEAD as the single parent; list sources separately. |
| Interactive squash/fixup | replace the actual accumulator; do not infer from the word squash. |

Batch replay needs one ledger and preparation per planned output. The caller
arranges the stop, resolved index and message consumption for every result.
Fast-forward, skip and drop create no result to seal. No implicit adoption of
an existing commit is offered.

```text
node <installed-skill>/scripts/attribution.mjs prepare --worktree <actual-worktree> --ledger <UUID> --expect-version <version> --message <message.txt> --operation <operation.json> --decision <decision.json> --result-plan <result-plan.json> --output <new-candidate.txt>
```

Optional --assessment is default-branch evidence under the message contract.
Needs-decision returns 20 before opening state, message, result plan, default
assessment or registry. Repository-policy still manages its explicitly selected
plan and result observation, but skips every default identity/blocker/assessment/
registry gate and preserves the supplied candidate, returning 10. The caller
must check the actual repository rule independently; 10 never approves it.

Default blockers stop preparation. Unknown optional reasoning is omitted.
Successful prepare publishes and rereads a safe new candidate, then saves an
immutable schema-1 prepared-receipt and changes the ledger to prepared at its
next revision. The receipt freezes identities, blockers, operation, decision,
ResultPlan, observed HEAD, storage format, full index manifest/tree and candidate
bytes/hash. The result returns preparationId, outputPath and stateVersion.
Identity or blocker changes require explicit reopen and new preparation; pause
and switching retain immutable history. Sealed results require a new ledger for
later amend or recommit.

Only complete candidate publication and durable prepared state count as success.
A published candidate followed by failed persistence is candidate-unprepared,
exit 2; preserve it and inspect status. The file alone is not a preparation.
An output aliasing an actually consumed input, state directory or protected Git
metadata is refused. Inputs/outputs retain the message writer's existing new-file
boundary. Never silently overwrite, delete uncertain artifacts or use age to
steal a lock.

### Finite Git observation and limits

Preparation captures the complete resolved stage-0 index. Raw path bytes, mode
and full OID all participate in the manifest; the expected complete Git tree ID
is computed without write-tree or writing any Git object. Conflict entries,
intent-to-add, force-staged reserved state paths, missing required objects and
unsupported index forms stop preparation. Index versions 2/3/4 and expanded
sparse indexes are supported; split indexes are explicitly unsupported. Gitlinks
retain their OID without requiring the submodule commit in the superproject's
object database. SHA-1 and SHA-256 repositories remain separate formats.

Raw index ordering and optional-extension handling follow the official
[Git index format](https://git-scm.com/docs/gitformat-index), checked 2026-10-15:
entries use unsigned path-byte order; an uppercase first extension byte marks
an optional extension. Strict bounds and mandatory-extension checks still apply.
These format checks cannot establish participation or authority.

The dedicated observer accepts fixed trusted-Git query templates, with hooks,
fsmonitor, external diff, optional locks, replacement objects and lazy fetching
disabled. It does not execute repository policy scripts. Each Git query is
bounded to 10 seconds, the full observation to 30 seconds, individual data/output
to 16 MiB and aggregate subprocess output to 64 MiB, with at most 100,000 paths.
Full message/input limits remain 2 MiB; state and transfer files remain separate
16 MiB limits. Oversize/unsupported observations fail closed. No hook installation,
commit, replay continuation, todo edit, index/ref/history write or push is provided.

## Review and finish an exact result

After the separately authorized real Git action, read the exact complete SHA's
raw commit message and review the applicable rule and causal result. Hash the
actual message bytes with SHA-256, including its final newline; do not hash a
pretty-printed Git log, normalized text or an assumed candidate. Supply a fresh
schema-1 result-review bound to the current target context and preparation:

```json
{
    "schemaVersion": 1,
    "artifact": "result-review",
    "contextId": "<current context UUID>",
    "ledgerId": "<ledger UUID>",
    "preparationId": "<prepared receipt UUID>",
    "sha": "<actual complete result SHA>",
    "messageSha256": "<SHA-256 of exact actual message bytes>",
    "createdByPreparation": true,
    "policyReviewed": true,
    "reference": "<actual result and policy review provenance>"
}
```

All strings in angle brackets are placeholders requiring actual observations.
createdByPreparation and policyReviewed are caller declarations, not helper
authentication. Add repositoryPolicyChecked:true only after checking the actual
repository criteria for this SHA/message on the repository-policy branch.
Add acceptMessageChange:true only after explicitly reviewing and accepting this
exact changed final message. Unknown fields and false-valued approval flags fail.

```text
node <installed-skill>/scripts/attribution.mjs finish --worktree <actual-worktree> --ledger <UUID> --preparation <preparation-UUID> --sha <complete-result-SHA> --review <result-review.json> --expect-version <version>
```

Finish compares the exact result's storage format, complete ordered parents,
tree and semantic manifest to the immutable receipt. It need not still be HEAD
and does not depend on sequencer, MERGE_HEAD or temporary message files surviving.
Observed old HEAD, replacement target and source commits cannot be adopted as
new results. These finite checks plus a caller declaration do not prove causality
or discover unknown contributors.

Message comparison permits CRLF/LF conversion and the presence/absence of one
terminal newline. Other differences retain prepared state and return 20 until
an exact final-message review explicitly accepts them. Default validation still
requires the frozen identity set after acceptance, using frozen canonical hosts
without current catalog aliases. Repository-policy never runs this default gate;
it requires the separate exact-result repositoryPolicyChecked declaration and
retains exit 10 even after sealing. Optional --assessment is read only on default
validation, following the message contract's exact final-message joins.

Successful finish stores explicit SHA, final message digest, review and finite
check outcomes, seals the ledger and clears current only if it still points to
that ID. A later selected ledger survives. Retrying the same ledger/preparation/
SHA/message hash is idempotent, including a syntactically valid older expected
version; another result never overwrites sealed history. A failed seal preserves
the real commit and recoverable receipt. Inspect status and retry that exact
result; do not assume the commit failed, amend automatically or start over.

After resume import or original-move rebind, historical paths need not exist for
finish. Fresh target-context result/policy review is required. The old preparation
is a contract for an already-created result, never authority for a new action.
If no result exists, explicitly review that fact, reopen and prepare anew. A copy
import's new ledger cannot finish from the source preparation. A prepared plan
with an unknown result must be reconciled before reuse or abandonment.

## Export and interruption recovery

Before moving plans between contexts or removing a worktree, export an explicit
finite selection. Write a JSON file containing exactly
`{"ledgerIds":["11111111-1111-1111-1111-111111111111"]}`, then run:

```text
node <installed-skill>/scripts/attribution.mjs ledger export --worktree <source> --expect-version <version> --input <selection.json> --output <external-bundle.json>
```

IDs must be distinct and present. Select the complete predecessor/successor
closure for split or combined history; an incomplete selection fails with the
missing IDs. The output must be a new file in an existing physical directory
outside the source worktree, Git directory and common Git directory. Linked
paths, hardlinked files, protected metadata and arbitrary occupied output files
are refused. Windows stream paths are refused even when the filesystem reports
them as regular files: a directory stream disappears with its owning directory.
There is no overwrite mode.

Export uses three phases. First it saves a transfer UUID, immutable payload and
byte digests, selected current relation, source locator and output path, freezes
unfinished source ownership as exporting, and pauses the selected current ID.
The complete payload includes note/work, origin and historical preparations,
even though note/work do not increment revision. Second it exclusively creates,
syncs and rereads the external bundle outside the state lock. Third it rereads
state and marks the receipt and unfinished sources exported. A newer unrelated
current selection or record survives this final transaction. Sealed and abandoned
records can be exported as data without changing their ownership or content.

Success returns stateVersion, transferId, bundleDigest and path. Failure after
freeze retains exporting ownership even if the external file is absent. Read
status and retry with its current version, the same selection/output and
`--transfer-id <UUID>`. Retry reconstructs the same bundle bytes from frozen
records and metadata. An occupied output is accepted only when its strict
identity and complete bytes match that owned transfer. A partial or different
file remains untouched and requires explicit inspection. No failure silently
thaws sources, steals locks, removes uncertain artifacts or claims success.

The schemaVersion 1 `ledger-transfer` artifact contains transferId,
sourceContextId, historical locator, selected current relation, selected ledger
snapshots, their preparation history and payloadDigest. Ownership is represented
as local in portable snapshots; exporting/exported and current pause are source
protocol metadata. Receipts retain the original selected relation for exact
retry. Both state and bundle have separate complete 16 MiB UTF-8 byte limits;
the ordinary declaration input limit remains separate. Unknown keys, malformed
UTF-8, noncanonical UUIDs, duplicate IDs/references, dangling links, invalid
preparations and mismatched payload digests fail validation. The bundleDigest
in an export/import receipt hashes the complete raw file bytes.

## Resume and copy import

Import into an explicitly initialized target with its own distinct context UUID:

```text
node <installed-skill>/scripts/attribution.mjs ledger import --worktree <target> --expect-version <version> --input <bundle.json> --mode resume --single-authority
node <installed-skill>/scripts/attribution.mjs ledger import --worktree <target> --expect-version <version> --input <bundle.json> --mode copy
```

Resume requires the caller's explicit single-authority declaration. It preserves
ledger IDs and revisions, assigns their current owning context to the target,
and keeps all original preparation IDs, sourceContextIds, operations and result
history. It never rewrites old paths to manufacture a local preparation. An
imported selected relation defaults paused; an existing target current relation
is preserved. Select an imported ledger explicitly when ready to use it.

Copy creates new ledger IDs and revision 1 open local plans. It retains declared
identities, blockers and note/work, clears active preparation and result pointers,
and records the complete source snapshot and preparations in a typed origin
container. Repeated copies retain a flat historical origin chain. Original
replacement links stay in origin history; new plans are independent. Old
preparations and sealed results cannot finish the new copy.

Both modes return stateVersion, transferId, raw bundleDigest, target ledgerIds
and idempotent. The same transfer ID and exact raw digest in the same target/mode
returns the existing receipt without changing state, selecting an old current
or recreating pruned records. Conflicting digests, modes, ledger IDs or preparation
IDs fail. Import receipts remain as tombstones after cleanup. A historical ID
covered by retained receipts cannot be reused as a fresh ledger.

These offline files do not establish globally unique ownership. The caller must
maintain one authority for resumed work; the same bundle can be restored into
two independently initialized targets. Transfer/import helpers neither discover
nor revoke offline duplicates.

## Original-move rebind

Before reusing state after moving the original worktree, explicitly assert the
stored context ID and version:

```text
node <installed-skill>/scripts/attribution.mjs ledger rebind --worktree <moved-original> --expect-version <version> --context-id <stored-UUID> --moved-original
```

Rebind obtains the actual target Git locator through the trusted observer and
replaces only the stored locator under the same lock and byte/version checks.
The context ID, ledger records, original preparation paths, transfers and import
history remain intact. Old source directories need not exist. Ordinary status
and mutation reject copied state with a locator mismatch; only this named entry
allows that mismatch. The caller declaration asserts an original move and does
not prove it mechanically. Use import for an ordinary copy. Rebind does not
authorize a new Git action from an old operation; fresh preparation is required.

## Removal check and explicit terminal cleanup

`ledger check-removal --worktree <path>` never removes a worktree. It returns
stateVersion, safe, per-ledger details and exitCode. Zero means every unfinished
ledger's current complete payload and preparation history is covered by a
confirmed successful export whose external file is still safe, readable and
matches its raw digest. One means unsafe. Interrupted exports, missing or altered
files, older payloads and note-only changes cannot count as coverage. Terminal
records may be discarded. This is an advisory snapshot: new mutations or changes
to external files require checking again and no future availability is promised.

`ledger prune --worktree <path> --expect-version <version> --input <selection.json>`
explicitly removes only selected sealed/abandoned ledger records. Select the
entire terminal replacement closure; a link to an unfinished or unselected
neighbor refuses cleanup. Pending exports must finish first. Prune leaves
unfinished records, current selection, preparation contracts and import/transfer
receipts intact. Nothing is cleaned automatically.

```text
node <installed-skill>/scripts/attribution.mjs ledger check-removal --worktree <path>
node <installed-skill>/scripts/attribution.mjs ledger prune --worktree <path> --expect-version <version> --input <selection.json>
```
