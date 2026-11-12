# Client diagnostics implementation plan

## Scope and basis

Implement local diagnostic recording under [ADR-0008](../architecture/09-architecture-decisions/ADR-0008-device-local-diagnostics.adoc), its [workspace-identity amendment ADR-0009](../architecture/09-architecture-decisions/ADR-0009-workspace-diagnostic-identity.adoc), and the [cross-cutting concept](../architecture/08-cross-cutting-concepts/client-diagnostics.adoc). The governing requirements are [event coverage](../../requirements/data/requirements/REQ-0064-record-client-diagnostic-events.md), [the shared API](../../requirements/data/requirements/REQ-0065-provide-shared-logging-api.md), [bounded local storage](../../requirements/data/requirements/REQ-0066-bound-local-diagnostic-storage.md) and [data limits](../../requirements/data/requirements/REQ-0067-limit-diagnostic-data.md).

The installation-wide disk limit is 256 MiB, including active and rotated logs. External delivery, bugreport submission, analytics integration, a log viewer and user-facing runtime level controls are not included. The implementation must not add a plugin runtime, synchronization service or account system merely to instrument one.

## Implementation reference

- [The shared v1 catalog](../../client/contracts/diagnostics.json) defines levels, categories, finite scalar attributes and accepted/rejected fixtures. Production JavaScript imports only the catalog sections, not test fixtures.
- [The JavaScript facade](../../client/app/src/diagnostics/index.ts) exposes `diagnosticsFor(scope)`. Its producer provides `action`, `operation`, `emit` and `close`; contexts are immutable, and child/retry operations receive explicit parents. A missing binding is a no-op. `createDiagnostics(transport)` supplies isolated test or plain-JavaScript bindings without a vendor dependency.
- [The native bridge](../../client/app/src-tauri/src/diagnostics.rs) registers window-owned producers, revalidates workspace session generations and admits UTF-8 JSON batches. Desktop and iOS use raw byte bodies; Android uses Tauri's JSON byte-array transport, accepting only integer values from 0 to 255 and rejecting other JSON shapes. The 64 KiB decoded-byte bound is checked before event deserialization, after Tauri has processed the transport envelope; it is not a framework-level ingress bound; acknowledgements report admission, not persistence. File, model and tool commands carry a separate optional diagnostic context, never an authorization token.
- [The collector](../../client/crates/situate-core/src/diagnostics/mod.rs) exposes `Collector::start`, `producer`, non-blocking `Producer::emit` and bounded `shutdown`. `with_destinations` supports filtered test/replacement destinations. Production installs only the local file destination.
- [Workspace metadata](../../client/crates/situate-core/src/workspace_identity.rs) is `.situate/workspace.json`, containing `{ "version": 1, "id": "<random UUIDv4>" }`. It is portable; runtime location handles and access rights are not derived from it.

Native directory initialization runs off the UI thread. Desktop logs use Tauri's `app_log_dir()/diagnostics`, with device identity separately under `app_local_data_dir()/diagnostics/device-id`. Default log locations are `~/Library/Logs/<bundle-id>/diagnostics` on macOS, `$XDG_DATA_HOME/<bundle-id>/logs/diagnostics` (normally `~/.local/share`) on Linux, and `%LOCALAPPDATA%/<bundle-id>/logs/diagnostics` on Windows. Tauri directory overrides, including isolated smoke-test roots, take precedence.

Android uses internal `noBackupFilesDir/diagnostics`; iOS uses Application Support `diagnostics` with backup exclusion requested. Both store segments in a `logs` child beside the local device-identity file. Developer retrieval must use the installed application's sandbox/container tooling; the application exposes no log-reading or export command. Device backup exclusion, sandbox retrieval and suspension behavior require target-device verification.

