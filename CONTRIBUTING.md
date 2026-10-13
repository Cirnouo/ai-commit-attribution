# Contributing

Focused fixes, documentation improvements and reproducible reports are welcome.
Follow [AGENTS.md](AGENTS.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Prepare a checkout

Use stable Node >=24.21.0 <25 and pnpm 12.4.2. Node 24.21.0 is the CI and problem
reproduction baseline. `mise.toml` requests Node 24 and exact pnpm 12.4.2; check
the actual `node --version` before installation because a prefix may reuse an
older installed version. Keep an already compatible Node installation.

Before making Windows linked worktrees, follow
[long-path initialization](docs/policies/quality.md#windows-worktree-long-path-initialization).
Complete the [trusted installation sequence](docs/policies/supply-chain.md#installation-and-scan-order)
in every clone and worktree. It runs the committed standalone preflight before
script-disabled installation, complete audits, trusted installation and pending
rebuild. Do not skip failed gates or automatically repair dependencies.

After installation, verify effective hooksPath and the generated hook entries
in this worktree under the [hook policy](docs/policies/quality.md#local-git-hook-initialization).
Before SSH push, verify the [keepalive procedure](docs/policies/quality.md#ssh-push-initialization).
Preserve existing identity, proxy and wrapper settings; do not change global Git
configuration or user.name/user.email.

## Make a focused change

Choose a branch under [commits and scope](docs/policies/commits-and-scope.md).
Keep atomic commits, preserve unrelated work, and first add a meaningful failing
test for behavior changes. Run the affected tests and `pnpm verify:push`.
Dependency or build-input changes also require `pnpm check:security`.
Generated output must be rebuilt and compared without silently repairing drift
in validation. Do not edit generated bundles by hand.

Maintained Node code is TypeScript executed natively during development. Biome
checks its supported languages; `tsc --noEmit` checks types, YAML is parsed with
a real parser, and Markdown/YAML have separate read-only checks. The generated
runtime will be bundled JavaScript requiring only supported Node and Git.

## Submit a pull request

Read the current [PR template](.github/PULL_REQUEST_TEMPLATE.md) and
[submission policy](docs/policies/commits-and-scope.md#commits) before submission.
Use all required sections/checklists, actual verification results and explicit
conditional N/A reasons. Check the predicted squash message with the actual PR
number and complete original body. The title budget includes GitHub's suffix.
PR description edits rerun the commit check. Historical messages are validated
as history and do not acquire today's PR template.

Update relevant documentation. Before editing CHANGELOG.md, verify the latest
published stable baseline under [release policy](docs/policies/releases.md).
Current single-maintainer governance requires no extra approving reviewer, but
PRs must satisfy the strict latest checks and independent task review.

Ordinary freeform Issues remain available. Do not expose secrets or private
paths in reports. Before creating or editing a typed Bug/Feature Issue, read the
[current forms](.github/ISSUE_TEMPLATE/README.md) and
[typed Issue policy](docs/policies/commits-and-scope.md#typed-issue-submissions).
Preserve generated optional headings, answer required fields and select the
corresponding form label when using another interface. No actual tag or publication is authorized by
routine development or Skill installation.
