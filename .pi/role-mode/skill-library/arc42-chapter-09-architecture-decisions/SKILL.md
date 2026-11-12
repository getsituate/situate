---
name: arc42-chapter-09-architecture-decisions
description: Guide for creating Architecture Decision Records (ADRs) following arc42 Chapter 9. Use when documenting architecture decisions, writing ADRs, justifying technical choices, or explaining consequences of architectural decisions. Triggers on requests involving "ADR", "architecture decision", "document decision", or "arc42 chapter 9".
---

# Architecture decisions

The CTO maintains the technical decision record. Load `../writing-adrs/SKILL.md` for the record format, rationale, and lifecycle. Use one decision collection rather than separate records for each role or chapter.

Chapter 9 provides discoverable links to consequential decisions, their current status, and superseding records. Chapter 4 summarizes the current strategic direction; it does not replace the rationale and alternatives recorded here.

Check that decisions link to relevant requirements, constraints, and affected views. An accepted decision can precede implementation. Keep decision status separate from implementation progress and do not describe acceptance as successful verification.

When a decision changes, preserve the previous reasoning and link its replacement. Update the current architectural views where authorized. Escalate effects on product commitments, spending, or scope to the user rather than treating a technical record as business approval.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Overview

This skill helps create effective Architecture Decision Records (ADRs) following arc42 Chapter 9 guidelines and industry best practices. ADRs capture significant architectural decisions with their context, rationale, and consequences.

## When to Use This Skill

- Writing a new ADR
- Documenting an architecture decision
- Justifying a technical choice
- Explaining consequences of a decision
- Reviewing or updating existing ADRs
- Converting informal decisions to formal ADRs

## Core Principles

### What is an ADR?

An Architecture Decision Record (ADR) is a **point-in-time document** that captures:

- A significant architectural decision
- The context in which it was made
- The rationale behind it
- The consequences (positive and negative)

### What Makes a Decision "Architecturally Significant"?

Document decisions that affect:

- System structure or components
- Quality attributes (performance, security, scalability)
- Integration patterns
- Technology choices with long-term impact
- Cross-cutting concerns

**Rule of thumb**: If a new team member would ask "Why did we do it this way?" in 6 months, document it.

## ADR Structure

### Standard Sections (MADR-style Content)

Use these sections as a content checklist, not a replacement file convention. Situate records use `ADR-NNNN-title.adoc` under `docs/architecture/09-architecture-decisions/` and are included by the chapter index. Follow `../writing-adrs/SKILL.md` for status and lifecycle.

```markdown
# ADR-XXX: [Short Title]

## Status

- Proposed / Accepted / Deprecated / Superseded by ADR-YYY

## Context and Problem Statement

[What is the issue we're deciding? 2-3 sentences]

## Decision Drivers

- [Driver 1: e.g., performance requirement]
- [Driver 2: e.g., team expertise]
- [Driver 3: e.g., integration constraints]

## Considered Options

### Option 1: [Name]

- **Pros**: [advantages]
- **Cons**: [disadvantages]

### Option 2: [Name]

- **Pros**: [advantages]
- **Cons**: [disadvantages]

## Decision

**Chosen option**: "[Option Name]"

**Rationale**: [Why this option? Be specific.]

## Consequences

### Positive

- [Benefit 1]
- [Benefit 2]

### Negative

- [Trade-off 1]
- [Trade-off 2]

### Neutral

- [Observation without judgment]

## Compliance

[How to verify this decision is followed]

## Notes

[Links, references, related ADRs]
```

### Alternative: Y-Statement Format

For quick decisions, use the Y-Statement:

```
In the context of [use case],
facing [concern],
we decided for [option]
and neglected [other options],
to achieve [goal],
accepting [trade-off],
because [rationale].
```

## Writing Effective ADRs

### The Context Section

**Good context explains:**

- What problem are we solving?
- What constraints exist?
- What forces are at play?

**Example:**

```markdown
## Context

We need to choose a database for the user profile service.

Constraints:

- Must support 10,000 concurrent users
- Team has PostgreSQL expertise
- Budget limits managed database options
- GDPR compliance required
```

