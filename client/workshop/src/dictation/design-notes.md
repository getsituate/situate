# Chat dictation

## Approved direction and review question

This approved workshop direction covers [REQ-0024](../../../../requirements/data/requirements/REQ-0024-dictate-text-input.md) and the assigned portion of [REQ-0041](../../../../requirements/data/requirements/REQ-0041-download-dictation-models-after-installation.md). Production adoption, catalog reconciliation and native speech qualification remain open in the [implementation plan](../../../../docs/development/dictation-mvp-plan.md).

The central question is whether someone can distinguish **recording**, **transcribing** and **ready to send**, while understanding which draft receives the result after navigation.

Two approaches were considered:

- A recording sheet would make the microphone prominent but obscure the editable draft and interrupt cursor placement.
- Inline feedback keeps the draft and microphone together. A separate Settings page handles the one-time download without turning everyday chat into model management.

Recording replaces the microphone icon with a seven-bar waveform in the same control-sized space. Synthetic syllables and pauses drive the waveform; the controls offer ordinary speech, quiet speech and silence. The primary send button becomes a recording-stop button. It ends recording and starts transcription, never submission. Transcription replaces the waveform with three processing dots; sending stays disabled until completion. Successful insertion is visible in the editable draft and announced to assistive technology without an extra status row. Agent-stop remains a separate button.

REQ-0024 AC-05 uses this primary-button stop. The workshop does not establish criterion completion.

Both activity cues become static with reduced motion and stop animating when hidden, offscreen or covered by navigation or a dictation dialog. They are removed on completion or interruption. Neither animation controls the operation or submits the draft.

## Review entry points

Start the [design workshop](../../../../docs/development/design-workshop.md) and select one of two scenarios:

| Scenario           | Starting-state links                                                                                                                                                                                          | Review task                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dictate in chat    | `dictation-ready`, `dictation-recording`, `dictation-transcribing`, `dictation-selection`, `dictation-split`                                                                                                  | Start and stop, edit while waiting, replace a selection, switch chats and inspect the originating draft.                    |
| Dictate in chat    | `dictation-permission`, `dictation-denied`, `dictation-silence`, `dictation-failed`, `dictation-interrupted`                                                                                                  | Distinguish permission guidance, no speech, failure and lost recording. Recovery needs a new dictation, not retained audio. |
| Dictate in chat    | `dictation-offline`, `dictation-agent`, `dictation-close-files`, `dictation-close-agent`                                                                                                                      | Separate local dictation from AI availability, stop an agent independently, and review closure consequences.                |
| Dictation download | `dictation-download-waiting`, `dictation-download-active`, `dictation-download-paused`, `dictation-download-preparing`, `dictation-download-failed`, `dictation-download-storage`, `dictation-download-ready` | Inspect startup provisioning, route changes, preparation, retry and immediate readiness.                                    |

For browser mode, append `?workshop=controls&scenario=dictation-ready` to the workshop URL. Use `profile=ios&keyboard=open` to inspect reduced mobile content space. The controls window selects the dictation text language independently of platform or synthetic recognition text; the surrounding existing workshop shell remains English.

Controls expose the current operation rather than a completion timer. Stop recording in the preview, then complete, fail or return no speech from the controls. Permission outcomes and background/lock are also simulated there. Changing only viewport, platform or language preserves drafts. Starting-state changes and reset replace synthetic data and invalidate previous interactions.

## Interaction choices

- **Draft ownership:** each synthetic workspace has two conversations. Only the originating composer blocks sending. Other drafts remain usable, while all microphones explain the single-operation restriction. Completion uses the origin's latest selection, including changes after returning to it.
- **Recording navigation:** show a discard confirmation before leaving the recording. Escape and the stay action preserve it. Microphone permission pending uses the same conservative navigation guard; exact native permission timing still needs implementation review.
- **Transcription navigation:** chat, pane and workspace navigation does not cancel transcription. Other composers show no message about the active dictation. Their microphone buttons are disabled, with a short tooltip and accessible description. Returning to the originating draft uses ordinary chat and workspace navigation. Closing the originating workspace or quitting asks whether to stay and wait or discard.
- **Completion during confirmation:** replace the discard question with a finished state, retaining the choice to stay or continue. Do not discard already-inserted text or automatically finish the requested navigation.
- **Other closure work:** failed file saving takes priority and offers review in the existing editor. Reviewing cancels that close attempt, not transcription. An active response is disclosed in the close confirmation without implying that stopping undoes earlier changes. This is a proposed ordering, not a new storage or rollback contract.
- **Provisioning:** when speech recognition is unavailable, an information button occupies the microphone position. It opens a notice with a route to Dictation settings. Settings identifies device scope, not workspace scope. Progress is a percentage without an invented model size or completion estimate. Mobile-data loss of eligibility pauses progress; metered Wi-Fi resumes it. Preparation is visibly distinct from availability.
- **Recovery:** permission guidance, denied access, no speech, transcription failure and lost dictation use dismissible dialogs without expanding the input. Dismissing permission guidance does not grant access or cancel the pending system request. Other errors preserve the draft and selection; closing returns focus to the originating input. Notices from hidden chats wait until their draft is shown. A navigation confirmation takes precedence over a notice. Download and storage notices link to Settings for retry, still subject to connection eligibility. Offline sending is explained by its disabled-button tooltip; local dictation remains available.
- **Scope:** no mobile-data authorization, download cancellation, recording-cancel button, model/language chooser, cloud fallback or live partial transcript. The language selector in the controls is for design review, not a product preference for speech recognition.

