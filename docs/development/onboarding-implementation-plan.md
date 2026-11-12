# Conversational onboarding

## Scope and decisions

The macOS workflow follows the [onboarding foundations](../../requirements/data/foundations.md#onboarding-and-contextual-learning), [workspace creation](../../requirements/data/requirements/REQ-0045-create-local-workspaces.md) and [source-preserving import](../../requirements/data/requirements/REQ-0036-convert-imported-notes-and-tasks.md). This guide does not cover iOS onboarding, post-setup tutorials or arbitrary-source qualification.

Creation and explicit verification of usable device-local AI access precede the starting brief. The brief captures sources, import intent and working preferences together. Starting without imported content is independent of preserving or changing a working method. One retained conversation then covers source exploration, reviewed instructions, import and optional support. No named-method catalogue or second source interview is required.

Source inspection informs the proposal; actual import follows explicit confirmation of the current instructions and source scope. A written answer is feedback, not confirmation. Sources and imported content remain untrusted data. Available shell execution is unrestricted under the existing host contract; inspection instructions are not a filesystem sandbox or a guarantee that arbitrary commands are read-only.

The [workshop](design-workshop.md) remains an independent design reference. Its selected scenarios are `first-entry`, `first-entry-create`, `first-entry-ai`, `first-entry-model`, the `setup-conversation-*` states and `chat-question*`. Synthetic replies, timing and geometry are not production or provider qualification.

## Progress and routing

`client/app/src/onboarding/session.ts` owns revision-checked progress through the native onboarding API. `client/crates/situate-core/src/onboarding.rs` retains the schema-1 record, file locking, bounded decoding, compare-and-swap and durable replacement. Workspace creation publishes identity and initial progress before admitting the new workspace. Failed durability acknowledgements remain failures even when matching bytes can be read back.

The record separates:

- the current setup phase and reviewed instruction version;
- one canonical `conversationId`;
- `sourceDescription`, working preferences, `fresh` and `intent`;
- `entered`, which permits normal app use without declaring setup complete;
- verified imported references and optional support choices;
- `complete`, which permits final development handoff.

Legacy phase-conversation IDs remain readable for continuation; they are not merged into a fabricated transcript or deleted. Unknown or malformed progress must not be reset. Existing workspaces without an onboarding record remain established.

`OnboardingHost.vue` observes the workspace-owned session and chat; its unmount does not own or cancel an admitted import. `App.vue` switches presentation and opens the same conversation through semantic navigation. Returning to guidance retains the draft, attachments, questions and execution state. Workspace closure and application quit retain their existing execution and save guards.

## Questions and decisions

`ai/question.ts`, `ai/question-tool.ts` and `ai/chat.ts` provide conversation-owned questions. The active question, suggested answers and full composer share one surface. Suggestions submit directly without replacing an unrelated draft. Free text remains available independently of the suggestion list; extra suggestions are disclosed rather than dropped. Answered questions remain readable.

A question is a durable input boundary, not an unresolved tool Promise or an external-action approval. Pending questions stop further model turns, later calls in the same tool batch and automatic queue continuation. Reopening displays retained questions without resuming a model or replaying effects.

An answer and its user message are acknowledged before a host action or another model request. Host-created onboarding context binds decisions to the current conversation, proposal and source scope; generic model questions cannot supply that context. Stale decisions must be rejected without consuming input. A failed accepted host action is retained for explicit retry, not replayed on reopen. Native instruction and progress writes remain separate operations: retries must reconcile exact state and obtain a successful native acknowledgement rather than treating visible bytes as proof of durability.

The native-prepared working-method proposal and source scope are retained for inspection before adoption. Confirmation publishes the method at `.situate/working-method.md`; root `AGENTS.md` and other user files are not instruction sources. Method questions retain their own read-only preview, including explicitly recovered current-file reviews that have no new model tool result. Later file edits do not change that retained preview. File publication uses revision-checked storage and preserves existing identity. Optional support choices do not execute development; final confirmation saves later ideas as ordinary notes and records completion.

## App entry, finale and development

After method confirmation, `enterSetupApp` records only `entered`. It does not abort import, set completion or dispatch development. Native workspace admission accepts this entered state while preserving the complete-only gate for development preparation. A later explicit instruction review keeps entry and the last acknowledged instruction revision; it cannot import until the new proposal is confirmed. The native save transition rejects first entry during a proposal review.

The existing finite finale accompanies the first app entry. Persisting entry before playback makes it an at-most-once presentation: a crash may interrupt it, but does not justify replay. Early entry and final guided entry use the same animation, Skip and reduced-motion behavior. Finishing later in the app does not add another finale.

Explicit final handoff and app entry permit selected development chats to start in parallel. Stable request/child identities preserve edited or interrupted children and prevent an ordinary reopen from resending their work. Failed starts use normal development recovery. Setup does not wait for plugin construction to finish.

## Import publication

[ADR-0012](../architecture/09-architecture-decisions/ADR-0012-unify-git-anchored-file-references.adoc) uses general versioned writes and bounded batch creation for prepared imports. These capabilities also serve later ordinary conversations without an active setup role. Scripts read and convert sources; native tools publish the prepared destination content. Originals remain unchanged. A missing prebuilt importer does not exclude an otherwise accessible source; permission and format blockers remain visible.

Import preserves supplied source content, metadata, links and attachments. Format conversion retains their meaning, and ordinary writing saves the supplied contents. Use `write` with `expectedRevision: null` and `prepareCopy: true` for a new converted copy; corrections use revision-checked `write` or `edit` without copy preparation. Files receive no UUID. Shared native preparation regenerates copied task IDs and recognized task-identity links. A task comment with `situate-task-id: null` requests a fresh native task UUID without inventing a provisional one; unmarked checkboxes remain ordinary checkboxes.

`create_batch({manifestPath, prepareCopy: true})` accepts a workspace-relative JSONL manifest under `.situate/batch-<name>.jsonl`, with one `{"path":"destination.md","text":"complete Markdown"}` object per copy. Parents must exist and destinations must be absent. Limits are 256 files, a 32 MiB manifest, 1 MiB per prepared file, a 60 KiB encoded destination list and 4,096 prepared task identities.

A batch shares a history boundary, not an all-or-nothing transaction. Only returned verified files establish publication; the task identity map can include planned unpublished copies. Live references require acknowledged history. Partial retries inspect current results, publish only missing destinations and reconcile cross-batch links through revision-checked edits. Never replay an entire manifest after an uncertain outcome. Remove temporary conversion helpers only after acknowledged completion.

Completed import changes load from their exact Git snapshot. Partial results without a completed snapshot display only content still matching the acknowledged revision. Progress-recording failure preserves an already-saved file and reports the failure without replaying its write. App entry does not remove import-role recording or relabel missing scope as complete.

## Verification

Follow [the test guide](testing.md) and use Volta. Product tests, native persistence checks, visual references and workshop tests establish different boundaries. Fixtures use synthetic workspaces, sources and accounts without paid provider calls or personal data.

```sh
# Affected fast checks.
node tools/test.mjs --quick --changed

cd client
npm run check --workspace @situate/client
npm run test --workspace @situate/client -- src/onboarding src/ai/question.test.ts
npm run test:browser -- onboarding.spec.ts
npm run build
npm run test:agent -- --journey onboarding

# Intentional product visual changes: locked Linux/amd64 image.
npm run test:visual:update -- --grep 'onboarding|initial brief|clarification|current proposal|Open app during import|support choices|progress durability'
npm run test:visual -- --grep 'onboarding|initial brief|clarification|current proposal|Open app during import|support choices|progress durability'
```

Important boundaries include explicit access checks, fresh/keep independence, current-proposal binding, written feedback without approval, stale and duplicate answers, failed acknowledgements, restart without replay, entry during an active import, guide/app draft retention, legacy progress, unchanged originals, partial batches and final-only development starts. Inspect intentional screenshots; missing or obsolete references must not be hidden by weakening the checks.

The earlier live `gpt-4.1-mini` JSON/Markdown journeys predate the conversational workflow and do not qualify it. New live/provider testing needs separate authorization and the native harness's existing request, token, time and credential-isolation limits. No browser or fixture result qualifies arbitrary source apps, real provider reliability, VoiceOver, physical second-Mac continuation or iOS onboarding.
