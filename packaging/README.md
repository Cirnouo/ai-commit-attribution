# Skill packaging inputs

skill-entry.md is the maintained policy/summary entry. The builder emits it as
SKILL.md in the generated payload, so repository-root installers discover the
complete generated Skill instead of these packaging inputs. policy.md owns its
before-use semantic policy discovery, decision and review contract; records.md
owns the record/evidence contract.
messages.md owns render/validate, signature assessment, exact identity mapping
application and new-file behavior. hosts.md owns per-consumer discovery,
metadata, identity-acquisition and native-interaction evidence. integration.md
provides the human first-use JSON/CLI workflow and links to those contracts.
Each reference is linked directly from the Skill entry with a before-use trigger.
agent-registry.json owns researched host names, exact
aliases, primary sources, dates and remaining gaps. These files are copied into
the generated payload, with version metadata injected from root package.json.
This README is contributor navigation and does not enter the installed Skill.

Before changing instructions or loading/layout contracts, read
[documentation ownership](../docs/policies/documentation.md). The independent
inventory is maintained in tooling/skill-inventory.ts; generated outputs are
checked by the business builder and distribution audit.
