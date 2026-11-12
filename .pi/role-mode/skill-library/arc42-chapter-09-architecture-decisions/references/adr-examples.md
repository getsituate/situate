# ADR Examples

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

## Example 1: Technology Choice

```markdown
# ADR-001: Database Selection for User Service

## Status

Accepted

## Context and Problem Statement

We need to select a primary database for the user profile service that will:

- Store 1M+ user profiles
- Handle 10,000 concurrent reads during peak
- Support GDPR-compliant data deletion
- Allow complex queries for analytics

## Decision Drivers

- Performance: <50ms p99 read latency
- Scalability: Support 10x growth
- Team expertise: Familiarity with SQL
- Compliance: GDPR right to deletion
- Cost: Self-hosted preferred

## Considered Options

### Option 1: PostgreSQL

- **Pros**:
  - Team has 5+ years experience
  - Excellent JSON support for flexible schemas
  - Strong consistency guarantees
  - Mature ecosystem
- **Cons**:
  - Vertical scaling limits
  - Complex sharding if needed later

### Option 2: MongoDB

- **Pros**:
  - Native horizontal scaling
  - Flexible schema
  - Good for rapid iteration
- **Cons**:
  - Team lacks expertise
  - Eventual consistency model
  - Higher operational complexity

### Option 3: MySQL

- **Pros**:
  - Widely used, well-known
  - Good performance
- **Cons**:
  - Less advanced JSON features
  - Similar scaling limits as PostgreSQL

## Decision

**Chosen option**: PostgreSQL 15 with read replicas

**Rationale**: PostgreSQL meets all performance requirements while leveraging existing team expertise. The JSONB support allows flexible user profile schemas without sacrificing relational benefits. Read replicas address scaling concerns for the read-heavy workload.

## Consequences

### Positive

- Fast development using known technology
- Strong data consistency
- Rich query capabilities for analytics
- Excellent tooling and monitoring

### Negative

- Will need to plan for horizontal scaling if user base grows beyond 10M
- Requires careful index management for performance

### Neutral

- Decision can be revisited if growth exceeds projections (see ADR-015 for migration strategy)

## Compliance

- All user service database access must go through the repository layer
- Database schema changes require migration scripts
- Deletion behavior, retention exceptions, and backup handling follow the reviewed legal basis; soft-delete alone does not establish erasure compliance

## Notes

- Related: ADR-015 (Database Migration Strategy)
- Related: ADR-003 (Caching Strategy)
```

## Example 2: Architecture Pattern

```markdown
# ADR-007: API Gateway vs. Direct Service Communication

## Status

Accepted

## Context and Problem Statement

Our microservices architecture needs a communication pattern. We must decide between:

- Direct service-to-service calls
- API Gateway pattern
- Service mesh

## Decision Drivers

- Latency requirements: <100ms end-to-end
- Authentication: Centralized vs. distributed
- Protocol flexibility: HTTP/2, gRPC, WebSocket
- Operational complexity

## Considered Options

### Option 1: Direct Service Calls

Services communicate directly with each other.

- **Pros**: Simple, no single point of failure
- **Cons**: Authentication duplicated, hard to change protocols

### Option 2: API Gateway

Single entry point for all client requests.

- **Pros**: Centralized auth, protocol translation, rate limiting
- **Cons**: Potential bottleneck, additional hop adds latency

### Option 3: Service Mesh (Istio)

Sidecar proxies handle all communication.

- **Pros**: Advanced traffic management, observability, security
- **Cons**: High complexity, resource overhead, steep learning curve

## Decision

**Chosen option**: API Gateway (Kong) with direct service calls for internal communication

**Rationale**: The API Gateway provides necessary cross-cutting concerns (auth, rate limiting) for external clients while keeping internal communication simple. This hybrid approach balances functionality with complexity.

## Consequences

### Positive

- Centralized authentication and authorization
- Easy to add cross-cutting concerns (logging, metrics)
- Clients have single endpoint to integrate
- Can evolve internal services independently

### Negative

- API Gateway becomes critical infrastructure (mitigated with HA setup)
- Additional network hop for external requests (~5-10ms)
- Need to monitor gateway performance carefully

### Neutral

- May add service mesh later for advanced traffic management
- Internal services still need service-to-service auth

## Compliance

- All external traffic must route through API Gateway
- Gateway configuration in version control
- Health checks must include gateway availability

## Notes

- Gateway: Kong Gateway 3.x
- Related: ADR-008 (Authentication Strategy)
- Related: ADR-012 (Observability Stack)
```

## Example 3: Process Decision

```markdown
# ADR-012: Code Review Requirements

## Status

Accepted

## Context and Problem Statement

We need to define code review practices that balance:

- Code quality and knowledge sharing
- Development velocity
- Team capacity (5 developers)

## Decision Drivers

- Team size: 5 developers
- Release frequency: Daily deployments
- Criticality: Financial data processing
- Compliance: SOC 2 requirements

## Considered Options

### Option 1: All Changes Require 2 Approvals

- **Pros**: Maximum quality, knowledge spread
- **Cons**: Slows development, bottleneck risk

### Option 2: No Mandatory Reviews

- **Pros**: Fastest development
- **Cons**: Quality risk, no knowledge sharing

### Option 3: Risk-Based Review Requirements

Different requirements based on change type.

- **Pros**: Balanced approach
- **Cons**: More complex process

## Decision

**Chosen option**: Risk-based review requirements

**Rationale**: One size doesn't fit all. Critical changes need thorough review while trivial changes shouldn't block the team.

**Requirements:**

- **Critical** (infrastructure, auth, financial): 2 approvals + security review
- **Standard** (features, bug fixes): 1 approval
- **Trivial** (docs, tests, config): Optional review

## Consequences

### Positive

- Fast iteration on low-risk changes
- Thorough review where it matters
- Supports the fictional team's reviewed change-control policy; this review count alone does not establish SOC 2 conformity

### Negative

- Requires judgment to categorize changes
- Some subjectivity in "critical" classification

### Neutral

- Process documented in CONTRIBUTING.md
- Quarterly review of classification criteria

## Compliance

- Use PR labels: `critical`, `standard`, `trivial`
- Branch protection enforces minimum reviews
- Security team notified on `critical` PRs

## Notes

- Related: ADR-005 (Branching Strategy)
- Reviewed: Quarterly
```

## Example 4: Superseded ADR

```markdown
# ADR-003: Caching Strategy [SUPERSEDED]

## Status

Superseded by ADR-018

## Context and Problem Statement

[Original context...]

## Decision

[Original decision...]

## Why Superseded

In Q3 2024, we migrated from Redis to a multi-tier caching strategy (see ADR-018). This ADR is kept for historical context but no longer represents current architecture.

## Notes

- Superseded by: ADR-018 (Multi-Tier Caching Strategy)
- Date superseded: 2024-09-15
```
