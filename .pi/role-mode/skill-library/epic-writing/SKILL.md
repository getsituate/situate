---
name: epic-writing
description: Write lean GitHub epics only for outcome-oriented work that genuinely requires multiple independently mergeable child issues.
---

# Epic Writing

An Epic is a parent for several delivery issues that share one outcome. It is not a mandatory wrapper for a single task or a place to predict a complete program upfront.

## When an Epic Is Warranted

Create an Epic only when:

- the outcome requires multiple independently mergeable issues;
- the children need shared context or coordinated completion; and
- the parent remains useful even if priorities or child scope change.

Use a standalone Task or Bug when one issue can deliver the outcome.

## Define Only Current Knowledge

Capture:

- the current problem and intended outcome;
- approved scope and applicable decisions;
- the smallest meaningful delivery boundary;
- known children and native dependencies;
- explicit completion criteria.

Do not invent dates, owners, estimates, targets, milestones, hypotheses, KPIs, go/no-go thresholds, phases, or non-functional requirements. Include one only when it already exists, the user requests it, or a concrete decision depends on it.

## Child Issues

Each child must be independently mergeable and safe to retain permanently. Split by coherent user or operational outcome, not by controller/service/database layer. Keep required security, data integrity, failure handling, migration safety, user-facing truth, tests, and as-built documentation with the behavior they govern.

Research or decision children are valid only when they are independently useful and behavior-neutral. Do not add dormant production code or speculative flags to manufacture slices.

## GitHub Modeling

Publishing requires explicit authorization. Verify the exact repository before any write and prefer the GitHub CLI (`gh`). Drafting an epic does not authorize publishing it.

- Inspect the repository's supported issue types, fields, labels, and conventions before choosing metadata; do not assume an Epic type or Priority field exists.
- Use native parent/sub-issue relations and directional dependencies when supported and warranted by real execution constraints.
- Set existing labels and assignees only when requested or established by the repository's workflow.
- Do not duplicate native metadata in prose.

## Lean Template

```markdown
## Problem

[Present problem and affected audience or operation.]

## Outcome

[Coherent result this Epic coordinates.]

## In scope

- [Approved capability or workstream.]

## Out of scope

- [Likely scope expansion that is not part of this outcome.]

## Completion criteria

- [ ] [Outcome is implemented and verified.]
- [ ] [Intended child issues are complete.]

## References

- [Applicable product decision, architecture issue, evidence, or design.]
```

Add success measures only when a real baseline, target, owner, and decision rule exist. Add milestones only when a stakeholder decision or external dependency requires a checkpoint; ordinary task completion is not a milestone.
