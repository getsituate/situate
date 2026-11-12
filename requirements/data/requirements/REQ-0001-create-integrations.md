---
id: REQ-0001
type: requirement
title: Create integrations from natural-language user requests
status: approved
priority: must
area: Integrations
goals: [GOAL-0001]
acceptanceCriteria:
  - id: AC-01
    text: "For a tool not yet in the integration catalog with usable access, users can describe the tool and intended use in their own words and request an integration."
    status: open
  - id: AC-02
    text: "Situate creates an integration that can actually perform the agreed function; users do not have to write code."
    status: open
  - id: AC-03
    text: "Requesting plugin creation or modification from a normal chat opens and focuses a separate, visibly labeled development conversation with the assignment and necessary context; work starts without a repeated prompt or submission."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-04
    text: "On sufficiently large displays, the new conversation opens in an additional pane beside the originating chat; narrow displays follow responsive view switching."
    status: open
  - id: AC-05
    text: "Neither conversation switches its type during or after the development assignment."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-06
    text: "The originating chat accepts further user work while development proceeds independently."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-07
    text: "Successful activation produces a workspace-scoped availability notice in the originating chat without resuming or executing its previous request, even if that chat has since moved to another topic."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-08
    text: "Pending or failed activation is not reported as an available plugin."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-09
    text: "A request to remember or correct personal working instructions stays in the normal chat and exposes persistent changes there; a request to develop a reusable workflow opens a development conversation regardless of whether it produces code or Markdown."
    status: open
  - id: AC-10
    text: "A discussion about plugins without a development request does not itself start development."
    status: open
  - id: AC-11
    text: "Users can provide required access or permissions. If these are missing, the affected function is not presented as ready to use."
    status: open
  - id: AC-12
    text: "If the available access cannot support a requested function, Situate explains that limitation rather than claiming a working connection."
    status: open
  - id: AC-13
    text: "Outside recovery, a requested generated plugin can be activated and run without a separate code-activation confirmation; its code changes remain recoverable."
    status: open
  - id: AC-14
    text: "During recovery, source inspection or editing alone does not resume installed plugins. Requested development may preview, run executable checks and activate checked targets without resuming unrelated suspended plugins or replaying interrupted work."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-15
    text: "A plugin can explicitly depend on another plugin and can consume a common provider interface without hard-coding every provider."
    status: open
  - id: AC-16
    text: "A consumer can use another plugin's explicitly exported Vue component through a declared dependency; unexported components remain local."
    status: open
  - id: AC-17
    text: "Two plugins can use the same local component name without automatically replacing or exposing each other's components."
    status: open
  - id: AC-18
    text: "Required plugin installations are presented together for confirmation before installation."
    status: open
  - id: AC-19
    text: "Situate generates tests for created or modified integrations."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-20
    text: "Two consumer plugins can reuse the same integration and connected account without configuring a second connection."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-21
    text: "Each consumer can select different accounts; adding another integration account leaves existing selections unchanged."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-22
    text: "Before changing a reusable interface, the agent identifies its declared consumers and updates affected plugins within the requested development scope without requiring users to edit code."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-23
    text: "A plugin can define and extend a shared domain interface without adding a core-defined inbox or mail contract; only explicitly exported functionality is made available to consumers."
    status: open
  - id: AC-24
    text: "Checks cover preservation of existing behavior in affected plugins before the change set is activated."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-25
    text: "A complete plugin source directory contains its manifest, skill files and supporting resources; copying it preserves skill content and mode assignments without copying files into the host's profile source tree."
    status: open
  - id: AC-26
    text: "A plugin can provide a skill exclusively to normal chat, exclusively to plugin development, or to both; skills excluded from a mode are not advertised or loaded as active guidance there."
    status: open
  - id: AC-27
    text: "Skill mode assignments are declared only in `plugin.json`; frontmatter is not a second source of mode configuration, and undeclared files do not become active merely by being present."
    status: open
  - id: AC-28
    text: "Matching skills are discoverable through their names and descriptions, with full text loaded when needed and source identity retained."
    status: open
  - id: AC-29
    text: "Development-specific skills can guide authoring while the development host profile and task-scope rules remain governing instructions."
    status: open
  - id: AC-30
    text: "Editing or inspecting a skill does not immediately change the developing agent's active guidance. A disabled plugin contributes no active skills until explicitly enabled or activated after checks under REQ-0033; temporarily suspended plugins contribute no active skills in either mode until individually resumed, included in resume-all where eligible, or activated after successful development checks."
    status: open
  - id: AC-31
    text: "Starting development requires an assignment, not a selected package or package type; an existing-plugin entry supplies context without limiting access to that plugin."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-32
    text: "With the same workspace, device capabilities and recovery state, development has the same workspace writes, navigation, available shell access and enabled plugin tools as ordinary chat, under the same task scope and access rules."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-33
    text: "One development conversation can discover and adapt multiple related connections, consumers, views and ordinary workspace files without a separate conversation or approval merely to expand the affected package set."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-34
    text: "An assignment can create a reusable connection without a consumer view; a later assignment can discover and reuse it for two consumers without duplicate connection setup."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-35
    text: "Connections remain plugins with explicit exports and declared required local plugin dependencies; a consumer can reuse connection functions without duplicating credentials in its code, fixtures or view metadata."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-36
    text: "Successful activation of an assignment's checked targets notifies the originating chat of actual availability without resuming its prior request; pending checks, failed activation and missing access are not reported as ready."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-37
    text: "On a supported desktop platform, a connection can execute local programs or scripts through a general process host without a service-specific core API. Required programs, OS permissions and account access remain explicit prerequisites; process availability alone does not establish usable integration access."
    milestone: Workspace-wide development with reusable connections
    status: implemented
