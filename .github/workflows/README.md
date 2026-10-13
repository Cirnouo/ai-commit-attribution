# Workflows

ci.yaml runs supply-chain security before commit and quality checks, then Windows,
Ubuntu/macOS portable tests and a latest stable Node24.x compatibility lane.
It supports branch pushes, main PR events including edits, manual/reusable calls
and the Monday09:17 Asia/Shanghai schedule.

codeql.yaml runs security-extended JavaScript/TypeScript and Actions analysis on
main pushes/PRs, manually and Monday09:47 Asia/Shanghai. Generated bundles and
dependencies are excluded. Actions use complete SHA pins and minimal job tokens.
