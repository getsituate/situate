---
name: ticket-writing
description: Write concise implementation tickets with current scope, observable outcomes, affected invariants, and proportional verification. Use when a durable GitHub task or story is actually needed.
---

# Ticket Writing

A ticket should contain enough information to implement the current increment without inventing future requirements.

## Before Writing

Drafting does not authorize publication. Before any GitHub write, confirm user authorization and the exact target repository; prefer the GitHub CLI (`gh`). Follow the repository's requirements catalog and preserve stable requirement IDs when citing approved scope.

Confirm that a ticket is needed. Do not create one for work the user asked to implement directly unless repository policy or the user requires it.

Identify:

- the present problem or approved outcome;
- the smallest independently mergeable and safely deployable behavior;
- existing decisions and constraints that apply;
- what is explicitly outside this increment.

## Production-Ready Increment

Production-ready means the requested behavior is coherent, secure, operable, and truthful under the invariants it actually affects. It does not mean adding every possible channel, metric, optimization, documentation category, or future extension.

Do not split required validation, authorization, migration safety, error handling, or user truth from the behavior they protect. Do not combine unrelated improvements merely because they are nearby.

## Acceptance Criteria

Use the fewest criteria that unambiguously describe the observable behavior. Given/When/Then is optional; use it when it improves clarity.

Include an edge case only when it follows from a supported input, current invariant, reproduced failure, or credible safety risk. Do not target an arbitrary criterion count.

## Splitting

Split when each child leaves a coherent permanent state and can be merged safely if later work never happens. Good boundaries are distinct user outcomes, independently useful capabilities, or behavior-neutral enabling work.

Do not split:

- by technical layer when that leaves an unusable feature;
- happy path from required failure handling;
- implementation from documentation made inaccurate by that implementation;
- a temporary compatibility mechanism from its necessary safety controls.

## Lean Template

```markdown
## Context

[Current problem and why it matters.]

## Production-ready increment

[Exact coherent state after merge.]

## Acceptance criteria

- [ ] [Observable behavior or invariant.]
- [ ] [Necessary failure or boundary behavior, if applicable.]

## Out of scope

- [Only boundaries that prevent likely scope creep.]

## Verification

- [Smallest tests or production-like check that prove this increment.]

## References

- [Only applicable PDRs, architecture issue, implementation docs, or related issues.]
```

User-story syntax, technical notes, dependencies, and rollout sections are optional. Add them only when they convey information the implementation cannot safely infer.
