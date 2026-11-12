---
id: REQ-0032
type: requirement
title: Review plugin status and disable plugins without deleting them
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001, GOAL-0004]
acceptanceCriteria:
  - id: AC-01
    text: "A central overview lists all installed plugins in the current workspace with their current status, including disabled plugins."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-02
    text: "Plugins is an independent workspace navigation destination outside Settings, with entry points for new development and further development of an existing plugin. It marks Plugins as active and provides direct sidebar reopening after collapse, including in file inspection and narrow layouts. A Settings shortcut may open Plugins without establishing a parent/back hierarchy."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-03
    text: "An enabled plugin can supply its own settings page using the same view contracts and components as other plugin views."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-04
    text: "A disabled plugin's settings page cannot be opened for execution, and its code is not loaded on subsequent workspace opening; code, configuration and data remain retained."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-05
    text: "While the application responds, disabling removes the affected view registrations and unmounts their instances. Neither this cleanup nor “Abort now” is presented as forcible termination of synchronous host-view code."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-06
    text: "Disabling a plugin in one workspace does not disable a plugin in another workspace."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-07
    text: "Before the user confirms disabling a plugin, the affected dependent plugins are shown."
    status: open
  - id: AC-08
    text: "After confirmation, the selected plugin and affected dependents immediately stop starting new actions through schedules, events, shortcuts or tool invocation; already-running actions normally finish."
    status: open
  - id: AC-09
    text: "Users can choose “Abort now” for running work and are told that external effects already triggered are not undone."
    status: open
  - id: AC-10
    text: "Re-enabling a dependency leaves affected dependents blocked until the user explicitly re-enables them."
    status: open
  - id: AC-11
    text: "Disabling retains plugin code, configuration and data rather than uninstalling or clearing them."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-12
    text: "A user can re-enable a disabled plugin without reconstructing its retained configuration or data."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-13
    text: "An already open chat cannot invoke a blocked plugin merely because its tools were offered earlier."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-14
    text: "After plugin code freezes an application run, the user can start in recovery without first interacting with that frozen application's settings."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-15
    text: "With multiple workspaces remembered for startup, recovery suppresses every plugin before loading or executing any of them in any restored workspace; initializers, views, tools and triggers do not run."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-16
    text: "Opening another workspace or restoring pane history keeps installed plugins temporarily suspended until individually resumed or resume-all is chosen; requested development may preview, test and activate its target through the ordinary workflow."
    status: open
  - id: AC-17
    text: "An unclean run offers a built-in startup choice before plugin imports without declaring an unverified culprit."
    status: open
  - id: AC-18
    text: "Entering recovery preserves plugin code, configuration and data until the user requests changes."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-19
    text: "Built-in management and the agent remain usable without plugin tools to disable, remove or repair a plugin."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-20
    text: "After recovery startup, requested development supports ordinary source edits, previews, executable checks and checked activation. Activation resumes its target without resuming unrelated suspended plugins or replaying interrupted work."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-21
    text: "Users can resume individual temporarily suspended plugins or resume all without restarting. Resume-all preserves permanently disabled plugins. Recovery ends when no temporary suspensions remain; neither resumption nor activation replays interrupted requests."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-22
    text: "Recovery is not presented as runtime isolation, automatic rollback or protection against prior damage."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-23
    text: "Plugin management uses the established Settings card-grid design with names, status, descriptions and applicable actions, rather than a separate simplified plugin list. Users can inspect instructions, open available settings, enable or disable a plugin and start new or further development."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-24
    text: "Reusable connections appear in workspace plugin management with independent development entry points, whether or not they provide a consumer view."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-25
    text: "Connection status distinguishes installed or checked code from usable permission/account access, missing implementation, unsupported platform and failed operations."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-26
    text: "Connection management identifies its declared consumers and shows all affected direct and indirect dependents before disabling; re-enabling the connection does not silently re-enable those dependents."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-27
    text: "Starting new development accepts an assignment without selecting a package type; further development of a selected connection or plugin supplies context without restricting workspace access."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-28
    text: "After recovery startup, multi-package development retains ordinary previews, executable checks and checked activation. Activation resumes only checked developed targets; unrelated installed plugins remain suspended."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-29
    text: "Each plugin directory contains its code, configuration, data, retained runtime metadata, development drafts and plugin-specific histories; no separate persistent registry can establish an installation after that directory is absent."
    status: in-progress
  - id: AC-30
    text: "Confirmed uninstallation removes the complete plugin directory from the current workspace while retaining ordinary notes, tasks, documents and conversations outside it."
    status: in-progress
  - id: AC-31
    text: "External deletion of a plugin directory is detected while the workspace is open and on reopening; its card, tools, views, settings and obsolete navigation state disappear without recreating the directory."
    status: in-progress
  - id: AC-32
    text: "Uninstallation is blocked by installed direct or indirect dependents, including disabled dependents; it never silently removes dependent plugins."
    status: in-progress
  - id: AC-33
    text: "Uninstallation is blocked while affected actions are running, and admission checks prevent new affected work from racing with removal without promising reversal of external effects."
    status: in-progress
  - id: AC-34
    text: "Late writes and stale activation cannot recreate a deleted installation; a new installation with the same plugin ID does not inherit the deleted installation's retained state or execution authority."
    status: in-progress
  - id: AC-35
    text: "Built-in uninstallation works without loading the target plugin, including during recovery; uncertain or partial removal is not presented as a known failure with a safe automatic retry."
    status: in-progress
