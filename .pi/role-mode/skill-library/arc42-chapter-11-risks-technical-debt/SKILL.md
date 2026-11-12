---
name: arc42-chapter-11-risks-technical-debt
description: Best practices for documenting arc42 Chapter 11 "Risks and Technical Debt". Use when identifying technical risks, documenting technical debt, prioritizing and evaluating risks, or planning mitigation measures in software architecture documentation.
---

# Risks and technical debt

The CTO leads technical and operational risk assessment. Involve the CEO perspective when a response affects product scope, cost, commitments, or timing; the user decides those trade-offs.

Separate uncertain future events from existing compromises. Unimplemented future features are not automatically technical debt. Explain the affected behavior, supporting evidence, likely consequence, and uncertainty for each entry.

Assess likelihood and impact proportionately. Qualitative judgments are acceptable; do not invent probabilities, financial losses, or deadlines. Record an owner or unresolved ownership question, mitigation options, and a useful review trigger rather than imposing a routine meeting schedule.

Link affected requirements, interfaces, quality scenarios, decisions, or implementation locations. Describe verification needed to reduce uncertainty. Do not propose large rewrites merely to remove a risk label. Keep accepted risks visible and close items only with evidence or an explicit decision. Public records must not expose exploitable production details or confidential incidents.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Core Concepts

### Technical Risks vs Technical Debt

| Aspect         | Technical Risks                               | Technical Debt                                          |
| -------------- | --------------------------------------------- | ------------------------------------------------------- |
| **Definition** | Potential future problems that might occur    | Known current compromises from past decisions           |
| **Nature**     | Uncertainty, potential threats                | Reality, existing liabilities                           |
| **Origin**     | External factors, complexity, dependencies    | Conscious trade-offs, shortcuts, time pressure          |
| **Timeframe**  | Future-oriented (might happen)                | Present-oriented (already exists)                       |
| **Example**    | "Third-party API might change without notice" | "We used a quick workaround instead of proper solution" |

### Risk Categories

1. **Technical Risks**
   - Technology obsolescence
   - Scalability limitations
   - Security vulnerabilities
   - Performance bottlenecks
   - Integration failures

2. **Process Risks**
   - Missing or unclear requirements process
   - Inadequate testing/QA processes
   - Deployment pipeline issues
   - Knowledge silos
   - Documentation gaps

3. **External Risks**
   - Third-party dependencies
   - Vendor lock-in
   - Regulatory changes
   - Market shifts

4. **Business/Domain Risks**
   - System might become obsolete
   - Changing business requirements
   - Competitive pressure

## Risk Identification Methods

### 1. Stakeholder-Based Search

Conduct breadth-first search with representatives from:

- Project/line management
- Product owner
- Development team
- Operations/system administration
- Hardware experts
- End users
- Security experts
- Database experts
- Legal experts

### 2. Interface Analysis

Analyze external interfaces for:

- **Operational risks**: Complex administration, high manual effort
- **Complexity risks**: Complex data structures, esoteric frameworks
- **Volatility risks**: Frequent changes to external systems
- **Security risks**: Sensitive data transmission
- **Cost risks**: Expensive external dependencies

### 3. Qualitative Evaluation (ATAM-style)

Systematically compare quality requirements with architecture:

- Map quality scenarios to architectural approaches
- Identify mismatches and trade-offs
- Document sensitivity points and trade-off points

### 4. Process Analysis

Examine processes for risks:

- Requirements processes
- Development processes
- Build/release/deployment processes
- Test and QA processes
- Management/decision processes

### 5. Data Structure Analysis

Review:

- Data structures and schemas
- Data content quality
- Data distribution and replication
- Backup and synchronization strategies

### 6. Source Code Analysis

Use static and dynamic analysis:

- Static: Lines of code, coupling, cyclomatic complexity
- Dynamic: Test coverage, performance analysis, thread analysis

## Risk Assessment Matrix

### Probability Levels

| Level             | Description    | Indicator                                       |
| ----------------- | -------------- | ----------------------------------------------- |
| **Very High (5)** | Almost certain | Recurring precursors under stated conditions    |
| **High (4)**      | Likely         | Strong indicators, comparable failures observed |
| **Medium (3)**    | Plausible      | Some evidence, important uncertainty remains    |
| **Low (2)**       | Unlikely       | Limited evidence under expected conditions      |
| **Very Low (1)**  | Rare           | Requires exceptional conditions                 |

These are ordinal judgments, not measured probabilities. Record evidence, operating conditions, and the review horizon. Use "unknown" rather than inventing a score when evidence is insufficient.

