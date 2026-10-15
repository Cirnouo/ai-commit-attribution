# Planned-commit ledgers and explicit result reconciliation

Accepted 2026-10-15. This is a forward architecture decision against base
`a1b0499`, not an implementation or acceptance report. It accepts one durable
ledger per planned output commit, with an explicit worktree association,
preparation receipt and reconciliation against the actual result. The purpose
is to preserve attribution across interrupted work without treating remembered
conversation, content similarity or helper output as proof of participation or
authority.

This partially succeeds [0001](0001-summary-evidence.md),
[0003](0003-message-attribution.md) and [0004](0004-agent-policy-discovery.md).
It replaces their event-based participation and exception-continuation designs
and extends the minimal Git observation boundary for explicit result checks.
The Agent semantic-discovery decision in 0004 remains in force;
[0002](0002-policy-routing.md) remains superseded. This record explains the
accepted choices and costs, rather than duplicating a CLI or JSON specification.

## Observed baseline and the problem

At `a1b0499`, the runtime exposes summarize, render and validate. Callers supply
a schema-1 event ledger and an independent schema-1 Operation; the ledger
contains known participants, events, evidence and user exceptions. Message
assessments/results and Agent policy decisions use schema 2. Registry schema 1,
isolated trailer interpretation, exact migration declarations and preservation
of human/unrelated message bytes already exist. The only target-repository Git
observer locates administrative directories for safe new-file output. There is
no persistent current ledger, reservation, preparation, result reconciliation or
transfer lifecycle. These are source observations, not claims about real host
loading or successful Git operations.

Remembering participation only in the current conversation fails when a handoff,
compaction, new Agent or interrupted session loses that memory. Saving a ledger
for each unit of work does not fix commit attribution either. In a synthetic
example, work A contributes to planned commits AB and AC; work B contributes
only to AB, and work C only to AC. A single work ledger cannot express each
commit's chosen set without additional allocation. Consuming or deleting AB's
record after its commit can destroy shared A before AC is prepared. Likewise,
a ledger for an entire multi-commit task can over-attribute every output.

A planned-commit ledger is therefore a reservation for one intended output,
with a stable UUID ledger ID created before its SHA exists. It has a real
lifecycle even if no commit is
eventually produced. The integrator explicitly includes A in both AB and AC,
with B and C in their respective ledgers. Finishing AB changes AB alone. A
split or combination requires explicit participant sets and replacement ledger
IDs; a script cannot infer allocation from files, tasks or a diff.

Descriptions, work notes, branch names and similar text help a person understand
intent, but are not deterministic locators. A UUID provides stable identity;
it does not identify which ledger is currently selected. A content snapshot can
bind a proposed result, but cannot establish who researched, planned, reviewed
or otherwise contributed to it. The same content can arise through different
participants and authority. An external issue or work system could carry the
reservation, but this design does not assume an always-available, reliable
carrier or reconstruct a missing association from one.

## Decisions and responsibility

AI and human integrators establish semantic facts: actual canonical Agent,
actual formal model, any confirmed native reasoning effort, participation in
each planned output, policy applicability, signature classification and current
authority. A finite helper validates declarations, rejects unsafe fields,
deduplicates and sorts identity tuples, renders messages, and compares bounded
Git observations. It cannot authenticate declarations, discover omitted actors,
infer participation from a snapshot, or turn a receipt into permission.

The new core is Ledger schema 2 and Summary schema 2: confirmed identity tuples,
explicit required blockers, a stable ledger ID, content revision and
operation-bound input snapshot. Events, tasks, known-participant inventories,
evidence objects and model-route resolution leave that core. Optional work
descriptions or notes aid recovery without becoming identity or selection
authority. Unknown optional effort remains omitted; confirmed disablement and
absence remain distinct. Model punctuation remains exact. A known required gap
persists as a blocker instead of being forgotten when other identities resolve.

MessageAssessment schema 3 uses unambiguous identity keys instead of event IDs
and removes exception applications. MessageResult schema 3 removes the
incomplete-with-user-exception completion path. Old ledger and assessment
schemas are directly rejected, without an adapter that would silently convert
historical declarations into confirmed facts. This is an intentional migration
cost. Exact signature classification, supported migration mapping and current
modification authority remain declarations the integrator must substantiate;
human coauthors, unrelated records and prose retain their byte-preservation and
idempotence safeguards.

