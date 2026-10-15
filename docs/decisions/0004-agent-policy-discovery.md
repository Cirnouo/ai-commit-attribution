# Agent semantic discovery and explicit policy decisions

Accepted 2026-10-15. This decision replaces [0002](0002-policy-routing.md) and
the scan/binding/candidate associations in [0003](0003-message-attribution.md).
Agents find and interpret applicable repository disclosure rules using natural
language meaning, actual operation scope, repository context and applicable
instructions. Helpers consume that judgment through a small explicit decision.
This makes responsibility visible instead of treating a finite discovery graph
and matching capture as proof that relevant natural-language rules were found.

A document's filename, extension, directory, title or link spelling cannot decide
whether it carries policy. Applicable instructions and known relevant sources
guide the Agent's reading, including references in unfamiliar forms. The Agent
resolves applicability and precedence; known relevant unread or inaccessible
rules, unresolved conflicts and required missing facts require needs-decision.
Searches assist discovery but establish no general completeness guarantee.

PolicyDecision schema 2 contains only its version/artifact envelope, Operation,
branch, rationale and decisionSource. The last field declares agent-semantic
provenance through a reference; it does not authenticate judgment or consent.
Operation, participation ledger, registry and summary remain schema 1. Matching
explicit operations proves supplied-scope consistency, not current Git state.
There is no ScopeContext, policy scan command, candidate inventory, evidence
binding, freshness flag or automatic rescan in the helper contract. Old scan
commands and schema-1 policy decisions/assessments are rejected rather than
silently upgraded into a claim of current semantic review.

The three branches remain exclusive. repository-policy returns an unverified
handoff with exit 10 and never accesses default ledger, assessment or registry
inputs; the integrator checks the repository rule and exact message separately.
needs-decision returns 20 without a message preview or output file. skill-default
retains participation accounting, identity resolution, Assisted-by rendering,
signature safeguards and applicable exact exceptions, with exit 0 for a completed
message goal against declared evidence. A repository disclosure rule replaces the
whole default branch, including default identity requirements and AI-coauthor
restrictions; ordinary language/length/Conventional Commits rules alone do not.
Standalone summarize continues to summarize supplied participation evidence.

render and validate take an explicit Operation and schema-2 decision without
--context. Their schema-2 results report routing.branch without binding or
routing.freshness. MessageAssessment schema 2 joins exact message bytes and
explicit Operation; signatures identify either a message-record or an
automatic-signing reference. The helper checks record/event joins but never
reopens a provenance reference. Classification and modification authority remain
Agent declarations that the integrator must substantiate. The isolated Git
trailer process, exact byte preservation and narrow exception/migration guards
from 0003 remain; removing policy scans grants no broader editing authority.

Only render --output performs a trusted minimal Git lookup to locate actual
administrative directories for output protection. That lookup does not inspect
HEAD, the index, target commits, changed paths, file contents, disclosure rules
or hook/template configuration. Preview and validate do not query the target
repository through Git; default trailer interpretation still runs isolated from
it. Output creation keeps exclusive absent-file and alias/administrative-path
guards. Directory lookup is a path-safety operation, never a freshness check.

The trade-off is explicit: the helper can verify finite data shape, operation
consistency, message structure and output safety, but cannot prove semantic
discovery, live scope or current authority. The Agent must review relevant rules,
facts and authority before consuming decisions, after waits or material changes,
and before/after separately authorized real Git actions. Helpers never commit,
push, rewrite history, change Git identity/configuration or execute repository
policy scripts. The installed [policy](../../packaging/policy.md) and
[message](../../packaging/messages.md) contracts own those before-use procedures.

[Acceptance](../acceptance/README.md) distinguishes deterministic schema-2
declaration tests, finite actual Agent semantic reading and historical schema-1
host exercises. None establishes universal policy discovery or real host Git
behavior beyond its observed scope.

Partial successor accepted 2026-10-15: [0005](0005-planned-commit-ledgers.md)
replaces the event-based ledger/summary and message event joins with forward
schema-2 tuple ledgers/summaries and schema-3 message assessments/results, and
removes exception continuation. It extends Git observation beyond directory
lookup through a dedicated read-only prepare/finish result observer. Agent
semantic discovery, PolicyDecision schema 2, Operation/registry schema 1 and
exclusive routing remain; no policy scanner, automatic freshness claim or
authority authentication returns. The successor is an accepted design, not
evidence of implementation or successful verification at base `a1b0499`.
