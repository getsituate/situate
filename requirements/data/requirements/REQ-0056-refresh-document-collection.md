---
id: REQ-0056
type: requirement
title: Refresh document information and expose availability
status: approved
priority: must
area: Document management
goals: [GOAL-0001]
---

## Description

Delivery: the behavior below belongs to the later document-collection increment. The first [direct-source-access iteration](REQ-0054-connect-document-sources.md#first-iteration-direct-source-access-through-chat) exposes source capabilities through chat without implementing this collection feature. Approval and priority remain unchanged; references to initial behavior below describe the first delivery of this feature, not the direct-access iteration.

Changes in configured sources must update the document collection automatically when the source is reachable and the connector can execute. Users must also be able to request a refresh. Execution follows [workspace and plugin lifecycle](REQ-0031-run-plugins-independently-of-views.md); this does not promise continuous execution while a workspace is closed or immediate updates from every source.

Known pending processing, stale information and failures must be visible rather than represented as a complete, current search. Finding a document is distinct from being able to retrieve its original. A source reachable only on another device must not appear locally available merely because its metadata is present. The initial retention rules below distinguish temporary outages from confirmed removal and revoked access.

### Initial refresh and retention behavior

Sources refresh when a workspace opens, periodically while it remains open and on manual request. Source-specific intervals and optional change notifications depend on connector capabilities. Closed workspaces do not execute preparation. Mobile suspension may delay work until reopening; immediate detection is not promised.

Known prepared information remains usable during temporary outages with its last known state identified. Confirmed source deletion, removal from the agreed subset, explicit access revocation or permanent source removal ends active use: remove affected current records and prepared content from collection/search/assistant retrieval and clear affected preview caches. Existing references become unavailable, never retargeted. A transient error alone is not proof of deletion or explicit revocation.

No automatic purge of prior technical metadata versions or existing conversations is promised. Historical data must not silently reenter the active collection. Devices apply confirmed removals when they receive them; unavailable devices cannot be assumed to have already purged local data.

Content changes under a reliable identity refresh extraction and search data without reapplying initial tag rules. Interrupted processing resumes using completed work where still current.

## Rationale

Users need to understand whether a missing result means no matching document was found or whether the collection is incomplete, and whether they can actually open a result.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

## Acceptance criteria

- Workspace opening, periodic processing and manual refresh detect changes when the connector can execute; closed workspaces do not process sources.
- Temporary outages retain clearly marked prepared information; confirmed deletion, scope removal or explicit revocation removes it from active search and assistant retrieval and clears affected preview caches.
- Changed content is re-extracted without replacing existing tag assignments.
- Restart continues incomplete work without unnecessarily reprocessing successfully completed current revisions.
- A document added or changed directly in an included source is incorporated without a new user assignment once detection and processing can run.
- A user can explicitly request a source refresh.
- Known pending processing and refresh failures are distinguishable from successful completion.
- A known outdated representation is not presented as verified current content.
- A result with available metadata but an unreachable original indicates that the original cannot currently be opened; a failed opening is not reported as successful.

## Open questions

- What detection intervals, revision tokens and deletion evidence apply to each connector?
- How do devices coordinate preparation, synchronize removals and prevent stale work from republishing removed content?
- What checkpoint, cancellation and publication mechanism makes interruption safe?
