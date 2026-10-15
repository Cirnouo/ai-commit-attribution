# Confirmed identity record contract (schema 2)

Before preparing a ledger, determine actual contribution, applicability and
inclusion using trustworthy work, dispatch and handoff information. Include
planning, research, delegation, implementation, review, tests, fixes and
integration when relevant, including work without file edits. Exclude unused
installed tools and unrelated history. The caller confirms these facts; helpers
only validate, canonicalize, deduplicate, sort and render finite declarations.
Keep secrets and private transcripts outside inputs.

Supply an explicit ledger and independently supplied current operation. Ledger
members are exactly schemaVersion 2, ledgerId, operation, identities and blockers.
ledgerId is a stable UUID for one planned output commit, distinct from Operation.id.
An empty confirmed set is valid. Old schema-1 event ledgers are rejected with
migration guidance; there is no adapter. Task, event, participant, evidence,
modelRoute and userExceptions members are not accepted in this contract.

Operation id is an opaque local key. repository and worktree identify the active
physical worktree, may be equal, and must be existing physical absolute
directories. commonGitDir is the required physical absolute shared Git metadata
directory, including linked-worktree and separate-Git-directory layouts. Do not
infer a primary checkout from .git ancestry. kind is commit, amend, rebase,
cherry-pick, squash or merge. paths is an explicit list of repository-relative paths
using forward slashes; targets is a list of unique roles and resolved lowercase
40- or 64-digit hexadecimal objectIds. Empty paths/targets remain explicit.
Paths, target order and duplicate paths are canonicalized before complete scope
comparison by ordering/deduplication only. Filename whitespace is preserved;
for example, " report.md" and "report.md" select different paths. An empty
path string is invalid; nonempty whitespace filenames remain representable.
A materially changed operation requires a fresh id. Matching JSON
does not establish live Git state or freshness.

identities is an array of confirmed objects with required agent and model and
optional reasoning. Agent must identify an exact registry host or unique explicit
alias; helpers canonicalize the alias. Ambiguous family names, familyAliases and
unknown products never select a host. Models require actual formal spellings;
auto, latest, unknown, n/a and null (case-insensitive) are rejected. Preserve
supplier punctuation, case, version, snapshot and colons. No supplier model
catalogue or runtime discovery is implied.

Omit unknown optional reasoning. Confirmed disabled native reasoning uses none;
the caller converts a confirmed disabled native spelling before supplying it.
Other confirmed native strings retain exact spelling. Placeholder reasoning
unknown, off, n/a, n-a, null, auto and latest (case-insensitive) is rejected rather
than mapped using invented evidence. Requested settings, hidden output and model
capability do not establish actual effective reasoning. Unknown optional effort
requires no mandatory question.

Full identity keys are JSON.stringify([agent, model, reasoning ?? null]) after
canonicalization. Exact tuples deduplicate and sort ordinally by agent, model,
then reasoning with absence first. Absent reasoning and confirmed none remain
different. Different commits have independent sets and may overlap; scripts do
not infer allocation from tasks or participant counts.

Each blocker has exactly id and reason. id is an opaque nonempty local key;
reason is a nonempty single line. IDs preserve exact spelling, including
surrounding whitespace, and must be unique within a ledger. Record known
required gaps or unresolved inclusion judgments as blockers until actually
resolved. Helpers never waive blockers using userExceptions or assessment
exceptionApplications; any blocker stops default output with exit 20.

Raw strings reject C0/C1 controls, CR/LF, NUL and Unicode line separators before
normalization. Agent fields cannot contain colons, parentheses or angle brackets;
model/effort cannot contain whitespace, parentheses or angle brackets. Model
colons remain data after the Agent separator; reasoning cannot contain colons.
Inputs are declarations: no evidence fetch, policy-script execution or private
session discovery occurs. Helpers never change refs, index, history or identity.

Summary schema 2 returns ledgerId, operation, tuples, blockers, issues,
limitations and exitCode. Issues retain each blocker's id and reason, and resolved
tuples remain available. No event provenance, participant accounting, effort
diagnostics or user exceptions are returned. Exit 0 completes the finite summary
against declared input; exit 20 reports known blockers; exit 2 reports malformed
input or scope mismatch. Other nonzero statuses indicate execution failure.
Matching declared scope does not establish live Git state or freshness; no result
authenticates facts, proves completeness or grants operation permission.
