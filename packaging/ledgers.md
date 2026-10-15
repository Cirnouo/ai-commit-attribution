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
| `reopen` | `--ledger <UUID>`; local prepared or abandoned only. Prepared requires `--reviewed-no-result`, the caller's explicit declaration that no result needs recording. |
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
action. Preparation and result recording commands are enabled in the next
implementation stage. This transfer stage accepts strict historical contracts
without exposing those commands or inferring either action from Git history.

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
