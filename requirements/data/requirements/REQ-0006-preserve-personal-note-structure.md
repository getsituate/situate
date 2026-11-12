---
id: REQ-0006
type: requirement
title: Use process history without a mandatory note structure
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001]
---

## Description

Situate must support automatic process history without prescribing a particular personal note structure. How history feeds into personal notes must follow the working method agreed with the user. Situate may change notes that are part of the system without requiring approval of each change. It may also change the note structure when the user wants it to do so; this does not require separate approval of every restructuring step. Internal changes remain reversible in accordance with [user decision authority](../goals/GOAL-0004-decision-authority.md).

## Rationale

Users organize notes individually. The benefit of an automatically maintained memory should be available without forcing a change of method or adoption of a prescribed filing structure.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: tension between individual note organization and machine-usable history; agreement to automatic process history by default without a mandatory note structure; subsequent confirmation as a must-have requirement. A later clarification permits autonomous changes to notes within the system and changes to their structure when desired by the user, without per-change approval.

## Acceptance criteria

- Users can use automatic process history without converting their existing note structure into one prescribed by Situate.
- Situate can change notes within the system without requesting prior confirmation for each change.
- When the user wants the note structure changed, Situate can restructure it without requesting approval for every step.
- The resulting organization follows the user's desired working method rather than a mandatory structure imposed by Situate.

## Open questions

- How is the desired integration with personal notes agreed and changed?
- Which different note systems should be included in acceptance testing?
