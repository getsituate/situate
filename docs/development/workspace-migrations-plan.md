# Workspace migrations implementation plan

Status: implementation design. Released-format and native qualification are required before enabling incompatible writers.

Implement the accepted [workspace migration concept](../architecture/08-cross-cutting-concepts/workspace-migrations.adoc). [REQ-0069](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md) governs released workspace data; [REQ-0070](../../requirements/data/requirements/REQ-0070-preserve-plugin-api-compatibility.md) retains separate public plugin-interface obligations.

## Scope and boundaries

- Introduce one independently testable Rust package, `situate-migrations`, in the existing [Cargo workspace](../../client/Cargo.toml).
- Keep migration implementations in dedicated files, with one implementation, one required migration number and one registry entry per file.
- Run the complete pending chain before opening a workspace. One backup protects the whole attempt; a failed intermediate step restores its starting state.
- Limit writes and rollback to Situate-managed data inside `.situate`. User files outside it, device-local settings, credentials and external services remain untouched.
- Keep plugin-specific compatibility and conversion separate. Backing up plugin state does not authorize executing plugin migrations through the core runner.

Conversation storage conversion, append/recovery protocols, synchronization implementation, service migrations and a generic migration framework are outside this feature. Do not select a new conversation format or import an unpublished-format exception into released-data handling.

## Package structure

Paths below are planned. `<purpose>` is replaced by the actual conversion name; do not add placeholder production migrations.

```text
client/crates/situate-migrations/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── migration.rs
│   ├── registry.rs
│   ├── metadata.rs
│   ├── runner.rs
│   ├── backup.rs
│   └── migrations/
│       ├── mod.rs
│       └── m0001_<purpose>.rs
└── tests/
    ├── registry.rs
    ├── compatibility.rs
    ├── recovery.rs
    ├── migrations.rs
    ├── migrations/
    │   └── m0001_<purpose>.rs
    └── fixtures/
        └── m0001/
            ├── before/
            └── after/
```

| File                            | Responsibility                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                        | Small public preparation API and structured outcomes/errors; callers cannot bypass required recovery or validation.                             |
| `migration.rs`                  | `Migration` trait, validated `MigrationId`, and `.situate`-scoped `MigrationWorkspace` access.                                                  |
| `registry.rs`                   | Explicit ordered descriptors derived from each implementation's declared constants and methods. No directory-based runtime discovery.           |
| `metadata.rs`                   | Read, validate, preserve and durably publish `minimumAppVersion` and `lastAppliedMigration`.                                                    |
| `runner.rs`                     | Compatibility checks, pending-step selection, whole-chain execution, validation and recovery orchestration.                                     |
| `backup.rs`                     | Complete snapshots, atomic/durable publication and retirement, repeatable restoration and cleanup.                                              |
| `migrations/mNNNN_<purpose>.rs` | Exactly one production conversion, implementing the shared trait. No private backup or progress mechanism.                                      |
| `tests/migrations.rs`           | Cargo integration-test entry point explicitly including the per-migration test modules. Nested files are not discovered by Cargo automatically. |

The package must not depend on Tauri or `situate-core`. The native host composes it with workspace access. Reuse existing capability-based filesystem dependencies and durability patterns where applicable; do not create a circular dependency or extract a broad storage framework just to share helpers.

## Implementation sequence

### 1. Inventory released state and establish admission rules

Inspect the supported published readers and writers before introducing metadata or changing any bytes. Record synthetic fixture provenance by app release and source revision, without private workspace data.

Relevant starting points:

- [Workspace inspection and creation](../../client/crates/situate-core/src/workspaces.rs): current inspection checks the marker directory, not migration compatibility.
- [Native workspace lifecycle](../../client/app/src-tauri/src/workspaces.rs): `open` currently reads onboarding state before publishing a session; identity admission and localization can also touch managed state.
- [Workspace storage and locks](../../client/crates/situate-core/src/ai_storage.rs): existing locks are per operation/store, not a complete migration barrier.
- [Filesystem durability](../architecture/08-cross-cutting-concepts/native-filesystem-synchronization.adoc): reuse the established distinction between visible writes and acknowledged durable results.
- [Native workspace access](../../client/crates/tauri-plugin-workspace-access/src/lib.rs): confirm how macOS/iOS retain authorized access throughout migration and recovery.

Resolve these implementation prerequisites before enabling writes:

1. The compatibility metadata filename and encoding, including a stable integer migration ID and an explicit initial position.
2. Recognition of supported workspaces without migration metadata. Absence must not imply a fresh workspace; corruption must not imply the initial position.
3. The first genuine migration, if one is needed to establish metadata. Fresh workspaces must receive consistent metadata without pretending conversions ran over existing data.
4. Backup/control paths inside `.situate`, excluded from the snapshot itself, and a lock location whose identity survives restoration.
5. The trusted published-release reference used to check immutable migration history. Do not rely on a contributor-editable expected file alone.

