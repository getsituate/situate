# Native conversation owner

Application-owned conversation execution using Rig 0.46.0 with default features disabled. The native application supplies admitted provider transport, device-local settings, reference/attachment resolution, tools, onboarding actions and resource cleanup through `Host`. This crate supplies no credentials, provider transport or independent conversation store.

Only version-2 native conversation records are accepted. Prototype conversation formats are not migrated or converted.

## Authority and persistence

Canonical Situate messages are the provider-request and persistence authority. They retain continuation data, response identity, structured tool results and supplied accounting. Null accounting remains unknown; it is not replaced with zeroes. Rig sees only a derived scheduling projection. Its message serialization, accounting and provider metadata never replace the domain record.

Accepted input, model/tool intent, observed results, question answers and terminal state cross awaited persistence barriers. Failed publication retains the actual attempted checkpoint and later observed state. Read-back reconciles revisions but does not acknowledge durability. `retryPersistence` retries retained writes without repeating generation or effects.

The host must retain one owner per admitted workspace-session generation and conversation. Every host operation must revalidate its captured session and native authorization. A conversation ID, action ID or subscription position is correlation data, not an access grant. Device-local request settings and instructions are captured in `RunConfig` and are not added to portable history.

## Actions and observations

`Owner::apply(action_id, action)` accepts version-1 action envelopes. Native gateways use `apply_with_cancel(action_id, action, cancel)` with a cancellation token captured before awaiting owner initialization, so an earlier scope abort also covers queued admission. Both methods use the same validation, action receipts and mutation ordering.

Supported action types:

- `draft`, `submit`, `enqueue`, `recall`, `cancel`, `retryPersistence`
- `renameTitle`, `presentQuestion`, `answerQuestion`, `retryQuestionAction`, `supersedeQuestion`
- `notifyPluginAvailable`

Accepted question host-action failures return an authoritative snapshot with `error` set after host cleanup, keeping the answered question's action pending for explicit retry. A failed conversation checkpoint remains a persistence failure rather than an acknowledged host-action error.

Inputs contain text, attachment references and identity-bound content references. Draft edits compare the complete expected input. Stable action IDs deduplicate identical payloads and reject changed payloads. Queue recall and consumption are serialized; steering enters before the next model request and follow-ups enter after the current generation finishes. Reopening interrupted work does not replay it.

`subscribe()` atomically returns a snapshot and ordered subscription backed by eight shared broadcast updates. Snapshots and large progress values are shared across subscribers. This is an update-count bound, not a heap-byte bound. Durable/domain changes carry snapshots; transient progress carries only partial message, activity comment and question-busy state. A subscription gap requires a fresh snapshot. Dropping observers does not cancel accepted work.

`is_busy()` is synchronous and includes queued mutations, owned execution/cleanup and unresolved persistence failure. `settled()` waits for owned work and cleanup, not successful persistence. Check the returned phase and error before treating a conversation as durably complete.

## Host effects

`Host::validate_input` checks native workspace and attachment authority for new inputs after bounded syntax validation and accepted-receipt lookup, before changing records. It does not revalidate expected drafts or replayed accepted actions against a changed filesystem.

`Host::question_retired` defaults to false. A host may retire a retained question only when authoritative workflow state makes it obsolete. The owner persists supersession before admitting new input or processing an answer/retry; unrelated questions and active work remain blocking.

`Host::prepare_model` refreshes main-request instructions and capabilities after steering is consumed, before definitions and context planning. It must preserve admission settings, limits and auxiliary flags; each response's tool batch retains that request's configuration, definitions and provenance until all calls settle.

`Host::model` receives canonical context, captured definitions, run/request identity and purpose (`main`, `compaction`, `title`, `comment`). `Host::input` resolves captured references and constructs retained user messages; `Host::context` hydrates attachments and performs target-specific request adaptation. Neither operation may invent original provider/model attribution.

Tool intent includes the captured definition and host-known provenance. The host executes admitted effects without a separate approval action. A disconnected executor reports native-known suboperation observations plus remaining uncertainty; the owner does not infer full-tool success or redispatch it.

Host methods must settle their resources before returning. `Host::drain` must also join independently owned work after a model, tool or mutation future panics. Failed cleanup keeps the owner busy and persistence retry must settle cleanup before releasing it. Non-cooperative effects can therefore prevent closure; cancellation is not proof that an effect did not happen.

Compaction changes derived request context and checkpoints, not original messages. Summaries preserve the active request and distinguish completed actions from uncertainty. Title/comment requests have separate purposes and accounting; generated titles cannot overwrite a later manual title.

## Verification

Use the repository's Volta environment and coordinated worktree/build leases:

```sh
node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- \
  cargo test --locked --manifest-path client/Cargo.toml -p situate-agent
```

The repository test runner registers this crate as `client-agent-runtime`. Deterministic host fixtures cover domain actions, persistence barriers, cancellation, panic cleanup and observer-independent ownership. They do not qualify provider access, JavaScript executor termination or native macOS/iOS delivery.
