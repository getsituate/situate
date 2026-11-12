# Task-management capabilities: fact-check

## Capabilities examined

These seven capabilities are the assessment targets, not evidence of implemented features. The findings below distinguish chat suggestions from saved results and local tasks from external originals.

- **A01 — Derive and capture tasks:** Turn free-form thoughts or existing notes, such as meeting minutes, into clearly worded tasks. Clarify missing information when needed and use a suitable tool to save tasks; for stored notes or speech input, include the necessary reading or transcription step.
- **A02 — Structure tasks:** Group tasks, break larger undertakings into manageable steps, and select tasks across projects using situational criteria—for example, ten tasks likely to take less than five minutes each. Distinguish a temporary chat selection from saved groups, project assignments or subtasks, and estimates from recorded durations.
- **A03 — Suggest priorities:** Use known goals, deadlines and dependencies to propose an explained ordering on request. Distinguish the suggestion from a saved priority change or calendar scheduling; autonomous planning is not required.
- **A04 — Find and summarize tasks:** Find relevant tasks by content and context, and summarize open work, upcoming deadlines and progress. Distinguish the loaded or selected tasks from the entire collection; counts and states must match the scope actually inspected.
- **A05 — Keep tasks current:** Use suitable tools to update an existing task's description, dates or progress from new information and save the result. Distinguish a proposed edit from an executed change, and local changes from updates in a connected task app.
- **A06 — Proactively accompany tasks and daily focus:** Without a new user request each time, compare current tasks with an agreed daily focus at intended times or relevant events, highlight open issues or bottlenecks, and suggest adjustments. This needs a complete trigger-to-model-to-feedback chain; a static reminder or manually requested summary is insufficient. It remains an unavailable, unplanned future idea according to the product-owner status dated 6 November 2026.
- **A07 — Identify dependencies and blockers:** Use task descriptions and known states to identify what must be clarified or completed before other work can proceed. Distinguish explicitly recorded dependencies from inferred assumptions; A07 identifies relationships that A03 may then use for priority suggestions.

## Overall assessment

The current main application supports A01–A05 and A07 on request through conversation, model reasoning, and real workspace file tools—not through a complete, standardized task-management module. This applies to supplied text and accessible local task files, including imported copies; it does not establish access or write-back to an external task app. A06 remains an unavailable, unplanned future idea, consistent with the product-owner status dated 6 November 2026 and the current execution path. Code analysis and the component tests below establish technical mechanisms, not reliable model judgments or a qualified release.

## Current main application

**Scope:** macOS writable local workspaces and iOS application-local workspaces, with working model access. Imported copies are editable locally, but do not automatically follow source changes; import-only write-back is NO and needs a live integration. For **external originals, A01–A05 and A07 are UNKNOWN** without a specific working connection, its permitted sources and supported operations; copied or pasted content can still be analyzed locally. General shell/network facilities are not proof of a particular integration.

| ID / capability                          | Rating                                 | What works / main limit                                                                                                                                                                                                                                                              | Evidence type                               |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| A01 — Derive and capture tasks           | YES — local text/files                 | The model can read supplied text or stored notes, clarify missing information, and create a task file or edit an existing one. Chat suggestions alone are not saved tasks; dictation has the platform limits below.                                                                  | Code; storage tests                         |
| A02 — Structure tasks                    | YES — local text/files                 | Cross-project selections and smaller steps can be proposed; groups, project labels and nested tasks can also be saved in files. Estimated “under five minutes” durations must be distinguished from recorded values; these are not centrally enforced project/subtask relationships. | Code; metadata/storage tests                |
| A03 — Suggest priorities                 | YES — on request                       | Goals, deadlines and dependencies supplied in conversation or read from files can inform an explained ordering. A suggestion is neither a saved priority change nor calendar scheduling.                                                                                             | Code; no judgment-quality test              |
| A04 — Find and summarize tasks           | YES — bounded local scope              | Path/content searches and subsequent reads can support summaries of open tasks, dates and states across local files. Counts describe only the inspected scope, not automatically every task across workspaces or external apps.                                                      | Code; search tests blocked before execution |
| A05 — Keep tasks current                 | YES — local files/copies               | Read the intended task, then change its description, date or state using the file path, current revision and uniquely matching text. The write reaches durable storage; editing an imported copy does not update its original.                                                       | Code; real temporary-file tests             |
| A06 — Proactive daily-focus support      | NO, IN THE CURRENT STATE — future idea | A focus can be stored as text, but the supplied runtime does not connect timed/task-change triggers to a new model review and delivery of its findings. Opening the app or receiving a plugin-availability notice does not provide that chain.                                       | Code; no-model-start fixture passed         |
| A07 — Identify dependencies and blockers | YES — on request                       | The model can analyze accessible descriptions and states, including prerequisites supplied in conversation. Explicitly written dependencies must remain distinct from inferred, potentially incorrect relationships; a dedicated dependency field is not required.                   | Code; no judgment-quality test              |

