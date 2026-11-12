---
id: REQ-0035
type: requirement
title: Preserve file-reference continuity and task identity
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001, GOAL-0004]
---

## Description

Markdown and other files use the same live-reference model: a workspace-relative path anchored in retained Git history. Situate does not require or generate an embedded file ID, a file-ID sidecar or an authoritative identity registry. A file can be created, edited and referenced without frontmatter. Ordinary writes preserve user metadata, including an existing `situate-id` field, but do not interpret that field as system identity.

Ordinary content edits preserve live-reference continuity. A completed Situate-managed move or rename lets existing references follow the file, including descendants of moved folders and references in unopened conversations. The evidence comes from confirmed operations in history, not filenames, equal bytes or Git rename heuristics. External moves and renames may leave references unresolved; universal recovery from external edits is not required.

Copying a file creates a separate lineage and does not transfer references to its source. A known deletion ends the old lineage. Creating or restoring a file at the same or another path does not reactivate those old live references, even when content is identical. The restored file is available for a new explicit selection, and its retained historical versions remain inspectable. An [interrupted operation](REQ-0022-explain-note-changes.md#interrupted-file-operations) is not automatically completed or rolled back on restart. Missing or insufficient continuity evidence leaves a reference unresolved rather than selecting the current occupant of an old path. An explicit historical reference still selects its exact retained revision and path.

When Situate copies a complete folder, clearly recognized references between copied items are rewritten within the copies to target their copied counterparts, including supported relative-path references and task-identity links. References to content outside the copied folder retain their original targets. The source folder and its references are unchanged. Unsupported or ambiguous references must not be guessed or silently retargeted.

Tasks retain identity independent of their containing file. The [storage constraints](../foundations.md#markdown-and-identity) specify a UUID in a `situate-task-id` comment at the checkbox. The same comment carries extensible task metadata and both recognizes and identifies the task; a separate task tag is unnecessary. An unmarked checkbox remains an ordinary checkbox.

Task IDs are generated locally with practically negligible collision risk, without cross-device counters. New tasks and task copies receive new IDs. Moving or restoring the same task preserves its ID, including movement between files. Restoring task IDs does not restore the containing file's old live-reference lineage.

Normal manual editing preserves task IDs and metadata. The [source editor](REQ-0042-edit-markdown-source-and-read-rendered-content.md) permits deliberate task-ID changes after an explicit warning that task references may lose their targets. Merely viewing source does not require confirmation. The warning applies when an ID is affected by replacing or deleting a larger selection. Confirmed overrides are versioned; reference preservation is not guaranteed. No special file-ID warning applies to ordinary frontmatter fields.

External copies may duplicate task IDs. When a task reference resolves to several matching tasks, the user must choose the intended one before the agent acts. That choice repairs task identity throughout the workspace: the chosen task retains the old ID and other matching tasks receive new IDs. Repair changes are versioned. Externally removed or changed task IDs may leave references unresolved. A rare accidental UUID-generation collision may surface as an error without special recovery; this does not replace external-copy disambiguation. [Synchronization](REQ-0013-synchronization-service.md) performs no additional semantic conflict checking.

## Rationale

One file-reference model avoids modifying ordinary files for identity and preserves references through managed reorganization without guessing uncertain targets. Task UUIDs remain necessary because individual tasks can move independently of files.

## Source

Private content and workspace architecture clarification, 2026-09-29; not publicly available.

Private synchronization clarification, 2026-09-30; not publicly available.

Private file-editor specification clarification, 2026-10-04; transcript not included. Folder copies retarget recognized internal references without modifying their source.

Private file-history ownership and interrupted-operation clarification, 2026-10-11; not publicly available.

Private file-reference and import decision, 2026-11-03; not publicly available. Unified Git-anchored file references replace embedded file UUIDs; task UUIDs remain. Restoration does not revive deleted file references. Existing development workspaces require no migration or conversion.

## Acceptance criteria

- Markdown and other files use Git-anchored live references without requiring an embedded file ID or another authoritative file-ID registry.
- Creating, reading, editing or externally discovering a Markdown file does not insert `situate-id` or require frontmatter.
- Ordinary writes preserve existing user metadata without interpreting `situate-id` as identity or applying a special file-ID warning.
- Live references resolve current content through ordinary edits and completed managed moves or renames, including moved-folder descendants and unopened conversations.
- Copies do not take over references to their source. A known deletion ends the old file lineage.
- Restoring or recreating a file does not revive old live references, even at the same path with identical bytes; a new explicit selection can reference the restored file.
- File history remains accessible through confirmed managed moves without filtering by a frontmatter UUID.
- Historical references retain their exact revision and path.
- External moves or renames may leave references unresolved; missing evidence, interruption, similar names or equal content never justify arbitrary targeting.
- Restart does not automatically finish, roll back or replay an interrupted file operation or rebind an uncertain reference.
- Copying a folder rewrites clearly recognized internal relative-path and task-identity references within the copies; external targets and the source folder remain unchanged.
- Unsupported or ambiguous links are not silently retargeted.
- A default task has a locally generated UUID in its `situate-task-id` comment; that comment can hold extensible task metadata without a separate task tag.
- An unmarked checkbox is not automatically promoted to a task.
- Moving or restoring the same task preserves its ID; a new or copied task receives a new ID, without coordinated cross-device counters.
- Ordinary edits preserve task IDs and unknown metadata. Deliberate task-ID overrides require a warning, including through larger selections, and are versioned.
- Viewing source alone does not require task-ID confirmation.
- Dereferencing a duplicated task ID requires user selection, including after synchronization; only the selected task retains the old ID, and versioned repair gives other matching tasks new IDs.
- Externally removed or changed task IDs may leave task references unresolved rather than silently targeting unrelated content.
- Binary content remains versioned without an embedded file ID.

## Open questions

- How should matching tasks be presented for duplicate-ID disambiguation?
