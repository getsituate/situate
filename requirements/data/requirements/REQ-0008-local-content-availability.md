---
id: REQ-0008
type: requirement
title: Keep stored content locally readable and manually editable
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001]
---

## Description

All user content stored in Situate must be available locally. Users must be able to read and manually edit locally stored content without internet access, AI functionality or an available Situate service. Manual edits must be saved locally and retained for later synchronization if configured for the workspace. Synchronization runs only while that workspace is open; choosing no synchronization does not restrict local use. This does not require offline AI processing or access to external services.

This requirement concerns stored content, not complete local copies of all connected external sources. A reference to an external source does not therefore require all of that source's content to be present locally. Deleting a note from the current collection preserves its [version history](REQ-0022-explain-note-changes.md). [Explicit history deletion](REQ-0007-history-storage-control.md) is a separate, optional capability.

Opening a workspace must make existing local content immediately usable without waiting for background synchronization. Visible [synchronization state](REQ-0013-synchronization-service.md) indicates that remote changes may be pending. This does not make content available before it has arrived through initial synchronization.

The initial scope keeps the complete current collection and its full version history, including previous attachments, on every synchronized device. Notes and tasks remain fully local in the longer-term direction as well.

Selective download of documents and attachments is a later stretch goal, not part of the initial scope. That direction includes visible placeholders, download on user or agent access, explicit offline pinning of files and folders, and eventual cache eviction based on storage use or last access. No cache limits or eviction policy have been selected.

## Rationale

Trust in a personal organizational system requires users not to depend solely on a Situate service operating in order to access stored content. Local availability complements [reuse without Situate](REQ-0009-reuse-stored-content.md).

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: trust through consistently available local data; clarification that the scope is stored content rather than complete copies of connected sources; confirmation of local availability and reuse as must-have requirements.

Private architecture-constraints clarification conversation; date not recorded, transcript not included. Manual editing without internet or AI functionality was confirmed as mandatory.

Private architecture strategy clarification, 2026-09-29; transcript not included. Full initial replication of current content and history was chosen; selective document download and cache management were deferred.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Synchronization is independently configured per workspace and stops while the workspace is closed.

Private synchronization clarification, 2026-09-30; not publicly available.

## Acceptance criteria

- After successful initial synchronization, the complete current collection and full version history, including earlier attachments, are present locally on each connected device.
- User content stored in Situate is present locally and can be viewed when a Situate service is unavailable.
- Access to content already stored locally does not require a subsequent download from a Situate service or waiting for synchronization on workspace opening.
- Background synchronization and potentially pending remote changes are visible; content not yet received is not presented as locally available.
- Content only referenced externally and not stored in Situate is not presented as locally available.
- With internet access disabled and no AI functionality available, users can manually edit locally stored content and reopen the saved changes after restarting the application.
- Offline edits are retained for synchronization when connectivity returns and the workspace is open with synchronization configured; conflict handling must not depend on AI availability.

## Open questions

- How are insufficient disk space and incomplete synchronization communicated without silently dropping retained versions?
- When should selective document download and cache management be introduced?
- How is local availability ensured during cross-device changes and connection interruptions?
