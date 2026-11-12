# Git-derived file references: development plan

## Target and scope

The original sequence below records the ADR-0010 replacement of the independent journal. Its preservation of Markdown file UUIDs is superseded by [ADR-0012](../architecture/09-architecture-decisions/ADR-0012-unify-git-anchored-file-references.adoc): all files now use the anchored-path target, while task UUIDs remain. Core capture, stored selectors, history and native publication use the unified format; native platform qualification remains separate. The original no-conversion exception covers unpublished development formats only; it does not waive compatibility or migration requirements for published formats. Format mismatch never authorizes workspace cleanup, reset or deletion.

Implement [ADR-0010](../architecture/09-architecture-decisions/ADR-0010-git-authoritative-file-history.adoc) and the [Git-derived reference concept](../architecture/08-cross-cutting-concepts/git-derived-file-references.adoc). The core format is specified in the [commit-format contract](../architecture/index.adoc#git-file-history-format). The sequence below separates implementation from platform and integration qualification.

Stored-reference portability uses workspace-local selectors and native runtime binding. Conversation drafts, queued inputs, stored runs and file-view navigation state omit `workspaceId` on disk. Native storage binds them only to the authorized current workspace on load; it preserves anchors and storage revisions and rejects foreign bound writes. Binding is not a migration or a new capture. Whole-directory copy/move, independent-copy isolation and malformed-record preservation belong to storage integration tests, separately from native IPC/restart and target-platform qualification.

This sequence records the original replacement of unpublished development formats. Its no-migration, no-compatibility-reader and fresh-fixture instructions apply only to formats verified never to have shipped publicly. Situate is now publicly available. Changes to published formats follow [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) and [release compatibility verification](testing.md#release-compatibility-verification), including supported-release fixtures and tested migration where needed. Recreating obsolete development fixtures remains an explicit development action, not an automatic reset of arbitrary local data.

Git will own confirmed content history and the operation facts required for reference resolution. The replacement for the independent move/delete journal is a reconstructible projection, optionally cached. Restart does not replay, finish or roll back interrupted file operations.

The governing product behavior remains [history and interrupted operations](../../requirements/data/requirements/REQ-0022-explain-note-changes.md), [live references](../../requirements/data/requirements/REQ-0030-open-chats-with-content-references.md), [identity](../../requirements/data/requirements/REQ-0035-preserve-file-and-task-identity.md) and [portable workspaces](../../requirements/data/requirements/REQ-0038-copy-portable-workspaces.md). Preserve task UUIDs, explicit historical references, retained drafts, workspace authorization, overwrite protection and acknowledged-write durability.

This is not a new Git implementation, synchronization protocol, universal transaction engine, binary-text extraction feature or stable-ID system for non-Markdown files. Do not relocate workspaces/history, raise platform minimums, rewrite history, remove synchronization fences or fold unrelated diagnostics/performance work into the change.

## Current implementation map

| Boundary                               | Relevant paths                                                                                                                         | Change pressure                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Git facts and live anchors             | `client/crates/situate-core/src/content/history_records.rs`, `lineage.rs`, `tree_facts.rs`, `live_references.rs`                       | Versioned facts, strict ancestry, cache-free reconstruction and race-checked capture                                      |
| Structural writes and result reporting | `client/crates/situate-core/src/content/operations.rs`, `operation_tests.rs`                                                           | Paired boundaries/completions, staged reference patches, complete/partial outcomes                                        |
| Text publication                       | `client/crates/situate-core/src/content/text_writes.rs`, `text_write_tests.rs`                                                         | Durable pre-write evidence, pinned postconditions, no-op durability, retained drafts and uncertain interrupted provenance |
| Git snapshots and publication          | `client/crates/situate-core/src/content/mod.rs`, `git_storage.rs`, `git_storage/`, `history.rs`                                        | Commit result/metadata together; handle continuity-only facts even when the content tree is unchanged                     |
| Persisted and wire references          | `client/crates/situate-core/src/conversation_runtime.rs`, `client/contracts/files.json`, `client/app/src-tauri/src/files_contract*.rs` | Versioned Git anchors, finite validation and explicit resolution outcomes                                                 |
| Conversation storage                   | `client/crates/situate-core/src/conversation_store.rs`, `client/app/src-tauri/src/ai.rs`                                               | Preserve format validation and compare-and-swap protection against stale writes                                           |
| Host and consumers                     | `client/app/src-tauri/src/files.rs`, `client/app/src/ai/content-references.ts`, `client/app/src/files/`, `client/app/src/layout/`      | Authorized capture/resolve, stored views and unloaded conversations, partial-result presentation                          |
| Native adapters and journeys           | `client/crates/tauri-plugin-workspace-access/`, `client/app/src-tauri/tests/support/`, `client/app/tests/browser/`                     | Real publication/permission behavior and process-restart verification                                                     |

These are starting points, not authorization to modify every listed file. Inventory the actual serialized consumers before assigning ownership or changing a schema. The host API and its current portability boundary are documented in [workspace views](workspace-views.md).

## Delivery sequence

Stages 1–3 establish the data model and reader. Stage 4 replaces the write/open path directly, stage 5 updates all consumers and fixtures to the new format, and stage 6 qualifies the complete implementation. For the original unpublished-format replacement, development and verification use fresh workspaces without a parallel legacy implementation. Changes to published formats additionally require supported-release upgrade and mixed-version tests.

### 1. Identify consumers and close the format decisions

**Work**

- Identify all reference-bearing stores and consumers, including unopened conversations, queued inputs, stored runs, persisted layout/presentation and drafts. Update their producers, validators and synthetic fixtures as one format change.
- Map the current Git metadata and journal dependencies so the new design replaces them rather than retaining a second authority.
- Select a versioned operation envelope and placement bound to the result commit. Include the facts needed for file/folder moves, copies, deletions, restoration, path reuse and continuity gaps; do not assume all require identical records.
- Define a live path anchor, its capture preconditions, and the supported ancestry rules. Explicitly decide merge handling and behavior with missing/replaced history; no timestamp ordering or arbitrary parent selection.
- Define how an interruption becomes a durable Git continuity boundary, including unchanged content trees, uncertain authorship and later path reuse. Decide whether a narrow transient signal is needed and how failed persistence gates reference use without becoming a second ledger.
- Define the new stored/wire formats and reject unsupported shapes or versions without reinterpreting them or overwriting unreadable records. Do not add converters or compatibility shims solely for previous formats verified never to have shipped publicly.
- Define resource limits and unsupported outcomes for parsing, history traversal and cache growth. Use existing bounds where applicable; do not invent a performance pass threshold from favorable timings.

**Exit:** a reviewed format specification and freshly generated synthetic fixtures cover normal, unknown and unsupported states. ADR-0012 supplies the decision to extend anchored references to Markdown. Supported platform scope and manual interruption behavior are unchanged.

### 2. Implement authoritative Git records and validation

**Depends on:** stage 1.

**Work**

- Implement the selected versioned record codec in the core history boundary, with strict path/version/count/size validation and fixture parity wherever data crosses JavaScript/native interfaces.
- Bind records to their actual parent/result trees and distinguish completed operations from observations and continuity boundaries. A parsed `Move` intent alone must not prove completion. Delimit the operation's effects; record detected external edits as separate history entries, not as part of the completed operation's snapshot. If their effects cannot be separated safely, retain an uncertain outcome rather than claim complete attribution.
- Replace the unversioned `Situate-Operation` writer/reader and its fixtures with the selected format. Generate test histories through the new format; do not add a fallback interpretation solely for previous records verified never to have shipped publicly.
- Support required metadata-only facts without silently suppressing them through `record_snapshot`'s unchanged-tree shortcut. Retain the Git object/ref/directory durability ordering.
- Keep pre-publication failures distinct from a reference already advanced before final Git synchronization failed, and from a durable commit whose acknowledgement or cache update was lost. Test each boundary: a failure reply is not proof that the result commit is absent.

**Exit:** filesystem integration tests prove that a published completed-operation record has the matching tree, and that failed/unsupported records cannot authorize reference retargeting. Record handling is ready for the resolver and write-path integration.

### 3. Build the cache-free reference resolver

**Depends on:** stage 2.

**Work**

- Implement deterministic resolution from an anchored path and the selected retained Git lineage. Do not consult the independent move/delete journal.
- Cover descendant paths, chained moves, copies, deletion followed by name reuse, restoration under the chosen semantics, and explicit continuity gaps. Apply anchored-path continuity to Markdown as well as other files; preserve task UUIDs and explicit historical-reference behavior. Restoration creates a new file lineage rather than reviving deleted live references.
- Keep identity/path resolution separate from text reading/rendering. A binary PDF fixture must not require UTF-8 decoding or a new PDF extraction feature.
- Return safe unresolved/unsupported outcomes for missing anchors, unknown versions, incomplete history, invalid metadata and unsupported/ambiguous ancestry.
- Implement capture only after the selected file and anchor association is established and the expected saved revision is rechecked. Keep the blob/content-based concurrency revision distinct from the commit anchor. A new selection may establish a new anchor; loading a stored reference must never do so implicitly.
- Add a bounded cache only if needed. Key it by the admitted workspace/history interpretation, invalidate it on head/format changes and compare every cached result with the cache-free oracle in tests.

**Exit:** a fresh process using only the authoritative workspace data reproduces the same results. Deleting, corrupting or retaining a stale derived cache cannot lose identity facts or select a different target. No every-move rewrite of conversation records is required.

### 4. Replace the write, open and interruption path

**Depends on:** stages 1–3.

**Work**

- Retain serialized ownership, source/destination checks and durable pre-operation history before destructive changes.
- Run bounded filesystem changes and recognized reference patches, then publish the matching completed-operation metadata and result tree. Preserve explicit partial/history-failed outcomes when not all steps complete.
- Implement the interruption detection/continuity protocol chosen in stage 1. On restart, preserve working files and prior history; do not infer a successful move, continue patches, reset to `HEAD` or retry the old mutation.
- Preserve provenance uncertainty instead of labeling every difference found at startup as an external editor change. Include text save, conflict resolution, creation and draft restoration, not only structural operations. An unmatched write blocks crossing anchored references at its selected path; only a validated immediate completion preserves continuity. A gap remains effective after later ordinary commits and cache rebuilds.
- For unchanged saves, settle pending evidence and verify/synchronize the existing file, parent directory and history before draft cleanup. Do not rename the file or create an empty action; preserve explicit durability and cleanup failures.
- Make acknowledgement/cache failures after a durable commit non-replaying. Revalidate current state for any later explicit user retry.
- Replace `ContentStore::open`'s journal reconciliation with the new interruption/continuity behavior. Remove the independent ledger and reference-witness reads/writes rather than retaining a legacy branch. Retain unrelated safe-publication primitives and their platform checks.

**Exit:** injected interruption at each publication boundary produces the documented state without lost originals, guessed targets or repeated mutation. Ordinary successful moves/deletions require no durable reference-witness hardlinks on the new path.

### 5. Integrate native contracts and user-facing outcomes

**Depends on:** stable stage 1 contracts and stages 3–4 for activation. Contract fixtures can be prepared in parallel after stage 1.

**Work**

- Update Rust/JavaScript reference contracts and validators together. Keep runtime `workspaceId` on IPC references, but omit it from persisted selectors through the native storage boundary. Bind only to the authorized owning workspace on load, without rewriting records or capturing sources. Preserve workspace/window ownership checks; a Git anchor is not an authorization capability.
- Connect reference capture, resolution, navigation, loading, polling, sending and retry. Unresolved stored references must never fall back to an unguarded path read or automatic recapture.
- Exercise unopened conversations and restored presentation state as well as active views. Rebuilding an index must not change conversation storage revisions or initiate an agent turn.
- Present complete, partial, history-unavailable and unresolved states without claiming that failure means no effects. Allow explicit retry/reselection and existing history recovery; restoration must not repeat an old mutation.
- Keep product text in the localization catalogs. Preserve drafts, manual offline access and the existing external-provider read-only policy.
- Update [workspace views](workspace-views.md) only when the actual supported API/format changes. This work does not itself add binary content to the chat-text API.

**Exit:** host authorization/contract tests and product browser flows demonstrate the new behavior. Any intended visual change has reviewed Linux-generated references; no baseline update is used to hide unexplained differences.

### 6. Qualify, remove obsolete dependencies and deliver

**Depends on:** stages 2–5.

- Run full native file/reference journeys on the supported desktop platforms and application-owned Android/iOS storage, including genuine process termination and restart. Verify Android witness-free moves and deletes, not only compilation or an app-open check.
- Verify the safe file-publication primitive independently of reference reconstruction. Removing witness hardlinks does not establish `renameat2` availability on older Android versions or provider-backed writability. Do not silently change minimum OS versions or weaken no-clobber behavior to make a test pass.
- Compare rebuild and cached results on synthetic long histories, folder operations and copied workspaces; measure cold reconstruction, incremental work and memory under reviewed bounds. A correctness pass is not an application performance acceptance claim.
- Remove obsolete journal/witness code, epoch-based reference fields and fixtures. Verify that all current consumers use the new format, with no legacy reader or dual-write path. Preserve unrelated content-publication hardlinks where they still implement a necessary safe write.
- Update current architecture/API descriptions and fixture setup instructions to match the shipped format. Keep accepted design separate from target-platform evidence and report unexecuted prerequisites.
- Review diffs for privacy, dependency/license impact and preservation of existing data. No Git publication or release is implicit in this plan.

**Exit:** the acceptance matrix below passes on the integrated source, remaining target limitations are explicit, and no active second authority remains for new-format reference history.

## Acceptance matrix

| Risk/scenario                                                                                                            | Required observable result                                                                                                       | Primary boundary                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Cache removed, stale or corrupt; fresh process and copied closed workspace                                               | Same target/deletion/uncertainty result from Git and the anchor, with no dependency on a previous device's inode or cache        | Core Git/filesystem integration                                          |
| Identical PDFs, chained/folder moves, copy, delete and later path reuse                                                  | Confirmed moves follow exact path lineage; copies do not steal references; deletion/name reuse does not revive old references    | Resolver domain tests with synthetic binary fixtures                     |
| Invalid operation metadata, unknown version, missing anchor or ambiguous ancestry                                        | No guessed target and no arbitrary first-parent or rename-similarity fallback                                                    | Codec/resolver tests                                                     |
| Capture races with modification, move or new file at an old path                                                         | A verified association with the anchor or an explicit failure; no silent rebinding                                               | Core capture integration and shared contracts                            |
| Crash before mutation, after rename, midway through reference patches, before result commit                              | Prior content remains retained; current effects remain visible; no replay/rollback; unsafe references stay unresolved            | Fault-injected core integration, then selected real native process tests |
| Same-tree interruption gap, later snapshot and path reuse                                                                | Durable uncertainty remains effective after subsequent commits, restart, cache removal and workspace copy                        | Core Git/interruption integration                                        |
| Reference advancement followed by failed final Git sync, or durable commit followed by lost acknowledgement/cache update | Validate the retained result and retain accurate failure/durability status; restart/retry does not duplicate the mutation        | Core Git/host integration                                                |
| Malformed/unsupported records and stale conversation writes                                                              | No guessed target, empty-state overwrite or lost concurrent edit                                                                 | Contract and conversation-CAS integration                                |
| Unopened chat, restored pane, wrong workspace/window, unresolved attachment sent to agent                                | Confirmed references resolve without per-move conversation rewriting; unauthorized/uncertain sources are not read or sent        | Host contracts and selected product browser flows                        |
| Android filesystem denies hardlinks                                                                                      | New reference path completes ordinary moves/deletes without a witness link; unsupported publication operations still fail safely | Native emulator/device journey                                           |

Use independent expected histories and outcomes, not a second implementation of the resolver as the test oracle. Test the actual boundary responsible for each risk rather than duplicating every scenario at every layer.

## Verification commands and prerequisites

Follow [repository testing](testing.md). During implementation, start with the affected core tests (`cd client && cargo test -p situate-core content:: --locked`), host and shared-contract tests, then `node tools/test.mjs --unit --changed` and the relevant browser/native suites. `cd client && npm run test:native` retains the full ordinary recovery/restart journey; focused diagnostics is not a substitute for file/reference verification. Mobile execution uses the documented installed toolchains and dedicated synthetic app data.

For documentation/catalog changes, run `npm --prefix requirements run validate`, the requirements tests/build, formatting/link checks and `asciidoctor --failure-level WARN -o docs/architecture/index.html docs/architecture/index.adoc`. Before a pull request, run `node tools/test.mjs` without filters. Report failing assertions and unavailable tools/targets separately; preserve failed attempts and source identity. Do not install SDKs, accept licenses, deploy to personal devices, change security policies or publish remotely without the necessary authorization.
