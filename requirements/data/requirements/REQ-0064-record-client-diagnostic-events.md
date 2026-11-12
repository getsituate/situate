---
id: REQ-0064
type: requirement
title: Record structured client diagnostic events
status: approved
priority: must
area: Diagnostics
goals: [GOAL-0006]
---

## Description

Situate must record detailed client activity locally during normal operation, including interactions that precede failures, without requiring users to activate a diagnostic session. Application and plugin events use the [shared logging API](REQ-0065-provide-shared-logging-api.md) and respect the [diagnostic data limits](REQ-0067-limit-diagnostic-data.md).

The event coverage includes:

| Area                        | Recorded activity and technical context                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interaction                 | Clicks on controls, navigation and invoked keyboard commands, without text input or private control labels                                               |
| Operations                  | Start, completion, cancellation, errors, relevant intermediate state changes and duration; whether initiated by a user, an agent or a background process |
| Plugins                     | Loading, activation, execution and errors, with plugin identity and version                                                                              |
| Storage and synchronization | Operations, outcomes, conflicts and retries, without content or revealing file paths                                                                     |
| AI and external services    | Calls, duration, outcome and technical error codes, without prompts, responses, credentials or complete payloads                                         |
| Application                 | Startup, normal termination, version and platform, detected interruptions and unhandled errors                                                           |

Events must carry a timestamp, log level, category and origin. Related events must be identifiable as belonging to the same operation or causal sequence, including across application and plugin boundaries. Overlapping operations must remain distinguishable. The exact event schema and level names are not prescribed.

Events must carry a device identifier established once and retained locally across application launches, and a distinct session identifier. Workspace-related events must also carry the workspace's stable opaque identifier, randomly generated when the [workspace is created](REQ-0045-create-local-workspaces.md) and stored in its portable metadata. Synchronization preserves that identifier regardless of transport, so the same workspace can be correlated across devices without a user account or user identifier. Events without workspace context, including application startup before a workspace opens, omit the workspace identifier rather than invent one.

A [complete copy or restoration](REQ-0038-copy-portable-workspaces.md) retains the workspace identifier and is treated as another copy of the same workspace for diagnostic correlation. Deliberately making an independent workspace requires a new identifier; ordinary copying does not imply that intent. Workspace identifiers may synchronize, but log files, device identifiers and session identifiers remain device-local. These are pseudonymous technical identifiers, not a guarantee of anonymity; the [diagnostic data limits](REQ-0067-limit-diagnostic-data.md) still apply.

Retained files must be structured so developers can read and filter events with ordinary developer tools by time, level, category and related operation. An in-application viewer is outside the [initial logging scope](../foundations.md#initial-diagnostic-logging-delivery).

Technical logs do not replace the user-facing [process history](REQ-0005-record-process-history.md) or [content history](REQ-0022-explain-note-changes.md). Their retention follows the separate [local storage budget](REQ-0066-bound-local-diagnostic-storage.md).

## Rationale

A failure is easier to investigate when its preceding interactions and related technical operations can be reconstructed, rather than inferred from an isolated error or timestamp proximity.

## Source

Private client-logging requirements clarification; date not recorded, transcript not publicly available. The event coverage, detailed local recording, levels, categories, origin and operation correlation were agreed. The current scope was assigned must-have priority.

Private client-logging architecture clarification; date not recorded, transcript not publicly available. Separate user, persistent device and session identifiers were initially requested for technical correlation without personal content.

Private diagnostic workspace-identity clarification; date not recorded, transcript not publicly available. Workspace identity replaced user identity. Generation on workspace creation, transport-independent synchronization, retention through copies and restoration, and a new identity for a deliberately independent workspace were confirmed.

## Acceptance criteria

- During normal operation, a sequence of clicks, navigation and invoked keyboard commands is recorded without prior user activation of detailed logging.
- For a click that triggers a plugin operation and an external call, retained events allow a developer to connect the interaction, operation, call and observed outcome.
- When operations overlap, their events remain distinguishable by operation context rather than timestamp alone.
- Restarting the application creates a distinct session while preserving the established device identity; workspace-related records retain the workspace identifier without names or other personal content.
- Newly created independent workspaces receive distinct identifiers stored with their portable metadata.
- Synchronizing or transferring a workspace to another device preserves its workspace identifier while diagnostic events carry the destination device's own identifier.
- A complete copy or restoration retains the workspace identifier; deliberate creation of an independent workspace uses a new one rather than changing the original's identifier.
- Application events without workspace context carry device and session identifiers but no fabricated workspace identifier or user identifier.
- Retained operation records distinguish starts, successful completion, cancellation and errors, and identify user, agent or background initiation.
- Exercising each area in the coverage table produces the corresponding diagnostic events and technical context, subject to the diagnostic data limits.
- Developers can read and filter retained records by time, level, category and related operation using developer tools without an in-application log viewer.

## Open questions

- How should legacy document-provider workspaces without an identifier receive one when exclusive metadata publication is unavailable? The client diagnostics architecture concept defines the initial schema and the conservative native migration, corruption and device-data lifecycle behavior.
- Through which explicit operation should a copied workspace become independent, without treating every directory copy as that decision?
- Which events must survive a crash or forced termination, and what loss of recent events is acceptable?
- Which specific intermediate state changes are necessary for diagnosis without excessive repetition?
