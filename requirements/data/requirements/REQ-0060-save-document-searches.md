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

Users should be able to save search and filter combinations as named saved searches and pin them for quick access. Saved searches are dynamic selections, not fixed copies of their current results. They are distinct from plugin-provided views. Plugins may use these capabilities for personalized workflows.

When a referenced tag is deleted, its condition is automatically removed from every saved search in the workspace. There is no repair dialog or additional confirmation for saved searches. Other criteria, names and pinning remain unchanged. If the final tag condition is removed, the search has no tag restriction; any remaining search text or other criteria still apply. With no remaining criteria, it returns the agreed document collection.

### Initial management

Saved searches can be renamed, deleted and unpinned. Editing current query/filter controls does not silently overwrite a saved search: users explicitly update it or save a new search. Automatic removal of deleted tag conditions remains the exception defined above. Deleting a saved search does not delete documents or tags. Pinned and unpinned groups are each ordered alphabetically; manual ordering is deferred. Tag renaming preserves criteria through stable tag identity.

## Rationale

Recurring activities should not require repeatedly reconstructing the same document selection.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

Private document-filter scope clarification; date not recorded, transcript not included. Saved searches retain the flat tag selection and matching choice defined in REQ-0057.

Private tag-deletion clarification; date not recorded, transcript not included. Scope: saved-search reference handling when tags are deleted.

Private saved-search terminology and tag-deletion simplification clarification; date not recorded, transcript not included. The term saved searches and automatic removal of deleted tag conditions without a repair dialog were confirmed as product decisions, not usability findings.

Private document-navigation scope clarification; date not recorded, transcript not included. [Source and folder filtering is deferred](../foundations.md#deferred-document-source-navigation); initial saved searches do not include those conditions.

## Acceptance criteria

- Users can rename, delete and unpin saved searches without modifying document files or tags.
- Changed criteria require explicit update or saving a new search; simply changing the current selection does not overwrite the saved definition.
- Pinned and remaining searches are each alphabetically ordered, and tag renaming preserves their conditions.
- Users can name, save and reopen a search with a flat tag selection and its any-of or all-of matching choice without chat.
- A saved search can be pinned and reopened through quick access.
- After collection refresh, a newly matching document appears in the saved search without manually adding it.
- Reopening a saved search uses its current search and filter criteria.
- Confirmed tag deletion automatically removes that tag condition from every affected saved search in the workspace, including searches that are not currently open. No repair dialog or separate saved-search confirmation is required.
- Branch deletion removes conditions for all deleted descendants; conditions referencing surviving subtags remain intact.
- Removing deleted tag conditions preserves the search text, remaining criteria, name and pinning. The any-of/all-of choice remains unchanged while tags remain, and an open search retains unsubmitted text.
- Removing the final tag condition leaves no tag restriction. Remaining search text or other criteria still apply; without any criteria, all documents in the agreed collection are eligible. The saved search itself is retained.
- A newly created tag with the same name does not restore a deleted condition.
- User-facing labels distinguish saved searches from plugin-provided views.

## Open questions

- Which persistence and concurrent-update mechanism protects saved-search definitions across devices?
