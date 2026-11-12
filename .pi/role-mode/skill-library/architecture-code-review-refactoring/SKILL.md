---
name: architecture-code-review-refactoring
description: Review and improve responsibility boundaries, dependency direction, data ownership, and testability without broadening the requested change.
---

# Architectural review and refactoring

Read the changed behavior, relevant requirements, current decisions, and neighboring implementation. Identify the smallest meaningful boundary affected by the request. Review-only work does not authorize edits.

Trace control and data across that boundary. Ask who owns each invariant, who may modify the data, what contract callers rely on, and whether errors or partial results leak across layers unexpectedly. Look for cycles, hidden cross-module storage access, transport details in business rules, and shared abstractions with unrelated responsibilities.

Evaluate findings against actual change pressure and behavior. Do not mandate interfaces, DTOs, ports, services, or additional layers without a concrete benefit. A small application does not need an enterprise structure to demonstrate separation of concerns.

Report consequential findings with file locations, a failure or maintenance scenario, and a focused remedy. Separate demonstrated defects from uncertain risks and preferences.

When authorized to refactor, preserve externally observable behavior and unrelated work. Make the smallest structural move, test the affected contract, and check failure paths as well as successful use. Update architecture documents only when their documented boundaries or behavior change.
