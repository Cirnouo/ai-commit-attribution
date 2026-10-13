# Supply-chain review and build gate

## Installation and scan order

Before installation check stable Node >=24.21.0 <25 and exact pnpm 12.4.2.
Run these stages in order from every clone/worktree root; stop on any failure:

1. Run the committed standalone checker with `--phase lockfile --root .`.
2. Frozen install with scripts disabled and executable pnpm configuration disabled.
3. Run the complete target root checker: installed tree, vulnerabilities, registry
   signatures, independent complete-graph coverage and maintained evidence.
4. Perform ordinary frozen install with the same executable-config restrictions.
5. Run pending rebuild and verify actual Husky initialization in this worktree.

The runnable PowerShell sequence is:

```powershell
node --version
node tooling/security/dist/check-security.mjs --phase lockfile --root .
pnpm --ignore-pnpmfile '--config.configDependencies={}' install --frozen-lockfile --ignore-scripts
pnpm --ignore-pnpmfile '--config.configDependencies={}' check:security
pnpm --ignore-pnpmfile '--config.configDependencies={}' install --frozen-lockfile
pnpm --ignore-pnpmfile '--config.configDependencies={}' rebuild --pending
```

All controlled invocations use these flags or equivalent explicit process
environment values PNPM_CONFIG_IGNORE_PNPMFILE=true and
PNPM_CONFIG_CONFIG_DEPENDENCIES={}. The checker also rejects nonempty/malformed
configDependencies in workspace and every lock document before pnpm execution.
An unchanged frozen install may take a fast path without completing deferred
scripts. Pending rebuild must succeed without enlarging the reviewed allowlist.
Repeat the audit stages when audited inputs change.

Every controlled pnpm call disables pnpmfile and configDependencies. Disabling
lifecycle scripts alone does not disable those execution surfaces. No npm
package-lock or second install graph is maintained. Preserve release age of 1,440
minutes, strict missing-time handling, trustLockfile false, trust no-downgrade,
exotic-subdependency blocking and strict build approval. Only reviewed
esbuild@0.28.2 installation scripts are permitted. Do not automatically waive
cooldown, repair audit failures or upgrade dependencies.

First bootstrap has no target committed auditor yet. Use the unchanged tracked
standalone checker from reference commit
7e5e9ba2248cc67d51e877198a6e3e0b0eb546eb for the target lockfile phase only.
After script-disabled install, run the target TypeScript full checker with CDP
upstream responsibilities removed, then trusted install and build the target
auditor. Record source SHA, target input hashes and results. Subsequent clones
and CI use the target committed standalone bundle, never upstream full checks.

## Coverage and evidence

The root frozen lock covers runtime, development, types, optional/build,
package-manager and installer dependencies. Parse every lockfile document and
compare independent inventory counts with complete audit/signature coverage.
Unknown, missing, zero, malformed or partial results; failed network requests;
and unverifiable or invalid signatures block. Include graph coverage and audit
limitations in reports. Never present ignore-scripts installation as audit proof.

skills@1.7.2 is an exact root development dependency and uses this same graph.
Execute the audited installed CLI, not a fresh npx resolution. Its embedded
libraries have separate source/license evidence; npm graph checks do not prove
coverage of all embedded code. Preserve original notices and review that limit.

Maintained installer evidence pins the canonical registry tarball integrity,
gitHead and every original regular file's hash/length, including LICENSE,
ThirdPartyNoticeText.txt, dist notices and chunks. Derive updates independently
from the canonical tarball after SHA-512 verification, not installed bytes or
cache. Never refresh hashes automatically to repair failure. Verify registry
identity in audits and the unchanged installed inventory before using the CLI.
The original notice lists are evidence, not an exhaustive verified embedded
SBOM. In particular, their embedded yaml version may differ from the root
graph's yaml; graph audit success does not close that embedded-code boundary.

Standalone auditing and future runtime bundles use separate esbuild metafiles
to identify actual third-party code and preserve original licenses. Validate
the complete physical output tree against an independent allowlist and expected
bytes, rejecting extra/missing files, links, nonregular entries, escaping paths
and empty dirs.
Installed runtime must work outside repository dependencies.

## Vulnerabilities and bounded review exceptions

High and critical findings block by default; retain reports for other grades.
An exception requires a human-reviewed exact advisory/package/version/scope,
supporting evidence, responsible reviewer and a UTC expiry at most 30 days away.
Bind it to maintained code/config/dependency fingerprints. Reassess material
input changes, never auto-renew. Exceptions cannot waive signature, coverage,
network or execution failures. Machine records live in
security-exceptions.json, initially empty.

The schema is exactly schemaVersion 1 plus an exceptions array. Each review has
ghsa, package, version, scope, reason, triggerConditions, evidence, reviewedBy,
reviewedAt, expiresAt and fingerprints. The only target scope is repository;
upstream was a source CDP responsibility and is deliberately removed. No ranges,
wildcards, whole-package or permanent exemptions are permitted. Evidence is a
nonempty list of maintained relative files inside the code/configuration digest
sets, not URLs, escaping paths or unhashed prose. Identify an accountable human
reviewer. Review/expiry must be valid UTC ISO calendar timestamps, with no future
review, expiry after review and now, and at most 30 days after review.

Fingerprints are lowercase SHA-256 code/configuration/dependencies hashes from
the current report. Code includes maintained runtime, helpers, build/audit tools
and committed execution bundles. Configuration includes package/workspace/lock,
TypeScript/Biome/commitlint/mise, workflow/hook and maintained dependency evidence
inputs. Dependencies cover all parsed lock documents canonically sorted. File
digests bind sorted relative names, lengths and bytes. The exception file must
not hash itself. Evidence reads inspect the same open descriptor, reject final
links/nonregular files, and detect observed identity/size/time changes. Invalid,
duplicate, expired or stale reviews fail; changed code/config/graph requires new
human review rather than automatically refreshed dates or hashes.

Absence of a fix and unknown reachability are not safety evidence. Prefer an
upgrade or removal; explain why neither is presently possible for a temporary
waiver. There is no reachability analyzer or paid-service dependency here.

## Local checks and remote enforcement

The security CI stage precedes other execution. Offline verify checks committed
auditor drift and governance; complete dependency review additionally requires
the network checker. Runtime distribution checks are added with real business
outputs, never represented by empty passing placeholders. Action uses are
complete SHA pins. Remote token defaults remain read-only.

Reports are point-in-time evidence. Registry signature success does not certify
benign code or independently authenticate installed local bytes: pinned pnpm
registry audits derive identities from the lock. Frozen installation enforces
tarball integrity; installed-tree comparison separately establishes dependency
graph/inclusion agreement. Preserve that distinction in every audit report.
No continue-on-error, registry-error suppression or audit repair may bypass the
gate. Dependabot alerts supplement the full weekly review; automatic dependency
PRs remain disabled. SHA-pinned Actions and embedded installer libraries need
their own upstream advisory review and do not acquire full graph audit coverage.
