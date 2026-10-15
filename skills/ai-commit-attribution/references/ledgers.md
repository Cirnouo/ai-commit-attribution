# Worktree ledger state and basic lifecycle

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
per-ledger positive revision. Identity, blocker, lifecycle and predecessor/
successor changes increase content revision once per transaction. Note/work,
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

Preparation, result recording and transfer commands are not delivered by this
basic lifecycle module. Their reserved preparations/transfers/imports arrays
currently accept only empty arrays; unknown receipt blobs are rejected. Prepared
state/currentPreparationId cannot be persisted until the strict receipt contract
is enabled. Historical receipts will remain immutable across pause/switch and
reopen; ordinary lifecycle code does not infer Git results.
