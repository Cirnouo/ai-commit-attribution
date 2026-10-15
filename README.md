<h1 align="center">ai-commit-attribution</h1>

<p align="center">Record AI assistance in Git commits, following your repository's policy.</p>

<p align="center">
  <a href="CHANGELOG.md"><img alt="Status: 0.1.0 unreleased" src="https://img.shields.io/badge/status-0.1.0%20unreleased-gray?style=flat"></a>
  <a href="#requirements"><img alt="Node: 24.x, at least 24.21.0" src="https://img.shields.io/badge/Node-24.x%20%E2%89%A5%2024.21.0-gray?style=flat"></a>
  <a href="https://github.com/Cirnouo/ai-commit-attribution/actions/workflows/ci.yaml"><img alt="CI status on main" src="https://img.shields.io/github/actions/workflow/status/Cirnouo/ai-commit-attribution/ci.yaml?branch=main&amp;style=flat&amp;label=CI"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-gray?style=flat"></a>
  <a href="https://skills.sh/Cirnouo/ai-commit-attribution"><img alt="skills.sh installs" src="https://skills.sh/b/Cirnouo/ai-commit-attribution"></a>
</p>

<p align="center"><a href="#why-use-it">Why use it</a> · <a href="#requirements">Requirements</a> · <a href="#quick-start">Quick start</a> · <a href="#start-a-task">Start a task</a> · <a href="#documentation">Documentation</a></p>

## Why use it

- Follow the repository's AI disclosure policy first.
- Account for actual planning, implementation, review and test participants.
- Preview and check disclosure while preserving the message body and unrelated trailers.

## Requirements

- Stable Node >=24.21.0 <25.
- Trusted Git.
- The executing Agent can access the complete Skill.

Runtime use needs no pnpm or development dependencies.

## Quick start

Install with the [skills.sh CLI](https://skills.sh/docs/cli). Before updating or replacing a customized existing target, follow the [installation gate](docs/acceptance/README.md#fixed-source-installation-gate).

```text
npx skills add https://github.com/cirnouo/ai-commit-attribution --skill ai-commit-attribution
```

This follows development `main`. See the [installation and host guidance](docs/user-guide/README.md#install-for-codex) for scope, target selection and loading checks.

### Start a task

In Codex, explicitly invoke the Skill and ask:

> $ai-commit-attribution Prepare and validate a commit message for the selected changes in the current actual worktree, following the applicable repository policy. Show the preview and any decision or evidence gaps. Do not commit or push.

Illustrative default format from the [message contract](skills/ai-commit-attribution/references/messages.md), with placeholders rather than detected identities:

```text
Assisted-by: <canonical Agent host>:<actual formal Model>
```

This default applies only when no applicable repository AI disclosure policy exists. Repository policy may choose another format or no disclosure.

To try the [source Skill](skills/ai-commit-attribution/SKILL.md), ask the Agent to read that checkout's `skills/ai-commit-attribution/SKILL.md` and its before-use references, then work in the actual target worktree, which may differ from the Skill checkout. See [source-checkout use](docs/user-guide/README.md#from-a-source-checkout) or [existing-copy use](docs/user-guide/README.md#from-an-existing-skill-copy) for the corresponding access and host steps.

## Documentation

- [User guide](docs/user-guide/README.md): first use, results and common questions.
- [Host integration](skills/ai-commit-attribution/references/hosts.md): discovery, loading and host evidence.
- [Manual CLI integration](skills/ai-commit-attribution/references/integration.md): explicit inputs and commands.
- [Acceptance](docs/acceptance/README.md): reproducible checks and verification limits.

---

<p align="center"><sub><a href="CONTRIBUTING.md">Contributing</a> · <a href="SECURITY.md">Security</a> · <a href="docs/README.md">Documentation index</a></sub></p>