**Exit:** supported legacy inputs, initial metadata, snapshot coverage and the release reference are explicit and backed by fixtures. Unknown provenance remains a blocker for an incompatible conversion.

### 2. Add the package, typed contract and explicit registry

Add the Cargo member, host dependency and lockfile updates. Keep ordinary package tests independent of the app, network services, AI providers and operating-system credential stores.

Require each implementation to supply:

- `const VERSION: MigrationId`, with zero reserved for the initial position rather than a migration;
- `apply(&MigrationWorkspace) -> Result<(), MigrationError>`;
- `validate(&MigrationWorkspace) -> Result<(), MigrationError>`;
- an explicit declaration of any minimum-app-version increase, using `None` for a compatible change.

Build registry descriptors through a typed constructor that obtains the ID and callbacks from the trait implementation. Do not duplicate the migration number in a separately maintained registry field. Missing constants/methods must fail compilation.

`MigrationWorkspace` must expose only authorized, relative managed-state access. Reject traversal and link-based escapes; do not offer unrestricted ambient paths as the migration API. Exclude runner-owned metadata, recovery state and lock files from conversion writes. This is an accidental-misuse boundary for trusted app code, not a sandbox against malicious Rust.

**Exit:** the package compiles and can execute test-only migrations through the same interface and registry validator used by production.

### 3. Enforce registry and published-history integrity

Use structural contract tests in `tests/registry.rs` plus a release-history check:

| Check                                                                             | Required failure                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| IDs are unique, strictly ascending and contiguous from the initial position       | Duplicate, missing or reordered step.                                   |
| Migration filenames match declared IDs                                            | Misnumbered file.                                                       |
| Every production migration file has exactly one implementation and registry entry | Unregistered file or duplicate registration.                            |
| Every migration has one included test module and fixture pair                     | Missing test, uncompiled nested test module or missing expected output. |
| Published migration files and the published registry prefix remain unchanged      | Edited, deleted, renumbered or reordered released migration.            |

Use a single explicit declaration per registry entry to make the file/module association inspectable; do not infer executable order from filesystem enumeration. Include negative contract fixtures that intentionally duplicate, omit, reorder or misname entries and verify that the checks reject them.

Add a focused history-check tool under `tools/`, comparing against an immutable published source revision supplied by release qualification. Ordinary package tests must run offline without Git history; release qualification must report a missing trusted baseline rather than silently skip the history check. Before the first migration-bearing release, the published prefix is empty.

Published-source comparison does not prove unchanged behavior if shared conversion helpers change. Retain old-format behavioral fixtures and review changes to any helper used by released migrations. Removing retained migrations requires a separate support-policy decision, not registry cleanup.

**Exit:** deliberately invalid registries fail, source edits to released steps fail release qualification, and appending a new step passes without changing old entries.

### 4. Implement compatibility metadata and selection

Compare `minimumAppVersion` using semantic-version rules. The host supplies its compiled app version, not renderer input. Refuse below-minimum apps before normal data access or writes, and return a structured update-required outcome.

Select pending migrations from `lastAppliedMigration` and the validated registry:

- Initial or known earlier position: execute every remaining step in order.
- Current position: no conversion.
- Valid later position on a compatible older app: preserve metadata and data; never downgrade the ID or replay earlier steps.
- Malformed metadata, an unsupported legacy shape or an unavailable required path: fail without resetting state.

Preserve unknown metadata fields during writes. A migration must never lower the existing minimum app version or the recorded migration position. Commit the final position only after the complete chain validates; intermediate progress is not a persisted compatibility state.

**Exit:** table-driven tests cover version ordering, skipped releases, newer IDs on older compatible apps, unknown-field preservation and non-destructive rejection.

### 5. Implement backup, recovery and the chain runner

Follow the concept's [migration and backup diagrams](../architecture/08-cross-cutting-concepts/workspace-migrations.adoc#workspace-migrations). Keep three backup states: temporary, recoverable and retired; do not add a per-step journal.

1. Acquire exclusive local workspace ownership before inspecting or changing managed state. All normal open/write paths must honor this ownership; an unused migration-only lock is insufficient.
2. Recover a previous attempt or finish cleanup, using its durable backup state. Retain the complete recovery source while restoring it.
3. Validate restored compatibility and the required chain. Create a new snapshot only when no reusable complete recovery backup exists.
4. Stream the complete affected managed state into one private, uncompressed TAR archive. Include a final manifest of the captured file bytes and normal permission bits. Flush and verify the archive, then atomically and durably publish it as recoverable before conversion starts. Do not compare against a second live-directory scan or reconcile external edits. Never use links to live files.
5. Apply pending steps in registry order. Validate each step's result and the final state before publishing final metadata.
6. Persist the final migration ID and any deliberate minimum-version increase. Durably retire the recovery backup before deleting its contents; open only after cleanup succeeds.
7. On migration or validation failure, restore the entire original snapshot, including metadata, and return an error with the workspace closed. Retry on a later open, not in a loop.

