---
id: REQ-0020
type: requirement
title: Automatically check plugins before marketplace approval
status: approved
priority: could
area: Control and trust
goals: [GOAL-0004]
---

## Description

Situate should provide an automated security review and approval process for plugins submitted to the [marketplace](REQ-0019-share-plugins-through-marketplace.md). The checks must address malware and prompt injection. In this process, only plugins that pass the checks are approved for publication; a failed security check blocks publication.

Passing these checks is not a guarantee that a plugin is harmless. This automation is not required for the first marketplace iteration. Its publication gate is instead per-version manual operator review through the admin interface under [REQ-0019](REQ-0019-share-plugins-through-marketplace.md).

## Rationale

Reviewing shared plugins before publication reduces the risk of distributing behavior that undermines users' control over Situate. Automated review supports this without requiring a manual review of every submission.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. An initial idea of provider-reviewed plugins was refined into automated security approval covering malware and prompt injection. Automated approval was explicitly classified as a could-have capability, with failed checks blocking publication.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. Manual review was selected for the initial marketplace, with automated LLM-backed security review deferred.

## Acceptance criteria

- A submitted plugin undergoes automated security checks before approval through this process.
- The checks cover both malware and prompt injection.
- A plugin that fails a security check is not published in the marketplace.
- Only a plugin that has passed the checks is approved through the automated process.

## Open questions

- Which threats, representative test cases and detection criteria define the required coverage for malware and prompt injection?
- How are inconclusive or interrupted checks resolved without treating them as a pass?
- How will automated review integrate with the required per-version publication gate and handling of later findings under [REQ-0019](REQ-0019-share-plugins-through-marketplace.md)?
