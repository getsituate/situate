# Document collection study

Status: Library selected for the later document-collection delivery. The first increment is direct source access through existing plugin development and chat, without this Library UI. Search remains an alternative study, not a second initial layout. The Vue scenarios use synthetic records and simulated outcomes. They do not connect accounts, read files, run OCR, perform semantic inference or open external applications. Document management remains separate from the workspace file editor.

## Review paths

Select **Documents** in the workshop's scenario browser. Both tasks use **Navigation approach** to compare Library and Search without a separate starting state for each layout. Change platform and size independently in the controls window; switching the environment preserves drafts.

| Task                           | Starting scenario                              | Walkthrough                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find one document              | `documents-find`                               | Search for `bicycle repair`, inspect the content excerpt, open the invoice, read its second page and return. Repeat with `VE-2048`, which is absent from the filename, and the typo `bicycel repair`. |
| Gather documents               | `documents-gather`                             | Inspect Tax and 2025 with All selected tags. Save a pinned search, refresh Cloud drive and reopen the search: a newly matching document joins the selection.                                          |
| Build a selection from scratch | `documents-find`                               | Add Tax and 2025 directly above the results. Compare Any selected tag with All selected tags, remove one tag, then remove the last.                                                                   |
| Unavailable original           | `documents-unavailable`                        | Inspect the known source and tags without a preview. Review the source; refreshing information does not make the computer-local original available on this device.                                    |
| Create a source                | `documents-connect` or `plugins-source-create` | Start in the plugin development chat. Send the request, fail or pass checks in the controls, and return to the Sources section in Plugins after adoption.                                             |

`documents-new-tag` opens workspace tag creation; `documents-new-document-tag` starts inside document tag editing. `documents-tag-duplicate` shows name validation, and `documents-no-tags` starts with an empty tag list. `documents-delete-tag` and `documents-delete-branch` compare deletion choices; `documents-tag-delete-conflict` shows a promotion conflict. `documents-tag-removed` shows a saved search after its final tag condition has been removed. The older `documents-missing-tag` and `documents-repair-view` links open that collection state.

Other entry points show image reading, an empty collection, no matches, pending search, failed search, preparing or unavailable thumbnails and source refresh. Source and opening outcomes can be held, completed or failed in the controls. Reset restores the fixtures and cancels held work.

## Interaction choices

### A. Library

A document-local navigation column exposes tags and saved searches alongside the results on larger screens. The workspace navigation remains outside it. Opening a document adds an adjacent reading pane when there is enough room; narrower windows and phones show the document on its own, with a return action that restores the result focus.

This is the selected starting point for regular document work: people can discover their organization without first inventing a query. Its cost is competing navigation columns and less room for the document. This is an expert judgment, not a user-tested finding.

### B. Search

Search and the current selection lead a wider results area. Tags and saved searches are available through Browse instead of occupying a permanent column. Both activities remain possible; this is not a chat-only or search-only capability set. Its cost is the additional navigation step when assembling a selection.

Both approaches converge on the same phone layout: search, tag selection, a two-column preview gallery and a separate reading view. Very narrow screens use single-column rows with thumbnails. The comparison on desktop concerns persistent versus on-demand navigation, not different colors. The mobile flow is not a scaled-down three-column desktop view.

### Sidebar size and scrolling

The tag column starts at 272 pixels and can be resized between 224 and 480 pixels, with a lower upper limit when needed to preserve space for results and reading. Drag the divider or focus it and use the arrow keys; Shift uses larger steps, Home and End select the limits, and Enter or a double-click resets the width. Escape cancels a drag. The preferred width belongs to the simulated workspace and survives temporary layout constraints; resetting the scenario restores its default. Browse replaces the column on smaller surfaces, including recovery of focus from a hidden column.

`SituateResizeHandle` in `ui/` provides the shared separator interaction for vertical or horizontal boundaries. Its model updates while dragging; `change` commits a changed size on release or a keyboard adjustment. The document view owns available-space limits and the saved preference.

