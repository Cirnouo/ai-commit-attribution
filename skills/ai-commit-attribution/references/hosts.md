# Host discovery, identity acquisition and native interaction evidence

Read this reference before host-specific discovery/loading/configuration,
effective identity acquisition or native-question use. The [registry](agent-registry.json)
alone owns canonical names and aliases; [records](records.md) owns identity and
event resolution semantics. Sources below were researched on 2026-10-13/14.
Mutable documentation establishes no minimum release; pinned revisions establish
the inspected implementation, not every installed release or current session.

H means the executing backend's home; P means its documented project base.
The one requested user Skill layout is H/.agents/skills/ai-commit-attribution.
A remote, WSL, container, cloud or different-user backend does not automatically
have access to the local copy. Native discovery support is separate from actual
installation, selected source/winner, loaded body/references and message-path
execution. Consult the dated [acceptance record](https://github.com/Cirnouo/ai-commit-attribution/blob/main/docs/acceptance/README.md)
for observed scope; no per-host installation/loading pass is implied here.

## Consumers and minimal integration

The table covers all 23 registered hosts in 13 families. A shared profile is
identified below; it does not establish identical runtime availability across
that family's clients. An installer target ID is not an acting Agent identity.

| Canonical registry host | Consumer and native canonical layout evidence | Profile / smallest integration |
| --- | --- | --- |
| Codex CLI | Terminal CLI; interactive/exec are modes. H/.agents/skills documented. | CX; native root, explicit $ai-commit-attribution |
| Codex App | Local desktop client; backend environment still matters. | CX; same local root, observe selected source |
| Codex IDE Extension | Codex extension; arbitrary ACP clients are separate consumers. | CX; observe extension/backend home |
| Claude Code CLI | Personal documented root H/.claude/skills; direct .agents discovery not established. | CC; explicit read of canonical SKILL and required references |
| Claude Code Desktop | Local Code session; SSH/cloud/Cowork paths are separate. | CC; explicit local read where accessible |
| OpenCode CLI | Terminal TUI, headless/server modes identified separately. H/.agents/skills documented. | OC; native root |
| OpenCode Desktop | Client with executing OpenCode backend. | OC; verify backend home/version |
| OpenCode Web | Browser to OpenCode server; server filesystem owns discovery. | OC; canonical tree must be accessible to server |
| DeepSeek Harness Desktop | Filesystem-provider/registry consumer. | DS; native agents-home root if provider enabled |
| DeepSeek Harness Web | Browser to Harness host. | DS; provider and host filesystem must expose tree |
| GitHub Copilot CLI | Interactive/programmatic CLI; H/.agents/skills documented. | GH; native root |
| GitHub Copilot for VS Code | VS Code Copilot extension/harness. | VS; native root, actual extension host/profile |
| Cursor CLI | Terminal agent; print/ACP are modes/interfaces. | CU; confirm deployed CLI's skill contract |
| Cursor IDE | Local Cursor Agent; H/.agents/skills documented. | CU; native root |
| Cursor Cloud Agent | Documented sync excludes local .agents/skills. | CU; no no-copy bridge established |
| Gemini CLI | Interactive/headless/ACP CLI; canonical alias documented. | GE; native root, check shadowing |
| Cline for VS Code | Pinned implementation scans H/.agents/skills; public guide omits it. | CL; verify installed version, no inferred release minimum |
| Roo Code for VS Code | Mode-aware VS Code extension; H/.agents/skills documented. | RO; native root can be shadowed |
| goose CLI | CLI with Skills platform extension. | GO; native root if extension enabled |
| goose Desktop | Desktop with Skills platform extension/backend. | GO; observe discovered source |
| aider CLI | Native SKILL catalog not established by sources. | AI; --read or /read canonical absolute SKILL path |
| Pi CLI | Independent Pi; TUI/print/JSON/RPC are CLI modes/interfaces. | PI; native user .agents source |
| oh-my-pi CLI | Independent omp fork; interfaces do not imply Desktop. | OM; default-enabled native agents provider |

Direct-root consumers need no extra pointer merely because they are registered.
For Claude local Code, request a session read of the canonical absolute SKILL
path and then its conditional references; this is not automatic .agents
discovery. Claude documents symlink support, but creating a link requires
applicable authorization. Aider documents --read <file> and /read <file> for
read-only context; conditional references require subsequent explicit reads.
For an inaccessible remote/cloud backend, report the filesystem/sync gap.
Keep any proposed native pointer/config fragment inside the Skill until its
exact external change is authorized; do not create another rule main, overwrite
host instructions or add a global hook.

## Discovery, loading and metadata profiles

Common adopted metadata is name/description plus build-generated metadata.version.
Support for a standard metadata object does not prove a host consumes version.
No host-specific optional controls are needed for this workflow. Their omission
preserves normal automatic discovery; it does not guarantee selection or UI.

**CX — Codex.** Documented roots are repository .agents/skills from cwd to
repository root, H/.agents/skills, admin /etc/codex/skills and system skills.
Same-name entries are not merged and may both appear; observe the selected source.
Metadata is advertised before body loading; explicit $name is supported.
Optional agents/openai.yaml can control UI, implicit invocation and dependencies.
No icon, dependency, default prompt or explicit-only policy is needed, so it is
omitted; implicit invocation is documented as enabled by default.
[Skill documentation](https://learn.chatgpt.com/docs/build-skills),
[customization](https://learn.chatgpt.com/docs/customization/overview), 2026-10-14.

**CC — Claude Code.** H/.claude/skills is personal; project .claude/skills is
discovered from launch cwd toward the repository/worktree root. An additional
directory needs its .claude/skills layout; .agents as --add-dir is not a proven
shortcut. Same-name command order is enterprise > personal > project, with
namespaced plugins/nested skills separate. Auto relevance or /name loads body;
watchers/reload and symlinked local directories are documented. Omit model,
effort, context, hooks, allowed-tools and invocation-disable controls. Local
Desktop Code reads personal skills; SSH reads remote home; account/cloud/Cowork
mechanisms are distinct.
[Skills](https://code.claude.com/docs/en/skills),
[Desktop](https://code.claude.com/docs/en/desktop), 2026-10-14.

**OC — OpenCode.** User roots: H/.config/opencode/skills, H/.claude/skills and
H/.agents/skills. Project .opencode/.claude/.agents skills roots are searched
cwd-upward to the Git worktree. Complete duplicate-root precedence remains
unestablished; use diagnostics. The skill tool loads body on demand; permissions
can hide it. Omit optional opencode/slash and opencode/autoinvoke controls.
Web's executing server owns the filesystem; browser location is irrelevant.
[Skills](https://opencode.ai/docs/skills/), [Web](https://opencode.ai/docs/web/),
2026-10-14; deployed Desktop/backend versions remain to be observed.

**DS — DeepSeek Harness.** Lower filesystem ranks first: P/.dsh/skills 100,
P/.agents/skills 200, custom directories 300, dshHome/skills 400,
agentsHome/skills 500, optional bundled root 600. P is nearest .git ancestor,
else cwd; defaults use DSH_HOME or H/.dsh and DSH_AGENTS_HOME or H/.agents.
Provider/config overrides and includeDefaultRoots:false change discovery.
Immediate bundles or flat Markdown are scanned; catalog and body have separate
lifetimes and loading re-reads body. Name/description suffice; extra UI fields
are omitted. Provider evidence does not establish every deployment's plugins.
[Filesystem provider](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/skill/skill-filesystem/README.md),
revision d743267388641bc76f17c45ce8b4c231aed1d32c, inspected 2026-10-14.

**GH / VS — Copilot.** CLI user roots H/.copilot/skills and H/.agents/skills;
repository .github/.claude/.agents skills roots. VS Code also documents personal
H/.claude/skills. CLI explicit slash/skills diagnostics and automatic loading
are documented. Complete personal/project collision precedence is unestablished.
VS Code's primary-workspace winner is a narrower duplicate-.github rule;
parent-repository discovery is optional. Omit deprecated chat.agentSkillsLocations
and other extras; name/description suffice. Extension host/profile matters.
[CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills),
[VS Code skills](https://code.visualstudio.com/docs/agent-customization/agent-skills),
2026-10-14 (VS Code page 2026-10-07).

**CU — Cursor.** Local user/project .agents/skills and .cursor/skills, plus
compatible Claude/Codex roots, are documented. Discovery is recursive, metadata
first/body on demand; complete collision precedence is unestablished. Omit paths,
disable-model-invocation and custom-mode UI fields. Cloud sync copies only
opted-in H/.cursor/skills; local .agents is explicitly excluded. No no-copy
bridge to the single canonical local tree was established.
[Skills](https://cursor.com/docs/skills),
[Cloud sync](https://prod.cursor.com/help/ai-features/cloud-agents), 2026-10-14.

**GE — Gemini CLI.** Documented precedence: built-in < extension < user
(H/.gemini/skills or H/.agents/skills) < workspace (.gemini/.agents skills).
Same-tier alias ties remain unestablished. /skills list/reload and enable/disable
are documented; activate_skill loads full instructions and has its own consent,
distinct from a missing-identity decision. No extra metadata is needed.
[Skills](https://geminicli.com/docs/cli/using-agent-skills/), 2026-10-14;
[activation](https://geminicli.com/docs/tools/activate-skill/), 2026-10-13.

**CL — Cline for VS Code.** Public documentation lists personal .cline and
project .clinerules/.cline/.claude skills. Pinned source additionally scans
personal/project .agents. Its reverse dedup gives enterprise > global agents >
global cline > project agents > project claude > project cline > project clinerules.
Only direct child bundles are scanned; name must match directory and body is
re-read by selected available-skill path. Omit enabled/disabled controls; actual
installed version and minimum supporting release are unverified.
[Guide](https://docs.cline.bot/customization/skills),
[directories](https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/apps/vscode/src/core/storage/skill-directories.ts),
[loader](https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/apps/vscode/src/core/context/instructions/user-instructions/skills.ts),
revision ed469c753a0d7a0d41f906cf3fc75a983cd766ac, inspected 2026-10-14.

**RO — Roo Code.** High to low: project roo-mode, roo-generic, agents-mode,
agents-generic, then the corresponding four global roots. Thus generic personal
.agents is lowest of those sources. Windows USERPROFILE base is documented.
Startup indexing, watchers, mode filtering and on-demand loading are supported;
omit mode/glob/invocation overrides.
[Skills](https://roocodeinc.github.io/Roo-Code/features/skills/), 2026-10-14.

**GO — goose.** Official guide recommends personal/project .agents/skills;
plugins are namespaced and legacy .goose/.claude/config roots are compatible.
The Skills platform extension is default-enabled; active session configuration
still matters. Metadata arrives at startup, body on demand or explicit /skills.
Complete collision/home-remapping precedence remains unestablished. No extra
host metadata is needed.
[Official guide](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/using-skills.md),
2026-10-14; mutable source, not a minimum release.

**AI — aider.** Native SKILL catalog discovery remains unestablished, rather
than proven unsupported. --read and /read accept an absolute read-only context
file; no host metadata/configuration is adopted for that integration.
[Conventions](https://aider.chat/docs/usage/conventions.html), 2026-10-14.

**PI — Pi.** Pinned package manager uses HOME or os.homedir for .agents home.
Resources rank project settings > project auto > user settings > user auto >
packages, with stable insertion ties. Project .pi/skills and ancestor .agents
sources, personal Pi/agents roots, settings and packages participate. Loader puts
CLI-enabled skills before enabled resources, then additional paths, and disables
standalone default scanning. First same name wins with diagnostics; realpath
dedup, recursive scanning and root .agents Markdown exclusion apply. Settings
paths use project .pi/user agent directory, packages use package root, explicit
paths use cwd. Metadata first; read or /skill:name loads body; /reload refreshes.
--no-skills disables defaults but explicit skill paths remain. Omit invocation
suppression; trust/filter/custom-loader settings still matter.
[Package manager](https://github.com/earendil-works/pi/blob/e6220e1316f86af818a0ccbfe1c09d7e918b41cf/packages/coding-agent/src/core/package-manager.ts),
[resource loader](https://github.com/earendil-works/pi/blob/e6220e1316f86af818a0ccbfe1c09d7e918b41cf/packages/coding-agent/src/core/resource-loader.ts),
[skill loader](https://github.com/earendil-works/pi/blob/e6220e1316f86af818a0ccbfe1c09d7e918b41cf/packages/coding-agent/src/core/skills.ts),
revision e6220e1316f86af818a0ccbfe1c09d7e918b41cf, inspected 2026-10-14.

**OM — oh-my-pi.** Native personal root H/.omp/agent/skills; native agents
provider scans H/.agent/skills and H/.agents/skills, plus project walk-up sources.
Agents user discovery is default-enabled, separate from foreign-provider opt-in.
Conventional roots scan direct bundles. Provider priorities include native 100,
skillshare 95, omp-plugins 90, claude 80, agent-plugins 75, agents/codex/claude-plugins
70, opencode 55, github 30, managed 5, then registration ties. Custom directories
can override; differing collisions stay accessible under namespaces, identical
ones collapse by realpath/content. No universal user-wins order applies.
Metadata first; read skill://name or /skill:name loads body. Omit globs,
alwaysApply/hide/enabled overrides.
[Skills](https://github.com/can1357/oh-my-pi/blob/818dd42b73ab1caad17fa06d4edcc3a97086dc57/docs/skills.md),
[agents provider](https://github.com/can1357/oh-my-pi/blob/818dd42b73ab1caad17fa06d4edcc3a97086dc57/packages/coding-agent/src/discovery/agents.ts),
[capability order](https://github.com/can1357/oh-my-pi/blob/818dd42b73ab1caad17fa06d4edcc3a97086dc57/packages/coding-agent/src/capability/index.ts),
revision 818dd42b73ab1caad17fa06d4edcc3a97086dc57, inspected 2026-10-14.

## Effective identity acquisition

Capture the actual event's trusted dispatch/runtime evidence, confirmed launch
controls and resolved effective configuration. Static config is candidate data;
session overrides, fallback, child configuration and model changes matter. The
record contract owns formal mappings and optional effort resolution. Do not read
hidden reasoning or collect credentials/private transcripts for this purpose.

| Host profile | Useful observation and concrete limits |
| --- | --- |
| CX | Trusted current runtime/dispatch; CLI /status and effective session controls. Shared config alone cannot establish actual dispatch or child settings. [CLI](https://learn.chatgpt.com/docs/cli/reference), [settings](https://learn.chatgpt.com/docs/developer-settings) |
| CC | /status, actual session model and /effort; aliases/fallback and skill/subagent overrides matter. ultracode is a workflow setting; ultrathink is not an API effort observation. [Model configuration](https://code.claude.com/docs/en/model-config) |
| OC | Actual provider/model and resolved agent/variant parameters; provider/model routes need verified supplier mapping and custom variant names need native-setting evidence. [Models](https://opencode.ai/docs/models/) |
| DS | Actual request headers identify resolved provider/model/adapter-owned effort. Picker/requested off alone is insufficient; adapters can omit or map parameters. [Agent runtime](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent/README.md) |
| GH / VS | Resolve Auto to actual session dispatch; CLI /model and VS Code actual model/Thinking Effort controls are candidate evidence with overrides/fallback checked. [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [VS Code models](https://code.visualstudio.com/docs/agent-customization/language-models) |
| CU / GE / CL / RO | Obtain trusted actual run/handoff and effective provider settings; this source set does not establish a universal extractor. Gemini aliases/custom thinkingConfig require actual mapping. [Gemini settings](https://geminicli.com/docs/reference/configuration/) |
| GO | Inspect the actual participation chain when an ACP provider executes another agent; a selected provider is not proof every child shares the host/model. [Official repository](https://github.com/aaif-goose/goose) |
| AI | Main/editor/weak model roles can differ; thinking-tokens 0 disables native thinking only where the adapter supports it. [Reasoning](https://aider.chat/docs/config/reasoning.html) |
| PI | Per-assistant response physical provider/api/model and thinkingLevel outrank a virtual selector/current ctx.model for that historical dispatch. Model/thinking selection can clamp or route; extension-supplied children need their own evidence. [Session format](https://pi.dev/docs/latest/session-format), [virtual models](https://pi.dev/docs/latest/virtual-models), [disablement fixes](https://pi.dev/changelog/releases/0.62.0) |
| OM | Actual wire model can differ through requestModelId/effortRouting; requiresEffort can clamp off. hide-thinking is display-only; external-thinking has distinct native/private-scratchpad semantics requiring scope-aware evidence. Child hooks/roles/fallback can override selection. [Models](https://github.com/can1357/oh-my-pi/blob/818dd42b73ab1caad17fa06d4edcc3a97086dc57/docs/models.md), [child discovery](https://github.com/can1357/oh-my-pi/blob/818dd42b73ab1caad17fa06d4edcc3a97086dc57/docs/task-agent-discovery.md) |

These identity sources were recovered/checked on 2026-10-13/14 and establish
observation methods/capabilities, not the actual identity of a future event.

## Native questions by actual mode

Inspect the tools exposed in the current dispatch and their mode restrictions.
A Plan-only synchronous tool does not prove an asynchronous facility is absent.
Tool existence, a call notification and an actual human answer are different
observations. No universal adapter or terminal polling substitute is provided.

| Profile | Documented capability and unverified boundaries |
| --- | --- |
| CX | App-server item/tool/requestUserInput supports client replies; particular clients can expose synchronous/asynchronous facilities with their own gating. autoResolutionMs/cleanup resolution is not a human answer. CLI exec is noninteractive; do not infer another client's tools. [App server](https://learn.chatgpt.com/docs/app-server) |
| CC | Exact current native structured question/mode contract was not established in this source set. Interactive chat or /btw does not prove agent-to-user structured tooling. [Desktop](https://code.claude.com/docs/en/desktop) |
| OC | question tool has option/custom-answer navigation and permissions; actual TUI/Desktop/Web/run/SDK rendering and cancellation remain to be tested. [Question](https://opencode.ai/docs/tools/#question) |
| DS | ask_user_question has connected-client answer/cancel seams. Timed foreground expiry can return pending:true/callId; later answer is separate and closing a panel sends none. [Questions](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/docs/subsystems/user-questions.md) |
| GH | ask_user is documented; --no-ask-user suppresses clarification. Programmatic-mode answer/cancel/failure behavior is not established by a tool listing. [CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) |
| VS | #vscode/askQuestions provides interactive controls; actual harness/extensions/mode and headless/cancellation behavior must be observed. [Tools](https://code.visualstudio.com/docs/agents/reference/tools-reference) |
| CU | CLI AskQuestion and ACP cursor/ask_question are documented; ACP distinguishes answered/skipped/cancelled. Print, IDE exact registration and Cloud behavior remain separate unknowns. [CLI changelog](https://cursor.com/changelog/04-14-26), [ACP](https://prod.cursor.com/docs/cli/acp) |
| GE | ask_user presents a dialog and answers/dismissal JSON. Headless/ACP/error behavior remains unobserved; policy-engine approval decisions are a different interface. [ask_user](https://geminicli.com/docs/tools/ask-user/) |
| CL / GO / AI | Exact current native clarification facility was not established here; skill discovery/read-only context support supplies no question proof. |
| RO | ask_followup_question is documented; exact mode/headless/cancel/failure behavior remains to be observed. [Tool](https://roocodeinc.github.io/Roo-Code/advanced-usage/available-tools/ask-followup-question/) |
| PI | Extension ctx.ui requires actual extension availability and ctx.hasUI. TUI supports dialogs; RPC forwards supported UI interactions; print/JSON has no UI; SDK embedding is client-specific. [Extensions](https://github.com/earendil-works/pi/blob/e6220e1316f86af818a0ccbfe1c09d7e918b41cf/packages/coding-agent/docs/extensions.md), [RPC UI](https://github.com/earendil-works/pi/blob/e6220e1316f86af818a0ccbfe1c09d7e918b41cf/packages/coding-agent/docs/rpc-extension-ui.md) |
| OM | ask requires ask.enabled and prompt-capable UI/session. No UI/cancel can abort. Timeout defaults 0; plan disables it, but configured timeout may choose recommended/first automatically and mark timedOut. RPC/ACP prompting must be checked. [ask](https://github.com/can1357/oh-my-pi/blob/818dd42b73ab1caad17fa06d4edcc3a97086dc57/docs/tools/ask.md) |

Question sources were inspected 2026-10-14. Real answer/cancel/failure outcomes
were not established by this source research. Pending, timedOut, automatic
selection and cleanup notifications cannot resolve a required decision.
