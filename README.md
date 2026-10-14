# ai-commit-attribution

A reusable Agent Skill for recording AI assistance in Git commit messages with
verifiable Agent, model, and reasoning configuration identities.

The Skill is under development. Version 0.1.0 is Unreleased. The current payload
provides read-only policy scanning, operation-bound semantic routing checks,
a researched host registry and a participation summary. Message rendering and
validation are still being developed.

The intended workflow reads the actual repository's disclosure policy first.
When no applicable policy exists, it records participants using `Assisted-by`
trailers. Confirmed disabled native reasoning is recorded as `none`; unknown
effort is omitted. Agent product and host identities are maintained in a registry
so that separate conversations use stable names.

The generated [Skill directory](skills/ai-commit-attribution/SKILL.md) contains a
self-contained Node.js JavaScript entry compiled from TypeScript. For a first
policy check, read its [policy contract](skills/ai-commit-attribution/references/policy.md),
prepare explicit operation/context JSON files, then run:

```text
node skills/ai-commit-attribution/scripts/attribution.mjs policy scan --operation <operation.json> --context <context.json>
```

The scan reports candidates for the Agent to assess. Its bound semantic decision
can be checked with the same command and `--decision <decision.json>`. A current
repository-policy handoff skips default checks and leaves policy validation
unperformed. Incomplete evidence or changed scope requires a new decision.
Before summarizing declared participants, read the
[record contract](skills/ai-commit-attribution/references/records.md) and run
`summarize --input <ledger.json> --operation <operation.json>` using the same script.

Run this development checkout example from its root, or replace the script path
with an absolute installed payload path. The complete payload also runs outside
the source checkout without pnpm, TypeScript or node_modules. It requires stable
Node >=24.21.0 <25 and a supported Git installation for policy observations.
A summary reports declared evidence and gaps; it does not
validate repository policy, authenticate actual dispatch or authorize a commit.
User-level installation and real host acceptance follow the completed workflow.
Development uses exact pnpm 12.4.2 and Node 24.21.0 as the CI reproduction baseline.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for trusted setup and verification,
[AGENTS.md](AGENTS.md) for contributor entry instructions, and
[the policy migration record](docs/policies/migration.md) for the reference
repository's adopted obligations and project-specific exclusions.

Use Issues for ordinary questions and proposals. Before submitting a typed bug
or feature report, read the [current forms](.github/ISSUE_TEMPLATE/README.md) and
[Issue submission policy](docs/policies/commits-and-scope.md#typed-issue-submissions).
Freeform Issues remain available. Report suspected vulnerabilities
through [SECURITY.md](SECURITY.md). The project is licensed under [MIT](LICENSE).