---

## Description

Users must be able to describe in natural language which existing program or service they want to connect to Situate and for what purpose. Situate must be able to create a suitable integration without requiring users to write code. Extensions must not be limited to a fixed integration catalog.

Desktop connections may use the general local process host to implement service access through command-line tools or scripts. Service-specific convenience APIs may be added without making the core responsible for every service interface. A command starts in the workspace but is not confined to it. Commands execute directly without a per-command confirmation, including requests from standalone views and exports. Platform-specific access requirements and task scope still apply; external effects execute without per-action approval.

This requires technically usable access and the necessary permissions. Situate must identify unsupported functionality rather than promise its availability. Creating an integration does not authorize unrelated actions; [user decision authority](../goals/GOAL-0004-decision-authority.md) remains intact.

Outside [recovery startup](REQ-0032-manage-plugin-status-and-disabling.md), within an explicit user request, Situate may activate and execute a newly generated integration or modify and execute an existing local plugin without a separate code-activation confirmation. These changes remain versioned and recoverable. This does not authorize unrelated modifications.

Reusable integrations own external connections and accounts independently of individual workflow plugins, within their workspace. Plugins, accounts and dependency resolution are workspace-scoped under [REQ-0037](REQ-0037-keep-workspaces-independent.md); another open workspace does not automatically supply dependencies or connections. Consumers reuse those connections and each selects the relevant accounts. Adding an account to an integration does not automatically add it to an existing consumer's selection.

The agent must find existing integrations and their declared consumers before creating or changing shared functionality. Within the requested development scope, it designs or extends reusable interfaces as needed and autonomously updates all affected plugins while preserving established behavior. The core does not prescribe domain contracts for inbox entries or mail. Plugins explicitly export reusable interfaces; workflow internals do not become public automatically. Plugins may define their own Vue components and explicitly export reusable components for consumers through declared dependencies. Component names are local by default; installing a plugin does not add its components to an automatic global pool. Reusable UI components do not introduce a core domain contract.

Plugins declare dependencies when they use another plugin's functionality or extend its interfaces. Dependencies may identify a concrete plugin or a shared provider interface implemented by interchangeable plugins, such as document sources. Declared plugin dependencies are initially required; optional dependencies are deferred until concrete use cases justify them. During installation, Situate presents the required plugins together and installs them after a combined user confirmation.

Affected plugins follow [staged change-set activation and recovery](REQ-0033-stage-and-activate-plugin-changes.md). Situate generates tests for the resulting plugin, including [UI tests](REQ-0026-provide-plugin-defined-views.md) where applicable. Generated plugins remain trusted code under the [foundations](../foundations.md); there is no technical sandbox guarantee.

### Plugin-owned skills and conversation modes

Each plugin keeps its skill files and supporting resources inside its own independently copyable source directory. The plugin's `plugin.json` declares its skill contributions and identifies whether each skill is available to normal chat, plugin development, or both. Mode assignment belongs to the manifest, not skill frontmatter. Copying the complete plugin source directory preserves these declarations and resources; required dependencies and account access remain separate prerequisites.

Users can develop plugins that guide plugin development without changing normal-chat behavior. Situate builds each mode's skill catalog from eligible, enabled plugin contributions for that mode. Skill names and descriptions support selection; complete instructions are loaded when needed rather than injecting all skill bodies into every request. Undeclared skill files remain inspectable source, not active contributions.

