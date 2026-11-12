# Q42 Quality Model Quick Reference

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

The arc42 Q42 Quality Model provides 9 dimensions to categorize and structure quality requirements.

## The 9 Q42 Dimensions

| Dimension       | Key Concepts                                                             | Typical Stakeholder Concerns                                      |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `#reliable`     | Available, robust, fault-tolerant, consistent, recoverable, safe, secure | Users need it to work; Management needs uptime guarantees         |
| `#flexible`     | Easy to change, configurable, integratable, infrastructure flexibility   | Product Owners want new features; DevOps needs deployment options |
| `#maintainable` | Analyzable, modifiable, testable, debuggable, predictable effort         | Developers need to understand and change code                     |
| `#efficient`    | Fast, responsive, resource-efficient (CPU, memory, network)              | Users want speed; Management wants cost efficiency                |
| `#usable`       | Easy to use, attractive, accessible, intuitive                           | End users interact with the system                                |
| `#operable`     | Easy to install, operate, monitor, administer                            | Operations teams run the system                                   |
| `#suitable`     | Provides required functions and characteristics correctly                | Domain experts verify correctness                                 |
| `#secure`       | Confidential, accountable, integrous                                     | Security team protects assets                                     |
| `#safe`         | Fail-safe, fault-isolating, early risk detection                         | Safety-critical contexts                                          |

---

## Dimension Details

### #reliable

**Definition**: The system performs its functions consistently and dependably.

**Covers**:

- Availability and uptime
- Fault tolerance
- Data consistency
- Recoverability
- Safety (physical/safety-critical systems)
- Security (as in "secure from threats")

**Common Scenarios**:

- System availability under load
- Recovery from failures
- Data consistency across distributed nodes
- Graceful degradation

**Keywords**: available, robust, dependable, fail-safe, fault-tolerant, consistent, recoverable

---

### #flexible

**Definition**: The system can adapt to changes in requirements, environment, or usage.

**Covers**:

- Development-time flexibility (easy to modify)
- Runtime flexibility (configurable, adjustable)
- Infrastructure flexibility (deployment options)
- Integration flexibility (connects to other systems)

**Common Scenarios**:

- Adding new features with predictable effort
- Changing configuration without redeployment
- Running in different environments (cloud, on-premise)
- Integrating with third-party systems

**Keywords**: configurable, adaptable, extensible, portable, integrable, modifiable

---

### #maintainable

**Definition**: The system can be efficiently analyzed, modified, and tested.

**Covers**:

- Code analyzability (understandability)
- Modifiability (ease of making changes)
- Testability (ease of testing)
- Debuggability (ease of diagnosing issues)

**Common Scenarios**:

- Time to understand code for new developers
- Effort to implement a bug fix
- Time to add automated tests
- Ease of diagnosing production issues

**Keywords**: analyzable, modifiable, testable, debuggable, understandable

---

### #efficient

**Definition**: The system uses resources optimally to deliver performance.

**Covers**:

- Time behavior (speed, response time)
- Resource utilization (CPU, memory, network, storage)
- Capacity (throughput, concurrent users)
- Energy efficiency

**Common Scenarios**:

- Response time under load
- Memory usage with large datasets
- Throughput for batch processing
- Battery consumption for mobile apps

**Keywords**: fast, performant, optimized, responsive, scalable, lightweight

---

### #usable

**Definition**: The system is easy and pleasant to use.

**Covers**:

- Learnability (ease of learning)
- Operability (ease of operation)
- User error protection
- Accessibility
- User interface aesthetics

**Common Scenarios**:

- Time for new users to become productive
- Error rates for common tasks
- Task completion time
- Accessibility compliance (WCAG)

**Keywords**: user-friendly, intuitive, accessible, ergonomic, learnable

---

### #operable

**Definition**: The system is easy to deploy, operate, and administer.

**Covers**:

- Installability
- Configurability
- Monitoring
- Administrative operations
- Operational cost

**Common Scenarios**:

- Deployment time and complexity
- Ease of configuration changes
- Monitoring and alerting coverage
- Backup and restore procedures

**Keywords**: deployable, manageable, observable, administrable

---

### #suitable

**Definition**: The system provides appropriate functions with correct behavior.

**Covers**:

- Functional appropriateness
- Functional completeness
- Functional correctness
- Business rule compliance

**Common Scenarios**:

- Accuracy of calculations
- Completeness of features
- Correctness of business logic
- Compliance with domain rules

**Keywords**: appropriate, correct, accurate, complete, compliant

---

### #secure

**Definition**: The system protects information and operations from threats.

**Covers**:

- Confidentiality (preventing unauthorized disclosure)
- Integrity (preventing unauthorized modification)
- Accountability (traceability of actions)
- Authenticity (proof of identity)

**Common Scenarios**:

- Data encryption at rest and in transit
- Authentication and authorization
- Audit logging
- Vulnerability management

**Keywords**: confidential, integrous, accountable, authenticated, protected

---

### #safe

**Definition**: The system avoids hazardous situations and mitigates risks.

**Covers**:

- Fault isolation
- Early hazard detection
- Risk mitigation
- Fail-safe behavior

