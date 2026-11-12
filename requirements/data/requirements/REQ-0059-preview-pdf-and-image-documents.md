---
id: REQ-0059
type: requirement
title: Read PDF and image documents inside Situate
status: approved
priority: should
area: Document management
goals: [GOAL-0001]
---

## Description

Delivery: the behavior below belongs to the later document-collection increment. The first [direct-source-access iteration](REQ-0054-connect-document-sources.md#first-iteration-direct-source-access-through-chat) exposes source capabilities through chat without implementing this collection feature. Approval and priority remain unchanged; references to initial behavior below describe the first delivery of this feature, not the direct-access iteration.

Users should be able to view PDF and image documents directly in Situate from the common document collection without launching another application. Other formats initially open in an appropriate external application. Previewing requires access to the original or an available local copy; metadata alone is not a preview.

This extends the external-opening baseline in [the initial file view](REQ-0023-browse-human-readable-note-structure.md) without adding non-Markdown editing.

### Device-local preview cache

Originals may be retrieved on demand into a bounded, device-local cache; derived thumbnails are also cache data. Neither is synchronized or versioned, and no offline-pinning or availability guarantee is provided. A cached copy may be shown during a temporary source outage with its known state identified. Confirmed deletion, removal from scope, explicit access revocation or permanent source removal clears affected cache entries under [retention rules](REQ-0056-refresh-document-collection.md).

## Rationale

Reading a retrieved document in place lets users inspect its contents without leaving their organizational context.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

## Acceptance criteria

- Preview and thumbnail caches are bounded and device-local, with no synchronization, version history or offline-pinning guarantee.
- A cached preview during a source outage is identified by its known state; confirmed removal clears the affected cache.
- A reachable supported PDF can be opened and its pages read inside Situate.
- A reachable supported image can be viewed inside Situate.
- Other formats can be handed to an appropriate external application; a missing handler or denied access is reported.
- An inaccessible original is not represented as successfully previewed.

## Open questions

- Which PDF features, image formats, file sizes and accessibility interactions are supported initially?
- What cache limits, eviction and safe preview rendering mechanisms apply on each platform?