A skill supplements the mode's host-owned instructions without replacing them or granting tools, account access or task authority. Merely inspecting or editing a skill does not activate it as guidance for the developing agent. Updates follow staged activation. Recovery suppresses skills from temporarily suspended plugins in both modes, while preserving built-in inspection, source repair, previews, executable checks and checked activation. Individually resumed or successfully activated targets can contribute skills again; unrelated plugins remain suspended.

### Development conversations

Development is assignment-based within the same workspace and with the same tools and task-scope rules as ordinary chat. An assignment may create or adapt several connections, workflow plugins, views and ordinary workspace files. Selecting an existing plugin supplies context, not an access boundary; no package or type selection is required to start. The agent discovers existing connections and declared consumers, reuses suitable functionality and can include newly identified affected packages without a new conversation or a confirmation solely to expand that set. Development instructions guide restrained changes, not unrelated edits or automatic child-conversation fan-out.

The first delivery followed [Plugin Launchpad](REQ-0033-stage-and-activate-plugin-changes.md#first-iteration-plugin-launchpad): separate development conversations operate on plugin drafts without complete workspace copies. Concurrent conversations, including work on the same plugin, are permitted without conflict-prevention gates; they may overwrite or interfere with one another.

An explicit request to create or modify a plugin, function or reusable workflow from a normal conversation opens a separate development conversation. Situate transfers the assignment and necessary context and starts work without requiring the user to repeat or resubmit it. The new conversation receives focus in an additional pane beside the originating chat where screen space permits, following the [responsive workspace layout](REQ-0026-provide-plugin-defined-views.md). Its development purpose is distinguished by its background and header label; messages, Activity, tools and content changes use the ordinary chat presentation.

Conversation type is fixed: the originating conversation does not become a development conversation, and the development conversation does not switch back to a normal one on completion. The originating chat stays usable throughout; development neither blocks it nor reserves its next action. Once the plugin has successfully activated, the originating chat receives a notice that it is available to chats in the same workspace. Activation does not automatically resume or execute any originating request. Development completion alone is not activation under [REQ-0033](REQ-0033-stage-and-activate-plugin-changes.md).

Remembering or correcting the person's working instructions remains in the normal conversation, with persistent changes visibly presented under [REQ-0040](REQ-0040-reveal-tool-details-and-content-changes.md). A request to develop a reusable workflow belongs in a development conversation even if its implementation consists only of Markdown. Routing depends on the user's intent, not file type or estimated change size. Merely discussing plugins does not start development.

Development conversations expose [assignment-wide source diffs](REQ-0017-inspect-plugin-instructions.md) and apply the same [tool-presentation rules](REQ-0040-reveal-tool-details-and-content-changes.md) as normal conversations.

## Rationale

Users employ different tools and providers for personal organization. A fixed integration catalog would restrict their choice and could force a switch. User-requested integrations connect existing systems without requiring programming knowledge.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: freely creatable integrations for existing programs; users describing their tools and Situate creating integrations, with different email providers as examples. Integration capability and the specified email functions were confirmed as must-have requirements.

Private architecture strategy clarification, 2026-09-29; transcript not included. Direct activation and modification within user requests, explicit plugin and provider-interface dependencies, combined dependency installation approval and generated tests were confirmed. Optional dependencies were deferred.

Private plugin architecture clarification, 2026-09-29; not publicly available. Reusable connections, consumer-specific account selections, plugin-defined exports and agent-led updates of affected consumers were confirmed.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Connections, plugins and automatic dependency resolution were scoped per workspace.

Private UI and recovery requirements clarification; date not recorded, not publicly available. Local component names, explicit reusable component exports and suppression of activation during recovery were confirmed.

Private chat-design clarification conversation; date not recorded, transcript not included. Separate, fixed-purpose development conversations, immediate contextual handoff, focused pane opening, an unblocked originating chat, notification without automatic continuation, and in-place working-instruction corrections were confirmed.

Private workspace-development and interface clarification; date not recorded, not publicly available. Assignment-based same-workspace access, reusable connections, multi-package work, Changes-only source inspection and shared chat presentation were selected. Earlier copy-based development boundaries no longer govern this workflow. Recovery retains selective resumption, ordinary previews and executable checks, and checked activation of developed targets while unrelated installed plugins remain suspended.

## Open questions

- Which representative programs and interfaces should demonstrate integration capability during acceptance testing?
- How is configured account access represented across tool and plugin dependencies?
- How are external interface changes, repairs and ongoing integration maintenance handled?
