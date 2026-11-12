---
name: code-documentation-guidelines
description: Decide when comments, API contracts, developer guides, or architecture records add information that code and tests cannot convey. Use when adding, reviewing, or updating technical documentation.
---

# Code documentation guidelines

Document what a caller or maintainer needs but cannot reliably infer from names, types, behavior tests, or the existing canonical documentation.

## Choose the smallest useful form

| Information                                                                                                   | Place                                                            |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A surprising constraint, trade-off, or reason near an implementation                                          | A short local comment                                            |
| Preconditions, failure semantics, side effects, ordering, ownership, or concurrency guarantees a caller needs | Documentation at the API boundary                                |
| Durable setup, usage, configuration, or migration instructions                                                | The existing developer or user guide                             |
| A consequential architectural choice and its alternatives                                                     | The existing architecture documentation or decision record       |
| Expected observable behavior                                                                                  | Executable tests where practical                                 |
| Task progress or verification results                                                                         | The conversation or requested delivery report, not product files |

An exported or public symbol does not automatically need a documentation block. Document contracts that callers cannot safely infer; avoid restating parameter names or types. Include examples only when they resolve an actual usage ambiguity.

## Comments that earn their place

Keep reasons, constraints, and non-obvious effects. For a workaround, identify the verified limitation and the condition under which it can be removed; link an existing issue or authoritative reference when useful. Never invent issue IDs, legal obligations, measurements, or vulnerability claims.

Prefer a clearer name or expression when it removes the need for a comment within the current scope. Do not turn a simple explanatory comment into a larger refactoring.

Remove redundant narration, commented-out code, journal entries, and task-history language from changed code. A TODO must describe concrete deferred work; reference an existing tracking issue when there is one, rather than inventing a ticket or speculative future task.

## Update without multiplying documents

Update documentation when requested or when the change affects durable documented usage, setup, APIs, migration, boundaries, or behavior. A code edit alone is not a reason to expand a README or create an ADR.

Use the existing source of truth and cross-reference it. Keep requirements in the requirements catalog rather than reproducing them in architecture or code comments. Preserve the distinction between proposed decisions, accepted decisions, and implemented behavior.

Before finishing, verify affected comments against the code and check changed examples and links. Remove stale claims rather than preserving them for completeness. Write for a reader who has no access to the task conversation.
