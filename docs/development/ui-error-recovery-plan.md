# UI error recovery implementation plan

## Scope and design reference

Implement local failure containment, a shared unexpected-error dialog, user-initiated problem reports and explicit recovery actions for macOS and iOS. This is a proposed production implementation sequence. The workshop models interactions in memory; it does not establish working persistence, email delivery, workspace reload or application restart.

The reference is **Error recovery** in the [Design Workshop](design-workshop.md), implemented under [`client/workshop/src/error-recovery/`](../../client/workshop/src/error-recovery/). Its starting states are:

| Starting state          | URL scenario                | Review focus                                                                |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------- |
| Plugin pane unavailable | `recovery-pane`             | Healthy content and navigation remain usable.                               |
| Unexpected error        | `recovery-unexpected`       | General dialog, Bend, main actions and More options.                        |
| Report preview          | `recovery-report`           | Optional description and inspectable technical details, always included.    |
| Mail unavailable        | `recovery-mail-unavailable` | Selectable report text without an email application.                        |
| After restart           | `recovery-restart`          | Recovery destination; the stable URL no longer opens a confirmation dialog. |
| Startup unavailable     | `recovery-startup`          | The same dialog before a workspace is open.                                 |

The dialog has a large centered Bend illustration and one finite gesture, a general headline and short explanation, **Report a problem** and **Reload workspace** as its main actions, and a flat **More options** section for repair and restart. Startup uses **Reload Situate** instead. Close and Escape dismiss the explanation without clearing the incident. Technical details appear in the report flow, not in a nested disclosure inside More options.

Recovery adds workspace reload and application restart, not a general view-reload API. Existing operation-specific retries remain local.

Restart begins after selection without a second normal confirmation. Reports have no technical-data checkbox or save-file action. Keep these interaction choices when replacing the simulation with real services. The workshop-only extraction of `updates/RestartDecision.vue` does not remove update confirmations or establish a shared production restart service.

Governing constraints include [assisted repair](../../requirements/data/requirements/REQ-0063-start-assisted-repair-from-errors.md), [diagnostic data limits](../../requirements/data/requirements/REQ-0067-limit-diagnostic-data.md), [plugin recovery](../../requirements/data/requirements/REQ-0032-manage-plugin-status-and-disabling.md), [translation completeness](../../requirements/data/requirements/REQ-0053-enforce-interface-translation-completeness.md), and [workspace compatibility](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md).

## 1. Separate local failures from unavailable services

Start with the plugin-management defect, before adding the global dialog.

- In `client/app/src/plugins/runtime.ts`, distinguish inventory availability from a failed plugin invocation, cleanup or publication. A single action failure must not make the installed-plugin overview unavailable. Keep execution admission fail-closed where state is uncertain.
- In `plugins/PluginManagement.vue`, retain the heading, last confirmed inventory, navigation and relevant dialogs. Show action failures at their owning control; retain existing operation-specific retries and offer repair/report entry points for inventory-read failures. Do not present an unreadable inventory as an empty installation.
- Clear a failure only after the corresponding operation or reconciliation succeeds. An old rejected initialization promise or component-local error must not override a later successful read.
- Investigate native failures behind `native.plugins.unavailable` with bounded stage/error classifications. That code is also used for execution failures; it does not establish missing source files or a permission problem. Preserve existing public error compatibility where required.

Acceptance: a rejected plugin action followed by opening Plugins leaves management usable; an unchanged successful inventory check cannot leave a stale action error blocking the view. Inventory failure remains distinguishable from zero installed plugins.

## 2. Add a small application-owned incident coordinator

Introduce the incident state and recovery host under the product app, separate from the existing plugin-suppression module `recovery.ts`.

An incident needs a bounded identity, owning operation/boundary, known scope, safe classification, observed outcome and available recovery actions. Keep exception objects and presentation state out of workspace records. Do not guess a workspace from whichever tab is currently active.

Compose with the existing Vue/window handlers in `diagnostics/failures.ts` and the local boundary in `layout/ViewHost.vue`; do not install a second competing handler chain. Logging remains independent of user-visible recovery. Locally handled validation, cancellation and expected service failures do not automatically open the general dialog. Unknown exceptions escalate when no local boundary can handle them safely.

