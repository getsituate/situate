---
id: REQ-0017
type: requirement
title: Inspect complete plugin instructions
status: approved
priority: must
area: Control and trust
goals: [GOAL-0004]
acceptanceCriteria:
  - id: AC-01
    text: "Users can access and read the complete instructions supplied by a plugin."
    status: open
  - id: AC-02
    text: "The displayed instructions are attributable to the plugin that supplies them."
    status: open
  - id: AC-03
    text: "If a summary is provided, users can still read the complete instructions rather than only the summary."
    status: open
  - id: AC-04
    text: "During development, Changes identifies the files changed for the assignment and opens their recorded before/after source comparison."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-05
    text: "The Changes list is flat and uses workspace-relative paths, including .situate/ plugin sources, without grouping or prioritizing by plugin, connection, instruction type or inferred purpose."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-06
    text: "Opening a code file provides syntax highlighting; merely entering development does not expose code in the conversation."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-07
    text: "Users can inspect complete instruction content during development, before activation."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-08
    text: "Standalone plugin inspection lets users open complete behavior-affecting files and identify their plugin without executing disabled code, independently of the assignment Changes list."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-09
    text: "Changes includes added, modified, deleted and renamed files across related packages and ordinary workspace files; unchanged dependencies do not appear merely because they were inspected."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-10
    text: "Selecting a file opens a Git-like source diff derived from its recorded before/after contents, including for Markdown, without semantic summaries, inferred effects, AI explanations or required explanatory metadata."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-11
    text: "Changes is the only development inspection-panel mode; workspace browsing stays in the existing Files feature, without a second Files tab or development-specific workspace browser."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-12
    text: "Changes remains usable with many files, long paths and long source files, supports keyboard access, and preserves list/detail position when returning from a comparison."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-13
    text: "Recorded revisions remain distinguishable from later edits by another conversation; uncertain shell observations or unavailable history are not presented as confirmed authorship or fabricated comparisons."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-14
    text: "Retained conversations keep recorded changes inspectable where revisions remain available; loading, retrieval failure, empty changes, unsupported comparisons and unavailable historical content are distinguished."
    milestone: Workspace-wide development with reusable connections
    status: implemented
---

## Description

Users must be able to read the complete instructions supplied by a plugin and identify which plugin they belong to. A summary alone does not satisfy this requirement. Standalone read-only plugin inspection must expose complete skill files, appended agent instructions and other behavior-affecting text where present, and remain available alongside [development](REQ-0033-stage-and-activate-plugin-changes.md). This inspection must not depend on executing the plugin, including when it is disabled. Direct editing in this panel is not required.

During a [development conversation](REQ-0001-create-integrations.md), Changes provides assignment-wide source inspection, not a second workspace browser. Its flat changed-file list uses paths relative to the workspace root, including `.situate/` plugin source. It does not group or prioritize files by plugin, connection or inferred purpose. Selecting a file opens the recorded Git-like before/after source diff; Markdown uses source comparisons too. Semantic summaries, inferred effects, AI explanations and explanatory metadata are not part of this panel.

The panel covers added, modified, deleted and renamed files, including ordinary workspace edits. Inspected but unchanged dependencies do not appear as changes. Recorded revisions must not be confused with later independent edits or uncertain authorship. Unavailable comparisons receive factual feedback. Large lists and long files remain usable, with keyboard access and retained list/detail navigation state. Workspace browsing stays in the existing Files feature.

Standalone complete-plugin inspection remains distinct from assignment diffs. Users can read complete behavior-affecting files, including unchanged instructions, without executing disabled plugins. Changes does not replace that access or require automatic code display in the transcript.

## Rationale

Understanding the instructions a plugin contributes helps users assess how it influences Situate's behavior and retain a sense of control over delegated work. Instruction visibility complements [visibility of plugin use](REQ-0018-show-plugin-use.md).

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Complete plugin instructions were explicitly requested to be readable so users can understand application behavior and retain a sense of control. Confirmed as a must-have requirement.

Private chat-design clarification conversation; date not recorded, transcript not included. A development file panel with openable contents, syntax-highlighted code and visual emphasis on readable working instructions was confirmed.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. Read-only file inspection alongside development was selected to make plugin behavior understandable.

Private workspace-development interface clarification; date not recorded, not publicly available. Flat workspace-relative source diffs, including internal paths, Changes-only inspection and no semantic interpretation layer replace the earlier instruction-prioritized development overview. Standalone complete-plugin inspection remains required.

## Open questions

- Beyond development, at which stages must instructions be available, particularly before installation?
- How are attributable before/after revisions retained and retrieved across shell writes, concurrent edits and cleanup without inventing authorship?
