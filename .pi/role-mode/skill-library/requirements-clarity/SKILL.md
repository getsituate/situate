---
name: requirements-clarity
description: Clarifies only ambiguities that materially block the current task while preserving the smallest safe scope. Use for vague requests where different interpretations would lead to meaningfully different behavior.
---

# Requirements Clarity

Clarify enough to complete the current task safely. Do not turn a request into a broader product specification.

## Use This Skill When

- Two or more plausible interpretations would produce materially different behavior.
- A missing product, policy, data, security, or architecture decision would make implementation guesswork.
- The requested outcome or boundary is unclear.

Do not use it merely because the request omits implementation details the repository already determines.

## Decision Rule

1. Read the request and the smallest relevant repository context.
2. Separate facts from assumptions.
3. Identify only unknowns whose answers would change the current implementation.
4. If a conservative interpretation is safe and reversible, state it briefly and proceed.
5. Otherwise ask one consolidated round of focused questions, then continue from the answers.
6. Escalate only when the missing answer belongs to a product or architecture decision owner.

## Scope Guard

- Current requirements define the scope; possible future needs do not.
- Do not ask about performance, scale, compatibility, configurability, extensibility, analytics, rollout, or additional channels unless the current task or repository evidence makes that concern applicable.
- Do not invent edge cases. Include only cases implied by supported inputs, current invariants, reproduced failures, or credible safety risks.
- Do not create a PRD, planning file, issue, roadmap, phases, estimate, or success metric unless the user explicitly requests that artifact.
- Do not repeat a question already answered by code, tests, an issue, a PDR, an ADR, or nearby conventions.

## Useful Output

When clarification is needed, keep it short:

```text
I need one decision before implementing this safely:

1. [Question whose answer changes behavior]
   - [Option A and consequence]
   - [Option B and consequence]
```

When proceeding with an assumption:

```text
I will use [conservative interpretation] because [current evidence].
[Clearly excluded alternative] remains out of scope.
```

A no-change result is valid when inspection shows the requested behavior already exists.
