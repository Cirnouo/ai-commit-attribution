# User guide

ai-commit-attribution helps an Agent prepare and check Git commit disclosure
against the selected repository's AI policy. When no applicable AI disclosure
policy exists, it provides an evidence-based `Assisted-by` format. Preparing a
message does not authorize a commit, push or history edit.

This guide explains first use and results. The [Skill entry](../../skills/ai-commit-attribution/SKILL.md)
and its references own the runtime workflow. This page is source documentation;
it is not included in the installed Skill payload.

## Getting started

Use stable Node >=24.21.0 <25 and trusted Git in the environment that executes
the Skill. The runtime executable needs no pnpm, TypeScript loader, source
checkout or repository `node_modules`. Developer setup is separate and belongs
in [CONTRIBUTING](../../CONTRIBUTING.md).

### Install for Codex

Use the [official skills.sh CLI](https://skills.sh/docs/cli), pinned here to
`skills@1.7.2`. Before updating or replacing a customized existing target, follow
the [fixed-source installation gate](../acceptance/README.md#fixed-source-installation-gate).

```text
npx skills@1.7.2 add Cirnouo/ai-commit-attribution --skill ai-commit-attribution --agent codex --global --copy
```

This selects the named Skill from development `main` and installs a physical
user-wide copy in the executing home's `.agents/skills/ai-commit-attribution`.
`--agent codex` is the installer's target selection, not evidence of the acting
Agent's identity. The [version-pinned CLI documentation](https://github.com/vercel-labs/skills/blob/671e8c320810d36fed80fac5f1a2c1bf7e82d812/README.md#install-a-skill)
describes the source and scope options.

The installation channel is available while version 0.1.0 remains Unreleased.
Installing files does not establish automatic discovery, selected source,
loaded references or message-path execution on every host. The
[acceptance guide](../acceptance/README.md) records observed checks and limits.

Before host-specific discovery or loading, read
[host evidence](../../skills/ai-commit-attribution/references/hosts.md).
Confirm that Codex's executing backend can read the selected complete copy;
same-name sources may coexist. Then use the Codex invocation in
[Start a task](../../README.md#start-a-task).

### From a source checkout

Ask the Agent to explicitly read
[`skills/ai-commit-attribution/SKILL.md`](../../skills/ai-commit-attribution/SKILL.md)
from the accessible checkout and follow its before-use links to the conditional
references. Then identify and work on the actual selected target worktree,
operation and paths. The target can be a different repository from this source
checkout; locating the Skill does not select a Git operation or its scope.

A checkout is not an installation. Explicitly reading the source Skill does
not establish automatic discovery or loading. For human integration or explicit
helper inputs, read the [integration guide](../../skills/ai-commit-attribution/references/integration.md)
before preparing those inputs; it owns the JSON and CLI walkthrough.

### From an existing Skill copy

Confirm that the executing backend can access the complete copy, including
`SKILL.md`, its references and `scripts/attribution.mjs`. Check the backend's
filesystem, home and permissions: a local desktop copy may be inaccessible to
a remote, WSL, container, cloud or different-user backend.

Before host-specific discovery, loading, identity acquisition or native-question
use, read [host evidence](../../skills/ai-commit-attribution/references/hosts.md).
Use the invocation or explicit-read method documented for that host; do not
assume every host supports `$ai-commit-attribution`. Confirm the selected copy
and actual body/reference reads rather than relying on a catalog entry alone.

## Understanding results

### Repository policy comes first

Before scanning, deciding policy applicability or checking freshness, read the
[policy contract](../../skills/ai-commit-attribution/references/policy.md).
The Agent reads applicable rules and decides their meaning and precedence;
the scanner supplies candidates.

An applicable repository AI disclosure policy applies exclusively. Its alternate
format, AI coauthor, marker-only or no-disclosure rule replaces the whole default
disclosure workflow, even when the policy is partial. Ordinary commit-format
rules alone still allow `skill-default`. That name describes the Skill's
fallback disclosure workflow, not a Git branch. An unresolved relevant rule,
conflict or read problem stops automatic continuation instead of selecting a
default silently.

### Default disclosure uses actual participation

On `skill-default`, read the
[record contract](../../skills/ai-commit-attribution/references/records.md)
before collecting participation inputs or interpreting summaries. Records cover
actual relevant planning, research, delegation, implementation, review, tests,
fixes and integration, including participants who did not edit files. Unused
installed tools and configured models are not participants.

Before rendering, validating or interpreting message results, read the
[message contract](../../skills/ai-commit-attribution/references/messages.md).
The default trailer has one of these forms; angle brackets mark placeholders,
not values to copy:

```text
Assisted-by: <canonical Agent host>:<actual formal Model>
Assisted-by: <canonical Agent host>:<actual formal Model> (<confirmed native effort>)
```

Unknown optional effort is omitted without a mandatory question. Confirmed
disabled native reasoning is `none`. The actual host, formal model and effective
configuration belong to each participation event; the current integrator's
settings cannot fill another participant's or historical event's record.

### A successful helper check has a bounded meaning

Default completion checks the declared evidence; it does not authenticate
dispatch, prove that every participant was named or grant Git authorization.
A repository-policy handoff skips default checks and leaves the integrator to
check the actual repository rule. The
[message result meanings](../../skills/ai-commit-attribution/references/messages.md#commands-and-results)
explain those separate outcomes and exit statuses.

Concrete required host/model, known-participant or policy gaps stop automatic
continuation. Recover trustworthy evidence within the operation's authority or
obtain a genuine current user decision where the contracts allow one. A pending
question, timeout, cancellation or unavailable question tool is not an answer;
preserve the work and index. Recheck scope, evidence and existing authorization
after a response or material change. See
[questions and scoped exceptions](../../skills/ai-commit-attribution/references/messages.md#questions-scoped-exceptions-and-actual-operations)
before applying a decision; an exception is not verified identity or new Git
authorization.

## Common questions

**Why is the Skill not discovered or readable?** Use the
[existing-copy checks](#from-an-existing-skill-copy) to confirm the executing
backend's filesystem, home, permissions, project base, version and selected
same-name source. File presence or advertised metadata alone does not prove
loading. Where the host's documented method permits, explicitly read the
accessible `SKILL.md` and required references. For an inaccessible backend,
report the filesystem or sync gap and use an accessible copy within existing
authority. Before changing a copy or host configuration, read the
[host-specific integration guidance](../../skills/ai-commit-attribution/references/hosts.md#consumers-and-minimal-integration)
and obtain applicable authorization for that external change.

**Why is there another format or no `Assisted-by` trailer?** Read the selected
repository AI policy and the
[policy contract](../../skills/ai-commit-attribution/references/policy.md).
An applicable alternate-format or no-disclosure rule owns the entire workflow;
do not add the default trailer to it. A repository handoff still needs its
separate actual policy check.

**What should I do when evidence is missing?** Identify the concrete issue in
the result. Recover the applicable policy source, actual dispatch/handoff
record, routed-model mapping or named participant event as relevant. Before
identity acquisition, read [host evidence](../../skills/ai-commit-attribution/references/hosts.md);
before preparing replacement records, read the
[record contract](../../skills/ai-commit-attribution/references/records.md).
Do not guess a model from a product name or copy the parent Agent's settings.
If a required gap remains, follow the
[decision procedure](../../skills/ai-commit-attribution/references/messages.md#questions-scoped-exceptions-and-actual-operations).
Unknown optional effort alone needs no mandatory question.

## Further reading

- [Host evidence](../../skills/ai-commit-attribution/references/hosts.md):
  discovery, loading, identity acquisition and native questions; read before
  those host-specific operations.
- [Integration guide](../../skills/ai-commit-attribution/references/integration.md):
  human integration and explicit JSON/CLI inputs; read before preparing them.
- [Policy contract](../../skills/ai-commit-attribution/references/policy.md):
  applicability, scope and freshness; read before scanning or routing.
- [Record contract](../../skills/ai-commit-attribution/references/records.md):
  participation and evidence; read before collecting inputs or interpreting summaries.
- [Message contract](../../skills/ai-commit-attribution/references/messages.md):
  previews, validation, signatures and decisions; read before those operations.
- [Acceptance guide](../acceptance/README.md): portable reproduction,
  observed results, installation gates and unverified paths.

## Get help or contribute

[Ordinary Issues](https://github.com/Cirnouo/ai-commit-attribution/issues) remain
available for questions and reports. Before submitting or editing a typed Bug
or Feature Issue, read the [current forms](../../.github/ISSUE_TEMPLATE/README.md)
and [typed submission policy](../policies/commits-and-scope.md#typed-issue-submissions).
Use [SECURITY.md](../../SECURITY.md) for private vulnerability reporting.
For contributor setup and changes, start with [CONTRIBUTING](../../CONTRIBUTING.md).