---

## Description

### First iteration: Plugin Launchpad

Plugin Launchpad uses the established local plugin-management card-grid design, with its card-based collection, status, descriptions, instruction inspection, settings and development actions. It does not introduce a separate reduced plugin list. The design reference is `client/workshop/src/plugins/README.md` and its associated workshop views. Applicable management acceptance criteria below belong to this delivery; adopting the design does not schedule deferred inter-plugin dependencies, shared-account coordination, marketplace features or development-workspace storage management. Controls and explanations must reflect the draft-based workflow rather than promise complete workspace copies.

Failed development remains accessible through its development conversation, not a separate development-state dashboard. Users can request further work there. A plugin-free startup retains access to built-in management and the agent when faulty code prevents normal use; it does not automatically repair or reactivate plugins.

### Reusable connections

Connections remain plugins in the same workspace runtime, not a second extension engine. Management identifies each connection’s declared consumers, current code status and actual access readiness. Installed or checked code alone does not establish usable account access or OS permission. Missing implementation, unsupported platform, missing permission/account access and failed operations are distinct conditions. Connections can be developed independently without supplying a consumer view; selecting one for further development gives assignment context rather than a single-plugin access limit.

### Uninstallation and directory ownership

The plugin directory is the authority for its installation and contains all plugin-owned code, settings, data, runtime metadata, development drafts and plugin-specific histories. A directory containing only unactivated development work does not by itself grant execution or establish an installed package. An absent directory never becomes an installed entry through retained metadata elsewhere.

Uninstallation removes this entire directory after confirmation. Plugins that need state to be removed with them must retain it inside their own directory. Ordinary user content outside it remains intact; uninstalling does not rewrite conversations, erase general workspace history, revoke an external account or undo effects already triggered.

Installed direct and indirect dependents, including disabled ones, block uninstallation. Running actions also block it rather than being aborted. These safeguards apply to the built-in removal operation; external filesystem deletion cannot be prevented by a confirmation dialog. The client must reconcile external deletion while open and on reopening, remove obsolete tools and views, and discard plugin-owned presentation and navigation state. Remaining consumers can report a missing dependency without recreating the removed provider.

Late storage writes and stale activation must not recreate a removed installation. A subsequently created installation with the same ID starts independently of the removed one's state and execution handles. Existing malformed or unreadable directories remain errors rather than being treated as confirmed absence. A partial or uncertain removal requires inspection of actual state, not a blind retry.

### Plugin management and recovery

Situate must provide a central overview of all installed plugins and their status within the current workspace. Plugin configuration and disabling are independent of other workspaces under [REQ-0037](REQ-0037-keep-workspaces-independent.md). Users must be able to disable a plugin without deleting its code, configuration or data and later re-enable it.

This overview is the independent Plugins destination and covers both locally developed plugins and adopted local copies. Plugins and Settings use the same host navigation and embedding patterns outside the retained workspace pane arrangement. Entering Plugins does not select Settings or introduce an All Settings backlink; sidebar collapse and reopening remain available within Plugins. It is distinct from the [marketplace](REQ-0019-share-plugins-through-marketplace.md). Users can start a new [development conversation](REQ-0033-stage-and-activate-plugin-changes.md) or request further development of an existing plugin from here. Plugins can provide their own [settings pages](REQ-0026-provide-plugin-defined-views.md) for the configuration needed to use them, following the same shared-component and view contracts as other plugin surfaces. A plugin without configuration needs does not require a settings page.

Disabling prevents new actions through the plugin's schedules, event and shortcut triggers, and tools. Before confirmation, Situate must show the plugins that depend on it through [declared dependencies](REQ-0001-create-integrations.md), including indirect dependents that would be affected. After confirmation, use of those plugins is blocked as well. A disabled plugin must not remain callable through an existing chat tool list. After confirmation, disabling immediately blocks new actions while normally allowing already-running actions to finish. Users can instead choose “Abort now” to stop running work; Situate must make clear that external effects already triggered are not undone. These choices also apply to affected dependents. Re-enabling a dependency never automatically restores use of its blocked dependents; each requires explicit user re-enabling.

