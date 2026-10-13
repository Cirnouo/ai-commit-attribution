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
Prefer this description for Issue associations and regression-source explanations.
Optional trailers go at the end of this description after a blank line.
Use Closes #ISSUE, Fixes #ISSUE, or Resolves #ISSUE when this PR resolves an Issue.
Use Refs: #NUMBER for a non-closing reference to an Issue or another PR.
Use one reference per trailer line and owner/repository#NUMBER for another repository.
Authored #number or (#number) title references may identify Issues or other PRs.
The raw title must not end in its own (#CURRENT-PR-NUMBER); GitHub appends that suffix.
Preserve the generated final suffix and keep the complete squash header within 100 characters.
See docs/policies/commits-and-scope.md for reference and squash-message conventions.
-->
