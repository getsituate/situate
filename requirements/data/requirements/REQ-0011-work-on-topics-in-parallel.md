---
id: REQ-0011
type: requirement
title: Work on topics in parallel and preserve work state
status: approved
priority: must
area: Productivity
goals: [GOAL-0002]
---

## Description

Situate must let users work on different topics side by side and switch between them. Each topic's context and work state must be preserved. Users must be able to recognize the processing state of individual topics.

The conversation list includes ordinary chats and plugin-development chats. Each working conversation has a visible activity indicator there, even when its chat view is closed or another view is selected. Closing a chat view or pane does not stop the agent or discard its state. Execution remains bound to the open workspace and running application, not to visibility of the conversation. Application quit stops all agent work, including development conversations and their checks; nothing continues after exit.

This complements [parallel request processing](REQ-0010-process-requests-in-parallel.md). Users organize topic-specific working surfaces in tabs that they can name and rename. Each tab belongs to exactly one workspace and contains its own arrangement of one or more panes under [REQ-0026](REQ-0026-provide-plugin-defined-views.md). Tabs group panes, not views within a pane. A tab is a presentation arrangement, not a separate content store or execution context.

Switching tabs preserves each tab's pane arrangement, active pane and pane navigation histories, together with the retained work state. Hiding a tab does not stop its workspace's agent or plugin work. On phones, users can switch topics through tabs and switch between panes within the active tab, normally viewing one pane at a time.

Selecting a conversation in the main navigation reveals an already open instance in the workspace presentation: Situate selects its tab and focuses its pane rather than opening another instance. A conversation is open when it is a pane's current target, including in an inactive tab or a temporarily hidden pane; a historical entry alone is not an open instance. If no instance is open, the conversation opens in the focused pane. Back and forward are different: they always restore their target in the addressed pane and may therefore display the same conversation in multiple panes or tabs. On the same device, those views share conversation content, draft, local model selection and execution, not a second agent run. Activity remains associated with tabs that opened the conversation until those tabs close; the conversation list remains the complete activity overview.

Tab names are optional. An unnamed tab uses its first pane's current view title, or the localized new-tab label when empty. Closing the last pane leaves an empty view chooser in that tab. Closing the last tab or all tabs opens one fresh empty tab with a focused pane and the normal view chooser. Opening a view or conversation fills that pane. Users can reopen a closed tab with its arrangement and histories. Closing or reopening a tab neither deletes content nor stops or restarts workspace work.

Situate stores the workspace's tab and pane presentation in its `.situate` directory and restores it from there. Stored state includes tab identities, names and order, split arrangements and sizes, active tab and pane, pane navigation histories, pinned views and supported view presentation state. File targets and revisions, reading/source mode, selection, cursor and scroll position, and chat scroll position are retained; drafts remain owned by their content modules. Layout and conversation content belong to the portable, synchronizable workspace, not a device-only preference store. Operational AI settings, including conversation-specific model selections for future requests, are the device-local exception under [REQ-0015](REQ-0015-connect-user-provided-models.md). After workspace synchronization, another device can restore the same open tabs and conversations using its own responsive presentation and independently configured AI access. This does not require live mirroring of an in-flight agent run or change the completed-turn continuation boundary below.

Agent execution is tied to an open workspace in a running application, not an always-running server agent. Desktop background work can continue while the workspace remains open. Switching active workspaces on mobile leaves the previous workspace open and permits its work to continue subject to operating-system limits; it is not explicit closure. Switching mobile applications should allow work to continue where the operating system permits it; operating-system suspension may pause a longer agent run. On returning to the application, such paused work resumes from its saved state without repeating actions recorded as completed. Mobile suspension or forced termination does not guarantee graceful closure.

When an interruption leaves an external action's outcome uncertain, handling that uncertainty is delegated to the native agent runtime and the model's judgment. Situate adds no dedicated recovery or automatic outcome-checking protocol. Resolution depends on agent and model judgment and is not guaranteed. Normal [process-history recording](REQ-0005-record-process-history.md) and [task scope and user control](../goals/GOAL-0004-decision-authority.md) still apply.

Explicit workspace closure, including last-window closure or application quit, offers “Cancel” or “Abort now and close” for active actions under [REQ-0037](REQ-0037-keep-workspaces-independent.md). New starts are blocked while the closure decision is pending. Cancellation discards the closure request and restores normal operation without interrupting running work or scheduling later closure. If closure proceeds, separate pending-synchronization choices remain applicable. Aborting does not undo already-triggered external effects. Closing only one workspace leaves other open workspaces unaffected under [REQ-0037](REQ-0037-keep-workspaces-independent.md). Startup automatically reopens the last-open workspaces under [REQ-0037](REQ-0037-keep-workspaces-independent.md); application quit does not clear that remembered set, while individual workspace closure removes that workspace. Whether automatic or manual, reopening shows the saved intermediate state of interrupted conversations and waits for another user interaction before continuing those conversations. This does not prohibit new configured [scheduled or event-triggered runs](REQ-0031-run-plugins-independently-of-views.md) after reopening; missed triggers follow the plugin's catch-up or skip policy. Cross-device continuation is required at completed conversational turns, where Situate is waiting for input; live progress mirroring, simultaneous processing of the same conversation on multiple devices and migration of an in-flight agent run are not required.

