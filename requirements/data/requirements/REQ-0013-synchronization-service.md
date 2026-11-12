---
id: REQ-0013
type: requirement
title: Synchronize tasks, notes, documents, plugins and chats across devices
status: approved
priority: must
area: Platforms and synchronization
goals: [GOAL-0001]
---

## Description

Users must independently configure each workspace to use no synchronization, the official Situate service or a custom synchronization plugin. When configured, synchronization covers the workspace's tasks, notes, documents, plugins and chats across the user's connected devices and platforms. The built-in service serves one person's devices, not collaboration between users in a shared workspace; custom plugins do not create first-class collaboration, roles or merging guarantees.

With connectivity and synchronization configured, synchronization runs automatically while the workspace is open, without requiring a save, commit or manual synchronization action. Opening a workspace immediately permits use of existing local content while synchronization proceeds in the background. Visible synchronization state indicates that remote changes may still be pending; content not yet local remains subject to initial synchronization.

Before closing the last window of a workspace with synchronization configured and unsynchronized changes, Situate must warn the user and offer “synchronize then close” or “close now.” The former keeps the workspace open until synchronization succeeds; offline operation, unresolved conflicts and failures must not be presented as completion. The latter preserves local changes for the next reopening and stops synchronization on closure. Closing a workspace never leaves synchronization running, even if other workspaces remain open; reopening resumes it if configured. Local-only workspaces do not require synchronization before closing. [Workspace lifecycle](REQ-0037-keep-workspaces-independent.md) separately offers cancellation of closure or abort-and-close for active actions. Cancelling closure leaves normal synchronization in place. If closure proceeds, synchronization choices remain applicable to all retained local changes; choosing to abort active actions does not choose how to handle pending synchronization. Workspace lifecycle also governs automation and external-change detection. On mobile, switching the active workspace leaves the previous workspace open and does not itself stop its configured synchronization, subject to operating-system limits. Automatic reopening of last-open workspaces at startup follows the same synchronization rules as manual reopening.

Ordinary workspace content remains locally available as plaintext files for reuse without Situate. This does not apply to separately protected credentials.

The official Situate synchronization service must use end-to-end encryption. Neither the synchronization service nor Situate as its operator may decrypt synchronized user content. Plaintext processing of content authorized for an AI request through the [managed AI router](REQ-0016-managed-ai-access.md) is a separate data flow and must not give the synchronization service access to plaintext or decryption keys.

Synchronizing a plugin does not mean it can run on every destination platform. Deliberate platform restrictions remain visible in accordance with [REQ-0014](REQ-0014-plugin-platform-compatibility.md).

[Local availability of stored content](REQ-0008-local-content-availability.md) and its [reuse without Situate](REQ-0009-reuse-stored-content.md) remain intact. Synchronization does not require complete copies of all external sources that are merely connected. [Connected document search](REQ-0055-search-document-content.md) must not require all external originals on the querying device. The optional [managed document storage area](REQ-0062-synchronize-managed-document-storage.md) is a separate, deferred could-have; it does not change this requirement's must-have priority or initial replication of workspace content.

Users may write their own synchronization plugins, including transport of the complete workspace directory with `.git` and internal files to storage, or Git-server-based transfer. Plugins supply storage access and transport; the core retains responsibility for versioning, conflict handling and file/history recovery for every transport. Directory transfer is not inherently consistent: uncontrolled directory or Git-internal modifications can corrupt a repository, and this risk must be visible. [Repository corruption recovery](REQ-0022-explain-note-changes.md) is distinct from resolving a merge conflict in a valid repository. No particular Git host or storage provider is selected for the official service.

External modifications by other programs must be detectable and incorporated under [external editing](REQ-0009-reuse-stored-content.md). This does not promise arbitrary external writes to encrypted official storage or universal remote-edit interoperability. Alternative plugins determine content encryption and may store ordinary content unencrypted at the user's choice. The official service's encryption guarantee does not extend to them.

AI provider connections, credentials, endpoint addresses, selected access, default models and conversation-specific model selections are device-local settings scoped to their workspace under [REQ-0015](REQ-0015-connect-user-provided-models.md). They remain outside the portable workspace directory and its histories and are excluded from both official and custom synchronization. There is no provider-dependent exception for shareable keys or tokens. New devices configure their own access; synchronization neither populates nor replaces their AI configuration. Provider secrets remain in device-local OS secure storage, not in encrypted records uploaded to Situate-operated servers. Local-only use and custom synchronization require neither a Situate recovery key nor a portable credential vault.

Synchronized conversations retain their content, not per-message provider/model attribution, operational connection settings or the model selection for subsequent requests. Continuing on another device uses that device's selected access. [Managed Situate AI](REQ-0016-managed-ai-access.md) is available through account entitlement and separate device sessions, not through synchronization of user-provided credentials. Its availability does not change a device's selected access.

