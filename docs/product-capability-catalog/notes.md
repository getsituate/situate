# Notes

Documentation date: **9 November 2026**.

Develop, find and revise **internal text notes on macOS** through conversation. These entries cover the main application; [sources and platform evidence](#evidence-and-open-questions) are recorded below.

## Shared prerequisites and platform scope

- **Access:** working model access and supplied text or readable workspace files are required. Saving or organizing notes also needs writable storage.
- **Coverage:** Situate can search and read in several steps. Collection-wide conclusions need a defined scope and current sources; successive reads are not a frozen snapshot.
- **iOS:** the full macOS note workflow is not established. Integrated dictation and the macOS shell route are unavailable; shared folder operations remain available with writable storage.
- **External originals:** access to original Apple Notes is **Unclear**. Imported copies can be used locally, but their edits do not update originals, and later original changes do not update the copies.

The [shared conditions and model-quality boundaries](README.md#shared-prerequisites-and-boundaries) apply. Dialogue and candidate selection are part of the workflow.

## Capabilities

### N01 — Develop thoughts

Benefit: Develop free-form thoughts into a clearly worded, structured Markdown note. Review the draft in chat and save it as a workspace note when requested.

- **Support:** Supported.
- **Prerequisites and limits:** Supply the thoughts as text or use optional dictation on an Apple Silicon Mac. Dictation needs speech resources and microphone permission; the user reviews and submits its draft before model processing. Saving requires a successful file write. Recognition accuracy and faithful rewriting are [evidence questions](#material-evidence-gaps).
- **Evidence:** Code analysis — R1, N01 and E1/E3/E4/E6; [conversation processing][conversation], [note writes][writes] and [dictation draft insertion][dictation].

### N02 — Place content appropriately

Benefit: Find an appropriate note and passage for a new thought, clarify the destination when needed, and insert the content there. The result is an updated note, not just a filing suggestion.

- **Support:** Supported.
- **Prerequisites and limits:** Situate can search and read candidate notes, propose a destination and ask the user to resolve an ambiguity before editing. A known topic or folder can help narrow the search; the user need not identify the exact note at the outset. Readable workspace notes and write access are required. This concerns adding content, not restructuring the collection.
- **Evidence:** Code analysis establishes candidate discovery, reading and version-checked editing — R1, N02 and E1–E3. [Workflow evidence](#dialogue-and-retrieval-evidence) covers the main application; [UR1](#prototype-user-report) is separate prototype experience, not a main-application placement test.

### N03 — Retrieve content

Benefit: Find relevant notes and passages from a description or remembered context, even without the title or exact wording. Receive identifiable sources and refine an initial selection together with Situate.

- **Support:** Supported.
- **Prerequisites and limits:** Situate can try related search terms, inspect folders, read candidates and ask clarifying questions. Built-in search matches literal text and is case-sensitive; varying terms and reading candidates are therefore important. Finding the requested information does not require proving that every related passage in the collection was found. A request for an exhaustive inventory has the separate [coverage limits](#shared-prerequisites-and-platform-scope).
- **Evidence:** Code analysis establishes the successive search/read/conversation path — R1, N03 and E1/E2; [workflow evidence](#dialogue-and-retrieval-evidence). [UR1](#prototype-user-report) describes prototype retrieval experience only; main-application retrieval quality has not been practically measured.

### N04 — Answer questions about notes

Benefit: Use information from one or several notes to answer a question and make the supporting passages identifiable.

- **Support:** Supported.
- **Prerequisites and limits:** The agent can read selected or discovered notes and answer with filenames, quotations and available search-result line numbers. Input references can be reopened, but they do not automatically prove which source supports each answer claim. Citation accuracy is not automatically verified, and answers about the entire collection inherit the coverage limits above.
- **Evidence:** Code analysis — R1, N04 and E1/E2/E5; [conversation processing][conversation], [source text and search results][discovery] and [current/historical file references][references].

### N05 — Condense content

Benefit: Condense notes into a summary or key points in chat, or save a shorter version as a separate note.

- **Support:** Supported.
- **Prerequisites and limits:** Supply or select the notes to summarize. Long notes may need successive reads; a summary of several notes depends on obtaining the relevant sources. Saving a separate note requires write access.
- **Evidence:** Code analysis establishes reading, summarizing and saving — R1, N05 and E1–E3. [Summary and editing evidence](#summary-and-editing-evidence).

### N06 — Compare and combine

Benefit: Identify similarities, differences and apparent contradictions, and combine information from several notes.

- **Support:** Supported.
- **Prerequisites and limits:** The agent can read selected notes, compare their content and save a combined draft. Differences may reflect changed information or different contexts rather than contradictions; available dates and history can help distinguish them. This supports comparison and consolidation of obtained sources, not an exhaustive contradiction scan of an unspecified collection.
- **Evidence:** Code analysis — R1, N06 and E1–E3/E5; [reading and history tools][tools], [source references][references] and [writing combined content][writes].

### N07 — Identify patterns and connections

Benefit: Examine recurring themes, developments and relationships across notes, with source passages supporting each interpretation.

- **Support:** Supported.
- **Prerequisites and limits:** Situate can obtain several relevant notes, discuss their scope and propose evidence-linked interpretations. Distinguish observations from inferred patterns, and account for dates and possible counterexamples. A pattern found in the inspected notes is not a verified trend across an unexamined collection.
- **Evidence:** Code analysis establishes reading multiple notes, retaining their context and identifying supporting passages — R1, N07 and E1/E2/E5; [workflow evidence](#dialogue-and-retrieval-evidence). Pattern and counterexample quality remain unmeasured in a practical main-application workflow.

### N08 — Transform content

Benefit: Turn supplied or retrieved knowledge into a draft, outline, checklist or Markdown table. Use the result in chat or save it as a workspace file.

- **Support:** Supported.
- **Prerequisites and limits:** Obtained source text can become a draft, outline, checklist or Markdown table and be saved. This path does not establish finished slide decks, image-based diagrams or arbitrary rich-format exports. A linked attachment is not automatically understood merely because its link appears in a note.
- **Evidence:** Code analysis — R1, N08 and E1–E3/E6; [conversation processing][conversation], [Markdown rendering][markdown], [supported attachments][attachments] and [file creation][writes].

### N09 — Continue and revise notes

Benefit: Extend notes, revise passages and save updated information without rewriting the whole note manually. Saved changes retain file history.

- **Support:** Supported.
- **Prerequisites and limits:** Situate reads the saved note before changing it. A newer version or an active editor draft can block an overwrite and require reconsidering the edit. Very large notes exceed the [write limit](#summary-and-editing-evidence).
- **Evidence:** Code analysis and four recorded write/history checks establish the editing and storage path — R1, N09 and E3/E7. [Source details](#summary-and-editing-evidence).

### N10 — Organize the collection

Benefit: Name and group notes and develop their folder structure as the collection changes.

- **Support:** Supported.
- **Prerequisites and limits:** The connected file interface can create folders and move or rename notes. On macOS, chat can also organize files through its shell tool; note headings use ordinary text edits. Shell access and safeguards differ from core file edits. Dedicated built-in chat tools for rename, move and folder creation are not established, so this chat route is not an iOS promise. The quality of model-selected names and groupings remains unmeasured.
- **Evidence:** Code analysis — R1, N10 and E2/E3/E6/E7; [file-interface actions][organization], [shell capability gate][shell] and [available chat tools][tools].

## Evidence and open questions

### Source and report provenance

Source revision: `27b6831c3e55b2de4a59d6cd32cf1935d373338d` on `use-case-validation` (5 November 2026).

**R1 — [Note capabilities: repository fact-check](../note-capabilities-fact-check.md)** assesses that revision. Its report and execution dates are not recorded. Its SHA-256 is `a8104d667020f7a0022160030174eaef0f7ad555065166f5acafb72e849e2f20`. Capability sections, evidence groups E1–E8 and **Checks actually executed** contain the detailed findings and recorded results.

### Dialogue and retrieval evidence

R1 documents directory inspection, filename/text search, reading and conversation context in E1/E2, version-checked edits in E3 and inspectable source references in E5. These mechanisms support proposing candidate notes, refining the selection with the user, reading the chosen passages and applying an edit. They also support comparing several obtained notes and explaining possible patterns. The substantial search, interpretation and editing work is performed through Situate's connected tools, not delegated entirely back to the user.

The support assessments for N02, N03 and N07 concern these workflows. They do not depend on a one-step placement guarantee or exhaustive collection discovery. As with [E03](email.md#e03--find-information-in-the-email-collection), successive queries and reads can establish a useful result. Unlike Gmail retrieval, this route uses local literal searches and accessible text files, not account-backed message operations. Relevant sources: [tool definitions][tools], [search and reading][discovery], [conversation processing][conversation], [editing][writes], [references][references] and [bounded context][context].

### Summary and editing evidence

For N05, R1 N05/E1–E3 and the [conversation][conversation], [reading][discovery] and [writing][writes] paths establish a summary returned in chat or saved separately. Preservation of important statements has not been evaluated with a live model.

For N09, [exact editing and version-checked writes][writes] require each text match to be unique. [Native write handling][native-writes] and the content store reject stale versions and conflicting editor drafts. Agent text writes are limited to 1 MiB per file. The four component checks recorded by R1 cover write/history behavior; these storage protections do not validate the factual correctness of revised text. Model-quality boundaries are shared across the catalog.

### Platform and source evidence

R1 identifies shared iOS text-processing and file-interface foundations, but contains no native iOS note journey. Shared folder operations do not establish the macOS chat-driven restructuring route on iOS. Integrated dictation and the inspected shell/process route are unavailable there at the source revision.

For original Apple Notes, generic macOS process execution and workshop examples do not establish a working integration. Internal-note ratings concern accessible text and imported copies, not verified access or write-back to those originals.

### Prototype user report

**UR1 — User report, 9 November 2026:** a user reports repeated success placing content and finding requested details in a large note collection during prototype use. The described workflow often began with a vague question, followed by candidate suggestions and refinement. This is a non-identifying summary, not a controlled test or an executed check by the catalog author. It supports the usefulness of the collaborative workflow; it does not establish the main application's connector access, retrieval quality or performance.

### Recorded component checks

R1 records synthetic or temporary-file checks, not personal-note workflows:

| Reported check                                                                                                                  | Recorded result                | Evidence boundary                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Five Vitest files covering dictation draft handling, chat, native-conversation adapters, content references and the file editor | 144 passed                     | UI/component behavior with simulated native/file responses; not recognition accuracy or live-model quality. |
| Core `content::agent_tools::tests`                                                                                              | 4 passed                       | Temporary-file writes, history, exact matching, stale/draft protections and failure handling.               |
| Core `content::import_batch::tests`                                                                                             | 16 passed; 1 benchmark ignored | Prepared-copy publication and preservation; not extraction from Apple Notes or synchronization.             |
| Core `content::live_references::tests`                                                                                          | 8 passed                       | Current/historical references, moves and deleted/reused paths in temporary storage.                         |

R1 contains no executed literal-search or native chat/import journey. Its recorded component results do not establish live-model retrieval or placement quality.

### Material evidence gaps

- Live-model fidelity, destination selection, paraphrased retrieval, citation accuracy, comparisons and pattern/counterexample quality remain unmeasured. Small successful storage checks do not establish whole-collection reasoning quality.
- The dictation-to-saved-note workflow has no recorded real-microphone/model demonstration. Native iOS note-workflow parity is not established by this evidence set.
- Original Apple Notes access, permissions, rich-content preservation and round trips remain separately unqualified. These gaps do not negate processing of accessible workspace copies.

[conversation]: ../../client/app/src/ai/chat.ts#L874-L940
[tools]: ../../client/app/src-tauri/src/ai_builtin_tools.rs#L9-L119
[discovery]: ../../client/app/src-tauri/src/file_tool.rs#L215-L307
[writes]: ../../client/crates/situate-core/src/content/agent_tools.rs#L10-L77
[native-writes]: ../../client/app/src-tauri/src/files.rs#L1430-L1500
[dictation]: ../../client/app/src/dictation/draft.ts#L14-L49
[references]: ../../client/crates/situate-core/src/content/live_references.rs#L38-L144
[context]: ../../client/crates/situate-agent/src/compaction.rs#L108-L150
[markdown]: ../../client/crates/situate-core/src/rendering.rs#L6-L88
[attachments]: ../../client/app/src/ai/attachment-runtime.ts#L9-L38
[organization]: ../../client/app/src/files/FileEditor.vue#L918-L1024
[shell]: ../../client/app/src-tauri/src/shell_host.rs#L32-L57
