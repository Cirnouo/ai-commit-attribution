---
name: ai-commit-attribution
description: Use when preparing or editing a Git commit message, checking its applicable AI disclosure policy, or collecting and summarizing scoped AI participation evidence.
metadata:
    version: 0.1.0
---

# AI policy and participation evidence

Read applicable repository disclosure instructions before default attribution.
Repository policy applies exclusively, including rules permitting AI coauthors,
forbidding disclosure or forbidding just one marker. Scan finds evidence; the
Agent decides its meaning. Unresolved applicability/read issues stop the operation.
Before preparing a scan or semantic decision, read the [policy contract](references/policy.md).
Before preparing inputs or interpreting a participation summary, read the [record contract](references/records.md).
Before rendering, validating or interpreting a message result, read the [message contract](references/messages.md).
Use the [host registry](references/agent-registry.json) for exact host names,
aliases, research sources and unresolved discovery limits.

Run with supported stable Node >=24.21.0 <25:

```text
node <installed-skill>/scripts/attribution.mjs summarize --input <ledger.json> --operation <operation.json>
node <installed-skill>/scripts/attribution.mjs policy scan --operation <operation.json> --context <context.json>
```

The command reads both explicit inputs and returns JSON. It never grants
operation permission or authenticates dispatch, participation completeness,
scope freshness or user consent. Apply the repository's disclosure policy
before using default attribution rules. A bound semantic decision must be checked
again immediately before consumption and after waiting or material changes.
Repository-policy handoff skips default checks and leaves policy validation
unperformed. Render previews a candidate and writes only an explicitly requested
new file; validate is read-only. Neither command performs the real Git operation.
Required evidence gaps stop, while unknown optional effort is omitted.

The payload contains its own [MIT license](LICENSE), honest [runtime notices](THIRD-PARTY-NOTICES.txt)
and the [summary executable](scripts/attribution.mjs). It requires no pnpm,
TypeScript loader, source checkout or repository node_modules at runtime.
