---
id: REQ-0021
type: requirement
title: Check local plugin copies for security concerns
status: approved
priority: must
area: Integrations
goals: [GOAL-0001, GOAL-0004]
---

## Description

Adoption and adaptation as an independent local copy are part of the required [marketplace](REQ-0019-share-plugins-through-marketplace.md) behavior. The resulting copy requires a local security check.

The locally adopted version must undergo a security check before use, including any adaptations. If this check fails, Situate must warn the user and propose changes to address the identified security concerns. Users may choose to use the local plugin despite the warning, without first applying the proposed changes or obtaining a passing check. A previous marketplace approval does not replace this local check.

An unavailable or inconclusive local security check must be identified as such, not reported as passed. Users may explicitly choose to proceed despite that uncertainty, as with an identified security warning. The recorded result and any override apply only to the exact candidate and relevant dependency revisions; changes invalidate them. No security override waives failed functional or compatibility checks.

## Rationale

A published security review may not cover local adaptations. Checking the resulting version and explaining identified risks helps users retain control over the behavior introduced into their setup.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Adoption as a local copy with adaptation to personal needs and setup, together with another security check, was classified as a could-have capability. For a failed local check, a warning and a proposal for making the plugin safer were explicitly requested. Users were explicitly permitted to continue using the local plugin despite the warning.

Private architecture strategy clarification, 2026-09-29; transcript not included. Independent local adoption became the marketplace baseline, with no automatic updates. At that clarification, adaptation and security checks remained a separately prioritized optional bundle; the subsequent plugin clarification below separates them.

Private plugin architecture clarification, 2026-09-29; not publicly available. Adaptation became required under the marketplace requirement; this requirement retained its could-have priority for local security checks only at that time.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. The local check, including adaptations before first use, became mandatory. The existing ability to proceed after a failed check was not withdrawn. A check at adoption cannot guarantee detection of vulnerabilities discovered later.

## Acceptance criteria

- The resulting local version, including any adaptations, is security-checked before use even if the marketplace version was previously approved.
- If the local security check fails, the user receives a warning about the identified concerns and a proposal for changes to address them.
- After receiving the warning, the user can choose to use the local plugin without applying the proposed changes or passing a new security check.
- An unavailable or inconclusive check is visible and can be explicitly overridden without being relabeled as passed.
- Results and overrides are bound to the candidate and relevant dependencies and are invalidated when those inputs change; functional and compatibility failures remain blocking.

## Open questions

- Which threats and test cases must the local security check cover?