Disabled plugin code is retained but not newly loaded or executed, including its settings page. While the host is responsive, disabling removes view registrations and unmounts their instances; plugin code must release its view-owned resources. Existing supervised actions retain the completion or explicit-abort behavior above. Host-executed views cannot be forcibly interrupted inside the running UI; if one freezes the application, forced termination and recovery startup replace the unavailable in-app controls. Removing a view registration or requesting cleanup is not proof of stopped JavaScript. The built-in overview and file inspection do not depend on executing disabled plugins. A disabled plugin can still be inspected, developed and checked under [REQ-0033](REQ-0033-stage-and-activate-plugin-changes.md), without a mandatory workspace copy. Inspection or source editing alone does not enable its installed version; checked activation may do so.

Users must be able to start Situate with all installed plugins temporarily suspended across restored workspaces, before any plugin imports, initializers, views, tools or triggers execute. Additional workspaces opened while recovery remains active also start with their plugins suspended. This temporary state does not change persisted enabled/disabled preferences. Recovery entry must remain reachable after a frozen run, independently of Settings inside the running application.

Recovery retains code, configuration and data. An application-wide notice communicates temporary suspension and offers management and resume-all. Management retains its card grid, source inspection and development entry points. Users can resume one plugin for investigation, or resume all previously enabled plugins and leave recovery without restarting. Permanently disabled plugins remain disabled when resuming all; disabling a suspended plugin persists that choice. Restored plugin tabs show built-in placeholders with resume, management and file-inspection actions rather than loading suspended code. The notice reflects remaining suspensions and disappears when none remain.

The development conversation and its workflow do not change after recovery startup: user-requested work can run previews and executable checks and activate successfully checked code under [REQ-0001](REQ-0001-create-integrations.md). Activation resumes only its target; unrelated plugins stay suspended. Inspection or source editing alone does not resume an installation. Interrupted conversations still await a new instruction, and neither resume nor activation replays failed requests. Resuming or testing faulty code may freeze the application again; explain this near the actions without requiring an extra confirmation dialog.

Plugins remain trusted code. Ordinary Vue views may run in the host UI under the [foundations](../foundations.md#plugin-trust-and-synchronization-ownership), accepting application freezes, forced restart and possible loss of unsaved state; service and chat-tool supervision remains unchanged. Recovery is neither a sandbox nor a rollback and cannot guarantee protection against damage caused before recovery. Evidence of an unclean previous run must offer a built-in startup dialog before plugin execution, allowing startup with all plugins suppressed without attributing the interruption to a specific plugin. Platform detection and entry mechanisms require qualification; an accepted requirement is not implementation evidence.

## Rationale

Users need to understand and stop extensions without losing their personal setup. Showing dependencies before disabling helps them judge the impact on other workflows. A plugin that freezes the application can make ordinary controls unreachable; startup recovery must make repair possible without executing that plugin again.

## Source

Private plugin removal and directory-ownership clarification; not publicly available. Complete plugin-directory removal, folder-local metadata and external-deletion reconciliation were confirmed; ordinary user content and general history remain retained.

Private first-iteration management clarification; date not recorded, not publicly available. The established plugin-management design and applicable acceptance criteria were selected instead of a separate simplified list. Development conversations remain the continuation path after failure; plugin-free startup remains available without a dedicated repair workflow or development-state dashboard.

Private plugin architecture clarification, 2026-09-29; not publicly available. A central status overview, reversible disabling and pausing of dependent plugins after showing them for confirmation were confirmed.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Plugins and configuration were scoped independently per workspace.

Private agent lifecycle clarification; date not recorded, not publicly available. Immediate blocking of new actions, completion or explicit abort of running work, and explicit dependent reactivation were confirmed.

Private UI and recovery requirements clarification; date not recorded, not publicly available. Application-wide plugin-disabled startup, pre-load suppression, built-in repair access and the trusted-runtime limitations were confirmed. Platform-specific startup entry remains open.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. Local management in Settings, plugin-owned settings views, new and existing development entry points and no execution of disabled settings pages were confirmed. Local management precedes marketplace delivery.

Private plugin execution clarification, 2026-10-16; not publicly available. Host-executed views were accepted with forced-restart risk.

Private recovery interaction clarification; date not recorded, not publicly available. Temporary startup suspension, individual resume, resume-all without restart and unchanged development checks and activation were selected. Resuming faulty code accepts renewed freeze risk; permanent disabling remains distinct.

Private workspace-development management clarification; date not recorded, not publicly available. Independent connection development, consumer relationships and actual readiness were selected. Recovery retains ordinary development checks and checked activation while unrelated installed plugins remain suspended.

## Open questions

- Which additional operational states and failure details belong in the overview?
- How do users enter recovery on desktop and mobile when the previous application run cannot respond?
- How is the explicit return to normal plugin execution presented on each platform?
