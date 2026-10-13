# Supply-chain audit components

This directory holds dependency trust, coverage, evidence and registry-audit
components adapted from the exact reference baseline. The generated dist
directory contains the standalone preinstallation auditor and its original
third-party license notices. It is generated output and has no hand-maintained
directory documentation inside it.

Read [the supply-chain policy](../../docs/policies/supply-chain.md) before using
or modifying the checker. The bootstrap record distinguishes the unchanged
reference lockfile-only preflight from the target complete installed-tree check.

- audit-policy.ts owns lock inventories, reports and bounded-review evaluation.
- security-evidence.ts owns install policy, installed graph and fingerprints.
- security-runner.ts owns controlled pnpm/registry audit execution.
- installer-evidence.ts verifies installer metadata and original package files.
- installer-evidence.json pins independent skills1.7.2 tarball and file evidence.
- dist/ contains the generated standalone auditor and original parser notices.
