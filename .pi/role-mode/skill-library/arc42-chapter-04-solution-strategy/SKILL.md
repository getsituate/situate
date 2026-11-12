---
name: arc42-chapter-04-solution-strategy
description: Guide for creating arc42 Chapter 4 "Solution Strategy" documentation. Use when formulating solution strategies, documenting high-level architecture decisions, justifying technology choices, defining architectural direction, or differentiating between strategy and detailed ADRs. Helps structure fundamental architectural approaches that shape the system.
---

# Solution strategy

The CTO leads the technical approach within the CEO's agreed scope and business limits. Read chapters 1–3 and existing decisions before recommending a direction.

For each significant approach, explain which need or restriction it addresses, why it fits, and what cost or limitation it introduces. Consider structure, integration, data ownership, delivery, and quality only where they matter to current needs.

Keep the strategy concise. Link detailed rationale to chapter 9 decisions and mechanisms to the relevant structural, runtime, deployment, or concept section. Architecture decisions may be system-wide; chapter 9 is not limited to small implementation choices.

Distinguish proposed approaches, accepted direction, and implemented behavior. Do not select technologies to fill a template or infer acceptance from a discussion. Record meaningful open alternatives instead of claiming a complete design prematurely. Revisit the strategy when its goals, constraints, or underlying decisions change.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## What is Solution Strategy?

Chapter 4 summarizes the **fundamental decisions and solution strategies** that shape the system's architecture. It answers:

> "What is our approach, and which major decisions guide the design?"

This is where goals (Chapter 1), constraints (Chapter 2), and context (Chapter 3) start to shape the design through a small set of guiding decisions.

## What Belongs in Chapter 4

### Include

