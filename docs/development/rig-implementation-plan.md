# Rig replacement: implementation plan

## Decision and scope

Replace TypeScript Pi Agent Core and Pi AI completely in the production application with native, Rig-backed execution, as selected in [ADR-0013](../architecture/09-architecture-decisions/ADR-0013-native-conversation-execution.adoc). This is an implementation plan for the accepted decision, not another engine evaluation. Native execution is wired in the application; release qualification remains open. The direct-action contract in GOAL-0004 requires integration evidence separate from earlier approval-gated fixtures.

The [native conversation building-block view](../architecture/05-building-block-view/level-3/application/agent-integration/native-conversation-execution.adoc) defines the component split and interface ownership.

The native host owns conversation execution, accepted input, tool effects, persistence, cancellation and completion. The frontend sends authorized actions and renders replaceable projections. JavaScript/Vue plugins remain supported; choosing Rig does not remove their execution environment.

Preserve the required conversation, provider, onboarding and plugin capabilities, not compatibility with the prototype implementation or its stored chats. The governing sources remain the [foundations](../../requirements/data/foundations.md), [application-bound lifecycle](../../requirements/data/requirements/REQ-0011-work-on-topics-in-parallel.md), [provider access](../../requirements/data/requirements/REQ-0015-connect-user-provided-models.md), [process history](../../requirements/data/requirements/REQ-0005-record-process-history.md), [decision authority](../../requirements/data/goals/GOAL-0004-decision-authority.md) and [plugin API compatibility](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md).

macOS and iOS are the product targets. Existing Windows, Linux and Android probe evidence remains compatibility evidence, not a commitment to restore those platforms or a prerequisite to Apple delivery. Do not add a server, general multi-engine framework, automatic runtime fallback or a new conversation store.

The repository's development-time Pi coding-agent tooling is outside this replacement. Removing product Pi dependencies does not mean deleting `.pi/`, root development dependencies, historical evidence or required third-party notices.

## Prototype state boundary

The replacement starts with application-owned native conversation and session contracts. Only Pi-era prototype formats verified never to have shipped publicly are excluded from compatibility: their sessions and chats are unsupported, including transcripts, drafts, queues, checkpoints, interrupted runs and onboarding conversation links. Published conversation formats, drafts, queues, checkpoints and onboarding links are existing user data; later changes require compatible storage or a tested, recoverable migration under [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md). Verify release provenance before applying any prototype-state exclusion below.

- Do not implement legacy readers, transcript converters, importers, migrations, dual-format storage, Pi-shaped type replicas or compatibility adapters for that state. Do not reopen, resume or replay prototype conversations through Rig.
- Define the native record format, model context, tool contracts and action/projection protocol for the required product capabilities. Internal interfaces and prototype plugin tool signatures may change with their callers; compatibility with Pi types or the prototype SDK is not an acceptance criterion. Plain JavaScript/Vue plugin authoring remains required.
- Start with fresh native conversation/session state. Reset or exclude only the defined prototype state where necessary; this is not permission to delete unrelated workspace notes, tasks, documents or credentials. A damaged record in the new native format must still retain overwrite protection.
- Reopening, persistence retry and interrupted-state recovery in the rest of this plan refer exclusively to records created by the new native runtime. They do not require a Pi-state migration or a legacy recovery path.
- The compatibility policies for published app versions and public plugin interfaces remain governed by [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) and [REQ-0070](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md). They exempt only verified unpublished prototype formats, not formats shipped in any public release.

## Current implementation