New devices using the official service sign in and then obtain authorization and key material through an existing device or a user-held recovery key. Account login alone must not give the operator the ability to decrypt content. One recovery key per Situate account recovers all of that account's officially synchronized workspaces. It does not recover device-local AI configuration or credentials, replace provider authorization or establish a provider session on a new device. Workspaces retain independent configuration and runtime access boundaries. Key hierarchy, formats and provisioning protocols remain design decisions; QR-assisted device authorization is a candidate interaction, not a chosen protocol.

Recovery setup is mandatory before official synchronization onboarding completes: users must save and confirm the recovery material. Situate offers PDF export, explains loss consequences and recommends a printed copy stored safely apart from synchronized data. An authorized device can reveal or export the recovery material again after explicit user action and additional OS authentication where available. No extra application lock, separate password or routine biometric prompt is required by default for ordinary use. OS storage access restrictions still apply. If no usable local copy or authorized device remains and the recovery key is lost, Situate cannot recover the encrypted server content. Neither plaintext recovery material nor usable decryption keys may become accessible to the service or operator.

Before first activating official synchronization, users must save or print the recovery key and confirm that it is secured. Local use remains available without this step. Recovery through a prepared recovery key or an authorized device does not grant the operator access to decryption secrets; support must never receive passwords or recovery keys.

If no usable key access remains, users may explicitly choose a local plaintext workspace as the starting point for a new encrypted synchronization state. This is a synchronization restart, not recovery of the old encrypted server content. The choice must explain that remote-only changes cannot be recovered without the old keys. Other devices retain their local data and must reconcile with the new state rather than silently overwrite it with an old one. Without key access or a usable local copy, Situate cannot recover the content. Thirty-day retention and separate recovery of the old encrypted synchronization state after such a restart are deferred together; no such recovery window is promised.