### The Decision Section

**Be specific and actionable:**

- ❌ "We will use a modern database"
- ✅ "We will use PostgreSQL 15 with read replicas"

**Always include rationale:**

- ❌ "We chose Option A"
- ✅ "We chose Option A because it meets our latency requirements (<50ms p99) while the team has existing expertise"

### The Consequences Section

**Document honestly:**

- Don't hide negative consequences
- Be specific about trade-offs
- Include both immediate and long-term effects

**Example:**

```markdown
## Consequences

**Positive:**

- Simple deployment (single binary)
- Fast startup time (<2s)
- Low memory footprint

**Negative:**

- Limited ecosystem compared to Java/Python
- Smaller talent pool for hiring
- Will need to build some libraries ourselves

**Neutral:**

- Requires Go 1.21+ (already approved in ADR-012)
```

## ADR Status Lifecycle

```
┌──────────┐    Review     ┌──────────┐
│  Draft   │──────────────▶│ Proposed │
└──────────┘               └────┬─────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌────────┐  ┌──────────┐  ┌──────────┐
              │Accepted│  │ Rejected │  │Superseded│
              └───┬────┘  └──────────┘  │ by ADR-X │
                  │                     └──────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
   ┌──────────┐       ┌──────────┐
   │Deprecated│       │  Active  │
   └──────────┘       └──────────┘
```

### Status Definitions

| Status         | Meaning                                     |
| -------------- | ------------------------------------------- |
| **Draft**      | Work in progress, not ready for review      |
| **Proposed**   | Ready for team review and feedback          |
| **Accepted**   | Decision approved, ready for implementation |
| **Rejected**   | Decision not accepted, with rationale       |
| **Deprecated** | No longer relevant, but kept for history    |
| **Superseded** | Replaced by a newer ADR (link to it)        |

## Common Anti-Patterns to Avoid

### 1. The "Obvious" ADR

❌ **Don't document**: "We use Git for version control"
✅ **Do document**: "We use monorepo vs. polyrepo structure"

### 2. Missing Context

❌ **Don't write**: "We chose Kubernetes"
✅ **Do write**: "We chose Kubernetes because we need auto-scaling for unpredictable traffic and have team expertise"

### 3. Hiding Trade-offs

❌ **Don't write**: "This solution has no downsides"
✅ **Do write**: "We accept increased complexity for better scalability"

### 4. Vague Rationale

❌ **Don't write**: "It's the best practice"
✅ **Do write**: "It reduces coupling between services, improving our ability to deploy independently"

### 5. Too Many ADRs

- Record consequential decisions without a minimum or maximum count
- Focus on significant decisions
- Not every technical choice needs an ADR

### 6. Stale ADRs

- Review affected ADRs when constraints, requirements, or the design change
- Update status when decisions change
- Link superseding ADRs clearly

## ADR Checklist

Before finalizing an ADR, verify:

- [ ] Title is clear and specific
- [ ] Context explains the problem
- [ ] Real alternatives and reasons for rejecting them are recorded; no invented options
- [ ] Decision includes rationale
- [ ] Consequences include negatives
- [ ] Status is appropriate
- [ ] Links to related ADRs included
- [ ] Written for future team members

## Quick Reference: Decision Criteria

Use these questions to evaluate options:

1. **Fit for Purpose**: Does it solve the problem?
2. **Team Capability**: Can we build/maintain it?
3. **Cost**: What's the TCO (build + operate)?
4. **Risk**: What could go wrong?
5. **Flexibility**: Can we change it later?
6. **Alignment**: Does it fit our strategy?

## Resources

- Read [ADR examples](references/adr-examples.md) for hypothetical decision narratives.
- Use the [templates collection](references/templates.md) to choose appropriate detail.
- Adapt the [ADR content template](assets/adr-template.md) to AsciiDoc; do not create a second decision collection.

## References

- Michael Nygard's original ADR blog post (2011)
- MADR (Markdown ADR) project: adr.github.io/madr
- arc42 Template: arc42.org
- AWS Architecture Blog: ADR Best Practices
