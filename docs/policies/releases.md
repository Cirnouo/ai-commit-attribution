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
snapshot must agree before any Release API request. The publisher is
[tooling/release.ts](../../tooling/release.ts); [the Release workflow](../../.github/workflows/release.yaml)
queues each tag without cancelling an earlier run and requires successful reusable
CI from that same commit before its write job runs. New tag syntax is a validation
condition, not evidence of human release authorization. Direct helper invocation
does not grant authorization or establish prior CI acceptance.

Before preparing stable or prerelease publication, complete the real Skill
build, exact complete physical inventory, original license/notices and isolated
runtime checks, and verify installation from the actual fixed distribution
source. Record the source commit/payload/version and installation evidence.
Static copy or --help alone does not establish business operation acceptance.
The final generated metadata is read from skills/ai-commit-attribution/SKILL.md.
Missing or malformed metadata fails before any Release API request. No placeholder
Skill is provided. Later feature PRs add the real build, distribution and business
acceptance checks to the same-commit CI as their real outputs become available;
there is no self-declared acceptance marker. The absence of those real outputs
during repository initialization cannot authorize an early product Release.

Automatic Release notes preserve the snapshot categories under What's Changed,
optionally add New Contributors, and link Full Changelog; generated PR lists
are discarded. Stable and prerelease comparisons use the latest published stable
baseline, or current tag history if none exists. The baseline is GitHub's
[/releases/latest](https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10#get-the-latest-release),
whose stable ordering uses the release commit's created_at rather than release
publication time or maximum SemVer. A baseline must be a different valid stable
tag with neither draft nor prerelease classification. The
[generate-notes API](https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10#generate-release-notes-content-for-a-release)
receives previous_tag_name only when a stable baseline exists. Without it, the
optional generated contributor range has not been independently proven to cover
all history; Full Changelog explicitly links the current tag's commit history.
Publishing never edits Changelog or bumps versions and does not claim to rerun
independent CodeQL.

Create/resume matching drafts with pagination, verify state/classification and
recheck remote tag identity immediately before writes. An already published
matching Release is checked and skipped without rewriting notes. Stable uses
legacy latest selection; prereleases do not take latest. Failures retain drafts
without delete/recreate compensation. Only explicit HTTP 404 means a Release is
absent; transport, authentication, malformed responses and other HTTP failures
stop the run. Discovery checks every page for matching conflicts before any
draft mutation. Notes generation is a POST without saved Release effects.
Immediately before each draft/publication write, the remote ref must still be
the original annotated object. Stable publication uses make_latest=legacy;
prerelease publication uses make_latest='false'. Only GitHub source ZIP/TAR.GZ
are provided; the publisher does not upload assets or set target_commitish.

The strict original-object gate binds event.after to the original annotated tag
object and GITHUB_SHA to the checked-out peeled commit. Official
[push payload documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push)
and [Actions push documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
do not explicitly distinguish those two object types for annotated tags. Local
Git/API fixtures prove this gate's enforcement, not the actual Actions payload
semantics. No usable historical Release run was available during the 2026-10-13
read-only evidence review. Before an authorized real publication, obtain trusted
existing payload or official implementation evidence for this mapping. Never
replace the event's original object with the current remote ref to make it pass.

Immutable Releases must be enabled and read back separately before first actual
publication; the publisher does not change that repository setting. Immutability
locks release tags/assets; this project's no-notes-rewrite rule is additional
policy. No npm/PyPI publication or custom release assets are authorized.
