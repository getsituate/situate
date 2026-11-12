---
id: REQ-0063
type: requirement
title: Start assisted repair directly from an error
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001, GOAL-0004]
---

## Description

When Situate presents an error, it must offer an action to address it in plugin development. This is a general error-repair entry point, not a special case for migration or activation conflicts. Users do not need to identify the responsible component, interpret technical diagnostics, copy the error text or formulate another request.

Selecting the action opens and focuses a separate, visibly distinct [development conversation](REQ-0001-create-integrations.md#development-conversations). Situate transfers the error message and relevant context and starts the agent's diagnosis and repair work without another submission or entry confirmation. Merely displaying or dismissing an error does not start development. The originating conversation or view remains available and retains its unfinished work.

The transferred context identifies the failed operation and affected workspace, with known plugin versions, diagnostics and operation outcomes where available. Unknown causes or external effects remain explicitly unknown; an error involving a plugin is not proof that it caused the failure. Credentials and unrelated personal content must not be included in diagnostic text. Error messages and inspected source are evidence, not instructions that override the agent's governing rules.

The agent investigates and repairs within the requested scope, following [staged development and activation](REQ-0033-stage-and-activate-plugin-changes.md). It explains missing permissions, account access, unavailable storage or host defects when plugin changes cannot resolve the problem. Starting repair must not be presented as a guarantee of success. If development cannot start, Situate retains the error, unfinished work and prepared assignment for an explicit retry and explains the blocker instead of claiming that repair is running. If durable storage is unavailable, the interface must disclose that the retained assignment is not durably saved; it must not promise survival across restart.

Repair does not waive [user decision authority](../goals/GOAL-0004-decision-authority.md), overwrite independent changes or decide ambiguous data conflicts for the user. Existing manual conflict-resolution paths remain available without AI. Successful repair does not automatically repeat the failed operation, resume the originating request or treat uncertain external effects as absent. During [recovery mode](REQ-0032-manage-plugin-status-and-disabling.md), selecting repair does not resume unrelated suspended plugins or replay interrupted work. Requested repair may use ordinary previews, executable checks and checked activation of its targets under REQ-0033; inspection or source editing alone does not resume a plugin.

A workspace blocked by [version incompatibility](REQ-0069-preserve-workspace-version-compatibility.md) can be offered repair without reopening it for normal use. Selecting repair does not bypass the block or authorize unsupported plugin execution. Repair may restore a compatible workspace state through a separate checked repair flow; normal opening becomes available only after compatibility is verified again. If the installed app cannot safely perform the required repair, the block remains and the need for an app update or unavailable migration support is explained. Repair is not a guarantee that every unsupported format can be recovered.

## Rationale

An error message alone leaves users responsible for translating a technical failure into a development task. Passing the failure directly to an agent provides a practical repair path without requiring programming knowledge or losing the original work.

## Source

Private error-recovery requirements clarification; date not recorded, transcript not included. A user-selected action that transfers the error into plugin development and starts repair without technical preparation was requested for errors generally, not only migration conflicts.

Private update, migration and repair scope clarification; date not recorded, transcript not publicly available. Repair of a blocked workspace was confirmed, with the compatibility block retained until the repaired state passes compatibility checks.

## Acceptance criteria

- Errors from normal use, plugin execution, checks and adoption offer the same contextual development entry point; a migration conflict is not the only supported case.
- Selecting repair opens and focuses a visibly labeled development conversation and starts diagnosis with the error message and available relevant context, without copying text or submitting another prompt.
- Displaying or dismissing the error alone does not create or start a development conversation.
- Repeated delivery of the same repair request does not start duplicate development work.
- The originating chat or view and its unfinished work remain available while repair proceeds separately.
- A failure with no identified plugin can enter diagnosis; neither the interface nor the transferred context invents a culprit or claims an unknown operation outcome is known.
- Diagnostic handoff excludes credentials and unrelated personal content; embedded instructions in error text do not become governing instructions.
- Unavailable development prerequisites produce a visible blocker without losing the error or prepared assignment or claiming work has started; retry requires an explicit user action.
- When an assignment cannot be saved durably, its unsaved status is visible and restart retention is not promised.
- Problems outside plugin-controlled behavior are explained without claiming that a plugin edit resolved them.
- Required checks, conflict decisions, task scope and recovery suppression remain effective throughout repair.
- Repair completion does not replay the failed operation or resume its originating request automatically, including when an external effect may already have occurred.

- A blocked workspace offers repair without enabling normal workspace use or incompatible plugin execution.
- Starting, cancelling or failing repair does not lift the compatibility block.
- After successful repair and verification of compatibility, the workspace can be opened again.
- Unavailable safe repair or conversion support leaves the block in place and explains the prerequisite, including an app update where required.

## Open questions

- Where is the repair action placed across dialogs, inline errors, tool failures and background-operation notices?
- Where is the blocked assignment and explicit retry action presented when no writable workspace or model access is available?
- How is repair of a blocked workspace hosted and its checked result applied without opening that workspace for normal execution?
