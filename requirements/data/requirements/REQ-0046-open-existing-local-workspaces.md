---
id: REQ-0046
type: requirement
title: Open an existing local Situate workspace
status: approved
priority: must
area: Control and trust
goals: [GOAL-0001]
---

## Description

Users must be able to select an existing local Situate workspace directory through the [workspace entry window](REQ-0044-select-and-remember-workspaces.md). Situate checks whether the selected directory can be opened as a workspace. Successful opening remembers its location for later selection and follows the existing [workspace lifecycle](REQ-0037-keep-workspaces-independent.md), including recovery-mode restrictions.

Opening is limited to existing Situate workspaces. Selecting an ordinary directory must not silently initialize a workspace, convert its contents or start an import. Bringing ordinary content into a workspace is a separate [import workflow](REQ-0036-convert-imported-notes-and-tasks.md).

When a selected or remembered workspace cannot be opened, Situate explains the failure rather than treating it as a new workspace or silently creating an empty replacement.

## Rationale

Users may already have a workspace after reinstalling Situate or transferring a portable workspace directory. They need to resume using that system without accidentally replacing it or converting unrelated folders.

## Source

Private workspace-entry and creation clarification conversation; date not recorded, not publicly available. Local opening was explicitly limited to existing Situate workspaces, separate from importing ordinary folders. Remembered locations and opening validation were accepted. Priority was confirmed as must-have.

## Acceptance criteria

- Users can select an existing local Situate workspace directory without first creating a new workspace.
- A supported, accessible workspace opens and its location becomes available in the known-workspace list.
- Selecting an ordinary folder does not initialize a workspace, convert content or import files; Situate explains that the folder cannot be opened as a Situate workspace.
- A workspace that cannot be opened produces an explanation, not a success state or an empty replacement workspace.
- Opening an additional workspace preserves the independence and lifecycle rules in REQ-0037, including plugin suppression when the application is in recovery mode.
- Selecting an already open workspace follows the foregrounding behavior in REQ-0044.

## Open questions

- How are moved, unavailable or inaccessible workspace locations presented, and which retry or location-repair actions are offered?
- What identifies a supported workspace, and how are incompatible workspace versions distinguished from damaged workspaces?
- How does directory selection work under each supported platform's file-access restrictions?
