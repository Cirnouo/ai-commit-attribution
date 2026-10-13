---
name: ai-commit-attribution
description: Use when collecting or summarizing AI participation records for a scoped Git message operation. This development version provides summary evidence only.
---

# AI participation summary

This development version summarizes declared participation evidence. Before
preparing inputs or interpreting a summary, read the [record contract](references/records.md).
Use the [host registry](references/agent-registry.json) for exact host names,
aliases, research sources and unresolved discovery limits.

Run with supported stable Node >=24.21.0 <25:

```text
node <installed-skill>/scripts/attribution.mjs summarize --input <ledger.json> --operation <operation.json>
```

The command reads both explicit inputs and returns JSON. It never grants
operation permission or authenticates dispatch, participation completeness,
scope freshness or user consent. Apply the repository's disclosure policy
before using default attribution rules. Policy scanning, message rendering and
validation are not implemented in this development version.

The payload contains its own [MIT license](LICENSE), honest [runtime notices](THIRD-PARTY-NOTICES.txt)
and the [summary executable](scripts/attribution.mjs). It requires no pnpm,
TypeScript loader, source checkout or repository node_modules at runtime.
