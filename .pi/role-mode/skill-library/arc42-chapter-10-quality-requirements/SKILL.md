---
name: arc42-chapter-10-quality-requirements
description: Create and refine arc42 Chapter 10 "Quality Requirements" documentation. Use when defining quality requirements, creating quality trees (ATAM), formulating quality scenarios, prioritizing quality attributes, or using ISO/IEC 25010 categories as discovery prompts. Helps with measurable quality scenarios, quality attribute utility trees, and avoiding common anti-patterns.
---

# Quality requirements

The CEO establishes which quality outcomes matter and their business priority. The CTO contributes technical feasibility, trade-offs, and ways to verify them. Read existing catalog entries and chapter 1 before refining scenarios.

Describe each important scenario through the initiating actor or event, operating conditions, affected part, expected response, and observable success criterion. Include units, load, duration, or failure conditions where needed to make a numerical threshold meaningful.

Use approved requirement IDs as the source of truth. Link scenarios to those entries instead of maintaining competing targets. Keep proposed measurements or missing conditions explicitly unresolved until agreed; follow catalog skills before changing approved needs.

Consider relevant usability, security, reliability, interoperability, performance, and maintainability outcomes without filling every category. Distinguish a desired outcome from a technical tactic and from a test result. Link conflicting qualities to trade-off decisions and unresolved risks. Avoid fabricated service levels, coverage targets, or capacity claims.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Purpose

Chapter 10 captures all quality requirements that influence architectural decisions. Quality requirements describe **how well** the system performs its functions, not **what** it does (functional requirements).

## Quality Requirements vs Functional Requirements

| Aspect           | Functional Requirements  | Quality Requirements                   |
| ---------------- | ------------------------ | -------------------------------------- |
| **Question**     | What does the system do? | How well does it do it?                |
| **Focus**        | Features, capabilities   | Performance, security, maintainability |
| **Verification** | Pass/fail tests          | Measurable thresholds                  |
| **Examples**     | "User can log in"        | "Login response time < 2 seconds"      |
| **Stability**    | Change frequently        | Relatively stable                      |

**Key Rule:** Quality requirements must be **specific and measurable** - vague statements like "fast" or "secure" are insufficient.

## Quality Tree (ATAM Utility Tree)

A quality tree hierarchically structures quality requirements with scenarios as leaves.

### Structure

```
Quality (Root)
├── Performance Efficiency
│   ├── Time Behavior
│   │   ├── Scenario: API response < 200ms under normal load
│   │   └── Scenario: Page load < 3s on 3G connection
│   └── Resource Utilization
│       └── Scenario: Memory usage < 512MB per instance
├── Security
│   ├── Confidentiality
│   │   └── Scenario: All PII encrypted at rest (AES-256)
│   └── Integrity
│       └── Scenario: Data tampering detected within 5 minutes
└── Maintainability
    ├── Modularity
    │   └── Scenario: New feature added with < 5 files changed
    └── Testability
        └── Scenario: 80% code coverage for critical paths
```

### Formats

1. **Table Format** (preferred by arc42): Simple, sortable, linkable
2. **Mind Map**: Better for workshops, allows cross-references
3. **Hierarchical List**: Good for version control

### Quality Tree Checklist

- [ ] All ISO 25010 characteristics considered
- [ ] Scenarios are attached as leaves
- [ ] Irrelevant branches are omitted or marked not applicable; missing relevant scenarios stay open
- [ ] Priorities assigned (H/M/L)
- [ ] Business goals linked

## ISO 25010 Quality Characteristics

Use this abbreviated discovery aid, drawing on ISO/IEC 25010:2023 product quality categories. It is not a complete reproduction of the standard or a compliance assessment; consult the applicable edition for exact definitions.

| Characteristic             | Sub-Characteristics                                                                | Typical Scenarios                                |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Functional Suitability** | Completeness, Correctness, Appropriateness                                         | Feature coverage, accuracy of calculations       |
| **Performance Efficiency** | Time Behavior, Resource Utilization, Capacity                                      | Response times, throughput, resource limits      |
| **Compatibility**          | Co-existence, Interoperability                                                     | API compatibility, data exchange formats         |
| **Interaction Capability** | Appropriateness, Learnability, Operability, User Error Protection, User Engagement | Task completion time, error rates, accessibility |
| **Reliability**            | Maturity, Availability, Fault Tolerance, Recoverability                            | Uptime SLAs, MTTR, failover times                |
| **Security**               | Confidentiality, Integrity, Non-repudiation, Accountability, Authenticity          | Encryption, audit logs, authentication           |
| **Maintainability**        | Modularity, Reusability, Analyzability, Modifiability, Testability                 | Time to fix bugs, code coverage, coupling        |
| **Flexibility**            | Adaptability, Scalability, Installability                                          | Deployment time, horizontal scaling              |
| **Safety**                 | Operational Constraints, Risk Identification, Fail Safe                            | Hazard prevention, safety integrity levels       |

