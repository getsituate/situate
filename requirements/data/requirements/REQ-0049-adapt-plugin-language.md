---
id: REQ-0049
type: requirement
title: Adapt personal plugins to the user's language
status: approved
priority: must
area: Interaction
goals: [GOAL-0001, GOAL-0005]
---

## Description

New personal plugins and local copies adopted from [marketplace templates](REQ-0019-share-plugins-through-marketplace.md) must use the selected interface language for user-visible text unless the user requests another language. Language adaptation is part of creating or adapting the plugin to the person's workflow, not a requirement to maintain parallel translations.

Changing the interface language must not automatically rewrite existing plugins. Users must be able to ask the agent to adapt an existing plugin's language.

## Rationale

A personal plugin should fit its user's language without requiring unused language variants. Reduced generation and maintenance effort is an intended benefit; token savings have not been measured.

## Source

Private localization and voice clarification conversation; date not recorded, transcript not included. The language behavior and editorial direction were explicitly confirmed, followed by approval of requirement priorities.

## Acceptance criteria

- A new plugin uses German visible text with a German interface and English visible text with an English interface, unless another language is requested.
- An English marketplace template adopted with a German interface has its visible text adapted to German alongside the requested workflow and setup changes.
- An explicit requested plugin language overrides the interface-language default.
- An isolated message in another language does not override that default unless it requests a different plugin language.
- Existing plugins retain their language after an interface-language change.
- The user can request language adaptation of an existing plugin without being required to maintain a second language version.

## Open questions

- Which checks establish that generated plugin language adaptation is complete?
