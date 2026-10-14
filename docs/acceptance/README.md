# Acceptance and portable reproduction

This directory owns the finite [raw scenario corpus](scenarios.json), its
reproduction recipes and the original eighteen-requirement evidence map.
The [documentation policy](../policies/documentation.md#portable-content-and-public-evidence)
owns portable content/public evidence. Runtime rules remain in the generated
Skill's [policy](../../skills/ai-commit-attribution/references/policy.md),
[record](../../skills/ai-commit-attribution/references/records.md) and
[message](../../skills/ai-commit-attribution/references/messages.md) contracts.
The [host reference](../../skills/ai-commit-attribution/references/hosts.md)
owns official discovery/loading/identity/question evidence.

## Deterministic reproduction

Check out the desired full source commit and follow the trusted setup in
[CONTRIBUTING](../../CONTRIBUTING.md). Use supported Node and Git from that
environment; no particular maintainer's directory or private receipt is needed.
The following commands run isolated synthetic repositories, not user projects:

```text
node --test tests/skill-integration.test.ts
node --test tests/identity-records.test.ts tests/identity-records-review.test.ts
node --test tests/policy-routing.test.ts tests/policy-safety.test.ts tests/policy-operations.test.ts tests/policy-review-fixes.test.ts
node --test tests/message-attribution.test.ts tests/message-review-fixes.test.ts tests/message-output.test.ts
pnpm --ignore-pnpmfile --config.configDependencies={} test:distribution
```

[skill-integration.test.ts](../../tests/skill-integration.test.ts) is the finite
fixture materializer and copied-bundle command recipe. It consumes scenarios.json,
derives physical paths under os.tmpdir(), creates synthetic Git identities only
inside those repositories and runs the copied scripts/attribution.mjs from a
different directory with module/configuration injection removed. It supplies
explicit operation/context/decision/ledger files; decisions are test-specific
semantic fixtures, not a keyword classifier. It snapshots HEAD/refs/index,
configuration, selected worktree bytes and status around helper calls.

scenarios.json has seven task requests and fifteen independent fixtures. Its
policy/message strings are literal inputs, including the CRLF preservation case.
eventProfiles are synthetic raw event facts; the materializer adds explicitly
synthetic evidence records and joins the current fixture operation. They are not
production ledgers or claims of official model availability. A real Agent
exercise adds its actual current identity separately from trusted dispatch
evidence; neither the corpus nor a test runner supplies a current model default.

| Corpus flag / cases | Reproducible fixture preparation |
| --- | --- |
| body-only, required-ai-coauthor, no-disclosure, marker-only | Write the literal policy/message; provide the policy-specific semantic decision. no-disclosure deliberately lacks Model. |
| ordinary-format / alias | Use base event profile's exact Pi alias and supplied CRLF human/body/trailer bytes. |
| uncertain-policy | Keep the policy's adopted docs/review-decision.md absent; retain the resulting scan issue. |
| missing-participant | Add additionalFacts.missingParticipant to the known inventory without inventing its absent event. |
| unresolved-router / mapped-router | Use the corresponding event profile, including exact route/mapping facts and colon-bearing formal ID. |
| retained-participants | Use all six participant events; keep unusedProducts as separate inventory, never ledger events. |
| separate-effort-events | Use all five effort events, retaining effective/requested/display distinctions and event IDs. |
| changed-policy | Save the initial decision, replace only CONTRIBUTING with changedPolicy, attempt the old decision, then reassess the current rule. |
| known-host-signing | Adopt knownHostSigning as an exact additional candidate; the test supplies an exact current signature assessment. Do not execute it. |
| raw-field-control | Preserve the injection profile's raw newline; do not sanitize it into a different input before testing rejection. |
| final-hook-rewrite | A trusted disposable integrator installs the static fixture hook and commits the candidate first. Inspect its persisted final body and halt follow-up on mismatch; the helper never makes or repairs the commit. |

The materializer renders/validates/rerenders successful defaults, exercises
exclusive repository handoffs and checks fresh reassessment after staleness.
It provides positive and negative assertions rather than matching instruction
headings. The ordinary-format case includes a body divider to test byte preservation.

## Optional native exercises

These require explicit bounded authorization and an actually available host.
They do not run in default CI and are separate from the deterministic suite.
Create fresh isolated fixtures using the public materializer's setup recipe and
raw facts. Give an evaluator only its selected task request, the minimum raw
fixture/handoff files and actual execution authority. Keep this acceptance map,
expected outcomes and scoring material outside its workspace/context.

For a helper-assisted control, expose only the generated business executable,
registry and licenses; physically exclude target SKILL.md and instruction
references/catalog availability. For a with-Skill exercise, expose the complete
approved payload and record actual body/conditional-reference reads. Preserve
comparable tool/environment restrictions. Do not weaken sandbox controls to
force a successful native run, invoke another model implicitly, or send staged
questions to a real user merely to fill an evidence cell.

Record the host/interface/version, trusted actual evaluator configuration,
source commit and public corpus revision/digest, prompts/input hashes, actions,
candidate/final messages, Git effects, actual question outcomes and limits.
Manually assess concrete results, including positive completion and negative
non-action. A tool listing, final promise or notification proves no human answer.
Inspect every exposed mode-permitted synchronous/asynchronous facility before
claiming availability; an unused Plan-only synchronous tool cannot establish
that Default lacks a usable asynchronous one. Available-answer, unavailable,
failed, cancelled, pending and timeout paths remain separate observations.

## Observed helper-assisted control

On 2026-10-14, merged helper baseline
d8538e3bbe590272e5972b8bc09bf58566708a2b was exercised on Windows with Node
24.21.0/Git 2.56.0.windows.2, in seven fresh Codex App contexts dispatched as
gpt-6.1-sol/high. All fifteen targeted core cases behaved correctly without
target Skill guidance: nine authorized fixture commits and six justified stops.
Independent raw comparison confirmed all nine final messages matched their
candidates byte-for-byte, including CRLF. Six stops preserved complete business
state; all fifteen preserved configuration/identity and worktree inventories.
The source checkout and observed user-state guards were unchanged. This is a
finite helper-assisted baseline, with no demonstrated behavioral failure or
completed-Skill improvement claim.

The historical raw task-definition SHA-256 is
a8596820e83da7bf9ad90b64922868e4d447fa47e4aef3467991180ebe215e0c.
This directory publishes a portable derivative: task/fixture text is retained,
the current-actor notice is generalized, and finite event facts/materialization
recipes are supplied. It is not a byte-identical copy of the historical private
execution envelope. Reproduce the public cases from this source; private
receipts or scripts are not required authorities or prerequisites.

A separate Codex CLI invocation generated output under gpt-6.1-sol/high but
execution policy rejected all reads. It performed no fixture/business exercise
and is neither a behavioral pass nor failure. Native questions were not called
in the App control. Follow-up inspection confirmed that the original
missing-participant invocation exposed only a Plan-only synchronous question
tool in Default mode, with no async facility. Other actors' exact question-tool
definitions were not retrospectively verified. The initial CLI report described
an async facility but did not call it. Real answer/failure/cancel/timeout outcomes
remain unverified; staged human contact was outside fixture authority.
Repeated-render Agent idempotence was also not exercised there; deterministic
rerender tests provide separate evidence.

## Observed full-Skill retest

On 2026-10-14, the PR7 source snapshot built on baseline
d8538e3bbe590272e5972b8bc09bf58566708a2b was exercised on Windows with Node
24.21.0/Git 2.56.0.windows.2 in seven fresh Codex App contexts dispatched as
gpt-6.1-sol/high. Agents explicitly read the copied complete ten-file Skill
payload; it was neither advertised in the host catalog nor canonically installed.
The payload manifest SHA-256 was
30925aea8b4293b51c1cef2f600bad4242065354854184ee15bc1b43ede27c4d.
All fifteen targeted core cases behaved correctly: nine authorized fixture
commits and six justified stops. The helper-assisted baseline also passed all
fifteen, so this comparison demonstrates no causal improvement from Skill guidance.

Raw final-message comparison confirmed that all nine persisted messages matched
their candidates byte-for-byte, including CRLF. All fifteen fixtures preserved
business-file bytes, configuration and identity; the six stops preserved complete
business state. Source-checkout and observed user-state guards were unchanged.
These are bounded, non-atomic observations, not a claim of complete host or
environment coverage. The public corpus and recipes above separately support
reproduction from source.

No Agent second render or actual native question call was exercised. Real answer,
failure, cancellation and timeout outcomes remain unverified. Deterministic
rerender checks remain separate evidence.
The earlier native CLI attempt was execution-blocked, neither a behavioral pass
nor failure. This retest establishes no public GitHub source acquisition,
canonical installation, automatic host discovery or verification of all hosts.

## Original eighteen requirements

These IDs retain their original meaning. Source tests and corpus cases identify
reproduction, while control observations describe the bounded helper-assisted run above.
They do not turn mocks, source assertions or copied bundles into real host
discovery, native questions or immutable-source installation evidence.

| ID | Requirement / deterministic reproduction | Actual control evidence and limits |
| --- | --- | --- |
| 1 | Alternate format only: body-only; policy-safety and message bypass tests | Body-only fixture committed exact repository declaration, no default field. |
| 2 | Repository AI coauthor permitted: required-ai-coauthor; message bypass | Exact repository marker retained; default veto absent. |
| 3 | No/forbidden disclosure bypasses unknown model: no-disclosure | Subject-only commit; no default Model blocker. |
| 4 | Marker-only rule owns branch: marker-only | Complete marker rule accepted without a replacement default. |
| 5 | Ordinary rules allow compatible default: ordinary-format | CRLF/body/human trailer preserved; actual alias resolved. |
| 6 | Unresolved known policy requires decision: uncertain-policy; policy-safety | Missing adopted rule stopped; no silent default. Real native interaction unexercised. |
| 7 | Known Agent/Model single-line output: ordinary-format/mapped-router | Observed supported records and exact mapped model punctuation. |
| 8 | Known native effort / unknown omission: separate-effort-events; identity records | Absent/high/none retained; requested/display did not establish disablement. |
| 9 | Required gaps stop: missing-participant/unresolved-router; message gap tests | Concrete reviewer/router gaps stopped without guessed identity or participant loss. |
| 10 | Exact aliases/formal model spelling: ordinary-format/mapped-router; identity review tests | Host-context alias and amazon.nova-micro-v1:0 preserved. Other host runtime acquisition unverified. |
| 11 | All relevant roles/children: retained-participants; identity records | Planning/research/review/test/implementation/integration retained; unused inventory excluded. No omniscient coverage claim. |
| 12 | Distinct models/efforts and tuple dedup/order: participant/effort profiles | Four participant tuples and three effort tuples retained in the historical control; public synthetic profiles exercise the same invariants. |
| 13 | No cross-event effort borrowing: separate-effort-events; identity review tests | Unknown/requested/display events stayed unspecified. |
| 14 | Session/model/repository scope isolation: changed-policy, policy-operations, identity records | Old policy binding rejected, fresh rule used, pre-existing unstaged policy bytes preserved. Other host extraction unverified. |
| 15 | Native available/unavailable/failed/cancelled outcomes | Only required-gap non-continuation observed. No real question call/answer/cancel/failure/timeout; inspect actual async and sync availability. |
| 16 | Idempotence and byte preservation: ordinary-format, message byte tests, corpus rerender | Nine persisted messages byte-identical to candidates; Agent second-render unexercised. Copied-bundle repeated render is separate. |
| 17 | Injection/signing conflict: raw-field-control/known-host-signing/final-hook-rewrite | Raw newline rejected, effective synthetic signing stopped, persisted hook mismatch rejected without repair. No real vendor-signing claim. |
| 18 | Failure/wait preserves state: negative cases, message-output and Git snapshots | Six negative fixtures unchanged; nine positives changed only authorized commit state. Actual user/source guards unchanged; observations are non-atomic. |

All 23 researched consumers still require their own installation, discovery,
selected-source, loaded-reference and message-path evidence. Copied external
business execution establishes Node/Git-only portability, not GitHub acquisition
or any host's automatic invocation. Platform CI and optional live-host exercises
must report the precise version/path category actually exercised.

## Fixed-source installation gate

Final official-source installation follows all seven merged PRs and passing main
CI, at a selected full immutable source SHA. Use the already audited installed
skills 1.7.2 CLI after checking its original nineteen-file identity/inventory.
No fresh npx resolution is part of this verification. In an isolated executing
home/state/cache/temp/cwd, the exact selection shape is:

```text
node <audited-skills-package>/bin/cli.mjs add https://github.com/Cirnouo/ai-commit-attribution/tree/<full-source-SHA>/skills/ai-commit-attribution --skill ai-commit-attribution --agent codex --global --copy --yes --json
```

Probe the actual child's home/tmp/cwd and relevant host/XDG paths before use.
Remove credential/module/config injection; observe actual public GitHub source,
commit, payload tree and exact complete bytes/licenses/links. The installer
overrides inherited GIT_ALLOW_PROTOCOL with a broader list: a parent HTTPS-only
value does not prove a universal transport sandbox. A controlled public-URL
recipe must reject alternate source inputs and prevent/observe SSH/auth fallback;
do not claim file transport globally disabled without evidence. Fail on an
unapproved fallback rather than substituting a local source or moving branch.

Official copy mode replaces targets, so do not run it directly over a customized
live Skill. Read existing target/shared lock, preserve a verified backup outside
discovery, validate a controlled candidate and update only the authorized own
record with concurrency/read-back checks that preserve other records. Re-run
actual installed business paths from another cwd without source/node_modules or
a TS loader. Version 0.1.0 remains Unreleased; installation authorizes no tag or
Release. No completed remote-source acquisition/user installation is claimed by
the helper-control record above.
