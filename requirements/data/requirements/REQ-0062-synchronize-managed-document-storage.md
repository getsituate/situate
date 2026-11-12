---
id: REQ-0062
type: requirement
title: Offer managed document storage across devices
status: approved
priority: could
area: Document management
goals: [GOAL-0001]
---

## Description

Situate could offer a managed document storage area with file synchronization across the user's devices and operating-system file access. Users deliberately transfer selected documents into that area rather than expecting arbitrary connected local folders to become remotely available. Existing folder organization should be retained during transfer where possible. External sources may remain in place and coexist in the common document view.

This capability is deferred to a later delivery. It includes on-demand retrieval and chosen offline availability rather than requiring every original on every device. The official service remains subject to end-to-end encryption. Its detailed storage, conflict and operating-system integration behavior is not yet specified. It does not lower the must-have priority of [workspace synchronization](REQ-0013-synchronization-service.md).

## Rationale

Users who choose Situate-managed storage could access formerly local documents on other devices without arranging another document service.

## Source

Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Product decisions, not evidence of prevalence or measured performance.

## Acceptance criteria

- The user explicitly selects documents for transfer into the managed area; unrelated connected sources are not automatically moved.
- Managed documents are accessible through Situate and an operating-system file interface.
- A managed original can become available on another authorized device without requiring all originals to be downloaded there.
- Users can choose documents to retain for offline use.
- The official service cannot decrypt stored user content, consistent with REQ-0013.

## Open questions

- How are transfer, source cleanup and preservation of folder organization verified?
- How do file conflicts, moves, deletion, history and on-demand storage relate to existing workspace synchronization?
- Which platform file-provider mechanisms and cache policies are supported?
- How does this optional service relate to alternative storage connectors, pricing and storage limits?