- **Guiding architectural choices** that shape the whole design
- **Major platform/technology decisions** (the "heavy" ones that shouldn't change every sprint)
- **Top-level decomposition** (monolith vs. distributed, architectural patterns)
- **Integration strategy** (how external systems are connected)
- **Data approach** (ownership, consistency model)
- **Deployment/operations style**
- **Approaches to achieve key quality goals**
- **Relevant organizational decisions** (development process, delegation)
- **Trade-offs and rationale** linked back to earlier chapters
- **Consequences** (what the choice enables or constrains)
- **Links to ADRs** (Chapter 9) when they exist

### Exclude

- Detailed breakdowns of internal parts (→ Chapter 5)
- Step-by-step interaction flows (→ Chapter 6)
- Environment-specific operational details (→ Chapter 7)
- Routine implementation choices (keep in code or task records; use Chapter 9 for consequential decisions)
- Copy/pasting earlier chapters (link instead)

## Solution Strategy vs. Architecture Decisions

| Aspect          | Solution Strategy (Chapter 4)             | Architecture Decisions (Chapter 9)                                           |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| **Level**       | High-level, strategic                     | Detailed, specific                                                           |
| **Stability**   | Stable, long-term                         | Can evolve, may be superseded                                                |
| **Scope**       | Summary of system-wide direction          | System-wide or local decisions with lasting consequences                     |
| **Format**      | Short statements, tables                  | ADR format (Context/Decision/Consequences)                                   |
| **Examples**    | "Modular monolith with strict boundaries" | "Use PostgreSQL over MySQL for JSON support"                                 |
| **When to use** | Explain the current overall approach      | Preserve context, alternatives, rationale, and status of significant choices |

**Rule of thumb**: If it fits in 2-3 lines and guides the overall design, it belongs in Chapter 4. If it needs a full ADR with pros/cons analysis, it belongs in Chapter 9.

## Recommended Structure

### Option 1: Compact List (Lean)

```markdown
## 4. Solution Strategy

[1-3 short paragraphs: overall approach and why]

- **Strategy Name**
  Why this direction, what it enables/constrains,
  traces to: [goal/constraint/context from Ch. 1-3]

- **Strategy Name**
  ...

### Open Strategy Questions (optional)

- **Question:** ...
  Why it matters: ...
  Next step/owner: ...
```

### Option 2: Quality-Focused Table (Recommended for complex systems)

```markdown
## 4. Solution Strategy

| Quality Goal  | Scenario                    | Solution Approach                                     | Link to Details |
| ------------- | --------------------------- | ----------------------------------------------------- | --------------- |
| Performance   | Process 250k images/24h     | Store images in filesystem, unique paths by client-ID | Section 8.1     |
| Modifiability | Add new integration ≤2 days | Port/Adapter pattern for all external systems         | Section 5.2     |
| Consistency   | Real-time sync ≤2 seconds   | WebSocket/SSE with polling fallback                   | Section 6.1     |
```

### Option 3: Categorized Strategy (For larger systems)

```markdown
## 4. Solution Strategy

### Structure

- **Modular monolith** (initially): Keep deployment simple while domain stabilizes
- **Strict module boundaries**: No "grab-bag services", explicit interfaces only

### Integrations

- **Port/Adapter pattern**: Each external system behind a boundary
- **Async where possible**: Event-driven for non-critical operations

### Data

- **CQRS for reporting**: Separate read/write models
- **Event sourcing for audit-critical data**: Immutable history

### Operations

- **Container deployment**: Kubernetes for orchestration
- **GitOps**: Infrastructure as code, declarative deployments
```

## Writing Guidelines

### Each Strategy Statement Should Include

1. **Approach/Decision** (one line)
2. **Rationale** (1-2 lines: why this direction)
3. **Consequence/Impact** (one line: what this enables or constrains)
4. **Traceability** (link to Ch. 1 goals, Ch. 2 constraints, or Ch. 3 context)

### Example (Well-Written)

```markdown
- **Modular monolith backend (initially)**
  Keep deployment simple and change-friendly while the domain stabilizes.
  Modules are strict (no "grab-bag services") and communicate via explicit interfaces.
  Traces to: Modifiability goal, team size constraint.
```

### Example (Poor)

```markdown
- We use Kubernetes for deployment.
- The backend is a monolith.
- We use PostgreSQL as database.
```

❌ **Why poor**: Only lists technologies without rationale or traceability.

## Common Anti-Patterns to Avoid

### 1. No Strategy Statements

❌ Empty chapter or just a placeholder
✅ Even early in the project, document known directions

### 2. Repeating Earlier Chapters

❌ Copy/pasting requirements or constraints
✅ Link to drivers, focus on consequences

### 3. Technology List Without Rationale

❌ "We use Kubernetes, PostgreSQL, React..."
✅ "We deploy as containers because ops standardizes on Kubernetes..."

### 4. Missing Rationale

❌ Strategy statements look like preferences
✅ Tie each item to goals, constraints, or context

### 5. Treating Consequences as Negative

❌ Avoiding to mention what a choice constrains
✅ Consequences are direction - be explicit about trade-offs

### 6. Too Detailed

❌ Full page for one strategy item
✅ Details belong in Chapters 5-8 and ADRs

### 7. Hiding Unknowns

❌ Pretending everything is decided
✅ List open strategy questions explicitly

## Done-When Checklist

- [ ] Contains a small set of strategy statements (not a tech wishlist)
- [ ] Each statement has short rationale and clear impact
- [ ] Statements link back to Ch. 1-3 (goals/constraints/context)
- [ ] Choices feel stable enough to not change every sprint
- [ ] Open strategy questions are visible (here or in Chapter 11)

## Tips from arc42

### Tip 4-1: Keep It Compact

Explain the solution strategy as compact as possible (keywords, short list). Details go to Chapter 8 (Crosscutting Concepts).

### Tip 4-2: Use Tables

A table with columns: Quality Goal | Scenario | Solution Approach | Link to Details

### Tip 4-3: Connect to Quality Requirements

In systems with challenging quality requirements, combine documentation of quality scenarios with solution strategy.

### Tip 4-5: Grow Iteratively

Don't decide everything upfront. Add documentation as you prove ideas and approaches useful.

### Tip 4-6: Justify Everything

The "why" is often more important than the "what" or "how".

## Example: Pitstop (Complete)

```markdown
## 4. Solution Strategy

Pitstop is designed as an operational "source of truth" for work orders
and status, with near real-time synchronization between planning and
workshop execution.

- **Modular monolith backend (initially)**
  Keep deployment simple and change-friendly while the domain stabilizes.
  Modules are strict (no "grab-bag services") and communicate via explicit interfaces.
  Traces to: Modifiability goal, team size constraint.

- **Adapter-based integrations (Planning, Notifications, Parts status)**
  Each external system sits behind a port/adapter boundary to protect domain
  logic and keep new integrations fast.
  Traces to: Modifiability goal (≤ 2 days), Planning integration constraint.

- **Near real-time updates via push**
  Workshop and admin need shared truth quickly (≤ 2 seconds).
  Use WebSocket/SSE where possible; fall back to efficient polling.
  Traces to: Consistency goal, near real-time constraint.

- **Degraded-mode workshop operation**
  Workshop UI supports local queueing and later sync when connectivity returns.
  Traces to: Resilience goal, degraded-mode constraint.

- **Audit-first changes for work order state**
  Every status change and important edits record who/when/why (immutable history),
  enabling dispute resolution and throughput analysis.
  Traces to: Auditability goal.

### Open Strategy Questions

- **Question:** WebSocket vs SSE as the default push channel?
  Affects real-time UX and infra constraints. Validate with UI needs + ops constraints.

- **Question:** What conflict resolution approach do we use after offline edits?
  Affects user trust and operational continuity. Define business rules with workshop stakeholders.
```

## Quick Reference: Strategy Categories

Use these buckets to organize your strategy (pick what fits):

| Category         | Examples                                           |
| ---------------- | -------------------------------------------------- |
| **Structure**    | Monolith/modular/distributed, boundaries, layering |
| **Integrations** | Ports/adapters, sync model, contract strategy      |
| **Data**         | Ownership, consistency model, auditability         |
| **Operations**   | Deployment style, runtime isolation, observability |
| **Quality**      | Performance tactics, security approach, resilience |
| **Process**      | Development methodology, team structure, CI/CD     |

## When to Update Chapter 4

- **Early project**: Can start almost empty - that's normal
- **As design stabilizes**: Add proven directions
- **When ADRs are created**: Link from strategy to relevant ADRs
- **When strategy changes**: Document as new ADR, update Chapter 4
- **Regular reviews**: Check with ops and stakeholders for realism