Operation schema 1, registry schema 1 and PolicyDecision schema 2 remain. The
stable planned-commit ID is distinct from a fresh Operation ID for a materially
changed action. The three policy branches stay exclusive. Required identity
blockers stop skill-default; repository-policy bypasses default requirements
and retains its unverified exit-10 handoff. Lifecycle metadata is not a new
default-policy veto. Repository-specific final review is a declaration bound to
the actual SHA and message hash, not helper execution or authentication of a
repository validator. Agent discovery remains semantic: the new read-only
result observer is not a policy scanner or a freshness/completeness guarantee.

## Worktree ownership and selection

The storage design evolved from caller-chosen user directories to one fixed
state file at the actual worktree root, `.ai-commit-attribution/state.json`.
This gives a new session a deterministic local discovery point without a
global index, private-session scraping or guessing from names. Main and linked
worktrees each own their state. A context UUID and physical locator distinguish
that ownership; an explicit current-ledger binding supplies selection within
the context. Multiple reservations may coexist. Missing association requires a
decision, not an empty replacement ledger; a remembered child ledger ID cannot
redirect another current binding.

Explicit initialization uses trusted Git to find the common `info/exclude` and
adds only `/.ai-commit-attribution/`, preserving existing bytes. It does not
edit tracked `.gitignore` or global configuration. Before state creation the
implementation must detect tracked conflicts, effective ignore precedence,
links/reparse points and unknown occupancy. This accepts a shared local exclude
entry while retaining worktree-local data. Unknown artifacts are preserved.
State and transfer bundles have a 16 MiB bound; short locks, compare-and-swap
and atomic replacement protect transactions, with no timeout-based lock theft.

The cost of predictable worktree-local storage is that deleting or archiving a
worktree also removes its ignored state. Unfinished work therefore needs a
successful current-version export of its current content revision outside that
worktree and Git metadata before removal. Terminal records may be pruned
explicitly; unfinished records need that export first. There is no automatic
cleanup. Explicit rebind handles
a move; copying a directory does not silently establish a new authority.

## Reservation, preparation and recovery

Ledger lifecycle states are open, prepared, sealed and abandoned. Ownership
(local, exporting or exported) is separate from lifecycle; current selection
is separately active or paused. Recording requires an open ledger. Preparation
freezes its revision and creates an immutable receipt; reopening removes that
receipt's eligibility for a new Git action without erasing historical receipts.
Switching or pausing retains them. Finishing clears selection only if it still
selects that same ledger, so delayed completion cannot clear unrelated work.
Finishing the same receipt and SHA is idempotent.

Sealed ledgers are immutable. A later amend or recommit has a new ledger even
when it reuses confirmed identities. Split/combine likewise creates new IDs
from explicit sets and abandons the sources with replacement links. This
accepts deliberate allocation and lifecycle work instead of an unsafe automatic
claim that identities follow content.

Preparation binds the ledger revision, supplied Operation and intended result.
It observes the complete resolved stage-0 index manifest using raw path bytes,
mode and object ID, then records its digest. It rejects unmerged entries,
intent-to-add, unsupported index forms, staged local state and missing objects.
A dedicated narrow read-only observer supplies this evidence without
`write-tree`; it does not change the index to make observation succeed.

A safe new candidate message must be published and read back, and the receipt
must be persisted by compare-and-swap, before prepare reports success. Those
two files cannot be one atomic transaction. If message publication succeeds
but state persistence fails, the candidate remains explicitly unprepared and
the command cannot report success or authorize its use. Unknown or partial
artifacts survive for inspection. Similarly, a successful external commit
followed by failed finish does not consume the reservation: retry reconciles
the original immutable receipt with the exact result. Verification and waiting
failures preserve Git state and identity configuration.

## One result model for local Git operations