Non-conflicting edits are merged automatically, except genuinely divergent plugin source revisions under the same declared version: [plugin change handling](REQ-0033-stage-and-activate-plugin-changes.md#data-formats-and-synchronized-changes) requires explicit user selection and retains the unselected revision in history, even when a textual merge would be clean. Ordinary Git merge conflicts require the user to choose either version or discuss a combined result with the agent in chat and decide before it is applied. Manual resolution must work without AI. Conflicting binary versions allow choosing either version or preserving both as separate files, with user confirmation; universal binary auto-merging is not required. An unresolved merge conflict pauses synchronization for the whole affected workspace, not just conflicting files. Other local edits remain possible and other workspaces remain unaffected. Resolving the conflicts resumes synchronization.

Synchronization performs no additional semantic conflict checking. A rare accidental UUID-generation collision may be reported as an error without special recovery. This is distinct from the user-directed, versioned repair of externally copied IDs when an ambiguous reference is used under [REQ-0035](REQ-0035-preserve-file-and-task-identity.md).

Completed conversational turns can be continued on another device as described in [work-state preservation](REQ-0011-work-on-topics-in-parallel.md). Current content and full history initially replicate to every connected device under [local availability](REQ-0008-local-content-availability.md).

## Rationale

Users should be able to use their tasks, notes, documents, extensions and conversations on multiple devices without manually transferring or separately maintaining this content.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: a synchronization service for all notes, plugins and chats; its role as a future paid offering; explicit confirmation as a must-have requirement.

Private product-scope clarification conversation; date not recorded, transcript not included. Task and document management were confirmed as core capabilities whose content must be available across the user's devices through synchronization. Jointly managed content within Situate was excluded.

Private architecture-constraints clarification conversation; date not recorded, transcript not included. End-to-end encryption and the operator's inability to decrypt synchronized user content were confirmed as mandatory, separately from authorized AI processing.

Private architecture strategy clarification, 2026-09-29; transcript not included. Replaceable synchronization transport, core-owned merging, official-service encryption and recovery and full initial replication were confirmed.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Independent per-workspace synchronization choice, open-workspace-only operation and the distinction between personal built-in scope and custom extensibility were confirmed.

Private synchronization clarification, 2026-09-30; not publicly available.

Private mobile lifecycle and startup clarification; date not recorded, not publicly available. Switching active workspaces leaves configured synchronization eligible to run under operating-system limits; automatic reopening follows existing synchronization rules.

Private document-management prioritization conversation; date not recorded, transcript not included. Managed document storage and on-demand file synchronization were deferred separately from workspace synchronization.

Private provider-access and credential-recovery clarification; date not recorded, not publicly available. Account-level recovery setup, saved-material confirmation, PDF export and later protected retrieval were confirmed for official synchronization. No default additional application lock was selected.

Private multi-device AI configuration clarification; date not recorded, not publicly available. AI configuration, credentials and future model selections remain device-local for every synchronization mode; conversation content remains synchronized without per-message provider/model attribution. Managed AI entitlement is separate from device-local access selection.

## Acceptance criteria

- Two workspaces can use different synchronization choices, including no synchronization, without changing each other's settings.
- A workspace with no synchronization remains usable locally and can close without a synchronization prerequisite.
- With connectivity and configured synchronization, an open workspace synchronizes changes automatically without a save, commit or manual synchronization action.
- Opening a workspace makes existing local content immediately usable while background synchronization runs; visible state indicates when remote changes may be pending.
- Closing the last window with unsynchronized changes warns the user and offers synchronization before closure or immediate closure preserving local changes for reopening.
- Synchronization before closure keeps the workspace open until success; offline, conflict and failure states are not reported as completion.
- Closing a workspace's last window stops its synchronization; another open workspace's configured synchronization continues, and reopening the closed workspace resumes its configured synchronization.

- Tasks and documents stored on one connected device become available on another after successful synchronization; changes are also synchronized.
- Notes saved on one connected device become available on another after successful synchronization; changes are also synchronized.
- Plugins are synchronized between connected devices. Their stated platform restrictions remain visible on the destination device.
- Saved chat histories, including new messages, become available on other connected devices after successful synchronization.
- Synchronization works between different supported operating systems, not only between devices on the same platform.
- Content already available locally remains readable and manually editable when the synchronization service is unavailable.
- For the official service, connected devices can decrypt synchronized content, while inspection of service storage, traffic handling and operator-accessible key material demonstrates that the service and its operator cannot decrypt that content.
- Custom plugins can transport a complete workspace directory, including `.git` and internal files, or use Git-server-based transfer; versioning, conflicts and file/history recovery remain core responsibilities.
- Users are informed that uncontrolled directory or Git-internal modifications can corrupt history; directory transfer is not presented as inherently consistent.
- Non-conflicting offline edits are merged automatically without additional semantic conflict checking; genuinely divergent same-version plugin revisions follow the explicit user-selection rule in REQ-0033.
- For a Git merge conflict, users can choose either version without AI or discuss a combined result in chat; no proposed resolution is applied before their decision.
- For conflicting binary versions, users can confirm either version or preservation of both as separate files.
- An unresolved merge conflict pauses all synchronization of the affected workspace while permitting other local edits and leaving other workspaces unaffected; resolving its conflicts resumes synchronization.
- For every synchronization mode, provider credentials remain in device-local OS secure storage scoped to workspace and device. Neither synchronization payloads nor the portable directory and its histories contain operational AI configuration or provider credentials.
- Connecting, modifying or removing AI access on one device produces no synchronization change to another device's connections, addresses, selected access, defaults or conversation overrides.
- A newly synchronized workspace without local AI access offers device setup while content remains usable; it is not reported as a failed connection or synchronization error. No shareable provider key is transferred as an exception.
- Local-only use and custom synchronization do not require official-service recovery setup or a portable credential vault.
- Conversation synchronization preserves content without transferring per-message provider/model attribution or next-request selections. A receiving device keeps its independently selected provider and model.
- Account recovery restores synchronized workspace content without provisioning device-local provider credentials or AI settings.
- A new device can be provisioned through an existing authorized device or the recovery key; account login alone does not unlock encrypted content.
- One account recovery key permits recovery of all officially synchronized workspaces belonging to that account without merging workspace configuration or runtime authorization boundaries.
- Official synchronization onboarding cannot complete until the user has saved and confirmed recovery material. PDF export is available, and the flow explains loss consequences and recommends a separately stored printed copy.
- An authorized device can reveal/export recovery material again only after explicit action and additional OS authentication where available. Cancelled or failed OS authentication does not reveal or export it.
- Ordinary use does not require an extra Situate password, app lock or routine biometric prompt. The app handles OS secure-store denial without persisting plaintext secrets.
- Without usable local data, an authorized device or the recovery key, the service cannot recover encrypted content; account-password reset is not presented as content recovery.
- A confirmed synchronization restart can use a selected local workspace when old key access is unavailable. Remote-only data loss is explained, local data on other devices is retained, and their old synchronization state cannot silently overwrite the new one.
- A password reset or support interaction does not bypass end-to-end encryption or expose recovery secrets to the operator.
- Authorized plaintext processing through the AI router does not expose content or decryption keys to the synchronization service.

## Open questions

- How are deletions and conflicting structural changes represented within Git merge-conflict resolution? The merge algorithm and whether conflicts appear in working files remain undecided.
- How are plugin dependencies represented and handled across synchronized changes?
- How is an additional binary copy's filename chosen, given the initial path-reference model without stable non-Markdown IDs in [REQ-0035](REQ-0035-preserve-file-and-task-identity.md)?
- What synchronization batching cadence and performance limits are appropriate?
- How are synchronization state and close decisions presented, including notification prominence and dialog placement?
- How are access rights and external sources reachable only from one device represented on other devices?
- What requirements apply to freshness, transfer time and device authorization?
- Which protocols create and provision keys, authorize or revoke devices, and rotate keys without exposing them to the operator?
- How does account-level recovery protect separate workspace content keys, including key rotation and historical backups?
- How is saved recovery material confirmed, and what protected reveal/export interaction is appropriate on platforms without OS reauthentication?
- How is a consistent synchronization representation produced for active conversation metadata and history?
- Which synchronization metadata is necessary, and what protection and retention rules apply to it?
