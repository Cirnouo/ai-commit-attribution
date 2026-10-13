# Tests

The default suite runs isolated TypeScript tests on supported Node. Governance
fixtures cover raw commit/footer and current PR contracts, YAML naming/parsing,
dependency trust/coverage and exact generated auditor output. Real Git fixtures
prove history and worktree behavior without modifying the contributor checkout.

Report targeted red/green evidence and measured coverage separately from live
GitHub/platform acceptance. Mock network tests establish state handling, not live
publication. Future Skill behavior, distribution and host acceptance are added
with their corresponding features; there are no empty placeholder checks.

- governance.test.ts, commit-checks.test.ts and pull-request-policy.test.ts cover
  branch/message/PR rules and real Git history/context.
- initialization.test.ts and toolchain-config.test.ts cover repository/YAML and
  actual toolchain/workflow contracts.
- hook-isolation.test.ts covers Git hook routing and partial-stage protection.
- supply-chain.test.ts covers full audit inventory, failures and bounded reviews.
- installer-evidence.test.ts covers the independent official package evidence.
- security-build.test.ts checks exact generated audit output and notices.
- typescript-gates.test.ts checks actual type/syntax/erasable-language failures.

- issue-policy.test.ts covers current-form classification and Markdown semantics.
- issue-feedback.test.ts covers simulated REST ownership, races, preservation and
  recovery, plus a subprocess entry using fixtures/issue-feedback-http.ts.
- issue-workflow.test.ts checks trusted SHA, queue, gate and token boundaries.
- fixtures/ contains isolated subprocess inputs; its README owns that boundary.
