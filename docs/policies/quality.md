# Quality, hooks, and CI

Use UTF-8, LF, a final newline and no tabs in maintained text. Biome owns
formatting, lint and import assist for supported handwritten TS/JS/JSON.
Generated bundles are excluded from write formatting and checked by generation
comparison, physical inventory and `node --check`. Markdown and YAML receive
separate read-only checks; do not report them as stable Biome coverage.

## YAML files

Every repository-maintained YAML file uses `.yaml`. The sole approved exception
is the exact repository-relative path `.github/ISSUE_TEMPLATE/config.yml`, which
GitHub's Issue chooser requires. Another `config.yml`, any alternate path, or
any other `.yml` is rejected. Workflows, forms, CodeQL, pnpm lock/workspace and
host metadata use `.yaml`. Unmodified third-party dependency payloads retain
their original names and bytes; their integrity is not changed for this rule.

The repository audit, staged-text pre-commit check and CI enforce this rule.
Parse YAML 1.2 with duplicate-key rejection, explicit document-count contracts
and no unapproved extensions. Parse all pnpm lockfile documents. Do not confuse
the YAML 1.2 `on` key with a boolean. Tests cover the exact allowed exception,
ordinary `.yaml`, wrong locations, nested lookalikes and newly introduced `.yml`.

## Toolchain compatibility

Use stable Node >=24.21.0 <25 (`engines.node: ^24.21.0`) and exact pnpm 12.4.2.
Node 24.21.0 is CI/reproduction baseline. Ubuntu additionally tests latest stable
24.x with check-latest enabled. mise requests Node 24, not an exemption from
the minimum version. Check the effective runtime before installing.

Maintained code and tests are erasable TypeScript executed natively by Node.
Strict NodeNext type checking is independent of runtime execution and esbuild.
No installed TS loader, pnpm, source checkout or node_modules may be required
by the final Skill payload. Root package.json.version is the sole version owner.

## Verification

Run meaningful focused failures before implementing behavior, then focused green
tests and `pnpm verify:push`. The latter is offline; dependency/build changes
also require complete networked `pnpm check:security`. CI runs supply-chain
security before message/quality gates and platform tests. The first governance
PR establishes measured integer-floor line, branch and function coverage, with
the measured scope and denominator recorded. Lowering those gates or changing
excluded code requires explicit explanation and review; safety tests are still
mandatory regardless of coverage percentage.

Separate simulated API tests, real Git fixtures, platform tests, real host
loading and real UI evidence. Do not claim a file's presence proves host loading
or a mock API proves live publication. Failed validation does not repair inputs.

## Windows worktree long-path initialization

Before adding a Windows worktree, require effective `core.longpaths=true` in
the existing clone. Inspect its origin, set it repo-locally if needed, and
recheck it. Do not change global configuration. Keep worktree directories out
of tracked source. Preserve branches and verified bundles before normally
removing a clean manually managed worktree.

If creation fails, inspect actual registration, location and owning lifecycle
before recovery. Use that lifecycle or normal Git worktree repair/removal as
appropriate; do not use force/reset/clean or recursive deletion to hide a partial
worktree. Verify resolved target paths remain within the intended directory.

## Local Git hook initialization

Complete trusted installation separately in each clone/worktree. Inspect
`git config --show-origin --get core.hooksPath` and verify generated
`.husky/_/pre-commit`, `.husky/_/commit-msg` and `.husky/_/pre-push` entries exist
locally and invoke the intended hooks. If initialization is missing, run the
trusted root prepare step and recheck, preserving existing configured hooks.
Conflicting existing hooks are not silently overwritten.

Pre-commit runs lint-staged with Biome safe writes on handwritten supported
files and read-only text/YAML checks. Keep default stash/partial-staging
protection and Windows argument batching. Generated output is not rewritten.
Commit-msg uses shared commitlint plus raw footer rules; only MERGE_HEAD or
actual Git topology proves a merge exemption. Pre-push clears Git routing
environment before offline verification. A manual verification command does
not prove actual Git hook invocation; test real calls and partially staged
restoration. Do not bypass a missing or failing hook.

## SSH push initialization

Before opening SSH push transport, require effective OpenSSH keepalive
ServerAliveInterval=30 and ServerAliveCountMax=3. Inspect existing Git/SSH
commands; preserve wrappers, identity and proxy options. A new repository may
set a repo-local command with these options. Verify effective arguments, and
do not silently replace an existing command or change global settings.
This initialization occurs before push, since pre-push is too late to configure
an already-open transport.

Inspect GIT_SSH_COMMAND/GIT_SSH and effective Git configuration precedence first.
For OpenSSH, the first obtained value wins, so conflicting earlier options cannot
be fixed by appending another value. Use ssh -G with the actual remote host alias,
port and effective options to verify both settings. For wrappers, retain them
and establish their OpenSSH pass-through behavior rather than guessing or
replacing them. Do not print secrets from identity/proxy configuration.

## Remote enforcement

main requires a PR, strict latest successful required checks, linear history,
no force push/deletion and no bypass. Additional approving reviewers are zero.
Observe successful new context names before promoting them. CodeQL uses
security-extended JavaScript/TypeScript and Actions with high-or-higher security
alerts blocked. Latest24.x compatibility is observed separately from required
checks. Action references are pinned to complete commit SHAs.
