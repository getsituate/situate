---
id: REQ-0042
type: requirement
title: Edit Markdown source and read rendered content
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001, GOAL-0004]
---

## Description

Situate must provide a built-in way to read and manually edit Markdown source and to read the same document in a rendered view. Users reach these capabilities through the [workspace file view](REQ-0023-browse-human-readable-note-structure.md), without requiring an assistant or a user-created plugin.

Other text files open in the same built-in explorer as source, with syntax highlighting where supported. Writable workspace text files use the existing source editor and automatic-saving safeguards. Markdown rendering and task parsing do not apply to non-Markdown text. All file formats use the same Git-anchored reference rules. Plugin source inspection uses the same reading representations but does not permit editing or activate plugin code.

Source editing and rendered reading remain available without internet or AI under [local availability](REQ-0008-local-content-availability.md). Users can switch between source and rendered reading without losing content or metadata. Viewing a document does not rewrite it. Unknown metadata and Markdown constructs are preserved rather than silently discarded when editing supported content.

Edits in the built-in document editors must automatically save to the underlying local file, without a manual Save button or a separate apply step. Automatic saving works offline. Pending writes and failures are distinguishable from successful saves; a failed write must not silently discard the edited text. When a chat message references the live file, pending editor writes must complete before processing that message against its content; a failed save must not silently substitute an older saved version. Local saving is distinct from synchronization.

Normal editing preserves file-reference continuity, task identities and metadata under [REQ-0035](REQ-0035-preserve-file-and-task-identity.md). System-managed task IDs remain visible in source and deliberately editable after the specified warning. Files require no embedded ID; an existing `situate-id` field is ordinary metadata without a special identity warning. Malformed metadata is surfaced rather than silently discarded under [REQ-0036](REQ-0036-convert-imported-notes-and-tasks.md). Manual changes participate in [content history](REQ-0022-explain-note-changes.md).