**Common Scenarios**:

- Graceful failure modes
- Automatic hazard detection
- Risk warnings and alerts
- Isolation of faulty components

**Keywords**: fail-safe, hazard-aware, risk-mitigating, protected

---

## Mapping Traditional Qualities to Q42

| Traditional Quality | Primary Q42 Tag | Secondary Tags  |
| ------------------- | --------------- | --------------- |
| Performance         | `#efficient`    | `#usable`       |
| Scalability         | `#efficient`    | `#flexible`     |
| Reliability         | `#reliable`     | `#safe`         |
| Availability        | `#reliable`     | `#operable`     |
| Security            | `#secure`       | `#reliable`     |
| Maintainability     | `#maintainable` | `#flexible`     |
| Usability           | `#usable`       | `#suitable`     |
| Portability         | `#flexible`     | `#operable`     |
| Testability         | `#maintainable` | `#reliable`     |
| Modifiability       | `#flexible`     | `#maintainable` |
| Interoperability    | `#flexible`     | `#suitable`     |
| Compliance          | `#suitable`     | `#secure`       |
| Recoverability      | `#reliable`     | `#operable`     |
| Installability      | `#operable`     | `#flexible`     |
| Learnability        | `#usable`       | `#suitable`     |

---

## Using Q42 in Practice

### Step 1: Identify Stakeholder Expectations

Ask stakeholders what they need:

- **Users**: "I need the system to be fast and always available"
  - Tags: `#efficient`, `#reliable`

- **Developers**: "I need to understand the code and make changes safely"
  - Tags: `#maintainable`, `#flexible`, `#reliable`

- **Operations**: "I need to deploy quickly and monitor effectively"
  - Tags: `#operable`, `#flexible`, `#reliable`

### Step 2: Group by Q42 Dimensions

Organize quality requirements by their primary Q42 tag:

```
#reliable
- 99.9% uptime during business hours
- Automatic failover within 30 seconds
- Data consistency across regions within 2 seconds

#efficient
- API response time < 200ms (95th percentile)
- Support 10,000 concurrent users
- Mobile app battery usage < 2% per hour

#maintainable
- New developer productive within 2 weeks
- Bug fix cycle time < 3 days
- Test coverage > 70% for business logic
```

### Step 3: Write Scenarios

For each requirement, write concrete scenarios with acceptance criteria:

```markdown
### High Availability During Peak Hours

**Context**: E-commerce platform with traffic spikes during sales events.

**Trigger**: Traffic increases 10x during Black Friday sale.

**Acceptance Criteria**:

- System maintains 99.9% availability
- Auto-scaling adds capacity within 3 minutes
- Degraded functionality continues if payment service fails
- Zero data loss during failover

**Tags**: #reliable #efficient
```

---

## Quality Goal Prioritization

Not all quality goals are equally important. Use stakeholder impact to prioritize:

**Critical (Must Have)**:

- System availability for revenue-generating service → `#reliable`
- Data accuracy for financial calculations → `#suitable`, `#reliable`
- Security for healthcare data → `#secure`, `#reliable`

**Important (Should Have)**:

- Response time for user-facing features → `#efficient`, `#usable`
- Testability for complex business logic → `#maintainable`
- Deployment automation for frequent releases → `#operable`, `#flexible`

**Desirable (Nice to Have)**:

- Mobile app offline support → `#flexible`, `#usable`
- Analytics dashboard real-time updates → `#efficient`
- Multi-language support → `#flexible`, `#usable`

---

## Common Pitfalls to Avoid

### Tag Confusion

❌ **Wrong**: "This is about security, so only tag #secure"

✅ **Right**: "Security requires reliability (#reliable for availability), efficiency (#efficient for performance of security checks), and maintainability (#maintainable for security updates)"

### Missing Dimensions

❌ **Wrong**: Only focusing on #efficient (performance) and #usable (UX)

✅ **Right**: Considering all 9 dimensions - especially #maintainable (often forgotten but critical for long-term success)

### Vague Requirements

❌ **Wrong**: "The system should be reliable"

✅ **Right**: "The system maintains 99.9% availability with automatic failover within 30 seconds (#reliable)"

### Too Many Primary Tags

❌ **Wrong**: Tagging every requirement with 4+ dimensions

✅ **Right**: Primary tag (1-2) for focus, secondary tags for related concerns

---

## Quick Decision Guide

**Is the concern about...?**

- **Working correctly and consistently?** → #reliable
- **Changing or adapting?** → #flexible
- **Understanding or modifying code?** → #maintainable
- **Speed or resource usage?** → #efficient
- **User interaction experience?** → #usable
- **Deployment and operations?** → #operable
- **Correct functionality?** → #suitable
- **Protection from threats?** → #secure
- **Avoiding hazards?** → #safe

---

## Resources

- Full Q42 documentation: https://quality.arc42.org
- 132+ example quality requirements: https://quality.arc42.org/requirements
- 208+ quality characteristics explained: https://quality.arc42.org/qualities
- ISO 25010 mapping: https://quality.arc42.org/q42-for-iso-users
