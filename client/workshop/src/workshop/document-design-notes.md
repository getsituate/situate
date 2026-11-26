# Document collection study

Status: Library selected for the later document-collection delivery. The first increment is direct source access through existing plugin development and chat, without this Library UI. The Vue scenarios use synthetic records and simulated outcomes. They do not connect accounts, read files, run OCR, perform semantic inference or open external applications. Document management remains separate from the workspace file editor.

## Review paths

Select **Documents** in the workshop's scenario browser. Change platform and size independently in the controls window; switching the environment preserves drafts.

| Task                   | Starting scenario                              | Walkthrough                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find one document      | `documents-find`                               | Search for `bicycle repair`, inspect the content excerpt, open the invoice, read its second page and return. Repeat with `VE-2048`, which is absent from the filename, and the typo `bicycel repair`. |
| Gather course receipts | `documents-gather`                             | With `course fee` in the search field, refresh Cloud drive and return to see the new receipt in the results.                                                                                          |
| Unavailable original   | `documents-unavailable`                        | Inspect the known source and details without a preview. Review the source; refreshing information does not make the computer-local original available on this device.                                 |
| Create a source        | `documents-connect` or `plugins-source-create` | Start in the plugin development chat. Send the request, fail or pass checks in the controls, and return to the Sources section in Plugins after adoption.                                             |

Other entry points show image reading, an empty collection, no matches, pending search, failed search, preparing or unavailable thumbnails and source refresh. Source and opening outcomes can be held, completed or failed in the controls. Reset restores the fixtures and cancels held work.

## Interaction choices

The search field and results use the full document pane when no preview is open. Wide panes show the results beside the document; narrower panes and phones show the document on its own. Closing it restores focus to the original result. The workspace navigation stays separate.

### Scrolling

`SituateScrollbars` is mounted once around the workshop application in `main.ts`. It covers the entire window, including nested scrolling areas, dialogs and teleported choices, without adding a layout wrapper or replacing native scrolling. Only a moving area's thumb becomes visible; it hides after 900 milliseconds without scrolling. A held pointer keeps that area's thumb visible, but does not extend visibility in other areas. Thumb visibility does not change the space reserved for it. Forced-color mode keeps native scrollbar colors. These browser behaviors still need physical-device and assistive-technology checks.

### Search

The collection opens with a search field and the document list. Enter a query to see matches. Clear search restores the full collection and returns focus to the search field. The result count, freshness and sort order sit below the search field.

The freshness link beside the result count opens Sources in Plugins. Search failures and unavailable originals have separate recovery actions.

### Sources in Plugins

Sources have their own section alongside Tools and Connections, using the same cards, settings, development chat and disable controls. Paperless and Home computer show access managed by the source; Cloud drive links to a reusable Cloud connection. A connection lists its consumers, including sources. Reuse is optional, not a prerequisite for creating a source.

`plugins-sources` and `plugins-sources-empty` expose the list states. `plugins-source-detail` shows the included and excluded scope, filing rules, preparation and refresh status. Scope is an example summary; Adapt plugin opens the development conversation rather than a universal configuration form. `plugins-source-disabled`, `plugins-source-create`, `plugins-source-error` and `plugins-source-success` expose disabled access and development outcomes directly.

The freshness link opens Sources in Plugins. An unavailable original links to its own source settings. The empty collection opens source development. Returning preserves document criteria, unsent text, preview and scroll position. Disabling a source leaves known documents in the collection but pauses refresh and original access; this simulation does not model cached originals. The shared disable dialog distinguishes finishing existing work from explicitly aborting it.

### Results and availability

- Preview tiles show the first PDF-like page or receipt when available. Pending, missing and failed thumbnails have explicit placeholders; they neither hide the document nor determine whether its original can be opened. Search excerpts appear only for an active query. Opening the reading pane changes the adjacent gallery into compact thumbnail rows.
- Sorting uses the workshop's shared select. See [shared choice fields](select-design-notes.md) for keyboard behavior and platform limits.
- Collection freshness and original availability are independent. Search does not include unprepared content, while browsing can expose known documents awaiting preparation. The source review distinguishes pending preparation from a failed refresh. A missing match is not proof of a complete search.
- Reading and source refresh can be pending independently. Interrupted opening is retryable, not left indefinitely loading. Cross-window document updates carry their originating workspace identity.

