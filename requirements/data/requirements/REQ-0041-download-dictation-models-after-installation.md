---
id: REQ-0041
type: requirement
title: Download dictation models separately at application startup
status: approved
priority: must
area: Interaction
goals: [GOAL-0002]
acceptanceCriteria:
  - id: AC-01
    text: "The distributed application does not contain the transcription model payload needed for dictation."
    milestone: Dictation MVP
    status: open
  - id: AC-02
    text: "Starting the application without the required local model initiates a separate background download on a non-mobile-data connection without waiting for a dictation attempt or requiring confirmation. Wi-Fi and Ethernet qualify even if marked as metered."
    milestone: Dictation MVP
    status: open
  - id: AC-03
    text: "With only mobile data available, the model is not downloaded automatically."
    milestone: Dictation MVP
    status: open
  - id: AC-04
    text: "Users can explicitly start downloading over mobile data in Settings; the authorization applies only to that model download, not later replacements."
    status: open
  - id: AC-05
    text: "If the model is missing or its download was interrupted, the running application starts or resumes the download automatically when a non-mobile-data connection becomes available."
    milestone: Dictation MVP
    status: open
  - id: AC-06
    text: "Starting the application with the required model already available does not download that same model again."
    milestone: Dictation MVP
    status: open
  - id: AC-07
    text: "While the model is downloading, users can type and submit chat requests without waiting for the download to finish; other application features are not blocked by provisioning."
    milestone: Dictation MVP
    status: open
  - id: AC-08
    text: "If no compatible model is ready, the dictation control indicates that the model is missing or downloading and does not start recording."
    milestone: Dictation MVP
    status: open
  - id: AC-09
    text: "Settings display download status and progress."
    milestone: Dictation MVP
    status: open
  - id: AC-10
    text: "Once fully provisioned, the model is available to the dictation feature without restarting the application."
    milestone: Dictation MVP
    status: open
  - id: AC-11
    text: "An incomplete or failed download is not treated as a model ready for dictation."
    milestone: Dictation MVP
    status: open
  - id: AC-12
    text: "All workspaces in one application installation reuse the installed model; workspace synchronization and export do not include its files."
    milestone: Dictation MVP
    status: open
  - id: AC-13
    text: "No download-cancel control is offered in the MVP."
    milestone: Dictation MVP
    status: open
  - id: AC-14
    text: "Download failure or insufficient storage is explained, typed chat remains usable and Settings offer a retry action. Unrelated files are not deleted to free space."
    milestone: Dictation MVP
    status: open
  - id: AC-15
    text: "Model versions are tied to application versions; independent automatic model updates are not performed."
    milestone: Dictation MVP
    status: open
  - id: AC-16
    text: "A model replacement introduced with a new application version follows the same provisioning and mobile-data authorization rules."
    status: open
  - id: AC-17
    text: "During replacement, the old model is retained until the new model is completely downloaded and verified. If compatible with the new application version, it remains usable for dictation during this period."
    status: open
  - id: AC-18
    text: "After successful model replacement, the previous model is removed automatically."
    status: open
---

## Description

The transcription models needed for [dictation](REQ-0024-dictate-text-input.md) must be downloaded separately rather than bundled with the distributed application. At application startup, Situate must check whether the required model is available locally and initiate its download in the background if it is missing and a non-mobile-data connection is available. While the application is running, a missing or interrupted download starts or resumes automatically when such a connection becomes available. This includes Wi-Fi and Ethernet, even when marked as metered. Automatic download does not require a confirmation dialog and must not use mobile data; users can explicitly start the download over mobile data in Settings. That authorization applies only to the current model download, not to future model downloads. Provisioning must not wait until the first dictation attempt. The download runs in the background without blocking other application features; chat remains usable through typed input while the model is downloading.

An already available model is reused on subsequent starts rather than downloaded again. The MVP provisions the fixed Parakeet v3 variant selected for macOS and iOS, without a user-facing model chooser. One model installation is shared by all workspaces in the application installation. Model files are excluded from workspace synchronization and export. There is no download-cancel control in the MVP.

Model versions change only with a corresponding application version, not through independent automatic model updates. A required replacement follows the same download rules. The existing model remains until its replacement is completely downloaded and verified and remains usable during that period if compatible with the new application version. After successful replacement, the old model is removed automatically. The exact package and download hosting remain undecided.

When no compatible model is ready for use, the dictation control indicates that the model is missing or still downloading instead of starting a recording. Settings show download status and progress and provide the action to start downloading over mobile data. Successful provisioning makes dictation available without requiring another application start. Download failure or insufficient storage is explained without blocking typed chat. Settings offer a retry action. The application does not delete unrelated files to make room.

## Rationale

Separating transcription models from the application keeps the initial application download smaller and faster, while making the models available after installation.

## Source

Private chat interaction requirements conversation and follow-up clarification; dates not recorded, transcripts not included. Background downloading with immediate typed chat use was confirmed.

Private dictation scope clarification; date not recorded, transcript not publicly available. Automatic background provisioning over Wi-Fi, explicit mobile-data download in Settings, automatic resumption when Wi-Fi returns, visible readiness and progress, and a fixed Parakeet v3 model for the macOS and iOS MVP were confirmed.

Private dictation provisioning clarification; date not recorded, transcript not publicly available. Automatic download on all non-mobile-data connections, authorization limited to the current mobile-data download, per-installation storage outside workspace transfer, error explanation and retry, no initial download-cancel control, and application-version-bound model replacement with retention of a compatible old model were confirmed.

## Open questions

- Which Parakeet v3 package, runtime, hosting and redistribution terms are suitable for the supported Apple devices, and is local preparation required after download before dictation is ready?
- How is model integrity verified, and what local preparation is needed before a downloaded replacement is ready?
- Should explicit mobile-data authorization for an unfinished download survive an application restart?
- How should model compatibility with a new application version be determined?
