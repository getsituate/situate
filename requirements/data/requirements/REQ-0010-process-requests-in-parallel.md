---
id: REQ-0010
type: requirement
title: Process independent user requests in parallel
status: approved
priority: must
area: Productivity
goals: [GOAL-0002]
---

## Description

Situate must be able to process multiple independent user requests simultaneously. An ongoing user request must not inherently block another independent user request until it is complete.

Parallelism does not expand task scope or configured account access; external actions execute without per-action approval. An unlimited number of simultaneous user requests is not required.

## Rationale

Users work on multiple organizational topics. Making independent user requests wait for each other solely because execution is sequential creates avoidable waiting time. Parallel processing should reduce this wait.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: parallel user request processing for productivity; confirmation of both simultaneous user request execution and parallel work on topics; explicit prioritization of both as must-have requirements.

## Acceptance criteria

- While Situate processes one user request, users can submit another independent user request for processing.
- The processing periods of both user requests can overlap; the second user request is not merely postponed until the first finishes.
- Results remain associated with their respective user requests.
- Even during parallel execution, external actions remain within the requested task and configured access, without per-action approval.

## Open questions

- How are conflicts handled when parallel user requests modify the same content?
- What capacity limits apply, and how are they made visible to users?
- How should users cancel individual ongoing user requests or influence their processing order?