`SituateScrollbars` is mounted once around the workshop application in `main.ts`. It covers the entire window, including nested scrolling areas, dialogs and teleported choices, without adding a layout wrapper or replacing native scrolling. Only a moving area's thumb becomes visible; it hides after 900 milliseconds without scrolling. A held pointer keeps that area's thumb visible, but does not extend visibility in other areas. Thumb visibility does not change the space reserved for it. Forced-color mode keeps native scrollbar colors. These browser behaviors still need physical-device and assistive-technology checks.

### Collection header

The Documents header has a three-dot actions menu containing Sources, without a connection count. Source management in Plugins is secondary to finding documents; the freshness link remains a direct route when the collection is incomplete.

One search field accepts textual identifiers, descriptions and spelling errors without a mode choice. The selection toolbar below contains tag criteria, the tag matching choice, Clear and Save search. Selected tags and Without tags use removable chips. Only a named saved search adds a heading above the result summary, which contains the count, freshness and sort order. Browse remains available beside the query when the tag sidebar is hidden. Selection controls wrap without hiding active criteria.

Only the search field and selected tags carry strong enclosing shapes. Toolbar choices use the shared select's quiet appearance, with the same 48-pixel targets and open-list behavior as form fields. The freshness link beside the count opens the Sources section in Plugins; a full-width warning surface is not used for this persistent collection-level condition. Search failures and unavailable originals retain their own explanations.

### Sources in Plugins

Sources have their own section alongside Tools and Connections, using the same cards, settings, development chat and disable controls. Paperless and Home computer show access managed by the source; Cloud drive links to a reusable Cloud connection. A connection lists its consumers, including sources. Reuse is optional, not a prerequisite for creating a source.

`plugins-sources` and `plugins-sources-empty` expose the list states. `plugins-source-detail` shows the included and excluded scope, filing rules, preparation and refresh status. Scope is an example summary; Adapt plugin opens the development conversation rather than a universal configuration form. `plugins-source-disabled`, `plugins-source-create`, `plugins-source-error` and `plugins-source-success` expose disabled access and development outcomes directly.

Sources in the Documents menu and the freshness link lead to that section. An unavailable original links to its own source settings. The empty collection opens source development. Returning preserves document criteria, unsent text, preview and scroll position. Disabling a source leaves known documents and tags in the collection but pauses refresh and original access; this simulation does not model cached originals. The shared disable dialog distinguishes finishing existing work from explicitly aborting it.

### Tag creation

The plus beside Tags creates a workspace tag without changing the current search or filter. New tag in document tag editing uses the same name and optional parent fields, then selects the new tag in the document's draft. Apply tags commits that assignment. Cancelling creation preserves the previous selection; cancelling document tag editing after creation leaves the tag in the workspace but does not assign it.

Names are trimmed and compared case-insensitively within the same parent. The same name can appear under different parents. Parentage is stored separately from the name, and new descendants participate in parent filtering. Validation retains the draft and returns focus to the affected field. Creation is immediate in this local simulation, not a background operation. Renaming and general reparenting are not available in the simulation. Product delivery includes identity-preserving renaming; general reparenting remains deferred.

### Tag deletion and saved searches

Each tag has a visible actions button in navigation, including the mobile Browse dialog. Deletion first shows the tag, affected assignments and subtags. Direct children move to the deleted tag's parent by default; deeper relationships and surviving assignments remain intact. An unchecked option includes the whole branch. The document count measures records losing assignments, not documents merely found through descendant matching. Document files and source metadata remain unchanged.

The confirmation initially focuses the close button. Closing it or pressing Escape preserves data; after deletion, focus moves to a surviving tag action or the creation button. A promotion that would duplicate a sibling name is blocked without merging or renaming. This blocking behavior is also the selected initial product policy; users resolve the collision before deletion.

Confirmed deletion removes conditions for the deleted tags from every saved search and the current selection, without a repair dialog. Queries, surviving tag conditions, names, pinning and unsubmitted search text remain unchanged. The any-of/all-of choice remains while tags remain. Removing the final tag condition leaves no tag restriction; without other criteria, the saved search includes the agreed collection. Surviving children are not substituted for a deleted parent condition. Creating a same-named tag does not restore a removed condition.

Deletion applies equally to local and source-derived tags. It does not suppress recreation or change the responsible plugin or connection. Those integrations are not executed in these scenarios. There is no simulated persistence failure or undo promise; reset restores the fixtures.

