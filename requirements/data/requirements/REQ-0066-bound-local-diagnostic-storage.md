---
id: REQ-0066
type: requirement
title: Bound device-local diagnostic log storage
status: approved
priority: must
area: Diagnostics
goals: [GOAL-0006]
---

## Description

Situate must retain diagnostic events in device-local structured files with automatic rotation and an initial total storage limit of 256 MiB (268,435,456 bytes) per installation. The budget covers all local diagnostic log files, including active and rotated files from every workspace, application component and plugin. Opening additional workspaces or installing additional plugins must not multiply that budget.

Rotation removes older log data to make room for newer activity. It must operate during long-running application sessions, not only after restart. Bounded storage does not promise a fixed time span of retained activity; the available lookback depends on event volume.

Diagnostic logs must remain outside workspace synchronization and content version history. They are installation-local diagnostic records, not portable workspace content under [workspace storage and history](../foundations.md#workspace-storage-and-history). The concrete location, file format and rotation parameters remain undecided.

Logging must run asynchronously without making application work wait for diagnostic storage or delivery. Storage failure, an unavailable destination or overload must not interrupt content operations, navigation or application shutdown. Diagnostic events may be discarded when necessary to keep application work independent; logging is not a lossless audit trail. This does not imply zero CPU, memory or I/O overhead, whose acceptable bounds remain to be established.

Local logs have no additional application-level encryption. This does not waive the diagnostic data limits or imply that operating-system access controls provide complete confidentiality.

The [initial delivery](../foundations.md#initial-diagnostic-logging-delivery) requires local files usable with developer tools, not an in-application viewer or a user-facing control for changing log levels while the application is running.

## Rationale

Detailed local records preserve preceding activity for diagnosis while a shared installation budget prevents diagnostic storage from growing with time, workspace count or plugin count.

## Source

Private client-logging requirements clarification; date not recorded, transcript not publicly available. Detailed local logging, automatic file rotation and one installation-wide storage budget were agreed as must-have capabilities. Logs were excluded from synchronization and version history; the exact storage location was left open.

Private client-logging architecture clarification; date not recorded, transcript not publicly available. Asynchronous logging without interruption of application work and the absence of additional log encryption were confirmed. A subsequent capacity review selected 256 MiB as the initial installation-wide limit, based on estimated event size and volume rather than measured usage or a guaranteed retention period.

## Acceptance criteria

- Continued logging rotates files and removes older data to keep total diagnostic file storage, including active and rotated files, at or below 256 MiB per installation.
- Active and rotated logs from multiple workspaces and plugins count toward the same budget.
- Creating more workspaces or adding plugins does not create additional independent log-storage allowances.
- Rotation and cleanup occur during continuous operation without requiring application restart.
- Workspace synchronization does not transfer diagnostic logs, and workspace version history does not retain them.
- Removing old diagnostic logs leaves process history and content version history intact.
- With diagnostic storage stalled or failing, content operations and navigation continue without waiting for it; logging does not become an indefinite shutdown prerequisite.
- When diagnostic capacity is exhausted, the client can discard events rather than interrupt application work or grow diagnostic buffers without bound.

## Open questions

- What rotation parameters should be used, and how is the 256 MiB budget enforced during active writes and rotation?
- Which device-local location and structured file format should be used on each supported platform?
- How should logging resume and indicate lost events after storage failure or overload, without interrupting application work?
- How should oversized entries and high-frequency repeated events be handled, and how should any omitted data be indicated?
- What memory, processing and I/O overhead is acceptable during normal use and high event volume?
