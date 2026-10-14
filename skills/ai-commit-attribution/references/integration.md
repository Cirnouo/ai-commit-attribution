# First use for an integrator

Use this guide when preparing explicit CLI inputs, including human integration.
The [policy](policy.md), [record](records.md) and [message](messages.md) contracts
own the exact schemas and result meanings. [Host evidence](hosts.md) owns
discovery, identity acquisition and mode-specific question capabilities.

The installed executable needs stable Node >=24.21.0 <25 and trusted Git, with
no source checkout or package installation. Use its absolute path from any
working directory. Keep input/output scratch files separate from the business
repository's selected paths. These commands prepare messages; the integrator
retains responsibility for any separately authorized Git operation.

## Establish the actual scope

Identify the active physical worktree and shared Git metadata directory using
the actual invocation and trusted Git observations. Account for explicit Git -C,
Git-directory/worktree arguments, wrapper selection and replay targets. Do not
infer a primary checkout from .git ancestry. Replace the generic paths below
and the selected path list with actual observations; it is a commit example,
not a template for amend/replay/squash targets.

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

context.json:

```json
{
    "schemaVersion": 1,
    "phase": "prepare",
    "selection": "index",
    "invocation": {
        "kind": "agent-context",
        "reference": "current task and actual invocation evidence",
        "effectiveDirectory": "/absolute/path/to/worktree"
    }
}
```

Run the scan and retain its complete JSON result:

```text
node <installed>/scripts/attribution.mjs policy scan --operation operation.json --context context.json
```

Read the applicable candidates and known relevant sources. Prepare decision.json
under the policy contract: copy the returned operation/binding, assess every
candidate, select the applicable policy IDs and explain scope/precedence. The
scanner does not make that judgment. An unresolved relevant source requires a
decision. Check the decision against fresh observations:

```text
node <installed>/scripts/attribution.mjs policy scan --operation operation.json --context context.json --decision decision.json
```

## Supply participation on the default branch

Only when the current route is skill-default, prepare ledger.json. Copy the
same actual operation object into its operation member; supply schemaVersion 1,
knownParticipants, events and userExceptions. This one-event fragment illustrates
shape, not a complete participant inventory or default identity. Replace the
angle-bracket values with trustworthy actual information and repeat for all
relevant participants, including research/review/test-only work:

```json
{
    "knownParticipants": [{ "id": "actor", "eventIds": ["event-1"] }],
    "events": [
        {
            "id": "event-1",
            "participantId": "actor",
            "task": "implementation",
            "agent": "<actual canonical host>",
            "model": "<actual formal model>",
            "reasoning": { "state": "unknown" },
            "evidence": [
                {
                    "fields": ["agent", "model"],
                    "kind": "actual dispatch or handoff",
                    "observation": "effective",
                    "reference": "<minimal trustworthy provenance>"
                }
            ]
        }
    ],
    "userExceptions": []
}
```

The record contract explains routed-model mappings, confirmed native settings,
same-event enrichment and exact issue references. A real host/model change gets
a new event. Preserve unknown optional effort instead of copying another event's
value. JSON provenance declarations are not authentication. For a concrete
required gap, recover the evidence or obtain the genuine current decision before
continuing; free-text exception records alone do not clear summary issues.

```text
node <installed>/scripts/attribution.mjs summarize --input ledger.json --operation operation.json
```

## Preview, check and observe the result

Start message.txt with the intended title/body and existing human/unrelated
trailers. On a current repository-policy route, omit default ledger/assessment
inputs and prepare the repository-required message. The helper's exit 10 leaves
repository criteria unverified; record the actual separate check against the
selected rule and exact message. Do not demand a default model on that route.

```text
node <installed>/scripts/attribution.mjs render --message message.txt --operation operation.json --context context.json --decision decision.json --input ledger.json
node <installed>/scripts/attribution.mjs render --message message.txt --operation operation.json --context context.json --decision decision.json --input ledger.json --output new-message.txt
node <installed>/scripts/attribution.mjs validate --message new-message.txt --operation operation.json --context context.json --decision decision.json --input ledger.json
```

The first command returns a JSON preview. The second explicitly creates an
absent new file; it never overwrites message.txt. Inspect the result dimensions
and process exit, rather than treating every nonzero value alike. Required
decisions/errors stop continuation; a failed publication can leave an uncertain
artifact at the explicit output path. See the message contract for signatures,
authorized migration, scoped exceptions and output safety.

Before acting, refresh scope, participation evidence and existing authorization,
including changes while waiting. After an authorized operation, read the final
committed message and current evidence, then check the actual applicable rule.
A rewritten result stops follow-up work; repair needs its own authority.

For portable source tests and optional native exercises, see the repository's
[acceptance guide](https://github.com/Cirnouo/ai-commit-attribution/blob/main/docs/acceptance/README.md).
It distinguishes real Git, copied-bundle, Agent and host evidence. It is source
contributor documentation; this installed guide does not require a source checkout.
