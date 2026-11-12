---
name: unit-testing-best-practices
description: Write and review behavior-focused tests with independent expected results, minimal fixtures, appropriate doubles, and deterministic asynchronous behavior.
---

# Unit testing best practices

## Test the contract at the right boundary

Choose a test that can expose the actual fault, not merely execute changed lines. Use domain/unit tests for deterministic decisions; integration tests for serialization, persistence, adapters, and runtime wiring; browser or native tests when the behavior depends on those environments.

In Situate, a Vue test with mocked IPC cannot prove the WebView-to-Tauri-to-Rust-to-filesystem path. A pure Rust rule does not need that whole path. Add multiple layers only when they detect different failure classes.

For complex coverage selection, use `risk-based-test-design`. Read [the repository test guide](../../../../docs/development/testing.md) for current commands, categories, registration, and required gates.

## Make the assertion independent

Derive expected results from the agreed contract or a known reproducer, not by calling the production helper or copying its algorithm into the test. Assert observable output, persisted state, or required effects. Verify internal interactions only when they represent a consequential contract that cannot be checked more directly.

A test should fail when its claimed behavior is broken. For a defect, reproduce the original scenario and, when practical, confirm the regression test fails on the pre-fix behavior for the expected reason. Do not claim that confirmation if only the fixed version was tested.

Exercise supported success and failure outcomes, touched boundaries, and relevant invariants. Avoid tests of private methods, trivial accessors, or framework behavior that establish no application contract.

## Keep fixtures and doubles proportionate

Use small local fixtures and real value/domain objects. Create shared builders, custom assertions, or fakes only when they clarify actual repeated needs. One coherent scenario can have several assertions; arbitrary one-assertion rules make related outcomes harder to understand.

Replace slow, nondeterministic, or unavailable boundaries with the simplest suitable double. Do not mock every internal collaborator or add a production interface solely to enable a convenient mock. A mocked adapter does not verify the real adapter's contract.

## Control nondeterminism

Control clocks and randomness where the behavior depends on them. Await observable completion or use bounded condition-based waits rather than fixed sleeps. Keep fixtures isolated, release resources, and clean temporary state even after assertion failures. Tests must not depend on execution order or shared user data.

## Preserve failing evidence

Run the narrowest relevant check, then the repository-required checks. Investigate an affected failure rather than weakening assertions, skipping the test, or updating snapshots without reviewing the behavior change. A changed expectation requires a justified contract change.

Separate confirmed pre-existing failures from regressions; preserve unrelated work and report blockers. Test counts and coverage percentages do not substitute for assertions that detect the intended failure.
