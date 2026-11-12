---
id: REQ-0057
type: requirement
title: Organize and filter documents with hierarchical tags
status: approved
priority: must
area: Document management
goals: [GOAL-0001]
---

## Description

Delivery: the behavior below belongs to the later document-collection increment. The first [direct-source-access iteration](REQ-0054-connect-document-sources.md#first-iteration-direct-source-access-through-chat) exposes source capabilities through chat without implementing this collection feature. Approval and priority remain unchanged; references to initial behavior below describe the first delivery of this feature, not the direct-access iteration.

Users must be able to organize documents through hierarchical tags rather than mandatory separate document-type, category and keyword fields. The user and the integration setup establish the desired organization. Tags are genuine parent-child relationships, not merely a colon naming convention; no particular serialization is selected.

Filtering by a parent includes documents assigned to descendants at any depth. Users select tags in one flat selection directly in the document view. By default, a document matches if it has at least one selected tag (any-of). A visible control switches the whole selection to requiring every selected tag (all-of), without losing the chosen tags. Changes update results immediately, without a separate filter dialog or apply step. With no selected tags, there is no tag restriction. Grouped expressions, per-tag exclusions and a filter query language are outside the initial scope. Source metadata can be mapped to Situate tags. Tags remain in Situate by default; writing them back requires explicit configuration per integration and remains within the requested task and configured access. Existing structured source information is not discarded merely because its organization is mapped to tags.

Deleting a tag is distinct from removing a document assignment or a search filter. Before confirmation, users see the affected assignments and subtags. The confirmation does not list or count affected saved searches. Deletion removes the selected tag and its document assignments, not document files or source metadata. Subtags remain by default: direct children move to the deleted tag's parent, or to the top level when deleting a root tag. Deleting the whole branch requires an explicit choice. Deleted tag conditions are automatically removed from saved searches under [REQ-0060](REQ-0060-save-document-searches.md), without a repair dialog.

Source-derived tags use the same deletion behavior. Initial deletion does not suppress their recreation or automatically change the responsible plugin or connection. Users adjust that configuration when needed.

### Initial categorization and manual editing

Source rules assign tags once when a newly identified document is first processed; ordinary refresh does not reconcile source-derived assignments. Content updates reprepare searchable text but retain tags. An uncertain identity treated as a new document is categorized again. Changed rules do not retroactively recategorize completed documents.

Categorization uses the user's configured, authorized LLM through a provider-independent contract requiring a fixed tag output format. Specialized classifier models are deferred. The output must respect the configured allowed tags and hierarchy. Creating tags or subtags requires explicit permission in the source rules; otherwise only existing or explicitly specified tags may be used.

An invalid output format receives exactly one retry. If that also fails, no automatic tags are applied and the document shows a categorization error; existing manual tags and searchable text remain intact. A valid empty tag list is successful. This retry rule does not establish retry policy for every provider failure.

The full extracted text may be sent under the source authorization. If it exceeds the model context, a bounded excerpt may be used and the result is identified as excerpt-based. Full-text search still uses all successfully extracted text. Multi-stage summarization is not part of initial categorization.

Manual tag edits after a categorization run starts invalidate its tag result without an automatic retry. If source rules change, not-yet-started runs use the new rules; old-rule in-flight results are discarded with a visible uncategorized state. An explicit retry is possible. Completed documents remain unchanged.

Tag names are trimmed and unique within one parent, case-insensitively. Manual renaming preserves assignments and saved-search identities. General reparenting and merging are deferred. Deletion that would produce duplicate sibling names is blocked with an explanation until the collision is resolved.

## Rationale

One adaptable classification system supports personal organization. A flat tag selection with one matching choice avoids requiring users to construct Boolean expressions. Any-of is a product default, not an established preference of most users.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

Private document-filter scope clarification; date not recorded, transcript not included. Flat any-of filtering with an all-of option replaces grouped Boolean filtering for the initial scope. This is a product decision, not usability evidence.

Private tag-deletion clarification; date not recorded, transcript not included. Preserving subtags by default, explicitly choosing branch deletion and applying the same deletion behavior to derived tags were confirmed as product decisions.

Private saved-search terminology and tag-deletion simplification clarification; date not recorded, transcript not included. Saved-search impact is omitted from the deletion confirmation, and deleted tag conditions are removed automatically.

## Acceptance criteria

- Initial categorization follows source rules once; source refresh and content changes do not restore manually removed tags.
- New tag creation is forbidden unless allowed by the source rules; a valid empty result is accepted.
- An invalid model output format is retried once; a second failure marks categorization failed without changing manual tags.
- Manual tag edits during a run prevent its result from being applied and do not trigger an automatic retry.
- Rule changes invalidate old-rule in-flight results, affect queued work and leave completed documents unchanged.
- Renaming preserves tag identity and saved-search conditions; sibling-name collisions block promotion during deletion.
- Excerpt-based categorization is identified without truncating the locally searchable extracted text.
- A document tagged with a descendant is found when filtering by any of its ancestor tags; filtering by a child does not include unrelated sibling-only documents.
- Users can add and remove tag filter conditions directly in the document view without chat, a separate filter dialog or an apply step; results update immediately.
- A new tag selection defaults to any-of: selecting Tax and Home includes documents matching either tag, including those matching both.
- Switching to all-of retains the selected tags and includes only documents matching every selected tag; switching back restores any-of behavior.
- The matching choice and selected tags remain visible in the document view on desktop and mobile.
- With one selected tag, both matching choices produce the same results. Removing the last selected tag removes the tag restriction while preserving other search and source restrictions.
- A source document type can be mapped to a Situate tag without forcing all users to adopt a document-type field or discarding the source value.
- Changing a Situate tag does not write to an external source by default.
- Tag write-back is available only as explicitly configured for that integration, within the requested task and configured access.
- Users can request tag deletion from the tag navigation on desktop and mobile; confirmation identifies affected document assignments and subtags, without listing or counting affected saved searches.
- Confirming deletion removes the tag, its document assignments and its conditions in saved searches without deleting document files or changing source metadata; cancelling leaves tags, assignments and saved-search criteria unchanged.
- By default, subtags and their assignments survive. Direct children move to the deleted tag's parent, or to the top level for a root tag; deeper relationships remain intact.
- Removing the entire branch and its assignments requires an explicit choice; it is not the default.
- Deleting a derived tag does not automatically alter its plugin or connection or prevent that automation from recreating it.

## Open questions

- What provider-independent tag response schema and rule validation implement the agreed contract?
- Which excerpt selection and size limits fit supported model contexts?
- What retry and error policies apply to provider failures other than invalid output format?
- How are later source write-back and explicit recategorization workflows exposed?
