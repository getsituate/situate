---
name: interaction-states-pass
description: Review feedback, transitions and recovery in a scoped interaction. Use to find missing or misleading states in a concept, prototype or implemented flow.
---

# Interaction states pass

Identify the task and surface. Determine whether the request is review-only or includes edits. Read the relevant behavior requirements before proposing states.

Map each meaningful action to its precondition, visible response, next state and available recovery. Examine only applicable states: empty, editing, pending, success, partial result, failure, cancellation, offline or uncertain outcome.

Check:

- Can the user tell what is happening and which context is affected?
- Are unavailable actions explained rather than merely dimmed?
- Does interruption preserve appropriate work without claiming impossible rollback?
- Are retry and duplicate-action risks visible where consequences matter?
- Are proposed actions, authorized work and completed effects distinguishable?
- Is keyboard focus preserved or deliberately moved after changes?
- Do assistive technologies receive meaningful status updates?

For AI, plugins and synchronization, consult the catalog for approval, reversal, lifecycle and conflict boundaries. Do not imply that stopping a process undoes an external effect, that a simulated result is confirmed, or that UI controls establish a security boundary.

Return prioritized findings with the triggering action, expected and observed behavior, evidence and recovery consequence. Mark speculative risks as hypotheses. Do not add every possible state or a new recovery policy by default.

If changes are authorized, keep them within the surface and verify the affected transitions. Report untested states and unresolved product decisions separately.
