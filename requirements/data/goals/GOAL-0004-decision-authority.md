---
id: GOAL-0004
type: goal
title: Delegate work while retaining decision authority
status: approved
area: Control and trust
---

## User problem

Delegating organizational work provides little relief if users must approve each action. Actions can also create commitments or changes that do not reflect the user's intentions, so execution must remain tied to the requested task and users must be able to stop ongoing work.

## Desired outcome

Situate independently performs actions within the user's request, including external writes, without per-action approval or allow/deny decisions. Users determine the task, can clarify or redirect it, inspect outcomes and stop ongoing work. Internal changes remain reversible. Configured account access, workspace scope, platform capabilities and content protections continue to apply.

## Success criteria

- Documents can be located, checked and compiled, and internal project state updated, without separate approval for each step; internal changes can be undone.
- Requested external actions, including messages, invitations, HTTP writes and manual plugin exports, execute without a separate action approval.
- A request to prepare a draft does not become a request to send it. Missing task data is clarified rather than guessed.
- Users can stop ongoing work; stopping does not undo effects already triggered.
- Intent and observed outcomes remain traceable. Uncertain outcomes are not treated as proof of failure or automatically replayed.
- Account/provider authorization, OS permissions, deliberate plugin installation/activation and destructive workspace or user-content protections remain distinct from action approval.

## Source

Product decision: autonomous execution within user requests, without per-action approval. Earlier private goal elicitation established reversible internal organization and review of external actions; its per-action review boundary is superseded. The private transcript is not included.

## Open questions

- What scope of undo is required to make internal changes reliably correctable?
- How should partial or uncertain external outcomes be presented so users can decide what to do next?
