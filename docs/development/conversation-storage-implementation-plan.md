# Conversation storage implementation plan

Status: implementation and recorded MVP development verification complete. The current product scope is macOS-only; iOS results below are retained historical evidence, not current support or release gates.

The integrated source passes all 44 MVP suites, including the four native macOS suites, plus quick checks (2 suites) and feedback checks (19 suites). The explicit iOS Simulator debug journey passes two launches with migration, retained drafts/queued inputs, attachment/reference presentation, Worker cancellation, workspace closure and reopening without replay. Physical-device behavior, minimum supported OS versions, protected storage and production signing/distribution require separate Apple-release verification.

## Scope and completion

Implement [ADR-0016](../architecture/09-architecture-decisions/ADR-0016-append-conversation-history.adoc) and the conversation storage, context, ownership and input lifecycle described in the [architecture](../architecture/index.adoc). Those views define the selected design, not an additional proposal alongside the implementation.

Completion requires working code, relevant verification and a final comparison of implementation against those views. A documented design alone, a fresh-workspace test or a passing subset of tests does not close the plan. Resolve differences in code or explicitly agree and record a changed decision; do not leave contradictory architecture descriptions.

Use the implemented [workspace migration mechanism](../architecture/08-cross-cutting-concepts/workspace-migrations.adoc), not a conversation-specific backup or activation system. The specific [ADR-0016](../architecture/09-architecture-decisions/ADR-0016-append-conversation-history.adoc) exception under [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) selects one-way conversion requiring app 0.1.6 or newer, without an older writer or reverse conversion. [REQ-0070](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md) retains its separate plugin obligations.

## Existing migration boundary

