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

Each PR represents one logical change and produces one logical squash commit.
The PR and commit explain the same What and Why, plus useful How, semantically;
their formatting need not match. PR Markdown has no commit prose width, manual
wrapping, or footer-boundary requirement. Tests, review notes, screenshots,
tables, links and other PR-only evidence can remain on the PR within the current
template sections or deeper headings.

This repository configures GitHub squash merging with `PR_TITLE` + `BLANK`:
the PR title becomes the suggested commit title with GitHub's generated PR number
retained, and the suggested commit body is empty. This is a
[configured GitHub feature](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests).
It is repository configuration, not a universal default or a Conventional
Commits rule.

Topic commits and raw PR titles use the header above. A raw PR title is a single
line: CR, LF, U+2028 and U+2029 are rejected without trimming or normalizing it.
A raw PR title must not
end in its own `(#<current-PR-number>)`; GitHub appends that suffix when squashing.
The final squash header uses `<type>(<scope>)!: <subject> (#<current-PR-number>)`,
with `!` only for a breaking change. The final GitHub-generated trailing suffix
identifies the PR that produced the squash commit. Preserve that suffix and
check the actual merge message before merging.

Other authored `#number` or `(#number)` references in topic commit subjects,
raw PR titles, and descriptions may identify Issues or other PRs, including a
PR that introduced a regression. These references are distinct from the final
generated current-PR suffix. Preserve applicable references in the curated
squash message.

The 100-character header limit includes the generated suffix. For example,
` (#123)` uses seven characters, leaving at most 93 characters for the raw title.
PR checks validate the raw title and the predicted header with its actual PR
number separately, so appending a suffix cannot hide a subject's trailing period.
They validate the raw PR description only against the current template below.
Editing a title or description reruns the existing gate.

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
template, both headers, and the actual topic commits in the exact base..head
range. It cannot inspect a future edited merge body; semantic agreement between
the PR and curated commit message is a review responsibility.
A missing or empty body fails. A failed check
blocks merge; edit the title or body to fix the reported errors and let the
existing PR `edited` event rerun the check. Older PR numbers or historical prose
provide no exception for a current submission. Local, push, and scheduled
history checks continue to validate original commit messages without applying
the current PR template to history. This remote body gate does not run before
sending a PR description.

### Before squash merging

Read this procedure before squash merging. Prepare an independent commit body
that retains the durable What and Why, useful How, breaking-change notes,
relevant Issue and regression-source references, human coauthors and applicable
attribution trailers. Apply the actual commit prose and footer/trailer rules
above; do not copy PR-only review evidence merely to fill the blank default.

1. Review the latest PR head and required successful checks. Record that exact
   reviewed head SHA. Obtain the actual PR number and form the full header from
   the reviewed raw title plus ` (#<number>)`; retain authored references and
   check the total 100-character budget.
2. Save the curated body in a UTF-8 body file. Assemble a separate full message
   file containing that exact full header, a blank line, and the exact body file
   contents. Validate the assembled message with the existing checker:

   ```sh
   node tooling/check-commit-message.ts <message-file>
   ```

3. After validation succeeds and merge authorization applies, send the identical
   validated header and body, guarded by the reviewed head SHA:

   ```sh
   gh pr merge --squash --subject <full-header> --body-file <body-file> --match-head-commit <reviewed-head-sha>
   ```

   The placeholders denote command arguments; quote the full header and paths
   for the executing shell. Any header or body edit requires reassembling and
   revalidating the full message. A changed PR head requires fresh review and
   checks before retrying. Preserve the actual `(#number)`, references and
   applicable attribution in the message sent to GitHub.

Keep each commit coherent, stage only files owned by the task, and preserve
unrelated worktree changes. Review the staged diff and run the applicable
focused checks before committing.

Do not push, tag, publish, modify a remote, open a pull request, or change
repository settings without explicit authorization.

## Typed Issue submissions

