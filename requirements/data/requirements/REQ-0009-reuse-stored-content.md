---
id: REQ-0009
type: requirement
title: Reuse and transfer stored content without Situate
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001]
---

## Description

Users must be able to read their content stored in Situate without Situate and transfer it to other tools. Switching tools must not fail because stored content is usable only with Situate. Content must be preserved during transfer.

Notes and tasks must be directly accessible as ordinary text files, and documents and attachments as ordinary files usable by appropriate applications. Users can edit these files outside Situate as well as through Situate's own editing interfaces. While the workspace is open, Situate must detect external edits, record them as independent changes in history and include them in synchronization if configured. Edits made while the workspace is closed are detected on reopening. External edits must survive rollback of an unrelated conversation. Concurrent changes to an open editor, including external deletion with a pending draft, follow the merge and recovery behavior in [REQ-0042](REQ-0042-edit-markdown-source-and-read-rendered-content.md#concurrent-changes).

External-edit support applies to local content files and modifications received through configured synchronization. It does not promise arbitrary external writes to encrypted official storage or universal interoperability with remote editors. Uncontrolled modification of internal files or `.git` can corrupt the repository; [history recovery](REQ-0022-explain-note-changes.md) applies rather than a guarantee of incorporating every damaged state.

Content must be accessible through the operating system's file interface, for example a Finder location on macOS. The platform-specific integration remains to be designed.

Markdown is the chosen format for notes and tasks; no destination tool is prescribed. [Identity](REQ-0035-preserve-file-and-task-identity.md) and [normalization](REQ-0036-convert-imported-notes-and-tasks.md) preserve task recognition and metadata. A [complete workspace directory](REQ-0038-copy-portable-workspaces.md) can be transferred without special export. The requirement promises neither identical functionality in other tools nor complete local copies of external sources that are merely connected.

## Rationale

Users should be able to use Situate without being permanently locked in by their stored content. The ability to continue their organizational system with other tools builds trust and preserves freedom of tool choice.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: avoiding data lock-in and allowing users to switch at any time; scope limited to stored content; confirmation of readability without Situate and transferability to other tools as a must-have requirement without prescribing a file format.

Private architecture strategy clarification, 2026-09-29; transcript not included. Direct file access and editing were confirmed for notes, tasks and documents, including automatic tracking of external edits and operating-system integration.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Markdown, portable workspaces and open-workspace detection and synchronization were confirmed.

Private synchronization clarification, 2026-09-30; not publicly available.

## Acceptance criteria

- Users can read stored content with other tools without continuing to operate Situate.
- Users can open and edit notes and tasks in a standard text editor without exporting them first; documents can be opened in appropriate applications.
- In an open workspace, Situate detects externally saved changes, makes them visible in its own views, records them independently in history and synchronizes them if configured; changes made while closed are detected on reopening.
- Stored files are accessible through the operating system's file interface.
- Stored content can be transferred to other tools for reuse; access does not fail because of a format usable only by Situate.
- After transfer, the original content can be used to verify that the content has been preserved.
- After transfer, content remains readable without a connection to a Situate service.

## Open questions

- Which content types, metadata and relationships must be preserved for a complete migration?
- Which formats and representative destination tools should demonstrate transferability during acceptance testing?
- How are partial external writes detected without interpreting an unfinished save as a completed edit?
- Which additional metadata-correction interactions are needed outside the built-in editor, whose non-destructive warning behavior is defined in [REQ-0042](REQ-0042-edit-markdown-source-and-read-rendered-content.md#rendering-and-metadata)?
- Which file-provider interfaces are needed on each supported platform?
