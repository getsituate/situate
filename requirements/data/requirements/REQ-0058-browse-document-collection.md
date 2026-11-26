---
id: REQ-0058
type: requirement
title: Browse and search the common document collection
status: approved
priority: must
area: Document management
goals: [GOAL-0001]
---

## Description

Delivery: the behavior below belongs to the later document-collection increment. The first [direct-source-access iteration](REQ-0054-connect-document-sources.md#first-iteration-direct-source-access-through-chat) exposes source capabilities through chat without implementing this collection feature. Approval and priority remain unchanged; references to initial behavior below describe the first delivery of this feature, not the direct-access iteration.

Situate must provide a built-in document view for the configured collection, independent of specialized plugin views. Users can browse and search without chat, inspect results and identify a document's source. They need not select a connector before searching.

The document list and [content search](REQ-0055-search-document-content.md) provide access across sources. A universal folder tree is not required. [Internal previews](REQ-0059-preview-pdf-and-image-documents.md), [saved searches](REQ-0060-save-document-searches.md) and [source structures](REQ-0061-browse-document-source-structures.md) are separate should-have capabilities. Source-specific document lists, source and folder filters, and source structures are [deferred from initial delivery](../foundations.md#deferred-document-source-navigation); connection management and source identification remain in scope.

### Library access before persistent preparation

The first Library release uses a versioned profile on document source plugins to list, search and retrieve originals from connected sources on demand. Filename search is the minimum; a source can also supply its existing text search. PDF and supported image previews are available in the Library. Results identify their source and distinguish incomplete retrieval from a complete search with no matches.

Use the Library layout below. Saved searches and sort options that are not supported remain visible and inactive with an availability hint. Persistent preparation, index-based search and saved searches belong to the later collection delivery described below. Existing direct-access plugins and chat tools continue to work without the Library profile.

### Prepared collection presentation and metadata

The Library design is selected: persistent saved-search navigation on large surfaces, compact navigation and separate reading on phones. Preview and saved-search capabilities are included in this delivery without changing their catalog priorities.

Without search text, order by collection admission time, newest first. With search text, default to full-text relevance and allow admission-time ordering. Load results in portions rather than rendering the entire collection. Returning from a document preserves the query and list position. Text searches show matching excerpts.

Core metadata comprises source identity, original reference and available path; filename, format, size and source timestamps; last successful preparation, freshness, original availability and errors; and extracted text with page provenance where available. Arbitrary domain extraction fields such as invoice totals are deferred.

## Rationale

Users need direct access and orientation without depending on the assistant or understanding which provider holds each document.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

Private document-navigation scope clarification; date not recorded, transcript not included. Initial navigation excludes per-connection document lists and source or folder filters pending evidence of user need.

## Acceptance criteria

- Library navigation remains persistent on large screens and accessible through compact navigation on phones.
- Browsing orders by admission time; text search defaults to relevance with admission-time ordering available.
- Results load incrementally and returning from reading restores criteria and list position.
- Results expose source provenance, availability and text excerpts without implying complete processing.
- Valid external edits to authoritative workspace document records and saved searches appear in the collection; invalid edits are reported and preserved rather than silently overwritten.
- Search indexes can be rebuilt from authoritative records and prepared content; document metadata remains openly readable without the index.
- Users can browse and search the configured collection without opening a chat or choosing a source first.
- Results identify their source and allow access to the original when reachable; unavailable originals follow REQ-0056.
- The common view is supplied by Situate rather than requiring development of a custom view plugin.

## Open questions

- Which batch sizes and ranking strategy meet measured large-collection targets?
- Which native accessibility and mobile behaviors require platform-specific qualification?
