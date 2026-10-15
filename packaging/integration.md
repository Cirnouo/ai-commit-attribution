# First use for an integrator

Use this guide when preparing explicit CLI inputs, including human integration.
Before deciding policy applicability, read the [policy contract](policy.md).
Before preparing participation inputs, read the [record contract](records.md).
Before rendering, validating or assessing signatures, read the
[message contract](messages.md). Those contracts own the exact schemas and result
meanings. Before host-specific discovery, identity acquisition or questions,
read [host evidence](hosts.md).

The installed executable needs stable Node >=24.21.0 <25 and trusted Git, with
no source checkout or package installation. Use its absolute path from any
working directory. Keep input/output scratch files separate from the business
repository's selected paths. These commands prepare messages; the integrator
retains responsibility for any separately authorized Git operation.

## Establish the actual scope and decision

Identify the active physical worktree and shared Git metadata directory using
the actual invocation and trustworthy evidence. Account for explicit Git -C,
Git-directory/worktree arguments, wrapper selection and operation targets. Replace
the generic paths and selected path list below with actual observations. This
is a commit example; use actual targets for amend, replay, merge and squash.

operation.json:

```json
{
    "schemaVersion": 1,
    "id": "current-operation",
    "repository": "/absolute/path/to/worktree",
    "worktree": "/absolute/path/to/worktree",
    "commonGitDir": "/absolute/path/to/shared-git-directory",
    "kind": "commit",
    "paths": ["path/to/changed-file"],
    "targets": []
}
```

Read the applicable repository instructions and relevant disclosure rules, resolve
their meaning and precedence, then prepare decision.json directly. Copy the same
complete operation object into its operation member. This shape illustrates a
default decision after that review; replace the example rationale and provenance
with the actual findings:

```json
{
    "schemaVersion": 2,
    "artifact": "policy-decision",
    "operation": {
        "schemaVersion": 1,
        "id": "current-operation",
        "repository": "/absolute/path/to/worktree",
        "worktree": "/absolute/path/to/worktree",
        "commonGitDir": "/absolute/path/to/shared-git-directory",
        "kind": "commit",
        "paths": ["path/to/changed-file"],
        "targets": []
    },
    "branch": "skill-default",
    "rationale": "Applicable instructions require ordinary commit formatting; the semantic review found no applicable AI disclosure rule or unresolved relevant source.",
    "decisionSource": {
        "kind": "agent-semantic",
        "reference": "Actual current-operation policy review and read sources."
    }
}
```

For an applicable repository AI rule choose repository-policy; for unresolved
relevant rules or facts choose needs-decision. The helper consumes this explicit
decision without searching for policy or reading the provenance reference. See
the policy contract for semantic review and review after waiting or changes.

## Supply participation on the default branch

Before managing persistent plans, read the [ledger contract](ledgers.md). Start
with the actual worktree, create and select a plan, then add its confirmed set:

```text
node <installed>/scripts/attribution.mjs ledger init --worktree <actual-worktree>
node <installed>/scripts/attribution.mjs ledger create --worktree <actual-worktree> --select --expect-version <returned-state-version>
node <installed>/scripts/attribution.mjs ledger add --worktree <actual-worktree> --ledger <returned-ledger-UUID> --input identities.json --expect-version <returned-state-version>
node <installed>/scripts/attribution.mjs summarize --current <actual-worktree> --operation operation.json
```

identities.json contains an identities array using the confirmed objects below.
Read each command's returned version and carry the exact ledger UUID through
handoff. For render or validate, replace --input ledger.json in the examples below
with --current <actual-worktree> or --ledger <selected-ledger-UUID>. The ledger
contract owns selector exclusivity, pause/resume, split/combine and failure recovery.

For the low-level explicit-input route on skill-default, prepare ledger.json with schemaVersion 2, a stable ledgerId
UUID and the same complete operation object in its operation member. Add the
confirmed identities and known blockers below. This fragment illustrates the
shape; determine actual inclusion and identity separately for this output commit.

```json
{
    "ledgerId": "00000000-0000-4000-8000-000000000001",
    "identities": [
        { "agent": "<actual canonical host>", "model": "<actual formal model>" }
    ],
    "blockers": []
}
```

The record contract owns canonicalization, exact tuple keys and blocker rules.
Omit unknown optional reasoning; use none only for confirmed disablement.
Relevant changes to host, model or confirmed effort produce distinct tuples.
Never borrow child/historical identity from the current integrator. Keep a known
required gap in blockers until resolved; no exception field bypasses it. The
helper cannot authenticate the caller's facts, inclusion judgment or authority.

```text
node <installed>/scripts/attribution.mjs summarize --input ledger.json --operation operation.json
```

## Preview, check and observe the result

Start message.txt with the intended title/body and existing human/unrelated
trailers. For skill-default, preview, optionally create a separate new file and
validate it using the same explicit decision:

```text
node <installed>/scripts/attribution.mjs render --message message.txt --operation operation.json --decision decision.json --input ledger.json
node <installed>/scripts/attribution.mjs render --message message.txt --operation operation.json --decision decision.json --input ledger.json --output new-message.txt
node <installed>/scripts/attribution.mjs validate --message new-message.txt --operation operation.json --decision decision.json --input ledger.json
```

The first command returns a JSON preview. The second explicitly creates an
absent new file; it never overwrites message.txt. Inspect the result dimensions
and process exit. Required decisions/errors stop continuation; a failed write
can leave an uncertain artifact at the explicit output path. Before supplying
an optional --assessment, read the message contract for signatures, authorized
migration and output safety.

For repository-policy, prepare the repository-required candidate and omit default
inputs. The helper preserves that candidate and returns exit 10, leaving actual
repository criteria unverified:

```text
node <installed>/scripts/attribution.mjs render --message message.txt --operation operation.json --decision decision.json
node <installed>/scripts/attribution.mjs validate --message message.txt --operation operation.json --decision decision.json
```

Check the actual repository rule and exact message separately. needs-decision
uses the same decision input and returns exit 20 without a preview or output file.
Before continuing after a wait, response or change or after a separately
authorized Git operation, follow the [policy review procedure](policy.md#review-after-waiting-or-changes).

For portable source tests and optional native exercises, see the repository's
[acceptance guide](https://github.com/Cirnouo/ai-commit-attribution/blob/main/docs/acceptance/README.md).
It distinguishes real Git, copied-bundle, Agent and host evidence. It is source
contributor documentation; this installed guide does not require a source checkout.
