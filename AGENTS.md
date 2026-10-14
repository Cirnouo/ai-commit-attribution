# Contributor entry point

Preserve unrelated work. Read all applicable ancestor and local AGENTS.md files
together; local instructions supplement parent instructions. Read only the
policies needed for the operation, using the before-use links below.

Before adding or changing tracked content or public verification evidence, read
[portable content and public evidence](docs/policies/documentation.md#portable-content-and-public-evidence).

This repository maintains YAML files with the `.yaml` extension. Before adding
or editing YAML, read the authoritative [YAML policy](docs/policies/quality.md#yaml-files).
Its only approved naming exception is `.github/ISSUE_TEMPLATE/config.yml`.

Before creating or editing a typed Issue, read the current
[Issue forms](.github/ISSUE_TEMPLATE/README.md) and
[typed Issue policy](docs/policies/commits-and-scope.md#typed-issue-submissions).

Before choosing a branch, committing, or submitting a PR, read
[commits and scope](docs/policies/commits-and-scope.md) and the current
[PR template](.github/PULL_REQUEST_TEMPLATE.md). Preserve the template structure
and report observed verification results. Stage only task-owned changes.

Before editing repository or Skill instructions, references, loading/layout
rules, or the root README, read [documentation ownership](docs/policies/documentation.md).
Every conditional instruction needs one authoritative owner and an explicit
before-use link. Review the complete resulting README for first-use clarity.

Before installing dependencies or changing dependency/build inputs, complete
[trusted installation and supply-chain review](docs/policies/supply-chain.md).
Use stable Node >=24.21.0 <25 and exact pnpm 12.4.2. Development code, tests and
governance tools are erasable TypeScript. Run focused tests first, then
`pnpm verify:push`; type checking is separate from Biome and bundling.

Before creating Windows worktrees, initializing hooks, or starting an SSH push,
read the corresponding [quality procedures](docs/policies/quality.md).
Do not overwrite existing Git configuration or change Git identity. A manual
check does not prove that Git invokes a generated hook.

Before changing runtime/security behavior, read
[security boundaries](docs/policies/security.md). Helpers must not commit, push,
rewrite history, or execute repository-provided policy scripts. Verification
and waiting failures must preserve Git state and identity configuration.

Before editing CHANGELOG.md or preparing any release, read
[release policy](docs/policies/releases.md). Keep 0.1.0 Unreleased during initial
development. Pushing, PR creation/merging, remote configuration, user installation,
tagging and publication require applicable user authorization. Existing session
authorization counts; development and installation do not authorize a Release.

Navigation: [contributing](CONTRIBUTING.md), [docs](docs/README.md),
[policies](docs/policies/README.md), [tooling](tooling/README.md),
[tests](tests/README.md), [GitHub automation](.github/INDEX.md).
