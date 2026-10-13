# GitHub configuration

PULL_REQUEST_TEMPLATE.md is the sole current PR structure authority.
workflows/ci.yaml runs trusted supply-chain, quality, message and platform checks.
workflows/codeql.yaml analyzes maintained JavaScript/TypeScript and Actions.
CodeQL configuration excludes generated output and dependencies.
codeql-config.yaml owns that analysis configuration. workflows/README.md describes
the workflow entries and schedule/permission boundaries.

ISSUE_TEMPLATE/ owns the Bug/Feature forms and freeform/private-report chooser.
workflows/issues.yaml runs the trusted Issue feedback state machine. Before
creating or editing a typed Issue, read the current forms and
[typed Issue policy](../docs/policies/commits-and-scope.md#typed-issue-submissions).
workflows/release.yaml requires same-commit CI before the queued tag publisher.
Before tagging or publishing, read the [release policy](../docs/policies/releases.md).
General platform configuration and migration provenance are in
[the policy record](../docs/policies/migration.md). Read-only token defaults and
complete action SHA pins apply to every workflow.