### Impact Levels

| Level            | Technical Impact                | Business Impact                   |
| ---------------- | ------------------------------- | --------------------------------- |
| **Critical (5)** | System failure, data loss       | Business halt, legal consequences |
| **High (4)**     | Major feature degradation       | Significant revenue loss          |
| **Medium (3)**   | Performance issues, workarounds | Moderate productivity loss        |
| **Low (2)**      | Minor inconveniences            | Small efficiency reduction        |
| **Very Low (1)** | Cosmetic issues                 | Negligible impact                 |

### Risk Priority Number (RPN)

```
RPN = Probability × Impact

Illustrative sorting bands, if the team uses this scale:
- 20-25: Critical
- 15-19: High
- 10-14: Medium
- 5-9: Low
- 1-4: Very Low
```

Multiplying ordinal scores is only a sorting aid, not an expected-loss calculation. Severe data-loss or security consequences may need attention regardless of the product. Agree actions and dates separately; a score grants no approval or automatic acceptance.

## Technical Debt Documentation (TDR Format)

### Lean TDR Template

```markdown
# TDR-[ID]: [Short Title]

- **Status**: Open | Planned | In Progress | Resolved | Won't Fix
- **Date**: YYYY-MM-DD
- **Owner**: [Person/Team]

## Description

Concise explanation of the technical debt. What was done, what's missing.

## Context

Why was this debt incurred? (e.g., deadline pressure, prototype phase)

## Impact

- **Technical**: Performance, scalability, maintainability impact
- **Business**: Operational risk, cost implications

## Symptoms

Observable signs (e.g., frequent bugs, slow builds, complex deployments)

## Proposed Solution

Recommended approach to resolve the debt.

## Effort Estimate

Rough estimation of resources/time required.
```

### Comprehensive TDR Template

```markdown
# TDR-[ID]: [Title]

## Metadata

- **Author**: [Name]
- **Date**: YYYY-MM-DD
- **Version**: [Version when identified]
- **State**: Identified | Analyzed | Approved | In Progress | Resolved | Closed | Rejected
- **Severity**: Critical | High | Medium | Low

## Summary

Brief overview of the technical debt.

## Context

Detailed background including why debt was incurred.

## Impact

### Technical Impact

- System performance
- Scalability constraints
- Maintainability issues

### Business Impact

- Operational repercussions
- Customer satisfaction
- Risk levels

## Symptoms

Observable indicators of the debt.

## Potential Risks

Adverse outcomes if debt remains unaddressed.

## Proposed Solution

Recommended actions or strategies.

## Cost of Delay

Consequences of postponing resolution.

## Effort to Resolve

Estimated resources, time, and effort.

## Dependencies

Other tasks, components, or external factors.

## Relations

Links to related TDRs or ADRs.

## Additional Notes

Any other relevant information.
```

## Risk Mitigation Strategies

### 1. Avoidance

Eliminate the risk by changing approach:

- Use proven technology instead of bleeding-edge
- Remove unnecessary features
- Simplify architecture

### 2. Mitigation

Reduce probability or impact:

- Add redundancy
- Implement monitoring
- Create fallback mechanisms
- Increase test coverage

### 3. Transfer

Shift risk to third party:

- Insurance
- Outsourcing
- Service Level Agreements
- External support arrangements with explicit obligations; community participation alone transfers no responsibility

### 4. Acceptance

Acknowledge and monitor:

- Document decision
- Define trigger points
- Establish monitoring
- Plan contingency

### Mitigation Measures Template

| Risk ID | Mitigation Strategy               | Responsible  | Timeline | Status      |
| ------- | --------------------------------- | ------------ | -------- | ----------- |
| R001    | Implement circuit breaker pattern | Backend Team | Q2 2024  | Planned     |
| R002    | Add automated failover            | DevOps Team  | Q1 2024  | In Progress |

## Documentation Formats

### Table Format (Recommended)

```markdown
| ID  | Risk/Debt                                 | Category  | P   | I   | RPN  | Mitigation           | Owner  |
| --- | ----------------------------------------- | --------- | --- | --- | ---- | -------------------- | ------ |
| R1  | Single point of failure in auth service   | Technical | 3   | 5   | 15   | Implement redundancy | Team A |
| T1  | Legacy database schema without migrations | Debt      | -   | -   | High | Migration scripts    | Team B |
```

### Structured List Format