New workspaces persist identity before creation succeeds. Native legacy admission initializes only absent metadata through exclusive publication; corrupt, read-only or unsupported metadata is preserved and leaves workspace diagnostics unavailable without preventing workspace use. Desktop and iOS publication require filesystem hard-link support. Android app-owned directory admission uses a descriptor-relative `renameat2(RENAME_NOREPLACE)` syscall through the plugin's small JNI library, retaining staged writes and directory synchronization. It does not substitute an overwriting rename when publication fails. The syscall avoids the libc symbol introduced in Android API 30. AOSP's generated app seccomp policies allow it on all four supported ABIs from Android O onward; Android Q lists it in the [common syscall whitelist](https://android.googlesource.com/platform/bionic/+/android-10.0.0_r1/libc/SECCOMP_WHITELIST_COMMON.TXT). This source-level support does not qualify older-device kernels, filesystems or OEM policies. A denied syscall can terminate the process rather than return an error. Independently initialized legacy copies can acquire different IDs before metadata is transferred. Existing Android document-provider workspaces without metadata are not automatically migrated: SAF cannot provide the exclusive named-create operation. New SAF creation uses the existing provider trust boundary and verifies the newly created metadata document.

Device identity persists while its application data persists. A missing identity gets a new random value; a corrupt identity is preserved and diagnostic initialization fails closed. Reinstalling while retaining application data retains the identifier. Copying an entire application-data directory can clone it; it is not a hardware fingerprint or proof of physical device identity.

The [native smoke verifier](../../client/app/src-tauri/tests/support/diagnostics_smoke.rs) checks actual frontend/native causal linkage for the current launch in local JSON Lines and exclusion of synthetic content. Run the focused journey with `cd client && npm run test:native -- --diagnostics`; it also checks rejection of foreign workspace registration and oversized byte batches. Contract/unit tests cover malformed input, concurrent contexts, permanently pending bridges, stalled file I/O, quota recovery and bounded shutdown. Production plugin/synchronization adapters remain absent with their respective runtimes; synthetic conformance does not establish production coverage.

The optional producer microbenchmark is reproducible with `cargo test -p situate-core --release diagnostics::performance::producer_latency -- --ignored --nocapture` from `client/`. It reports admitted events, serialized bytes and latency with healthy, slow and blocked sinks. Its clone baseline and burst traffic are not application-level CPU, UI-responsiveness or retention acceptance measurements. No pass threshold for those application measurements is established here.

## Library assessment

Assessment date: 2026-10-10. Findings come from upstream documentation and selected source files, not an integration benchmark. Repository snapshots below identify inspected code; manifest versions at those commits are not a recommendation to use an unreleased branch. Pin published versions and review their resolved dependencies before adoption.

| Candidate                                       | Useful capabilities                                                                                                                | Fit and remaining work                                                                                                                                                                                                                                                                                                                                                                                                                                      | Recommendation                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official `tauri-plugin-log`                     | JavaScript/Rust logging, configurable destinations, file-size rotation and retention. [T1][tauri-docs] [T2][tauri-native]          | The guest binding invokes native logging per call and collects caller location. The file target directly supplies a writer to Fern; the inspected path does not establish a bounded background writer. A returned JavaScript promise is not proof that native file I/O is isolated. Typed data admission, batching, correlation and installation-wide accounting still need a wrapper. [T2][tauri-native] [T3][tauri-guest]                                 | Do not use as the public contract or assume its defaults satisfy the design. Reconsider only if an adapter removes more work than it adds.                                |
| `tracing` and `tracing-subscriber`              | Structured events, spans and subscriber composition; useful for Rust-side causal diagnostics. [R1][tracing-readme]                 | They do not define the JavaScript contract or authorize arbitrary fields. A subscriber adapter would need to admit only reviewed fields and preserve the explicit cross-IPC context. General dependency-log capture remains disabled.                                                                                                                                                                                                                       | Good optional Rust integration candidate behind the typed API, not a mandatory dependency for the first local pipeline.                                                   |
| `tracing-appender`                              | Background writer, bounded entry queue, lossy admission and dropped-entry counter. [R2][nonblocking-docs] [R3][nonblocking-source] | Queue capacity counts entries, not aggregate bytes; non-lossy mode blocks. The supplied rolling builder uses time rotation and file-count retention, not a per-segment size limit. `NonBlocking` receives already formatted byte buffers; moving I/O does not automatically move formatting off producers. The inspected guard has its own fixed shutdown waits and stdout fallback on a shutdown-send timeout. [R3][nonblocking-source] [R4][rolling-docs] | Not a drop-in writer. Evaluate only if byte accounting, priority loss, size rotation and shutdown behavior can be satisfied without a second overlapping queue/lifecycle. |
| `flexi_logger`                                  | File rotation and buffered/asynchronous output. [F1][flexi-overview] [F2][flexi-write-mode]                                        | `AsyncWith` explicitly uses an **unbounded channel**. Its bounded message pool is an allocation-reuse mechanism, not a backlog limit. Direct output inside our worker could avoid that queue but would retain our admission and quota responsibilities. [F2][flexi-write-mode]                                                                                                                                                                              | Do not use its asynchronous mode. No initial advantage established over a small dedicated writer.                                                                         |
| `file-rotate`                                   | A focused `Write` implementation with size/count rotation and optional compression. [S1][rotate-source]                            | `Bytes` can split a JSON record across files; `BytesSurpassed` preserves a supplied write buffer but may exceed its threshold. `AppendCount` excludes the active file. Directory scanning includes fallible operations handled with `unwrap` in the inspected source. Explicit preflight quota, safe startup and error isolation would still be necessary. [S1][rotate-source] [S2][rotate-suffix]                                                          | Keep as a focused spike candidate, not a selected dependency. Compare its wrapper cost with a small whole-record segment writer.                                          |
| Pino                                            | Browser logging with custom `write`/`transmit` callbacks. [J1][pino-browser]                                                       | Its file destination, worker-thread transport and multistream APIs are Node-only, not WebView facilities. Browser defaults write to the console. A Tauri bridge, safe fields and bounded batching still need implementation. [J1][pino-browser]                                                                                                                                                                                                             | Do not add a JavaScript logger solely to wrap our own event contract and transport.                                                                                       |
| OpenTelemetry JavaScript / future OTLP adapters | Standard telemetry APIs and exporter ecosystem. The JavaScript documentation covers browsers and Node. [O1][otel-js]               | The inspected documentation labels JavaScript logs as Development and lists no officially supported browser matrix. A standard telemetry model does not supply our local rotation or privacy policy. [O1][otel-js]                                                                                                                                                                                                                                          | Defer SDK/exporter adoption until an external delivery use case is selected. Keep explicit trace/span fields mappable without claiming OTLP compatibility now.            |

### Recommended starting point

Use the already present `serde`/`serde_json` and `uuid` crates, native filesystem/thread primitives and a small application-owned diagnostic contract. They are declared in the [core manifest](../../client/crates/situate-core/Cargo.toml); [the native host](../../client/app/src-tauri/Cargo.toml) already uses Tokio for its runtime services. Do not move file I/O onto a shared async executor merely because it has an async interface.

The project-specific work is bounded data admission, priority-aware queueing, causal context, identity binding and whole-record quota enforcement. None of the inspected packages removes those responsibilities. Start without a new general-purpose logging framework; keep the small destination interface so an evaluated library can replace file-writing internals without changing producers.

The implementation uses the small whole-record segment writer: `file-rotate` would require replacing its record boundary, active-file accounting and quota behavior rather than supplying the storage policy. The comparison is based on inspected source and the dedicated writer's fault tests, not a benchmark of an installed `file-rotate` wrapper. No new logger dependency or copied upstream code is included. Add `tracing`/`tracing-subscriber` only if a concrete adapter justifies it.

### Licensing and dependency gate

The inspected manifests declare `Apache-2.0 OR MIT` for the Tauri workspace, `MIT` for `tracing-appender`, `MIT OR Apache-2.0` for `flexi_logger`, and `MIT` for `file-rotate` and Pino. The tracing repository declares MIT and OpenTelemetry JavaScript declares Apache-2.0. [L1][tauri-manifest] [L2][tracing-manifest] [L3][flexi-manifest] [L4][rotate-manifest] [L5][pino-manifest] [R1][tracing-readme] [L6][otel-license]

These top-level licenses fit the existing [dependency policy](../../client/deny.toml); this is not approval of every transitive package, feature or copied source file. Before adding a dependency, check the published version, maintenance/release status, MSRV against the pinned client toolchain, required features, transitive advisories, license notices and desktop/mobile compatibility. No source code needs to be copied from the assessed projects.

## Implementation order

### 1. Persist workspace identity and prove the storage boundary

The identity model is workspace, device and session, with no user identifier:

- Generate the workspace identifier at creation and persist it in portable workspace metadata. Extend `client/crates/situate-core/src/workspaces.rs` and the platform creation adapters without deriving identity from the local registry handle, path or display name.
- Preserve that identifier when reopening, renaming, synchronizing, copying or restoring the workspace. A deliberately independent workspace needs a new identifier; an ordinary copy retains the original. Do not add a duplication UI merely to instrument logging.
- Keep the separately generated device identifier outside the workspace and allocate a fresh session identity on application start. Copies do not replace the destination's device identity.
- Bind diagnostic context to the validated persisted workspace identifier. Events without workspace context omit it; two local copies with the same identifier keep distinct runtime handles and authorization.

Apply the metadata and device lifecycle rules in the implementation reference above. Logging must not initialize or repair metadata in an event-emission path. Missing legacy SAF identity, unsupported exclusive publication and independently initialized copies are explicit limitations, not occasions to overwrite metadata or infer identity from content.

Use a small isolated prototype to compare the rotation candidates. Exercise whole-record boundaries, the active-file allowance, startup over budget, inability to delete, a partial final line and competing writer locks. Reject a candidate that needs unrestricted buffering, unexpected console output, record splitting, quota overshoot or unsafe directory cleanup.

**Exit:** identity policy is explicit before shipping identity persistence; the writer choice and candidate resource limits have a concrete verification basis. The 256 MiB disk bound is not reopened by a library default.

### 2. Add the event contract and safe producer APIs

- Define the versioned event envelope and a small initial event catalog, with allowed fields, enum values, length/count limits, levels and origins.
- Add shared synthetic fixtures under `client/contracts/diagnostics.json`, following the existing file-contract approach. Validate the same accepted and rejected shapes in Rust and JavaScript; handwritten bindings are sufficient initially if contract tests keep them aligned.
- Place the Tauri-independent Rust contract and collector in a new `client/crates/situate-core/src/diagnostics/` module. Keep the JavaScript facade in `client/app/src/diagnostics/`, with plain-JavaScript compatibility and an injectable transport. These bindings share the same catalog and fixtures.
- Provide an in-memory destination and a no-op implementation for tests and unavailable logging. Do not create a general exporter registry or a new public package without an actual second consumer.
- Capture explicit immutable operation context rather than a global current span. Bind origin, persistent workspace identity, device/session identity and plugin aliases through host-supplied context; do not introduce a user-ID field.
- Reject unknown fields, private text, raw exceptions and oversized events before queue admission. Bound input processing before serialization; do not stringify an arbitrary object to discover that it is too large.

**Exit:** JavaScript/Rust fixtures agree, a caller cannot override bound context, and synthetic secret/content sentinels never reach either the queue or test destination.

### 3. Implement the bounded native collector and file writer

- Use a non-blocking producer boundary and a dedicated native file worker. Include event count, owned-byte usage, in-flight work and registry overhead in capacity accounting.
- Establish byte limits for every queue, producer registrations, plugin schemas and loss-counter cardinality. The concept's candidate values are starting points for verification, not a justification for leaving auxiliary collections unbounded.
- Preserve higher-priority events where possible under pressure; bound contention handling rather than wait on the worker. Test contention separately from a full queue.
- Serialize validated records into JSON Lines on the worker. Apply per-record, per-segment and aggregate limits before writes; do not call a generic unbounded serializer on the UI path.
- Own the private device-local directory and exclusive writer lock independently of workspace/history services. Reconcile all retained segments on startup, including prior schema versions, before admitting new file writes.
- Rotate whole records, repair only a torn trailing line under the lock, and stop writes when quota cannot be maintained. Never follow symlinks or delete unrelated paths to recover capacity.
- Handle disk-full, deletion failure, blocked I/O and lost worker availability without propagating failure to content operations. Use bounded loss summaries and rate-limited recovery, not recursive logging or fallback console/network output.
- Integrate best-effort shutdown draining without an unbounded worker join. Test a writer that never returns; a timeout around a wait must not hide another blocking destructor or join afterward.

**Exit:** fault-injection tests establish quota enforcement, independent application progress and finite resource usage. No network destination is present.

### 4. Connect Tauri and the frontend

- Add native composition and write-only batch admission in `client/app/src-tauri/src/diagnostics.rs`; initialize before workspace restoration in [the host entry point](../../client/app/src-tauri/src/lib.rs).
- Resolve the app-local log directory and device identity in the host. Workspace creation/storage owns portable workspace identity; the host obtains it through admitted workspace context, independently of the local location handle. Logging initialization failure leaves features usable rather than returning a fatal application-setup error.
- Bind registrations to the admitted window/producer and existing workspace authorization. Diagnostic context must not grant workspace access or allow a caller to spoof another origin.
- Batch safe frontend records with at most one unresolved diagnostic IPC call per WebView, shared across its producers. Test a permanently pending call, a rejected call and an uncertain reply without creating replacement promises or retrying application operations.
- Distinguish native admission from persistence. Keep producer and collector sequences so receipt order cannot be mistaken for causal order.
- Integrate startup, closure and quit with [frontend lifecycle coordination](../../client/app/src/lifecycle.ts) and native lifecycle handling. Reuse the existing shutdown decision flow; diagnostic flushing must not introduce a new confirmation or indefinite prerequisite.

**Exit:** a synthetic click-to-native-operation journey produces a correlated local record, and a stalled logging bridge does not stall that journey.

### 5. Instrument existing application behavior in vertical slices

Implement one complete interaction-to-outcome path first, then extend coverage through the same APIs:

| Slice                                 | Integration points                                                                                       | Evidence                                                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application/workspace lifecycle       | Frontend entry, native setup, workspace opening/closing and quit                                         | Startup without a workspace, multiple workspaces, normal exit and an incomplete session remain distinguishable.                                                                                    |
| Interaction and navigation            | `client/app/src/layout/`, file views and host-owned action handlers                                      | Pointer and keyboard activation record neutral action names; failed handlers do not become successful operations. Shared UI receives an injected capability and does not import application code.  |
| File operations                       | [Frontend file API](../../client/app/src/files/api.ts), native file commands and core storage boundaries | Save, conflict, retry and failure share causal context without paths, drafts, titles or content. Diagnostic failure does not change save semantics.                                                |
| Agent/model/tools                     | [Conversation runtime](../../client/app/src/ai/chat.ts), model transport, file tools and shell host      | Request/tool timing and outcomes are recorded without prompts, responses, arguments, command lines, stdout/stderr or credentials. Streaming does not emit one diagnostic record per token.         |
| Plugin and synchronization boundaries | Shared contract plus available runtime/transport integration points                                      | Synthetic adapter conformance initially; production instrumentation is completed with the corresponding production runtime. No invented plugin loader or sync implementation is added for logging. |

Do not route retained conversation/process-history records into diagnostics. In particular, preserve the existing [conversation cleanup](../../client/app/src/ai/conversation.ts) and [core conversation validation](../../client/crates/situate-core/src/conversation.rs); technical logs are not a second copy of those records.

**Exit:** every implemented slice has semantic events and a failure-path test. Missing production plugin/synchronization wiring is reported explicitly rather than covered up by passing synthetic adapter tests.

### 6. Verify platform behavior and resource use

- Reuse existing product browser flows for click/navigation/cancellation checks without personal workspaces. No visible UI change is planned; do not regenerate visual references merely because logging was added.
- Use native tests for actual file locking, permissions, directory resolution, restart recovery, multiple processes and shutdown. Desktop behavior does not establish Android/iOS suspension or filesystem behavior.
- Verify mobile retrieval through developer tooling and backup treatment without adding a product log viewer or upload feature. Use platform integration only where the test requires it.
- Measure events/minute and serialized bytes/event in synthetic light, agent-heavy, background and idle sessions. Report nominal lookback at 256 MiB plus rotation/overload losses; do not turn the current capacity estimate into a guaranteed duration.
- Measure producer latency, IPC frequency, queue high-water marks and UI responsiveness with the writer healthy, slow and blocked. Compare with the same workflows without logging. Set any missing performance acceptance thresholds explicitly rather than invent a passing value afterward.
- Run dependency/advisory/license checks if manifests change and review logs as potentially sensitive artifacts. Keep generated logs out of tracked files and published build artifacts.

**Exit:** the supported-platform evidence and remaining limitations are explicit, and local recording does not depend on network access or an external provider.

## Test allocation

Use the smallest test boundary that can expose the failure; keep fixtures synthetic.

| Risk                                          | Primary check                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal content in fields, exceptions or IDs | Shared contract fixtures and producer/collector tests with distinctive sentinel values; inspect actual JSON Lines in one native journey.                                    |
| Crossed contexts under overlapping operations | Deterministic asynchronous tests with separate panes/workspaces, reordered replies and clock changes.                                                                       |
| Unbounded memory or main-thread waiting       | Blocked transport/writer tests, queue/registry accounting and contention tests; confirm feature completion independently of writer release.                                 |
| Disk bound, unsafe cleanup or corrupt tail    | Filesystem integration tests with a reduced injected budget, restart, competing processes, symlinks and deletion/write failures. Assert the production constant separately. |
| Shutdown hangs                                | Native lifecycle test with a blocked writer and finite shutdown wait; exercise the actual cleanup path.                                                                     |
| Accidental remote transmission                | Recording integration with no external destination, bounded local/test adapters and verification that no exporter/network fallback is initialized.                          |
| Plugin-runtime gaps                           | Plain-JavaScript SDK conformance with a synthetic plugin, followed by real loader integration when available; neither substitutes for the other.                            |

Follow [repository testing](testing.md): focused contract/core/frontend checks first, then `node tools/test.mjs --quick --changed` and relevant integration/native/browser checks. Before creating a pull request, run `node tools/test.mjs --changed --base origin/main` with an up-to-date base reference. Missing platform prerequisites and unexecuted checks remain delivery limitations.

## Release validation checklist

Complete the applicable target checks before releasing default-on diagnostics. Record device and OS versions, commands, measurements and unresolved failures with the release evidence.

- [ ] Establish stable repeated macOS cold-start, window reload, workspace reopening and crash-recovery runs. Investigate intermittent native layout-smoke timeouts; a passing retry alone does not explain their cause.
- [ ] Build and test Android on a device or emulator, including document-provider identity handling, private log storage, developer retrieval, backup exclusion and background/resume behavior.
- [ ] Build and test iOS on a simulator and device, including workspace access, identity preservation, log retrieval, backup exclusion and suspension/resume behavior.
- [ ] Build and test Windows and Linux, including file permissions, exclusive locking, hard-link rejection, rotation, quota enforcement, competing processes and restart recovery.
- [ ] Define application-level performance acceptance thresholds before evaluation. Measure CPU, memory, UI responsiveness, producer latency, IPC frequency and queue high-water marks against equivalent workflows without logging, with healthy, slow and blocked storage.
- [ ] Measure event rates and serialized sizes during light, agent-heavy, background and idle sessions. Report nominal retention at 256 MiB together with rotation and overload losses, without promising a fixed retention period.

## Completion boundary

The local feature is complete only when data admission, byte-bounded asynchronous recording, 256 MiB rotation, persistent identity policy, supported-platform behavior and the implemented event coverage are verified together. A logger skeleton or a successful file-write test alone is not completion. Dependencies and adapters remain internal to the shared event API.

Remote delivery and analytics require separate decisions about participation, any additional identity association, transmitted data, retention and operational ownership. Workspace correlation does not establish that different workspaces belong to the same person. They are not implicit next implementation steps in this plan.

## Sources

The source snapshots below support the implementation findings; documentation describes upstream capabilities, not verified Situate integration. The alternative logging packages have not been integrated, target-built or benchmarked in Situate; their transitive dependencies and release-version selection still require review before adoption.

[tauri-docs]: https://v2.tauri.app/plugin/logging/
[tauri-native]: https://github.com/tauri-apps/plugins-workspace/blob/b6f39cc51c4be15fbc5f8623bcc775e23d0160af/plugins/log/src/lib.rs
[tauri-guest]: https://github.com/tauri-apps/plugins-workspace/blob/b6f39cc51c4be15fbc5f8623bcc775e23d0160af/plugins/log/guest-js/index.ts
[tauri-manifest]: https://github.com/tauri-apps/plugins-workspace/blob/b6f39cc51c4be15fbc5f8623bcc775e23d0160af/Cargo.toml
[tracing-readme]: https://github.com/tokio-rs/tracing/blob/9d0e557728ecb91e467fc29dfe738b9f28cf6684/tracing/README.md
[nonblocking-docs]: https://docs.rs/tracing-appender/latest/tracing_appender/non_blocking/struct.NonBlockingBuilder.html
[nonblocking-source]: https://github.com/tokio-rs/tracing/blob/9d0e557728ecb91e467fc29dfe738b9f28cf6684/tracing-appender/src/non_blocking.rs
[rolling-docs]: https://docs.rs/tracing-appender/latest/tracing_appender/rolling/struct.Builder.html
[tracing-manifest]: https://github.com/tokio-rs/tracing/blob/9d0e557728ecb91e467fc29dfe738b9f28cf6684/tracing-appender/Cargo.toml
[flexi-overview]: https://docs.rs/flexi_logger/latest/flexi_logger/index.html
[flexi-write-mode]: https://docs.rs/flexi_logger/latest/flexi_logger/enum.WriteMode.html
[flexi-manifest]: https://github.com/emabee/flexi_logger/blob/37e41a47e62613c6806b62a009162af9527eb016/Cargo.toml
[rotate-source]: https://github.com/kstrafe/file-rotate/blob/8ee371fd0e50d281e87d8a755aaeaa2c824f86b1/src/lib.rs
[rotate-suffix]: https://github.com/kstrafe/file-rotate/blob/8ee371fd0e50d281e87d8a755aaeaa2c824f86b1/src/suffix.rs
[rotate-manifest]: https://github.com/kstrafe/file-rotate/blob/8ee371fd0e50d281e87d8a755aaeaa2c824f86b1/Cargo.toml
[pino-browser]: https://github.com/pinojs/pino/blob/b29dbe97820630e7128e464c50263b427965ec99/docs/browser.md
[pino-manifest]: https://github.com/pinojs/pino/blob/b29dbe97820630e7128e464c50263b427965ec99/package.json
[otel-js]: https://opentelemetry.io/docs/languages/js/
[otel-license]: https://github.com/open-telemetry/opentelemetry-js/blob/e5db96115cfb4acec7597f7bf3db353c1f9d0f48/LICENSE
