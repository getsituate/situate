---
id: REQ-0040
type: requirement
title: Keep tool details collapsible and changes visible in chat
status: approved
priority: must
area: Control and trust
goals: [GOAL-0004, GOAL-0005]
acceptanceCriteria:
  - id: AC-01
    text: "A read-only tool call does not expand its technical details by default."
    status: open
  - id: AC-02
    text: "Users can expand and collapse the tool trace to inspect actual invoked tools, their inputs and available results; the trace is not merely a generated activity summary."
    status: open
  - id: AC-03
    text: "Plugin identity is shown on its tool-call entry and may collapse with that entry."
    status: open
  - id: AC-04
    text: "A supplied write or edit affecting a note or persistent working instruction appears immediately in chat with file identity and a distinction between an attempted action and its confirmed outcome."
    status: open
  - id: AC-05
    text: "A supplied write displays the complete written text; an edit visually distinguishes removed and added content without requiring knowledge of raw patch syntax or showing technical patch metadata."
    status: open
  - id: AC-06
    text: "Supplied writes and edits to plugin implementation code remain in the activity trace rather than automatically exposing code in the conversation."
    status: open
  - id: AC-07
    text: "Consecutive visible edits to the same file each retain their own chronological entry."
    status: open
  - id: AC-08
    text: "Plugin-development instructions require a presentation choice when registering a new tool. Authors can choose main-chat or activity-only presentation even for note-changing tools."
    status: open
  - id: AC-09
    text: "Activity-only plugin calls remain expandable with their actual inputs and available results."
    status: open
  - id: AC-10
    text: "Both conversation types apply the same tool-presentation rules."
    status: open
  - id: AC-11
    text: "Model-supplied reasoning may be inspected in activity; no separate model generates reasoning entries for that trace."
    status: open
  - id: AC-12
    text: "The displayed diff reflects the actual change, not only the agent's intended edit."
    status: open
  - id: AC-13
    text: "A failed call is not presented as a successful change."
    status: open
  - id: AC-14
    text: "Collapsing technical details does not hide required questions, cancellation or persistence errors."
    status: open
  - id: AC-15
    text: "Ordinary and development conversations reuse the same message, Activity, tool-call and content-change components and interaction conventions; only development's background and header label differ visually."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-16
    text: "Discovery, connection reuse, checks, access requirements and activation outcomes appear through ordinary messages and actual tool results, not development-only package or outcome components."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-17
    text: "Changes-panel source diffs do not replace chronological note and working-instruction changes in the transcript or require semantic summaries there."
    milestone: Workspace-wide development with reusable connections
    status: implemented
---

## Description

Chat must hide routine technical tool-call details by default while letting users expand them to inspect the actual calls performed by the agent. The [supplying plugin](REQ-0018-show-plugin-use.md) is identified on its tool-call entry. Plugin attribution follows the same disclosure hierarchy and is not repeated in a separate usage indicator; it may remain hidden with the collapsed work history or tool group, including during execution.

For supplied write and edit tools, the effect on content determines default visibility, not the tool name alone. Writes and edits to notes and persistent personal working instructions appear directly in chat; writes and edits to plugin implementation code remain in the collapsed activity trace. A write shows the complete written text. An edit shows removed and added content in a readable visual comparison without raw patch headers, hunk coordinates or other technical patch metadata. File identity remains visible.

Each visible call appears immediately at its own chronological position in the conversation, distinguishing an in-progress attempt from its confirmed result. Repeated edits to the same file remain separate entries rather than being merged into a single updating card. Technical details may stay collapsed alongside a visible change.

Plugin development instructions must direct authors to register whether each new tool appears directly in chat or only in the activity trace. Plugin authors freely choose this presentation, including for tools that change notes; Situate imposes no additional content-effect visibility rule on plugin tools. Calls hidden from the main conversation remain inspectable in the activity trace. Presentation registration does not override task scope or call-local plugin attribution.

Normal and [development conversations](REQ-0001-create-integrations.md) use the same message, Activity, tool-call and content-change components and interaction conventions. Only the development background and header label differ visually. Discovery, reuse, check failures, access requirements and activation outcomes use ordinary messages and actual tool results, without a development-only package dashboard or outcome component. The separate [Changes panel](REQ-0017-inspect-plugin-instructions.md) uses source diffs without semantic summaries; it does not replace chronological transcript changes. Development does not automatically expose implementation code in the chat. Reasoning supplied by the executing model may appear within the expandable activity trace; normal model responses remain conversation messages. Separately generated [Mini Bend comments](REQ-0039-show-expressive-chat-activity.md) are not added as synthetic reasoning entries.

The change presentation complements [version history and recovery](REQ-0022-explain-note-changes.md); it does not replace them or introduce prior approval for every internal edit. External effects execute within the user's request without per-action approval.

## Rationale

Users should be able to follow a conversation without reading execution logs, while changes to their information remain apparent and reviewable.

## Source

Private chat interaction requirements conversation; date not recorded, transcript not included.

Private chat-design clarification conversation; date not recorded, transcript not included. Supplied-tool visibility was narrowed to notes and working instructions, with full write content, readable edit comparisons and separate chronological call entries. Free plugin-defined presentation and identical rules across conversation types were confirmed.

Private workspace-development interface clarification; date not recorded, not publicly available. Shared normal/development transcript components and interaction conventions were selected, with only background and header-label differences; Changes remains a separate source-diff inspection panel.

## Open questions

- Which layout keeps large write contents and edit comparisons usable while preserving the complete write text and separate call entries?
- How should deletions, moves, binary files and changes in external systems be presented?
- Which tool inputs or outputs require redaction, truncation or separate access?
- Which usability tasks should verify that nontechnical users understand the diff?
