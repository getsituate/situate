# Situate — Product Capability Catalog

Documentation date: **9 November 2026**.

Use Situate to turn information into notes, task updates, email drafts, calendar actions and reusable tools. This catalog describes the results you can work toward with Situate, the conditions for each capability and the evidence behind its support status.

> **Generated reading edition.** Source: [catalog overview](README.md) and [Notes](notes.md), [Task management](task-management.md), [Email](email.md), [Calendar](calendar.md), [Documents](documents.md), [Plugins](plugins.md). [Generation and maintenance](working-framework.md#reading-edition-generation).

## Functional areas

| Area                                | What you can do and use afterward                                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Notes](#notes)                     | Develop thoughts, find information and revise or combine notes. Keep the result in chat or save usable text in workspace files.                       |
| [Task management](#task-management) | Capture and update tasks, organize work and discuss priorities or blockers. Get a reasoned overview or saved changes to task files.                   |
| [Email](#email)                     | Understand correspondence, find messages, save drafts, organize mail and send requested messages through the assumed working Gmail connection.        |
| [Calendar](#calendar)               | Find suitable times, check conflicts and create or change events through the assumed working Google Calendar connection.                              |
| [Documents](#documents)             | **Not supported today; tentative future target.** The desired results include understanding, creating, revising and organizing documents.             |
| [Plugins](#plugins)                 | Develop callable tools, service connections, individual views and working-method guidance. Each extension has its own access and platform conditions. |

## How to read the entries

Start with a capability's **Benefit**, then its **Support**, **Prerequisites and limits**, and **Evidence**. A proposal in chat, a saved file and an action in an external account are different results; the entry says which one is covered.

Normal work includes questions, suggestions, choosing between alternatives and several search, reading or editing steps. **Supported** does not mean one instruction must succeed without further input. Support and the strength of the evidence are separate: an executable path can be established by code analysis without a live-model trial.

The [shared prerequisites](#shared-prerequisites-and-boundaries), [email/calendar connector scope](#email-and-calendar-connector-scope) and [status legend](#status-and-evidence-legend) apply alongside each area's conditions. Use the [named capability index](#area-and-identifier-index) to find a specific entry. Its **44 descriptions** include unsupported targets; this is not a count of available product functions.

## Contents

- [Functional areas](#functional-areas)
- [How to read the entries](#how-to-read-the-entries)
- [Notes](#notes)
- [Task management](#task-management)
- [Email](#email)
- [Calendar](#calendar)
- [Documents](#documents)
- [Plugins](#plugins)
- [Shared prerequisites and boundaries](#shared-prerequisites-and-boundaries)
- [Status and evidence legend](#status-and-evidence-legend)
- [Product revision and scope](#product-revision-and-scope)
- [Evidence and open questions](#evidence-and-open-questions)
- [Open records and scope distinctions](#open-records-and-scope-distinctions)
- [Area and identifier index](#area-and-identifier-index)
- [About this catalog](#about-this-catalog)

## Notes

Documentation date: **9 November 2026**.

Develop, find and revise **internal text notes on macOS** through conversation. These entries cover the main application; [sources and platform evidence](#notes-evidence-and-open-questions) are recorded below.

### Notes: Shared prerequisites and platform scope

- **Access:** working model access and supplied text or readable workspace files are required. Saving or organizing notes also needs writable storage.
- **Coverage:** Situate can search and read in several steps. Collection-wide conclusions need a defined scope and current sources; successive reads are not a frozen snapshot.
- **iOS:** the full macOS note workflow is not established. Integrated dictation and the macOS shell route are unavailable; shared folder operations remain available with writable storage.
- **External originals:** access to original Apple Notes is **Unclear**. Imported copies can be used locally, but their edits do not update originals, and later original changes do not update the copies.

The [shared conditions and model-quality boundaries](#shared-prerequisites-and-boundaries) apply. Dialogue and candidate selection are part of the workflow.

### Notes: Capabilities

#### N01 — Develop thoughts

Benefit: Develop free-form thoughts into a clearly worded, structured Markdown note. Review the draft in chat and save it as a workspace note when requested.

- **Support:** Supported.
- **Prerequisites and limits:** Supply the thoughts as text or use optional dictation on an Apple Silicon Mac. Dictation needs speech resources and microphone permission; the user reviews and submits its draft before model processing. Saving requires a successful file write. Recognition accuracy and faithful rewriting are [evidence questions](#notes-material-evidence-gaps).
- **Evidence:** Code analysis — R1, N01 and E1/E3/E4/E6; [conversation processing][conversation], [note writes][writes] and [dictation draft insertion][dictation].

#### N02 — Place content appropriately

Benefit: Find an appropriate note and passage for a new thought, clarify the destination when needed, and insert the content there. The result is an updated note, not just a filing suggestion.

- **Support:** Supported.
- **Prerequisites and limits:** Situate can search and read candidate notes, propose a destination and ask the user to resolve an ambiguity before editing. A known topic or folder can help narrow the search; the user need not identify the exact note at the outset. Readable workspace notes and write access are required. This concerns adding content, not restructuring the collection.
- **Evidence:** Code analysis establishes candidate discovery, reading and version-checked editing — R1, N02 and E1–E3. [Workflow evidence](#notes-dialogue-and-retrieval-evidence) covers the main application; [UR1](#notes-prototype-user-report) is separate prototype experience, not a main-application placement test.

#### N03 — Retrieve content

Benefit: Find relevant notes and passages from a description or remembered context, even without the title or exact wording. Receive identifiable sources and refine an initial selection together with Situate.

- **Support:** Supported.
- **Prerequisites and limits:** Situate can try related search terms, inspect folders, read candidates and ask clarifying questions. Built-in search matches literal text and is case-sensitive; varying terms and reading candidates are therefore important. Finding the requested information does not require proving that every related passage in the collection was found. A request for an exhaustive inventory has the separate [coverage limits](#notes-shared-prerequisites-and-platform-scope).
- **Evidence:** Code analysis establishes the successive search/read/conversation path — R1, N03 and E1/E2; [workflow evidence](#notes-dialogue-and-retrieval-evidence). [UR1](#notes-prototype-user-report) describes prototype retrieval experience only; main-application retrieval quality has not been practically measured.

#### N04 — Answer questions about notes

Benefit: Use information from one or several notes to answer a question and make the supporting passages identifiable.

- **Support:** Supported.
- **Prerequisites and limits:** The agent can read selected or discovered notes and answer with filenames, quotations and available search-result line numbers. Input references can be reopened, but they do not automatically prove which source supports each answer claim. Citation accuracy is not automatically verified, and answers about the entire collection inherit the coverage limits above.
- **Evidence:** Code analysis — R1, N04 and E1/E2/E5; [conversation processing][conversation], [source text and search results][discovery] and [current/historical file references][references].

#### N05 — Condense content

Benefit: Condense notes into a summary or key points in chat, or save a shorter version as a separate note.

- **Support:** Supported.
- **Prerequisites and limits:** Supply or select the notes to summarize. Long notes may need successive reads; a summary of several notes depends on obtaining the relevant sources. Saving a separate note requires write access.
- **Evidence:** Code analysis establishes reading, summarizing and saving — R1, N05 and E1–E3. [Summary and editing evidence](#notes-summary-and-editing-evidence).

#### N06 — Compare and combine

Benefit: Identify similarities, differences and apparent contradictions, and combine information from several notes.

- **Support:** Supported.
- **Prerequisites and limits:** The agent can read selected notes, compare their content and save a combined draft. Differences may reflect changed information or different contexts rather than contradictions; available dates and history can help distinguish them. This supports comparison and consolidation of obtained sources, not an exhaustive contradiction scan of an unspecified collection.
- **Evidence:** Code analysis — R1, N06 and E1–E3/E5; [reading and history tools][tools], [source references][references] and [writing combined content][writes].

#### N07 — Identify patterns and connections

Benefit: Examine recurring themes, developments and relationships across notes, with source passages supporting each interpretation.

- **Support:** Supported.
- **Prerequisites and limits:** Situate can obtain several relevant notes, discuss their scope and propose evidence-linked interpretations. Distinguish observations from inferred patterns, and account for dates and possible counterexamples. A pattern found in the inspected notes is not a verified trend across an unexamined collection.
- **Evidence:** Code analysis establishes reading multiple notes, retaining their context and identifying supporting passages — R1, N07 and E1/E2/E5; [workflow evidence](#notes-dialogue-and-retrieval-evidence). Pattern and counterexample quality remain unmeasured in a practical main-application workflow.

#### N08 — Transform content

Benefit: Turn supplied or retrieved knowledge into a draft, outline, checklist or Markdown table. Use the result in chat or save it as a workspace file.

- **Support:** Supported.
- **Prerequisites and limits:** Obtained source text can become a draft, outline, checklist or Markdown table and be saved. This path does not establish finished slide decks, image-based diagrams or arbitrary rich-format exports. A linked attachment is not automatically understood merely because its link appears in a note.
- **Evidence:** Code analysis — R1, N08 and E1–E3/E6; [conversation processing][conversation], [Markdown rendering][markdown], [supported attachments][attachments] and [file creation][writes].

#### N09 — Continue and revise notes

Benefit: Extend notes, revise passages and save updated information without rewriting the whole note manually. Saved changes retain file history.

- **Support:** Supported.
- **Prerequisites and limits:** Situate reads the saved note before changing it. A newer version or an active editor draft can block an overwrite and require reconsidering the edit. Very large notes exceed the [write limit](#notes-summary-and-editing-evidence).
- **Evidence:** Code analysis and four recorded write/history checks establish the editing and storage path — R1, N09 and E3/E7. [Source details](#notes-summary-and-editing-evidence).

#### N10 — Organize the collection

Benefit: Name and group notes and develop their folder structure as the collection changes.

- **Support:** Supported.
- **Prerequisites and limits:** The connected file interface can create folders and move or rename notes. On macOS, chat can also organize files through its shell tool; note headings use ordinary text edits. Shell access and safeguards differ from core file edits. Dedicated built-in chat tools for rename, move and folder creation are not established, so this chat route is not an iOS promise. The quality of model-selected names and groupings remains unmeasured.
- **Evidence:** Code analysis — R1, N10 and E2/E3/E6/E7; [file-interface actions][organization], [shell capability gate][shell] and [available chat tools][tools].

## Task management

Documentation date: **9 November 2026**.

### Task management: Shared prerequisites and platform scope

These capabilities work with task information in writable workspace files in the main application. The [evidence record](#task-management-evidence-record-and-open-points) identifies the assessed revision and report.

For A01–A05 and A07, the supported path is user-requested conversation with working model access and connected workspace search, read and write tools. Tasks may be text checkboxes with identifiers and other information in files; support does not require a standardized task-management module or a dedicated menu item. The model can ask for missing information and act on tool results. Goals, notes and project context must be supplied or explicitly read; only the agreed working method is included automatically in bounded form.

| Platform | Assessed scope and limits                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Writable local workspaces. Optional dictation requires Apple Silicon, microphone permission and the speech model; transcription becomes an editable draft that the user submits. No microphone or native task journey was qualified by this investigation. |
| iOS      | Application-local workspaces only. External document-provider locations do not support this conversation/write path; dictation is unavailable. These are code-based findings, not native iOS qualification.                                                |

Ordinary execution requires the application and workspace to remain open. Imported files are local copies: editing them does not update their external originals. For A01–A05 and A07, support for external originals is **Unclear** without a specific working integration and its supported operations. General plugin or network facilities do not establish such access. Cross-project work below stays within the accessible workspace; it does not join separate workspaces.

Support follows the [shared status legend](#status-and-evidence-legend). **Supported** below means an evidenced reachable path under these conditions, not guaranteed model judgment quality or a qualified release. All implementation references use the source revision above; code analysis and synthetic results are inherited from the fact-check.

### Task management: Capabilities

#### A01 — Derive and capture tasks

**Benefit:** Turn free-form thoughts or existing notes into clearly worded, actionable tasks. Clarify missing information and save the resulting tasks with suitable tools.

**Support:** Supported.

**Prerequisites and limits:** Supplied text can be analyzed directly; stored notes must first be read. The model can create a task file or edit an existing one. A suggestion in chat is not a saved task: a successful file write is required. Speech input has the platform limits above.

**Evidence:** Code analysis; inherited Synthetic check of storage, not task-extraction quality. The report's [shared request/read/write path](../task-management-capabilities-fact-check.md#shared-implementation-evidence) connects conversation to real tools; its [A01 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) cover dictation and draft submission. Recorded storage tests exercise actual temporary-file writes.

#### A02 — Structure tasks

**Benefit:** Group tasks and divide larger undertakings into manageable steps. Select work across projects by criteria such as estimated completion time, then use the selection in chat or save its structure in task files.

**Support:** Supported.

**Prerequisites and limits:** Accessible task files can inform a temporary chat selection, or groups, project labels and nested tasks can be saved in files. Project/subtask relationships are not centrally enforced. A selection such as tasks estimated to take less than five minutes must distinguish model estimates from recorded durations; relevant project data must be read first.

**Evidence:** Code analysis; inherited Synthetic checks of metadata and storage. The [A02 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `metadata.rs:48–125, 614–628` and the import-preservation fixture. The report records 17 metadata tests and one import-preservation test passing; they do not assess duration estimates or grouping quality.

#### A03 — Suggest priorities

**Benefit:** Propose a reasoned order of work based on known goals, deadlines and dependencies.

**Support:** Supported.

**Prerequisites and limits:** The user requests the assessment and supplies the relevant context, or the model reads it from accessible files. A suggested ordering is neither a saved priority change nor calendar scheduling. Unknown deadlines, dependencies or goals must remain explicit gaps rather than invented facts.

**Evidence:** Code analysis establishes that task context and file contents reach the model for a reasoned proposal. The quality of the proposed priorities has not been practically evaluated. [Source details](#task-management-priority-and-search-evidence).

#### A04 — Find and summarize tasks

**Benefit:** Find relevant tasks and summarize open work, upcoming deadlines and progress so the user can understand the current workload.

**Support:** Supported.

**Prerequisites and limits:** Situate can search for tasks, read candidate files and refine the selection with the user. A summary covers the task records actually obtained. For a complete workload count, agree which files and time period belong in the result and account for unreadable files or changes during the search; a first set of search matches is not a complete inventory.

**Evidence:** Code analysis establishes search followed by reading and summarization. The report contains no successful native-host search/pagination test run. [Search mechanics and evidence](#task-management-priority-and-search-evidence).

#### A05 — Keep tasks current

**Benefit:** Update task descriptions, dates and progress from new information, saving the changes rather than merely proposing them.

**Support:** Supported.

**Prerequisites and limits:** The model reads the intended task and edits its file using the current revision and uniquely matching text. Successful writes reach durable storage; stale or ambiguous edits are rejected. Agent writes are limited to 1 MiB, and partial-save warnings require attention. Dates and states are file content, not universally standardized task fields. The local-copy boundary above applies to imported tasks.

**Evidence:** Code analysis; inherited Synthetic check. The [A05 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `files.rs:1429–1499` and `content/agent_tools.rs:152–216`. Four recorded agent-tool tests cover real temporary-file writes/history, stale and ambiguous edits, and size/failure handling; they are not a model-driven editing journey.

#### A07 — Identify dependencies and blockers

**Benefit:** Identify what must be clarified or completed before other tasks can proceed, making missing prerequisites and blocking work visible.

**Support:** Supported.

**Prerequisites and limits:** Accessible task descriptions, known states and user-supplied prerequisites can be analyzed on request. Explicitly recorded dependencies must remain distinguishable from inferred, potentially incorrect relationships. A dedicated dependency field is not required; the result identifies relationships that A03 can use, rather than enforcing a dependency graph.

**Evidence:** Code analysis. The [A07 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `ai_conversations.rs:629–671, 729–812` and `ai_builtin_tools.rs:14–35`, connecting task context and reads to model reasoning. No real-model dependency or blocker-quality test is recorded.

## Email

Documentation date: **9 November 2026**.

### Email: Shared prerequisites and platform scope

All E01–E07 statements below use the [shared email and calendar connector scope](#email-and-calendar-connector-scope). The assumed Gmail connector exposes callable operations to search and read messages and complete threads, retrieve relevant sent and received mail, save and update drafts, manage labels and flags, archive, move to trash, send and forward.

The assessed product is the **main application** at revision `27b6831c3e55b2de4a59d6cd32cf1935d373338d`, with working model access and an open workspace. The statements concern account-backed workflows, not pasted messages, imported copies, the historical prototype or synthetic workshop scenarios. Under the [shared status legend](#status-and-evidence-legend), **Supported** denotes an evidenced, reachable path, not guaranteed interpretation quality or a qualified release.

- **macOS:** the conversation invokes registered plugin tools and processes their results; workspace file reads supply additional context. Available shell execution also supports scripted calculations.
- **iOS:** the shared conversation/plugin path supports the same account operations and text reasoning. The macOS shell route is unavailable; deterministic calculations beyond model reasoning require separately callable plugin code. Neither this assessment nor the source report establishes native iOS qualification.
- **Context and outcomes:** the connector must return readable messages and clear operation results. Large selections can require successive reads and retained intermediate findings. An interrupted external operation can have an unknown outcome; establish the account state before deciding whether to repeat it.

### Email: Capabilities

#### E01 — Understand emails and conversation threads

Benefit: Summarize individual emails or longer exchanges, explain agreements, and identify outstanding questions or requests.

- **Support:** Supported.
- **Prerequisites and limits:** The agent reads messages and their surrounding correspondence, then answers from that content. Accessible attachments contribute when suitable reading tools support their format. Search previews are not full messages; protected files and unsupported formats remain outside readable content. Images need a compatible model, while PDF/Office content needs suitable extraction rather than an assumed native text reader.
- **Evidence:** Code analysis — R1, E01 and M1/M3; S1/S2 establish result processing and successive reads, S3 the local reading route.

#### E02 — Compose emails

Benefit: Draft and revise new messages and replies from bullet points or previous correspondence, adapting tone, length and purpose to the user's preferences. Save and update the resulting drafts in the email account.

- **Support:** Supported.
- **Prerequisites and limits:** Personal style instructions can be read from an accessible workspace Markdown file and applied alongside the retrieved exchange; no dedicated style feature is required. Saving or updating an account draft is a separate tool operation with an observed result. Text in chat or a local file is not a saved Gmail draft, and draft creation does not send it. Style fidelity remains a model-quality question, not an established guarantee.
- **Evidence:** Code analysis — R1, E02 and M1–M3; S1/S2 for draft-tool invocation and returned outcomes, S3 for style-file reading.

#### E03 — Find information in the email collection

Benefit: Find relevant messages and specific details by meaning and context, even without an exact subject or remembered wording. Narrow the selection by date or age, sender, subject or attachment presence.

- **Support:** Supported.
- **Prerequisites and limits:** The agent varies searches, reads candidates and refines the selection with the user when needed. Criteria can be applied through search arguments or by filtering retrieved metadata and content; a dedicated semantic index is not required. Pagination and bounded context prevent a first result page from proving complete coverage. Broad or changing collections need an explicit search scope and cutoff; exhaustive recall is not established.
- **Evidence:** Code analysis — R1, E03 and M1/M2; S1/S2 establish successive tool calls with returned content and the context boundary.

#### E04 — Organize the mailbox

Benefit: Group messages by content or requested criteria and change their filing and markings. Formulate sorting rules and apply them once to existing messages, including several matching messages.

- **Support:** Supported.
- **Prerequisites and limits:** The agent creates, assigns and removes labels; marks messages read or unread; sets or removes stars; archives messages; and moves them to trash. Multiple messages can be handled through successive calls without requiring a dedicated bulk interface. A batch is not an atomic transaction: retain individual outcomes and distinguish successful changes from failures or uncertain results.
- **Evidence:** Code analysis — R1, E04 and M1/M2; S1/S2 establish execution and per-call outcomes.

#### E05 — Send and forward emails

Benefit: Send prepared new messages or replies, and forward existing messages to the intended recipients. This performs the account action rather than merely preparing content or saving a draft.

- **Support:** Supported.
- **Prerequisites and limits:** The agent passes recipients, message content and relevant reply or forwarding context to the corresponding tool and uses its returned outcome. A provider's acceptance is not proof of eventual recipient delivery or reading. A draft, proposed message or ungrounded chat confirmation proves neither sending nor forwarding. Attachment handling remains format- and operation-specific; general forwarding support does not promise arbitrary attachment conversion. After an uncertain outcome, establish the account state before deciding whether to retry.
- **Evidence:** Code analysis — R1, E05 and M1/M2; S1/S2 connect invocation to returned success, failure or unknown outcome.

#### E06 — Follow up open correspondence

Benefit: On request, identify across threads who is waiting for the user, whom the user is waiting for, and which answer, decision or promised response remains outstanding.

- **Support:** Supported.
- **Prerequisites and limits:** On request, the agent compares sent and received correspondence and cites relevant message identifiers or passages for the inferred state. Unread status or the existence of any reply does not establish whether a commitment is resolved. Findings depend on current, correctly associated threads and the selected time range.
- **Evidence:** Code analysis — R1, E06 and M1–M3; S1/S2 establish multi-step retrieval and context use. Correct interpretation of obligations has not been measured in a live product workflow.

#### E07 — Recognize communication patterns

Benefit: Compare the wording, length or structure of sent emails with observed responses, including whether replies occur, how quickly they arrive and what form they take. Support findings with traceable examples and, where useful, counts.

- **Support:** Supported.
- **Prerequisites and limits:** Agree which messages and period to compare, and associate responses with the relevant sent messages. Examples and counts describe that selection; they do not prove a mailbox-wide trend or that wording caused a response. Reliable rates and timing comparisons need an explicit calculation method, with the macOS/iOS conditions above.
- **Evidence:** Code analysis establishes retrieval, comparison of message content and callable calculation routes. It does not measure statistical or interpretive accuracy. [Quantitative evidence and limits](#email-quantitative-comparison-and-result-content) distinguish those claims.

## Calendar

Documentation date: **9 November 2026**.

### Calendar: Shared prerequisites and platform scope

All statements below use the [shared email and calendar connector scope](#email-and-calendar-connector-scope). The assumed Google Calendar connector exposes callable operations to search/read calendars and events, query known or shared availability, create/change/cancel events, invite participants and answer invitations. Associated email communication uses the assumed Gmail connector's read, draft and send operations.

This section belongs to the [Product Capability Catalog](#situate--product-capability-catalog) and concerns the **main application**, not the historical prototype or workshop. Working model access, an open workspace and model-readable tool results are required. K01–K07 describe user-requested workflows. The [shared status legend](#status-and-evidence-legend) applies: **Supported** identifies a reachable code path under this scope, not guaranteed model accuracy or release qualification.

**Platforms:** the shared conversation/plugin path supports these assessments for macOS and iOS. macOS additionally provides command execution for calculations; iOS does not. No assessment depends on an iOS shell. The inherited checks do not establish a native end-to-end calendar workflow on either platform.

### Calendar: Capabilities

#### K01 — Capture events

**Benefit:** Situate turns free-form details or existing content into concrete calendar events, asks for missing information when needed and creates the events. It invites participants when requested.

- **Support:** Supported.
- **Prerequisites and limits:** Dates, times, duration and participants must be sufficiently clear before execution. A proposed event in chat is not a created event: the action result determines the reported outcome. If interruption leaves the outcome uncertain, inspect the calendar before repeating the action; successful recovery is not guaranteed.
- **Evidence:** Code analysis; inherited synthetic checks of the general execution path, not event creation. [A](#calendar-a-request-tool-result-and-answer), [B](#calendar-b-context-and-calculation).

#### K02 — Find events and get an overview

**Benefit:** Situate finds requested events and their details and summarizes upcoming days or weeks in an understandable overview.

- **Support:** Supported.
- **Prerequisites and limits:** Search results can be followed by detail reads and further queries; a dedicated semantic calendar index is unnecessary. Larger periods require successive reads. A partial result set does not establish a complete calendar overview.
- **Evidence:** Code analysis; inherited synthetic checks of tool execution. [A](#calendar-a-request-tool-result-and-answer), [C](#calendar-c-readable-results-and-data-volume).

#### K03 — Find suitable time windows

**Benefit:** Situate proposes free periods for an event or time block, considering duration, known availability and personal preferences. It identifies shared windows where participants' availability is accessible.

- **Support:** Supported.
- **Prerequisites and limits:** Proposals use known or shared availability and the user's preferences. Missing availability is not treated as free time. Clarify duration, time zones or recurring-event details when needed; a proposed window is not a booked event.
- **Evidence:** Code analysis establishes that availability and preferences can reach the model for comparison and a proposal. Interval interpretation is inferred from that executable path; its practical accuracy, including daylight-saving changes, all-day events and recurring exceptions, has not been measured. [Request path](#calendar-a-request-tool-result-and-answer), [context and calculation](#calendar-b-context-and-calculation).

#### K04 — Identify conflicts and tight schedules

**Benefit:** Situate exposes overlapping events and overly tight sequences. It includes known or explicitly assumed travel, preparation and buffer times in the comparison.

- **Support:** Supported.
- **Prerequisites and limits:** Distinguish supplied durations from estimates. Live traffic or route calculation is not established and is unnecessary for comparing events with known or estimated buffers. The result is an assessment, not an enforced scheduling constraint.
- **Evidence:** Code analysis of contextual comparison through the execution path, not a practical traffic or scheduling test. [A](#calendar-a-request-tool-result-and-answer), [B](#calendar-b-context-and-calculation).

#### K05 — Keep events up to date

**Benefit:** Situate reschedules events, changes their details or cancels them. It answers invitations and communicates changes to participants.

- **Support:** Supported.
- **Prerequisites and limits:** Select and read the intended event before modifying it, distinguishing an occurrence from a recurring series where relevant. Invitation responses and separate email messages are distinct actions. A suggested change is not an applied change; interpret success, failure or uncertainty from each action's result rather than claiming delivery from a draft.
- **Evidence:** Code analysis; inherited synthetic checks of tool calls and results, not live event changes or message delivery. [A](#calendar-a-request-tool-result-and-answer), [C](#calendar-c-readable-results-and-data-volume).

#### K06 — Recognize time distribution and patterns

**Benefit:** Situate groups recorded time across days or weeks by activity and explains recurring patterns, such as many short events or few longer free blocks.

- **Support:** Supported.
- **Prerequisites and limits:** Calendar entries describe planned or recorded time, not actual effort. State the period, categories, missing data and treatment of overlapping events so totals are interpretable. Large datasets need bounded reads and intermediate results; neither unlimited coverage nor the quality of interpretations is established.
- **Evidence:** Code analysis of retrieval and model processing, with macOS calculation tools available as an additional aid. No practical calendar-analysis quality check is claimed. [A](#calendar-a-request-tool-result-and-answer), [B](#calendar-b-context-and-calculation), [C](#calendar-c-readable-results-and-data-volume).

#### K07 — Capture and apply personal calendar rules

**Benefit:** Situate records the user's scheduling preferences for reuse and considers them when creating, planning, checking or changing events. Preferences can include reserved times for different parts of life and desired gaps between events.

- **Support:** Supported.
- **Prerequisites and limits:** Rules belong to the current workspace, not automatically to every workspace. A bounded portion of the central working-method instruction is loaded automatically; longer instructions and additional notes require explicit retrieval. Durable storage enables later reuse but does not guarantee retrieval or technically enforce rule compliance. Examples are not rules to install for any particular person.
- **Evidence:** Code analysis; inherited synthetic storage/reopening checks. [B](#calendar-b-context-and-calculation), [D](#calendar-d-persistent-personal-rules).

## Documents

Documentation date: **9 November 2026**.

**Documents are currently not supported.** D01–D08 describe a **tentative target for possible future support**, not existing functionality. Their shared support status is **Not supported at reviewed revision**, using the [catalog's status vocabulary](#status-and-evidence-legend). The product-owner specification dated 9 November 2026 confirms that no implementation is currently present in the repository.

This section belongs to the [Product Capability Catalog](#situate--product-capability-catalog) and concerns the main application. The target remains provisional: it sets no release date, priority, technical architecture or implementation commitment. It establishes no macOS or iOS support or qualification.

### Documents: Shared prerequisites and limits

The desired capabilities depend on readable source content, suitable tools for the relevant file formats and, where needed, accessible templates, design guidelines and assets. Collection-wide work depends on access to the relevant documents. The [catalog's shared boundaries](#shared-prerequisites-and-boundaries) also apply. These are conditions for the target capabilities, not evidence of present support.

### Documents: Capabilities

#### D01 — Understand documents

**Benefit:** Make sense of content, summarize key statements, explain difficult passages and answer questions about one or more documents. Make answers traceable to the underlying text passages.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Readable document content and identifiable source passages.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

#### D02 — Find information in documents

**Benefit:** Retrieve relevant documents and specific details by meaning or search criteria. Extract requested information, such as dates, names or requirements, and present it clearly.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Access to the relevant collection and readable contents; findings are limited to the documents available.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

#### D03 — Create documents

**Benefit:** Draft new documents from instructions, bullet points or existing document content. Account for purpose, audience, desired structure and available templates, and provide the result as a document using suitable tools.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Accessible source material and templates, with suitable tools for the intended document format.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

#### D04 — Revise documents

**Benefit:** Add to, update, shorten or rephrase existing content. Improve language, clarity and consistency, and translate texts or adapt them for another audience when needed.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Readable existing content and suitable tools to apply changes to the document.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

#### D05 — Compare and combine documents

**Benefit:** Identify differences between versions, along with common content, conflicting information and additions across documents. Combine suitable content into a common version whose sources and changes can be traced.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Access to the relevant documents or versions and readable content for comparison.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

#### D06 — Structure and design documents

**Benefit:** Shape structure and presentation with suitable headings, paragraphs, lists, tables and styles. Prepare documents in different layouts using accessible design guidelines and assets, and provide or convert the result in supported file formats using suitable tools.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Accessible design guidelines and assets, plus appropriate layout and file-format tools. The target does not establish which formats will be supported.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

#### D07 — Organize the document collection

**Benefit:** Give documents meaningful names, group them by content or requested criteria, and improve how they are filed. Apply assignments and filing changes using suitable tools.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Access to the relevant collection, writable storage and suitable tools for the requested organizational changes.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

#### D08 — Check documents against requirements

**Benefit:** Check documents against supplied requirements for completeness, adherence to requested structures and contradictions in content. Show missing information and deviations with traceable source locations, and give concrete revision guidance.

**Support:** Not supported at reviewed revision. Tentative future target.

**Prerequisites and limits:** Supplied requirements, readable documents and identifiable source locations.

**Evidence:** Product specification; the shared [source record](#documents-source-and-evidence-scope) applies.

## Plugins

Documentation date: **9 November 2026**.

This section assesses P01–P06 for the main application at the revision defined in the [Product Capability Catalog](#product-revision-and-scope). It describes extensibility, not a catalog of ready-made integrations or a promise that every requested plugin can be developed successfully.

### Plugins: Shared prerequisites and platform scope

- Agent-led development requires working model access and an open, writable workspace. Plugins belong to that workspace; different workspaces can contain different extensions and working methods. Development proceeds through source changes, checks of specific revisions and activation. Installed plugins must be enabled and compatible with their platform and required dependencies.
- **macOS:** the report traces native plugin execution, HTTP access and local program execution. Programs, OS permissions and external account setup are not installed or granted automatically.
- **iOS:** shared JavaScript/Vue and native executor mechanisms exist, with limited inherited simulator evidence. macOS system-program access is unavailable. Shared source and simulator observations do not establish physical-device or distribution qualification for a particular plugin.
- Plugins are trusted code, not adversarially sandboxed programs. Work stays within the user's request and configured access; external actions can execute without per-action confirmation. Closing a view does not stop already-running work, but workspace closure or application quit does.

The [shared status legend](#status-and-evidence-legend) applies. Support below concerns whether the described result can be achieved under these conditions. Model quality, access to a particular account and platform qualification retain their own evidence boundaries. The older macOS prototype and workshop scenarios are not evidence of main-application capabilities.

### Plugins: Capabilities

#### P01 — Connect new data sources

Benefit: Develop connections to additional services so their contents can be used in Situate instead of remaining isolated in another system.

Support: **Supported**.

Prerequisites and limits: The service needs an accessible API that the plugin can call through Situate's available interfaces. Develop the required requests and expose the returned content through callable plugin functions. Account authorization, permissions and any credential renewal must be supplied or implemented for that service; a source check is not proof of successful account access. Text-based HTTP responses and device-local credentials are supported. Connections needing unavailable native interfaces or other response formats require additional capabilities, not just plugin configuration. Unlike Email and Calendar, this entry does not assume an already-working Google connector.

Evidence: **Code analysis** establishes service requests, credential access and callable connection functions; Q1 records native calls against an owned loopback service. This supports connection development under the stated API conditions, not a guarantee for every service or a verified login to a particular account. [Connection evidence](#plugins-connection-and-view-evidence).

#### P02 — Develop custom tools and workflows

Benefit: Turn recurring steps into callable functions and combine existing functions into reusable workflows for the assistant or other plugins.

Support: **Supported**.

Prerequisites and limits: A workflow runs when called by the assistant, a user interaction or another plugin within a requested task. It can combine available functions, provided the required plugins are enabled and their data and actions are accessible. Inputs, errors and external prerequisites are handled by the particular workflow.

Evidence: **Code analysis** establishes callable functions and their composition; Q1 records native tool and service calls. [Execution details](#plugins-workflow-and-update-evidence).

#### P03 — Create individual views

Benefit: Select information from accessible sources, combine it into a view suited to the user's work and provide controls for relevant actions.

Support: **Supported**.

Prerequisites and limits: The view needs accessible data and callable operations for its controls. Its source selection, refresh, editing and error handling are part of the plugin. It adds a view within Situate rather than replacing the application shell, navigation or chat. Accessibility and small-screen suitability depend on that view's design; faulty view code can freeze the shared application UI.

Evidence: **Code analysis** establishes custom views and their connection to data and actions. It does not establish the usability of a particular generated view. [View interfaces and source locations](#plugins-connection-and-view-evidence).

#### P04 — Evolve extensions

Benefit: Change an existing plugin as needs develop, add behavior and make the revised extension available for continued use.

Support: **Supported**.

Prerequisites and limits: The existing version remains usable while a revision is prepared and checked. Switching to the revised version waits for affected running actions. A refreshed view may lose unsaved inputs; changes already saved to workspace files remain saved. Updates that change stored data need an appropriate conversion strategy in the plugin.

Evidence: **Code analysis** establishes source editing, checks and switching to a checked version; Q1 records native activation and reopening. [Update mechanics and evidence](#plugins-workflow-and-update-evidence).

#### P05 — Store personal working methods

Benefit: Bundle guidance for working with the assistant in one workspace-specific plugin, such as preferred procedures, calendar practices and email style. Separate workspaces can retain different guidance.

Support: **Supported**.

Prerequisites and limits: A skills-only plugin can contain a single declared Markdown document without executable service or UI code. The package must be available and enabled in the relevant workspace: merely saving an arbitrary Markdown file does not automatically make it assistant guidance. Captured plugin skills are passed into the model's instructions for relevant work; they neither grant access nor create missing tools. Availability of the guidance does not guarantee that the model follows every rule correctly.

Evidence: **Code analysis** — R1, section 2 and B02–B03, plus focused inspection of [manifest validation](../../client/crates/situate-core/src/plugins.rs), `validate_sources`; [workspace skill capture](../../client/app/src-tauri/src/ai_executor.rs), `capture` and `CapturedTools::skills`; and [model instruction construction](../../client/app/src-tauri/src/ai_conversations.rs), `NativeHost::capture_instructions` and `run_instructions`. This establishes that the guidance reaches model instructions, not that the model follows every rule.

#### P06 — Create custom information structures

Benefit: Develop collections with personally chosen fields, categories and relationships, then capture and maintain their contents where existing organization is unsuitable.

Support: **Supported**.

Prerequisites and limits: Develop and enable a plugin that defines the collection's fields, categories, forms and relationship rules in a writable workspace. Its functions can save records, read them for display, and change their values and relationships. Field validation and relationship consistency are the plugin's own logic. Larger collections and simultaneous edits must be handled within the [storage limits](#plugins-custom-collection-workflow-evidence).

Evidence: **Product specification** defines the intended collection benefit. **Code analysis** connects development and activation, view/service calls, record processing and persistent reads/writes into an executable workflow. [The step-by-step evidence](#plugins-custom-collection-workflow-evidence) distinguishes that path from practical qualification of a particular collection plugin.

## Shared prerequisites and boundaries

- AI work needs configured, working model access. Content must be supplied or retrieved through accessible tools; its presence in a workspace or account does not by itself put it in the conversation.
- Saving or changing a file requires writable storage and a successful operation. A chat answer claiming that something was saved, sent or changed is not evidence that the action occurred.
- Search results, file reads and retained conversation context are bounded. Several steps can locate a particular answer. A complete inventory or collection-wide conclusion additionally needs a defined scope, sufficient coverage and current sources. Model judgments, citations and calculations still need appropriate review.
- Imported files are local copies. Editing a copy does not update its external original. External-source access has its own assessment unless explicitly assumed below.
- Workflows start on request and require the application and workspace to remain open. Hiding a view does not stop running work; closing the workspace or application does.
- Plugins are trusted code, not adversarially sandboxed programs. The reviewed runtime can perform external actions without per-action confirmation. An interrupted action may have an unknown outcome; establish the external state before deciding whether to retry.
- Functional areas are not workspaces. Workspaces separate environments such as private and professional life; the catalog does not imply shared context or operations across them.

### Email and calendar connector scope

**Situate does not supply a native email-service or calendar-service connector.** For every entry in [Email](#email) and [Calendar](#calendar), assume an already working, configured, enabled and authenticated **Gmail** or **Google Calendar** plugin connector, respectively, with full required permissions and callable operations. Calendar-related email communication uses the same Gmail assumption. The area introductions specify the operations covered. Full account permissions do not grant access to other people's unshared calendars.

This is a stipulated prerequisite, not an executed connection, login or account test. Capabilities are stated directly under that fulfilled scope; the absence of a bundled connector does not lower their ratings. Situate's own execution limits still apply. [P01](#p01--connect-new-data-sources) instead assesses developing a connection without assuming that it already works.

## Status and evidence legend

| Support status                         | Meaning within the entry's stated scope                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supported**                          | Suitable evidence establishes an executable workflow through which the described result can be achieved within the stated scope. Dialogue, choices between suggestions and multiple steps may be part of that workflow.         |
| **Partially supported**                | A useful subset is established, but an essential part of the described result is unavailable or evidenced recurring difficulties prevent it under ordinary conditions. The entry must identify that part and the usable subset. |
| **Not supported at reviewed revision** | Absence is established by evidence or an explicit product specification. Missing evidence alone is insufficient.                                                                                                                |
| **Unclear**                            | The available evidence does not establish whether the described result is reachable in the stated scope. The entry identifies the unresolved question.                                                                          |

A clarification question or a choice between suggestions is part of collaboration, not a limitation. Situate must contribute substantially rather than hand the essential work back to the user, but a substantial contribution alone is not enough for **Supported** if an essential part of the result remains unreachable. Missing proof for every edge case, unlimited collections, exhaustive search or perfect model answers does not by itself justify **Partially supported**. Where completeness is part of the requested result, the coverage limits still matter.

These values are independent of requirement approval, release qualification and evidence type. Current support and tentative targets remain distinct. Entries name different platform or source assessments explicitly rather than applying one rating to every variant.

Evidence types are **Product specification**, **Code analysis**, **Synthetic check**, **Executed product workflow**, **User report** and **Assumption**. Code analysis can establish an executable workflow; general model ability alone cannot. A synthetic component check is not a live account or model workflow, and reading test sources is not executing them. User reports retain their product version and scope. Evidence labels such as R1 are local to their area.

## Product revision and scope

The assessed product is the **main application**, `client/app/` and `client/crates/`, at commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` on `use-case-validation` (5 November 2026). The documentation date is not a new product version or test date. No released version is claimed. [Documents](#documents) records current non-support and a tentative future target from the product-owner specification dated 9 November 2026.

**Current product scope is macOS only; iOS is deferred and is not currently supported.** The recorded assessment below covers macOS and iOS separately; its earlier iOS analysis and simulator results are retained evidence, not an active support or delivery commitment. Notes primarily cover macOS internal text notes; task management covers writable macOS and application-local iOS workspaces. Email and calendar use the shared conversation/plugin path under the connector scope above. Plugin evidence includes native macOS and limited iOS simulator records. These scopes do not establish general native workflow parity or physical-device qualification. Historical prototype and synthetic workshop behavior are not main-application evidence.

The area evidence sections identify report dates, source locations and recorded checks. Note, task and email reports have no stated investigation date; the calendar report is dated 7 November and the plugin report 6 November 2026. Recorded test results are attributed to those sources, not to this documentation revision.

## Evidence and open questions

### Notes: Evidence and open questions

#### Notes: Source and report provenance

Source revision: `27b6831c3e55b2de4a59d6cd32cf1935d373338d` on `use-case-validation` (5 November 2026).

**R1 — [Note capabilities: repository fact-check](../note-capabilities-fact-check.md)** assesses that revision. Its report and execution dates are not recorded. Its SHA-256 is `a8104d667020f7a0022160030174eaef0f7ad555065166f5acafb72e849e2f20`. Capability sections, evidence groups E1–E8 and **Checks actually executed** contain the detailed findings and recorded results.

#### Notes: Dialogue and retrieval evidence

R1 documents directory inspection, filename/text search, reading and conversation context in E1/E2, version-checked edits in E3 and inspectable source references in E5. These mechanisms support proposing candidate notes, refining the selection with the user, reading the chosen passages and applying an edit. They also support comparing several obtained notes and explaining possible patterns. The substantial search, interpretation and editing work is performed through Situate's connected tools, not delegated entirely back to the user.

The support assessments for N02, N03 and N07 concern these workflows. They do not depend on a one-step placement guarantee or exhaustive collection discovery. As with [E03](#e03--find-information-in-the-email-collection), successive queries and reads can establish a useful result. Unlike Gmail retrieval, this route uses local literal searches and accessible text files, not account-backed message operations. Relevant sources: [tool definitions][tools], [search and reading][discovery], [conversation processing][conversation], [editing][writes], [references][references] and [bounded context][context].

#### Notes: Summary and editing evidence

For N05, R1 N05/E1–E3 and the [conversation][conversation], [reading][discovery] and [writing][writes] paths establish a summary returned in chat or saved separately. Preservation of important statements has not been evaluated with a live model.

For N09, [exact editing and version-checked writes][writes] require each text match to be unique. [Native write handling][native-writes] and the content store reject stale versions and conflicting editor drafts. Agent text writes are limited to 1 MiB per file. The four component checks recorded by R1 cover write/history behavior; these storage protections do not validate the factual correctness of revised text. Model-quality boundaries are shared across the catalog.

#### Notes: Platform and source evidence

R1 identifies shared iOS text-processing and file-interface foundations, but contains no native iOS note journey. Shared folder operations do not establish the macOS chat-driven restructuring route on iOS. Integrated dictation and the inspected shell/process route are unavailable there at the source revision.

For original Apple Notes, generic macOS process execution and workshop examples do not establish a working integration. Internal-note ratings concern accessible text and imported copies, not verified access or write-back to those originals.

#### Notes: Prototype user report

**UR1 — User report, 9 November 2026:** a user reports repeated success placing content and finding requested details in a large note collection during prototype use. The described workflow often began with a vague question, followed by candidate suggestions and refinement. This is a non-identifying summary, not a controlled test or an executed check by the catalog author. It supports the usefulness of the collaborative workflow; it does not establish the main application's connector access, retrieval quality or performance.

#### Notes: Recorded component checks

R1 records synthetic or temporary-file checks, not personal-note workflows:

| Reported check                                                                                                                  | Recorded result                | Evidence boundary                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Five Vitest files covering dictation draft handling, chat, native-conversation adapters, content references and the file editor | 144 passed                     | UI/component behavior with simulated native/file responses; not recognition accuracy or live-model quality. |
| Core `content::agent_tools::tests`                                                                                              | 4 passed                       | Temporary-file writes, history, exact matching, stale/draft protections and failure handling.               |
| Core `content::import_batch::tests`                                                                                             | 16 passed; 1 benchmark ignored | Prepared-copy publication and preservation; not extraction from Apple Notes or synchronization.             |
| Core `content::live_references::tests`                                                                                          | 8 passed                       | Current/historical references, moves and deleted/reused paths in temporary storage.                         |

R1 contains no executed literal-search or native chat/import journey. Its recorded component results do not establish live-model retrieval or placement quality.

#### Notes: Material evidence gaps

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

### Task management: Evidence record and open points

- **Product/source:** Main application, branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` (5 November 2026). The source revision, not the documentation date, identifies the assessed product.
- **Report used:** [Task-management capabilities: fact-check](../task-management-capabilities-fact-check.md), investigation date unstated, at the same source revision. The Markdown report is the evidence input; its PDF derivative is not independent evidence.
- **Inherited checks:** The report's [execution record](../task-management-capabilities-fact-check.md#checks-actually-performed) records four agent-tool tests, 17 metadata tests and one import-preservation test passing with synthetic data. These establish component behavior, not an executed end-to-end task workflow. The native-host `file_tool::tests` run stopped before tests because the media helper could not link against the macOS 27 SDK stubs.

#### Task management: Priority and search evidence

For A03, the report's [capability-specific anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `ai_conversations.rs:629–671, 729–812` and `file_tool.rs:170–214`: context and file reads reach the model through the conversation/tool loop. This establishes a route for considering known goals, deadlines and dependencies, not the quality of any particular priority judgment.

For A04, the same report identifies `file_tool.rs:215–307`, `files.rs:1501–1559` and `content/mod.rs:1026–1059`. Search is exact and case-sensitive, returns at most 200 results per page and provides matching-line excerpts rather than complete task records. Further pages and file reads can extend the inspected scope. Ordinary search excludes technical paths and symbolic links; files above 16 MiB cannot be read. These limits matter when interpreting counts and collection-wide conclusions, not merely because a question needs several searches.

#### Task management: Material gaps

Model quality for extraction, estimates, priorities and inferred blockers remains unmeasured. The report provides no successful native-host search/pagination run or qualified GUI task journey, iOS workflow, microphone-to-task flow or live-provider workflow. External task access and write-back depend on a specific working integration; local-copy support does not establish them.

### Email: Evidence and open questions

**Product/source:** branch `use-case-validation`, revision `27b6831c3e55b2de4a59d6cd32cf1935d373338d` (5 November 2026).

**R1 — [Email capabilities fact-check: E01–E07 with a Gmail plugin](../email-capabilities-fact-check.md):** investigation date unstated; main-application findings identify the same revision. Its capability entries, shared code references M1–M4 and evidence section document the execution path. The scope of this catalog is set by the product-owner email specification dated 7 November 2026 and the [shared connector scope](#email-and-calendar-connector-scope).

The following code evidence describes how the main application uses the supplied operations at that revision:

| Reference | Source and location                                                                                                                                                                                                                                                                                | What it establishes                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1        | [Conversation host](../../client/app/src-tauri/src/ai_conversations.rs), `prepare_model`; [plugin executor](../../client/app/src-tauri/src/ai_executor.rs), `CapturedTools::invoke` and `plugin_tool_result`                                                                                       | Registered plugin tools reach the conversation, execute with arguments and return validated text/image content and error state.                                                   |
| S2        | [Agent execution](../../client/crates/situate-agent/src/execution.rs), `drive_steps`; [provider protocol](../../client/app/src-tauri/src/ai_protocol.rs), `blocks`, `anthropic_context`, `completions_context`; [context preparation](../../client/crates/situate-agent/src/compaction.rs), `plan` | Successive model/tool steps, retained outcomes, model-visible content and bounded context; disconnected execution records an unknown outcome rather than confirmed non-execution. |
| S3        | [Built-in tools](../../client/app/src-tauri/src/ai_builtin_tools.rs), `definitions`; [conversation host](../../client/app/src-tauri/src/ai_conversations.rs), file-tool dispatch; R1 M3                                                                                                            | Bounded UTF-8/image reads and the return of workspace file content to the model, including readable style instructions.                                                           |
| S4        | [Shell host](../../client/app/src-tauri/src/shell_host.rs), `capability`; [executor worker](../../client/app/src/plugins/executor-worker.ts), `invoke`                                                                                                                                             | macOS shell availability, iOS shell absence and execution of registered plugin JavaScript tools; not a bundled email-analytics tool.                                              |

#### Email: Quantitative comparison and result content

For E07, R1 E07/M1/M4 and S1–S4 establish usable message context and executable calculation routes. Reproducible rates or timing comparisons require a stated population, observation cutoff, reply-matching rules, timestamps and treatment of unanswered messages. macOS can use shell scripts for calculations; iOS needs separately callable plugin code for deterministic calculation beyond model reasoning. Model arithmetic alone is not a verified quantitative result. Mailbox-wide measurement and interpretation quality have not been practically evaluated.

For all entries, message bodies, identifiers, timestamps and operation outcomes must reach the model in tool-result `content`; separate `details` or `structuredContent` are not automatically model input. Results and conversation context are bounded, as documented by S1/S2.

#### Email: Recorded evidence and open questions

R1 records eight passing prototype tests using temporary plugins and a simulated model. These are not main-application or Gmail workflow evidence. The main-application assessments rely on code analysis S1–S4, not an executed login, live-model conversation, mailbox action or native email journey.

**Material open points:** attachment-format coverage beyond readable content; large-collection coverage and quantitative reproducibility; interpretation, style and citation quality; and native macOS/iOS workflow qualification. These are evidence questions within the stated scope; the working connector remains a stipulated prerequisite.

### Calendar: Evidence and review state

**Source baseline:** branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d`, 5 November 2026. No released version is claimed.

**Primary report:** `bundle:Kalender-Faehigkeiten_Fact-Check.md`, titled “Situate: Kalenderfähigkeiten im Fact-Check”, dated 7 November 2026. Its main-application assessment, shared limits and evidence groups A–D support K01–K07. The external research collection remains outside Git; its historical prototype findings are not evidence for this application. References below identify the public source locations recorded in that report at the baseline revision.

#### Calendar: A: Request, tool, result and answer

[Chat submission](../../client/app/src/ai/chat.ts), lines 889–950; [native conversation integration](../../client/app/src-tauri/src/ai_conversations.rs), lines 572–606 and 990–1032; [agent execution loop](../../client/crates/situate-agent/src/execution.rs), lines 385–628. Together these connect user requests, available plugin tools, sequential execution, retained results and model responses, including errors.

#### Calendar: B: Context and calculation

[Built-in tool definitions](../../client/app/src-tauri/src/ai_builtin_tools.rs), lines 9–107, provide reading, search, writes, clarification and optional command execution. [Platform tool availability](../../client/app/src-tauri/src/files.rs), lines 1157–1200, distinguishes macOS command access from iOS. General model computation supports the qualitative assessments; it is not evidence of calendar-domain accuracy.

#### Calendar: C: Readable results and data volume

[Plugin-result validation](../../client/app/src-tauri/src/ai_executor.rs), lines 1105–1212, accepts bounded content blocks. [Model protocol conversion](../../client/app/src-tauri/src/ai_protocol.rs), lines 76–89 and 511–583, sends those blocks, not automatically separate metadata. [Context compaction](../../client/crates/situate-agent/src/compaction.rs), lines 73–154, bounds retained model context. The report records up to 128 result blocks, a 128-model-round guard and a 1 MiB response limit in the [native HTTP helper](../../client/app/src-tauri/src/plugin_host.rs), lines 1148–1210. These are different technical limits, not a measured maximum calendar size.

#### Calendar: D: Persistent personal rules

[Instruction loading](../../client/app/src-tauri/src/ai_conversations.rs), lines 240–268 and 1135–1150; [bounded instruction discovery](../../client/app/src-tauri/src/file_tool.rs), lines 310–341, initially includes at most 8192 UTF-8 bytes from `.situate/working-method.md` with a read-more notice. [Working-method tests](../../client/crates/situate-core/src/content/working_method_tests.rs), lines 5–126, cover versioned storage, changes and reopening.

#### Calendar: Recorded checks and remaining gaps

The primary report records **93 passing foundation checks**: `cargo test -p situate-agent --locked` (84), `cargo test -p situate-core --locked working_method` (4), and Vitest for `src/plugins/host.test.ts` plus `src/plugins/executor-supervisor.test.ts` (5). These are recorded synthetic model/tool, storage and plugin-execution results, not Google workflows or calendar-domain accuracy tests.

Remaining evidence gaps concern calendar edge cases, interpretation quality, larger-result coverage and native macOS/iOS end-to-end behavior. The working connector remains a stipulated prerequisite; these evidence questions do not imply a delivery commitment.

### Documents: Source and evidence scope

**Current status and target decision:** Product-owner specification dated **9 November 2026**, summarized here: documents are currently unsupported, no repository implementation is present, and D01–D08 are a tentative target for desired future support.

**Definitions:** The jointly developed capability collection supplies the eight identifiers, names and intended benefits, summarized here in English.

**Product revision:** The catalog's assessed main-application baseline is commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` (5 November 2026). The document status comes from the product-owner specification above, not a technical inspection or practical workflow.

**Evidence limits:** The product specification establishes current non-support. No technical or practical verification is claimed or required to determine that status. The target remains tentative, with no implementation scope or schedule committed.

### Plugins: Evidence and open questions

#### Plugins: Source and report provenance

- **Product/source:** branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` of 5 November 2026. No release version is asserted.
- **R1:** supplied report `Situate_Plugin-Entwicklung_Analyse.md`, titled “Situate: Plugin-Entwicklung durch den integrierten Coding-Agenten”, dated 6 November 2026, at the same main-application commit. It is an external, non-public source, not reproduced here. Its numbered sections and B-references identify the supporting passages. It records code analysis, inspected test sources and inherited execution records. Its separate prototype findings do not establish main-application support.
- **Q1:** [Provider qualification — Native application evidence](../development/provider-qualification.md#native-application-evidence), as stored at the baseline; last source change `cdad8ed2`, 4 November 2026. This is an inherited execution record, not a new run. macOS local/VM journeys use synthetic model responses and owned loopback services; the iOS observations concern a debug simulator app. Historical live-model records predating Rig do not qualify current free-form plugin development.

#### Plugins: Connection and view evidence

For P01, R1 sections 3.1 and B09–B10 and the [plugin host](../../client/app/src-tauri/src/plugin_host.rs), `http`, `credentials` and `dispatch`, establish callable requests and credential storage. At the source revision, `http` accepts a URL, method, headers and optional text body, and returns a status and UTF-8 response body. `credentials` supports reading, storing and removing named device-local values. After a connection plugin is developed and activated through the [source/check/activation path](#plugins-workflow-and-update-evidence), a view, chat tool or consuming plugin can invoke its declared functions. Those functions read supplied authorization values, construct requests, parse the returned text and expose usable source content as serializable export results or tool-result content. Request construction, response interpretation and service-specific authorization logic are ordinary adapter code. This connects access to the result described by P01, rather than just providing an isolated network primitive. HTTP requests and responses are bounded to 1 MiB, have a 30-second timeout and do not automatically retry or follow redirects. A service-specific authorization and renewal flow is connector code, not a generic login supplied by this host.

Q1's native Worker-tool and manual service-export calls against an owned loopback fixture demonstrate real HTTP effects, not real-account authorization. The [connection/platform boundaries](../development/workspace-development-plan.md#connections-and-platform-support) distinguish the connection's public functions from platform-specific access. A plugin's portability does not establish access to every source on iOS. The supported benefit is developing connections through usable interfaces, not completing every possible provider integration without service-specific work.

For P03, R1 sections 3.2–3.3 and B11–B13, [UI contribution validation](../../client/app/src/plugins/contributions.ts), `validateUiContributions`, and [plugin runtime](../../client/app/src/plugins/runtime.ts), `createPluginRuntime`, establish Vue views, settings and reusable components. The [development instructions](../../client/app/src/ai/plugin-development-instructions.md), `defineUI` and service-backed interaction, connect those views to callable functions and shared UI components. No practically verified custom-view usability is inferred from these interfaces.

#### Plugins: Workflow and update evidence

For P02, R1 section 2 and B03/B14, the [service and invocation contracts](../../client/app/src/plugins/types.ts), `PluginServiceContributions`, `PluginInvocationContext` and `PluginHostServices`, and the [development instructions](../../client/app/src/ai/plugin-development-instructions.md) define chat tools, explicit service exports and declared dependency calls. Each admitted call receives its own execution context and cancellation signal. Nested calls pass that context and signal rather than retaining them for unrelated work. The [Worker executor](../../client/app/src/plugins/executor-worker.ts), `invoke`, executes the selected tool or export with that context and returns its result. Q1 records native Worker-tool and manual service-export calls.

For P04, R1 section 2 and B05–B08/B17, [source operations](../../client/app/src-tauri/src/plugin_sources.rs), `dispatch`, [change checks and activation](../../client/app/src-tauri/src/plugin_changes.rs), `prepare`, `request` and `request_inner`, and [publication](../../client/crates/situate-core/src/plugins/publication.rs), `publish`, establish editing, checking selected revisions with dependencies and affected consumers, and activating the checked versions. Relevant source changes require fresh checks; activation waits for affected running actions. Source edits may be durable before activation. Code activation is not a universal data migration or rollback, and technical checks do not establish business correctness or security. Q1 records native activation, revision separation and reopening, not arbitrary free-form model development quality.

#### Plugins: Custom collection workflow evidence

**Product specification:** the supplied P06 definition, dated 7 November 2026, describes a collection with individually chosen fields, categories and relationships. R1 section 3.3 and B12/B17 identify views and persistence. The following code path at the recorded source revision connects the necessary steps; it is code analysis, not an executed collection trial.

| Necessary step                            | Executable path and responsibility                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Develop and make the collection available | The source/check/activation path above accepts a plugin's JavaScript service and Vue view. The plugin declares callable exports; no prebuilt collection component is required.                                                                                                                                        |
| Define and create the collection          | Plugin code can represent its field definitions, records, categories and relationship references as JSON text at a known path. `context.data.write(path, text, null)` creates a new file; native storage initializes its data area and parent folders. Field definitions and serialization are ordinary plugin logic. |
| Capture records                           | A form submits values through `service.invoke`; a chat tool can invoke record logic as well. The service validates values, assigns record identifiers, adds the record to the stored document and writes the changed text.                                                                                            |
| Read and display records                  | `context.data.read(path)` returns text and its revision. Service code parses the text and returns serializable records; the view uses them to display the collection and populate edit controls.                                                                                                                      |
| Change values or relationships            | The service reads the current document, applies field changes or updates references between record identifiers, validates its chosen relationship rules and writes using the read revision. Records and relationships can reside in the same document, so this path does not require a cross-file transaction.        |
| Reopen and continue editing               | The native content store persists the text independently of the view. A later invocation reads the same known path. A stale write is rejected, allowing the plugin to read the current state and resolve the conflicting edit.                                                                                        |

This is one construction using the available interfaces, not a required collection architecture or a finished collection plugin. A known document path suffices for reading and listing its records; the plugin-scoped data store does not need a directory-listing API for this construction. A missing or damaged store must be handled as an error, not silently treated as an empty collection.

The connected sources are [UI service invocation](../../client/app/src/plugins/runtime.ts), `invokeExport` and `service.invoke`; [native export dispatch](../../client/app/src-tauri/src/ai_executor.rs), `plugin_executor`, `Request::Invoke`; [Worker invocation](../../client/app/src/plugins/executor-worker.ts), `invoke`; [host services](../../client/app/src/plugins/host.ts), `createInvocationContext`; [native storage dispatch](../../client/app/src-tauri/src/plugin_host.rs), `Request::Read` and `Request::Write`; [plugin storage](../../client/crates/situate-core/src/plugins/storage.rs), `open`, `read` and `write`; and [content writes](../../client/crates/situate-core/src/content/agent_tools.rs), `agent_write`. The [authoring contract](../../client/app/src/ai/plugin-development-instructions.md) specifies service exports, forms through Vue views and invocation-bound data access.

Plugin storage accepts UTF-8 text up to 1 MiB per file and uses revision-checked writes. Field rules, record identifiers, reference validation, conflict handling and schema conversion belong to the plugin. Cross-file transactions and built-in relational constraints are not supplied by this read/write interface. The bounded single-document workflow above can achieve P06's result without those additional mechanisms. Collection scale, usability and the correctness of a particular plugin's rules remain matters for that plugin's qualification.

#### Plugins: Material open questions

Whether a particular service's authorization and requested operations work remains service-specific. For custom collections, practical usability, appropriate storage layout for the intended volume, and the correctness of field and relationship rules depend on the particular plugin. Free-form model development quality and native iOS suitability also require plugin-specific evidence. These evidence questions concern the particular plugin's implementation and use.

## Open records and scope distinctions

- **Notes and email retrieval:** N03 uses literal workspace searches, folder inspection and model-led reading. E03 uses the stipulated Gmail operations and message metadata. Both cover finding requested information through successive steps, not proving that every relevant item was found. Their source and access conditions remain different.
- **Documents and attachments:** E01's use of suitable attachment readers does not establish D01–D08 document support.
- **Connections:** P01 covers developing a usable connection through accessible interfaces; E01–E07 and K01–K07 begin with a working connector. Authorization and operations for a particular new service still need to be established for that service.
- **Personal guidance:** P05's enabled plugin guidance, K07's central working-method instruction and E02's explicitly read style file are distinct ways to supply context, not a promise that arbitrary files load automatically.
- **Custom collections:** [P06](#p06--create-custom-information-structures) covers developing a collection whose fields, records and relationships can be saved and edited through plugin functions and views. Field validation and relationship rules belong to that plugin, not a shared collection model. Practical usability and rule correctness remain specific to the resulting plugin.

Other open evidence questions concern original Apple Notes access and native note workflows; external task write-back and blocked native-host task checks; attachment-format coverage, quantitative reproducibility and model interpretation; calendar edge cases; and plugin-specific account access and native iOS suitability. The area files describe these limits without turning them into delivery commitments.

## Area and identifier index

Each linked entry owns its benefit, support assessment and evidence.

### Index: Notes

- [N01 — Develop thoughts](#n01--develop-thoughts)
- [N02 — Place content appropriately](#n02--place-content-appropriately)
- [N03 — Retrieve content](#n03--retrieve-content)
- [N04 — Answer questions about notes](#n04--answer-questions-about-notes)
- [N05 — Condense content](#n05--condense-content)
- [N06 — Compare and combine](#n06--compare-and-combine)
- [N07 — Identify patterns and connections](#n07--identify-patterns-and-connections)
- [N08 — Transform content](#n08--transform-content)
- [N09 — Continue and revise notes](#n09--continue-and-revise-notes)
- [N10 — Organize the collection](#n10--organize-the-collection)

### Index: Task management

- [A01 — Derive and capture tasks](#a01--derive-and-capture-tasks)
- [A02 — Structure tasks](#a02--structure-tasks)
- [A03 — Suggest priorities](#a03--suggest-priorities)
- [A04 — Find and summarize tasks](#a04--find-and-summarize-tasks)
- [A05 — Keep tasks current](#a05--keep-tasks-current)
- [A07 — Identify dependencies and blockers](#a07--identify-dependencies-and-blockers)

### Index: Email

- [E01 — Understand emails and conversation threads](#e01--understand-emails-and-conversation-threads)
- [E02 — Compose emails](#e02--compose-emails)
- [E03 — Find information in the email collection](#e03--find-information-in-the-email-collection)
- [E04 — Organize the mailbox](#e04--organize-the-mailbox)
- [E05 — Send and forward emails](#e05--send-and-forward-emails)
- [E06 — Follow up open correspondence](#e06--follow-up-open-correspondence)
- [E07 — Recognize communication patterns](#e07--recognize-communication-patterns)

### Index: Calendar

- [K01 — Capture events](#k01--capture-events)
- [K02 — Find events and get an overview](#k02--find-events-and-get-an-overview)
- [K03 — Find suitable time windows](#k03--find-suitable-time-windows)
- [K04 — Identify conflicts and tight schedules](#k04--identify-conflicts-and-tight-schedules)
- [K05 — Keep events up to date](#k05--keep-events-up-to-date)
- [K06 — Recognize time distribution and patterns](#k06--recognize-time-distribution-and-patterns)
- [K07 — Capture and apply personal calendar rules](#k07--capture-and-apply-personal-calendar-rules)

### Index: Documents

- [D01 — Understand documents](#d01--understand-documents)
- [D02 — Find information in documents](#d02--find-information-in-documents)
- [D03 — Create documents](#d03--create-documents)
- [D04 — Revise documents](#d04--revise-documents)
- [D05 — Compare and combine documents](#d05--compare-and-combine-documents)
- [D06 — Structure and design documents](#d06--structure-and-design-documents)
- [D07 — Organize the document collection](#d07--organize-the-document-collection)
- [D08 — Check documents against requirements](#d08--check-documents-against-requirements)

### Index: Plugins

- [P01 — Connect new data sources](#p01--connect-new-data-sources)
- [P02 — Develop custom tools and workflows](#p02--develop-custom-tools-and-workflows)
- [P03 — Create individual views](#p03--create-individual-views)
- [P04 — Evolve extensions](#p04--evolve-extensions)
- [P05 — Store personal working methods](#p05--store-personal-working-methods)
- [P06 — Create custom information structures](#p06--create-custom-information-structures)

## About this catalog

The [source overview](README.md) and the six area files are the authoritative sources. The complete reading edition is generated from them. Authoring, publication prerequisites and regeneration are covered by the [working framework](working-framework.md).

The catalog complements the [product concept](../product-concept.md), [positioning](../positioning.md) and [requirements catalog](../../requirements/README.md). Requirement approval records a product decision, not delivery. A desired capability does not promise implementation or a release date. Use cases and person- or situation-specific adaptations are outside this catalog.
