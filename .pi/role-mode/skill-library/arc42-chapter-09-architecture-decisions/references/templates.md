# ADR Templates Collection

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

## Template 1: Full MADR Format

Use for significant architectural decisions requiring detailed documentation.

```markdown
# ADR-{NNN}: {Short Title}

## Status

- {Draft / Proposed / Accepted / Rejected / Deprecated / Superseded by ADR-XXX}

## Context and Problem Statement

{Describe the context and problem in 2-3 sentences. What situation requires a decision?}

{Optional: Include user story or scenario}

## Decision Drivers

- {driver 1 - e.g., performance requirement}
- {driver 2 - e.g., team expertise}
- {driver 3 - e.g., integration constraint}
- {driver 4 - e.g., compliance requirement}

## Considered Options

### Option 1: {Title}

{Description of the option}

**Pros:**

- {advantage 1}
- {advantage 2}

**Cons:**

- {disadvantage 1}
- {disadvantage 2}

### Option 2: {Title}

{Description of the option}

**Pros:**

- {advantage 1}
- {advantage 2}

**Cons:**

- {disadvantage 1}
- {disadvantage 2}

### Option 3: {Title}

{Description of the option}

**Pros:**

- {advantage 1}
- {advantage 2}

**Cons:**

- {disadvantage 1}
- {disadvantage 2}

## Decision

**Chosen option:** "{option title}"

**Rationale:**

{Explain why this option was chosen. Be specific and link to decision drivers.}

- {justification 1}
- {justification 2}
- {justification 3}

## Consequences

### Positive

- {benefit 1}
- {benefit 2}
- {benefit 3}

### Negative

- {trade-off 1}
- {trade-off 2}
- {trade-off 3}

### Neutral

- {observation 1}
- {observation 2}

## Compliance

{How will adherence to this decision be verified?}

- {verification method 1}
- {verification method 2}

## Notes

- {link to related ADR}
- {link to external documentation}
- {other relevant information}

## Change Log

| Date       | Author | Change        |
| ---------- | ------ | ------------- |
| YYYY-MM-DD | Name   | Initial draft |
| YYYY-MM-DD | Name   | Accepted      |
```

## Template 2: Lightweight Format

Use for less critical decisions or when speed is essential.

```markdown
# ADR-{NNN}: {Title}

## Status

{Accepted}

## Context

{What problem are we solving?}

## Decision

We will {what we decided}.

## Rationale

{Why? Link to specific requirements or constraints.}

## Consequences

- Good: {benefit}
- Bad: {trade-off}
```

## Template 3: Y-Statement Format

Use for very quick decisions or when space is limited.

```markdown
# ADR-{NNN}: {Title}

## Decision (Y-Statement)

In the context of {system or use case},
facing {concern or problem},
we decided for {chosen option}
and neglected {rejected options},
to achieve {goal or benefit},
accepting {trade-off or drawback},
because {rationale}.

## Status

{Accepted}
```

## Decision Driver Categories

When identifying decision drivers, consider:

### Functional Drivers

- Feature requirements
- Integration needs
- User experience goals

### Quality Attribute Drivers

- **Performance**: Response time, throughput, capacity
- **Scalability**: Growth expectations, load patterns
- **Reliability**: Availability, fault tolerance
- **Security**: Authentication, authorization, data protection
- **Maintainability**: Code complexity, testability
- **Usability**: Developer experience, operational complexity

### Constraint Drivers

- **Budget**: Cost limitations
- **Time**: Deadlines, time-to-market
- **Expertise**: Team skills and knowledge
- **Legacy**: Existing systems and technical debt
- **Compliance**: Regulations, standards

## Evaluation Criteria Template

Use this framework to evaluate options consistently:

```markdown
## Evaluation Matrix

| Criterion   | Weight | Option 1 | Option 2 | Option 3 |
| ----------- | ------ | -------- | -------- | -------- |
| Performance | High   | ✅       | ⚠️       | ❌       |
| Scalability | High   | ✅       | ✅       | ⚠️       |
| Cost        | Medium | ⚠️       | ✅       | ✅       |
| Team Fit    | High   | ✅       | ❌       | ⚠️       |
| Risk        | Medium | ⚠️       | ⚠️       | ❌       |
| **Total**   |        | **4.5**  | **3.5**  | **2.0**  |

Legend: ✅ = Good, ⚠️ = Acceptable, ❌ = Poor
```

## ADR Naming Conventions

### File Naming

```
adr-001-database-selection.md
adr-007-api-gateway.md
adr-018-caching-strategy-v2.md
```

### Title Format

```
ADR-001: Database Selection for User Service
ADR-007: API Gateway Implementation
ADR-018: Multi-Tier Caching Strategy
```

### Numbering Strategy

- Use sequential numbers (001, 002, ...)
- Never reuse numbers
- Keep a simple index (README.md or index.md)
- Optional: Reserve ranges for categories
  - 001-099: Infrastructure
  - 100-199: Architecture patterns
  - 200-299: Technology choices
  - etc.

## Status Transitions

```
Draft → Proposed → Accepted
              ↓
         Rejected

Accepted → Deprecated
        ↓
   Superseded (by new ADR)
```

### When to Change Status

| From     | To         | When                                |
| -------- | ---------- | ----------------------------------- |
| Draft    | Proposed   | Document complete, ready for review |
| Proposed | Accepted   | Team consensus reached              |
| Proposed | Rejected   | Better alternative found            |
| Accepted | Deprecated | Decision no longer relevant         |
| Accepted | Superseded | New ADR replaces this one           |

## Common Decision Categories

Document ADRs for decisions about:

### Technology & Tools

- Programming languages
- Frameworks and libraries
- Databases and storage
- Infrastructure platforms
- Monitoring and observability

### Architecture Patterns

- Monolith vs. microservices
- Synchronous vs. asynchronous
- REST vs. GraphQL vs. gRPC
- Event-driven vs. request-response

### Process & Practices

- Deployment strategies
- Testing approaches
- Code review requirements
- Documentation standards

### Integration & Data Flow

- API design patterns
- Authentication mechanisms
- Data formats and schemas
- Event contracts
