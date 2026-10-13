# Local Git hooks

pre-commit uses lint-staged with Biome safe writes for handwritten supported
files and read-only text/YAML policy checks. commit-msg validates the original
message and real merge evidence. pre-push clears Git routing variables before
offline verification.

The ignored _/ entries are generated separately in each trusted clone/worktree.
Verify effective hooksPath and actual invocation under
[the hook policy](../docs/policies/quality.md#local-git-hook-initialization).
Preserve existing configured hooks and Git identity; never install global hooks.
