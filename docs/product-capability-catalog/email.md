# Email

Documentation date: **9 November 2026**.

## Shared prerequisites and platform scope

All E01–E07 statements below use the [shared email and calendar connector scope](README.md#email-and-calendar-connector-scope). The assumed Gmail connector exposes callable operations to search and read messages and complete threads, retrieve relevant sent and received mail, save and update drafts, manage labels and flags, archive, move to trash, send and forward.

The assessed product is the **main application** at revision `27b6831c3e55b2de4a59d6cd32cf1935d373338d`, with working model access and an open workspace. The statements concern account-backed workflows, not pasted messages, imported copies, the historical prototype or synthetic workshop scenarios. Under the [shared status legend](README.md#status-and-evidence-legend), **Supported** denotes an evidenced, reachable path, not guaranteed interpretation quality or a qualified release.

- **macOS:** the conversation invokes registered plugin tools and processes their results; workspace file reads supply additional context. Available shell execution also supports scripted calculations.
- **iOS:** the shared conversation/plugin path supports the same account operations and text reasoning. The macOS shell route is unavailable; deterministic calculations beyond model reasoning require separately callable plugin code. Neither this assessment nor the source report establishes native iOS qualification.
- **Context and outcomes:** the connector must return readable messages and clear operation results. Large selections can require successive reads and retained intermediate findings. An interrupted external operation can have an unknown outcome; establish the account state before deciding whether to repeat it.

## Capabilities

### E01 — Understand emails and conversation threads

Benefit: Summarize individual emails or longer exchanges, explain agreements, and identify outstanding questions or requests.

- **Support:** Supported.
- **Prerequisites and limits:** The agent reads messages and their surrounding correspondence, then answers from that content. Accessible attachments contribute when suitable reading tools support their format. Search previews are not full messages; protected files and unsupported formats remain outside readable content. Images need a compatible model, while PDF/Office content needs suitable extraction rather than an assumed native text reader.
- **Evidence:** Code analysis — R1, E01 and M1/M3; S1/S2 establish result processing and successive reads, S3 the local reading route.

### E02 — Compose emails

Benefit: Draft and revise new messages and replies from bullet points or previous correspondence, adapting tone, length and purpose to the user's preferences. Save and update the resulting drafts in the email account.

- **Support:** Supported.
- **Prerequisites and limits:** Personal style instructions can be read from an accessible workspace Markdown file and applied alongside the retrieved exchange; no dedicated style feature is required. Saving or updating an account draft is a separate tool operation with an observed result. Text in chat or a local file is not a saved Gmail draft, and draft creation does not send it. Style fidelity remains a model-quality question, not an established guarantee.
- **Evidence:** Code analysis — R1, E02 and M1–M3; S1/S2 for draft-tool invocation and returned outcomes, S3 for style-file reading.

### E03 — Find information in the email collection

Benefit: Find relevant messages and specific details by meaning and context, even without an exact subject or remembered wording. Narrow the selection by date or age, sender, subject or attachment presence.

- **Support:** Supported.
- **Prerequisites and limits:** The agent varies searches, reads candidates and refines the selection with the user when needed. Criteria can be applied through search arguments or by filtering retrieved metadata and content; a dedicated semantic index is not required. Pagination and bounded context prevent a first result page from proving complete coverage. Broad or changing collections need an explicit search scope and cutoff; exhaustive recall is not established.
- **Evidence:** Code analysis — R1, E03 and M1/M2; S1/S2 establish successive tool calls with returned content and the context boundary.

### E04 — Organize the mailbox

Benefit: Group messages by content or requested criteria and change their filing and markings. Formulate sorting rules and apply them once to existing messages, including several matching messages.

- **Support:** Supported.
- **Prerequisites and limits:** The agent creates, assigns and removes labels; marks messages read or unread; sets or removes stars; archives messages; and moves them to trash. Multiple messages can be handled through successive calls without requiring a dedicated bulk interface. A batch is not an atomic transaction: retain individual outcomes and distinguish successful changes from failures or uncertain results.
- **Evidence:** Code analysis — R1, E04 and M1/M2; S1/S2 establish execution and per-call outcomes.

### E05 — Send and forward emails

Benefit: Send prepared new messages or replies, and forward existing messages to the intended recipients. This performs the account action rather than merely preparing content or saving a draft.

- **Support:** Supported.
- **Prerequisites and limits:** The agent passes recipients, message content and relevant reply or forwarding context to the corresponding tool and uses its returned outcome. A provider's acceptance is not proof of eventual recipient delivery or reading. A draft, proposed message or ungrounded chat confirmation proves neither sending nor forwarding. Attachment handling remains format- and operation-specific; general forwarding support does not promise arbitrary attachment conversion. After an uncertain outcome, establish the account state before deciding whether to retry.
- **Evidence:** Code analysis — R1, E05 and M1/M2; S1/S2 connect invocation to returned success, failure or unknown outcome.

### E06 — Follow up open correspondence

Benefit: On request, identify across threads who is waiting for the user, whom the user is waiting for, and which answer, decision or promised response remains outstanding.

- **Support:** Supported.
- **Prerequisites and limits:** On request, the agent compares sent and received correspondence and cites relevant message identifiers or passages for the inferred state. Unread status or the existence of any reply does not establish whether a commitment is resolved. Findings depend on current, correctly associated threads and the selected time range.
- **Evidence:** Code analysis — R1, E06 and M1–M3; S1/S2 establish multi-step retrieval and context use. Correct interpretation of obligations has not been measured in a live product workflow.

### E07 — Recognize communication patterns

Benefit: Compare the wording, length or structure of sent emails with observed responses, including whether replies occur, how quickly they arrive and what form they take. Support findings with traceable examples and, where useful, counts.

- **Support:** Supported.
- **Prerequisites and limits:** Agree which messages and period to compare, and associate responses with the relevant sent messages. Examples and counts describe that selection; they do not prove a mailbox-wide trend or that wording caused a response. Reliable rates and timing comparisons need an explicit calculation method, with the macOS/iOS conditions above.
- **Evidence:** Code analysis establishes retrieval, comparison of message content and callable calculation routes. It does not measure statistical or interpretive accuracy. [Quantitative evidence and limits](#quantitative-comparison-and-result-content) distinguish those claims.

## Evidence and open questions

**Product/source:** branch `use-case-validation`, revision `27b6831c3e55b2de4a59d6cd32cf1935d373338d` (5 November 2026).

**R1 — [Email capabilities fact-check: E01–E07 with a Gmail plugin](../email-capabilities-fact-check.md):** investigation date unstated; main-application findings identify the same revision. Its capability entries, shared code references M1–M4 and evidence section document the execution path. The scope of this catalog is set by the product-owner email specification dated 7 November 2026 and the [shared connector scope](README.md#email-and-calendar-connector-scope).

The following code evidence describes how the main application uses the supplied operations at that revision:

| Reference | Source and location                                                                                                                                                                                                                                                                                | What it establishes                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1        | [Conversation host](../../client/app/src-tauri/src/ai_conversations.rs), `prepare_model`; [plugin executor](../../client/app/src-tauri/src/ai_executor.rs), `CapturedTools::invoke` and `plugin_tool_result`                                                                                       | Registered plugin tools reach the conversation, execute with arguments and return validated text/image content and error state.                                                   |
| S2        | [Agent execution](../../client/crates/situate-agent/src/execution.rs), `drive_steps`; [provider protocol](../../client/app/src-tauri/src/ai_protocol.rs), `blocks`, `anthropic_context`, `completions_context`; [context preparation](../../client/crates/situate-agent/src/compaction.rs), `plan` | Successive model/tool steps, retained outcomes, model-visible content and bounded context; disconnected execution records an unknown outcome rather than confirmed non-execution. |
| S3        | [Built-in tools](../../client/app/src-tauri/src/ai_builtin_tools.rs), `definitions`; [conversation host](../../client/app/src-tauri/src/ai_conversations.rs), file-tool dispatch; R1 M3                                                                                                            | Bounded UTF-8/image reads and the return of workspace file content to the model, including readable style instructions.                                                           |
| S4        | [Shell host](../../client/app/src-tauri/src/shell_host.rs), `capability`; [executor worker](../../client/app/src/plugins/executor-worker.ts), `invoke`                                                                                                                                             | macOS shell availability, iOS shell absence and execution of registered plugin JavaScript tools; not a bundled email-analytics tool.                                              |

### Quantitative comparison and result content

For E07, R1 E07/M1/M4 and S1–S4 establish usable message context and executable calculation routes. Reproducible rates or timing comparisons require a stated population, observation cutoff, reply-matching rules, timestamps and treatment of unanswered messages. macOS can use shell scripts for calculations; iOS needs separately callable plugin code for deterministic calculation beyond model reasoning. Model arithmetic alone is not a verified quantitative result. Mailbox-wide measurement and interpretation quality have not been practically evaluated.

For all entries, message bodies, identifiers, timestamps and operation outcomes must reach the model in tool-result `content`; separate `details` or `structuredContent` are not automatically model input. Results and conversation context are bounded, as documented by S1/S2.

### Recorded evidence and open questions

R1 records eight passing prototype tests using temporary plugins and a simulated model. These are not main-application or Gmail workflow evidence. The main-application assessments rely on code analysis S1–S4, not an executed login, live-model conversation, mailbox action or native email journey.

**Material open points:** attachment-format coverage beyond readable content; large-collection coverage and quantitative reproducibility; interpretation, style and citation quality; and native macOS/iOS workflow qualification. These are evidence questions within the stated scope; the working connector remains a stipulated prerequisite.
