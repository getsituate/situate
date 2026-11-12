---
id: REQ-0070
type: requirement
title: Preserve plugin interfaces and expose minimum app versions
status: approved
priority: must
area: Platforms and synchronization
goals: [GOAL-0001]
---

## Description

Situate's plugin interfaces must follow the same minimum six-month compatibility window from app-version publication as [workspace version compatibility](REQ-0069-preserve-workspace-version-compatibility.md). Existing plugins using those supported interfaces must continue to work after an app update without requiring user-funded redevelopment merely because the app changed. This covers public SDK and shared component contracts, including props, events and slots under [REQ-0026](REQ-0026-provide-plugin-defined-views.md).

The long-term design objective is never to break public plugin interfaces. Six months is the internal minimum, not a scheduled removal policy or a limit measured from a plugin's creation date. This objective does not promise support for every third-party library version or arbitrary dependencies on app implementation details.

A newly created or modified plugin may use functionality introduced in a newer app release without implementing a fallback for older apps. On a device whose app version does not support that plugin, Situate must disable the plugin locally and identify the required app version. The plugin must not execute there. Other compatible workspace functionality remains usable; the compatibility restriction on that device must not disable the plugin on devices that meet its requirements. Platform restrictions remain distinct under [REQ-0014](REQ-0014-plugin-platform-compatibility.md).

The six-month interface policy does not require every user-authored plugin change or plugin-owned data migration to remain usable by older app versions. [Plugin migration and activation](REQ-0033-stage-and-activate-plugin-changes.md#data-formats-and-synchronized-changes) govern checked conversion, late-arriving supported formats and synchronized changes. Migration chains and dependencies need not be retained indefinitely. On an unsupported device, received plugin data is retained, but incompatible plugin execution and writes remain blocked.

## Rationale

Stable interfaces protect users' personal workflows from app updates. Allowing explicit minimum app versions avoids mandatory fallback development for every new capability while making device-specific unavailability understandable.

## Source

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. The behavior and must-have priority were confirmed.

## Acceptance criteria

- Updating the app does not break an unchanged plugin that uses public interfaces from an app version published within the preceding six months.
- Compatibility coverage includes public SDK operations and supplied component props, events and slots.
- The compatibility window is measured from the app version's publication, not the plugin's creation or last modification.
- A plugin may use a newly introduced capability without an older-version fallback.
- On an older unsupported app version, that plugin is disabled before execution and a visible explanation names the required app version.
- The device-local restriction leaves the plugin usable on devices whose app versions meet its requirements.
- Other compatible workspace functions remain usable when an individual plugin is unavailable because of its required app version.
- Reaching the six-month boundary does not automatically disable plugins whose interfaces remain compatible.

## Open questions

- How are minimum app versions declared and checked before loading plugin code?
- How are dependent plugins handled when a dependency requires a newer app version?
- After an app update meets a plugin's requirements, is compatibility-based disabling cleared automatically or through explicit user action?
- How is a plugin's minimum app version updated and checked together with a data-format change under REQ-0033?
- How are unavoidable public-interface changes communicated and verified beyond the minimum window?