```markdown
## Risk R1: [Title]

**Category**: Technical
**Probability**: Medium (3)
**Impact**: High (4)
**RPN**: 12

**Description**: [Detailed description]

**Mitigation**: [Proposed measures]

**Owner**: [Team/Person]
**Status**: [Open/In Progress/Resolved]
```

## Anti-Patterns to Avoid

1. **Vague Descriptions**
   - ❌ "The system might have performance issues"
   - ✅ "Database queries on table X exceed 2s under load >1000 req/s"

2. **Missing Context**
   - ❌ "We have technical debt in the frontend"
   - ✅ "TDR-01: jQuery-based components prevent migration to React"

3. **No Ownership**
   - ❌ Risk listed without responsible party
   - ✅ Each item has an owner or explicit ownership question and a review trigger

4. **Static Documentation**
   - ❌ Write once, never update
   - ✅ Review when evidence, dependencies, impact, or agreed milestones change

5. **Mixing Severity Levels**
   - ❌ All risks marked "High"
   - ✅ Differentiated assessment with clear criteria

6. **Missing Mitigation Plans**
   - ❌ Only listing problems
   - ✅ Including actionable mitigation strategies

## Stakeholder Communication

### For Management

- Focus on business impact
- Use RPN for prioritization
- Present mitigation costs vs. risk costs
- Regular status updates

### For Development Teams

- Detailed technical context
- Clear acceptance criteria for resolution
- Link to related code/tasks
- Effort estimates

### For Operations

- Focus on operational risks
- Monitoring and alerting needs
- Runbook implications
- Incident response procedures

## Review Triggers

Reassess after a relevant incident, dependency change, mitigation experiment, requirement change, or agreed milestone. Choose a calendar interval only when someone owns it and it serves an operational need.

## Integration with Other arc42 Sections

- **Section 1 (Goals)**: Link to quality goals at risk
- **Section 3 (Context)**: External interface risks
- **Section 4 (Strategy)**: Architectural trade-offs creating debt
- **Section 9 (Decisions)**: ADRs that introduced debt
- **Section 10 (Quality)**: Quality scenarios revealing risks

## Examples

### Example 1: Technical Risk

```markdown
## Risk R1: Bottleneck with Deployment Access Rights

**Category**: Process
**Probability**: High (4)
**Impact**: Medium (3)
**RPN**: 12

**Description**: Currently only one developer has access rights to deploy
new versions on production servers. If this person is unavailable,
releases are blocked.

**Mitigation**:

1. Document deployment process (Due: 2 weeks)
2. Train backup personnel (Due: 1 month)
3. Implement automated deployment pipeline (Due: 2 months)

**Owner**: DevOps Lead
**Status**: In Progress
```

### Example 2: Technical Debt Record

```markdown
# TDR-01: Monolithic Frontend Architecture

- **Status**: Open
- **Date**: 2024-01-15
- **Owner**: Frontend Team

## Description

The frontend is built as a single monolithic SPA, making it difficult
to deploy changes to individual features independently.

## Context

Initial MVP was built quickly with Create React App to validate market fit.
Now scaling to multiple teams requires better separation.

## Impact

- **Technical**: Long build times (15+ min), tight coupling
- **Business**: Coordinated releases slow feature delivery

## Symptoms

- Merge conflicts in shared components
- Fear of touching "legacy" code sections
- Long regression test cycles

## Proposed Solution

Gradual migration to micro-frontends using Module Federation.

## Effort Estimate

3-4 months for full migration, can be done incrementally.
```

## Checklist

### When Identifying Risks

- [ ] Involved all relevant stakeholders
- [ ] Analyzed all external interfaces
- [ ] Reviewed quality requirements vs. architecture
- [ ] Examined development and deployment processes
- [ ] Analyzed data structures and flows
- [ ] Reviewed source code metrics

### When Documenting

- [ ] Clear, specific descriptions (no vague statements)
- [ ] Assigned probability and impact levels
- [ ] Prioritization states evidence and uncertainty; any RPN is only an ordinal sorting aid
- [ ] Defined mitigation strategies
- [ ] Assigned ownership
- [ ] Set review dates

### For Technical Debt

- [ ] Documented context (why debt was incurred)
- [ ] Described current impact
- [ ] Listed observable symptoms
- [ ] Proposed resolution approach
- [ ] Estimated effort
- [ ] Linked to related ADRs if applicable

### For Communication

- [ ] Adapted message to stakeholder audience
- [ ] Included business impact for management
- [ ] Provided technical details for developers
- [ ] Agreed useful review triggers and ownership
- [ ] Established monitoring for accepted risks
