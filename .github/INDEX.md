# GitHub configuration

PULL_REQUEST_TEMPLATE.md is the sole current PR structure authority.
workflows/ci.yaml runs trusted supply-chain, quality, message and platform checks.
workflows/codeql.yaml analyzes maintained JavaScript/TypeScript and Actions.
CodeQL configuration excludes generated output and dependencies.
codeql-config.yaml owns that analysis configuration. workflows/README.md describes
the workflow entries and schedule/permission boundaries.

Issue forms/feedback and the Release publisher are introduced in their separate
governance PRs. General platform configuration and migration provenance are in
[the policy record](../docs/policies/migration.md). Read-only token defaults and
complete action SHA pins apply to every workflow.
