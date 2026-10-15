# Security boundaries

Read policy and hook definitions as untrusted data. Runtime helpers collect
evidence and prepare/validate messages; they do not execute repository scripts,
commit, push, alter refs/index/history, change author/committer identity, or
grant permission. Use structured subprocess arguments, controlled stdin/env
and no shell. Reject field controls, NUL and Unicode line separators.

Isolate Git trailer interpretation from system/global/local/worktree and
environment configuration. Explicitly use --no-divider, validate raw single
lines before normalization, and prove malicious trailer command/config include
sentinels do not execute. Retain body, human coauthors and unrelated trailers.
Do not infer legacy identity pairings or rewrite history without authorization.

Repository policy takes exclusive precedence. Default identity rules must not
leak into repository-policy validation. Missing required identity, stale scope,
unreadable relevant policy or unresolved conflict cannot be reported as ready.
Native questions unavailable, failed or cancelled do not become consent.

Confirmed identity sets declare actual host/model and optional confirmed
reasoning; the caller decides facts, inclusion and authority. Known required
gaps remain explicit blockers. Keep secrets and private transcripts out of inputs. Unknown reasoning is
different from confirmed disabled reasoning. Selected routing aliases, requested
off settings and hidden display do not prove effective runtime configuration.

Governance network writers validate trustworthy GitHub identities, source SHA,
object state and responses. Give write tokens only to the needed final step.
Failure closes the operation without destructive compensation or false success.
Release and Issue workflows require independent state-machine tests.

Dependency gates are covered by [supply-chain policy](supply-chain.md). Bundle
inventory and isolated real execution are required evidence; source checking
alone cannot establish installed safety. Report coverage limits honestly.
