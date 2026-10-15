---
name: ai-commit-attribution
description: Use when preparing or modifying Git commit messages, including authorized wrapper, explicit-path, amend, rebase, cherry-pick, merge or squash operations.
---

# AI commit disclosure

Apply this workflow before preparing or changing a commit message, including
through wrappers or tools. It does not authorize a commit, push or history edit.

Resolve the actual repository, worktree, operation, selected paths and targets.
Before finding rules, deciding applicability or reviewing a decision after a wait
or change, read the [policy contract](references/policy.md). The Agent finds and
reads relevant rules using meaning and context, resolves precedence and supplies
an explicit repository-policy, skill-default or needs-decision decision. Helpers
consume that decision without discovering policy or establishing freshness.

Repository policy applies exclusively. Its AI coauthor, alternate-format,
no-disclosure or marker-only rule replaces the entire default disclosure branch,
including default identity, registry, participation and AI-coauthor restrictions.
Do not supplement a partial AI policy. Ordinary commit-format rules alone permit
the default branch. An unresolved known rule, conflict or read problem requires
a decision, rather than a silent fallback. Repository handoff skips defaults;
the integrator checks the actual repository criteria separately.

On skill-default, before collecting inputs or interpreting summaries, read the
[record contract](references/records.md). Include every actual relevant participant
in planning, research, delegation, implementation, review, tests, fixes and
integration. Confirm actual host, formal model and effective configuration for
each included identity; never fill a child or historical identity from the
integrator's current settings. Use the [registry](references/agent-registry.json)
for exact canonical hosts and aliases. For host identity acquisition, discovery,
loading or native-question capabilities, first read [host evidence](references/hosts.md).

Default records use Assisted-by with a canonical host and actual formal model.
Preserve confirmed native effort; confirmed disabled native reasoning is none.
Unknown optional effort is omitted without a mandatory question. Missing required
Agent/Model, conflicting required evidence or a concrete known-participant gap
stops the operation: recover evidence within authority, then request the decision.

Inspect the actually exposed, mode-permitted native question facilities and use
an available nonterminal one. Wait for the actual human answer. Unavailable,
failed, cancelled or noninteractive questioning stops automatic continuation;
report the concrete gap and preserve work/index. A request, timeout, pending or
automatic selection is not an answer. A genuine answer can resolve facts or inclusion judgment; it is never verified
identity or new Git authorization. Known required gaps remain ledger blockers
until resolved, and default helpers provide no exception continuation.

For a local planned-commit lifecycle, before initializing state, selecting or
recording a ledger, running prepare/finish, pausing, recovering, replacing, transferring, rebinding or
clearing a plan, read the
[ledger contract](references/ledgers.md). It owns persistent worktree selection
and failure recovery. Carry the exact ledger ID through delegation and handoff;
missing or inconsistent state requires an explicit recovery decision.
Before deleting or archiving a worktree, use that contract's export and removal
check procedure for unfinished ledgers. Worktree-local state shares its lifetime.

Before render, validate, signature assessment or migration, read the
[message contract](references/messages.md). Inspect concrete automatic-signing
evidence as data; preserve human coauthors, body and unrelated trailers. Helpers
preview/check and may create an explicit new message file; they never commit,
push, rewrite refs/index/history, change Git identity/configuration or execute
repository policy scripts. Mechanical success cannot authenticate dispatch,
complete participation or consent. Exit 10 remains an unverified repository
handoff; 20 needs a decision, 2 is invalid input, and execution failures stop.

Before a separately authorized real operation, recheck scope and authority.
Afterward read its final committed message and current operation evidence;
check the applicable rule again. A host/hook mismatch stops later actions.
Do not automatically amend, roll back, push or rewrite history to repair it.
For a prepared local output, follow the ledger contract to review and finish the
exact SHA. A successful Git exit alone does not seal or consume the ledger.

For human integration and the explicit JSON/CLI workflow, read the
[first-use guide](references/integration.md). Run the single [executable](scripts/attribution.mjs)
with supported stable Node >=24.21.0 <25 and trusted Git. Render previews by
default; validate is read-only. No pnpm, TypeScript loader, source checkout or
repository node_modules is required at runtime.

The payload contains its own [MIT license](LICENSE), honest [runtime notices](THIRD-PARTY-NOTICES.txt)
and the references above. Installation, discovery, loading and actual message-path
execution are separate evidence states; file presence does not enforce every commit.
