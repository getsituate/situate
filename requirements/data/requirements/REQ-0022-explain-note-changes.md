---
id: REQ-0022
type: requirement
title: Keep content changes traceable and recoverable
status: approved
priority: must
area: Control and trust
goals: [GOAL-0004]
---

## Description

Users must be able to inspect what Situate changed in their notes and why, whenever they want to review those changes. This includes changes to note content and changes to note structure. Changes made by Situate must be identifiable as such. During chat, supplied write and edit tools show note and working-instruction changes directly under the [content-sensitive presentation rules](REQ-0040-reveal-tool-details-and-content-changes.md). Plugin-defined tools choose their own main-chat or activity-only presentation. That choice does not remove the traceability and recovery obligations below.

Situate must maintain a version history of notes within the system so previous content and structure can be restored. Deleting a note removes it from the current collection without deleting its history or preventing restoration. Situate may perform these deletions without prior approval of each deletion, just as it may change notes. Excluding selected content from history recording is not required. [Explicit history deletion](REQ-0007-history-storage-control.md) is a separate could-have capability; if implemented, it would deliberately remove the corresponding recovery information.

Users must be able to open a file's version history from its file view, inspect earlier versions and compare their differences without using Git commands or the assistant. The history includes metadata changes. A Markdown file's history remains reachable after a Situate-managed move or rename of the same file. History inspection does not change current content. The initial history is a commit list following the default `git log` behavior, without additional editing-session grouping. Users do not need to run Git commands.

Other applications may edit the ordinary content files managed by Situate. Situate records detected external changes as separate history entries, including changes first observed when reopening a workspace. These entries remain distinguishable from Situate's own edits. Situate exclusively manages its internal Git history; direct modification of that history by external Git clients is not a supported editing interface. No general-purpose import of external Git repositories is required.

The initial file-history actions distinguish reversing an individual change, creating a new file from a historical version, and restoring a deleted file. Reversal records a compensating change and preserves independent later edits, with conflicts requiring a decision. Creating a file from an earlier version leaves the current original unchanged and creates a separate file lineage and new task identities under [REQ-0035](REQ-0035-preserve-file-and-task-identity.md). Restoring a deleted file retains access to its historical versions and restores task identities, but creates a new file lineage without reviving old live references. It uses its previous location where possible; an occupied destination requires a user decision rather than overwriting another file. Deleted files must remain discoverable through a recovery entry point even though they are absent from the current collection. A separate action that replaces a current file wholesale with an old snapshot is not part of the initial file-editor delivery.

Traceability and recoverability must not require users to approve each change beforehand. It complements [autonomous note maintenance](REQ-0006-preserve-personal-note-structure.md) and [process history](REQ-0005-record-process-history.md).