## Selected collection scope and simulation limits

This section describes the later collection increment. The first direct-access increment does not adopt these document screens, indexing or extraction; it uses existing plugin management/development and source-provided chat tools.

The workshop explores the collection with full-text search and previews. Semantic search and typo correction are deferred in the product, despite the broader simulated search below. Real results load in portions; browsing defaults to newest collection admission, while text search defaults to relevance with admission-time ordering available.

The requirements catalog and foundations govern the collection lifecycle, including workspace metadata, prepared text across devices, removal from active use and device-local preview caches. The workshop does not simulate persistence or model processing.

Collection access and previews are covered by REQ-0054–REQ-0056 and REQ-0058–REQ-0059. Source-specific lists, source and folder filters, and source structures under REQ-0061 are deferred pending evidence of user need. Source review opens Plugins for scope, refresh, preparation and errors. Document details retain source and original folder metadata. REQ-0062 remains deferred: no transfer into managed storage, remote exposure of local folders, offline-download control or file-provider guarantee is added.

Source development and adoption are simulated through the existing plugin chat. The product retains this flow: the LLM implements sources against the documented source contract, rather than selecting prepared local-folder or Paperless connectors. Plugin-development and executable tool paths now exist in the product. Direct-access delivery reuses them and must create and use both qualification sources through real development and normal chat before merge; simulated outcomes alone do not meet acceptance. Collection/UI adoption remains a later increment. These scenarios do not define a technical Source contract, a universal configuration schema, a provider catalog or an external-write approval protocol. Real authentication, processing destinations and provider-specific permissions need integration-specific design. The filing workflow itself is not simulated here.

Search combines deterministic text matching, a small vocabulary of related concepts and single-character spelling errors, including adjacent transpositions. Relevance ordering places literal phrases before concept matches and typo matches. Typo matching applies only to words of at least four letters, not identifiers or numbers. This simulates one search interaction; it does not establish semantic retrieval quality or a production ranking algorithm. The PDF-like pages are selectable HTML, not a PDF renderer; their thumbnails are SVGs generated from the same synthetic page text. The receipt is an original synthetic SVG. PDF accessibility, binary retrieval, real zoom rendering, pagination of large collections, indexing performance and source reconciliation are not established by these scenarios. Dates use fixed fixture formatting; no product localization behavior is changed.

Managed-storage conflicts remain outside this study. The broader semantic and typo-tolerant simulation is not an initial product acceptance requirement.

## Evaluation

Use the same task and content on desktop and phone:

1. “Find the document for a bicycle service. You remember the repair, but not its filename or where you put it.” Observe query formulation, choice of result, understanding of the source and the return path.
2. “Find the receipts for your professional course.” Observe how people search and interpret a new match after refresh.

For sources, ask the person to add an archive, change its included scope and investigate an incomplete refresh. Check whether they find those actions in Plugins and understand the difference between the source and its optional connection. Compare the return path from an empty collection with one from an open document.

For each search task, introduce an unavailable original or incomplete preparation. Ask what the person believes is missing and what can currently be opened. Check whether the freshness link is noticed without prompting the person to open Sources; its quieter presentation may need stronger emphasis if missed. The central untested assumption is that users can explain both the selection's meaning and the collection's limits. These are proposed tasks; no participants or research outcomes are claimed.

Use desktop and phone-sized browser previews to check search, empty-result recovery, preview return focus, source failure and retry, and draft preservation during keyboard occlusion. Simulated profiles do not verify native keyboards, assistive technology or file access.

Guidance consulted: UI Skills [Fixing accessibility](https://www.ui-skills.com/skills/ibelick/fixing-accessibility), [Distill](https://www.ui-skills.com/skills/pbakaus/distill), [Quieter](https://www.ui-skills.com/skills/pbakaus/quieter), [Better layout](https://www.ui-skills.com/skills/jakubkrehel/better-layout), [Better accessibility](https://www.ui-skills.com/skills/jakubkrehel/better-accessibility) and [Mobile native](https://www.ui-skills.com/skills/emilkowalski/mobile-native), alongside the canonical Situate brand handbook. Inspo's document-navigation search returned documentation/marketing pages rather than useful document-management application references; none was adopted. No third-party code, screenshot, font or artwork is included.
