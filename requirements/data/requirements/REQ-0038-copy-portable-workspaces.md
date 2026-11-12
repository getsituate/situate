---
id: REQ-0038
type: requirement
title: Transfer and back up a complete workspace as one directory
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001, GOAL-0004]
---

## Description

A workspace must be one portable directory containing its organizational content, chats, internal state, plugins and all histories. Users must not need a special export to transfer that complete directory. Copying a closed workspace can produce a consistent backup. A safe snapshot mechanism for a live workspace remains undecided; an arbitrary live copy is not promised to be consistent.

The portable metadata includes the identifier assigned at [workspace creation](REQ-0045-create-local-workspaces.md). Complete copies and restorations preserve it, including on another device, so [diagnostic correlation](REQ-0064-record-client-diagnostic-events.md) recognizes them as copies of the same workspace. A deliberately independent workspace needs a new identifier; copying a directory alone does not imply that decision. Diagnostic log files and device/session identifiers are not portable workspace state.

Operational AI configuration and credentials are an explicit exception to directory completeness for every synchronization mode. Provider connections, endpoint addresses, selected access, default models and conversation-specific model selections are stored outside the portable directory and its histories, scoped to workspace and device under [REQ-0015](REQ-0015-connect-user-provided-models.md). Provider secrets remain in device-local OS secure storage. Copying or restoring a workspace does not transfer these records or overwrite a destination's existing local AI configuration. A new device offers local setup when AI is needed, without treating its absence as a damaged workspace; manual use remains available.

Chats retain their content without per-message provider/model attribution. Copied conversations do not configure future requests or grant provider access on the destination. [Official synchronization and recovery](REQ-0013-synchronization-service.md) likewise do not provision user-provided AI settings or credentials. [Managed AI entitlement](REQ-0016-managed-ai-access.md) is account-based rather than part of the copied directory. Portability does not guarantee that a plugin or external connection works on a destination without its platform capabilities or authorization.

Users may develop [synchronization plugins](REQ-0013-synchronization-service.md) that transfer the complete directory, including `.git` and internal files. This permission is not a consistency guarantee: uncontrolled transfer or modification of repository internals can corrupt history. The core retains responsibility for [file and history recovery](REQ-0022-explain-note-changes.md); a transport plugin does not take over those duties.

The [workspace storage constraints](../foundations.md#workspace-storage-and-history) place all workspace-local Situate metadata and operational state under `.situate/`. Files outside it are user-owned content, not implicit configuration. File and task identity markers are the only Situate-owned metadata embedded in those files; task properties and existing user metadata remain user content. Device-local AI configuration, credentials and logs retain their separate storage boundaries.

## Rationale

A complete local backup or transfer should not depend on a proprietary export operation or omit workspace content, histories and portable personal setup. Device-local AI choices remain separate so restoring content does not replace the destination's access or assume that a source-device server is reachable.

## Source

Private content and workspace architecture clarification, 2026-09-29; not publicly available.

Private synchronization clarification, 2026-09-30; not publicly available.

Private diagnostic workspace-identity clarification; date not recorded, transcript not publicly available. Full copies and restorations retain workspace identity; deliberately independent workspaces use a new identity.

Private provider-access and credential-recovery clarification; date not recorded, not publicly available. Device-local provider secrets were explicitly excluded from directory portability.

Private multi-device AI configuration clarification; date not recorded, not publicly available. Provider configuration and future model choices also remain device-local for every transport; conversation content remains portable.

## Acceptance criteria

- The workspace directory contains its content, chats, internal state, plugins and all associated histories.
- All workspace-local Situate metadata and operational state are stored under `.situate/`; user files outside it are not automatically interpreted as configuration, working rules or skills.
- Onboarding saves confirmed working rules at `.situate/working-method.md` without creating or modifying external instruction files.
- Temporary import scripts, mappings and manifests stay under `.situate/`, outside the user-content history. File and task identity markers remain the only Situate-owned metadata embedded in user content.
- Copying the directory after the workspace is closed produces a consistent backup without a special export operation.
- On a compatible destination, a copied closed workspace retains its content, portable personal setup and histories, including conversation content, without per-message provider/model attribution.
- Neither the copied directory nor its histories contain operational AI connection configuration, credentials, selected access, default models or conversation overrides. This exclusion is the same for local, official-sync and custom-sync workspaces.
- Copying or restoring content leaves any destination-device AI configuration unchanged. On a fresh device, local content remains usable and AI setup is offered when needed; no source-device server address or provider selection is imported.
- Copying or restoring the complete workspace preserves its identifier; the destination uses its own device/session identities and does not receive diagnostic log files as workspace state.
- An arbitrary copy of a live workspace is not presented as a guaranteed consistent snapshot.
- Whole-directory synchronization is permitted without being presented as inherently consistent; the risk of repository corruption from uncontrolled transfer or internal-file modification is visible.

## Open questions

- What safe mechanism should provide consistent snapshots while a workspace is open?
- Which platform-specific file access and credential constraints affect directory transfer?
