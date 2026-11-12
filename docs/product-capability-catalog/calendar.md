# Calendar

Documentation date: **9 November 2026**.

## Shared prerequisites and platform scope

All statements below use the [shared email and calendar connector scope](README.md#email-and-calendar-connector-scope). The assumed Google Calendar connector exposes callable operations to search/read calendars and events, query known or shared availability, create/change/cancel events, invite participants and answer invitations. Associated email communication uses the assumed Gmail connector's read, draft and send operations.

This section belongs to the [Product Capability Catalog](README.md) and concerns the **main application**, not the historical prototype or workshop. Working model access, an open workspace and model-readable tool results are required. K01–K07 describe user-requested workflows. The [shared status legend](README.md#status-and-evidence-legend) applies: **Supported** identifies a reachable code path under this scope, not guaranteed model accuracy or release qualification.

**Platforms:** the shared conversation/plugin path supports these assessments for macOS and iOS. macOS additionally provides command execution for calculations; iOS does not. No assessment depends on an iOS shell. The inherited checks do not establish a native end-to-end calendar workflow on either platform.

## Capabilities

### K01 — Capture events

**Benefit:** Situate turns free-form details or existing content into concrete calendar events, asks for missing information when needed and creates the events. It invites participants when requested.

- **Support:** Supported.
- **Prerequisites and limits:** Dates, times, duration and participants must be sufficiently clear before execution. A proposed event in chat is not a created event: the action result determines the reported outcome. If interruption leaves the outcome uncertain, inspect the calendar before repeating the action; successful recovery is not guaranteed.
- **Evidence:** Code analysis; inherited synthetic checks of the general execution path, not event creation. [A](#a-request-tool-result-and-answer), [B](#b-context-and-calculation).

### K02 — Find events and get an overview

**Benefit:** Situate finds requested events and their details and summarizes upcoming days or weeks in an understandable overview.

- **Support:** Supported.
- **Prerequisites and limits:** Search results can be followed by detail reads and further queries; a dedicated semantic calendar index is unnecessary. Larger periods require successive reads. A partial result set does not establish a complete calendar overview.
- **Evidence:** Code analysis; inherited synthetic checks of tool execution. [A](#a-request-tool-result-and-answer), [C](#c-readable-results-and-data-volume).

### K03 — Find suitable time windows

**Benefit:** Situate proposes free periods for an event or time block, considering duration, known availability and personal preferences. It identifies shared windows where participants' availability is accessible.

- **Support:** Supported.
- **Prerequisites and limits:** Proposals use known or shared availability and the user's preferences. Missing availability is not treated as free time. Clarify duration, time zones or recurring-event details when needed; a proposed window is not a booked event.
- **Evidence:** Code analysis establishes that availability and preferences can reach the model for comparison and a proposal. Interval interpretation is inferred from that executable path; its practical accuracy, including daylight-saving changes, all-day events and recurring exceptions, has not been measured. [Request path](#a-request-tool-result-and-answer), [context and calculation](#b-context-and-calculation).

### K04 — Identify conflicts and tight schedules

**Benefit:** Situate exposes overlapping events and overly tight sequences. It includes known or explicitly assumed travel, preparation and buffer times in the comparison.

- **Support:** Supported.
- **Prerequisites and limits:** Distinguish supplied durations from estimates. Live traffic or route calculation is not established and is unnecessary for comparing events with known or estimated buffers. The result is an assessment, not an enforced scheduling constraint.
- **Evidence:** Code analysis of contextual comparison through the execution path, not a practical traffic or scheduling test. [A](#a-request-tool-result-and-answer), [B](#b-context-and-calculation).

### K05 — Keep events up to date

**Benefit:** Situate reschedules events, changes their details or cancels them. It answers invitations and communicates changes to participants.

- **Support:** Supported.
- **Prerequisites and limits:** Select and read the intended event before modifying it, distinguishing an occurrence from a recurring series where relevant. Invitation responses and separate email messages are distinct actions. A suggested change is not an applied change; interpret success, failure or uncertainty from each action's result rather than claiming delivery from a draft.
- **Evidence:** Code analysis; inherited synthetic checks of tool calls and results, not live event changes or message delivery. [A](#a-request-tool-result-and-answer), [C](#c-readable-results-and-data-volume).

### K06 — Recognize time distribution and patterns

**Benefit:** Situate groups recorded time across days or weeks by activity and explains recurring patterns, such as many short events or few longer free blocks.

- **Support:** Supported.
- **Prerequisites and limits:** Calendar entries describe planned or recorded time, not actual effort. State the period, categories, missing data and treatment of overlapping events so totals are interpretable. Large datasets need bounded reads and intermediate results; neither unlimited coverage nor the quality of interpretations is established.
- **Evidence:** Code analysis of retrieval and model processing, with macOS calculation tools available as an additional aid. No practical calendar-analysis quality check is claimed. [A](#a-request-tool-result-and-answer), [B](#b-context-and-calculation), [C](#c-readable-results-and-data-volume).

### K07 — Capture and apply personal calendar rules

**Benefit:** Situate records the user's scheduling preferences for reuse and considers them when creating, planning, checking or changing events. Preferences can include reserved times for different parts of life and desired gaps between events.

- **Support:** Supported.
- **Prerequisites and limits:** Rules belong to the current workspace, not automatically to every workspace. A bounded portion of the central working-method instruction is loaded automatically; longer instructions and additional notes require explicit retrieval. Durable storage enables later reuse but does not guarantee retrieval or technically enforce rule compliance. Examples are not rules to install for any particular person.
- **Evidence:** Code analysis; inherited synthetic storage/reopening checks. [B](#b-context-and-calculation), [D](#d-persistent-personal-rules).

## Evidence and review state

**Source baseline:** branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d`, 5 November 2026. No released version is claimed.

**Primary report:** `bundle:Kalender-Faehigkeiten_Fact-Check.md`, titled “Situate: Kalenderfähigkeiten im Fact-Check”, dated 7 November 2026. Its main-application assessment, shared limits and evidence groups A–D support K01–K07. The external research collection remains outside Git; its historical prototype findings are not evidence for this application. References below identify the public source locations recorded in that report at the baseline revision.

### A: Request, tool, result and answer

[Chat submission](../../client/app/src/ai/chat.ts), lines 889–950; [native conversation integration](../../client/app/src-tauri/src/ai_conversations.rs), lines 572–606 and 990–1032; [agent execution loop](../../client/crates/situate-agent/src/execution.rs), lines 385–628. Together these connect user requests, available plugin tools, sequential execution, retained results and model responses, including errors.

### B: Context and calculation

[Built-in tool definitions](../../client/app/src-tauri/src/ai_builtin_tools.rs), lines 9–107, provide reading, search, writes, clarification and optional command execution. [Platform tool availability](../../client/app/src-tauri/src/files.rs), lines 1157–1200, distinguishes macOS command access from iOS. General model computation supports the qualitative assessments; it is not evidence of calendar-domain accuracy.

### C: Readable results and data volume

[Plugin-result validation](../../client/app/src-tauri/src/ai_executor.rs), lines 1105–1212, accepts bounded content blocks. [Model protocol conversion](../../client/app/src-tauri/src/ai_protocol.rs), lines 76–89 and 511–583, sends those blocks, not automatically separate metadata. [Context compaction](../../client/crates/situate-agent/src/compaction.rs), lines 73–154, bounds retained model context. The report records up to 128 result blocks, a 128-model-round guard and a 1 MiB response limit in the [native HTTP helper](../../client/app/src-tauri/src/plugin_host.rs), lines 1148–1210. These are different technical limits, not a measured maximum calendar size.

### D: Persistent personal rules

[Instruction loading](../../client/app/src-tauri/src/ai_conversations.rs), lines 240–268 and 1135–1150; [bounded instruction discovery](../../client/app/src-tauri/src/file_tool.rs), lines 310–341, initially includes at most 8192 UTF-8 bytes from `.situate/working-method.md` with a read-more notice. [Working-method tests](../../client/crates/situate-core/src/content/working_method_tests.rs), lines 5–126, cover versioned storage, changes and reopening.

### Recorded checks and remaining gaps

The primary report records **93 passing foundation checks**: `cargo test -p situate-agent --locked` (84), `cargo test -p situate-core --locked working_method` (4), and Vitest for `src/plugins/host.test.ts` plus `src/plugins/executor-supervisor.test.ts` (5). These are recorded synthetic model/tool, storage and plugin-execution results, not Google workflows or calendar-domain accuracy tests.

Remaining evidence gaps concern calendar edge cases, interpretation quality, larger-result coverage and native macOS/iOS end-to-end behavior. The working connector remains a stipulated prerequisite; these evidence questions do not imply a delivery commitment.
