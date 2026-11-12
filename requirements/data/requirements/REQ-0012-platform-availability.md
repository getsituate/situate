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

The current MVP targets **macOS and iOS only**. Windows, Linux desktop and Android are deferred: their platform-specific implementation, compatibility and qualification are not required during MVP development. No date for resuming them is committed. The [MVP platform scope](../foundations.md#mvp-platform-scope) governs current acceptance and development effort; retaining source code for a deferred platform does not establish support.

Mobile applications must be distributed through app stores. Desktop app-store distribution is optional. MVP delivery starts with a macOS DMG downloaded from Situate's website, followed by iOS through the App Store. Direct Windows installation through a website-provided installer and direct Linux installation remain deferred with those platforms; they are not MVP acceptance criteria. Direct installations use the [app update mechanism](REQ-0068-update-direct-desktop-installations.md); [package-manager support](REQ-0071-support-desktop-package-managers.md) is a separate should-have requirement. No implementation from the previous prototype is to be carried forward; technology selection remains open within the [foundations](../foundations.md).

Desktop and mobile must target the same functional scope from the outset, including local agent-driven plugin creation, modification and testing. Mobile is not intended as a read-only or consumption-only companion. Platform-specific limitations of individual plugins are made clear in accordance with [REQ-0014](REQ-0014-plugin-platform-compatibility.md).

The interface should use a common responsive design and component system rather than separately styled native interfaces. Usability on less powerful devices is an explicit design concern; no device baseline or quantitative performance target has been selected.

## Rationale

Users should be able to use Situate on common desktop and mobile operating systems rather than adapt their device choices to a single supported system.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: explicit listing of Windows, Linux, Mac, Android and iOS; subsequent confirmation of all listed platform, synchronization and plugin requirements as must-have requirements.

Private architecture-constraints clarification conversation; date not recorded, transcript not included. Mandatory mobile app-store distribution and optional desktop app-store distribution were confirmed.

Private architecture strategy clarification, 2026-09-29; transcript not included. Equivalent desktop/mobile scope, a uniform responsive interface and attention to less powerful devices were confirmed. Flutter and Rust or Go were identified as candidates, not selected technologies.

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. Direct desktop installation, including a website-provided macOS DMG and Windows installer, was confirmed as must-have. Package-manager support was classified separately as should-have.

Private platform-delivery prioritization clarification; date not recorded, transcript not publicly available. macOS via DMG precedes iOS via the App Store; Windows, Linux, Android and package-manager channels remain outside current MVP delivery.

## Acceptance criteria

The current MVP criteria apply to macOS and iOS. The broader platform list remains a deferred goal, not a release gate.

- Situate can be launched and used on macOS and iOS.
- Users can request plugin creation, modification and testing on desktop and mobile without needing another device for those workflows, subject to explicitly identified platform capability limits.
- Shared views and components adapt to desktop and mobile sizes while retaining common styling and interaction conventions.
- A supported version of each named operating system can be identified for usability verification.
- Availability on one platform does not require use of another operating system.
- The iOS application is available through the App Store; macOS availability does not depend on app-store distribution. Android app-store delivery remains part of the deferred platform goal.
- Users can download a macOS DMG from Situate's website and install the application without an app store. The Windows installer remains deferred with Windows support.

## Open questions

- When should Windows, Linux desktop or Android return to active scope, and what native qualification is required before claiming support?

- Which operating system versions, Linux distributions and device classes are supported?
- Which platform capabilities limit otherwise equivalent functionality, particularly local plugin execution and testing under mobile store rules?
- Which representative lower-powered devices and performance targets should guide acceptance testing?
- Which additional mobile app stores and desktop distribution channels are supported?
- Which direct Linux installation formats are supported?
