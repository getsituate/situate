# Client logging improvements

## Scope

Extend the existing local diagnostics implementation with consistent severity rules, failure-boundary coverage and a development-terminal log view. Keep the existing shared API, native collector, JSON Lines storage, rotation and installation-wide 256 MiB limit.

The governing requirements are [event coverage](../../requirements/data/requirements/REQ-0064-record-client-diagnostic-events.md), [the shared API](../../requirements/data/requirements/REQ-0065-provide-shared-logging-api.md), [bounded storage](../../requirements/data/requirements/REQ-0066-bound-local-diagnostic-storage.md) and [data limits](../../requirements/data/requirements/REQ-0067-limit-diagnostic-data.md). The [diagnostics concept](../architecture/08-cross-cutting-concepts/client-diagnostics.adoc) and [existing implementation reference](client-diagnostics-plan.md) remain canonical for the collection pipeline.

This is a proposed implementation sequence, not a claim that the improvements are shipped. Findings below come from source inspection; no runtime qualification was performed for this plan.

## Existing capabilities and observed gaps

| Area                         | Evidence                                                                                                                                                                                                                         | Consequence                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Local files                  | `client/crates/situate-core/src/diagnostics/` implements the collector and bounded segment storage; `client/app/src-tauri/src/diagnostics.rs` composes the production file destination.                                          | Reuse the existing pipeline rather than add another logger or file writer.                                                      |
| DevTui                       | `tools/dev-tui/src/process.rs` reads child stdout/stderr; its actions launch the existing client commands. There is no structured diagnostic-file reader in the inspected integration.                                           | Process output does not provide the requested application-event view.                                                           |
| Frontend failure capture     | `client/app/src/main.ts` starts diagnostics and mounts Vue without a central Vue error handler or global error/rejection listeners.                                                                                              | Unhandled frontend failures have no general route into the diagnostic event API.                                                |
| Local view failure capture   | `client/app/src/layout/ViewHost.vue` sets a fallback state in `onErrorCaptured` and returns `false`, without emitting a diagnostic event there.                                                                                  | A global Vue handler alone cannot cover errors consumed by this boundary.                                                       |
| Severity consistency         | TypeScript `Operation.finish` in `client/app/src/diagnostics/producer.ts` maps cancellation to `warn`. Native `Operation::record` maps successful starts and finishes to `debug`, and cancellation with an error code to `warn`. | Equivalent operations have different severities; ordinary cancellation appears as degradation.                                  |
| Unfinished native operations | Native `Operation::drop` records every unfinished operation as cancelled.                                                                                                                                                        | An unwinding panic can be represented as cancellation; abandonment is not evidence of a user-requested stop.                    |
| Failure event vocabulary     | `client/contracts/diagnostics.json` has operation events but no dedicated general runtime-failure event.                                                                                                                         | General handlers need a reviewed event definition rather than arbitrary exception serialization or fictitious operation starts. |

The source inspection does not establish complete command/background-task coverage or target-platform behavior. Those are explicit audit and verification steps below, not demonstrated missing coverage at every call site.

## 1. Align event semantics and severity

Update the existing diagnostics concept and shared contract first, then align TypeScript and Rust bindings.

| Level   | Rule                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `error` | A terminal operation failure or an observed unhandled failure. Emit a stable safe classification, not the original exception text. |
| `warn`  | Recoverable degradation, a retry needed after a failed attempt, a detected interruption, or known diagnostic loss.                 |
| `info`  | Application lifecycle, important operation starts, successful completion and ordinary user cancellation.                           |
| `debug` | Selected internal decisions, transitions and attempt details.                                                                      |
| `trace` | Semantic control activation, navigation and fine-grained technical steps; no text-entry capture or token-by-token model output.    |

Actions:

- Make equivalent operation outcomes use equivalent severity in both bindings. Keep normal cancellation distinct from interruption and abandonment.
- Classify rejected operations by meaning: a routine validation or policy decision is not automatically an operational error. Inspect existing callers before assigning their levels.
- Keep the default local threshold including `trace`; a DevTui display filter must not change file recording.
- Add a runtime-failure event with finite boundary and error-code attributes. Add only reviewed values needed by actual handlers.
- Define one owner for each operation's terminal record. Nested operations may have their own spans; rethrowing the same failure through several layers must not produce duplicate terminal records for one operation.
- Replace the unconditional native drop-as-cancelled interpretation with explicit handling for observed unwind, known cancellation and otherwise unfinished execution. Do not claim a cause that was not observed.
- Keep contract changes additive where existing meanings remain unchanged. If an existing field is reinterpreted, follow the schema-version rule in the diagnostics concept.

Acceptance: shared fixtures and language-specific behavior tests cover success, failure, cancellation, rejection, retry, unwind and unfinished execution, including repeated finish calls.

## 2. Capture frontend failures at the owning boundaries

Add a small frontend failure-reporting adapter under `client/app/src/diagnostics/` and install it before mounting Vue.

Actions:

- Register `app.config.errorHandler`, `window` error and `unhandledrejection` listeners. Distinguish script execution failures from resource-load failures without recording resource URLs.
- Report locally consumed failures from `ViewHost.vue` while preserving its existing fallback behavior and propagation policy.
- Normalize known errors to allowlisted codes; unknown values become an unknown-failure code. Do not inspect arbitrary getters, stringify rejection values or capture raw Vue component objects.
- Preserve explicitly available operation/workspace context. A global callback without reliable context emits an application-scoped event; it must not guess the active workspace or use a mutable global current operation.
- Prevent recursive reporting if diagnostics itself fails. Prefer boundary ownership to deduplication; if overlapping callbacks require deduplication, keep its state bounded and avoid retaining arbitrary error objects indefinitely.
- Keep listener installation and cleanup idempotent for tests and application lifecycle. Do not suppress browser defaults merely to avoid console output.
- Keep logging separate from recovery and user-visible error presentation. Do not add automatic retries or new recovery UI.

