---
id: REQ-0054
type: requirement
title: Connect document sources without mandatory migration
status: approved
priority: must
area: Document management
goals: [GOAL-0001]
---

## Description

Users must be able to connect multiple document sources to one workspace through reusable connectors under [integration development](REQ-0001-create-integrations.md). During development or setup, Situate and the user agree which source accounts and subsets belong to the collection, which operations are supported, and how documents are organized there. Local folders, Paperless and cloud drives are examples, not a mandatory prebuilt connector catalog.

Original files may remain in their sources, including shared repositories. Workflow plugins reuse connector access and source-specific working instructions. Within an authorized filing request, a workflow can store a document, such as an email attachment, and organize it according to the destination's agreed rules. The resulting document enters the configured collection and its search preparation. This does not require a universal file-management UI or authorize unrelated external writes. Instructions guide the agent but do not guarantee correct execution; unsupported operations and reported failures must not be represented as successful filing.

### First iteration: direct source access through chat

Deliver a plugin-defined source export convention with authoring guidance and conformance checks, using unchanged generic plugin registration and tool execution. Source implementations and consumers own domain validation; the core does not introduce a mandatory document-domain registration contract. The LLM creates concrete sources in situ; local-folder and Paperless implementations are qualification cases, not built-in connectors. Chat can invoke supported listing, source-native search, metadata/content reading and original access where available. Results identify their source and document, distinguish partial results from complete results and report unavailable or unsupported operations honestly.

Reuse source-provided search and existing OCR/text without a Situate index or mandatory local extraction. A folder source can support metadata/text access without PDF OCR. The source declares its capabilities and device limitations. No common collection, automatic preparation/categorization, background refresh, Situate tags, saved searches, preview/Library UI or prepared-content synchronization is required for this iteration. Existing plugin configuration, credentials and conversation persistence remain applicable; do not create a hidden full-source mirror.

### Later collection contract and identity

Collection qualification uses a local folder and Paperless contributing to the same collection through plugin-developed sources. It extends direct source access with persistent metadata, reusable processing and the Library UI. Contract-conformant synthetic sources support development but do not replace end-to-end verification. Originals remain in their sources. A device may admit a source only if it can access and locally prepare its supported content. Unsupported mobile-only sources are rejected with an explanation rather than silently transferred elsewhere. Per-document failures in an otherwise supported source remain visible and retryable.

Reliable source identity preserves document references and local tags across moves, renames and content revisions. Copies, including cross-source copies, remain separate documents even when their bytes match. An ambiguous identity is not guessed: a newly discovered document is processed separately and the old reference may become unavailable.

Source setup defines processing scope and initial categorization rules. It explicitly authorizes automatic transmission of extracted text to the user's configured, authorized model for categorization, including possible charges. New documents need no per-document approval. Progress is visible and processing can be paused; no fixed cost cap or universal price estimate is promised.

A source integration does not need to implement a universal original-write API. Agents retain existing filesystem and installed-tool access within the user's request and configured access, without per-action approval; the document feature neither grants new permissions nor artificially restricts those existing capabilities. Account/provider authorization, OS permissions and destructive content protections remain separate.

## Rationale

Users can keep suitable existing storage and organization while using documents in connected personal workflows.

## Source

Private document-access scope and lifecycle clarification; transcript not included. Decisions define initial delivery, not implemented or qualified behavior.

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

## Acceptance criteria

### Direct-access iteration

- Before merge, the LLM creates local-folder and Paperless sources through existing plugin development; checked/adopted sources are usable through normal-chat tools without manual registration of product connectors.
- The source contract declares scope, source/document identity, supported operations, provenance, result bounds/continuation, errors and lifecycle behavior; shared conformance checks can run during plugin development.
- Source-native search and existing text can be used without local indexing or OCR. A capability not implemented by a source is reported as unsupported, not as an empty successful result.
- Results retain source/document provenance and distinguish truncation, continuation, no matches, permission failures and temporary unavailability.
- Existing workspace authorization, credentials, disable/recovery and cancellation apply; direct-access tools do not require a new Library UI or automatic background preparation.

### Later collection delivery

- Moving a document with reliable source identity preserves its tags and references; an ambiguous move never silently retargets an existing reference.
- Plugin-developed local-folder and Paperless sources contribute to one collection without transferring originals into Situate-managed storage.
- The source contract defines capabilities, scope, identity/revisions, bounded discovery and completion evidence, optional prepared text, original retrieval, errors and lifecycle behavior. Shared conformance tests are usable during plugin development.
- Source setup rejects a device that cannot locally prepare the source, while supported sources expose individual processing failures.
- Source setup obtains categorization transmission and cost authorization once; automatic work is observable and pausable.
- Two configured sources contribute their agreed subsets to the same workspace collection without mandatory migration of originals.
- Setup establishes included and excluded subsets and source-specific filing rules with the user; documents outside that agreement are not automatically processed.
- Different workflow plugins can reuse the same connector under REQ-0001.
- An authorized filing workflow can save an attachment in a writable source, apply its agreed organization and make the stored document available for search preparation.
- Missing permissions, unsupported operations and reported filing failures are not presented as successful completion.

## Open questions

- What minimal descriptor/export convention and source result schemas extend the current plugin contract for direct access without introducing a second loader?
- Which source operations are available on each platform through existing HTTP, file and process capabilities? Local preparation qualification belongs to the later collection delivery.
- How are source-specific filing rules represented and tested, and ambiguous external filing requests handled?
