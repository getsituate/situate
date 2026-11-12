---
id: REQ-0044
type: requirement
title: Select and remember workspaces through a reusable entry window
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001]
---

## Description

Situate must provide a reusable workspace entry window. When workspaces are known on the device, the window lists them on the left with their names and local storage locations. The right side offers actions to [create a workspace](REQ-0045-create-local-workspaces.md), [open an existing local workspace](REQ-0046-open-existing-local-workspaces.md), or make an existing synchronized workspace available on this device. When no workspaces are known, the list is hidden and the entry actions remain available.

Successfully created or opened local workspaces are remembered so users can open them again without selecting their directories. Selecting a workspace that is already open brings its existing window to the foreground. Users can remove an entry from the known-workspace list without deleting workspace files.

The entry window appears on startup when there are no last-open workspaces to restore and when all workspaces have been closed. Users can also invoke it while other workspaces are open. Startup restoration remains governed by [workspace lifecycle](REQ-0037-keep-workspaces-independent.md): the known-workspace list is not the remembered open set, and a workspace closed individually does not reopen automatically merely because it is listed.

The synchronization entry makes an existing synchronized workspace available on a device; it is distinct from enabling synchronization for a newly created local workspace. Authorization, encryption and initial synchronization follow [REQ-0013](REQ-0013-synchronization-service.md). The detailed setup interaction remains open.

## Rationale

Users need a consistent starting point both before creating their first workspace and when returning to an existing personal organizational system. Remembered locations avoid repeated directory selection without forcing previously closed workspaces to reopen.

## Source

Private workspace-entry and creation clarification conversation; date not recorded, not publicly available. The reusable entry window, known-workspace list, startup behavior and three entry actions were confirmed. Local opening was explicitly limited to existing Situate workspaces. Priority was confirmed as must-have.

## Acceptance criteria

- With known workspaces, the entry window lists their names and local storage locations on the left and the three entry actions on the right.
- With no known workspaces, the list is hidden and users can create a workspace, open an existing local workspace or enter synchronization setup.
- A successfully created or opened local workspace remains available in the list after restarting the application without requiring directory selection again.
- Selecting an already open workspace brings its existing window to the foreground.
- Removing a known-workspace entry does not delete its directory or files.
- Startup with no last-open workspaces displays the entry window; otherwise restoration follows REQ-0037 rather than opening every known workspace.
- Closing all workspaces exposes the entry window, and users can invoke the same window while a workspace remains open.
- The synchronization action is presented as making an existing synchronized workspace available on this device, not as creating a new independent workspace.

## Open questions

- What are the detailed steps for selecting a synchronized workspace, authorizing the device, choosing local storage and presenting initial synchronization?
- How should the entry window and local storage locations adapt to mobile platforms?
- How should removing an entry for a currently open workspace affect its listing on later use?
