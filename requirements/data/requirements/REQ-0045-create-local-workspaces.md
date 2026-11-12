---
id: REQ-0045
type: requirement
title: Create a local workspace at a chosen storage location
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001]
---

## Description

Users must be able to create a local workspace from the [workspace entry window](REQ-0044-select-and-remember-workspaces.md) by entering a name and choosing a parent storage directory. Situate proposes a changeable parent directory and shows the complete resulting workspace path before confirmation. Creation makes a new subdirectory named for the workspace rather than converting the selected parent directory into a workspace.

On macOS, normal startup retains the workspace overview, with the workspace list and its creation and opening actions. Choosing **Create a workspace** starts the fullscreen Astra welcome. Completion or Skip proceeds directly to the creation form, without another workspace-choice screen. Reduced motion bypasses the welcome immediately. Creation and subsequent setup use the shared setup frame, five-step progress, paper-garden/Bend illustration and task card. Cancelling before creation returns to the normal overview. Opening an existing workspace does not replay the welcome or creation; an incomplete workspace resumes its saved setup state.

Only confirmation creates the workspace. On success, Situate remembers its location and opens its setup flow. The workspace follows the [portable directory boundary](REQ-0038-copy-portable-workspaces.md). Immediately after successful creation, users must connect usable AI access using the providers and authentication methods defined by [REQ-0015](REQ-0015-connect-user-provided-models.md) before entering guided onboarding. This step has no skip-to-manual-use route. The created local workspace and retained setup progress remain available for later continuation if connection setup cannot be completed. This setup configures only the current device. Synchronization and import are optional, not prerequisites for creation or onboarding completion.

The required initial connection is distinct from continued access after the working method has been confirmed and the application entered. Choosing Open app ends guided onboarding in the same completed state as final setup confirmation, even when import or optional work remains unfinished. Their conversation, drafts, substantive questions and active work continue in ordinary chat without cancellation or a guided continuation state. Guidance completion does not claim that this work succeeded. The first entry uses the existing finale once; reopening does not replay it. After entry, unavailable AI prevents AI work but does not block reading or manually editing locally stored content under [REQ-0008](REQ-0008-local-content-availability.md). The [onboarding foundations](../foundations.md#onboarding-and-contextual-learning) define progress retention, cross-device continuation and the transition to normal use.

Creation assigns a new random opaque workspace identifier and stores it in portable workspace metadata. It does not require an account or a synchronization service. The identifier remains stable through later synchronization, transfer and restoration and supplies the workspace context for [diagnostic events](REQ-0064-record-client-diagnostic-events.md). It is not derived from the workspace name, path or user identity.

If the target directory already exists, Situate must not overwrite it or silently reuse it for creation. Users can choose another name or parent directory, or open an existing Situate workspace at that location through the separate opening action.

## Rationale

Users need to understand where their personal organizational content will be stored. Guided setup requires connected AI, but neither a synchronization service nor a content import. A new, explicitly named directory keeps creation distinct from opening or importing existing content.

## Source

Private workspace-entry and creation clarification conversation; date not recorded, not publicly available. Name and parent-directory selection, target-path preview, creation of a new subdirectory, remembering and opening the result and protection of existing directories were confirmed. Priority was confirmed as must-have.

Private onboarding scope clarification; date not recorded, transcript not publicly available. Required AI connection before guided setup, no initial manual-use bypass, retained progress and optional synchronization/import were confirmed.

Private diagnostic workspace-identity clarification; date not recorded, transcript not publicly available. A random workspace identifier generated during creation and retained with synchronized workspace metadata was confirmed.

## Acceptance criteria

- On macOS, startup shows the normal workspace overview. Only choosing Create a workspace starts the fullscreen welcome; completing or skipping it opens creation directly, and reduced motion reaches creation without delay.
- The creation form and subsequent setup retain the shared setup frame, five-step progress, paper-garden/Bend illustration and task-card layout.
- Opening an established workspace does not replay onboarding. Opening an already-created incomplete workspace resumes saved setup without repeating the welcome or creation.
- The creation flow accepts a workspace name and offers a proposed parent directory that the user can change.
- Before confirmation, the user can see the complete path of the subdirectory that will be created.
- Successful confirmation creates the workspace in that new subdirectory, opens it and remembers its location in the workspace list.
- Each newly created independent workspace receives a distinct random opaque identifier in its portable metadata, without needing an account or synchronization setup.
- Cancelling before confirmation does not create a workspace and returns to the normal workspace overview.
- An existing target directory is not overwritten, converted or silently reused by creation; the user can revise the target or use the separate opening action for an existing Situate workspace.
- A creation failure is reported rather than presented as a successfully created workspace.
- Immediately after successful creation, users enter a required provider connection step supporting the providers and authentication methods required by REQ-0015.
- Without usable AI access selected for the current workspace on this device, users cannot proceed into guided onboarding or bypass it into initial manual use. Connection failure retains the created workspace and progress for continuation.
- Creation-time AI setup does not configure other devices. Continuing incomplete onboarding on another device requires usable local access there without repeating the saved interview.
- Users can create a local workspace and complete onboarding without configuring synchronization or importing content.
- After working-method confirmation, Open app ends guided onboarding just like final setup confirmation. The same conversation, drafts, substantive questions and active work remain available in ordinary chat; unfinished import or optional work is not marked successful.
- After entry and reopening, there is no guided continuation view or setup banner. Previously entered workspaces with unfinished guidance also use this completed guidance state without replaying work.
- The existing finale plays only on the first entry, not on reopening an entered workspace.
- App entry and guidance completion do not commission plugin development. An explicit commission in the setup chat starts an ordinary development conversation immediately, including before app entry, without replacing the visible guided conversation. Setup completion does not wait for development.
- After entry, AI unavailability blocks AI work but not reading or manually editing existing local content.

## Open questions

- Which parent storage directory should be proposed initially?
- Should later creation flows propose the last-used parent directory?
- Which naming rules and explanations apply to invalid names on each supported platform?
- How are partially created directories handled after an interrupted or failed creation?
- Which platform-specific storage selection constraints apply on mobile devices?
