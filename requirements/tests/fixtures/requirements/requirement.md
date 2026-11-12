---
id: REQ-9001
type: requirement
title: Example requirement
status: approved
priority: must
area: Test area
goals: [GOAL-9001]
acceptanceCriteria:
  - id: AC-01
    text: The outcome is visible.
    milestone: MVP
    status: implemented
  - id: AC-02
    text: The outcome can be revised.
    milestone: MVP
    status: open
  - id: AC-03
    text: Related outcomes can be grouped.
    milestone: 'Later / "extended" & more'
    status: implemented
  - id: AC-04
    text: '<img src=x onerror="window.injected=true">'
    status: open
---

## Description

A verifiable outcome.

[Acceptance criteria](#acceptance-criteria)

[Problem](../goals/goal.md#user-problem)

<script>window.injected = true</script>
<img src="x" onerror="window.injected = true">

[Unsafe](<javascript:alert(1)>)