## Three decisive distinctions

1. **Access and saving.** Chat has connected search, read, clarification and file-writing tools. It receives the agreed working method automatically in bounded form; other goals, projects and notes need conversation input or explicit reads. Tasks can be text checkboxes with identifiers and additional information, not universally standardized date/priority records. Saving checks the current file version; ambiguous edits and partial-save warnings need attention. External iOS document-provider locations cannot support this conversation/write path. macOS dictation requires Apple Silicon, microphone permission and the speech model: recording → local transcription → editable draft → user submission → task tools; iOS dictation is unavailable.

2. **Coverage and quality.** Search matches exact, case-sensitive text: at most 200 results per page, with short matching-line excerpts. Full reads require further pages; files above 16 MiB cannot be read and agent writes are limited to 1 MiB. Ordinary searches exclude technical paths and symbolic links. Whole-stock claims need complete reads, attention to errors and exclusions, and rechecking changes during collection. Access alone proves neither accurate estimates nor good priorities or inferred dependencies. No real-model task-quality, microphone or external-account test was performed.

3. **Proactivity needs more than stored focus.** Submitted requests, answers and previously queued user requests drive work; plugin notices do not start a review, and reopening interrupted work does not restart it. The application and workspace must remain open for ordinary work, but that does not supply A06. Proactive comparison and delivery require product changes, not just setup or a timer. Remaining-time claims also need effort and available-time information, or explicit assumptions. A06 is not recommended for prioritization.

## Evidence

### Revision and provenance

These findings and test results refer to the original code investigation, not a new runtime qualification.

