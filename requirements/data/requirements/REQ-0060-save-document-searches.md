---
id: REQ-0060
type: requirement
title: Save and pin document searches
status: approved
priority: should
area: Document management
goals: [GOAL-0001]
---

## Description

Delivery: the behavior below belongs to the later document-collection increment. The first [direct-source-access iteration](REQ-0054-connect-document-sources.md#first-iteration-direct-source-access-through-chat) exposes source capabilities through chat without implementing this collection feature. Approval and priority remain unchanged; references to initial behavior below describe the first delivery of this feature, not the direct-access iteration.

Users should be able to save document search queries by name and pin them for quick access. Saved searches are dynamic selections, not fixed copies of their current results. They are distinct from plugin-provided views. Plugins may use these capabilities for personalized workflows.

### Initial management

Saved searches can be renamed, deleted and unpinned. Editing the current query does not overwrite a saved search: users explicitly update it or save a new search. Deleting a saved search does not delete documents. Pinned and unpinned groups are each ordered alphabetically; manual ordering is deferred.

## Rationale

Recurring activities should not require repeatedly reconstructing the same document selection.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

Private document-navigation scope clarification; date not recorded, transcript not included. [Source and folder filtering is deferred](../foundations.md#deferred-document-source-navigation); initial saved searches do not include those conditions.

## Acceptance criteria

- Users can rename, delete and unpin saved searches without modifying document files.
- Changing the current query does not overwrite a saved search unless the user explicitly updates it.
- Pinned and unpinned searches are each alphabetically ordered.
- Users can name, save and reopen a document search without chat.
- A saved search can be pinned and reopened through quick access.
- After collection refresh, a newly matching document appears in the saved search without manually adding it.
- Reopening a saved search uses its saved query.
- User-facing labels distinguish saved searches from plugin-provided views.

## Open questions

- Which persistence and concurrent-update mechanism protects saved-search definitions across devices?