- [`situate-agent`](../../client/crates/situate-agent/README.md) embeds Rig 0.46.0 and owns ordinary, onboarding and development conversation execution through native application host adapters.
- [`ai_conversations.rs`](../../client/app/src-tauri/src/ai_conversations.rs) owns the session-bound registry, actions and bounded subscriptions. [`ai_native_model.rs`](../../client/app/src-tauri/src/ai_native_model.rs) and [`ai_protocol.rs`](../../client/app/src-tauri/src/ai_protocol.rs) implement native request execution and provider protocols.
- [`ai/chat.ts`](../../client/app/src/ai/chat.ts) projects native state rather than running an agent or saving replacement transcripts. New conversation records use version 2 and the `native-conversation-` namespace; prototype history is ignored.
- Native plugin admission, service Workers, manual-operation ledgers and physical executor termination replace UI-owned tool execution. Main-request preparation captures one tool graph per response without changing admitted model settings.
- Product dependencies no longer include Pi AI or Agent Core. The [provider qualification record](provider-qualification.md) separates current native application journeys from historical component and live-service evidence.

There is one execution owner per conversation, with no Pi fallback, dual execution or comparison requests. The remaining release gates below do not authorize restarting the old engine.

## Product contract map

These are current ownership boundaries and verification targets. References identify existing test sources, not a claim that they were run or that the direct-execution contract is fully qualified. Pi type identity and serialization or reopening of verified unpublished prototype sessions are not compatibility obligations. This does not exempt published native sessions.

| Flow and retained state                                               | Native responsibility                                                                                                                               | Behavioral references                                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send, stop, reattach, multiple views, failed saves and explicit retry | One session-bound owner retains admission, execution and failed checkpoints independently of views.                                                 | `ai/native-conversation.test.ts`; kernel `situate-agent/src/tests.rs`                                                                                     |
| Drafts, attachments, references and local model/thinking selection    | Serialize field-specific changes; capture device-local settings without adding them to portable messages.                                           | `ai/chat.test.ts`; `ai/conversation-record.test.ts`; native `ai_preferences_tests.rs`                                                                     |
| Steering, follow-ups, recall and stop restoration                     | Persist pending input before consumption and serialize recall/consume races.                                                                        | kernel `situate-agent/src/owner_tests.rs`; `ai/queue-runtime.test.ts`                                                                                     |
| Attachment bytes and Git-bound references                             | Retain copied inputs and resolve authorized references without replacing retained history.                                                          | `ai/attachment-runtime.test.ts`; `ai/content-references.test.ts`; native `ai_conversations_tests.rs`                                                      |
| Questions, answers and explicit persistence retry                     | Retain pending questions and accepted answer identities; closing a view cannot answer them.                                                         | kernel `situate-agent/src/owner_tests.rs`; `onboarding/agent.test.ts`                                                                                     |
| Direct effects, plugin provenance and observed outcomes               | Persist intent before dispatch; validate captured definitions and executor generations; retain results after cleanup, without allow/deny decisions. | kernel `situate-agent/src/tests.rs`; native `ai_executor_tests.rs`, `plugin_host_tests.rs`; direct HTTP/export cases require updated integration evidence |
| Compaction and work history                                           | Derive request context and save checkpoints and work periods without rewriting source messages.                                                     | kernel `situate-agent/src/compaction_tests.rs`; `ai/work-blocks.test.ts`; `components/chat/work-history.test.ts`                                          |
| Title and activity-comment generation                                 | Keep native auxiliary purposes, settings, cancellation and accounting separate; do not delay main completion or overwrite a manual title.           | kernel `situate-agent/src/auxiliary_tests.rs`; `ai/activity-runtime.test.ts`; `ai/title-runtime.test.ts` covers text normalization only                   |
| Model-access checks                                                   | Test selected access without consuming conversation input or changing setup drafts.                                                                 | `onboarding/model-check.test.ts`; `onboarding/agent.test.ts`; native `ai_transport_tests.rs`                                                              |
| Onboarding, reviewed instructions, import and app entry               | Use the same owner and native onboarding domain; retain acknowledged state without replay.                                                          | `onboarding/agent.test.ts`; `onboarding/questions.test.ts`; native `ai_conversations_tests.rs` covers instruction composition                             |
| Development, handoff, checks and activation                           | Retain development metadata and child identity; supervise checks and activation.                                                                    | `ai/plugin-development-instructions.test.ts`; `ai/plugin-completion-instructions.test.ts`; native `ai_plugin_tools_tests.rs`                              |
| File tools, plugin exports and presentation                           | Use versioned writes, native invocation identities and observed UI acknowledgements.                                                                | native `files_tests.rs`, `ai_executor_tests.rs`; `ai/presentation-client.test.ts`; `plugins/runtime.test.ts`                                              |
| Workspace close, explicit abort and quit                              | Block admission during close decisions; cancellation restores admission; abort drains effects and required saves.                                   | native `plugin_host_tests.rs`, `lifecycle_tests.rs`; kernel `situate-agent/src/tests.rs`                                                                  |
| Provider protocols and continuation metadata                          | Preserve protocol data, native credential/destination admission and cancellation without fallback.                                                  | native `ai_protocol_tests.rs`, `ai_transport_tests.rs`                                                                                                    |