- Main application: branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d`.
- The working tree was clean initially. No tracked product-code changes were present at completion. Unrelated untracked reports `docs/note-capabilities-fact-check.md`, its PDF, and `docs/email-capabilities-fact-check.md` appeared during the review; they were neither changed nor used as evidence. The Markdown report was the only file added by the original code investigation; subsequent PDF rendering did not change product code.
- **D — A06 product status:** the product-owner statement dated 6 November 2026 identifies proactivity as unavailable and not planned. The technical assessment above was made independently from the current code.
- [Root README](../README.md), line 5, still describes an empty shell without chat. The executable paths below supersede that description for this assessment; documentation alone was not used to deny current capabilities.

### Shared implementation evidence

Paths and line numbers refer to the reviewed commit; `C` means code analysis, `T` an executed test, and `D` documentation only.

- **C — Request and tool connection:** `client/app/src/ai/chat.ts:874–924` submits input; `client/app/src-tauri/src/ai_conversations.rs:578–610, 729–812, 866–912` captures tools/instructions, calls the model and executes file tools with results returned to it.
- **C — Available data/tools:** `client/app/src-tauri/src/ai_builtin_tools.rs:9–120`; `client/app/src-tauri/src/file_tool.rs:170–214, 310–340`; `client/app/src-tauri/src/ai_conversations.rs:629–671` cover registration, prior submitted conversations, bounded working-method context, references and attachments.
- **C — Storage and platform boundaries:** `client/app/src-tauri/src/files.rs:763–789, 1324–1337, 1429–1499`; `client/crates/situate-core/src/content/agent_tools.rs:42–75`; `client/app/src-tauri/src/shell_host.rs:32–60` connect capabilities to versioned local storage and distinguish macOS processes from unavailable iOS shell execution.
- **C — External access is infrastructure, not a proven connector:** `client/app/src/plugins/host.ts:12–85` exposes file, credential, process and HTTP operations; `client/app/src-tauri/src/ai_conversations.rs:590–596, 1135–1156` offers captured plugin tools and distinguishes import copies from originals. No specific installed external task connection was supplied or exercised.

### Capability-specific anchors

These supplement the shared chat/read/write path above; they do not imply additional end-to-end tests.

| ID  | Main application: file and line                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | `client/app/src-tauri/dictation/Sources/SituateDictation/Dictation.swift:178–266`; `client/app/src/dictation/draft.ts:13–49`; `client/app/src-tauri/src/dictation.rs:105–124, 205–225` |
| A02 | `client/crates/situate-core/src/metadata.rs:48–125, 614–628`; `client/crates/situate-core/src/content/import_batch/tests.rs:198–220`                                                   |
| A03 | `client/app/src-tauri/src/ai_conversations.rs:629–671, 729–812`; `client/app/src-tauri/src/file_tool.rs:170–214`                                                                       |
| A04 | `client/app/src-tauri/src/file_tool.rs:215–307`; `client/app/src-tauri/src/files.rs:1501–1559`; `client/crates/situate-core/src/content/mod.rs:1026–1059`                              |
| A05 | `client/app/src-tauri/src/files.rs:1429–1499`; `client/crates/situate-core/src/content/agent_tools.rs:152–216`                                                                         |
| A06 | `client/crates/situate-agent/src/actions.rs:8–53, 190–206, 380–389`; `client/crates/situate-agent/src/lib.rs:193–269`; `client/crates/situate-agent/src/owner_tests.rs:1700–1726`      |
| A07 | `client/app/src-tauri/src/ai_conversations.rs:629–671, 729–812`; `client/app/src-tauri/src/ai_builtin_tools.rs:14–35`                                                                  |

### Checks actually performed

Commands ran from `client/`, through the repository's coordinated queue and Volta-selected Node toolchain. Existing fixtures used synthetic content; no personal tasks or accounts were modified.

| Command                                                                                                                                                | Result and meaning                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo test --locked -p situate-core content::agent_tools::tests`                                                                                      | **4 passed:** real temporary-file writes/history, stale-edit and ambiguity rejection, size/failure handling; not model-driven task selection.                                                 |
| `cargo test --locked -p situate-core metadata::tests`                                                                                                  | **17 passed:** task identities, nested tasks, copy preservation and malformed metadata.                                                                                                       |
| `cargo test --locked -p situate-core content::import_batch::tests::general_creation_preserves_nested_metadata_attachments_links_and_cancelled_entries` | **1 passed:** synthetic imported content preserves metadata, links and source-state representation.                                                                                           |
| `cargo test --locked -p situate-agent plugin_notifications_are_validated_receipted_facts_not_new_work`                                                 | **1 passed:** the synthetic host records a plugin notice without starting a model request.                                                                                                    |
| `cargo test --locked -p situate-client --lib file_tool::tests`                                                                                         | **Blocked before tests:** the native build's media helper failed to link against macOS 27 SDK stubs (`unknown architecture arm64e.x1`). Search/pagination tests were inspected, not executed. |

Original repository validation: `node tools/test.mjs --quick --changed` passed both selected suites. `node tools/test.mjs --feedback --changed` passed 16 of 17 suites, including core and agent tests; formatting failed for this report and the unrelated email report. This report's formatting was subsequently corrected and checked separately; the unrelated file was left untouched. This broader changed-file selection does not replace the blocked native-host tests.

No full application build, GUI journey, iOS run or live-provider qualification passed as part of this assessment. Historical platform evidence in [provider qualification](development/provider-qualification.md) is documentation, not a rerun here.

## Next steps

1. **Setup/access:** configure one usable model and writable workspace; explicitly identify which task sources are local copies and which need live access.
2. **Further verification:** provide the intended external connection, then check selected-source coverage, supported fields and write-back with synthetic records.
3. **Further verification:** resolve the native SDK/linker mismatch, rerun the blocked checks and perform a bounded real-model review of extraction, estimates, priorities and inferred blockers. This does not commission A06.
