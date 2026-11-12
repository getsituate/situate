# Conversation work history: implementation plan

## Scope and reference

Integrate the conversation work-history design from commit `19aeed3d` into the production client. The reference is the Conversation scenario in the [independent Vue workshop](design-workshop.md), starting at `chat-work-history`. Its controls cover differing output shapes; its historical starting states include working, questions, approvals, confirmed changes, stopping and interruption. Approval states are not part of the current execution contract: ordinary actions execute within user requests without allow/deny controls.

This plan defines the integration boundaries and verification gates. Governing constraints are [tool details and content changes](../../requirements/data/requirements/REQ-0040-reveal-tool-details-and-content-changes.md), [plugin-use visibility](../../requirements/data/requirements/REQ-0018-show-plugin-use.md), [working indications](../../requirements/data/requirements/REQ-0039-show-expressive-chat-activity.md), [translations](../../requirements/data/requirements/REQ-0053-enforce-interface-translation-completeness.md) and [application-bound execution](../architecture/04-solution-strategy/application-and-agent.adoc).

### Presentation to carry over

- Answers dominate without visible Answer or Reasoning headings. Model-supplied reasoning remains secondary and supports Markdown.
- A chronological work-history disclosure groups reasoning, actual tool calls and explicitly classified intermediate text. Technical details, including failed and cancelled calls, start collapsed.
- Explicit intermediate text remains visible while working and folds afterward. Unclassified assistant text remains visible; wording, formatting and position never determine its type.
- User messages, questions, plugin-availability notices and confirmed content changes remain outside the collapsed details at their chronological positions.
- Working has a quiet, second-by-second elapsed timer beneath its label. Completed, stopped and interrupted blocks retain their measured duration and outcome in the header, without duplicate stop/interruption banners.
- Tool captions use actual names and validated arguments. Repeated reads of one path do not become several distinct files. Unknown tools retain their names; no model generates captions or summaries.
- Plugin attribution appears only on the supplying call's entry, never on the entire work period. It may remain hidden with the collapsed work history or tool group, including while the call runs. No additional live-use badge is shown.

No provider retries, additional model calls, new execution permissions, synchronization behavior or automatic resumption are part of this change. Keep drafts, attachments, file references, content-history verification, pending inputs and existing recovery actions intact.

## Starting point (client at `19aeed3d`)

