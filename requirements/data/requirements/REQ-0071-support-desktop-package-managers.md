---
id: REQ-0071
type: requirement
title: Support suitable desktop package managers
status: approved
priority: should
area: Platforms and synchronization
goals: [GOAL-0001]
---

## Description

Situate should support installation and updates through suitable desktop package managers alongside [direct desktop distribution](REQ-0012-platform-availability.md). Linux package managers and Homebrew on macOS are intended candidates; the specific supported channels, package formats and ownership model remain open.

For a supported channel, users should be able to install Situate and obtain subsequent releases using that channel's normal installation and update workflow. Package-managed installations retain that channel as their update authority under [REQ-0068](REQ-0068-update-direct-desktop-installations.md). Availability of a release in one channel does not promise simultaneous availability in every other channel.

## Rationale

Users who manage desktop software through a package manager should not need a separate manual installation and update workflow for Situate.

## Source

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. Package-manager support was selected as should-have; specific channels remain open.

## Acceptance criteria

- Each supported package-manager channel is identified.
- Users can install Situate through each supported channel's normal workflow.
- A subsequent release can be installed through the same channel's update workflow without reinstalling from the website.
- The app's direct-install updater does not overwrite the package-managed installation.

## Open questions

- Which Linux distributions, package formats and package managers are supported?
- Will macOS distribution include Homebrew, and which Windows package managers are useful?
- Who maintains each package, and what publication and update expectations apply?
