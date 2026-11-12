---
id: REQ-0025
type: requirement
title: Archive and restore past conversations
status: approved
priority: should
area: Interaction
goals: [GOAL-0002]
---

## Description

Users should be able to archive past conversations in Situate. Archiving removes a conversation from the active overview without deleting its content. Archived conversations remain accessible for reading and can be restored to the active overview.

Situate may continue using archived conversations as relevant context in accordance with [existing context use](REQ-0004-use-existing-context.md). Archiving does not exclude their content from context use.

## Rationale

Users can keep the active conversation overview focused on current work without losing access to earlier exchanges or having to repeat information already available to Situate.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Archiving past conversations was requested as a should-have capability. Removal from the active overview, continued readability, restoration to the overview and continued use as context were explicitly confirmed.

## Acceptance criteria

- Users can archive a past conversation, removing it from the active overview.
- Users can locate and read an archived conversation with its content preserved.
- Users can restore an archived conversation to the active overview.
- Archived conversation content remains available to Situate as relevant context without requiring the user to restore the conversation first.

## Open questions

- How should archive status be synchronized across connected devices?
