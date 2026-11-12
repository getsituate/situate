---
id: REQ-0065
type: requirement
title: Provide a shared replaceable logging API
status: approved
priority: must
area: Diagnostics
goals: [GOAL-0006]
---

## Description

Application components and plugins must emit [diagnostic events](REQ-0064-record-client-diagnostic-events.md) through one shared logging API. Calls must not depend on a particular file layout, logging library or external service. The implementation responsible for storing or forwarding events must be replaceable without changing the emitting application and plugin code.

The initial implementation writes [device-local files](REQ-0066-bound-local-diagnostic-storage.md). The API must accommodate later implementations for user-initiated diagnostic reports or continuous external delivery without requiring every logging call to be rewritten. Local recording and any future external delivery must be independently filterable; recording an event locally does not imply it must be forwarded.

Events retain their level, category, origin and operation context across implementation changes. Application and plugin use of the API is subject to the same [data limits](REQ-0067-limit-diagnostic-data.md).

No production external integration is required in the initial scope. Providers, remote-delivery behavior and user participation remain undecided under the [delivery boundary](../foundations.md#initial-diagnostic-logging-delivery).

## Rationale

Developers need consistent diagnostic information across application and plugin boundaries without coupling event producers to a selected destination. Replacement must not require reinstrumenting the client.

## Source

Private client-logging requirements clarification; date not recorded, transcript not publicly available. A shared API for application and plugins, replaceable implementations and preparation for later selective or continuous delivery were agreed as must-have capabilities, without selecting an external service.

## Acceptance criteria

- Application and plugin code emit events through the same logging contract with identifiable origins.
- Replacing the local-file implementation with a test implementation requires no changes to the emitting application or plugin code.
- The test implementation receives the event level, category, origin and operation context defined by the shared contract.
- A test destination can receive a filtered subset of events while detailed local recording remains unchanged.
- The initial implementation operates without a configured external logging service and does not transmit diagnostic events externally.

## Open questions

- What concrete API contract and extension mechanism should application components and plugins use?
- Which filtering and selection rules should apply to future diagnostic reports and continuous delivery?
- What buffering, retry, delivery and duplicate-handling behavior would external implementations require?
