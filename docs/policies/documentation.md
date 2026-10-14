# Documentation ownership

Every maintained non-root directory has a human-maintained README naming its
immediate responsibilities and children. `.github` uses INDEX.md instead so
GitHub does not surface an unrelated README as a repository landing page.
Generated outputs, dependencies, temporary fixtures and third-party trees do
not acquire hand-maintained README files. Review inventories and links when
adding or moving directories; do not generate navigation mechanically.

Root AGENTS.md and these policies own contributor rules. CONTRIBUTING provides
setup and submission navigation. Runtime Skill instructions own the installed
Agent workflow, not repository contributor governance. Source tests, root tools
and policies do not enter the installed Skill.

## Portable content and public evidence

Maintain this project for contributors working on different computers and in
different environments. This rule covers tracked source, configuration,
instructions, examples, test fixtures, packaging inputs, generated output and
public verification evidence. Changes must not depend on one maintainer's
machine, private workspace, conversation or execution receipt.

Use repository-relative resources, explicit operation scope and supported host
home/configuration roots as appropriate. Derive runtime and temporary fixture
locations in the executing environment. Examples and committed fixture data use
clearly synthetic identities and generic paths. Do not embed personal usernames,
machine-specific absolute paths, device identifiers, credentials or unrelated
private data. Review generated output as well as its maintained inputs; a build
does not make private content suitable for distribution.

Intentionally designated public project contact channels, public GitHub
identifiers and immutable public source references may remain. Preserve legally
required third-party notices. These public project records do not authorize
publishing other private contact details or local machine information.

Public acceptance records must stand alone: provide portable test or scenario
IDs, prerequisites, necessary commands and fixture inputs so another maintainer
can reproduce the check from source using their own explicit runtime. Report
the date, public source commit/version, platform, observed result and limits.
Distinguish automated checks from optional native-host exercises; an unexecuted
path stays unverified. Private receipt paths or inaccessible scripts cannot be
required steps, policy authorities or substitutes for reproducible instructions.

Keep detailed machine-specific execution receipts outside the repository and
discoverable Skill roots. Publish only the relevant portable observations after
reviewing the actual content for unnecessary private data. Text searches and
automated checks can assist that review; they do not prove that all private data
has been excluded. This section owns these portability and public-evidence rules;
task-specific guides link here instead of maintaining another copy.

## Instruction progressive disclosure

This adopts [Agent Skills progressive disclosure](https://agentskills.io/skill-creation/best-practices#structure-large-skills-with-progressive-disclosure).
Applying the same approach to repository AGENTS files is local policy, not an
additional requirement attributed to the Agent Skills specification.

Before editing AGENTS.md, SKILL.md, references, layout or loading contracts,
identify normal entry guidance and conditional task guidance. Keep essential
common behavior inline. Each conditional rule has exactly one authoritative
owner, a reachable link and an explicit before-use trigger at the entry point.
Local instructions supplement parent instructions; do not imply replacement.

Use references for instructions read during a task and assets for consumable
resources. Avoid duplicated normative rules and chains that require reading
every reference. Preserve semantic obligations during moves and report the
before/after ownership evidence. Never use progressive disclosure to hide
critical safety constraints. Installed references must resolve independently
of the source checkout. Keep runtime and maintainer languages understandable.

Move procedures because their use is conditional, never to meet a mechanical
word/line/token gate. Skill instruction references must be directly reachable
from SKILL.md with installed-relative links, without prerequisite chains.
Include all referenced content in an independent exact allowed file inventory,
and prove maintained-input/output equality in both directions. Installed links
to repository guides use absolute GitHub URLs. A source directory README and
an installed user guide are different responsibilities.

### Semantic migration and evidence

For every instruction move/split, map each baseline precondition, prohibition,
authorization, default, ordering rule and exception to inline guidance or one
canonical owner plus explicit before-use trigger before removing original text.
Exercise representative ordinary tasks and affected conditional operations,
including subsequent instruction/layout maintenance. Name applicable entry,
ancestor/local guidance and when each conditional owner is read.

Check links/anchors, repository/text rules, exact output inventory, input/output
equality and build drift where applicable. Size reduction, grep and valid links
alone do not prove semantic preservation; avoid wording-mirroring tests. Record
mapping, scenario scope, actual commands/results and remaining limits in PR
Verification or linked durable evidence. Scratch review reports are not policy
authorities. Static walkthroughs and host read traces are different evidence;
entry metadata acceptance does not prove a reference was read or followed.

## Root README content boundary

The README serves first-time users: purpose, current product status, supported
runtime, minimal verified installation when available, first use and links.
Move implementation internals, exhaustive policy, development history and
advanced recipes to their owners. Before committing any README change, read
the entire resulting page for coherent first-use flow and stale claims.

For each substantive paragraph record its first-use purpose and detailed owner.
Preserve necessary installation/invocation/setup/task-example steps when they
exist. A brief limitation belongs here only if it changes a first task or gives
a concrete next action; detailed acceptance history belongs with its evidence
owner. PR Verification records actual full-page review conclusions, scope,
exceptions and limits; a bare claim that the README boundary was checked is
insufficient.

## Host metadata research

Before adding or changing a host, verify official product spelling, interface,
version-sensitive discovery/loading and effective configuration behavior using
primary sources. Registry sources include verification dates and immutable
version/commit evidence when needed. Public support documentation does not
prove the model or effort used in a particular run. Ambiguous product family
names require trustworthy runtime evidence or a decision, never a guessed host.

Research each host independently, including applicable versioned implementation;
another host, directory/installer table or prior conversation is not proof.
The installed [host evidence](../../skills/ai-commit-attribution/references/hosts.md)
owns each consumer/interface, defaults,
precedence/path base, adopted field or omission, necessity/date/version/direct
primary source and unsupported/unverified behavior. Distinguish documented
support, inspected implementation, static checks, real host smoke and actual UI
presentation. Do not invent unsupported metadata or infer local requirements
from a publication portal. Update the single evidence owner when contracts change.

## Evidence and supported behavior

Report automated API simulation, actual Git behavior, platform execution and
real host loading separately. Installation, discoverability, loading and commit
path verification are distinct states. Unexecuted checks remain unverified.

Cite direct primary official sources when first adopting external conventions;
identify versions where possible and local restrictions explicitly. Accepted
forward designs may govern development before runtime exists, but installed
instructions and user guides describe verified behavior. Keep rejected designs
in decision records unless they explain a concrete user mistake. Repository
documentation must stand alone without this conversation or ignored scratch.
