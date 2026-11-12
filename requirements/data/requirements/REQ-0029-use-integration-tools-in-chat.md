---
id: REQ-0029
type: requirement
title: Use integration tools directly in chat
status: approved
priority: must
area: Integrations
goals: [GOAL-0001, GOAL-0002]
---

## Description

Chat must be able to use tools from [reusable integrations](REQ-0001-create-integrations.md) without an application or workflow plugin between them. Integrations expose appropriate tools to chat by default. Plugin developers may omit specialized functions from the chat tool list to keep its context relevant. Such omission curates tool discovery; it is not access control or a security boundary.

Initially, all designated chat tools from enabled, available integrations in the chat's workspace are offered at chat start. Another workspace's integrations are not automatically included under [workspace independence](REQ-0037-keep-workspaces-independent.md). Lazy tool discovery is not required. Direct use of an integration follows [autonomous execution within user requests](../goals/GOAL-0004-decision-authority.md), without per-action approval.

## Rationale

Users should be able to work with connected systems conversationally without first creating a dedicated application or workflow for each user request.

## Source

Private plugin architecture clarification, 2026-09-29; not publicly available. Direct integration use, default chat exposure with developer-curated omissions and initial availability of all designated tools were confirmed.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Plugins and chats were scoped per workspace without automatic cross-workspace use.

## Acceptance criteria

- A chat can perform an integration's designated function when no application or workflow plugin consumes that integration.
- At chat start, all designated tools from enabled, available integrations in that workspace are offered without a separate discovery step; opening another workspace does not automatically add its tools.
- A developer can omit a specialized function from the chat tool list without removing that function from the integration's exported interfaces.
- An omitted function is not described as access-protected merely because it is absent from chat discovery.
- An action with external effects executes directly within the user's request and configured access, without an approval prompt.

## Open questions

- How should designated tools be refreshed in an already open chat after integration activation or modification?
- How should unavailable tools and their platform or account prerequisites be presented?
