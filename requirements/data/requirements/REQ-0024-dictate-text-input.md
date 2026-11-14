---
id: REQ-0024
type: requirement
title: Dictate text input for Situate
status: approved
priority: should
area: Interaction
goals: [GOAL-0002]
acceptanceCriteria:
  - id: AC-01
    text: "Users can provide spoken input in chat and receive its transcription as editable chat input."
    milestone: Dictation MVP
    status: open
  - id: AC-02
    text: "Users can read and edit the recognized text before submitting it."
    milestone: Dictation MVP
    status: open
  - id: AC-03
    text: "Recognizing speech alone does not submit the input or execute the instructions it contains."
    milestone: Dictation MVP
    status: open
  - id: AC-04
    text: "Users can submit the reviewed text as an input to Situate."
    milestone: Dictation MVP
    status: open
  - id: AC-05
    text: "On macOS with Apple Silicon, pressing the microphone button starts recording; the primary composer button stops recording and starts transcription. No separate recording-cancel button is offered."
    milestone: Dictation MVP
    status: open
  - id: AC-06
    text: "While recording or transcribing, the originating draft remains editable but cannot be submitted."
    milestone: Dictation MVP
    status: open
  - id: AC-07
    text: "On completion, recognized text is inserted at the originating draft's current cursor position, replacing its current selection if any without replacing surrounding text."
    milestone: Dictation MVP
    status: open
  - id: AC-08
    text: "After switching chats during transcription, the result uses the originating draft's last valid cursor position or selection, not the active chat. Returning and moving the cursor or changing the selection before completion changes the insertion target."
    milestone: Dictation MVP
    status: open
  - id: AC-09
    text: "While any chat is recording or transcribing, another recording cannot start elsewhere in the application."
    milestone: Dictation MVP
    status: open
  - id: AC-10
    text: "Users can dictate continuously for several minutes."
    milestone: Dictation MVP
    status: open
  - id: AC-11
    text: "German speech is recognized as German with an English system and interface, and English speech is recognized as English with a German system and interface, without selecting another model or language."
    milestone: Dictation MVP
    status: open
  - id: AC-12
    text: "The MVP uses a fixed Parakeet v3 variant with automatic recognition of its supported languages and no user-facing model selection."
    milestone: Dictation MVP
    status: open
  - id: AC-13
    text: "With the model ready and network access disabled, users can record, transcribe and edit dictated chat input. Submitting it does not imply that the agent can process requests offline."
    milestone: Dictation MVP
    status: open
  - id: AC-14
    text: "Audio is not sent to an external service, including after local recognition fails."
    milestone: Dictation MVP
    status: open
  - id: AC-15
    text: "Audio is discarded after successful processing, recording interruption or abortion, and transcription failure; it is not retained for retry, chat history or synchronization."
    milestone: Dictation MVP
    status: open
  - id: AC-16
    text: "Navigating away from a recording warns that proceeding discards the dictation. Cancelling the navigation preserves the recording; proceeding discards it."
    milestone: Dictation MVP
    status: open
  - id: AC-17
    text: "Switching chats during transcription neither warns nor aborts it; the result remains assigned to the originating draft."
    milestone: Dictation MVP
    status: open
  - id: AC-18
    text: "Closing the originating workspace or quitting the application warns when it would interrupt transcription and discard the dictation, and lets the user stay and wait."
    milestone: Dictation MVP
    status: open
  - id: AC-19
    text: "Application backgrounding or device locking stops and discards an active recording when prior confirmation is unavailable. An already-running transcription continues where platform execution permits; on return, a detected interruption that lost the dictation is explained where possible."
    milestone: Dictation MVP
    status: open
  - id: AC-20
    text: "If microphone permission is denied, the application explains the missing permission and points to system settings; typing remains possible."
    milestone: Dictation MVP
    status: open
  - id: AC-21
    text: "If no speech is recognized, the application reports that outcome without inserting or replacing text."
    milestone: Dictation MVP
    status: open
  - id: AC-22
    text: "If transcription fails, the draft and text selection remain unchanged, the audio is discarded and the application explains that a new dictation is needed."
    milestone: Dictation MVP
    status: open
---

## Description