Application paths are relative to `client/app/src/`, native paths to `client/app/src-tauri/src/`, and kernel paths to `client/crates/`.

## Implementation sequence

### 1. Define native product contracts and the fresh-state boundary

**Main locations:** `client/app/src/ai/`, `client/app/src/onboarding/`, `client/app/src/plugins/`, `client/app/src/components/chat/`, `client/crates/situate-core/src/conversation*.rs`.

- Use the [product contract map](#product-contract-map) to port each action and retained state to its native owner and verification case. Include ordinary chats, development chats, onboarding, title/comment generation and model checks, not only the main send/stop flow.
- Use current tests as behavioral references for provider protocols, queues, attachments, references, compaction, questions, direct effects and work history. Port the relevant assertions to native contracts; remove assertions whose sole purpose is Pi/prototype compatibility.
- Define application-owned message, tool, model and projection types directly for the supported product surface. Do not copy Pi's type hierarchy or preserve its serialization as a compatibility interface. Update frontend and plugin callers together.
- Define an explicit native conversation/session format and fresh initialization boundary. Do not add a reader, converter or migration for the prototype format, including its onboarding conversation references.
- Keep validated domain records authoritative. Reuse core storage, versioning and overwrite protection rather than serializing Rig internals into portable history or introducing a parallel store.

**Exit:** every required product flow has a native owner and verification case; application-owned contracts and fresh-state initialization need no Pi types, runtime or stored-state compatibility layer.

### 2. Connect the native owner to application admission and lifecycle

**Main locations:** `client/crates/situate-agent/`, `client/app/src-tauri/src/ai.rs`, native workspace/quit coordination and command registration.

- Implement the production `Host` against existing native storage, authorization, operation leases and tool/request services. Revalidate the captured workspace session inside storage and effect operations, not only at owner construction.
- Retain one owner per workspace-session generation and conversation, independent of panes or observers. Authorize each caller separately; possession of a conversation ID or event position grants no access.
- Serialize creation/admission, submission, draft edits, queue mutations and persistence retries. A lost acknowledgement followed by the same action must not start another run; a reused ID with a different payload must conflict.
- Preserve pre-effect persistence barriers, observed results after cleanup, exact uncertain-write checkpoints and terminal persistence. Read-back is revision reconciliation, not evidence that a failed write became durable.
- Publish stop capability before awaited admission work, including lock acquisition. Once admitted, mutations must outlive loss of their reply channel. Include queued admission in activity and close coordination. Retain execution failures and supervise task termination so a failed worker cannot leave activity permanently waiting; a mutation failure must not release a different, still-draining effect task.
- Integrate cancel-close, abort-and-close, last-window closure and application quit. Wait for owned transport/tool cleanup and required persistence; do not equate task completion with a successful save. Closing one workspace must not stop another.
- On process restart, expose intermediate state and uncertainty from new native records without automatically replaying interrupted work. A surviving suspended process is a different lifecycle from a fresh launch. Prototype Pi state does not participate in admission or recovery.

**Exit:** native host tests prove single ownership, admission races, duplicate submissions, stale-session rejection, observer-independent completion and all persistence failure boundaries through real storage. Close cancellation restores normal operation; explicit abort drains owned work.

### 3. Move all provider adaptation behind native admission

**Main locations:** `client/app/src/ai/adapters.ts`, `api.ts`, `model-catalog.ts`, native AI transport/settings/discovery and provider-platform integration.

- Replace Pi AI request construction, streaming assembly and transcript normalization with native adapters feeding Rig's host-driven model interface. Reuse native HTTP and credential/destination admission; do not introduce upstream credential files, ambient provider configuration or a parallel transport authority.
- Preserve OpenAI Responses and supported Completions, direct ChatGPT access, distinct Codex access, Anthropic Messages, OpenRouter and custom/local endpoints, including keyless configurations where supported.
- Keep connection/account identity, configuration revision, resolved model, thinking settings and destination captured for each request. Preserve discovery, Recommended versus explicit selection, token renewal and separate credential slots. Do not substitute ChatGPT and Codex or add model/provider retry or fallback.
- Port existing wire fixtures before removing JavaScript adapters: streamed text/reasoning/tool arguments, fragmented or malformed events, finish reasons, cancellation/drain, endpoint policy, credentials and safe errors.
- Preserve signatures and provider-specific continuation metadata produced by the native adapters. Define each protocol's mapping to Rig and the new domain record without adopting Pi's transcript encoding. Map cache-read/cache-write and uncached input consistently. Represent unknown usage or cost explicitly in the native contract and its readers; do not invent accounting to satisfy the prototype validator.
- Route model checks, compaction requests, titles and activity comments through native request services too. Keep their purposes, settings, cancellation and results isolated from the main turn; do not allow auxiliary work to consume pending input or overwrite newer user choices.

**Exit:** every existing access/protocol path has deterministic replacement fixtures. Request bodies and credentials remain native; no production provider request or response parser depends on Pi AI or a living WebView. Live-service qualification remains separately recorded.

### 4. Implement complete native conversation semantics and durable history

**Main locations:** `situate-agent`, native conversation storage, `queue-runtime.ts`, `attachment-runtime.ts`, `content-references.ts`, `compaction-runtime.ts`, `question.ts`, `work-blocks.ts` and their current tests.

- Replace the text-only submission surface with the full product input contract: draft text, attachments, identity-bound references, pending input, steering and follow-ups. Persist acceptance before consumption; serialize recall/edit/consume races so input cannot be both recalled and executed.
- Preserve attachment bytes and lifecycle, image blocks, reasoning/redacted reasoning, signatures, tool calls/results, response identity, usage, costs and finish reasons. Keep Git-anchored references and historical content resolution; never guess a new target from a reused path.
- Persist and reopen conversations created by the native runtime, including completed turns, compaction checkpoints, questions, development metadata and interrupted work. Define derived model context and provider continuation rules against the new domain format; do not port Pi-era reopening or transcript conversion. Portable content must not acquire device-local connection/model preferences or fabricated provenance. Preserve recorded native content when deriving request context; damaged native records remain protected from silent replacement.
- Move compaction planning and saved context updates to the owner. Preserve transcript/work-history associations and failure/cancellation behavior without using version-sensitive Rig state as portable recovery data.
- Own questions, answers, work-period timing, tool intent and observed outcomes natively. Execute ordinary actions, including external HTTP writes and manual exports, without approval/allow-deny state. Preserve task intent, account authorization, read-only connector restrictions, capabilities, validation, cancellation/drain and content protections. Reattachment shows pending questions and persistence failures, not an execution approval.
- Keep concurrent conversations independent, including their model selections, queues, auxiliary work and terminal results.

**Exit:** native behavior tests cover the required conversation-state matrix, persistence and reopening of new native records. No test, runtime path or release gate requires loading a prototype Pi session or chat.

### 5. Adapt native tools and supervise JavaScript executors

**Main locations:** native file tools, `client/app/src/ai/*tools.ts`, plugin development/check/source/change/design tools, `client/app/src/plugins/` and native plugin runtime services.

- Connect built-in file/content operations to the same core versioned writes and authorization used by the application. Preserve existing bounds, conflict handling, verified changes and history behavior.
- Capture definitions once per model request and use the same definitions for advertisement, model policy and tool dispatch. Carry actual tool-call identity, captured definitions, arguments and host-known plugin provenance through intent, execution and result events. Preserve structured content and error/outcome distinctions; do not stringify images or metadata into fabricated model text.
- Adapt existing JavaScript/plugin tool implementations behind native-issued invocation IDs and workspace/executor generations. Persist intent before dispatch and observed results after native cleanup. Deduplicate acknowledgements and reject callbacks from revoked generations.
- On executor disappearance, revoke further admission, settle owned native operations, retain observed results or uncertainty and stop affected work without automatic redispatch. `plugins/executor-worker.ts` executes service tools and exports with native-issued invocation contexts; `plugins/executor-supervisor.ts` terminates the Worker. Keep UI-realm view loading separate from service execution. Generation revocation alone does not stop non-cooperative JavaScript; preserve physical executor termination and native operation draining, and do not repeat module initialization or an uncertain invocation on reattachment.
- Keep plain JavaScript and Vue authoring, exported functions, checked plugin activation, development/check completion and workspace closure behavior. Remove Pi-specific tool interfaces instead of adapting them indefinitely. Apply the approved API compatibility period to published interfaces, not the unreleased prototype.
- Route UI-dependent tools through explicit presentation requests and acknowledgements. A missing view cannot fabricate success or hold terminal persistence hostage.

**Exit:** real native/JavaScript boundary tests cover lost executors, late/duplicate replies, blocked or non-cooperative work, question waits, direct HTTP/export execution and cleanup. Native-only work can finish without observers; affected JavaScript work ends accountably rather than silently replaying.

### 6. Replace frontend execution with projections and actions

**Main locations:** `ai/chat.ts`, `components/ChatPane.vue`, shared transcript components, conversation navigation, `onboarding/agent.ts`, onboarding tools and `onboarding/model-check.ts`.

- Define authorized, versioned actions and snapshots for the complete contract, not only text submission. Include draft/queue edits, answer actions, cancellation and explicit persistence retry. Replace prototype frontend APIs and IPC consumers directly; do not retain old commands or transcript-save adapters for compatibility.
- Return a snapshot with a matching event position; stream ordered bounded updates. On gaps, overflow or generation changes, obtain a fresh snapshot without starting work. Test attachment/subscription races and multiple views of the same owner.
- Remove frontend agent construction, execution queues, interruption inference, whole-transcript saving and run-lease release. Keep local focus, scroll and other presentation state, plus input not yet acknowledged by native code.
- Project text/reasoning, tool results, verified changes, work durations, pending questions, queue state and persistence errors without changing their meaning. Preserve existing localization, accessibility, safe Markdown and image rendering.
- Use the same owner path for ordinary, onboarding and development conversations. Preserve setup questions, reviewed working-method confirmation, import outcomes, app entry and development dispatch; do not substitute a minimal file-tool chat for these workflows.
- Preserve connection setup, model selection and activity indicators when a conversation view is closed. Reopening a view attaches to current native state; reopening interrupted work after process exit still waits for interaction.

**Exit:** product browser/native tests pass through the new action/projection boundary. Reload during streaming, a native tool, a JavaScript tool and final persistence retains the correct owner/result or explicit uncertainty without requiring a UI-held turn token.

### 7. Qualify the integrated application and switch production ownership

Dependencies: steps 2–6 must be integrated before changing the default product path. Provider and JavaScript executor work can proceed independently once their host contracts are defined; neither may bypass the same admission and persistence rules.

- Run the [default MVP verification](testing.md), including affected unit, lint/type, build and native journeys. Before a pull request, use `node tools/test.mjs --changed --base origin/main` with an up-to-date base. Before an Apple release, run the full MVP suite. Use Volta and the repository's coordination/resource rules.
- Exercise the production boundary with deterministic model/tool services: observer loss, lost submission/result acknowledgements, event gaps, simultaneous views, queue recall/consumption, each save failure, executor revocation, late callbacks, workspace switching and close/quit races.
- Build/link and execute the actual owner/storage/provider/plugin integration in the macOS application and an iOS hosted application. Probe-only libraries and shell binaries are not substitutes.
- Qualify physical-device iOS background expiration, surviving-process suspension/return, process termination, protected storage and foreground recovery. Record unavailable prerequisites as open release evidence; simulator success does not close these cases.
- Check signed/release packaging, startup/bundle loading, resource behavior, cancellation responsiveness, minimum toolchain compatibility and third-party notices. No new performance threshold or store-approval claim is implied by the spike.
- Keep live-provider enrollment/inference separate from deterministic verification and obtain explicit authorization for charges or account/device interaction. Do not relabel existing Pi-era evidence as Rig qualification.
- Cut over at a stopped/quiescent application boundary so the old process cannot keep writing or executing effects. Start fresh native conversation/session state; preserving or saving prototype chats is not a cutover requirement. Do not translate a live Pi heap, migrate stored Pi conversations or repeat their effects.
- Switch all product conversation and auxiliary-request entry points together once the required behavior and platform gates pass. Do not leave a hidden Pi fallback or two active owners. If a gate fails, fix the replacement before cutover rather than replaying work through the old engine.

**Exit:** the production application uses the native owner for all execution and completion; required behavior and Apple-platform evidence are recorded with their actual limits. The original reload/save-ownership failure has an end-to-end regression, not only a kernel test.

### 8. Remove obsolete product code and consolidate tests

- Remove `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` from product dependencies and regenerate the client lockfile through the package manager. Remove remaining runtime/type imports, Pi-only provider adapters, `provider-env.browser.ts`, Vite compatibility hooks and obsolete transport commands after their last consumers move.
- Audit generated catalogs, build scripts, plugin SDK exports, browser/native fixtures and packaged bundles. Remove Pi runtime and type dependencies, lazy imports, copied compatibility type replicas, legacy session readers and transcript converters. Do not retain prototype transcript fixtures as a supported format.
- Preserve useful behavioral/fault-injection tests under the production owner and integration suites. Replace Pi mocks with native fixtures for the required behaviors; remove Pi-only type/serialization/session compatibility tests. Remove standalone spike-only harnesses/output rules once equivalent native product coverage exists, updating their documentation/evidence links; do not delete kernel regressions simply because they originated in the spike.
- Preserve required attribution for code retained or ported from Pi. Keep development-time Pi tooling and historical decision/source references unless an independent change calls for their removal.
- Update architecture package/runtime views and provider qualification to describe the shipped implementation. Review engine-specific terminology in approved requirements without changing their IDs, behavioral meaning or historical sources.

**Exit:** no product path needs Pi to build or run, and no Pi-state compatibility implementation remains. New native conversations and required plugin capabilities work through the replacement; tests exercise native contracts rather than a fallback or legacy adapter.

## Completion boundary

Rig selection is settled. Implementation is complete only when all production paths have moved, the required product capabilities work with fresh native state, Pi product code and dependencies are removed, no prototype session/chat compatibility layer remains, and the integrated application has the required verification evidence. Library compilation, a working text-only chat or a passing standalone probe alone does not meet that boundary.