The current [Bug form](../../.github/ISSUE_TEMPLATE/bug_report.yaml) and
[Feature form](../../.github/ISSUE_TEMPLATE/feature_request.yaml) are the sole
authority for their generated field labels, order, required answers, dropdown
options, and classification labels. GitHub's
[Issue form syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
applies the configured labels when those labels already exist in the repository.
The current forms use `template: bug-report` and `template: feature-request`;
Agents using another interface must apply the corresponding form label when
creating or editing a typed Issue.

Classification uses those form labels only. Ordinary freeform Issues without
either label remain allowed and exempt, even if their text resembles a form.
General labels such as `bug` are optional. Both form labels on one Issue are
ambiguous and invalid; choose the corresponding form. `template: invalid` is
reserved for validation diagnostics and cannot classify a form. Do not infer a
type from the body or record persistent Issue identity.

Preserve each generated H3 field heading exactly once and in the form's order,
including optional fields. Extra field-like H3 headings break that structure;
deeper headings, prose, lists, and code may appear in responses. Comments and
headings alone do not answer a required field. Fenced or indented code and
quotes may provide answer evidence but cannot substitute for generated headings.
Required answers must be nonempty and cannot be `_No response_`. Optional
answers may be empty or `_No response_`. A dropdown answer must match exactly
one configured option. This structural policy does not judge semantic
completeness, response length, version grammar, or numbered reproduction steps.

Malformed or unsupported form configuration is a configuration failure,
distinct from invalid contributor content. The supported form profile includes
input, textarea, single-choice dropdown, and static Markdown. Forms use the
shared owned YAML 1.2/core profile, a single document, string mapping keys,
duplicate-key rejection and bounded alias resolution. Changes to control
types or required structure require explicit policy support before use.
Read the current form before creating or editing a typed Issue, redact sensitive
examples, and follow [SECURITY.md](../../SECURITY.md) for private vulnerability
reporting. Typed body validation has no local command or Agent tool hook.

The remote [Issue forms workflow](../../.github/workflows/issues.yaml) runs on
open, body/title edit, reopen, and label changes using the trusted default-branch
event commit. GitHub requires this workflow on the default branch for
[Issue events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues).
Classification changes use `labeled` and `unlabeled` events. Changes to the
diagnostic `template: invalid` label are ignored to prevent feedback recursion.
Maintainers must provision both current form labels and `template: invalid`
before deployment; missing labels or malformed forms are automation failures.
Every non-ignored open Issue run verifies both current classification names and
the diagnostic label remotely before classification or diagnosis effects.
Missing, mismatched or malformed configuration fails with zero writes.

A structurally invalid typed Issue receives only the diagnostic label and one
owned GitHub Actions bot comment with field-specific repair guidance, then its
workflow reports failure. Edit the body or corresponding form label to repair
the submission. A repaired Issue loses only the diagnostic label and its existing
owned comment records resolution. Removing both form labels makes the Issue
ordinary and exempt, clears stale diagnosis, and resolves any owned comment.
Fresh valid or ordinary Issues receive no comment. Closed Issues are skipped.
Other labels, comments and the original body remain intact; automation never
closes, deletes, locks or reopens an Issue.

Ownership requires the verified [GitHub Actions bot](https://api.github.com/users/github-actions%5Bbot%5D)
numeric identity, `github-actions[bot]` login
and Bot type plus the fixed feedback marker. Comment discovery is paginated;
legacy duplicates select the lowest numeric comment ID for update and preserve
the others. Marker text copied by a contributor cannot claim a comment.
API, authentication, network, malformed response and configuration failures are
automation failures, distinct from contributor content. Logs omit tokens and
Issue bodies. The workflow queues runs per Issue and checks freshly fetched
identity, body, title, labels, state and update time before writing. Confirmed
own label mutations advance the expected update time only while source and label
identities still match. GitHub REST offers no atomic compare-and-set here; an edit
in the final request window is repaired by its later queued event.
A confirmed label write can remain if a later comment request fails. The run
reports automation failure; a rerun fetches current state and resumes recovery
without creating duplicate owned comments or changing unrelated content.

## Optional Issue and PR references

Issue association and other PR references are optional. When the change resolves
an Issue, use `Closes`, `Fixes`, or `Resolves` followed by its Issue reference.
Use `Refs: #220` for a non-closing reference to an Issue or another PR. In the
independent commit message, put these trailers at the end after the required
blank line. Use one reference per trailer line and `owner/repository#number`
for a reference in another repository. PR Markdown may explain the same
associations in prose or use these reference lines without commit wrapping or
footer-boundary requirements.

Prefer the PR description for Issue associations and regression-source
explanations so references are visible on the PR. Carry relevant references into
the independently curated squash body; the blank default does not copy them.
Title references are allowed; titles alone do not close Issues. Topic commits
may also include these trailers. Keep applicable closing keywords in the PR
description for its Issue link and in the curated commit for durable context.
Closing keywords in a PR description
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
