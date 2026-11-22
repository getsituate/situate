---
id: REQ-0012
type: requirement
title: Provide Situate on desktop and mobile platforms
status: approved
priority: must
area: Platforms and synchronization
goals: [GOAL-0001]
---

## Description

The long-term platform goal is availability on Windows, Linux, macOS, Android and iOS. Personal organization should not be tied to a single operating system. This requirement does not prescribe a technical implementation.

macOS is the currently released platform. **Windows is the next product platform to deliver** and is in active development scope. Windows support is not yet released. iOS, Linux desktop and Android remain deferred, with no committed delivery order or date. See the [platform scope](../foundations.md#mvp-platform-scope).

Windows must support every product feature available on macOS, including features that currently require particular Mac hardware, such as dictation. Windows may use different platform mechanisms, but it must preserve the user-visible workflows and guarantees. Features must not be omitted to qualify an initial Windows release. Platform restrictions of individual plugins are governed by [REQ-0014](REQ-0014-plugin-platform-compatibility.md).

The first stable Windows release publishes signed x64 and ARM64 installers in GitHub Releases and enables direct updates for both architectures. The download link on Situate's website can be enabled separately after publication. CI builds and tests Windows; the release pipeline builds, qualifies and publishes the Windows artifacts. Direct installations on both desktop platforms use the [app update mechanism](REQ-0068-update-direct-desktop-installations.md). Desktop app-store distribution is optional; [package-manager support](REQ-0071-support-desktop-package-managers.md) is a separate should-have requirement. Mobile applications must be distributed through app stores. Direct Linux installation remains deferred.

The deferred desktop and mobile targets retain the goal of equivalent functional scope, including local agent-driven plugin creation, modification and testing. Mobile is not intended as a read-only or consumption-only companion. No implementation from the previous prototype is to be carried forward; technology selection remains open within the [foundations](../foundations.md).

The interface should use a common responsive design and component system rather than separately styled native interfaces. Usability on less powerful devices is an explicit design concern; no device baseline or quantitative performance target has been selected.

## Rationale

Users should be able to use Situate on common desktop and mobile operating systems rather than adapt their device choices to a single supported system.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: explicit listing of Windows, Linux, Mac, Android and iOS; subsequent confirmation of all listed platform, synchronization and plugin requirements as must-have requirements.

Private architecture-constraints clarification conversation; date not recorded, transcript not included. Mandatory mobile app-store distribution and optional desktop app-store distribution were confirmed.

Private architecture strategy clarification, 2026-09-29; transcript not included. Equivalent desktop/mobile scope, a uniform responsive interface and attention to less powerful devices were confirmed. Flutter and Rust or Go were identified as candidates, not selected technologies.

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. Direct desktop installation, including a website-provided macOS DMG and Windows installer, was confirmed as must-have. Package-manager support was classified separately as should-have.

MVP platform prioritization, 2026-11-13. The initial release targeted macOS with a website DMG and direct updates.

Subsequent platform prioritization: Windows is the next delivery target, with feature parity, native CI verification and direct distribution. Other deferred targets have no committed order or date.

## Acceptance criteria

### macOS

- Situate can be launched and used on macOS without another operating system.
- Users can request local plugin creation, modification and testing on macOS, subject to explicitly identified capability limits.
- Shared views and components adapt to macOS window sizes while retaining common styling and interaction conventions.
- Supported macOS versions can be identified for usability verification.
- Users can download a macOS DMG from Situate's website and install and update the application without an app store.

### Windows

- A supported Windows installation can run every feature available on macOS, including local agent-driven plugin creation, modification and testing. Native verification covers the Windows-specific paths for these features.
- Users can install a signed x64 or ARM64 package from GitHub Releases and update it through the application without an app store.
- CI builds and tests both Windows architectures. Before publication, the release pipeline qualifies the exact signed installer and update artifacts for both architectures. The stable update feed serves the matching installer for each architecture.
- Enabling the Windows download link on Situate's website does not require a new release, rebuild, or re-signing. The link points to the same published installer for the selected architecture.
- Supported Windows versions and architectures are documented, and native qualification covers that support scope. Physical-device checks may follow initial publication and precede enabling the website download link.

### Deferred platform criteria

These remain longer-term goals, not current release gates.

- Provide usable applications on iOS, Linux desktop and Android after explicit platform activation and native qualification.
- Retain equivalent desktop/mobile plugin creation, modification and testing without requiring another device for those workflows.
- Adapt shared views to mobile sizes and identify supported versions and device classes.
- Distribute mobile apps through app stores and retain the direct Linux installation goal.

## Open questions

- Which Windows versions should the initial release support? Which installer format and native qualification environments should it use?
- When should iOS, Linux desktop or Android enter active scope, and what native qualification is required before claiming support?
- Which other operating system versions, Linux distributions and device classes are supported?
- Which platform capabilities limit otherwise equivalent functionality, particularly local plugin execution and testing under mobile store rules?
- Which representative lower-powered devices and performance targets should guide acceptance testing?
- Which additional mobile app stores and desktop distribution channels are supported?
- Which direct Linux installation formats are supported?
