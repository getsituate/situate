---
id: REQ-0007
type: requirement
title: Explicitly delete stored history
status: approved
priority: could
area: Control and trust
goals: [GOAL-0004]
---

## Description

Users could be offered a way to explicitly delete previously stored history. Whether to implement this capability remains undecided.

This is distinct from deleting a note from the current collection: ordinary note deletion preserves its history and recoverability under [note version history](REQ-0022-explain-note-changes.md). Explicit deletion of history would remove the corresponding recovery information. Deleting history is not, by itself, a request to also delete underlying emails, documents or current personal notes.

## Rationale

Explicit history deletion would let users remove retained historical content rather than only remove a note from the current collection. This optional capability trades recoverability of the affected versions for permanent removal.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: agreement to automatic history with the ability to exclude content from permanent storage and delete stored history; renewed confirmation of storage control as a must-have requirement. Subsequent clarification downgraded explicit history deletion to could-have, with implementation left undecided. Excluding content from history recording was rejected because no use case was identified. Ordinary note deletion was distinguished from deleting its retained history.

## Acceptance criteria

- Users can select previously stored history for deletion and have it deleted.
- Deleted history is no longer used as available historical context in subsequent work.
- A request to delete history does not also delete external original sources without a corresponding request.

## Open questions

- Will explicit history deletion be implemented?
- At what level should history deletion be possible, such as individual versions, notes or processes?
- How do deletions affect derived information, synchronization and backups, and within what time limits?
- How can explicitly deleted historical content be prevented from unintentionally reentering history during later processing from sources that remain accessible?