Every planned output uses ResultPlan schema 1 with form create or replace,
ordered expected parents and, for replace, an explicit replacement target.
Create uses observed HEAD as its first parent, or no parents for an unborn
repository; extra parents are explicit. Replace targets observed HEAD and
preserves that target's complete ordered parent list. Supplied source commits
join the Operation targets. Parent order is part of the result contract, not a
sorted set or an inference from an operation's human label.

This covers an ordinary/root commit, amend of a root, ordinary or merge/octopus
commit, cherry-pick output, rebase conflict output using create, rebase edit using
replace, rebase-merges with explicit rewritten parents, merge/octopus output,
and squash through either a new commit or replacement. The caller orchestrates
each output of a batch. Fast-forward, skip and drop produce no output to consume
and do not permit adopting an existing commit as a newly prepared result.
Sequencer files are neither the source of participant identity nor required
evidence at finish.

Finish takes an exact full SHA and compares its complete ordered parents, tree
manifest digest and message with the frozen plan. The result need not still be
HEAD. LF/CRLF normalization and final-newline differences are permitted; any
other message rewrite requires fresh review of the exact final message, while
the preparation is retained. A tree or parent mismatch cannot be explained
away by similar paths, a familiar subject or a successful Git exit code.

All lifecycle and result commands are explicit. No automatic hooks record,
prepare or consume reservations. Helpers never commit, continue a replay,
change a replay todo list, rewrite history, modify refs/index/identity or push;
they never execute repository policy scripts. This keeps real Git action and
its authorization with the integrator, at the cost of explicit preparation and
reconciliation around each output.

## Portable transfer and authority

Export freezes source ownership as exporting before publishing a new external
JSON bundle. Safe publication and readback precede exported ownership. An
interruption retains the frozen source and retries the same transfer ID and
digest; it does not silently thaw or publish a competing authority. Transfer
receipts make a retry distinguishable from a new export.

Resume import retains stable ledger IDs, establishes a new target context and
starts with selection paused. Transfer ID plus digest makes an identical import
idempotent; conflicting data is rejected rather than merged. Copy import
instead creates new IDs with origin information. A human explicitly declares
the single authoritative continuation. Local freezes and receipts reduce
accidental forks but do not provide global uniqueness, authentication or a
distributed authority guarantee across retained bundles and copied worktrees.

An original preparation/result contract remains portable after the old physical
paths disappear. It cannot authorize a new Git action in the destination.
Fresh semantic and authority review may finish an already-created exact SHA
against that frozen result; otherwise the integrator reopens and prepares in
the new context. This preserves crash recovery without pretending that an old
absolute locator proves current scope or authorization. Existing exported data
never silently returns to writable local ownership.

## Consequences and delivery status

The accepted design trades simple ephemeral files for explicit allocation,
selection, bounded transactional state and removal discipline. It improves
recovery and deterministic result binding, while leaving semantic participation,
policy and authority with the people and Agents able to establish them. It
does not claim an atomic Git-and-ledger transaction, universal contributor
discovery or an authenticated provenance system.

At acceptance, the new schemas, state commands, transfer, result observer and
prepare/finish behavior are not implemented or verified at the observed base.
Delivery proceeds through core/schema migration, local lifecycle, transfer and
result reconciliation. Runtime instructions must describe delivered behavior,
with their CLI/schema details owned by the maintained installed contracts in
[packaging](../../packaging/README.md); this ADR supplies no provisional runtime
command recipe. Existing [records](../../packaging/records.md),
[policy](../../packaging/policy.md) and [message](../../packaging/messages.md)
contracts describe their current delivered versions until updated. A lifecycle
contract is not linked before it exists.

Implementation acceptance must exercise overlapping AB/AC participation,
context/current recovery and stale selection, concurrent state changes, ignored
state safety, publication/receipt and commit/finish failure boundaries, all
listed Git result forms, and transfer interruption/conflict recovery. Source
checks, generated distribution equality, installed execution and actual Git
fixtures on supported platforms are separate evidence. No tests or host
acceptance are claimed by this decision. The existing erasable TypeScript,
built-ins-only runtime and trusted Node/pnpm development boundaries remain;
version 0.1.0 stays Unreleased and this decision grants no release authority.
