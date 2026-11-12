---
id: REQ-0031
type: requirement
title: Run configured plugins independently of open views
status: approved
priority: must
area: Integrations
goals: [GOAL-0001, GOAL-0002]
---

## Description

Plugins must be able to operate while their workspace is open in Situate without requiring their views to remain open. Closing the workspace's last window stops its plugins, automation and synchronization without affecting other open workspaces; closing a plugin view alone does not close the workspace. [REQ-0037](REQ-0037-keep-workspaces-independent.md) defines this lifecycle, including explicit closure choices that cancel closure and restore normal operation or abort running work before proceeding with closure. Execution must support triggers from intervals, scheduled times, internal events, available operating-system events and shortcuts. Platform limitations must be explicit under [REQ-0014](REQ-0014-plugin-platform-compatibility.md). This does not introduce an always-running server or promise execution while the application is stopped or suspended by the operating system.

Each plugin determines whether missed runs are caught up or skipped, whether work runs once across devices or on each device, and whether offline work waits, runs locally or tolerates possible duplicates. Running once across devices is the normal policy, not an exactly-once guarantee. The core must provide coordination capabilities for these policies without prescribing a lock protocol. Stored results synchronize under [REQ-0013](REQ-0013-synchronization-service.md).

When configured, a plugin can autonomously start agent work. The plugin chooses whether to present a chat or only a result. In either case, users must have access to the relevant [traceable process history](REQ-0005-record-process-history.md). Result-only presentation does not remove history recording or review. Triggered work remains within its configured task and account access, without per-action approval.

After workspace closure or explicit quit, previously interrupted conversations still wait for user interaction under [REQ-0011](REQ-0011-work-on-topics-in-parallel.md). New configured runs may start after reopening; missed triggers follow the plugin's policy rather than automatically resuming those conversations.

## Rationale

Recurring organizational work should not depend on keeping a view open or manually initiating every run. Explicit scheduling and coordination policies make delayed or offline behavior understandable across the user's devices.

## Source

Private plugin architecture clarification, 2026-09-29; not publicly available. View-independent execution, trigger types, plugin-owned run policies, core coordination, synchronized results and autonomous agent work with accessible history were confirmed. No exactly-once guarantee or always-running server was selected.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Runtime and synchronization were bound to open workspaces rather than merely a running application.

## Acceptance criteria

- Closing a plugin's view while its workspace remains open does not by itself prevent a configured trigger from starting work.
- Explicit last-window closure offers cancellation of closure or abort-and-close as specified in [REQ-0037](REQ-0037-keep-workspaces-independent.md); once closed, the workspace's plugin work and automation stop even if another workspace remains open. Other open workspaces continue operating.
- Plugins can start work by interval, scheduled time, internal event, supported operating-system event and shortcut; unavailable platform capabilities are identified rather than presented as working.
- After reopening, a plugin configured to skip missed triggers skips them; one configured to catch up can initiate its configured catch-up work without resuming an interrupted conversation.
- With connected devices able to coordinate, a plugin's normal once-across-devices policy avoids separate runs on each device; a per-device policy permits them.
- Under offline conditions, execution follows the plugin's declared wait, local-run and duplicate-tolerance policy rather than claiming guaranteed exactly-once execution.
- Stored results become available on another connected device after successful synchronization.
- A configured trigger can initiate agent work without a fresh user prompt; result-only presentation still provides access to the recorded information, actions and results.
- Triggered work remains within its configured task and account access, without per-action approval.

## Open questions

- How are time zones, clock changes and overlapping triggers handled?
- How are run policies and platform restrictions presented to users?
- What coordination mechanism supports once-across-devices work, including partitions and reconnection?