The same versioning and recovery behavior applies to all stored content, including tasks, documents, attachments, plugin code, plugin-owned data and configuration. The core provides versioned data storage as the standard path for plugin-owned data. Organizational content and plugin configuration and data share one Git history per workspace; plugin code retains separate per-plugin repositories under the [workspace storage constraints](../foundations.md#workspace-storage-and-history). The embedded implementation and exact storage paths remain undecided. Initially history has no product-imposed retention limit; automatic pruning, storage budgets and remote storage of older file versions remain deferred options.

[Device-local diagnostic logs](REQ-0066-bound-local-diagnostic-storage.md) are not stored content covered by this versioning requirement. They remain outside workspace history and have a separate bounded retention policy; rotating them must not prune content or process history.

The first plugin-development iteration used drafts under [Plugin Launchpad](REQ-0033-stage-and-activate-plugin-changes.md#first-iteration-plugin-launchpad). Workspace-wide development now uses ordinary workspace access under [REQ-0033](REQ-0033-stage-and-activate-plugin-changes.md). Internal check completion, release and resource disposal clean only disposable candidate/check state, never durable workspace edits, activated code or their recovery histories. The MVP provides no development-storage display or manual cleanup capability. Removed trial-only content may leave attributable but unavailable references; these never resolve against live files or later trials. The conversation survives. Reversing durable edits remains a separate explicit recovery operation, not cleanup.

Users can undo individual changes or return to an earlier point in a branching conversation. They choose whether to move only the conversation position or also undo the associated content changes. Content rollback records new compensating changes rather than erasing history. It affects only the selected conversation path's changes; later or independent changes, including external-editor changes, must remain intact. Non-conflicting reversals proceed automatically. Conflicts require the user's decision; Situate may propose a resolution.

Plugins must use the core's versioned write interfaces for Situate-owned content. For external systems, tools declare read/write behavior and either supply an idempotent revert operation or explicitly declare that reversal is unsupported. Revert operations must check relevant preconditions to avoid overwriting intervening changes. Explicit rollback retains its preview and content-protection confirmation of what can be reversed and what will remain. Unsupported or failed reversals remain visible. Ordinary external actions do not require per-action approval.

The core does not define a universal plugin migration or reverse-migration framework. When reverting plugin changes, the local Situate agent may independently reconcile code, configuration and data using their histories. Returning to an older schema must not discard data created later. Independent changes remain protected; ambiguous conflicts still require the user to decide.

### Interrupted file operations

Restarting after an interrupted file operation does not automatically continue, repeat or roll back that operation. Existing working files and the durably retained pre-operation history remain available for inspection and explicit recovery where their storage is usable. An interrupted or failed attempt may already have changed some files. Without verified completion evidence, it must not be presented as fully completed; a failure or missing acknowledgement does not prove that no effects occurred. A verified durable result may establish completion even when the caller did not receive its acknowledgement.

A later user-directed retry checks the current source, destination and intervening changes rather than executing a stale plan or overwriting an occupied destination. References whose continuity cannot be established remain unresolved instead of targeting another file. Newly observed changes may be retained in history without assigning an unverified origin; a missing completion record alone does not establish that an external editor made them.

This boundary does not remove ordinary draft restoration, explicit history reversal or the requirement to durably retain prior content before destructive operations. It does not promise recovery from physical storage damage.

### Damaged repository recovery

Versioning and file/history recovery remain core responsibilities regardless of synchronization transport. History preservation protects against ordinary content changes and deletion, not physical damage or repository corruption. An unusable repository is distinct from an ordinary merge conflict in a valid repository.

When repository corruption makes history unusable, the core must report that state and possible causes, including uncontrolled synchronization or modification of internal files, without asserting an unverified cause. Reinitialization requires explicit user confirmation that prior history will be unavailable in the new repository. Before reinitializing, Situate must preserve a backup of the damaged repository rather than overwrite or delete it. If that backup cannot be preserved, reinitialization must not proceed. Existing content files remain intact and form the new history baseline. Retaining the damaged copy does not guarantee recovery of prior history. Reinitializing locally does not itself imply synchronization or deletion of histories on other devices or remote storage; the recovery procedure and protocol boundaries remain open.

## Rationale

Users should retain control over their notes through visibility of changes and their reasons, together with the ability to restore previous versions, without interrupting delegated work with repeated approval requests. Preserving deleted notes in history makes autonomous deletion reversible.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. On-demand visibility of what Situate changed in notes and why was explicitly confirmed as a must-have requirement. Prior approval of individual changes was explicitly not desired. Subsequent clarification described a Git-like version history for restoring note content and structure, including after autonomous deletion; Git itself was not mandated. Exclusions from history recording were rejected, while explicit history deletion was classified as could-have.

Private architecture strategy clarification, 2026-09-29; transcript not included. Recovery was extended to all stored content, individual and conversation-path rollback, preservation of independent changes, user-resolved conflicts and plugin-provided external reversal. Git-like compensating changes were chosen as behavior, not as a mandated technology.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. One Git history per workspace for organizational content and plugin configuration and data, with separate per-plugin code repositories, was confirmed. Task completion and identity repair retain core history.

Private synchronization clarification, 2026-09-30; not publicly available.

Private file-editor clarification conversation; date not recorded, transcript not included. File-level history, earlier-version inspection and comparison were confirmed as must-have capabilities; restoration controls were left open.

Private file-editor specification clarification, 2026-10-04; transcript not included. Default Git-log history presentation and separate actions for reversing a change, creating a new file from an earlier version and restoring a deleted file were confirmed.

Private chat-design clarification conversation; date not recorded, transcript not included. Default chat visibility was distinguished from enduring traceability and recovery: plugin tool authors freely choose presentation, while supplied note and working-instruction writes and edits are directly visible.

Private client-logging requirements clarification; date not recorded, transcript not publicly available. Diagnostic logs were explicitly excluded from workspace version history and assigned separate bounded retention.

Private file-history ownership and interrupted-operation clarification, 2026-10-11; not publicly available. Automatic completion or rollback after restart is not required; partial effects, retained history and uncertain references remain visible.

Private file-reference decision, 2026-11-03; not publicly available. Restored files retain historical access and task IDs without reactivating deleted live file references.

## Acceptance criteria

- After Situate changes note content, the user can identify the affected note and what changed.
- After Situate changes the note structure, the user can identify what changed in that structure.
- For a change made by Situate, the user can inspect the reason for that change and identify Situate as its author.
- Users can review changes and their reasons later, not only at the moment of modification.
- Users can open a file's history from its file view and inspect earlier versions without Git commands or AI.
- Users can compare Markdown versions and see content and metadata differences without modifying the current file.
- A Markdown file's history remains accessible after Situate renames or moves that same file.
- Users can restore earlier note content and structure from version history.
- A deleted note is absent from the current collection but remains discoverable and recoverable through a history/recovery entry point.
- The initial history lists commits using the default Git-log behavior rather than grouping them into editing sessions.
- Creating a file from a historical version leaves the current original unchanged, creates a separate file lineage and gives copied tasks new IDs.
- Restoring a deleted file preserves historical access and task IDs, uses its previous location where possible, and asks the user when that destination is occupied instead of replacing another file. Old live file references remain deleted; a new explicit selection can reference the restoration.
- Detected external content-file changes receive their own history entries, including changes first observed after reopening; they are not presented as Situate-authored edits.
- External applications can edit ordinary content files without using Git or modifying Situate's internal repositories.
- Later note changes and ordinary deletions do not remove earlier versions from history.
- Recording and viewing these changes does not require prior approval of each modification or ordinary note deletion.
- Restart does not automatically replay, complete or roll back an interrupted file operation; current files and the retained prior history remain available where their storage is usable.
- A partial or interrupted attempt is not presented as complete without verified completion evidence, and failure is not treated as proof that no files changed.
- A verified durable result can establish completion after a lost acknowledgement without repeating the file operation.
- An explicit retry rechecks current state and preserves intervening changes and occupied destinations.
- Changes first observed after an interruption are not assigned a confirmed Situate or external-editor origin without supporting evidence.

- Tasks, documents, attachments, plugin code, plugin-owned data and configuration have recoverable versions as well as notes.
- A plugin can use the core's versioned storage for its own data; organizational content and plugin configuration and data share the workspace history while each plugin's code has its own repository.
- Task completion changes, identity repairs and automatic file-ID additions are versioned and recoverable.
- A requested plugin rollback may be performed autonomously, including reverse migration, while retaining later independent data and exposing unresolved conflicts.
- Users can undo an individual change or a selected conversation path's changes, or return to an earlier conversation point without changing stored content.
- Content rollback adds traceable compensating changes and preserves later and independent edits; conflicting reversals require a user decision.
- Plugins modify Situate-owned content through versioned core interfaces.
- External rollback requires a preview and confirmation; unavailable, conflicting and failed reversals are reported rather than presented as successful.
- Repeating a plugin revert operation does not repeat its external effect; intervening external edits are not silently overwritten.
- No automatic age- or size-based history pruning occurs in the initial scope.
- For every synchronization transport, the core reports unusable repository history separately from valid-repository merge conflicts, identifies possible causes and does not present an unverified cause as established.
- Reinitialization does not proceed without explicit confirmation of prior-history loss in the new repository and a preserved backup of the damaged repository.
- Reinitialization neither overwrites nor deletes the damaged backup; existing content files are preserved as the new history baseline.
- The user is told that prior history is unavailable in the new repository and that the damaged backup does not guarantee recovery.
- Local reinitialization is not presented as automatically synchronizing or deleting remote or other-device histories.

## Open questions

- Which labels, previews and navigation make the three initial recovery actions and their effects clear?
- How should version inspection and differences be presented for non-text file formats that initially open in external applications?
- What commit boundaries should be used for continuous manual editing without adding session grouping to the history view?
- If explicit history deletion is implemented, how should its effects on traceability and recovery be explained before deletion?
- How are binary choices and dependent changes across multiple files presented? [Synchronization conflicts](REQ-0013-synchronization-service.md) allow choosing either binary version or keeping both.
- What exact recovery procedure, backup location and protocol boundaries govern damaged repositories and subsequent synchronization?
- What retention policy and large-file storage model should eventually bound history growth?
