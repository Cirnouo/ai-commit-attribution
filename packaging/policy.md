# Semantic policy decision (schema 2)

Before preparing or editing a commit message, identify the actual operation and
read this contract. The Agent finds and reads relevant rules using their meaning,
the task, repository context and applicable instructions. It decides applicability
and precedence, then supplies an explicit decision to the message helper.

## Find and apply the relevant rules

Start from the actual repository, worktree, invocation, operation, selected or
intended paths and targets. Account for explicit Git directories, working-directory
arguments and wrapper selection. A message-only amend still concerns the replaced
commit; replay, merge and squash concern the actual affected history and operation.
Do not infer a primary checkout from a .git parent or treat the Skill checkout as
the target repository. Read the [record contract](records.md) before preparing
Operation; its schema remains 1 and provides the shared explicit scope.

Use the repository's applicable ancestor/local instructions and task context to
find relevant disclosure rules and their referenced authorities. Follow known
relevant sources in the form they actually use. A file extension, directory name,
document title, link syntax or absence of matching links cannot determine whether
something is a policy document or prove that all relevant rules have been found.
Read definitions, hooks and templates as data when they are relevant; do not
execute repository scripts to discover policy or change configuration to satisfy it.

Repository AI disclosure policy applies exclusively. An applicable rule allowing
or requiring AI Co-authored-by, selecting another format, forbidding disclosure,
declaring disclosure unnecessary or restricting only one marker replaces the
entire default disclosure branch. Do not supplement a partial AI policy with
default identity, registry, participation or AI-coauthor restrictions. Ordinary
Conventional Commits, language and length rules alone permit the default AI
disclosure branch.

Explain how the read rules apply to this scope and resolve their precedence.
Known relevant unread, inaccessible or failed sources, uncertain applicability
and unresolved conflicts require needs-decision. Do not silently choose defaults
because a search found nothing, a reference could not be read or a question failed.
Recover the concrete evidence within existing authority, then obtain a genuine
current decision where needed. A request, timeout, cancellation or saved pending
question is not an answer and grants no Git authorization.

## Explicit decision

PolicyDecision has exactly these members:

```json
{
    "schemaVersion": 2,
    "artifact": "policy-decision",
    "operation": {},
    "branch": "skill-default",
    "rationale": "Explain the rules read, their applicability and precedence for this operation.",
    "decisionSource": {
        "kind": "agent-semantic",
        "reference": "Minimal provenance for the Agent's actual policy review."
    }
}
```

Replace the empty operation above with the complete schema-1 Operation supplied
separately to the helper. Their canonical explicit scopes must match. branch is
repository-policy, skill-default or needs-decision. rationale and the source
reference are nonempty single-line strings. Cite actual read evidence without
private transcripts or secrets. The reference is provenance; the helper does
not open it, retrieve sources or authenticate semantic judgment or consent.

Choose repository-policy when an applicable repository AI disclosure rule owns
the operation. Choose skill-default only after the semantic review establishes
that no applicable AI disclosure rule replaces it and no known relevant issue
remains. Choose needs-decision for an unresolved rule, conflict or required fact.
Decision routing checks the supplied decision's shape and scope and dispatches that
branch. It does not discover documents, inspect policy sources, capture Git state,
bind evidence or automatically rescan or establish freshness.

Before prepare or finish, read the [ledger contract](ledgers.md). Its narrow
read-only observer checks staged content and exact result objects for the
declared plan. That mechanical observation does not discover disclosure rules,
authenticate policy review or establish semantic freshness; this contract's
Agent review responsibilities still apply.

Before rendering, validating or interpreting message results, read the
[message contract](messages.md). repository-policy bypasses all default inputs
and checks and returns an unverified handoff (exit 10); the integrator separately
checks the actual repository rule and exact message. needs-decision returns 20
without a preview or output file. Only skill-default accesses participation,
registry and optional assessment inputs. Standalone summarize processes declared evidence and does not select policy.

Old policy scan commands, ScopeContext, binding, candidate assessments and
schema-1 policy decisions are unsupported inputs (exit 2). Recreate the decision
with the schema above and invoke render or validate with --decision, without
--context. Do not translate an old scan into a claim of current semantic review.
Operation and registry remain schema 1. Ledger and summary use schema 2;
message assessment and result use schema 3.

## Review after waiting or changes

The Agent rechecks scope, relevant rules, participation evidence and existing
authority immediately before consuming the decision, after a genuine answer or
wait and after material changes. A changed operation needs a fresh operation id
and consistent explicit inputs. Changed rules or facts need a new semantic
review and decision. Matching JSON cannot establish live state or freshness.

Before a separately authorized real Git operation, confirm the applicable rule
and intended message. Afterward read the final committed message and current
operation evidence and check that rule again. For a persistent prepared ledger,
use the ledger contract's exact-result review and finish procedure after that
review; the caller's declaration is not helper authentication. Report host/hook rewriting and
stop later actions on mismatch; do not automatically amend, roll back, push or
rewrite history. Helpers prepare/check messages and never commit, push, change
refs/index/history/identity/configuration or grant permission. File searches and
mechanical checks assist the Agent's review without proving completeness.
