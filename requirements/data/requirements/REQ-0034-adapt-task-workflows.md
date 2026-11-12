---
id: REQ-0034
type: requirement
title: Start with useful task management and adapt it to personal workflows
status: approved
priority: must
area: Personal organization
goals: [GOAL-0001, GOAL-0003, GOAL-0005]
---

## Description

Situate must ship a default task workflow plugin and reusable task functions, with an immediately useful view and basic filters rather than a blank canvas. During import or onboarding, the agent can adapt categories, ordering, fields and rules to the user's working method. Placement follows the existing [view contract](REQ-0026-provide-plugin-defined-views.md) and [interface extension capabilities](REQ-0028-extend-interface-elements-and-layout.md), not a new mandatory sidebar or immutable core all-task view.

Users can keep tasks within project notes, thematic lists or individual Markdown files. Neither a project concept nor a filing structure is mandatory. The default task model contains text, identity and open/completed state only; due, scheduled, start and priority fields are not standard fields at this stage. Users may extend or change state and workflow interfaces through the agent, with affected consumers adapted under [shared interface development](REQ-0001-create-integrations.md).

Chat and the task view must use the same reusable complete-task operation. Completion follows the user's rule, which may check, archive or remove the task. Deletion is not universally equivalent to completion. All resulting content changes retain [core version history](REQ-0022-explain-note-changes.md).

## Rationale

Users need a usable starting point for tracking commitments without rebuilding task management or accepting a workflow that conflicts with their own.

## Source

Private content and workspace architecture clarification, 2026-09-29; not publicly available.

## Acceptance criteria

- A new setup provides a working task view with basic filters and reusable task functions before custom plugin development.
- Tasks can be managed in project notes, thematic lists and one-file-per-task arrangements without requiring projects or a prescribed directory layout.
- During import or onboarding, requested categories, ordering, fields and rules can be adapted through the agent.
- The default task model requires no date or priority fields and supports text, identity and open/completed state.
- A requested state or workflow interface change adapts its affected consumers rather than requiring the original interface to remain immutable.
- Completing the same task from chat or its view invokes the same reusable operation and applies the same configured rule.
- Checking, archiving and removal can each be used as a completion rule; an ordinary deletion is not automatically interpreted as completion in every workflow.
- Completion changes, including removal, remain recoverable through core history.

## Open questions

- Which basic filters and initial ordering should the default task view provide?
- How are workflow changes and their effects presented during onboarding?
