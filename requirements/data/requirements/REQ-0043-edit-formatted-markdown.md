---
id: REQ-0043
type: requirement
title: Edit Markdown directly in its formatted view
status: approved
priority: should
area: Personal organization
goals: [GOAL-0001, GOAL-0004]
---

## Description

Users should be able to edit Markdown directly in a formatted document view rather than switching to source for every change. When available, formatted editing is the normal editing experience; the [source editor](REQ-0042-edit-markdown-source-and-read-rendered-content.md) remains accessible when needed.

Formatted editing changes the same Markdown file rather than a separate document representation that requires export. Switching between formatted editing, source and rendered reading must preserve content, file-reference continuity, task identities and additional metadata. Unsupported constructs must survive edits to supported content rather than being silently simplified or removed.

This capability can be delivered after the required source editor and rendered reading view. Its absence does not prevent those baseline capabilities from being used. When available, it follows the same offline, file-reference, task-identity and history rules as source editing.

## Rationale

Users should be able to concentrate on document content without needing Markdown syntax for routine edits. Source access still provides control over constructs not covered by the formatted interface.

## Source

Private file-editor clarification conversation; date not recorded, transcript not included. Direct formatted Markdown editing was chosen as the intended normal experience but classified as should-have, allowing delivery after the must-have source editor and rendered reading view.

## Acceptance criteria

- When formatted editing is available, users can open Markdown for editing and change text directly in its formatted view without first opening source.
- Users can switch to source when needed and return to formatted editing with their changes retained.
- Changes made in either editor are reflected in the same Markdown file.
- Switching modes or editing supported content does not discard unknown metadata or unsupported Markdown constructs.
- File-reference continuity and task IDs survive normal edits; copies and deliberate task-ID overrides follow REQ-0035.
- Formatted editing works for locally stored Markdown without internet or AI, and saved changes appear in file history.
- Source editing and rendered reading remain usable independently of formatted editing.

## Open questions

- Which formatting operations and Markdown elements are supported initially, including tables, images and code blocks?
- How are unsupported constructs shown and selected for source editing?
- How should the editor distinguish ordinary checkboxes from recognized tasks and expose the configured task-completion behavior?