### Selection and availability

- Tag filters are a flat selection above the results. Add tags through the shared choice field and remove them through visible chips. Changes apply immediately, without a dialog, grouping, exclusions or a query language. Parent tags include descendants.
- Any-of is the default; a visible matching choice switches the entire selection to all-of without losing tags. With one tag, both modes match the same documents. Removing the last tag removes the tag restriction; clearing search and filters resets the matching choice to any-of. The default is a product decision, not a finding about user preferences.
- Tag navigation starts a fresh single-tag selection in the same inline controls, rather than adding a hidden second constraint. Without tags clears selected tags; adding a tag leaves that view. Content search remains independent of tag selection. Unsubmitted content-search text survives tag changes.
- Preview tiles show the first PDF-like page or receipt when available. Pending, missing and failed thumbnails have explicit placeholders; they neither hide the document nor determine whether its original can be opened. Search excerpts appear only for an active query. Opening the reading pane changes the adjacent gallery into compact thumbnail rows.
- Tag selection, matching mode and sorting reuse the workshop's shared SituateSelect. Choices open as an anchored list on desktop or a bottom sheet on mobile, with 48-pixel targets. See [shared choice fields](select-design-notes.md) for keyboard behavior and platform limits.
- Documents without tags remain accessible through browsing and content search. Clearing Without tags preserves submitted and unsubmitted search text.
- Saved searches contain the current query, selected tags and any-of/all-of choice, not copies or fixed membership. Pinned searches have a separate quick-access section; other saved searches remain available below it. Saving submits an unsubmitted search draft so the stored query matches the visible input.
- Local tag changes do not change source metadata. The example's original metadata remains readable in Details. Product categorization assigns tags once on initial ingestion, not on each refresh. Later content changes refresh search data without reapplying tag rules; creating a local tag does not imply write-back support.
- Collection freshness and original availability are independent. Search does not include unprepared content, while browsing can expose known documents awaiting preparation. The source review distinguishes pending preparation from a failed refresh. A missing match is not proof of a complete search.
- Reading and source refresh can be pending independently. Interrupted opening is retryable, not left indefinitely loading. Cross-window document updates carry their originating workspace identity.

## Selected collection scope and simulation limits

This section describes the later collection increment. The first direct-access increment does not adopt these document screens, indexing, extraction, tags or saved searches; it uses existing plugin management/development and source-provided chat tools.

Initial delivery includes local extraction/OCR, full-text search, LLM-based initial tag assignment, previews and saved searches. Semantic search and typo correction are deferred, despite the broader simulated search below. Library is the selected desktop arrangement. Real results load in portions; browsing defaults to newest collection admission, while text search defaults to relevance with admission-time ordering available.

The authoritative lifecycle rules are in REQ-0054–REQ-0060 and the foundations. They include openly editable workspace metadata, retained prepared text across devices, removal from active use after confirmed source removal, bounded device-local preview caches, manual tag renaming and explicit editing/deletion/unpinning of saved searches. Pinned and other saved searches are each alphabetically ordered. These decisions do not imply that the workshop simulates persistence, model processing or all management actions.

The basis is REQ-0054–REQ-0058, with previews and saved searches in REQ-0059–REQ-0060. Source-specific lists, source and folder filters, and source structures under REQ-0061 are deferred pending evidence of user need. Sources in the collection's actions menu opens Plugins: scope, refresh, preparation and errors, not per-source document lists. Document details retain source and original folder metadata. REQ-0062 remains deferred: no transfer into managed storage, remote exposure of local folders, offline-download control or file-provider guarantee is added.

Source development and adoption are simulated through the existing plugin chat. The product retains this flow: the LLM implements sources against the documented source contract, rather than selecting prepared local-folder or Paperless connectors. Plugin-development and executable tool paths now exist in the product. Direct-access delivery reuses them and must create and use both qualification sources through real development and normal chat before merge; simulated outcomes alone do not meet acceptance. Collection/UI adoption remains a later increment. These scenarios do not define a technical Source contract, a universal configuration schema, a provider catalog or an external-write approval protocol. Real authentication, processing destinations and provider-specific permissions need integration-specific design. The filing workflow itself is not simulated here.

