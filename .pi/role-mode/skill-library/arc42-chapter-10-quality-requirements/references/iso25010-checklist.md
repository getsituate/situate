# ISO 25010 Quality Characteristics Checklist

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Use this abbreviated discovery aid to identify relevant quality concerns. It draws on ISO/IEC 25010 product quality terminology but is not an exhaustive standard reproduction, conformance checklist, or certification claim. Consult the applicable edition for exact definitions; record only relevant scenarios.

## 1. Functional Suitability

**Definition:** Degree to which functions meet stated and implied needs.

### Sub-Characteristics

- [ ] **Functional Completeness**: Are all specified tasks and user objectives covered?
  - Example scenario: "All user stories from Sprint 1-5 are implemented"

- [ ] **Functional Correctness**: Do functions provide correct results?
  - Example scenario: "Tax calculation accuracy within 0.01 EUR"

- [ ] **Functional Appropriateness**: Do functions facilitate task completion?
  - Example scenario: "Invoice generation requires < 3 clicks"

### Questions to Ask

- What features are absolutely required?
- What accuracy/precision is needed?
- Are there regulatory compliance requirements?

---

## 2. Performance Efficiency

**Definition:** Performance relative to resources used.

### Sub-Characteristics

- [ ] **Time Behavior**: Response and processing times
  - Response time thresholds
  - Throughput requirements
  - Latency bounds

- [ ] **Resource Utilization**: Amount and types of resources used
  - CPU limits
  - Memory constraints
  - Storage requirements
  - Network bandwidth

- [ ] **Capacity**: Maximum limits
  - Concurrent users
  - Data volume
  - Transaction rates

### Questions to Ask

- How many concurrent users?
- What are peak load times?
- What are acceptable response times?
- Any resource constraints (embedded, mobile)?

---

## 3. Compatibility

**Definition:** Ability to exchange information and coexist.

### Sub-Characteristics

- [ ] **Co-existence**: Can it coexist with other products?
  - Resource sharing without interference
  - Side-by-side installation

- [ ] **Interoperability**: Can it exchange information?
  - API standards (REST, GraphQL, gRPC)
  - Data formats (JSON, XML, CSV)
  - Protocols (HTTP/2, WebSocket)

### Questions to Ask

- What systems must this integrate with?
- What standards must be followed?
- Any legacy system compatibility needs?

---

## 4. Interaction Capability (Usability)

**Definition:** Degree to which users can operate the system effectively.

### Sub-Characteristics

- [ ] **Appropriateness Recognizability**: Users recognize suitability
  - Clear value proposition
  - Obvious use cases

- [ ] **Learnability**: Ease of learning
  - Time to proficiency
  - Documentation quality
  - Tutorial effectiveness

- [ ] **Operability**: Ease of operation
  - Task completion steps
  - Consistent UI patterns
  - Keyboard shortcuts

- [ ] **User Error Protection**: Protection against errors
  - Input validation
  - Confirmation dialogs
  - Undo functionality

- [ ] **User Engagement**: User satisfaction
  - Net Promoter Score
  - User satisfaction ratings
  - Feature adoption rates

### Questions to Ask

- Who are the users? (technical vs. non-technical)
- What training is available?
- Accessibility requirements (WCAG)?
- Mobile vs. desktop usage split?

---

## 5. Reliability

**Definition:** Ability to maintain performance under stated conditions.

### Sub-Characteristics

- [ ] **Maturity**: Frequency of failures
  - Defect density
  - Crash rates
  - Error logs

- [ ] **Availability**: Operational and accessible state
  - Uptime percentage
  - Scheduled maintenance windows
  - Recovery time objectives

- [ ] **Fault Tolerance**: Graceful degradation
  - Behavior under partial failure
  - Circuit breaker patterns
  - Fallback mechanisms

- [ ] **Recoverability**: Recovery from failure
  - RTO (Recovery Time Objective)
  - RPO (Recovery Point Objective)
  - Backup frequency
  - Data restoration procedures

### Questions to Ask

