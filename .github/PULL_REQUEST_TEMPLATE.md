## Problem

Describe the problem or link the relevant issue.

## Resulting behavior

Explain the final change and any compatibility or security implications.

## Verification

List the checks actually run and their results. Identify any remaining
verification limits, including real-platform checks.

- [ ] Focused tests and `pnpm verify:push` pass.
- [ ] Dependency or build-input changes passed `pnpm check:security`, when applicable.
- [ ] Runtime source changes include verified regenerated distribution output, when applicable.

## Documentation

- [ ] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.
- [ ] The PR title and commits follow the repository policy.
- [ ] Version 0.1.0 remains unreleased.

<!--
Before preparing a PR, read docs/policies/commits-and-scope.md#commits for the
canonical title, Markdown and reference rules.
Before squash merging, read docs/policies/commits-and-scope.md#before-squash-merging
for the separate curated commit message and validation procedure.
-->
