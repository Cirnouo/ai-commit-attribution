# Governance tooling

Maintained TypeScript tools check repository structure, text, YAML, script syntax,
commit/PR policy and dependency trust. They execute natively on the supported
Node runtime. Shared validators have dedicated tests; command entry points do
not change policy inputs during validation.

The security directory owns audit policy, evidence and standalone generated
auditor output. Generated auditor bytes and notices are compared against their
build and independent allowed inventory. build-skill.ts builds the actual summary
payload, skill-inventory.ts owns the independent allowed packaging/output paths,
and check-distribution.ts audits all installed metadata, links, bytes and physical
entries. The business notices set is derived separately from its actual metafile.

- governance.ts, commit-footer-rule.ts and version-policy.ts own shared grammars.
- commit-vocabulary.ts owns dependency-free frozen types/scopes; commitlint imports
  it directly and governance.ts preserves its public re-exports. Loading commitlint
  configuration does not load Git or release-version validators.
- check-commits.ts and check-commit-message.ts validate history and hook input.
- submission-markdown.ts and pull-request-policy.ts derive current PR structure.
- repository-audit.ts and check-text-style.ts audit repository and staged text.
- owned-yaml.ts owns the shared YAML profile for text and preinstallation inputs.
- check-scripts.ts checks maintained TS and generated JavaScript syntax.
- check-security.ts and build-security.ts execute and bundle the audit gate.
- file-evidence.ts provides stable descriptor-based reads.
- constants.ts and errors.ts provide small shared data/error helpers.
- cli-entry.ts checks native import.meta.main capability for all guarded CLI
  entries; aliased paths execute normally and unavailable capability fails closed.
  The boolean entry identity is documented in the [Node 24.2 release notes](https://nodejs.org/id/blog/release/v24.2.0).
- security/ owns the dependency graph, registry, evidence and installer modules.

- issue-policy.ts derives typed Issue validation from the current forms.
- issue-feedback.ts owns recoverable feedback for verified Issue events.
- issue-github.ts owns fixed-origin, sanitized GitHub REST requests.
- release.ts validates annotated push identity, final Skill metadata and dated
  snapshots, then creates/resumes a draft and publishes with recoverable failures.
  Its status-aware sanitized REST adapter is separate from the Issue adapter.
  Before preparing publication, read the [release policy](../docs/policies/releases.md).