| Boundary                                                                                 | Behavior at reference                                                                                                                                                                     | Integration work                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/app/src/components/chat/transcript.ts`                                           | Projects messages, calls, questions, notices and completed work durations. Thinking remains inside message content; durations are attached after assistant messages where possible.       | Project explicit work periods and separate content parts without changing the retained transcript.                                          |
| `client/app/src/components/chat/ChatTranscript.vue`                                      | Renders separate reasoning disclosures and Activity groups, plus a separate stopped block.                                                                                                | Replace these overlapping presentations with the common work-history hierarchy.                                                             |
| `client/app/src/ai/chat.ts`, `work-blocks.ts`                                            | Measures work with `performance.now()` and retains `work_block_end` events with end message counts, durations and outcomes. Pauses work measurement for questions and external approvals. | Expose active work to views and retain sufficient boundaries to associate each history with its actual period.                              |
| `client/app/src/ai/conversation.ts` and `client/crates/situate-core/src/conversation.rs` | Preserve optional text signatures and thinking blocks through validated conversation storage.                                                                                             | Verify classification metadata survives streaming, persistence and reopening; avoid a schema change unless a demonstrated gap requires one. |
| `client/app/src/plugins/runtime.ts`, `client/app/src/ai/tools.ts`                        | Captures the tools available to a run. The transcript's tool view has no authoritative plugin-origin field; `ChatToolCard.vue` currently reads an optional name from result details.      | Carry host-known call provenance from the captured contribution, including before a result arrives.                                         |
| `client/app/src/components/ChatPane.vue`                                                 | Ordinary and development chats share the transcript. Questions and external approvals have dedicated controls; errors also have recovery dialogs.                                         | Wire active work into the shared transcript and distinguish duplicate interruption notices from independent recovery errors.                |
| `client/app/src/components/chat/ChatMarkdown.vue`, `ChatToolCard.vue`                    | Already implement safe Markdown, images, verified changes and historical import loading.                                                                                                  | Reuse these behaviors rather than replacing them with the workshop's simplified renderers.                                                  |

At this historical reference, the pinned Pi SDK could encode `commentary` and `final_answer` in a version-1 `TextContent.textSignature`. This is content-part metadata, not an assistant-message `phase` property. Other responses may supply no classification. That is historical encoding, not the current native contract. Native provider adapters retain explicit text-part classification and protocol continuation metadata; see `client/app/src-tauri/src/ai_protocol_tests.rs` and `client/crates/situate-agent/src/transcript_tests.rs`.

## Delivery sequence

### 1. Define and test the production projection

Start in `components/chat/transcript.ts` and its tests, using application-owned message and tool-activity shapes rather than workshop fixtures.

- Split mixed thinking, text and tool-call content into chronological display entries while preserving the original messages and opaque signatures for provider replay.
- Recognize only supported, explicitly supplied classification metadata. Use the native record's explicit classification; do not restore a Pi signature compatibility reader. Malformed, unsupported or absent signatures leave text unclassified and visible.
- Keep final text visible as it streams. Support reasoning-only, text-only, fragmented, mixed-content and redacted-thinking output without creating empty disclosures or fabricating hidden reasoning.
- Preserve orphan tool results and incomplete calls. A failed write is an attempted call, not a confirmed change. Retain independently verified content effects if a later step fails.
- Group only consecutive compatible calls. Preserve the positions of confirmed changes, user follow-ups, notices and retained questions.

**Exit:** projection tests establish ordering and visibility for these inputs without changing execution or stored message content.

### 2. Make work-period ownership available to the UI

Expose native owner work-period state through `ai/chat.ts` and the reader in `ai/work-blocks.ts`; do not start an execution timer when a Vue component mounts.

- Give each period a stable identity and explicit boundaries in the retained conversation. Record the starting boundary when execution starts, carry it into the completed record and preserve the existing measured duration and outcome.
- Keep work periods distinct from provider runs: one run can pause for a question and contain multiple periods, including periods ending at the same message count. Steering messages do not reset the active period.
- Expose enough active-period state for a view to display elapsed time without writing or broadcasting a conversation update every second. Vue owns only the display refresh interval; the native owner owns measurement and termination.
- Freeze at completion, cancellation or failure. Stop counting while waiting for a question answer, and start the next period only when execution resumes.
- Keep timing correct across pane changes, multiple views and remounts. Reopening retained interrupted work must not resume execution or count time while the application was closed. If a duration was not recorded, show the outcome without inventing one.
- Reconcile boundaries with compaction/checkpoints. Reused message indexes must not attach an older period to unrelated retained text. Preserve unmatched recorded durations separately when a reliable range is unavailable.
- Inventory the runtime writer, reader and native validators before adding persisted fields. Update affected TypeScript/Rust validation and storage fixtures together if the format changes; do not create a second history store or automatically rewrite unreadable records.

**Exit:** runtime tests cover follow-ups, questions, multiple periods, compaction, failure, stopping and reopening. Final duration and the live display use the same measurement source.

### 3. Adapt the shared transcript components

Copy and adapt the workshop's work-history structure and secondary reasoning styles into `client/app/src/components/chat/`. Keep application-specific projection and session state out of `client/packages/ui/`.

- Reuse `@situate/ui` disclosures/buttons and canonical product tokens. Do not import workshop code, styles, fixtures, controls or its simulated clock.
- Retain the production Markdown renderer, image handling, verified change cards, batch-import loading and file-reference behavior. Adapt eager rendering where necessary so opening a history does not expose deferred placeholder space.
- Implement nested history → tool group → call input/result disclosures. Keep failed and cancelled calls folded by default and distinguish their states when inspected.
- Keep deliberately opened history open during streaming updates. Completed intermediate text folds only when the user has not already chosen to inspect it. Expanding details must not reset drafts, change focus unexpectedly or force a scrolled-up reader to the latest message.
- Render the timer with tabular digits and `aria-live="off"`. Announce meaningful state changes, not every elapsed second. Dispose display intervals when hidden or unmounted without changing execution ownership.
- Add interface strings to `client/packages/localization/src/catalogs/en.ui.json` and `de.ui.json`, using existing product keys and formatters where appropriate.

**Exit:** the shared transcript renders both ordinary and development conversations with the same interaction rules, including narrow layouts and keyboard navigation.

### 4. Integrate provenance, questions and recovery

- Bind plugin identity to the captured tool contribution and its call, rather than inferring it from a tool-name prefix or relying on a completed result. Preserve it when the plugin is refreshed or unavailable after the call. Show the identity when its call entry is visible, without opening arguments or results. Let it remain hidden with the folded history or tool group; do not add a live-use badge or global attribution to the elapsed-time heading.
- Keep pending questions in their dedicated controls. Do not introduce action approval controls for ordinary effects. Neither folding the trace nor receiving late output may hide a required decision or send an answer twice.
- Represent normal stop/interruption once in the work-history header and remove the duplicate stopped transcript block. Put inspectable call failures in the trace.
- Do not suppress all of `ChatPane`'s error handling: unreadable history, unsaved conversations, authentication/model-selection problems and failed recovery actions still need their existing actionable presentation. Distinguish these from the terminal status of a work period before changing dialog conditions.
- Keep Mini Bend's separately generated comment outside the work history and preserve its existing shutdown and reduced-motion behavior.

**Exit:** the user can identify the outcome, inspect failures, answer questions, stop ongoing work and recover from save/configuration problems without duplicate routine status messages.

### 5. Verify the product independently

Use the [repository test guide](testing.md), not workshop passes, as the product verification boundary.

1. Extend existing projection, `ChatTranscript`, `ChatToolCard`, `ChatPane`, conversation round-trip and session timing tests. Use controlled clocks rather than real-time sleeps. Add native storage tests only where persisted contracts change.
2. Extend product flows in `client/app/tests/browser/` for working before first output, timer progression, completion, stop/interruption with hidden failed calls, explicit inspection, questions, direct external effects, confirmed changes, call-local plugin provenance hidden with folded history during and after execution, unavailable AI, scrolling and retained drafts. Cover English/German, desktop/mobile geometry, keyboard and touch.
3. Add checkpoints to those flows using `localizationMode: "real"` and the existing `@visual-desktop`/`@visual-mobile` convention. Update intentional baselines with `cd client && npm run test:visual:update`, then run `npm run test:visual` and inspect the PNGs. Keep baseline generation in the locked Docker environment.
4. Run focused checks and the product build first. Run `node tools/test.mjs --quick --changed` for integration feedback. Before a PR, refresh the base and run `node tools/test.mjs --changed --base origin/main` so committed branch changes are included.
5. Check the real macOS client and an iOS simulator/device: opening and closing panes, active work during navigation, elapsed-time continuity, focus, touch targets, keyboard occlusion and lifecycle interruption. Browser profiles do not qualify native iOS behavior. Report missing device/tool prerequisites and unrun checks explicitly.

## Completion boundary

The integration is ready for review when both conversation types match the selected workshop hierarchy, runtime timing survives view changes, message classification remains explicit, failures are inspectable but folded by default, and question, stop and data-recovery controls still work. Qualification requires product tests and native evidence; the workshop commit alone establishes neither shipped behavior nor provider/platform compatibility.
