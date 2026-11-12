---
id: REQ-0002
type: requirement
title: Search and read email in connected accounts
status: approved
priority: must
area: Email
goals: [GOAL-0001, GOAL-0002]
---

## Description

Situate must be able to read email in connected accounts authorized by the user. Within a user request, it must also be able to independently search for related messages rather than only processing messages individually selected by the user.

Different providers can be connected through [integration creation](REQ-0001-create-integrations.md); no particular provider is prescribed.

## Rationale

Earlier correspondence contains relevant context for ongoing organizational processes. Users should not have to find these messages themselves and transfer their contents into Situate again.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: reading email; explicit addition of independent message search; examples of different email providers; confirmation of the email functions as must-have requirements.

## Acceptance criteria

- An email identified by the user in a connected, authorized account can be read and used for processing without manually copying its text.
- For a task concerning an ongoing process, Situate can search for earlier related correspondence and read matching messages without the user selecting each one individually.
- Search and reading remain within the accounts and access authorized for the task.
- If a required message cannot be accessed, Situate makes this limitation clear rather than treating its contents as read.

## Open questions

- Which search capabilities and correspondence coverage are required for acceptance testing?
- Does reading include attachments, and which formats are needed?
- How should users define access to individual accounts or sections of a mailbox?
