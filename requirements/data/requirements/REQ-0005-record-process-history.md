---
id: REQ-0005
type: requirement
title: Automatically record a traceable process history
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001, GOAL-0002]
---

## Description

When handling an assigned organizational process, Situate must automatically record relevant new information, actions and results as a traceable history by default. This history must remain understandable to users and usable by Situate for subsequent work without users manually maintaining it or requesting every addition individually.

Prepared actions must remain distinguishable from actions actually performed. [Explicit history deletion](REQ-0007-history-storage-control.md) is an optional capability. Process history does not require copying all external source content; [note version history](REQ-0022-explain-note-changes.md) separately preserves changes to notes within Situate. No particular technical storage format is prescribed.

Chat preserves actual tool calls and available results through its ordinary conversation history, with the presentation rules in [REQ-0040](REQ-0040-reveal-tool-details-and-content-changes.md). Relevant actions initiated outside chat, including views and scheduled work, remain traceable through their owning process or domain history. This requirement does not demand a separate durable record for every internal invocation.

Process history and an action's effects are not one atomic transaction. A crash can leave changed content or an external effect without a completed result in the saved conversation or process history. Preserve the available interrupted state and disclose known persistence failures; an error, cancellation or missing result never proves that no effects occurred. Later user-directed work may inspect current state and available history, but must not automatically replay an interrupted action. Inspection or agent judgment cannot guarantee reconstruction of external outcomes. These limits do not remove ordinary history recording, content durability and recovery under REQ-0022, or task-scope and account-access boundaries.

## Rationale

Maintaining current notes and a traceable history is useful but requires ongoing work. Automatic history preserves context for subsequent processing without passing this maintenance effort on to the user.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: previously manual note maintenance and an AI-maintained activity history; agreement to automatic process history by default with individual note structures and controllable storage; subsequent classification as a must-have requirement. Later clarification rejected exclusions from history recording and made explicit history deletion a could-have capability.

Private execution-outcome clarification, 2026-10-13; not publicly available. Ordinary conversation and process history remain required, while crash gaps between effects and saved results are accepted without a separate durable invocation ledger or automatic replay.

## Acceptance criteria

- During normal operation, relevant new information, actions and results are traceable in the process history without a separate maintenance request from the user.
- A saved reply draft is identifiable as prepared and is not presented as a sent message.
- During subsequent work, Situate can consult the recorded history and understand the previous state from it.
- Users can follow the history without maintaining a second set of records themselves.
- Relevant non-chat actions remain attributable in their owning process or domain history; the absence of a conversation does not exempt them from recording.
- Known history-save failures are disclosed, and available interrupted state is preserved without presenting an absent result as proof of no effect.
- Reopening after an interruption does not automatically repeat the action; subsequent inspection distinguishes verified outcomes from uncertainty.

## Open questions

- Which information and steps are relevant to a traceable history, and which are merely technical intermediate steps?
- How can users correct erroneous entries?
- How are actions outside Situate detected, particularly a draft later sent in an email application?
