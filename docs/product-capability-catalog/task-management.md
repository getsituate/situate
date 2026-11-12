# Task management

Documentation date: **9 November 2026**.

## Shared prerequisites and platform scope

These capabilities work with task information in writable workspace files in the main application. The [evidence record](#evidence-record-and-open-points) identifies the assessed revision and report.

For A01–A05 and A07, the supported path is user-requested conversation with working model access and connected workspace search, read and write tools. Tasks may be text checkboxes with identifiers and other information in files; support does not require a standardized task-management module or a dedicated menu item. The model can ask for missing information and act on tool results. Goals, notes and project context must be supplied or explicitly read; only the agreed working method is included automatically in bounded form.

| Platform | Assessed scope and limits                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Writable local workspaces. Optional dictation requires Apple Silicon, microphone permission and the speech model; transcription becomes an editable draft that the user submits. No microphone or native task journey was qualified by this investigation. |
| iOS      | Application-local workspaces only. External document-provider locations do not support this conversation/write path; dictation is unavailable. These are code-based findings, not native iOS qualification.                                                |

Ordinary execution requires the application and workspace to remain open. Imported files are local copies: editing them does not update their external originals. For A01–A05 and A07, support for external originals is **Unclear** without a specific working integration and its supported operations. General plugin or network facilities do not establish such access. Cross-project work below stays within the accessible workspace; it does not join separate workspaces.

Support follows the [shared status legend](README.md#status-and-evidence-legend). **Supported** below means an evidenced reachable path under these conditions, not guaranteed model judgment quality or a qualified release. All implementation references use the source revision above; code analysis and synthetic results are inherited from the fact-check.

## Capabilities

### A01 — Derive and capture tasks

**Benefit:** Turn free-form thoughts or existing notes into clearly worded, actionable tasks. Clarify missing information and save the resulting tasks with suitable tools.

**Support:** Supported.

**Prerequisites and limits:** Supplied text can be analyzed directly; stored notes must first be read. The model can create a task file or edit an existing one. A suggestion in chat is not a saved task: a successful file write is required. Speech input has the platform limits above.

**Evidence:** Code analysis; inherited Synthetic check of storage, not task-extraction quality. The report's [shared request/read/write path](../task-management-capabilities-fact-check.md#shared-implementation-evidence) connects conversation to real tools; its [A01 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) cover dictation and draft submission. Recorded storage tests exercise actual temporary-file writes.

### A02 — Structure tasks

**Benefit:** Group tasks and divide larger undertakings into manageable steps. Select work across projects by criteria such as estimated completion time, then use the selection in chat or save its structure in task files.

**Support:** Supported.

**Prerequisites and limits:** Accessible task files can inform a temporary chat selection, or groups, project labels and nested tasks can be saved in files. Project/subtask relationships are not centrally enforced. A selection such as tasks estimated to take less than five minutes must distinguish model estimates from recorded durations; relevant project data must be read first.

**Evidence:** Code analysis; inherited Synthetic checks of metadata and storage. The [A02 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `metadata.rs:48–125, 614–628` and the import-preservation fixture. The report records 17 metadata tests and one import-preservation test passing; they do not assess duration estimates or grouping quality.

### A03 — Suggest priorities

**Benefit:** Propose a reasoned order of work based on known goals, deadlines and dependencies.

**Support:** Supported.

**Prerequisites and limits:** The user requests the assessment and supplies the relevant context, or the model reads it from accessible files. A suggested ordering is neither a saved priority change nor calendar scheduling. Unknown deadlines, dependencies or goals must remain explicit gaps rather than invented facts.

**Evidence:** Code analysis establishes that task context and file contents reach the model for a reasoned proposal. The quality of the proposed priorities has not been practically evaluated. [Source details](#priority-and-search-evidence).

### A04 — Find and summarize tasks

**Benefit:** Find relevant tasks and summarize open work, upcoming deadlines and progress so the user can understand the current workload.

**Support:** Supported.

**Prerequisites and limits:** Situate can search for tasks, read candidate files and refine the selection with the user. A summary covers the task records actually obtained. For a complete workload count, agree which files and time period belong in the result and account for unreadable files or changes during the search; a first set of search matches is not a complete inventory.

**Evidence:** Code analysis establishes search followed by reading and summarization. The report contains no successful native-host search/pagination test run. [Search mechanics and evidence](#priority-and-search-evidence).

### A05 — Keep tasks current

**Benefit:** Update task descriptions, dates and progress from new information, saving the changes rather than merely proposing them.

**Support:** Supported.

**Prerequisites and limits:** The model reads the intended task and edits its file using the current revision and uniquely matching text. Successful writes reach durable storage; stale or ambiguous edits are rejected. Agent writes are limited to 1 MiB, and partial-save warnings require attention. Dates and states are file content, not universally standardized task fields. The local-copy boundary above applies to imported tasks.

**Evidence:** Code analysis; inherited Synthetic check. The [A05 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `files.rs:1429–1499` and `content/agent_tools.rs:152–216`. Four recorded agent-tool tests cover real temporary-file writes/history, stale and ambiguous edits, and size/failure handling; they are not a model-driven editing journey.

### A07 — Identify dependencies and blockers

**Benefit:** Identify what must be clarified or completed before other tasks can proceed, making missing prerequisites and blocking work visible.

**Support:** Supported.

**Prerequisites and limits:** Accessible task descriptions, known states and user-supplied prerequisites can be analyzed on request. Explicitly recorded dependencies must remain distinguishable from inferred, potentially incorrect relationships. A dedicated dependency field is not required; the result identifies relationships that A03 can use, rather than enforcing a dependency graph.

**Evidence:** Code analysis. The [A07 anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `ai_conversations.rs:629–671, 729–812` and `ai_builtin_tools.rs:14–35`, connecting task context and reads to model reasoning. No real-model dependency or blocker-quality test is recorded.

## Evidence record and open points

- **Product/source:** Main application, branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` (5 November 2026). The source revision, not the documentation date, identifies the assessed product.
- **Report used:** [Task-management capabilities: fact-check](../task-management-capabilities-fact-check.md), investigation date unstated, at the same source revision. The Markdown report is the evidence input; its PDF derivative is not independent evidence.
- **Inherited checks:** The report's [execution record](../task-management-capabilities-fact-check.md#checks-actually-performed) records four agent-tool tests, 17 metadata tests and one import-preservation test passing with synthetic data. These establish component behavior, not an executed end-to-end task workflow. The native-host `file_tool::tests` run stopped before tests because the media helper could not link against the macOS 27 SDK stubs.

### Priority and search evidence

For A03, the report's [capability-specific anchors](../task-management-capabilities-fact-check.md#capability-specific-anchors) identify `ai_conversations.rs:629–671, 729–812` and `file_tool.rs:170–214`: context and file reads reach the model through the conversation/tool loop. This establishes a route for considering known goals, deadlines and dependencies, not the quality of any particular priority judgment.

For A04, the same report identifies `file_tool.rs:215–307`, `files.rs:1501–1559` and `content/mod.rs:1026–1059`. Search is exact and case-sensitive, returns at most 200 results per page and provides matching-line excerpts rather than complete task records. Further pages and file reads can extend the inspected scope. Ordinary search excludes technical paths and symbolic links; files above 16 MiB cannot be read. These limits matter when interpreting counts and collection-wide conclusions, not merely because a question needs several searches.

### Material gaps

Model quality for extraction, estimates, priorities and inferred blockers remains unmeasured. The report provides no successful native-host search/pagination run or qualified GUI task journey, iOS workflow, microphone-to-task flow or live-provider workflow. External task access and write-back depend on a specific working integration; local-copy support does not establish them.