## Rationale

Users should be able to continue working on one topic while another is being processed and return to an earlier topic without reconstructing its context. Parallel work should not result in lost input or unclear work state.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: making parallel work on different topics easier; confirmation of side-by-side work and switching topics with separate context and work state; explicit classification of both parallelism requirements as must-have requirements.

Private architecture strategy clarification, 2026-09-29; transcript not included. Application-bound execution, mobile suspension, explicit-quit behavior and cross-device continuation at completed turns were confirmed.

Private plugin architecture clarification, 2026-09-29; not publicly available. Waiting for interaction after explicit quit applies to interrupted conversations, not to new configured plugin runs after reopening.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Execution and interrupted-conversation behavior were scoped to each open workspace, including last-window closure.

Private agent lifecycle clarification; date not recorded, not publicly available. Explicit close choices and delegation of uncertain external outcomes to the coding agent and model judgment were confirmed, without a Situate-specific recovery protocol or a reliability claim for Pi.

Private mobile lifecycle and startup clarification; date not recorded, not publicly available. Mobile workspace switching is not closure, and automatic reopening does not automatically resume interrupted conversations.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. The conversation list is the activity overview for normal and development chats. Closing a chat view does not stop work; application and workspace closure retain their existing stop boundaries.

Private UI architecture clarification; date not recorded, not publicly available. Named topic tabs containing pane layouts and independent pane navigation histories were confirmed.

Private multi-device AI configuration clarification; date not recorded, not publicly available. Cross-device conversation continuation uses the destination's local access and model selection without transferring operational AI settings.

## Acceptance criteria

- Users can keep different topics accessible side by side and work on them without first completing one.
- After switching from one topic to another and back, the previous context and work state remain available.
- Users can work on one topic while Situate handles a user request for another.
- Processing state and results can be associated with their respective topics without rereading their entire history.
- Ordinary and development chats appear in the conversation list with a working indicator while their agents are active, regardless of whether their views are open.
- Closing a chat pane or view, or switching views, leaves its work running within the open workspace; application quit stops all such work, including development conversations and their checks.

- Users can create multiple tabs within a workspace and name or rename each tab to identify its topic.
- Each tab can contain multiple panes with its own arrangement; every tab belongs to exactly one workspace.
- Switching to another tab and back preserves the pane arrangement, active pane, pane navigation histories and retained work state without stopping running agent or plugin work.
- On a phone, users can switch tabs and access the panes of the selected tab without requiring simultaneous desktop-sized tiling.
- Selecting an already open conversation in the main navigation activates its existing tab and pane without adding a pane or navigation entry. A conversation found only in history opens normally in the focused pane.
- Back or forward to an already open conversation restores it locally without jumping to another pane or tab; both views share one conversation and execution.
- Clearing a tab's name restores automatic naming without changing its identity.
- Closing the last pane leaves a chooser. Closing the last tab or all tabs opens exactly one fresh empty tab; subsequent view navigation fills its existing pane.
- Reopening a closed tab restores its layout and histories without recreating conversations or restarting work.
- Reopening a workspace restores tabs, open targets, arrangements, active selection, histories, pinned views and supported presentation state from its `.situate` directory, including after transferring that state through workspace synchronization.

- After operating-system suspension, an agent run can resume on the same device from its saved state without repeating actions recorded as completed; graceful closure is not guaranteed.
- Uncertain external outcomes after interruptions are left to the chosen coding agent and model judgment, without an additional Situate-specific recovery or automatic checking protocol; history and task-scope obligations remain in force.
- Mobile workspace switching leaves the previous workspace open; its work may continue where the operating system permits it.
- After last-window closure of a workspace or explicit application exit, manual or automatic reopening presents the retained state and does not resume an interrupted conversation until the user interacts with it.
- New configured plugin runs can start after reopening without resuming an interrupted conversation; missed triggers follow the plugin's policy.
- After synchronization of a completed turn, the user can continue the conversation on another device using its locally selected AI access and model. Synchronized content carries no per-message provider/model attribution and does not overwrite that selection.
- A device without usable local AI access can read synchronized conversations and retain drafts, but submission remains blocked until access is set up and selected; there is no silent provider or managed-service fallback.

## Open questions

- How are active and other open workspaces, and explicit closure, presented on mobile under [REQ-0037](REQ-0037-keep-workspaces-independent.md)?
- Can tabs move between windows of the same workspace, and how are concurrent presentations of that workspace assigned to windows?
- How are concurrent layout edits from different devices reconciled by workspace synchronization?
- What processing-state information do users need to keep an overview of multiple topics?
- Which additional topic-state indicators are needed alongside the responsive panes and view switching in [REQ-0026](REQ-0026-provide-plugin-defined-views.md)?
