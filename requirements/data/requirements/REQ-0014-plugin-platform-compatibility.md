---
id: REQ-0014
type: requirement
title: Develop cross-platform plugins or explicitly restrict their platforms
status: approved
priority: must
area: Integrations
goals: [GOAL-0001]
acceptanceCriteria:
  - id: AC-01
    text: "Users can tell whether a plugin is usable on all Situate platforms or only on an explicitly named subset."
    status: open
  - id: AC-02
    text: "A plugin designated as cross-platform can perform its intended functions on supported desktop and mobile platforms."
    status: open
  - id: AC-03
    text: "For a deliberately restricted plugin, the platform limitation and its reason are apparent."
    status: open
  - id: AC-04
    text: "After synchronization to an unsupported platform, a plugin is not presented as fully usable there."
    status: open
  - id: AC-05
    text: "A plugin with mixed platform support can expose supported functions and views while identifying unavailable ones and their reasons."
    status: open
  - id: AC-06
    text: "Workspace-wide development and reusable connections are implemented and qualified on macOS; synchronized source or portable JavaScript alone is not presented as iOS support."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-07
    text: "A consumer's effective availability reflects required connection functions: a portable view is not presented as usable when its required connection function is unavailable."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-08
    text: "Availability distinguishes unsupported platform, missing implementation, missing permission or account access, and a failed operation; installed or checked connection code alone is not reported as usable access."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-09
    text: "Consumers use declared connection functions rather than depending on native implementation details; platform limitations and their reasons remain visible."
    milestone: Workspace-wide development with reusable connections
    status: implemented
---

## Description

The first plugin-development milestone, [Plugin Launchpad](REQ-0033-stage-and-activate-plugin-changes.md#first-iteration-plugin-launchpad), delivers and qualifies development and plugin use on macOS only. Other desktop and mobile platforms are deferred for this milestone. The cross-platform target below remains approved for later delivery; macOS-only qualification must not be presented as cross-platform support.

Plugins developed for Situate must either be usable on all supported platforms or be explicitly restricted to specific platforms. A restriction is necessary, for example, when a plugin uses system functions unavailable on other platforms.

Cross-platform consistency is the default; restrictions must reflect unavailable platform capabilities rather than an intentionally reduced mobile feature set. Plugins declare availability at the function and view level, so a plugin may expose only the parts supported on a particular device.

Supported platforms and deliberate restrictions must be apparent. Creating and synchronizing a plugin must not suggest cross-platform usability that does not actually exist.

Workspace-wide development with reusable connections also targets macOS qualification only. Later function- and view-level portability remains approved, with effective availability constrained by required dependencies. The native access route and permissions for each concrete connection require verification; no Apple API, iOS equivalent or distribution eligibility is assumed.

## Rationale

Individually created tools should fit Situate's cross-device use. Where technical system boundaries prevent this, users need clear limitations rather than an unexpectedly nonfunctional plugin.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: explicitly cross-platform plugin development or deliberate restrictions due to platform-specific system functions; confirmation as a must-have requirement.

Private architecture strategy clarification, 2026-09-29; transcript not included. Maximum practical cross-platform consistency and explicit function- and view-level availability were confirmed.

Private workspace-development platform clarification; date not recorded, not publicly available. macOS-only connection qualification, dependency-derived availability and distinct implementation/access/platform failures were selected; native APIs and iOS qualification remain unresolved.

## Open questions

- How is stated platform compatibility checked before use?
- How are partially available functions and views labeled without suggesting full plugin compatibility?
- How are plugin installation, activation and execution handled on unsupported platforms?
