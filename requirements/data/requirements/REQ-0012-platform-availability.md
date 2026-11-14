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

The current MVP targets **macOS only**. iOS, Windows, Linux desktop and Android are deferred and are not currently supported: their platform-specific implementation, compatibility and qualification are not required during MVP development. No activation or resumption date is committed. The [MVP platform scope](../foundations.md#mvp-platform-scope) governs current acceptance and development effort; retaining source code for a deferred platform does not establish support.

Mobile applications must be distributed through app stores. Desktop app-store distribution is optional. MVP delivery uses a macOS DMG downloaded from Situate's website and the direct updater. iOS App Store delivery is deferred without a scheduled next stage. Direct Windows installation through a website-provided installer and direct Linux installation remain deferred with those platforms; they are not MVP acceptance criteria. Direct installations use the [app update mechanism](REQ-0068-update-direct-desktop-installations.md); [package-manager support](REQ-0071-support-desktop-package-managers.md) is a separate should-have requirement. No implementation from the previous prototype is to be carried forward; technology selection remains open within the [foundations](../foundations.md).

The deferred desktop/mobile goal retains equivalent functional scope, including local agent-driven plugin creation, modification and testing; it does not require mobile implementation during the macOS MVP. Mobile is not intended as a read-only or consumption-only companion. Platform-specific limitations of individual plugins are made clear in accordance with [REQ-0014](REQ-0014-plugin-platform-compatibility.md).

The interface should use a common responsive design and component system rather than separately styled native interfaces. Usability on less powerful devices is an explicit design concern; no device baseline or quantitative performance target has been selected.

## Rationale

Users should be able to use Situate on common desktop and mobile operating systems rather than adapt their device choices to a single supported system.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: explicit listing of Windows, Linux, Mac, Android and iOS; subsequent confirmation of all listed platform, synchronization and plugin requirements as must-have requirements.

Private architecture-constraints clarification conversation; date not recorded, transcript not included. Mandatory mobile app-store distribution and optional desktop app-store distribution were confirmed.

Private architecture strategy clarification, 2026-09-29; transcript not included. Equivalent desktop/mobile scope, a uniform responsive interface and attention to less powerful devices were confirmed. Flutter and Rust or Go were identified as candidates, not selected technologies.

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. Direct desktop installation, including a website-provided macOS DMG and Windows installer, was confirmed as must-have. Package-manager support was classified separately as should-have.

MVP platform prioritization, 2026-11-13. macOS is the sole current target, delivered through a website DMG and direct updates. iOS, Windows, Linux, Android and package-manager channels are deferred without a delivery date or sequence.

## Acceptance criteria

The current MVP criteria apply to macOS only.

- Situate can be launched and used on macOS without another operating system.
- Users can request local plugin creation, modification and testing on macOS, subject to explicitly identified capability limits.
- Shared views and components adapt to macOS window sizes while retaining common styling and interaction conventions.
- Supported macOS versions can be identified for usability verification.
- Users can download a macOS DMG from Situate's website and install and update the application without an app store.

### Deferred platform criteria

These remain longer-term goals, not current release gates.

- Provide usable applications on iOS, Windows, Linux and Android after explicit platform activation and native qualification.
- Retain equivalent desktop/mobile plugin creation, modification and testing without requiring another device for those workflows.
- Adapt shared views to mobile sizes and identify supported versions and device classes.
- Distribute mobile apps through app stores; retain the website-provided Windows installer and direct Linux installation goals.

## Open questions

- When should iOS, Windows, Linux desktop or Android enter active scope, and what native qualification is required before claiming support?

- Which operating system versions, Linux distributions and device classes are supported?
- Which platform capabilities limit otherwise equivalent functionality, particularly local plugin execution and testing under mobile store rules?
- Which representative lower-powered devices and performance targets should guide acceptance testing?
- Which additional mobile app stores and desktop distribution channels are supported?
- Which direct Linux installation formats are supported?