- What downtime is acceptable?
- What's the cost of system failure?
- Are there critical time periods (e.g., Black Friday)?
- What data loss is acceptable?

---

## 6. Security

**Definition:** Protection of information and data.

### Sub-Characteristics

- [ ] **Confidentiality**: Access only to authorized parties
  - Encryption at rest
  - Encryption in transit
  - Access controls

- [ ] **Integrity**: Protection from unauthorized modification
  - Data validation
  - Checksums/hashing
  - Audit trails

- [ ] **Non-repudiation**: Proof of actions
  - Digital signatures
  - Immutable logs
  - Transaction records

- [ ] **Accountability**: Traceability of actions
  - User action logging
  - Audit trails retention
  - Admin activity monitoring

- [ ] **Authenticity**: Identity verification
  - Multi-factor authentication
  - Identity verification strength
  - Session management

### Questions to Ask

- What data needs protection?
- Regulatory requirements (GDPR, HIPAA, SOC2)?
- Threat model completed?
- Penetration testing requirements?

---

## 7. Maintainability

**Definition:** Ease of modification by maintainers.

### Sub-Characteristics

- [ ] **Modularity**: Component independence
  - Coupling metrics
  - Component boundaries
  - Interface stability

- [ ] **Reusability**: Use in other contexts
  - Component library
  - Shared services
  - API design

- [ ] **Analyzability**: Ease of understanding
  - Code documentation
  - Architecture documentation
  - Monitoring/observability

- [ ] **Modifiability**: Ease of change
  - Time to implement feature
  - Files changed per feature
  - Regression test coverage

- [ ] **Testability**: Ease of testing
  - Unit test coverage
  - Integration test coverage
  - Test environment parity

### Questions to Ask

- Expected system lifetime?
- Team size and expertise?
- Frequency of expected changes?
- Technical debt tolerance?

---

## 8. Flexibility

**Definition:** Ease of adaptation to different environments.

### Sub-Characteristics

- [ ] **Adaptability**: Ease of adaptation
  - Configuration options
  - Feature flags
  - Environment-specific behavior

- [ ] **Scalability**: Growth capability
  - Horizontal scaling
  - Vertical scaling
  - Database sharding

- [ ] **Installability**: Ease of installation
  - Deployment time
  - Rollback capability
  - Environment setup

### Questions to Ask

- Expected growth rate?
- Geographic expansion plans?
- Multi-tenancy requirements?
- Deployment frequency?

---

## 9. Safety

**Definition:** Absence of unacceptable risk of harm.

### Sub-Characteristics

- [ ] **Operational Constraint**: Safe operation limits
  - Input validation
  - Rate limiting
  - Resource quotas

- [ ] **Risk Identification**: Hazard awareness
  - Failure mode analysis
  - Risk assessment
  - Safety monitoring

- [ ] **Fail Safe**: Safe failure behavior
  - Graceful degradation
  - Safe defaults
  - Emergency shutdown

### Questions to Ask

- Can system failures cause physical harm?
- Financial risk of failures?
- Regulatory safety requirements?
- Fail-safe mechanisms needed?

---

## Quick Reference: Scenario Patterns

| Quality         | Common Measures                                                  |
| --------------- | ---------------------------------------------------------------- |
| Performance     | Response time (ms), Throughput (req/s), Resource usage (MB/CPU%) |
| Security        | Encryption strength, Auth methods, Audit retention (days)        |
| Reliability     | Uptime (%), MTTR (hours), MTBF (hours)                           |
| Maintainability | Code coverage (%), Cyclomatic complexity, Time to fix (hours)    |
| Usability       | Task completion time (min), Error rate (%), Learnability (hours) |
| Scalability     | Max users, Data volume (TB), Growth rate (%)                     |

## Workshop Facilitation Tips

1. **Start with ISO 25010**: Use as a checklist to avoid missing categories
2. **Involve stakeholders**: Business, users, operations, security
3. **Use concrete examples**: "What happens when...?"
4. **Document trade-offs**: "We prioritize availability over consistency"
5. **Review regularly**: Quality requirements evolve with the system