## Coverage of the development-plan gaps

The references below correspond to the [plan's gap matrix](../../../../docs/development/dictation-mvp-plan.md#design-workshop-coverage). They describe prototype coverage, not catalog implementation status.

| Gap | Review path                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Ready → microphone → recording → primary stop → transcription → complete → edit → send; repeat in `dictation-agent`.                                                                   |
| W2  | `dictation-selection`; edit and change selection in both busy phases. Enter/Alt+Enter remain blocked for the origin.                                                                   |
| W3  | `dictation-transcribing` or `dictation-split`; navigate to Reading list or another workspace, type there, return and change the insertion target.                                      |
| W4  | `dictation-recording`; use conversation navigation, pane close, Files, Settings or the workspace menu. Exercise stay and discard.                                                      |
| W5  | Request quit in controls or close the workspace through its menu. Also inspect `dictation-close-files`, `dictation-close-agent`, and complete transcription while the warning is open. |
| W6  | Use Background or lock while recording; use it during transcription, then complete or explicitly interrupt the transcription.                                                          |
| W7  | `dictation-permission`; grant or deny, then change permission in controls and try again. No imitation OS prompt is drawn.                                                              |
| W8  | No speech and Fail transcription controls; inspect the draft and selection before and after.                                                                                           |
| W9  | Download scenario; navigate to chat while missing, downloading and ready. Typed input remains usable independently of the download.                                                    |
| W10 | Change the download connection among Wi-Fi, metered Wi-Fi, Ethernet, mobile data and offline. Switch workspaces and return to Dictation settings.                                      |
| W11 | Fail download or Insufficient storage, then retry in Settings.                                                                                                                         |
| W12 | `dictation-offline`; record, transcribe and edit without enabling send.                                                                                                                |

The dedicated chat flow reuses the workshop shell, `ChatView` and `ChatComposer`; its side-by-side presentation is not the full tab-layout coordinator. Tab-history integration and the separate file-editor chat placeholder remain production/adoption concerns, not additional dictation input areas.

## Evaluation and boundaries

Use desktop and iOS profiles, long German text, keyboard-open space, a 320 px width, keyboard-only confirmation and reduced motion. `dictation.spec.ts` exercises rendered Chromium/WebKit interactions and captures intermediate screenshots; `model.test.ts` checks transitions and ownership. Native microphone permission, speech quality, cellular restrictions, download persistence, audio disposal and background execution are not exercised by either suite.

Synthetic fixtures stay in memory. There are no audio recordings, model downloads, AI calls or real file writes. Browser profile geometry is not device qualification. The native workshop host renders the same design, not an Apple speech runtime.

Before adoption, test with a person who has not seen the design: ask them to dictate into an existing draft, change its selected words during transcription, switch chats, and explain where the text will appear and what still needs sending. Check whether the waveform-to-dots transition communicates that recording has stopped and processing is still pending, including with reduced motion. Check that the primary stop cannot be mistaken for sending, that dialogs preserve the insertion point and return focus, and that the disabled microphone's tooltip explains why a second dictation cannot start.

The implementation follows the [brand's everyday-work guidance](../../../../design/brand/docs/layout-and-components.md#states-without-theatrics) and UI Skills' [animation guidance](https://www.ui-skills.com/skills/emilkowalski/animate/llms.txt), [motion performance guidance](https://www.ui-skills.com/skills/ibelick/fixing-motion-performance/llms.txt) and [accessibility guidance](https://www.ui-skills.com/skills/ibelick/fixing-accessibility/llms.txt). Motion uses native animations of transform and opacity; accessible names, status announcements and focus restoration remain independent of playback. No external screenshots, code or assets are bundled.
