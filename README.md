# ai-commit-attribution

A reusable Agent Skill for recording AI assistance in Git commit messages with
scoped Agent, model and reasoning-configuration evidence.

Version 0.1.0 is Unreleased. The payload provides the complete disclosure workflow,
read-only policy scanning, participation summaries and message render/validate
commands. It includes researched host integration guidance; actual installation,
discovery, loading and message-path verification remain separate evidence states.

The workflow reads the actual repository's AI disclosure policy first. An
applicable policy owns disclosure exclusively, including alternate formats,
AI coauthors or no disclosure. When no applicable policy exists, the default
uses Assisted-by records for all relevant participants. Confirmed disabled native
reasoning is none; unknown effort is omitted. Concrete required identity/policy
gaps stop automatic continuation.

The tracked [Skill payload](skills/ai-commit-attribution/SKILL.md) runs with stable
Node >=24.21.0 <25 and trusted Git. Its single JavaScript executable needs no pnpm,
TypeScript loader, source checkout or node_modules. The canonical user layout is
~/.agents/skills/ai-commit-attribution in the executing host's home. Host discovery
and minimal no-copy integration are described in the
[host reference](skills/ai-commit-attribution/references/hosts.md).

For a first task from this checkout, read the
[integrator guide](skills/ai-commit-attribution/references/integration.md), identify
the actual worktree/operation and prepare its explicit operation/context JSON.
Run from the checkout root:

```text
node skills/ai-commit-attribution/scripts/attribution.mjs policy scan --operation operation.json --context context.json
```

Read the returned candidates and prepare the bound semantic decision under the
[policy contract](skills/ai-commit-attribution/references/policy.md). On the default
branch, the human or Agent integrator supplies an event ledger from actual
dispatch/handoff evidence, including planning, review and testing. The guide
shows the required shape and links the full
[record contract](skills/ai-commit-attribution/references/records.md). Preview a
message with the same executable:

```text
node skills/ai-commit-attribution/scripts/attribution.mjs render --message message.txt --operation operation.json --context context.json --decision decision.json --input ledger.json
```

Render returns JSON; an explicit --output creates a separate new file. Validate
checks a candidate without writing. On repository-policy, omit default ledger
inputs and check the repository rule separately: exit 10 is an unverified handoff.
See the [message contract](skills/ai-commit-attribution/references/messages.md).
For an installed copy or another cwd, replace the script path with its absolute
installed path. Helpers prepare/check data and do not authorize or perform commits.

The [acceptance guide](docs/acceptance/README.md) provides portable synthetic cases,
reproduction commands, all eighteen requirement IDs and observed limits. Final
immutable-GitHub-source acquisition and safe user installation follow all seven
merged PRs and passing main CI; a completed source installation is not claimed
here. Use its installation gate before updating an existing canonical copy.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for trusted development setup and review,
[AGENTS.md](AGENTS.md) for contributor entry instructions, and
[the policy migration record](docs/policies/migration.md) for adopted governance.
Development uses exact pnpm 12.4.2 and Node 24.21.0 as the CI reproduction baseline.

Use Issues for ordinary questions and proposals. Before submitting a typed bug
or feature report, read the [current forms](.github/ISSUE_TEMPLATE/README.md) and
[Issue submission policy](docs/policies/commits-and-scope.md#typed-issue-submissions).
Freeform Issues remain available. Report suspected vulnerabilities through
[SECURITY.md](SECURITY.md). The project is licensed under [MIT](LICENSE).
