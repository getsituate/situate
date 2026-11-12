# Dictation MVP implementation plan

## Scope and delivery boundaries

The first implementation targets **macOS 14 or later on Apple Silicon only**. iOS and Intel Macs are deferred. Use FluidAudio 0.17.7 and the pinned Parakeet v3 Core ML artifact in `client/app/src-tauri/dictation/Sources/SituateDictation/ModelManifest.swift`. Quantitative quality, latency, memory and energy qualification is deferred; no benchmark threshold gates this increment. Functional, privacy, integrity and lifecycle checks remain required. The cross-platform qualification items below describe later work, not a claim of iOS support. Download eligibility follows macOS route reporting and URLSession's cellular prohibition; a tethered Wi-Fi or Ethernet route does not reveal its upstream transport.

The catalog milestone is **Dictation MVP**. Its scope is defined by [REQ-0024](../../requirements/data/requirements/REQ-0024-dictate-text-input.md), [REQ-0041](../../requirements/data/requirements/REQ-0041-download-dictation-models-after-installation.md) and [Initial dictation delivery](../../requirements/data/foundations.md#initial-dictation-delivery).

| Requirement | Included acceptance criteria | Deferred criteria                                                                           |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| REQ-0024    | AC-01–AC-22                  | None                                                                                        |
| REQ-0041    | AC-01–AC-03, AC-05–AC-15     | AC-04: explicit mobile-data download; AC-16–AC-18: model replacement, retention and cleanup |

These are 36 assigned criteria, all currently recorded as open. The workshop interaction below is approved as the design direction. Product implementation, native qualification and acceptance-criterion completion remain open.

Deliver offline chat dictation on macOS with Apple Silicon with one fixed Parakeet v3 variant, automatic spoken-language recognition including German and English, and automatic model provisioning on non-mobile-data connections. Typed chat remains available during provisioning. Dictation produces an editable draft, never a submitted request or an executed instruction.

Do not add model selection/import, language selection, quality profiles, cloud recognition fallback, retained audio, live partial transcription, a recording-cancel button or a download-cancel button. Do not implement other input areas or deferred product platforms. Initial provisioning needs a non-mobile-data connection; a release must not change the fixed model version until the deferred replacement workflow exists.

## Approved interaction

The [chat dictation workshop](../../client/workshop/src/dictation/design-notes.md) is the design reference for adoption:

- Keep the composer's existing height for dictation feedback. Recording replaces the microphone icon with a compact waveform; transcription uses processing dots in the same space. Reduced motion retains static cues.
- During recording, the primary Send control becomes Stop recording and transcribe. It ends capture and starts recognition without submitting the draft. During transcription, submission remains disabled. Agent-stop stays separate.
- Keep the draft editable and insert the result at its latest selection. Show successful insertion in the draft without a status row or success dialog.
- In other chats, disable only the microphone and explain it with a short tooltip and accessible description. Do not add a busy banner or return action.
- Present permission guidance, denied access, no speech, failure and interruption in dismissible dialogs. Preserve the draft and selection, return focus after dismissal, and defer a hidden chat's error until its draft is shown.
- When the model is unavailable, an information control at the microphone position opens a notice linking to device-local Dictation settings. Typed chat remains usable.

REQ-0024 AC-05 uses the approved primary-button stop and retains its no-recording-cancel boundary. Design approval does not close the criterion.

## Existing implementation and reuse

Product source review baseline: `db8277cc`. Workshop evidence comes from the current scenario registry, simulation, unit tests and rendered Chromium/WebKit journeys. Browser geometry and synthetic outcomes do not establish native platform behavior.

| Area                     | Current evidence                                                                                                                                                                                                                                                                                                                                                           | Implementation consequence                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product composer         | [`ChatComposer.vue`](../../client/app/src/components/ChatComposer.vue) renders a permanently disabled microphone. It already supports typed input, attachments, Enter/Alt+Enter submission and agent-stop controls.                                                                                                                                                        | Extend the existing composer; do not build a second input surface. Keep dictation-stop distinct from agent-stop.                                                                                                      |
| Conversation ownership   | [`ai/chat.ts`](../../client/app/src/ai/chat.ts) retains per-workspace, per-conversation drafts and persists their changes. It has no dictation session or retained text-selection state.                                                                                                                                                                                   | Use the existing conversation owner and persistence path for recognized text. Add transient cursor/selection state, not a second draft store.                                                                         |
| Presentation and closure | [`layout/runtime.ts`](../../client/app/src/layout/runtime.ts), [`lifecycle.ts`](../../client/app/src/lifecycle.ts) and [native lifecycle coordination](../../client/app/src-tauri/src/lifecycle.rs) already separate views from execution and coordinate files/AI during closure.                                                                                          | Integrate dictation into existing navigation and close/quit paths; do not replace their file-save or AI safeguards.                                                                                                   |
| Settings                 | [`SettingsView.vue`](../../client/app/src/settings/SettingsView.vue) exposes formats, appearance and AI settings; no dictation provisioning page exists.                                                                                                                                                                                                                   | Add a small device-local dictation section. Existing workspace-oriented Settings framing must not imply that each workspace downloads its own model.                                                                  |
| Native host              | [`lib.rs`](../../client/app/src-tauri/src/lib.rs) owns startup and native state. The inspected application has no Parakeet, microphone or model-provisioning implementation.                                                                                                                                                                                               | Add one application-owned native capability, with Apple-specific adapters only where needed.                                                                                                                          |
| Workshop                 | [Dictation views and model](../../client/workshop/src/dictation/), [scenario catalog](../../client/workshop/src/workshop/scenario-catalog.ts) and [browser journeys](../../client/workshop/tests/browser/dictation.spec.ts) provide two scenarios with 21 synthetic starting states. The shared composer supports selection, admission feedback and a primary stop action. | Adopt the approved interaction without importing workshop code into the product. Full tab history and the [editor-side chat placeholder](../../client/workshop/src/editor/EditorChatPane.vue) still need integration. |
| Tests and localization   | [Composer tests](../../client/app/src/components/chat/ChatComposer.test.ts), [workshop chat flow](../../client/workshop/tests/browser/chat.spec.ts), product browser fixtures and central [catalogs](../../client/packages/localization/src/catalogs) already exist.                                                                                                       | Extend behavioral tests and German/English catalogs. Microphone visibility alone is not dictation coverage.                                                                                                           |

Follow the existing [conversation ownership strategy](../architecture/04-solution-strategy/application-and-agent.adoc), [package boundaries](../architecture/05-building-block-view/level-2/application/current-client-package-boundaries.adoc) and [close/quit protocol](../architecture/06-runtime-view/current-client-application-quit-and-cancellation.adoc). Dictation's recording-navigation warning is an explicit requirement, not a new rule for ordinary agent execution.

## Implementation sequence

### 1. Qualify the fixed model and native integration

**Dependencies:** none. Workshop work can proceed in parallel using synthetic outcomes.

- Select the exact Parakeet v3 artifact and runtime through a bounded macOS/iOS prototype. Do not substitute another recognition model if qualification fails.
- Review model weights, conversions, runtime dependencies, hosting and redistribution terms. Pin artifact identity, source, integrity metadata and runtime version; ship runtime code with the host, not executable code downloaded as model data.
- Resolve supported OS versions and hardware classes, explicitly including the open questions about older iPhones and Intel Macs. Measure recognition quality, multi-minute recording/transcription, peak memory, storage, latency and energy on the intended devices. The catalog supplies no fixed duration cap or latency threshold; agree qualification criteria rather than inventing them.
- Prove offline German speech with an English system/interface and English speech with a German system/interface. Inspect SDK behavior for implicit network calls, telemetry and audio retention.
- Determine whether download completion requires conversion, compilation or other preparation. Readiness must mean usable by the runtime, not merely fully transferred.
- Verify how native networking distinguishes mobile data from non-mobile-data routes and prevents an active transfer from moving onto cellular. Metered Wi-Fi and Ethernet remain eligible. Record any OS limitation, including ambiguous routes or tethering, before committing to a delivery claim.

**Exit:** a reviewed, legally usable artifact/runtime choice and a native feasibility result for both platforms. Device support, distribution rights or resource failures block delivery; browser mocks cannot clear this gate.

### 2. Prepare the approved workshop design for adoption

**Dependencies:** milestone scope; no production runtime required.

The workshop provides two scenarios, **Dictate in chat** and **Dictation download**, with 21 starting states. Use the coverage matrix below and the [workshop extension and adoption workflow](design-workshop.md) for remaining integration work. Preserve the existing scenario grouping and ensure controls follow the visible screen. Full tab-history coordination and the editor-side chat presentation remain unintegrated; the simplified split-chat scenario is not evidence for those paths.

Use manual completion/failure controls for transcription and provisioning, plus synthetic permission, network, storage and interruption outcomes. Reset must clear pending operations; late completions from a previous scenario must have no effect. Never request a real microphone, download a model or call an AI provider in the workshop.

Carry the approved compact composer and dialog behavior into the product only after catalog reconciliation and an explicit implementation request. Retain checks for macOS/iOS profiles, narrow widths, mobile keyboard occlusion, long German text, keyboard/focus behavior, accessible status and reduced motion. Use canonical [brand guidance](../../design/brand/README.md). Assistive-technology testing, user evaluation and native qualification remain separate from browser assertions.

**Exit:** the catalog and selected interaction agree; full tab/editor-chat integration has defined coverage; remaining workshop paths are reachable and reviewed, including intermediate states and both branches of discard confirmations. Production adoption and independent product tests belong to step 5.

### 3. Provision one model per installation

**Dependencies:** artifact/network decisions from step 1; Settings design from step 2 for UI adoption.

- Initialize provisioning from native application startup, independently of an open workspace, AI-provider setup, Settings visibility or a first dictation attempt. Keep downloads and local preparation off the UI thread.
- Store the fixed model and partial download in application-owned device-local storage outside workspaces, history, export and synchronization. Reuse the same ready model across windows and workspaces and subsequent launches. Prevent concurrent provisioning jobs.
- Expose a small status snapshot/event interface: checking, waiting for an eligible connection, downloading with progress, preparing/verifying if needed, ready and failure. Separate model availability from recording/transcription state.
- Start or resume automatically when a non-mobile-data route is available, including metered Wi-Fi/Ethernet. Pause on loss of an eligible route and resume when one returns. Validate resumable data against the pinned artifact; incomplete, corrupt or incompatible data must never become ready.
- Verify the artifact and finish required local preparation before publishing readiness. Dictation becomes available without restarting the application.
- Report download and insufficient-storage failures with Settings retry. Retry still obeys the non-mobile-data restriction; it must not act as deferred mobile-data authorization. Delete only owned unusable staging data, never unrelated files to make space.
- Add the approved Settings section and composer availability feedback. Typed input and submission remain independent of provisioning. Offer neither mobile-data download nor cancellation in this milestone.

**Likely changes:** `client/app/src-tauri/src/lib.rs`, a focused native dictation/provisioning module, a frontend state adapter under `client/app/src/`, `client/app/src/settings/`, localization catalogs and native dependency/build configuration as required by step 1.

**Exit:** cold startup, network transitions, partial restart, integrity failure, disk-full recovery and warm startup all follow REQ-0041. Installed application bundles contain no model payload.

### 4. Record and transcribe locally

**Dependencies:** step 1 and a verified local model from step 3.

- Own the single active dictation in native application state, not a Vue component or a window-local singleton. Reserve admission before asynchronous permission/startup work so simultaneous starts cannot create two recordings.
- Bind each operation to its originating window, workspace session and conversation, with an operation identity for stale-event rejection. Authorize native commands against that owner. Keep the model installation global without sharing transcript results across workspace owners.
- Request microphone permission on an explicit start, not application startup. Starting uses the microphone control; the approved design stops capture and starts transcription through the primary button. Reconcile AC-05 before adopting that control mapping. Another start anywhere is rejected while recording or transcribing.
- Keep audio in native transient storage/buffers and off provider, chat-history, attachment, diagnostics and synchronization paths. Use a capture strategy qualified for several minutes of speech; avoid unbounded copies across IPC.
- Release microphone resources and dispose of audio on every terminal path: success, no speech, failure, confirmed discard and detected OS interruption. If the runtime needs temporary files, constrain them to an owned non-synchronized area and define cleanup of leftovers after abnormal termination. Do not retain audio for retry.
- Publish only bounded status/error data and the final text to the originating owner. No automatic submission, cloud fallback or transcript/audio logging.
- Extend Apple microphone usage descriptions and applicable signing/privacy configuration. Reuse central native translations and the existing permission-resource generation path rather than embedding English-only prompt text.

**Likely changes:** the native dictation module, the smallest Apple adapter required by the selected runtime, host command/event registration, `Info.plist`, `ios-permissions/`, relevant release configuration and `client/scripts/generate-mobile-permissions.mjs` with its tests. Do not broaden the provider-auth or workspace-access plugins into a general speech abstraction.

**Exit:** native start/stop, denied permission, no speech, runtime failure, repeated use and competing-window admission are verified without a cloud service.

### 5. Integrate drafts, navigation and lifecycle

**Dependencies:** steps 2–4. Draft and lifecycle tests can start earlier with a deterministic native double.

- Adopt the approved compact activity cues, primary stop and recovery dialogs in the existing `ChatComposer.vue` and `ChatPane.vue`, then connect them to dictation state. Recording and transcription must not depend on an agent connection or selected chat model; offline dictation remains possible. Existing conditions for sending to an agent still apply afterward.
- Keep the originating draft editable. Block its submission in both composer interactions and the conversation runtime, including Enter, Alt+Enter, button clicks and queued steering/follow-up paths. Do not disable typing or submission in unrelated chats merely because dictation is active elsewhere.
- Retain each originating draft's latest valid cursor/selection independently of component lifetime. Observe edits, pointer/keyboard selection, blur and pane changes; microphone interaction must not reset the insertion target. Handle multiple presentations of the same conversation consistently.
- On success, insert into the originating draft's current text and selection, preserving surrounding text, then use existing draft persistence. After switching away, use that draft's last valid selection; returning and changing it before completion changes the target. Ignore duplicate or stale results after disposal/reopening. Do not insert into whichever chat happens to be visible.
- On no speech or transcription failure, do not write to the draft or selection; retain edits made while waiting. Explain no speech separately from failure, and require a fresh dictation after failure.
- Guard navigation away during recording before committing the destination: chat/workspace switches, pane/tab closure and other host routes that leave the recording. Cancelling navigation keeps recording; confirming discards audio and proceeds. Reuse semantic navigation entry points so pointer, keyboard and programmatic navigation cannot bypass the guard.
- During transcription, chat switches do not warn or stop work. Closing the originating workspace or quitting requires a choice to stay and wait or discard and proceed. Integrate with existing file/AI participants; a cancelled close must not silently stop dictation, leave admission locked or schedule a later close.
- Handle native background/lock/interruption signals, not just browser visibility. Backgrounding or locking discards an active recording when prior confirmation is unavailable. An existing transcription continues where platform execution permits. Explain detected loss on return where possible; do not promise recovery after forced termination.
- Keep cleanup independent of mounted views. A late result must not revive a closed workspace or mutate a reopened session with the same persisted identity.

**Likely changes:** `client/app/src/ai/chat.ts`, `client/app/src/components/ChatComposer.vue`, `ChatPane.vue`, layout coordination, `App.vue`, frontend/native lifecycle coordinators, dictation state adapter and localization catalogs. Add only the dictation participation needed by the existing lifecycle; a new generic workflow engine is unnecessary.

**Exit:** one complete offline record → transcribe → edit flow, safe draft insertion across navigation, all discard/interruption paths and explicit submission afterward. Agent execution and file-save protection retain their existing behavior.

### 6. Qualify and close the milestone

**Dependencies:** steps 1–5, approved UI and actual Apple-device results.

Run the targeted checks below, then the affected repository MVP suites before a PR. Record model/runtime versions, hardware/OS, observed results and unresolved failures without publishing personal recordings or transcripts. Update individual catalog criterion statuses only when supported by corresponding evidence. Keep the four deferred REQ-0041 criteria outside this milestone.

## Design Workshop coverage

**Simulated** means the flow is available through workshop state and controls, not through native speech or provisioning. **Partial** identifies a remaining presentation or navigation gap. Stable W1–W12 references link to the [review paths](../../client/workshop/src/dictation/design-notes.md#coverage-of-the-development-plan-gaps); they are not acceptance statuses or additional scenarios.

The [dictation browser journeys](../../client/workshop/tests/browser/dictation.spec.ts), [state tests](../../client/workshop/src/dictation/model.test.ts) and [animation lifecycle tests](../../client/workshop/src/dictation/DictationActivity.test.ts) cover draft ownership, compact geometry, modal recovery, focus, DE/EN text, reduced motion and reset. W1 follows the approved stop-control design rather than the still-unreconciled AC-05 wording. W4 covers the dedicated chat's navigation and pane close, but not full tab history or editor-side chat.

| Ref | Status        | Required scenario and transitions                                                                                                                                                                                                                                | Acceptance criteria                      | Needed by |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------- |
| W1  | **Simulated** | Ready microphone → recording → transcription → inserted editable text → explicit send. Repeat with an existing draft and with the agent already working; distinguish dictation-stop from response-stop. No recording-cancel control.                             | REQ-0024 AC-01–AC-06                     | Steps 4–5 |
| W2  | **Simulated** | Edit text and move the cursor during both busy phases; replace a current selection, preserve prefix/suffix, and keep Send/Enter/Alt+Enter blocked only for the origin. Completion never sends automatically.                                                     | REQ-0024 AC-02–AC-08                     | Step 5    |
| W3  | **Simulated** | Transcribe in chat A, switch to B without warning, show that another recording cannot start, and complete into A. Return to A and move its selection before completion. Include split panes and a workspace switch while the originating workspace remains open. | REQ-0024 AC-08–AC-09, AC-17              | Step 5    |
| W4  | **Partial**   | Navigate away while recording: stay preserves recording; proceed discards it. Exercise chat/workspace changes and pane/tab navigation with focus restored after cancellation.                                                                                    | REQ-0024 AC-15–AC-16                     | Step 5    |
| W5  | **Simulated** | Close the originating workspace or quit during transcription: stay and wait versus discard and proceed. Include composition with existing file/AI close warnings and completion while a warning is open.                                                         | REQ-0024 AC-15, AC-18                    | Step 5    |
| W6  | **Simulated** | Simulated background/lock while recording followed by a return notice; transcription returns completed or interrupted depending on the selected outcome.                                                                                                         | REQ-0024 AC-19                           | Step 5    |
| W7  | **Simulated** | Microphone permission request pending, granted and denied; denied access explains the system-settings remedy while typing stays usable. Simulate the outcome, not an imitation OS permission dialog.                                                             | REQ-0024 AC-20                           | Steps 4–5 |
| W8  | **Simulated** | No speech and transcription failure as distinct outcomes. Existing draft/selection remain intact; failure says a new dictation is needed, with no audio-retry action.                                                                                            | REQ-0024 AC-21–AC-22                     | Steps 4–5 |
| W9  | **Simulated** | Composer and Settings agree on missing model, waiting offline/mobile-data-only, downloading with progress, preparation if needed, and ready without restart. Typed chat is usable throughout. No cancellation or mobile-data action.                             | REQ-0041 AC-02–AC-03, AC-07–AC-11, AC-13 | Step 3    |
| W10 | **Simulated** | Provisioning pauses when the eligible route disappears and resumes on Wi-Fi/Ethernet, including metered connections. Shared progress survives Settings navigation and workspace switching; retry does not bypass route restrictions.                             | REQ-0041 AC-02–AC-03, AC-05, AC-12       | Step 3    |
| W11 | **Simulated** | Download failure and insufficient storage with Settings retry, retry-in-progress and recovery to ready. Composer remains unavailable for recording but typed chat still works.                                                                                   | REQ-0041 AC-08–AC-11, AC-14              | Step 3    |
| W12 | **Simulated** | Ready-model dictation with network disabled or no AI connection. Review/edit remains available while sending continues to obey agent-access rules. Synthetic German/English outcomes do not introduce a language/model selector.                                 | REQ-0024 AC-11–AC-14                     | Steps 4–5 |

Apply desktop/mobile sizes, keyboard occlusion, accessibility and German/English text checks across these flows rather than duplicating each as a separate screen. Update the workshop's editor-side chat placeholder where that surface participates in the reviewed flows; do not introduce dictation into Markdown source editing.

Workshop simulation cannot establish recognition quality, multi-minute resource behavior, real permissions, cellular restrictions, audio deletion or OS background execution. Those remain native qualification responsibilities.

## Verification and acceptance trace

| Verification boundary                                      | Minimum evidence                                                                                                                                                                                                                                                                                              | Criteria covered                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Conversation/composer unit tests                           | Editable busy draft; all send paths blocked; current-selection replacement; changed selection after returning; two conversations and two panes; no-speech/failure preserve current text and selection; duplicate/late results ignored.                                                                        | REQ-0024 AC-01–AC-09, AC-17, AC-21–AC-22                                                    |
| Native state and IPC integration                           | Single admission across windows, concurrent permission requests, authorized result ownership, cleanup on all terminal paths, disposed workspace generations, repeated recording.                                                                                                                              | REQ-0024 AC-05, AC-09, AC-14–AC-15, AC-20–AC-22                                             |
| Provisioning integration with controlled transport/storage | Startup without a workspace; offline/cellular-only wait; metered Wi-Fi/Ethernet download; route change mid-transfer; resume after restart; corrupt/incomplete payload; insufficient disk; retry; ready event; no duplicate download across workspaces/launches. Inspect bundle and storage/export boundaries. | REQ-0041 AC-01–AC-03, AC-05–AC-15                                                           |
| Product browser journeys and visual checkpoints            | W1–W12 through real product components with deterministic IPC; desktop/mobile layouts, DE/EN, keyboard/touch selection, focus, announcements and busy/error states. Keep workshop tests separate.                                                                                                             | Visible portions of REQ-0024 AC-01–AC-09, AC-16–AC-22 and REQ-0041 AC-07–AC-11, AC-13–AC-14 |
| Native close/interruption journeys                         | Cancel/confirm navigation and close/quit; race with transcription completion; existing file/AI guards; background and lock while recording/transcribing; return after detected interruption.                                                                                                                  | REQ-0024 AC-15–AC-19                                                                        |
| Real macOS/iOS model qualification                         | Several-minute speech on supported devices; opposite system/interface language; fully offline transcription; no outbound audio on success or failure; no retained recording; permission denial/re-enable; measured resource behavior and verified fixed artifact.                                             | REQ-0024 AC-10–AC-15, AC-19–AC-22                                                           |

Use synthetic text and purpose-made, authorized/licensed speech fixtures. Mocked runtime tests do not prove local-only processing or resource suitability; a successful browser or macOS run does not qualify iOS.

Commands follow [repository test selection](testing.md), using Volta's shims and root pins:

```sh
# Fast feedback during implementation, from the repository root
node tools/test.mjs --unit --changed
node tools/test.mjs --quick --changed

# Workshop simulation and adoption-reference checks
cd client
npm run test:design
npm run test:browser:design
npm run build:design

# Product UI/build and localization checks
npm run test:browser
npm run check:localization
npm run build
cd ..

# Affected MVP suites before opening a PR, using an up-to-date base reference
node tools/test.mjs --changed --base origin/main
```

Add focused native model/provisioning tests to the relevant host suite; they do not exist yet. Run actual macOS and iOS builds and device journeys after native integration. The default runner does not qualify physical iOS devices. For intentional visual changes, extend existing product flows with intermediate checkpoints, then update and inspect references using the locked Docker workflow in [Visual regression tests](testing.md#visual-regression-tests).

## Decisions that can block delivery

1. **Artifact/runtime and rights:** exact package, supported execution backend, hosting, integrity verification and any local preparation remain unselected.
2. **Supported hardware and quality:** older iPhones, Intel Macs, minimum OS versions and measurable acceptance thresholds need a decision backed by step 1, not a silent reduction of scope.
3. **Native network and execution limits:** cellular exclusion, route changes, background/lock signals and transcription continuation need platform evidence. A workshop switch is not such evidence.
4. **Catalog and product integration:** reconcile REQ-0024 AC-05 with the approved primary-button stop. Implement the native capability and adopt the workshop design into production; full tab-history/editor-chat integration and native permission/lifecycle behavior remain unqualified.

No general model-management subsystem, new speech-provider abstraction, marketplace work or separate planning artifacts are needed to deliver this increment.
