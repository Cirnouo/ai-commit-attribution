# ai-commit-attribution

A reusable Agent Skill for recording AI assistance in Git commit messages with
verifiable Agent, model, and reasoning configuration identities.

The Skill is under development. Version 0.1.0 is Unreleased. Repository governance
is being established before the runtime Skill is developed or installed.

The intended workflow reads the actual repository's disclosure policy first.
When no applicable policy exists, it records participants using `Assisted-by`
trailers. Confirmed disabled native reasoning is recorded as `none`; unknown
effort is omitted. Agent product and host identities are maintained in a registry
so that separate conversations use stable names.

The planned distribution is a complete Skill directory with a self-contained
Node.js JavaScript entry compiled from TypeScript. Its runtime will require
supported Node.js and Git. Development requires stable Node >=24.21.0 <25 and
pnpm 12.4.2; the exact CI reproduction baseline is Node 24.21.0.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for trusted setup and verification,
[AGENTS.md](AGENTS.md) for contributor entry instructions, and
[the policy migration record](docs/policies/migration.md) for the reference
repository's adopted obligations and project-specific exclusions.

Use Issues for ordinary questions and proposals. Before submitting a typed bug
or feature report, read the [current forms](.github/ISSUE_TEMPLATE/README.md) and
[Issue submission policy](docs/policies/commits-and-scope.md#typed-issue-submissions).
Freeform Issues remain available. Report suspected vulnerabilities
through [SECURITY.md](SECURITY.md). The project is licensed under [MIT](LICENSE).
