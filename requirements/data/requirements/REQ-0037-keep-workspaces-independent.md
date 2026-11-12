---
id: REQ-0037
type: requirement
title: Keep workspaces independent and bind work to open workspaces
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001, GOAL-0004]
---

## Description

A workspace is a self-contained personal organizational system containing files, tasks, notes, documents, chats, plugins and configuration. Its AI connections and model selections are scoped additionally to the device under [REQ-0015](REQ-0015-connect-user-provided-models.md), retained outside the portable directory and not synchronized. They are not a shared application-wide provider setting. Account-level [managed AI entitlement](REQ-0016-managed-ai-access.md) does not merge workspace configuration, access choices or runtime authorization. Situate must not automatically search, depend on or use content from another workspace. Workspace separation is not a malicious-plugin sandbox: an explicitly developed plugin may access another workspace where operating-system permissions allow it.

[Tutorial completion](../foundations.md#onboarding-and-contextual-learning) is user-wide rather than workspace-owned: it is shared across workspaces on the same device and, with synchronization, across devices. This exception does not permit automatic cross-workspace use of organizational content, account connections or model settings.

Users must be able to open multiple workspaces concurrently in separate windows. Work is bound to its open workspace. Closing its last window stops that workspace's work, plugins, automation and synchronization, without stopping other open workspaces. Closing only a plugin view or chat view does not close the workspace or stop its agent work. Development under [REQ-0033](REQ-0033-stage-and-activate-plugin-changes.md) uses the same workspace as ordinary chat, not a mandatory separate copy or implicit cross-workspace discovery. Its work stops when that workspace closes or the application quits; retaining candidate/check state for resumption does not authorize post-closure execution. On mobile, switching the active workspace leaves the previous workspace open; its work, plugins, automation and configured synchronization may continue subject to operating-system limits until explicit closure. Switching workspaces is not closure and does not guarantee background execution. No server continues workspace work after closure.

When the user explicitly closes a workspace with active actions, including by closing its last window or quitting the application, Situate offers “Cancel” or “Abort now and close.” New action starts are blocked while the closure decision is pending. “Cancel” cancels the closure request, leaves running work uninterrupted and restores normal operation, including new action starts; the workspace does not automatically close when that work finishes. “Abort now and close” aborts running work and proceeds with closure, subject to the separate pending-synchronization choice. Situate must explain that aborting does not undo external effects already triggered. Other open workspaces remain unaffected by closing this workspace.

Before closing the last window with unsynchronized changes, [REQ-0013](REQ-0013-synchronization-service.md) requires a warning and the choice to synchronize then close or close now while preserving local changes. Waiting for synchronization keeps the workspace open; choosing immediate closure stops synchronization. These pending-synchronization choices apply if closure proceeds and include any local changes retained after aborting work. Cancelling closure leaves the workspace's normal synchronization behavior unchanged. A local-only workspace has no full-synchronization prerequisite.

On application startup, Situate automatically reopens the workspaces that were last open. Individually closed workspaces are excluded from this remembered open set and are not reopened merely because they were used earlier. Quitting the application stops execution but does not clear the remembered open set; shutdown of open workspaces as part of quitting is not individual workspace closure for this purpose.

[Recovery startup](REQ-0032-manage-plugin-status-and-disabling.md) is an application-wide exception to normal plugin execution, not a change to workspace ownership or per-workspace configuration. Before any plugin loads or executes, recovery suppresses all plugins across all restored workspaces and any workspace subsequently opened in recovery. Restoring the remembered workspace set must not activate initializers, views, tools or triggers. Built-in management and the agent remain available without plugin tools. Temporary suspension is distinct from persistent disabling. Users may resume individual plugins within their workspace or resume all previously enabled plugins across open workspaces without restarting. Requested development keeps ordinary previews, tests and checked activation for its target; unrelated suspended plugins remain suspended.

On normal reopening outside recovery, Situate detects external changes and resumes synchronization if configured. Interrupted conversations wait for interaction under [REQ-0011](REQ-0011-work-on-topics-in-parallel.md); new runs follow the [missed-trigger policy](REQ-0031-run-plugins-independently-of-views.md). Operating-system suspension, forced termination and a synchronous host-plugin-view hang do not guarantee graceful closure or an opportunity to offer these choices. Workspace ownership is not process isolation: a host-executed plugin view can freeze UI used by other open workspaces, and a forced application restart stops them all. [Recovery startup](REQ-0032-manage-plugin-status-and-disabling.md) must restore built-in access without importing any plugins; the independent normal-closure guarantees do not promise otherwise. The mobile representation of an open workspace remains a design question.

## Rationale

Users need separate contexts whose content and connections do not leak into each other automatically, and an understandable way to stop one workspace without disrupting another.

## Source

Private content and workspace architecture clarification, 2026-09-29; not publicly available.

Private synchronization clarification, 2026-09-30; not publicly available.

Private agent lifecycle clarification; date not recorded, not publicly available. Explicit closure choices for running actions, preservation of separate synchronization choices and limits of graceful mobile closure were confirmed.

Private mobile lifecycle and startup clarification; date not recorded, not publicly available. Mobile switching retains open workspaces, and startup restores the remembered open set without automatically resuming interrupted conversations.

Private UI and recovery requirements clarification; date not recorded, not publicly available. Recovery suppression covers every restored workspace before plugin loading or execution without merging workspace configuration or data.

Private closure interaction clarification; date not recorded, not publicly available. Cancellation of closure and immediate abort-and-close were selected for active work; pending-synchronization choices remain separate.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. Chat-view closure is independent of workspace closure, including development conversations using retained temporary workspace copies.

Private multi-device AI configuration clarification; date not recorded, not publicly available. Device-local AI settings remain workspace-scoped; managed AI account entitlement does not select access for every workspace or device.

Private onboarding clarification, 2026-10-07; not publicly available. User-wide tutorial completion was selected as a narrow exception to workspace-local configuration, without broadening content access.

Private plugin execution clarification, 2026-10-16; not publicly available. Host-executed plugin views may require a forced application restart; workspace ownership does not guarantee UI-failure isolation.

## Acceptance criteria

- Two workspaces can retain different content, chats, plugins, configuration, accounts and model settings without automatically sharing them.
- On one device, configuring or selecting AI access for one workspace does not configure another. The same workspace can independently use different providers and models on different devices without synchronization replacing those choices.
- Managed AI account entitlement can make the service available without automatically selecting it in every workspace or changing another device's selected access.
- Search, context use and plugin dependency resolution in one workspace do not automatically draw from another workspace.
- Completed tutorial steps remain completed when switching workspaces on the same device; with synchronization, that completion also follows the user across devices without sharing workspace content or model settings.
- An explicitly developed cross-workspace plugin is not presented as prohibited by a technical sandbox when operating-system permissions permit access.
- Multiple workspaces can be open in separate windows at the same time.
- Closing one of several windows for the same workspace leaves it open; closing its last window stops its work, plugins, automation and synchronization.
- Switching the active workspace on mobile leaves the previous workspace open and does not itself stop its work or configured synchronization; continuation remains subject to operating-system limits.
- Startup automatically reopens the last-open workspaces, including after application quit, without reopening a workspace individually closed before quitting merely because it was used earlier.
- Outside recovery, automatic reopening detects external changes and follows configured synchronization and trigger policies, but interrupted conversations still await user interaction.
- Recovery startup restores the remembered workspaces without loading or executing any plugins in them; opening an additional workspace does not bypass suppression, and workspace data and configuration remain separate.
- Explicit closure with active actions offers “Cancel” and “Abort now and close”; new action starts are blocked while the closure decision is pending.
- “Cancel” leaves running actions uninterrupted, restores normal operation including new starts, and does not schedule automatic closure when work finishes.
- “Abort now and close” aborts running work and explains that already-triggered external effects are not undone.
- Pending-synchronization choices apply separately if closure proceeds, including to local changes retained after aborting work; cancellation instead preserves normal synchronization behavior.
- Suspension, forced termination and host-plugin-view hangs are not presented as guaranteeing graceful closure or completion of running actions. Workspace separation does not claim to contain a host UI freeze; recovery suppresses plugins across all restored workspaces.
- Before the last window closes with unsynchronized changes, the user can choose synchronization while the workspace remains open or immediate closure preserving local changes; offline operation, conflict or failure is not treated as completed synchronization.
- Another open workspace continues to operate when a different workspace closes or has synchronization paused by a merge conflict.
- Closing a plugin view or chat view alone does not stop otherwise configured workspace work.
- Closing a workspace stops its development conversations as well as ordinary work; retained candidate/check state does not authorize continued execution. Application quit stops all workspace and development work.
- Outside recovery, reopening detects intervening external edits, resumes configured synchronization and preserves the distinction between interrupted conversations awaiting interaction and new policy-controlled runs.

## Open questions

- How does the mobile interface distinguish the active workspace from other open workspaces and expose explicit closure?
- How are the synchronization warning and close choices presented across platforms?
