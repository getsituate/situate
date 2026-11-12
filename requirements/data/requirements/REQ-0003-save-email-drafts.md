---
id: REQ-0003
type: requirement
title: Save reply drafts in the connected email account
status: approved
priority: must
area: Email
goals: [GOAL-0001, GOAL-0002, GOAL-0004]
---

## Description

When processing email, Situate must be able to create reply drafts and save them in the corresponding connected email account. Users must be able to review, edit and send them in their usual email application. Reply text shown only in the Situate chat is not sufficient.

Creating and saving a draft must not trigger sending. Sending requires a user request to send, not a separate per-action approval.

## Rationale

Situate should handle organizational work without forcing a change of email application. A draft available in the account enables final review and sending with existing tools.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: email drafts; explicit confirmation that drafts should be saved in the connected email account and used in the usual email application; confirmation of email functions as must-have requirements. The boundary around sending had already been established during goal elicitation through the requested review and user-initiated sending workflow.

## Acceptance criteria

- After a reply is prepared, the draft exists in the corresponding connected email account, not just as text in Situate.
- Users can open, edit and send the saved draft themselves in their usual email application.
- Creating and saving a draft does not send any message to its recipients.
- If saving to the account fails, Situate does not present the draft as successfully saved there.

## Open questions

- Which components besides message text must drafts support, such as attachments, CC and BCC?
- How is the appropriate sender account selected when multiple accounts are connected?
- How should existing drafts or drafts edited outside Situate be handled during subsequent processing?
