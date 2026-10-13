# Participation record contract (schema 1)

Before preparing a ledger, obtain trustworthy actual work, dispatch and handoff
records. Include planning, research, delegation, implementation, review, tests,
fixes and integration, even without file edits. Exclude installed unused tools,
unused configured models and unrelated history. Keep secrets and private
transcripts out of all fields. JSON evidence is a declaration, never proof that
its source is authentic or that every actor has been disclosed.

Supply two JSON files explicitly. The ledger has schemaVersion 1, operation,
knownParticipants, events and userExceptions. The independently supplied current
operation has schemaVersion 1, id, repository, worktree, commonGitDir, kind,
paths and targets. All fields are required; no extra fields are accepted.

Operation id is an opaque local key. repository and worktree identify the active
physical worktree, may be equal, and must be existing physical absolute
directories. commonGitDir is the required physical absolute shared Git metadata
directory, including linked-worktree and separate-Git-directory layouts. Do not
infer a primary checkout from .git ancestry. kind is commit, amend, rebase,
cherry-pick or squash. paths is an explicit list of repository-relative paths
using forward slashes; targets is a list of unique roles and resolved lowercase
40- or 64-digit hexadecimal objectIds. Empty paths/targets remain explicit.
Paths, target order and duplicate paths are canonicalized before complete scope
comparison by ordering/deduplication only. Filename whitespace is preserved;
for example, " report.md" and "report.md" select different paths. An empty
path string is invalid; nonempty whitespace filenames remain representable.
A materially changed operation requires a fresh id. Matching JSON
does not establish live Git state or freshness.

knownParticipants is a list of objects with id and eventIds. It is the
integrator's explicit actual participant inventory. Every event present also
enters summary accounting, even if omitted from that list. Missing named events
and participants without an attributable event are concrete gaps. IDs are local
association keys, not authenticated identities. Operation, participant and event
IDs and their references preserve exact spelling, including surrounding
whitespace; empty or whitespace-only IDs are invalid. Whitespace-distinct IDs
never join or enrich each other.

Each event has id, participantId, task, reasoning and evidence. Optional agent,
host, model and modelRoute carry candidate identities. One effective identity
period has one event id; actual host/model/configuration changes create new
events. Repeated handoffs may use one id only for the same participant and task
within this operation. Historical records survive handoff/compaction; a current
integrator or parent model never fills another event's fields.

reasoning is either {"state":"unknown"} or {"state":"confirmed","value":"high"}.
Enabled native values are preserved exactly. Confirmed effective native
disablement uses none even when its observed native spelling is off or 0; raw
observations remain in source records. Unknown, requested off, hidden output, virtual/router levels, model
capability and unsupported settings never establish effective disablement.
Optional uncertainty/conflict omits effort with diagnostics and never blocks
required identity. Preserve adapter fallback/clamping observations in evidence.

Each evidence item has fields, kind, observation and reference; detail,
nativeReasoning and mapping are optional. fields names agent, host, model or
reasoning. kind is a nonempty source description (such as handoff or runtime
metadata); it has no global authority ranking. observation is effective,
requested, capability or display. reference is minimal necessary provenance,
never an executable locator. Effective declarations can support their event's
candidate fields. A nonempty source or self-description cannot authenticate
them; the integrator must establish trustworthy provenance externally.

Reasoning evidence must declare nativeReasoning enabled or disabled to support
the corresponding effective value. For routed models, modelRoute preserves the
original route and an effective model evidence item must supply mapping with
matching route and formal model values. All effective same-event model
candidates and mappings participate in resolution. Their formal model values
must agree, each mapping must agree with its record's supplied candidate/route,
and every declared effective route needs matching same-event mapping evidence.
A record without its own route can use the same event's declared route.
Compatible repeated records may supply missing mapping evidence; incompatible
effective declarations remain required conflicts (exit 20) with no resolved
tuple. Requested, capability and display mappings do not establish or override
effective dispatch. Verify the supplier mapping externally;
public support tables establish capability only. Preserve formal supplier model
punctuation/version/snapshot exactly. The explicit missing-model markers auto,
latest, unknown, N/A and null are matched case-insensitively and remain
unresolved; this bounded marker check is not a supplier model catalogue. Provider,
Agent product and gateway identities are different roles.

Use exact registry names/aliases. familyAliases maps only registered family
variants and never selects a host by itself. Bare ambiguous family names need a host whose
effective evidence selects a registered entry in that same family. A role such
as reviewer never names a product. Do not infer Desktop from a desktop-control
tool, SDK or RPC interface. The registry's source evidence establishes documented
identity/discovery, not this run's host/model/effort or actual Skill loading.

Compatible repeated records enrich only the same event. Conflicting required
Agent/model observations remain unresolved. Resolved tuples deduplicate by
(canonical Agent host, formal model, confirmed reasoning or absent), preserve
all participant/event provenance, and sort by ordinal strings with absent
effort first. Absent effort and none are different. A summary never renders a
trailer or erases conflicting source records.

userExceptions remains separate from identity evidence. Each item has operationId,
issueIds, decision and reference. It must reference this operation and actual
summary issue IDs. Issue IDs are JSON-encoded component arrays: event issues use
["event", eventId, field], missing-event issues use
["participant", participantId, "event", eventId], and missing-participant-event
issues use ["participant", participantId, "events"]. Use the returned ID string
verbatim in issueIds; delimiter concatenation cannot identify opaque components.
It records a declared explicit user decision for those issues;
it neither erases a gap nor proves consent, and cannot become a permanent
default. Later application requires checking the actual user decision, current
scope and existing operation authorization. A request, timeout, failed question
or cancellation is not consent. Unknown optional effort needs no question.

Raw strings reject C0/C1 controls, CR/LF, NUL and Unicode line separators before
trimming or resolution. Identity fields must be unambiguous for single-line
attribution; model/effort cannot contain whitespace, colon, parentheses or angle
brackets. Inputs are data: no evidence fetches, policy script execution or private
session discovery occurs. The read-only command never changes Git refs, index,
history or identity configuration.

Exit 0 means the summary goal completed against declared evidence. Exit 20 means
a required identity/known-participant gap or mandatory conflict remains; output
retains resolved tuples and concrete issues. Exit 2 means malformed input or
scope mismatch; other nonzero statuses mean execution failure. JSON includes
scope, stable tuples, source records, participant accounting, issues, optional
effort diagnostics, separate exceptions and explicit limits. None of these
states is repository-policy validation or permission to commit.