- Coalesce repeated delivery into one incident and one dialog. Keep UI coalescing separate from diagnostic event recording.
- Dismissal retains a recovery entry and unfinished work. A repeated background notification must not reopen a dismissed dialog or replay Bend's gesture.
- A failed recovery attempt keeps the incident and shows its result; a genuinely new incident remains discoverable.
- Do not retain callbacks tied to obsolete workspace sessions. Disable recovery while it is pending and reject stale completion events.
- Mount the recovery host independently of replaceable workspace views. If mounting that host fails, retain a minimal static recovery surface without recursive reporting.

Acceptance: Vue errors, uncaught promises, consumed view errors, hostile rejection objects and failures of diagnostics/recovery itself have bounded behavior. No exception text or arbitrary object serialization enters diagnostics or reports.

## 3. Adopt the dialog and replace message-only dead ends

Copy and adapt the workshop composition and local artwork into production; never import workshop components, state or styles. Use product `SituateDialog`, button variants and canonical tokens. Put English and German copy in the central catalogs.

Retain the finite Bend gesture, static reduced-motion state and immediate availability of controls. Record the narrow error-motion and dry-humor exception in the canonical brand guidance during adoption; do not generalize it to validation, permissions, uncertain external effects or data-loss explanations.

| Product boundary                                           | Adoption work                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugins/PluginManagement.vue`                             | Apply local containment from step 1; preserve the overview.                                                                                                        |
| `files/FileEditor.vue`                                     | Use scoped notices for plugin sources as well as ordinary files; retain readable content, selection and navigation.                                                |
| `components/ChatPane.vue`                                  | Preserve the owner, history, draft, attachments and queued input; route unhandled load failures to the shared dialog rather than substitute an empty conversation. |
| `layout/ViewHost.vue`                                      | Retain its existing retry/choose-view fallback and connect it to incident context.                                                                                 |
| `main.ts`, `StartupFailure.vue`, `App.vue`                 | Reuse the general dialog for startup failures without requiring a workspace, model access or plugin imports. Keep startup checks fail-closed.                      |
| `components/AppShell.vue`, `onboarding/OnboardingHost.vue` | Preserve existing scoped recovery and add a non-destructive escape where persistent loading currently blocks navigation.                                           |
| `plugins/PluginCodeBrowser.vue`                            | Confirm whether it is still reachable before changing or removing it.                                                                                              |

Audit remaining whole-view branches, including changes inspection and deleted-file results. Keep existing local patterns where they already work. Replace tests that prohibit error actions with assertions for scoped recovery, retained work, focus and navigation.

## 4. Implement recovery as lifecycle operations

The workshop reducer is not a production shutdown protocol. Reuse the ownership and acknowledgement patterns in `client/app/src/lifecycle.ts`, native `lifecycle.rs`, and `updates/lifecycle.rs`, without invoking update installation to obtain a restart.

**Reload workspace:** add an explicit operation; the existing workspace `reload` action is not evidence that a live workspace can be safely closed and reopened. Capture the authorized session, stop new admission, preserve drafts and queued input, stop and settle affected execution, flush retained state, release old runtime resources, and reopen the same authorized location. Preserve other workspaces and plugin-suppression preferences. Show pending, failed and unconfirmed-cancellation states without resetting storage.

**Restart Situate on macOS:** selecting restart authorizes the coordinated stop-and-restart attempt, without a second normal confirmation. Collect acknowledgements from every participating window and workspace, preserve pending input and attachments, stop running work, and relaunch only after required persistence and shutdown have succeeded. A missing acknowledgement, failed save or uncertain preparation blocks relaunch and preserves a visible recovery path. Do not add an implicit force-exit fallback. Resolve preparation ordering with existing conversation/file owners so work cannot write after its final checkpoint.

**iOS and startup:** offer workspace reload where available and manual reopening guidance, not programmatic process restart. Startup retry reruns only the failed initialization through a controlled, idempotent path; it must not bypass plugin-suppression or compatibility checks. A startup incident has no invented workspace or plugin culprit.

Reopening waits for user interaction before continuing interrupted work. Never infer that an uncertain external effect did not occur. Ordinary Quit, workspace closure and update installation retain their existing contracts.

## 5. Build bounded problem reports and email handoff

Create one immutable, previewable report snapshot per explicit report request. Include app/platform versions, incident classification, operation stage, known outcomes and relevant causal identifiers. Technical details are always included and inspectable. Bound the optional description and total report size; report missing or omitted evidence honestly.

Use an allowlisted projection, not raw exception messages, stacks, source, full logs or arbitrary plugin metadata. Exclude automatic notes, conversation content, private titles/paths, credentials and screenshots. Existing local diagnostics may supply relevant retained events through a narrowly authorized host capability; do not give plugins general installation-wide log access. Missing diagnostics must not block the basic report.

Implement host-owned composition to `bugs@getsituate.com` with the exact previewed report. Use an available platform email composer or a bounded, correctly encoded email-draft handoff. Do not add SMTP, an upload backend, automatic transmission or hidden attachments. Treat opening a draft as distinct from sending. If composition is unavailable, offline or exceeds the supported handoff size, preserve selectable report text and the description. Do not silently drop technical data to fit a URL limit.

Acceptance: privacy sentinels remain absent, including when errors contain hostile getters or embedded instructions. Preview and outgoing body match. Close, Back, failed handoff and reopening retain the description. No email is sent by a test or merely by displaying an incident.

## 6. Connect explicit assisted repair

Adapt the existing development-conversation entry points in `ai/chat.ts` and `components/AppShell.vue` to accept a prepared incident assignment. Selecting repair opens and focuses a distinct development conversation and starts diagnosis once, without another submission. Merely displaying or dismissing the incident starts no AI work.

Carry only relevant context, safe diagnostics and known operation outcomes. Treat supplied error/source text as evidence, not instructions. Preserve the originating view and work; repair completion must not replay the failed action or resume unrelated plugins.

When model access, storage or a compatible workspace is unavailable, retain the prepared assignment, show the actual blocker and offer explicit retry. Disclose when retention is memory-only. Startup and compatibility-blocked repair need a safe host context; never open an incompatible workspace merely to obtain a development conversation. Inventory published conversation readers/writers before adding persisted fields, and apply the compatibility requirements to any format change.

## Verification and delivery order

Implement steps 1–3 first, then lifecycle recovery, reports and repair. Do not expose an enabled action before its real adapter exists. The feature is complete only when every offered action works or explains its concrete blocker.

| Risk                                | Verification                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One plugin failure hides management | Runtime and management regression tests with unchanged inventory, late initialization and successful reconciliation.                                    |
| Dialog storms or lost context       | Coordinator/handler tests for duplicates, dismissal, new incidents, workspace switching and stale completions.                                          |
| Lost work during reload/restart     | Frontend and native lifecycle tests for multiple windows, queued input, failed saves, missing acknowledgements, cancellation and reopen without replay. |
| Private data in a report            | Synthetic hostile errors and sentinel notes, paths and credentials; bounded report and preview/handoff equality tests.                                  |
| Misleading repair                   | Missing model/storage, unknown culprit, duplicate activation and compatibility-block tests; preserved assignment and original work.                     |
| Inaccessible or oversized dialog    | Product browser flows on Chromium/WebKit, keyboard focus and Escape, narrow iOS geometry, long translations, reduced motion and reopened incidents.     |

For workshop integration, run quick/feedback checks, the workshop build, and the error-recovery and update browser suites. For production adoption, run affected product unit, localization, type and build checks; reuse product browser flows and update affected visual references through the locked Docker workflow. Add native synthetic journeys for actual email-composer handoff, safe macOS relaunch and startup recovery. Qualify iOS recovery and composition on a simulator/device; browser geometry alone is insufficient.

Before a PR, run `node tools/test.mjs --changed --base origin/main` against an up-to-date base, following the [testing guide](testing.md). Report unavailable native prerequisites and unrun qualification separately from passing shared checks.

## Limits and decisions to resolve during implementation

- A frozen UI thread or native crash cannot reliably display this dialog. Preserve the independent plugin-free startup path; do not promise runtime isolation or automatic rollback.
- Specify finite report-size/event-count budgets and verify actual macOS/iOS composer behavior before choosing the handoff implementation.
- Define the startup/blocked-workspace repair host and the minimum independently mountable recovery surface before wiring those actions.
- The exact native source of a generic plugin-unavailable incident needs its own reproduction and diagnostics. Correcting the UI's error scope does not establish that native cause.
