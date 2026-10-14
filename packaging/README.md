# Skill packaging inputs

SKILL.md is the installed policy/summary entry. policy.md owns its before-use
scan/decision/freshness contract; records.md owns the record/evidence contract.
agent-registry.json owns researched host names, exact
aliases, primary sources, dates and remaining gaps. These files are copied into
the generated payload, with version metadata injected from root package.json.
This README is contributor navigation and does not enter the installed Skill.

Before changing instructions or loading/layout contracts, read
[documentation ownership](../docs/policies/documentation.md). The independent
inventory is maintained in tooling/skill-inventory.ts; generated outputs are
checked by the business builder and distribution audit.