| Existing implementation                                     | Use for conversation conversion                                                                                                                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/crates/situate-migrations/src/migration.rs`         | Implement `Migration` with `VERSION`, `MINIMUM_APP_VERSION`, `apply` and `validate`; use only `.situate`-relative `MigrationWorkspace` access.                                          |
| `src/registry.rs` and `src/migrations/mod.rs` in that crate | Migration 2 converts conversation history after migration 1's metadata bootstrap. Keep published steps unchanged; corrections use a later ID.                                           |
| `src/runner.rs` and `src/backup.rs`                         | Reuse whole-chain backup, validation, metadata publication, restoration and cleanup. Do not add another recovery journal, selector or private migration backup.                         |
| `client/app/src-tauri/src/workspace_preparation.rs`         | Keep conversion behind the existing opening gate, before normal managed-state access, conversation execution or plugins. Retain the admitted workspace lease throughout use.            |
| `client/crates/situate-migrations/tests/fixtures/README.md` | Use source-matched fixtures for the verified 0.0.1, 0.1.0, 0.1.1, 0.1.2, 0.1.3 and 0.1.5 artifacts. Conversion and production-reader reopen tests extend the metadata bootstrap checks. |

The runner owns `minimumAppVersion` and `lastAppliedMigration` in `.situate/migrations.json`. A conversion declares a minimum-version increase through its descriptor, not by writing runner metadata. Fresh staged workspaces receive the registry's current position through `initialize_fresh`; their conversation directories are created by the new store, not by replaying legacy conversion.

The conversion enumerates the held managed directory through crate-private filesystem helpers. No ambient workspace path, new public directory API or dependency on Tauri, `situate-core` or the agent runtime is introduced.

## Delivery sequence

### 1. Inventory existing data and consumers

- [x] Map the published serializers, validators, readers and writers, including supported release provenance. Start with `client/crates/situate-core/src/conversation_store.rs`, `conversation_runtime.rs`, `situate-agent/src/{contracts,actions,execution,questions,compaction}.rs` and the native `ai_conversations.rs` adapter.
- [x] Trace frontend `conversation-record.ts`, `native-conversation.ts`, transcript projections, history tools, onboarding, development conversations, list/title generation, updater/quit barriers and native fixture writers. Do not leave a load-all compatibility wrapper on an ordinary continuation path.
- [x] Inventory messages, usage, classification/signatures, tool provenance/results, questions/answers, work periods, drafts, steering/follow-up inputs, attachments, file references, compaction boundaries and opaque fields. Assign every persisted field an owner and destination; distinguish existing retained data from newly transient execution state.
- [x] Define the smallest versioned entry and metadata shapes, stable IDs, ancestry validation and input status transitions needed by those consumers. Do not duplicate original input/result payloads in status records. Preserve legacy duplicated or unknown information rather than normalizing it away.
- [x] Record the explicit JSONL format-change exception: migrated workspaces require app 0.1.6 or newer. The current compatibility gate refuses older declared app versions; published pre-gate binaries remain unsupported for converted workspaces.

**Exit:** every existing field and consumer has a preservation or explicitly agreed transition path. Release provenance distinguishes verified artifacts from unverified preparation commits; the one-way rollout excludes pre-gate writers.

### 2. Implement native append storage

- [x] Store one `history.jsonl` and `metadata.json` per conversation. Validate IDs and authorized workspace-relative paths; retain protected-file, symlink and concurrent-writer safeguards.
- [x] Serialize writes, handle short writes and append entries with stable identity. Retry recognition must distinguish an already appended entry from a new attempt without repeating generation or effects.
- [x] Append referenced history before atomically replacing metadata through a temporary file. Keep additional history when metadata publication fails; an old selected entry remains valid.
- [x] Choose and test operating-system flush/sync points and acknowledgement semantics. A write or read-back is not by itself a durability guarantee. Retain available unsaved outcomes in memory while the process lives and report write/flush/disk-full failures.
- [x] Recognize incomplete trailing entries, preserve their bytes before repairing the append boundary, and keep complete preceding history readable. Refuse writes behind an unrepaired suffix; refuse malformed complete entries, broken ancestry and unsupported formats without resetting history.
- [x] Read incrementally, support bounded history windows and avoid retaining the entire tree for normal continuation. Add only the reconstructible lookup index needed by measured access paths; do not make it a second history authority.

**Exit:** synthetic tests cover short writes, partial tails, metadata failure, lost acknowledgement, retry identity, flush failure, disk exhaustion, corruption and protected filesystem boundaries. Neither interruption nor failed retry changes previously saved originals.

### 3. Adapt owner and context lifecycle

- [x] Replace complete-record save operations with history append and metadata actions. Keep the native owner as the sole execution authority and retain cancellation/drain, workspace closure and updater admission boundaries.
- [x] Persist submitted inputs once as user messages before acknowledging acceptance. Reconstruct waiting/consumed/recalled status without a separate pending file or payload copies; preserve steering/follow-up ordering, Recall races, attachments and references.
- [x] Keep active execution in memory. Do not introduce a durable run journal, exact execution resumption or automatic replay. Unsaved draft text and response suffixes may be lost after a crash; saved input and historical content may not be silently discarded.
- [x] Record calls and available outcomes in ordinary history. A saved call with no result remains an unknown outcome, not a fabricated failed/no-effect result. Preserve available question/answer and work-history information without requiring an execution checkpoint file.
- [x] Derive context from selected ancestry, its latest compaction and `firstKeptEntryId`. Keep recent originals and the active user request without copying messages across compactions; preserve tool-call/result grouping and existing context masking rules.
- [x] Use compaction only after saving its entry; failure keeps the previous usable context. Reopening reconstructs history and waits for user interaction, including when saved inputs remain waiting.

**Exit:** owner tests cover consumption/Recall/Stop races, in-process save failure, interrupted calls, question answering, branch-local compaction and reopening without model requests or repeated tools. A selected path can span many compactions without loading all history.

### 4. Integrate consumers and published-data transition

- [x] Adapt native history tools, ordinary/onboarding/development consumers, list/metadata access and fixture writers to the same store. History tools preserve original outcomes, not only summaries.
- [x] Adapt frontend snapshots and transcript access to incremental history; opening older details must not replace the transcript or start work. Preserve existing title, attachment, file-reference, question, work-history and localization behavior.
- [x] Support stored ancestry and shared-prefix branches in core/projection tests. A new tree-navigation UI, standalone fork/export feature and synchronization protocol are outside this implementation unless separately agreed.
- [x] Implement one numbered conversion in `situate-migrations/src/migrations/mNNNN_conversation_history.rs`. Inventory and convert all supported legacy conversation files, including unopened ordinary, onboarding and development conversations. Convert one conversation at a time; never treat an unreadable source as an empty chat or silently omit it.
- [x] Preserve IDs, ordering, titles, original messages/results, opaque fields, attachments/references, questions, work periods, compaction boundaries and existing drafts/queues. Define how retained legacy draft information remains accessible without requiring a new pending-state file. Preserve uncertainty without executing tools or reconstructing live runs.
- [x] Validate every destination and its relation to the source before removing any legacy authority. Use the runner's complete recoverable backup for conversion failure or interruption; do not leave old files as an implicit fallback that can hide a failed conversion. Keep unrelated `.situate` data and user files outside it unchanged.
- [x] Add the conversion's module, typed registry descriptor, per-migration test module included by `tests/migrations.rs`, and independent `before`/`after` fixtures. Register only after new readers/writers and the compatibility gate are ready, because adding a registry entry makes existing-workspace preparation execute it.
- [x] Test the same conversion through `prepare`, then through the production core reader/writer and native opening gate. Cover skipped upgrades, all-conversation rollback after a late failure, subprocess interruption during conversion/publication, repeated reopening, fresh staged workspaces and compatible later migration IDs. Reuse backup/recovery tests rather than building a second mechanism.
- [x] Verify the signed direct-distribution artifacts and source-matched forward fixtures for all six recorded versions through 0.1.5, including skipped upgrades and production-reader reopening. Their binaries predate the compatibility gate and cannot safely refuse conversion retroactively. Before conversion, close the workspace everywhere, back up the closed directory and update every installation to 0.1.6 or newer; no older writer or reverse conversion is supported.
- [x] Remove obsolete full-record persistence paths only once all consumers and supported data have a replacement. Keep the migration itself and its fixtures under the migration retention policy.

**Exit:** all production conversation types and history readers use one authority, and the numbered conversion uses the existing runner. Upgrade/reopen tests cover the verified released writers. The incompatible rollout requires all installations to be updated before conversion.

### 5. Verify and reconcile architecture

- [x] Exercise synthetic histories beyond the former 16 MiB ceiling. Verify unchanged original bytes, same conversation identity, useful continuation and on-demand older-history access. Check bounded retained entries/index hints and measure write/read work as history grows. History-tool serialization reuses a selected-path offset spool rather than repeatedly walking backward pages; these checks do not measure process RSS or establish a worst-case total-I/O bound.
- [x] Run focused migration, core/owner/host/projection tests and the affected product build using the [coordinated test workflow](testing.md). Include `node tools/run-coordinated.mjs -- cargo test --manifest-path client/Cargo.toml -p situate-migrations --locked` and extend the core release-conversion/reopen tests. Run `node tools/test.mjs --quick --changed` and `node tools/test.mjs --feedback --changed`; before a PR, run `node tools/test.mjs --changed --base origin/main` with a current base.
- [x] Exercise native macOS and iOS Simulator reopen, interruption, workspace/application closure and attachment/reference behavior with synthetic data. The iOS journey uses bundled application assets and real product views, including a migrated conversation's visible draft and waiting input during close cancellation and Abort-and-close.
- [x] Compare the finished code and tests against the storage/context concepts, native building blocks, input runtime, deployment placement, quality scenarios, ADR and diagrams. Remove stale full-record assumptions and implementation links; record actual entry shapes and flush points where developers need them.
- [x] Reconcile the implementation, architecture and migration boundaries. Native lifecycle regressions have focused tests, and the final aggregate MVP verification passes. ADR acceptance and Apple-release verification remain distinct.

**Exit:** implementation, architecture and diagrams agree, the agreed behavior is verified, and remaining evidence limits are reported rather than counted as passed.
