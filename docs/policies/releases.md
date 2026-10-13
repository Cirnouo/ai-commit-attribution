# Versions and releases

Root private package.json.version is the unique SemVer authority. Version 0.1.0
remains Unreleased during initial development. Future builds derive Skill
metadata.version from it. Use strict SemVer2.0 with the repository compatibility
profile: maximum 256 characters and core integers no larger than the JavaScript
safe-integer limit. Build metadata is valid for general version parsing but
forbidden in publishing tags. Do not silently normalize versions.

Use [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). Compatible fixes increment
patch; compatible additions increment minor; stable breaking interfaces increment
major. During zero-major development, intentionally incompatible workflows
increment minor. Published versions are immutable; never reuse one for changed
content. A release category does not waive compatibility or verification rules.

Reject prefixes v/V, leading/trailing whitespace, leading-zero core numbers,
missing core components and invalid prerelease/build identifiers. All major,
minor and patch components fit Number.MAX_SAFE_INTEGER; the numeric prerelease
profile follows the pinned semver parser rather than reusing the core bound.
Arbitrary legal prerelease labels are permitted. These compatibility restrictions
are this repository's tested profile, not additional SemVer specification rules.

## Changelog editing workflow

Before editing CHANGELOG.md, query the latest actually published stable Release,
excluding drafts and prereleases. Record the source/date/baseline and rationale
in PR verification. Local tags alone do not prove publication. Describe cumulative
net user changes against that baseline using Added, Changed, Deprecated, Removed,
Fixed and Security. Before the first stable product, use the nonexistent-product
baseline and Added/Security; do not report abandoned designs, cleanup or internal
iterations as delivered changes. Do not invent release dates or bump versions
merely for development progress.

Prerelease preparation copies current cumulative Unreleased changes into a
dated snapshot and retains Unreleased. Stable preparation archives delivered
changes and clears them from Unreleased. Preserve historical entries. No stage
sequence or automatic version bump is required.

## Tag-triggered GitHub publication

Tagging and actual publication require separate explicit authorization. Routine
development, merges and user Skill installation grant neither. The publisher
will accept only newly created annotated v<semver> tags without build metadata,
reject forced/deleted/updated events, verify original local/remote tag objects,
peeled commit/event/checkout agreement and main ancestry, then require that
commit's CI. Root/Skill/tag versions and a unique nonempty valid dated Changelog
snapshot must agree before Release API writes. This initial PR provides policy;
the complete publisher and recovery tests are introduced in the release PR.

Before preparing stable or prerelease publication, complete the real Skill
build, exact complete physical inventory, original license/notices and isolated
runtime checks, and verify installation from the actual fixed distribution
source. Record the source commit/payload/version and installation evidence.
Static copy or --help alone does not establish business operation acceptance.
These gates become executable with the later feature PRs; their absence during
repository initialization cannot authorize an early product Release.

Automatic Release notes preserve the snapshot categories under What's Changed,
optionally add New Contributors, and link Full Changelog; generated PR lists
are discarded. Stable and prerelease comparisons use the latest published stable
baseline, or current tag history if none exists. Publishing never edits Changelog
or bumps versions and does not claim to rerun independent CodeQL.

Create/resume matching drafts with pagination, verify state/classification and
recheck remote tag identity immediately before writes. An already published
matching Release is checked and skipped without rewriting notes. Stable uses
legacy latest selection; prereleases do not take latest. Failures retain drafts
without delete/recreate compensation. Only GitHub source ZIP/TAR.GZ are provided.

Immutable Releases must be enabled and read back separately before first actual
publication; the publisher does not change that repository setting. Immutability
locks release tags/assets; this project's no-notes-rewrite rule is additional
policy. No npm/PyPI publication or custom release assets are authorized.