[Direct formatted editing](REQ-0043-edit-formatted-markdown.md) is a separate should-have capability. Source editing together with rendered reading provides the required baseline independently of its availability. The [initial file-editor delivery](../foundations.md#initial-file-editor-delivery) defers formatted editing and the file-to-chat action without removing their longer-term requirements.

### Rendering and metadata

The initial rendered view supports headings, paragraphs, emphasis, lists, checkboxes, quotations, links, images, fenced code blocks, tables and strikethrough. Checkboxes are read-only in this view; the source editor remains the editing route. Dedicated rendering for mathematical formulas, Mermaid diagrams, wiki-links and other tool-specific extensions is deferred. Unsupported syntax remains intact and accessible in source.

Workspace-local images are displayed directly. Internet-hosted images are fetched automatically for display without asking for approval or requiring a remembered per-domain permission. Rendering a document may therefore contact its image hosts. This does not promise offline availability of remote images that are not locally available. Embedded HTML must not become an active surface that executes scripts, submits forms or runs embedded applications. Document content is data, not an executable template.

Malformed metadata produces a visible warning identifying the affected area and a route to correction in source. It does not make the entire file read-only or prevent unrelated editing. Situate must not silently remove or repair the malformed content. Only operations that cannot be performed safely with that metadata, such as generating valid new task identities for a copy, are blocked.

### Concurrent changes

When another writer changes a file with pending editor changes, Situate first attempts an automatic Git merge using the editor's base version and the two changed versions. A conflict-free result is saved silently, without a merge-success popup, banner, toast or live-region announcement. If that file is currently open for reading or editing, its displayed content is updated to the merged version actually saved in the workspace, not an uncommitted merge preview. The update does not require reopening the file, steal focus or navigate to another file. Explicit historical-version inspection remains on its selected revision. Normal local save-state indicators remain available; failures must still be surfaced. Changes detected without pending editor changes update the view automatically. External changes retain their independent history under [REQ-0009](REQ-0009-reuse-stored-content.md).

If the merge cannot resolve a content conflict, a dialog shows both complete candidate versions: the editor text and the changed file. The user chooses one complete version to apply. This initial interaction does not require per-hunk editing or an AI-generated combination. Dismissing the dialog does not choose a version or discard pending text. A choice must not overwrite a further change that occurred after the candidates were presented; the conflict must be reassessed. This local editor flow does not replace the separate synchronization-conflict behavior in [REQ-0013](REQ-0013-synchronization-service.md).

If the file is deleted externally while the editor has pending changes, autosave must not silently recreate it. Situate retains the draft and offers restoration of the same file, saving as a new file, or explicit draft discard. Restoration and copying follow [REQ-0035](REQ-0035-preserve-file-and-task-identity.md).

### Failed writes and closure

A failed write leaves the edited text available with a visible retry or recovery action. Closing the editor view does not discard it. When explicitly closing the workspace or quitting with unsaved changes after a write failure, the user can retry, secure a copy elsewhere, or explicitly confirm discarding the changes; cancelling closure leaves the workspace open.

Situate attempts to retain recoverable drafts locally for restoration after restart. If neither the target write nor draft persistence succeeds, it must say that the text remains only in the running application rather than promise restart recovery. Forced termination cannot guarantee recovery of text that could not be persisted. Local draft recovery is distinct from a successful file save, history recording and synchronization.

## Rationale

Users need to work with their own documents without delegating every edit to the assistant. Source access provides direct control, while rendered reading makes Markdown content readable without interpreting its syntax.

## Source

Private file-editor clarification conversation; date not recorded, transcript not included. Markdown source reading and editing and a rendered reading view were explicitly confirmed as must-have capabilities, independently of direct formatted editing.

Private file-editor saving clarification; date not recorded, transcript not included. Automatic local saving without a Save button, visible save failures with retained text, and completion of pending writes before chat processing were confirmed.

Private file-editor specification clarification, 2026-10-04; transcript not included. Automatic Git merging with explicit whole-version conflict selection, draft recovery and closure choices, external-deletion handling, initial Markdown coverage, inactive embedded HTML and non-destructive metadata correction were confirmed.

Private file-editor behavior clarification, 2026-10-04; transcript not included. Automatic external-image loading replaced the earlier image-approval policy. Successful automatic merges were specified as silent updates to the currently open file's saved content, without a success notification.

## Acceptance criteria

- Users can open a Markdown file, read and change its source within Situate, and reopen the saved changes.
- Users can read other text formats internally and edit writable workspace text files without inserting Markdown metadata or changing their format.
- With internet and AI unavailable, users can edit and read locally stored Markdown in both source and rendered reading views.
- Users can switch to rendered reading to inspect the current document, then return to source without losing content or metadata.
- Merely opening a file or switching its reading representation does not modify the stored file.
- Ordinary text edits retain existing task IDs and unknown metadata; deliberate task-ID changes follow the warning and versioning rules in REQ-0035. File frontmatter is not protected as system identity.
- Unsupported Markdown constructs and malformed metadata are not silently removed while editing other content.
- Saved manual edits are available in the file's version history.
- Editing a document automatically updates its underlying local file without clicking Save, applying a draft, or requiring internet or AI access.
- Pending saves and failed writes are not presented as successfully saved. After a write failure, the edited text remains available for recovery.
- Processing a chat message with a live file reference waits for pending editor writes to that file; if saving fails, the failure is surfaced rather than silently using stale content.
- Automatic saving does not bypass confirmation for deliberate task-ID changes.
- The rendered view supports the listed initial Markdown elements. Checkboxes cannot be toggled there; unsupported extensions remain available unchanged in source.
- Rendering a document automatically fetches its internet-hosted images without a confirmation dialog or per-domain approval step. Workspace-local images display directly.
- Embedded HTML cannot execute scripts, submit forms or launch embedded applications through the rendered document.
- Malformed metadata is visibly identified with a source-correction route. Unrelated source edits remain possible without deleting or silently repairing the malformed content.
- Operations requiring valid metadata are blocked when they cannot safely preserve or regenerate task identities; ordinary reading and unrelated editing remain available.
- A change received without pending editor changes updates the view automatically.
- Concurrent non-conflicting editor and file changes are merged automatically with Git, preserving independent external history.
- A successful automatic merge produces no merge-success dialog, banner, toast or live-region announcement.
- When the merged file is currently open in its live reading or source view, the displayed content updates to the version actually saved in the workspace without reopening or stealing focus. A failed write is not presented as a saved merge.
- A merge of a different file does not change the selected file; explicit historical inspection continues to show its selected revision.
- An unresolved content conflict displays both complete versions and requires the user's choice before applying either one; no version is selected by dismissal.
- If the file changes again while conflict resolution is open, applying an older selection does not silently overwrite the unseen change.
- External deletion with a pending draft does not trigger automatic recreation. The user can restore the same file, save a new file or explicitly discard the draft.
- Closing a file view after a write failure retains its pending text. Workspace closure or application quit allows retry, securing a copy, cancellation or explicitly confirmed discard.
- A recoverably persisted draft is available after restart; a draft that exists only in memory is identified as such without a false durability promise.

## Open questions

- What automatic-save cadence and commit boundaries keep editing responsive? History presentation follows REQ-0022 rather than adding session grouping.
- Which exact Markdown parsing rules and safe resource-resolution mechanisms implement the initial element set?