## Quality Scenario Template

Use the 6-part scenario structure from ATAM:

### Parts

1. **Source of Stimulus**: Who/what triggers? (user, system, external)
2. **Stimulus**: What event occurs? (request, failure, attack)
3. **Environment**: Under what conditions? (normal, peak, degraded)
4. **Artifact**: Which system part? (component, database, API)
5. **Response**: How should the system react?
6. **Response Measure**: Quantifiable success criteria

### Scenario Template

```
ID: QR-XXX
Quality: [ISO 25010 characteristic]
Priority: [High/Medium/Low]

Source:    [Who triggers the scenario]
Stimulus:  [What happens]
Environment: [Normal/Peak/Degraded/Startup/Shutdown]
Artifact:  [Affected system component]
Response:  [System reaction]
Measure:   [Quantifiable threshold]

Example:
Source:    Authenticated user
Stimulus:  Requests daily sales report generation
Environment: Normal operation, 100 concurrent users
Artifact:   Report generation service
Response:   Report generated and available for download
Measure:    Generation completes within 30 seconds;
            PDF size < 10MB; Available 99.9% of business hours
```

### Quality Scenario Checklist

- [ ] Source clearly identified
- [ ] Stimulus is a specific event
- [ ] Environment context provided
- [ ] Artifact is precisely defined
- [ ] Response describes system behavior
- [ ] Measure is **quantifiable and testable**
- [ ] Stakeholder value is clear

## Prioritization

### Methods

1. **Business Value vs Technical Risk Matrix**
   - High Business Value + High Risk = Priority 1
   - High Business Value + Low Risk = Priority 2
   - Low Business Value + High Risk = Priority 3
   - Low Business Value + Low Risk = Priority 4 (or out of scope)

2. **MoSCoW Method**
   - **M**ust have: Critical for success
   - **S**hould have: Important but not critical
   - **C**ould have: Desirable if time permits
   - **W**on't have: Explicitly excluded

3. **ATAM Prioritization**
   - Rank by importance to stakeholders (1-5)
   - Rank by difficulty to achieve (1-5)
   - Focus on high importance + high difficulty first

### Documentation Format

```markdown
| ID     | Quality     | Scenario    | Priority | Business Driver |
| ------ | ----------- | ----------- | -------- | --------------- |
| QR-001 | Performance | API < 200ms | High     | User retention  |
| QR-002 | Security    | Encryption  | High     | Compliance GDPR |
```

## Anti-Patterns to Avoid

### 1. Vague Requirements

❌ "The system should be fast"
✅ "API endpoints respond within 200ms at 95th percentile under 1000 req/s"

### 2. Untestable Statements

❌ "The system should be user-friendly"
✅ "New users complete onboarding in < 5 minutes with < 2 errors"

### 3. Implementation Prescription

❌ "Use Redis cache for performance"
✅ "Product catalog queries return in < 100ms during flash sales"

### 4. Conflicting Requirements

❌ High security + maximum performance without trade-off analysis
✅ Record expected trade-offs and measure them; do not invent a latency penalty for encryption

### 5. Missing Context

❌ "99.9% uptime"
✅ "99.9% uptime during business hours (9-18 CET), excluding planned maintenance"

### 6. Over-Specification

❌ 50 quality requirements with equal priority
✅ Prioritize architecture-driving scenarios; keep other approved requirements linked rather than dropping them to meet a quota

## Chapter 10 Structure

```markdown
## 10. Quality Requirements

### 10.1 Quality Tree

[Table or mind map showing hierarchy]

### 10.2 Quality Scenarios

[Detailed scenarios for each leaf node]

#### 10.2.1 Performance Efficiency

| ID  | Source | Stimulus | Environment | Response | Measure |
| --- | ------ | -------- | ----------- | -------- | ------- |

#### 10.2.2 Security

...

### 10.3 Prioritization

[Matrix or ranked list with rationale]

### 10.4 Quality Requirements Not Addressed

[Explicitly excluded requirements with reasons]
```

## Workflow

When helping with Chapter 10:

1. **Review Chapter 1.2**: Quality goals should already be defined there
2. **Identify Stakeholders**: Who cares about each quality attribute?
3. **Create Quality Tree**: Use ISO 25010 as checklist
4. **Write Scenarios**: Apply 6-part template for each leaf
5. **Validate Measurability**: Can each scenario be tested?
6. **Prioritize**: Focus on architecturally significant requirements
7. **Link to Decisions**: Reference in Chapter 9 (Architecture Decisions)

## References

- Use the [quality characteristic checklist](references/iso25010-checklist.md) to discover relevant concerns, not to claim standards compliance.
- Read [scenario examples](references/scenario-examples.md) when defining stimulus, response, and measurement.
- Consult the [ATAM guide](references/atam-guide.md) for scenario-based trade-off reviews.