Users should be able to dictate input for Situate through speech-to-text instead of typing it. Recognized speech is presented as editable text that users can review and correct before submitting. Dictation does not directly execute spoken instructions. Chat must offer this input method. Required transcription models are [downloaded separately at application startup](REQ-0041-download-dictation-models-after-installation.md), rather than bundled with the application.

The MVP provides dictation in chat on macOS with Apple Silicon using one fixed NVIDIA Parakeet v3 model variant. iOS and Intel Macs are deferred. It automatically recognizes the spoken language among the selected variant's supported languages, independently of the system and interface languages. German and English are included; support for every language is not promised. The initial implementation uses FluidAudio 0.17.7 with the fixed Parakeet v3 Core ML conversion on macOS 14 or later. Performance benchmarking and quantitative quality thresholds are deferred; functional and privacy verification remain required. User-selectable models and specialized language or resource profiles are [outside the MVP](../foundations.md#initial-dictation-delivery).

Pressing the microphone button starts recording. The primary composer button then stops recording and starts transcription without submitting the draft. There is no separate recording-cancel button. Only one recording or transcription may be active across the application at a time. Dictation supports speech lasting several minutes; no fixed maximum recording duration or transcription latency is specified.

The originating chat draft remains editable during recording and transcription, but cannot be submitted until dictation finishes. The recognized text is inserted at that draft's current cursor position when transcription completes, replacing its current text selection if present and preserving surrounding text. After a chat switch, the originating draft's last valid cursor position or selection applies; returning and changing it before completion changes the insertion target. A result never goes into another chat merely because that chat is now active.

Navigation away from a running recording, including a chat or workspace switch, warns that proceeding discards the dictation and lets the user cancel the navigation. During transcription, switching chats does not warn or abort the work; the result still belongs to the originating draft. Closing the originating workspace or quitting the application warns if doing so would abort transcription and discard the dictation, allowing the user to stay and wait.

Moving the application to the background or locking the device stops and discards an active recording when a prior navigation confirmation is not available. An already-running transcription should complete if platform execution permits. If operating-system interruption prevents completion, the application explains the lost dictation on return where possible; graceful handling after forced termination is not guaranteed.

Denied microphone access is explained with guidance to system settings; typed input remains available. If no speech is recognized, the application reports that outcome without inserting or replacing text. On transcription failure, the application leaves the draft and selection unchanged, discards the audio and explains that the user must dictate again.

Once the model is ready locally, recording and transcription work without an internet connection. Audio is processed only on the device, with no cloud fallback, and is discarded after processing. Interrupted or aborted recordings and failed transcription attempts also discard their audio rather than retaining it for retry. Audio is not retained as chat content, synchronized content or a permanent recording. Disposal after an interruption does not require a recording-cancel control.

## Rationale

Dictation provides an alternative way to express requests and add information when delegating organizational work. Reviewing the recognized text allows users to correct transcription errors before Situate acts on their input.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Dictation for interaction with Situate was requested and clarified as speech-to-text rather than direct execution of spoken instructions. Classified as a should-have requirement.

Private chat interaction requirements conversation; date not recorded, transcript not included.

Private dictation scope clarification; date not recorded, transcript not publicly available. Offline-only processing, audio disposal including failures and interruptions, microphone-button start/stop, insertion at the cursor and automatic language recognition were confirmed. A fixed Parakeet v3 model for the macOS and iOS MVP was selected; model choice and specialized variants were deferred. This is a product decision, not evidence of device performance or recognition quality.

Private dictation interaction and lifecycle clarification; date not recorded, transcript not publicly available. Editable drafts with submission blocked, current-position insertion and selection replacement, application-wide single dictation, recording-navigation warnings, continued transcription across chat switches, closure warnings and platform interruption behavior were confirmed. Permission, no-speech and failure handling were agreed. Multi-minute dictation remains in scope without a fixed duration limit or latency threshold.

## Open questions

- Which exact Parakeet v3 package and runtime meet the recognition-quality, memory, latency and energy needs on supported macOS hardware? iOS device selection remains deferred.
- When should iOS and Intel Macs be included in dictation delivery?
- Which input areas beyond chat should offer dictation later?