Search combines deterministic text matching, a small vocabulary of related concepts and single-character spelling errors, including adjacent transpositions. Relevance ordering places literal phrases before concept matches and typo matches. Typo matching applies only to words of at least four letters, not identifiers or numbers. This simulates one search interaction; it does not establish semantic retrieval quality or a production ranking algorithm. The PDF-like pages are selectable HTML, not a PDF renderer; their thumbnails are SVGs generated from the same synthetic page text. The receipt is an original synthetic SVG. PDF accessibility, binary retrieval, real zoom rendering, pagination of large collections, indexing performance and source reconciliation are not established by these scenarios. Dates use fixed fixture formatting; no product localization behavior is changed.

Tag renaming and saved-search management beyond the simulated actions require product integration. General reparenting, merging, external tag write-back and managed-storage conflicts remain outside this study. The broader semantic and typo-tolerant simulation is not an initial product acceptance requirement.

## Evaluation

Use the same task and content on desktop and phone:

1. “Find the document for a bicycle service. You remember the repair, but not its filename or where you put it.” Observe query formulation, choice of result, understanding of the source and the return path.
2. “Find documents tagged both Tax and 2025, then make the selection easy to revisit.” Observe the matching choice, incorrect inclusions, saving and understanding of new matches after refresh.

For the second task, ask whether a tax agreement without the 2025 tag is included in each matching mode. Then ask the person to include documents with either tag. The hypothesis is that one visible matching choice makes the selection predictable without a query editor; task completion alone would not establish comprehension. A Personal only tag has no implicit exclusion effect.

For tag creation, ask the person to add a child tag to a document, then repeat and cancel document tag editing after creating another tag. Check whether they distinguish creating a workspace tag from saving a document's assignments.

For deletion, ask the person to remove Home while keeping Repairs, then revisit Home & repairs. Check whether they anticipate which assignments survive and understand why the saved search can return more documents after its final tag condition is removed. Compare deletion with a query still restricting the results and with no other criteria. No deletion-flow participant testing has been conducted.

For sources, ask the person to add an archive, change its included scope and investigate an incomplete refresh. Check whether they find those actions in Plugins and understand the difference between the source and its optional connection. Compare the return path from an empty collection with one from an open document.

For each search task, introduce an unavailable original or incomplete preparation. Ask what the person believes is missing and what can currently be opened. Check whether the freshness link is noticed without prompting the person to open Sources; its quieter presentation may need stronger emphasis if missed. The central untested assumption is that users can explain both the selection's meaning and the collection's limits. These are proposed tasks; no participants or research outcomes are claimed.

Browser verification covers Chromium and WebKit, desktop and phone-sized layouts, tag creation from navigation and document editing, duplicate and empty-name validation, cancellation, parent selection, parent and branch deletion, promotion conflicts, automatic saved-search updates after deletion, focus recovery after deletion, inline tag selection, any-of/all-of changes, empty-result recovery, keyboard focus after removal, preview return focus, dynamic saved searches, source failure/retry, resets and keyboard-occlusion draft preservation. The native macOS workshop can host the same views, but simulated iOS/Android profiles do not verify native mobile keyboards, screen readers, file access or background execution. Windows/Linux decoration, physical-device touch, VoiceOver/TalkBack and PDF assistive-technology behavior need their respective runtimes.

Guidance consulted: UI Skills [Fixing accessibility](https://www.ui-skills.com/skills/ibelick/fixing-accessibility), [Distill](https://www.ui-skills.com/skills/pbakaus/distill), [Quieter](https://www.ui-skills.com/skills/pbakaus/quieter), [Better layout](https://www.ui-skills.com/skills/jakubkrehel/better-layout), [Better accessibility](https://www.ui-skills.com/skills/jakubkrehel/better-accessibility) and [Mobile native](https://www.ui-skills.com/skills/emilkowalski/mobile-native), alongside the canonical Situate brand handbook. Inspo's document-navigation search returned documentation/marketing pages rather than useful document-management application references; none was adopted. No third-party code, screenshot, font or artwork is included.
