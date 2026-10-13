# Commits, branches, and scope evolution

## Branches

The branch rules are this repository's adapted
[Conventional Branch](https://conventionalbranch.org/) profile. The allowed
prefixes, lowercase kebab-case topic, and `release/<semver>` syntax below are
authoritative local choices.

The trunk is `main`. Work branches use exactly one of these short prefixes,
followed by a lowercase kebab-case topic:

- `feat/` for new functionality.
- `fix/` for defects.
- `hotfix/` for urgent fixes.
- `chore/` for standalone documentation, refactoring, tests, CI, and other
    maintenance.

Choose the prefix for the task's overall purpose. Classify each commit
independently using the commit types below; branch and commit types need not
match. For example, `chore/branch-policy` may contain a
`docs(governance): explain branch policy` commit, and `chore/quality-gates` may
contain a `ci(ci): add quality gates` commit.

Optional release preparation branches use `release/<semver>` with strict
SemVer syntax; only release branches may use SemVer dots and prerelease/build
separators. A release branch does not authorize publication. Formal publication
requires a separately authorized annotated `v<semver>` tag without build metadata
under the [release policy](releases.md). Do not rewrite shared history.

## Commits

The commit format is based on
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
with this repository's required scope, allowed types/scopes, and length
constraints below.

Every non-merge commit uses `<type>(<scope>)!: <subject>`, where `!` appears only
for a breaking change. Allowed types are `build`, `chore`, `ci`, `docs`, `feat`,
`fix`, `perf`, `refactor`, `revert`, `style`, and `test`. The single required lowercase scope is one of `governance`, `policy`, `identity`, `attribution`, `integration`, `docs`, `ci`, `security`, `release`, `issues`, or `build`.

Headers are at most 100 characters. Subjects are non-empty, begin in lowercase,
and do not end with a period. A body or footer follows a blank line; a footer
also follows a blank line after a body. Plain body prose is at most 100 characters
per line. Complete legitimate structured trailers at the end of the message
are exempt from that line limit and must each remain intact on one line; never
wrap a trailer to meet the prose limit. This includes `Assisted-by:`,
`Reviewed-by:`, `Co-authored-by:`, reference trailers, and a complete single-line
`BREAKING CHANGE:` trailer. A breaking change may use `!`, a
`BREAKING CHANGE:` footer, or both.
Only Git-topology-proven merge commits are ignored.

Footer boundaries use the original message lines. `BREAKING CHANGE:` and
`BREAKING-CHANGE:`, `Refs` in any letter case, Issue-closing keywords followed by
an Issue reference, and hyphenated trailer tokens such as `Reviewed-by:` are
reserved footer syntax. Cross-repository references
use the same boundary rule. Their first footer line requires a blank line after
the header or body; subsequent trailers in that footer group can be adjacent.
Existing Markdown bullet breaking notes such as `* BREAKING CHANGE:` require
the same blank line, whether their description starts on that line or the next.
Their prose and multiline continuations retain the plain-body line limit; the
structured-trailer exemption applies only to a complete trailer on one line.

An otherwise unknown bare-word label such as `observations: value` continues
the body when no blank line precedes it. With a preceding blank line, it can
start a generic footer group. This is a syntactic convention for ambiguous
labels, not an inference of prose intent. Hyphenated labels such as
`quick-start: value` remain reserved trailer syntax and require the footer
boundary. A body label cannot hide a later unseparated reserved footer, and
every body or footer still requires a blank line after the header.

The local `footer-leading-blank` rule in `tooling/commit-footer-rule.ts` owns
these boundaries at error severity. The Conventional Commits parser, original
message, other commitlint rules and Git topology checks remain authoritative
for their existing responsibilities.

This repository configures GitHub squash merging with `PR_TITLE` + `PR_BODY`:
the PR title becomes the commit title with GitHub's generated PR number retained,
and the PR description becomes the commit body. This is a
[configured GitHub feature](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests).
It is repository configuration, not a universal default or a Conventional
Commits rule.

Topic commits and raw PR titles use the header above. A raw PR title must not
end in its own `(#<current-PR-number>)`; GitHub appends that suffix when squashing.
The final squash header uses `<type>(<scope>)!: <subject> (#<current-PR-number>)`,
with `!` only for a breaking change. The final GitHub-generated trailing suffix
identifies the PR that produced the squash commit. Preserve that suffix and
check the actual merge message before merging.

Other authored `#number` or `(#number)` references in topic commit subjects,
raw PR titles, and descriptions may identify Issues or other PRs, including a
PR that introduced a regression. These references are distinct from the final
generated current-PR suffix and remain in the predicted squash message.

The 100-character header limit includes the generated suffix. For example,
` (#123)` uses seven characters, leaving at most 93 characters for the raw title.
PR checks validate the raw title and the predicted header with its actual PR
number plus the original PR description. Keep description lines within the same
plain-body limit, retaining the same exemption for complete, final, single-line
structured trailers in the description and predicted squash message. Editing a
title or description reruns the existing gate.

The current [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md)
is the sole source of required PR headings, checklist labels, placement, order,
and starter prose. Keep each H2 section exactly once in order without extra H2
sections, and each template checklist once in its section and original order.
Deeper headings, prose, lists, and code evidence are allowed. Wrapped checklist
labels preserve their original text after whitespace normalization.

Problem and Resulting behavior need content beyond starter prose, comments,
headings, and checkboxes. An Issue link can explain the problem. Verification
must record actual checks, results, and remaining limits beyond its checklist.
Documentation can consist of satisfied checks and conditional reasons. Select
mandatory checks with `x` or `X`. A check containing `when applicable` may remain
unchecked only with an adjacent indented `N/A: <reason>` continuation. Do not
delete unchecked required checks or claim results that have not been observed.

The remote Commit messages check validates the current PR body against this
template in addition to validating the complete original body with commitlint
and the predicted squash suffix. A missing or empty body fails. A failed check
blocks merge; edit the title or body to fix the reported errors and let the
existing PR `edited` event rerun the check. Older PR numbers or historical prose
provide no exception for a current submission. Local, push, and scheduled
history checks continue to validate original commit messages without applying
the current PR template to history. This remote body gate does not run before
sending a PR description.

Keep each commit coherent, stage only files owned by the task, and preserve
unrelated worktree changes. Review the staged diff and run the applicable
focused checks before committing.

Do not push, tag, publish, modify a remote, open a pull request, or change
repository settings without explicit authorization.

## Optional Issue and PR references

Issue association and other PR references are optional. When the change resolves
an Issue, use `Closes`, `Fixes`, or `Resolves` followed by its Issue reference.
Use `Refs: #220` for a non-closing reference to an Issue or another PR. Put these
trailers at the end of the PR description, with a blank line after the description
body. Use one reference per trailer line and `owner/repository#number` for a
reference in another repository.

Prefer the PR description for Issue associations and regression-source
explanations so references are visible on the PR and carried into the squash
body. Title references are allowed; titles alone do not close Issues. Topic
commits may also include these trailers, but keep closing keywords in the PR
description so squash merging retains them. Closing keywords in a PR description
create a visible PR-Issue link when the PR targets the default branch; merging
that PR into the default branch closes the Issue. See
[GitHub's issue-linking documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

For example, PR #123 resolves Issue #219 and fixes a regression introduced by
PR #220. Its raw title may be `fix(attribution): reject stale identity from #220`,
and its complete final squash message can look like this:

```text
fix(attribution): reject stale identity from #220 (#123)

Fix the stale-operation regression introduced by PR #220.

Closes #219
Refs: #220
```

## Scope evolution

Add a scope only for a durable domain or cross-cutting responsibility expected
to recur. Never add one for a file, issue, person, temporary feature, or one-off
migration. Add, remove, or rename a scope in a `chore(governance): ...` change
that updates the shared grammar, this policy, the domain documentation, and relevant
directory documentation. Never rewrite historical commits for a scope change.

When a request changes scope, update the governing plan or task brief before
implementation when one exists. Record durable architecture decisions in an
ADR and user-visible behavior in the changelog. Do not fold unrelated cleanup,
speculative compatibility, or future extension work into the current change.
