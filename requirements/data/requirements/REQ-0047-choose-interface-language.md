---
id: REQ-0047
type: requirement
title: Choose a German or English interface
status: approved
priority: must
area: Interaction
goals: [GOAL-0002]
---

## Description

Situate's supplied interface must be fully available in German and English. The interface language belongs to the workspace and synchronizes with its settings when synchronization is configured. At workspace creation, German or English is selected from the device language, with English as the fallback. Users can change the stored workspace language independently of [regional formats](REQ-0052-choose-workspace-regional-formats.md). Later device-language changes do not change this preference.

Without an active workspace, the interface follows the device language with English as fallback, without a separate device-specific language preference. With an active workspace, its stored language takes precedence. Local changes and received synchronized changes take effect immediately without restarting.

Changing the interface language must not translate or modify the user's existing notes, tasks, documents, or conversation content. [Plugin language](REQ-0049-adapt-plugin-language.md) and [chat language](REQ-0048-follow-conversation-language.md) are separate.

## Rationale

People must be able to understand controls and decisions without changing the language of their personal material.

## Source

Private localization and voice clarification conversation; date not recorded, transcript not included. The language behavior and editorial direction were explicitly confirmed, followed by approval of requirement priorities.

Private localization detail interview; date not recorded, transcript not included. Workspace-owned preferences, immediate synchronized updates, independent regional formats, mixed-language chat behavior, informal German address, and translation completeness checks were explicitly confirmed. Regional formats and completeness checks were approved as must-have requirements.

## Acceptance criteria

- The supplied interface, including navigation, settings, dialogs, status messages, and errors, is available in both German and English.
- Creating a workspace initializes its stored language to German for a German device language, English for an English device language, and English for any unsupported device language.
- Users can explicitly select either supported language for the workspace. The choice persists across reopening and is independent of its regional formats.
- Opening a workspace on another device uses its stored language rather than that device's language; switching the active workspace uses the newly active workspace's language.
- A subsequent device-language change does not overwrite the workspace preference.
- Without an active workspace, including initial startup and workspace selection, the interface uses the device language with English fallback and no separate device-specific preference.
- A manual change updates the supplied interface immediately without a restart. A synchronized change does the same on other open devices when received.
- Applying local or synchronized changes preserves ongoing input, open content, and chat history without translating or resetting them.
- The language setting includes a brief notice that existing content and plugins retain their language.
- Switching interface language leaves existing user content unchanged and does not automatically translate existing plugins.

## Open questions

- Which regional English spelling convention should the supplied English text use? Regional display formats are specified separately in [REQ-0052](REQ-0052-choose-workspace-regional-formats.md), and missing translations in [REQ-0053](REQ-0053-enforce-interface-translation-completeness.md).