Restoration must remove files introduced by the failed attempt as well as restore original bytes and normal permission bits. Preserve opaque files, retained history, queues and drafts; do not reduce snapshot coverage to fields the current app understands. Extract under the current user into a private managed directory; do not restore owner/group identities, ACLs or extended attributes. Keep lock/control state outside the restored payload so rollback cannot replace a held lock inode or erase its own recovery source. External editing during migration is unsupported.

Distinguish a failed transition from an uncertain durable outcome. On reopen, reconcile and flush observable publication/retirement state before trusting it; do not delete the only complete recovery source after a failed acknowledgement. A corrupt backup or failed restoration leaves the workspace closed with recoverable evidence retained.

**Exit:** package tests establish exact starting-state restoration, repeatable interrupted recovery and no normal access before durable completion and cleanup.

### 6. Integrate every workspace-opening path

In the native workspace lifecycle, place preparation after access authorization but before onboarding reads, writable identity/localization initialization, history initialization, plugin activation or runtime session publication. Audit folder selection, creation, remembered-workspace restoration, secondary windows, reopening and mobile entry paths rather than adding a gate only to one UI command.

- Keep blocking filesystem work off the UI event thread. Retain the native access grant and workspace ownership until preparation and session handoff finish.
- Reopening an already active session must not start a competing migration. Existing sessions and new opens must share the ownership rule.
- Keep the migration package's errors independent of UI copy. Map update-required, busy, failed migration, failed restoration and cleanup failure through the central localization catalogs.
- A failed workspace stays closed without blocking compatible workspaces. Do not fall back to onboarding, empty conversations or a newly initialized workspace.
- Keep runtime execution and any synchronization startup behind successful admission. This feature does not implement synchronization; its future inbound path must preserve the compatibility barrier.
- Preserve or deliberately replace existing local migrations only after inventorying their readers/writers. Moving code into the package must not silently change when released data is converted.

**Exit:** host tests prove the gate precedes all managed-state use; native macOS/iOS journeys verify actual access lifetimes, restart and independent workspace use.

### 7. Register checks and qualify rollout

Add a dedicated `client-migrations` package suite to [the test runner](../../tools/test.mjs), with [input rules](../../tools/test-inputs.mjs) and selection/cache contract tests. Register the immutable-history check with release qualification and supply its trusted baseline there. Check existing CI selection and required gates so the new package cannot be omitted. Keep shared CI tooling usable on Linux without treating Linux as a product target.

Use the smallest test level that observes each failure:

| Test level                      | Coverage                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registry and metadata contracts | Missing implementations/constants, invalid order, file/registry/test correspondence, semantic-version gates and opaque metadata.                                                                                   |
| Per-migration fixtures          | Supported released input to independently specified expected output; unknown fields, history and pending state retained.                                                                                           |
| Real-filesystem package tests   | Whole-chain rollback, created-file removal, access confinement, concurrent opens, disk-full/write/flush/rename/delete failures.                                                                                    |
| Subprocess restart tests        | Terminate at backup publication, every conversion boundary, metadata publication, retirement, deletion and restoration; reopen in a new process. Returned-error injection alone does not establish crash recovery. |
| Host integration                | All entry paths use the gate, no normal writers run early, errors reach localized UI and other workspaces remain usable.                                                                                           |
| Native macOS/iOS                | Authorized folder access, filesystem durability paths and reopen behavior in each active product runtime.                                                                                                          |
| Mixed-release qualification     | Supported older/newer readers and writers preserve data, compatible later IDs remain usable, and incompatible readers refuse safely.                                                                               |

Run focused package tests through the coordinated runner, then quick/feedback checks and affected MVP verification as described in [testing](testing.md). The planned standalone command is:

```sh
node tools/run-coordinated.mjs -- cargo test --manifest-path client/Cargo.toml -p situate-migrations --locked
```

Do not enable an incompatible writer merely because `minimumAppVersion` exists. Published apps do not gain that check retroactively: demonstrate safe refusal by every affected reader or keep the conversion disabled. Any early compatibility exception needs the specific approval required by REQ-0069; it does not waive REQ-0070.

**Exit:** upgrade/reopen evidence covers supported published formats, interrupted attempts and mixed-version writes. Report missing release fixtures, unavailable native verification and incomplete old-reader blocking as rollout blockers, not passing coverage.
