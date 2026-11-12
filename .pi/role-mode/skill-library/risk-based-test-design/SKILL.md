---
name: risk-based-test-design
description: Select test scenarios for changes spanning multiple boundaries, complex state transitions, or high-impact security, privacy, and data-integrity risks without redundant test layers or speculative cases.
---

# Risk-based test design

## Establish the test basis

Read the affected contract, requirements, change, nearby tests, and any reproducer. Identify supported inputs, reachable states, affected callers, and the boundaries crossed. Flag missing decisions instead of inventing expected behavior.

For a small change, a scenario and its expected result are enough. Use a short table only when several risks or boundaries would otherwise be hard to track; do not create a separate test-plan file unless requested or needed for durable coordination.

Proceed when each intended outcome has a basis in an agreed contract, a reproduced defect, or a necessary security or data-integrity invariant.

## Select credible failures

For each changed boundary, ask what could fail and what the user or stored data would experience. Consider:

- values at specified behavior-changing limits;
- touched state transitions and defined rejection paths;
- allowed and denied access at the real enforcement point;
- serialization, partial writes, retries, cancellation, duplicate effects, or recovery where the operation supports them;
- the exact reported regression.

Prioritize consequence, exposure, and uncertainty using the available evidence. High-impact data loss or access-control risks can merit coverage even with little incident history. Avoid numerical risk scores built from guesses and combinations with no supported execution path.

Proceed when the important failure modes have a concrete cause or boundary and an observable consequence.

## Choose the smallest effective set

For each retained scenario, identify its setup, action, expected observable result, failure detected, and test level. Use the lowest level that can both trigger the failure and observe its consequence:

- domain tests for calculations, decisions, and state rules;
- integration or contract tests for persistence, IPC, serialization, and adapter compatibility;
- browser or native journeys for failures that emerge only across the actual runtime path;
- visual tests for rendered appearance;
- static checks for structural properties they can genuinely enforce.

Reuse existing coverage when its assertions would detect the failure. Remove duplicate scenarios unless they protect against a distinct failure class. Use decision tables or interaction combinations only where actual rules require them.

Finish when every high-impact in-scope risk has a capable check, each retained scenario contributes useful detection, and important omissions have an explicit reason. Report material residual risks in the delivery summary; keep routine selection reasoning out of repository artifacts.
