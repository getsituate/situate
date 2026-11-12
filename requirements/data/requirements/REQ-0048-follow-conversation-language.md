---
id: REQ-0048
type: requirement
title: Follow the conversation language independently of the interface
status: approved
priority: must
area: Interaction
goals: [GOAL-0002, GOAL-0005]
---

## Description

Situate must use the language of the conversation for chat responses, independently of the selected interface language. German and English conversations must both be supported. An explicit request for a response language takes precedence over the language otherwise indicated by the conversation.

## Rationale

People should be able to discuss their material naturally without changing interface preferences.

## Source

Private localization and voice clarification conversation; date not recorded, transcript not included. The language behavior and editorial direction were explicitly confirmed, followed by approval of requirement priorities.

Private localization detail interview; date not recorded, transcript not included. Workspace-owned preferences, immediate synchronized updates, independent regional formats, mixed-language chat behavior, informal German address, and translation completeness checks were explicitly confirmed. Regional formats and completeness checks were approved as must-have requirements.

## Acceptance criteria

- With an English interface, a German conversation receives German responses.
- With a German interface, an English conversation receives English responses.
- An explicit request to answer in German or English is honored without changing the interface language, and takes precedence over the language of subsequent requests for as long as that instruction applies.
- Otherwise, the language of the user's own request determines the response language. Pasted documents, quotations, code, and attachments do not by themselves change it.
- A German request containing an English email receives a German response; a subsequent English request receives an English response unless an explicit instruction says otherwise.
- When a message does not establish a language, such as an emoji or an attachment alone, Situate keeps the previous conversation language. With no previous conversation language, it uses the workspace language.
- Conversation language does not by itself change the default language for newly created or adopted plugins; [plugin language](REQ-0049-adapt-plugin-language.md) uses the interface preference unless another language is requested.

## Open questions

None currently identified.
