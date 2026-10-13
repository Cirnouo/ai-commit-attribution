# Tests

The default suite runs isolated TypeScript tests on supported Node. Governance
fixtures cover raw commit/footer and current PR contracts, YAML naming/parsing,
dependency trust/coverage and exact generated auditor output. Real Git fixtures
prove history and worktree behavior without modifying the contributor checkout.

Report targeted red/green evidence and measured coverage separately from live
GitHub/platform acceptance. Mock network tests establish state handling, not live
publication. identity-records.test.ts covers declared event evidence, participant
gaps, same-event enrichment, scope consistency and stable tuples. agent-registry.test.ts
checks production host distinctions. skill-build.test.ts audits nested physical
payloads and unchanged peers on failure; distribution.test.ts executes installed
summary business paths from outside dependencies with Git-state preservation.
Later policy, message and real host acceptance are added with those features.

- governance.test.ts, commit-checks.test.ts and pull-request-policy.test.ts cover
  branch/message/PR rules and real Git history/context.
- initialization.test.ts and toolchain-config.test.ts cover repository/YAML and
  actual toolchain/workflow contracts.
- hook-isolation.test.ts covers Git hook routing and partial-stage protection.
- supply-chain.test.ts covers full audit inventory, failures and bounded reviews.
- installer-evidence.test.ts covers the independent official package evidence.
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