Acceptance: component, asynchronous and non-Error failures reach an injected destination with safe attributes; locally consumed failures are retained; diagnostics failure does not recurse or change application behavior.

## 3. Audit native command and background-task boundaries

Inventory production Tauri commands and spawned tasks, including tasks outside the diagnostics module. For each, identify the result observer, diagnostic context, cancellation behavior and terminal-event owner.

Actions:

- Fill demonstrated gaps at command and task ownership boundaries using the existing producer API, not logs in every `catch` or `Err` branch.
- Observe task results and distinguish returned errors, requested cancellation and task panics. Preserve existing application shutdown/cancellation behavior.
- Evaluate a minimal application panic hook after this inventory. If used, emit only a non-blocking, allowlisted notification, exclude the panic payload, and preserve the existing hook behavior deliberately. Test interactions with task-level observation to prevent duplicate reporting.
- Never lock the async diagnostics runtime, perform file I/O or wait for flushing in a panic hook. Use only a producer that is already available; if it is unavailable, accept loss.
- Do not introduce blanket `catch_unwind` recovery or attempt to continue corrupted work. Abort, native crashes, forced termination and failures before collector readiness remain outside any persistence guarantee.

Acceptance: injected command failure, background-task failure, task panic and explicit cancellation produce the intended classifications without duplicate terminal records or blocked shutdown. Crash-path checks run in disposable subprocesses.

## 4. Add a read-only DevTui application-log view

Start with the native desktop client launched from the development terminal. Browser-only development has no native file collector; do not silently present its process output as equivalent application diagnostics. Mobile retrieval and a browser transport are separate follow-up scope.

Actions:

- Add a structured file-following module in `tools/dev-tui/src/`, separate from child-process output collection.
- Establish a development-launch discovery mechanism for the actual diagnostic directory and session ID. Inspect existing path overrides and launch scripts before selecting the mechanism. Do not hard-code a macOS directory, select the globally newest session or assume a second worktree acquired the installation writer lock.
- Prefer reading the existing files over introducing a production log-reading IPC API or a second event pipeline. Any launch metadata channel must be local, narrowly scoped and independent of producer payloads.
- Display application events separately from build/process output, with time, level, event, origin and available operation context.
- Provide level/category/session filtering and trace selection, pause/follow and scrolling. Display filters and pause affect only the viewer, not native recording.
- Bound retained bytes, records and individual input lines. Follow rotation, tolerate partial final lines, handle file replacement and unsupported schema versions, and ignore malformed records without echoing raw content.
- Treat file contents as untrusted terminal input: remove terminal-control sequences and never execute links or commands from records. Preserve the file writer's ownership; the viewer must not rotate, delete or repair logs.
- Distinguish waiting for records, unavailable storage/writer, parse omissions and viewer-buffer eviction. Do not report viewer omissions as collector losses or infer a crash from a missing normal end record.

Acceptance: synthetic rotated files exercise partial writes, invalid/oversized lines, terminal escapes, bounded buffers, filters and session isolation. Existing pseudo-terminal tests cover navigation and terminal restoration with the new view. A native development launch demonstrates live events from its own session without changing retained file data.

## 5. Verify the complete local diagnostic path

Extend existing tests rather than build a parallel diagnostics test harness.

- Shared contract tests: accepted/rejected runtime-failure events and finite attributes in both bindings.
- Frontend tests: Vue handler, consumed view errors, global errors/rejections, duplicate prevention, lifecycle cleanup and unavailable transport.
- Native tests: terminal-event ownership, cancellation versus interruption/unwind, task observation, unavailable collector and bounded shutdown.
- Privacy tests: sentinel document content, credentials, paths and provider error text must be absent from admitted events, queues and files. Cover hostile rejection objects as well as ordinary exceptions. Do not add stack capture in the initial implementation.
- DevTui tests: rotation, multi-session/worktree isolation, partial records, malformed input, terminal safety and bounded memory behavior.
- Extend `client/app/src-tauri/tests/support/diagnostics_smoke.rs` and its frontend journey to verify a synthetic handled failure reaches real JSONL files with the expected safe classification and causal context. Exercise an actual uncaught frontend failure in an isolated journey rather than calling the reporter directly as proof of global handler wiring.
- Reuse existing collector/storage fault tests for disk failure, quota, stalled destinations and shutdown; add cases only where new behavior changes those boundaries.

Run focused tests first, then `node tools/test.mjs --unit --changed` and applicable quick/check suites. Run `cd client && npm run test:native -- --diagnostics` for frontend/native/file integration and the DevTui Cargo tests, formatting and Clippy for its changes. Use the pinned toolchains and prerequisites in the [testing guide](testing.md). Before a pull request, run unfiltered `node tools/test.mjs`; report unavailable prerequisites and target-platform limits rather than treating them as passes.

## Future diagnostic reports

Existing local structured files, build metadata and causal identifiers are the basis for a later user-selected report. This work must preserve those fields and privacy constraints, but adds no report UI, archive/export format, attachments, upload endpoint, external destination, consent flow or automatic transmission.

A later report can select only records still retained. Rotation, overload and abrupt termination may remove relevant evidence. Logs remain pseudonymous technical records, not anonymous data or a lossless audit trail. Selection, preview, transmission and any additional content require their own implementation and data-flow decisions.
