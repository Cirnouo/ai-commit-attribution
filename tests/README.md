# Tests

The default suite runs isolated TypeScript tests on supported Node. Governance
fixtures cover raw commit/footer and current PR contracts, YAML naming/parsing,
dependency trust/coverage and exact generated auditor output. Real Git fixtures
prove history and worktree behavior without modifying the contributor checkout.

Report targeted red/green evidence and measured coverage separately from live
GitHub/platform acceptance. Mock network tests establish state handling, not live
publication. identity-records.test.ts covers declared event evidence, participant
gaps, same-event enrichment, scope consistency and stable tuples.
identity-records-review.test.ts covers exact filename/opaque-ID scope, complete
effective mapping conflicts, explicit missing-model markers and unique issue joins.
agent-registry.test.ts checks production host distinctions. skill-build.test.ts audits nested physical
payloads and unchanged peers on failure; distribution.test.ts executes installed
summary business paths from outside dependencies with Git-state preservation.
policy-decision.test.ts covers strict schema 2 decision shapes, normalized
declared scope consistency, exclusive lazy routing and rejected legacy inputs.
Its non-Git directory fixtures prove preview and validation use declarations.
policy-safety.test.ts covers output-only actual Git-directory protection,
forged scope rejection, linked worktree administration, trusted executable and
environment isolation, and the restricted location-query argv allowlist.
safe-git-environment.test.ts covers Windows copied bootstrap root-key casing,
ambiguous duplicate rejection and actual Git Bash source/installed message paths
using dynamically derived host and fixture paths.
policy-distribution.test.ts executes installed schema 2 routes outside
dependencies and actual Git repositories, corrupts the registry to prove bypass,
rejects removed scanner inputs and uses a real import sentinel for default summary.
message-attribution.test.ts exercises exclusive declared route entry, real isolated
Git trailer semantics, byte preservation, strict signatures/scoped exceptions,
new-file refusal and external installed command behavior. Native questions and
actual host acceptance remain integrator/host checks, distinct from simulation.
message-distribution.test.ts runs installed render/validate business paths,
including unusable default inputs on repository-policy and real shared temporary
parent child creation during copied-bundle CLI rendering. message-output.test.ts
uses real filesystem fault observation for short writes, cancellation, exclusive
creation races and replaced-path peer preservation.
message-temporary-directory.test.ts exercises real child creation at filesystem
observation boundaries, isolated Git trailer preservation, directory replacement,
linked paths and retained strict default/private-directory metadata checks.
message-review-fixes.test.ts covers summary-owned exception boundaries, unique
exception joins and optional reasoning placeholders through source and copied
installed render/validate commands. Output fault regressions retain same-inode
peer prefix, empty and equal content as well as uncertain partial writes.
skill-integration.test.ts materializes the finite public acceptance corpus and
executes all fifteen copied-bundle cases in isolated real Git repositories,
including positive idempotence, exclusive policy handoff, participant/effort
accounting, operation mismatches, raw controls and a synthetic final-hook rewrite.
The [acceptance guide](../docs/acceptance/README.md) maps all eighteen requirements
to these mechanical checks and separate optional native exercises.

- governance.test.ts, commit-checks.test.ts and pull-request-policy.test.ts cover
  branch/message/PR rules and real Git history/context.
- initialization.test.ts and toolchain-config.test.ts cover repository/YAML and
  actual toolchain/workflow contracts.
- hook-isolation.test.ts covers Git hook routing and partial-stage protection.
- supply-chain.test.ts covers full audit inventory, failures and bounded reviews.
- installer-evidence.test.ts covers the independent official package evidence
  and audited CLI repository-root discovery/copy of the complete generated payload
  in an isolated home without network acquisition.
- security-build.test.ts checks exact generated audit output and notices.
- typescript-gates.test.ts checks actual type/syntax/erasable-language failures.
- cli-entry.test.ts invokes ten guarded maintainer CLI entries through real filesystem
  aliases, checks side-effect-free imports, and proves the standalone security
  checker audits before installation and rejects unavailable native entry capability.

- issue-policy.test.ts covers current-form classification and Markdown semantics.
- issue-feedback.test.ts covers simulated REST ownership, races, preservation and
  recovery, plus a subprocess entry using fixtures/issue-feedback-http.ts.
- issue-workflow.test.ts checks trusted SHA, queue, gate and token boundaries.
- fixtures/ contains isolated subprocess inputs; its README owns that boundary.
- version-policy.test.ts covers strict SemVer profiles and raw root/Skill agreement.
- release.test.ts covers final-layout metadata, notes and persistent simulated
  Release recovery, plus real isolated Git tag identity and ancestry.
- release-transport.test.ts covers fixed REST origin, status and sanitized failures.
- release-workflow.test.ts parses the owned YAML and checks tag queue, same-commit
  reusable CI, minimal permissions and the final-step built-in token boundary.
