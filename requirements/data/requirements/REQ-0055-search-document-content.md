---
id: REQ-0055
type: requirement
title: Search document content across connected sources
status: approved
priority: must
area: Document management
goals: [GOAL-0001]
---

## Description

Delivery: the behavior below belongs to the later document-collection increment. The first [direct-source-access iteration](REQ-0054-connect-document-sources.md#first-iteration-direct-source-access-through-chat) exposes source capabilities through chat without implementing this collection feature. Approval and priority remain unchanged; references to initial behavior below describe the first delivery of this feature, not the direct-access iteration.

Users and the assistant must be able to find documents across the configured collection through full-text search initially, with semantic search deferred to a later delivery. Search supports exact textual identifiers without requiring the user to know a filename, source or folder; meaning-based descriptions belong to the later semantic-search delivery. The agreed collection is automatically prepared for search, including OCR where scans lack usable text, without per-document approval. Processing remains subject to the source scope, provider permissions and [privacy boundaries](../foundations.md#hosting-and-data-processing).

Search must not require all original files to be downloaded to the device performing the search. Obtaining content for initial preparation is distinct from downloading every original to every device. No index technology, server-side plaintext access or offline semantic model is prescribed. [Refresh and availability](REQ-0056-refresh-document-collection.md) govern incomplete preparation and inaccessible originals.

### Initial delivery: local extraction and full-text search

Semantic search remains an approved later capability, not part of initial delivery. There is initially no embedding model, vector index, embedding download or semantic-index synchronization.

Situate supplies reusable local extraction and OCR implementations for source plugins. PDF and image processing form the initial baseline. Broader formats depend on technical qualification rather than a blanket support promise. There is no product-level language allowlist; actual OCR language, script and scan-quality support must be verified. Existing source text may be reused when it corresponds to the current document revision.

Initial search covers title, filename and all successfully extracted text, case-insensitively. Multiple terms must all occur, possibly at different positions; quoted phrases require contiguous text. Textual identifiers remain findable. Search combines with tag filters. Automatic typo correction and meaning-based matching are deferred.

Prepared text and metadata may be stored durably and synchronized across the user's devices under existing encryption boundaries, without copying every original. Extraction and OCR remain local with no external fallback. Authorized remote LLM categorization is separate under [tag organization](REQ-0057-organize-documents-with-hierarchical-tags.md).

Collections must accommodate tens of thousands of documents. Documents become visible and searchable incrementally; local extraction and categorization expose separate states. Successful preparation is retained across pauses and restart rather than unnecessarily repeated. The assistant and document view search the same collection. The assistant can use prepared text with source and available page provenance, without additional rights to originals.

## Rationale

Finding information should not depend on remembering its storage location or manually reading scans. Collections must accommodate tens of thousands of documents; representative datasets and measured performance targets remain to be agreed.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

## Acceptance criteria

- Initial full-text search finds title, filename and OCR-text matches regardless of case, applies all query terms, supports quoted phrases and combines with tag filters.
- Searchable extracted text remains available when categorization is pending or failed.
- Prepared information is usable on another authorized device without downloading all originals; an unreachable original is not represented as available.
- Initial delivery performs extraction and OCR locally and does not require embeddings or an external extraction fallback.
- Qualification includes synthetic collections with tens of thousands of records and incremental, restartable preparation.
- Search and assistant access retain source provenance and page locations where extraction supplies them.
- A user can find a document by a textual identifier in its content even when its filename does not contain that identifier.
- In the later semantic-search delivery, a meaning-based query can retrieve a relevant document without an exact query-word match, evaluated against agreed representative cases.
- A scan without a text layer becomes searchable after successful OCR and preparation.
- All documents within the agreed processing scope are eligible for automatic preparation without individual approval; excluded content remains outside it.
- The same configured collection can be searched by the document view and the assistant.
- Searching prepared content does not require a complete download of all original files to the querying device.

## Open questions

- Which extraction library, format variants, OCR languages/scripts and scan qualities can be qualified on each supported platform?
- Which measured collection-size, latency, resource-use and full-text retrieval targets define release acceptance?
- What local storage and synchronization formats preserve portable prepared content and reconstructible indexes?
- Which semantic relevance cases and implementation approach apply to the later semantic-search delivery?
