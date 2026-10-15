# Architecture decisions

[0001-summary-evidence.md](0001-summary-evidence.md) records the schema-1 event,
supplied-scope and installed summary distribution boundary. Its staged command
inventory is historical; Operation, ledger, registry and summary remain schema 1.
[0002-policy-routing.md](0002-policy-routing.md) preserves the superseded scanner,
candidate, binding and automatic freshness design.
[0003-message-attribution.md](0003-message-attribution.md) records isolated trailer
interpretation, byte-span preservation, exclusive message routing and scoped
exception applications. Its scan association and stale-routing requirements are
superseded; its trailer, preservation and exception safeguards remain applicable.
[0004-agent-policy-discovery.md](0004-agent-policy-discovery.md) records the current
Agent semantic-discovery boundary, explicit schema-2 decisions and assessments,
and minimal Git-directory lookup for output protection.

Decisions explain durable design choices and preserve their historical context.
Installed instructions in [packaging](../../packaging/README.md) own runtime
behavior; contributor policies remain in [docs/policies](../policies/README.md).
