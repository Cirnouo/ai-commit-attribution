# Operation-bound policy evidence and semantic routing

Accepted 2026-10-14 for policy routing, against the merged schema-1 summary contract.

Reuse parseOperation as the supplied-scope owner and add the single compatible
kind merge. Explicit merge message editing needs its own active MERGE_HEAD,
parent/target/path binding rather than an overloaded commit label. Existing five
kinds and ledger shapes remain accepted. policy-scope owns deterministic ordinal
JSON serialization and live Git/path/invocation digests; policy-evidence owns
bounded discovery, evidence identity/bytes and checked presence/absence.

Scan collects candidates without choosing policy from names, keywords, hooks or
historical trailers. The Agent supplies a complete semantic assessment bound to
the scan. Repository disclosure policy is exclusive; ordinary format rules alone
leave defaults applicable. Current repository-policy hands off unverified with
exit 10, and no default summary/registry is imported/read. Incomplete unsafe
observation, unresolved assessments or stale evidence requires a decision.

checkFreshRouting takes operation, context and decision, recaptures once, and
returns flat PolicyRouteCheck fields plus internal freshScan: PolicyScan from
that same capture. PR6 can join signature evidence to the precise current
inventory/text/hash only when routing is current. CLI projects out freshScan,
preserving the public route JSON contract and avoiding a second scanner/capture.
JSON provenance records declarations, not authentication or permission.

Every Git call uses a reviewed host absolute executable, guarded no-lazy-fetch,
controlled environment/stdin and read-only plumbing. An unsafe installation,
unsupported object/metadata/config/include behavior or exhausted budget closes
without fallback. Includes are bounded as data but unresolved inline precedence
requires a decision. The installed policy contract owns exact runtime behavior,
limits, candidate inventory and caveats; this record explains ownership choices.

Bound raw bytes rather than stat-only freshness. Descriptor/path checks and
recapture improve evidence but cannot provide an atomic snapshot or eliminate
later races. Future message rendering/validation and actual host acceptance
remain separate deliveries. Helpers never execute policy scripts or change Git
state/configuration/identity, and never authorize an operation.
