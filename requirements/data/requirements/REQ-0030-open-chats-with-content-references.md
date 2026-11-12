---
id: REQ-0030
type: requirement
title: Open fresh chats with visible content references
status: approved
priority: must
area: Personal organization
goals: [GOAL-0002, GOAL-0005]
---

## Description

Plugins must be able to offer an explicit action that opens a fresh chat with a visible reference to selected content. The user can then write a prompt. Opening the chat with that reference need not start agent processing by itself.

The built-in file view's chat action opens a fresh standard chat through the workspace's existing [pane layout](REQ-0026-provide-plugin-defined-views.md), not a separate file-specific chat interface. The file is visibly referenced in the composer's attachment area. Users can remove that reference without deleting the source file; browsing another file does not silently retarget it. The initial prompt remains empty and under the user's control.

References normally point to live source content, not forced snapshots. All internal file references, including Markdown, use [Git-anchored continuity](REQ-0035-preserve-file-and-task-identity.md) without embedded file IDs. Confirmed Situate-managed moves or renames preserve known references; external moves or renames may leave them unresolved rather than arbitrarily retargeting another file. Task references retain UUID-based identity and require user selection when copied task IDs are ambiguous. A source deletion can leave a reference unresolved. For versioned content, plugins can also reference a specific historical revision, such as an earlier project state. The plugin chooses whether opening a reference navigates to an internal Situate view or an external application or browser.

A completed Situate-managed move retains reference continuity. After an [interrupted file operation](REQ-0022-explain-note-changes.md#interrupted-file-operations), continuity that cannot be established remains unresolved; restoring a chat does not complete the operation or select a new source automatically. Reusing an old pathname for another file must not revive a reference whose source was known to be deleted or whose continuity is uncertain.

[Stored-content version history](REQ-0022-explain-note-changes.md) and [traceable process history](REQ-0005-record-process-history.md) remain required independently of reference resolution. This capability does not require retaining every external source or prescribe source-deletion rules for all workflows.

## Rationale

Users can bring selected content into a new conversation without reconstructing its context or immediately committing to processing. Live and historical references support different questions without forcing copies of external content.

## Source

Private plugin architecture clarification, 2026-09-29; not publicly available. Explicit fresh-chat actions, visible live references, optional historical revision references and plugin-selected internal or external navigation were confirmed.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Internal file and task identity and user-resolved duplicate references were confirmed.

Private non-Markdown reference clarification; date not recorded, not publicly available. Initial path-based references and their move and rename behavior were confirmed.

Private file-view chat clarification; date not recorded, transcript not included. The standard chat pane and composer attachment area were selected for file references, with no separate file-chat interface.

Private file-history ownership and interrupted-operation clarification, 2026-10-11; not publicly available. Uncertain references remain unresolved after restart rather than relying on automatic operation completion.

Private file-reference decision, 2026-11-03; not publicly available. Markdown uses the same Git-anchored file references as other files; task identity remains UUID-based.

## Acceptance criteria

- A plugin action can open a new chat with a visible reference to the selected content and let the user compose the first prompt before processing begins.
- The file view's chat action opens a fresh standard chat in the existing pane layout with the selected file visible in the composer's attachment area and an empty message field.
- Removing a composer reference leaves the source file unchanged; opening a different file in the file view does not replace that reference.
- A normal live reference resolves to the current source rather than an automatically retained snapshot.
- A known reference to any file, including Markdown without frontmatter, follows a move or rename performed through Situate; an external move or rename may leave it unresolved without arbitrary retargeting.
- If the source is no longer available, the reference is shown as unresolved rather than silently replaced with unrelated content or claimed to be a preserved copy.
- Restoring a chat after an interrupted file operation neither repeats that operation nor automatically reselects a source for an uncertain reference.
- A new or restored file at a previously used pathname does not revive a reference with known deletion or unresolved continuity; selecting the restored file explicitly creates a new reference.
- A plugin can reference an available historical revision of versioned content; opening it resolves to that revision rather than the current version.
- A reference can open an internal view or an external application or browser as specified by the plugin.
- Loss of access to an external source does not remove already recorded process history or stored-content versions.

## Open questions

- How are live references, historical revisions and unresolved references visually distinguished?
- How should changes in external source identity or permissions affect reference resolution?
