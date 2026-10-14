# Documentation

The [root README](../README.md) is the first-use landing page. The
[user guide](user-guide/README.md) explains skills.sh installation for Codex,
source-checkout and existing-copy use, results and common questions. Installation
and actual host loading have separate verification scope. This guide is source
documentation and is not part of the installed payload.

Runtime contracts are maintained in [packaging/](../packaging/README.md) and
generated into the complete [skills/ai-commit-attribution/](../skills/ai-commit-attribution/SKILL.md)
payload. The Skill entry and its conditional references own the Agent workflow;
the user guide provides explanation and navigation.

[CONTRIBUTING](../CONTRIBUTING.md) explains contributor setup and submission.
This directory contains:

- [user-guide/](user-guide/README.md): user explanation, troubleshooting and support navigation.
- [acceptance/](acceptance/README.md): portable scenarios, reproduction commands,
  evidence mapping, installation gates and native-host limits.
- [decisions/](decisions/README.md): architectural decisions, including the
  [supplied-operation/evidence boundary](decisions/0001-summary-evidence.md).
- [policies/](policies/README.md): contributor obligations, verification,
  security, release authorization and the reference migration record.

[platform-settings.json](platform-settings.json) records dated live GitHub
observations separately from the historical source-policy baseline; final
required contexts follow CI success.
