# Quality Scenario Examples

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Concrete examples of well-formulated quality scenarios following the ATAM 6-part structure.

## Performance Efficiency Examples

### Example 1: API Response Time

```
ID: QR-PERF-001
Quality: Performance Efficiency - Time Behavior
Priority: High

Source:    Mobile app user
Stimulus:  Requests product catalog
Environment: Normal operation, 1000 concurrent users
Artifact:   Product catalog API
Response:   Returns paginated product list
Measure:
  - 95th percentile response time < 200ms
  - 99th percentile response time < 500ms
  - Throughput: 5000 requests/second
```

### Example 2: Database Query Performance

```
ID: QR-PERF-002
Quality: Performance Efficiency - Time Behavior
Priority: High

Source:    Background job scheduler
Stimulus:  Executes daily analytics aggregation
Environment: Off-peak hours (02:00-04:00)
Artifact:   Analytics database
Response:   Completes aggregation and updates dashboards
Measure:
  - Aggregation completes within 2 hours
  - Database CPU usage < 80%
  - No impact on user-facing queries
```

### Example 3: Resource Utilization

```
ID: QR-PERF-003
Quality: Performance Efficiency - Resource Utilization
Priority: Medium

Source:    Application server
Stimulus:  Processes normal user load
Environment: Production, 500 concurrent sessions
Artifact:   Application container
Response:   Handles user requests efficiently
Measure:
  - Memory usage < 2GB per instance
  - CPU usage < 70% average
  - Auto-scaling triggers at 80% CPU
```

---

## Security Examples

### Example 4: Data Encryption at Rest

```
ID: QR-SEC-001
Quality: Security - Confidentiality
Priority: Critical

Source:    Data storage system
Stimulus:  Stores customer PII
Environment: All environments (prod, staging)
Artifact:   Database and file storage
Response:   Encrypts sensitive data
Measure:
  - AES-256 encryption for all PII
  - Key rotation every 90 days
  - Encryption verified by quarterly audit
```

### Example 5: Authentication Strength

```
ID: QR-SEC-002
Quality: Security - Authenticity
Priority: Critical

Source:    End user
Stimulus:  Attempts to access sensitive resources
Environment: Production
Artifact:   Authentication service
Response:   Verifies user identity
Measure:
  - Multi-factor authentication required for admin roles
  - Session timeout after 30 minutes inactivity
  - Failed login attempts limited to 5 per 15 minutes
  - Password policy follows the approved threat assessment; reject known-compromised passwords
```

### Example 6: Audit Logging

```
ID: QR-SEC-003
Quality: Security - Accountability
Priority: High

Source:    Any authenticated user
Stimulus:  Performs sensitive operation (data modification, access)
Environment: Production
Artifact:   Audit logging subsystem
Response:   Records action with context
Measure:
  - 100% of sensitive operations logged
  - Log retention: 7 years
  - Log tampering detection within 1 hour
  - Immutable log storage (WORM)
```

---

## Reliability Examples

### Example 7: System Availability

```
ID: QR-REL-001
Quality: Reliability - Availability
Priority: Critical

Source:    End users
Stimulus:  Access system during business hours
Environment: Production, peak load
Artifact:   Complete system
Response:   Remains operational
Measure:
  - 99.9% uptime during business hours (08:00-18:00 CET)
  - 99.5% uptime outside business hours
  - Planned maintenance < 4 hours/month, announced 7 days ahead
  - MTTR < 30 minutes for critical failures
```

### Example 8: Fault Tolerance

```
ID: QR-REL-002
Quality: Reliability - Fault Tolerance
Priority: High

Source:    Infrastructure
Stimulus:  Primary database node fails
Environment: Production
Artifact:   Database cluster
Response:   Failover to secondary node
Measure:
  - Automatic failover within 10 seconds
  - Zero data loss (synchronous replication)
  - Service degradation < 5% during failover
  - Manual intervention not required
```

### Example 9: Data Recovery

```
ID: QR-REL-003
Quality: Reliability - Recoverability
Priority: High

Source:    Operations team
Stimulus:  Data corruption detected
Environment: Production
Artifact:   Database and file storage
Response:   Restore to consistent state
Measure:
  - RPO (Recovery Point Objective): < 15 minutes data loss
  - RTO (Recovery Time Objective): < 2 hours
  - Backups: Continuous (DB), Daily (files)
  - Restore tested monthly
```

---

## Maintainability Examples

### Example 10: Code Modifiability

```
ID: QR-MAINT-001
Quality: Maintainability - Modifiability
Priority: High

Source:    Development team
Stimulus:  Implements new feature of medium complexity
Environment: Development environment
Artifact:   Codebase
Response:   Allows clean implementation
Measure:
  - New feature requires changes to < 5 existing files
  - No modification to stable core components
  - Backward compatibility maintained
  - Time to implement: < 5 days for medium complexity
```

### Example 11: Test Coverage

```
ID: QR-MAINT-002
Quality: Maintainability - Testability
Priority: High

Source:    CI/CD pipeline
Stimulus:  Runs automated test suite
Environment: Pre-commit and CI
Artifact:   Application code
Response:   Validates functionality
Measure:
  - Code coverage: > 80% for critical paths
  - Unit test execution time: < 5 minutes
  - Integration tests: < 15 minutes
  - Flaky tests: < 1% of total
```

### Example 12: Code Understandability

```
ID: QR-MAINT-003
Quality: Maintainability - Analyzability
Priority: Medium

Source:    New team member
Stimulus:  Needs to understand feature implementation
Environment: Development
Artifact:   Codebase and documentation
Response:   Provides clear understanding
Measure:
  - Architecture Decision Records (ADRs) for major decisions
  - API documentation: 100% of public endpoints
  - Mean time to understand: < 2 hours for module
  - Cyclomatic complexity: < 10 per function
```

---

## Usability Examples

### Example 13: Task Completion Time

```
ID: QR-USE-001
Quality: Interaction Capability - Operability
Priority: High

Source:    End user (first-time)
Stimulus:  Completes core task (e.g., place order)
Environment: Production, mobile app
Artifact:   User interface
Response:   Guides user to completion
Measure:
  - Task completion time: < 3 minutes
  - Error rate: < 5%
  - Abandonment rate: < 10%
  - User satisfaction: > 4.0/5.0
```

### Example 14: Accessibility

```
ID: QR-USE-002
Quality: Interaction Capability - Appropriateness
Priority: High

Source:    User with disabilities
Stimulus:  Accesses application with screen reader
Environment: Production
Artifact:   Web interface
Response:   Fully accessible experience
Measure:
  - WCAG 2.1 AA compliance
  - Keyboard navigation: 100% of features
  - Screen reader compatibility: NVDA, JAWS, VoiceOver
  - Color contrast ratio: > 4.5:1
```

---

## Scalability Examples

### Example 15: Horizontal Scaling

```
ID: QR-SCALE-001
Quality: Flexibility - Scalability
Priority: High

Source:    Load balancer
Stimulus:  Traffic increases beyond current capacity
Environment: Production, peak events
Artifact:   Application tier
Response:   Scales horizontally
Measure:
  - Auto-scaling: < 3 minutes to add instance
  - Supports 10x normal load without manual intervention
  - Linear scaling: 2x instances = 2x capacity
  - No downtime during scaling events
```

### Example 16: Data Growth

```
ID: QR-SCALE-002
Quality: Flexibility - Scalability
Priority: Medium

Source:    Data ingestion pipeline
Stimulus:   Data volume grows 50% year-over-year
Environment: Production
Artifact:   Data storage layer
Response:   Accommodates growth
Measure:
  - Storage scaling: No architectural changes for 3 years
  - Query performance: < 10% degradation at 2x data volume
  - Partitioning strategy supports 10TB+ per table
```

---

## Compatibility Examples

### Example 17: API Compatibility

```
ID: QR-COMP-001
Quality: Compatibility - Interoperability
Priority: High

Source:    External API consumer
Stimulus:  Uses existing API integration
Environment: Production
Artifact:   Public API
Response:   Maintains backward compatibility
Measure:
  - API versioning: URL-based (v1, v2)
  - Deprecated endpoints supported for 12 months
  - Breaking changes announced 6 months ahead
  - OpenAPI specification: 100% coverage
```

---

## Anti-Pattern Examples (What NOT to do)

### ❌ Vague

```
Quality: Performance
Scenario: The system should be fast
```

### ✅ Specific

```
Quality: Performance Efficiency
Source: End user
Stimulus: Submits search query
Environment: Normal load
Artifact: Search service
Response: Returns results
Measure: < 500ms for 95th percentile
```

---

### ❌ Untestable

```
Quality: Usability
Scenario: The system should be user-friendly
```

### ✅ Testable

```
Quality: Interaction Capability
Source: New user
Stimulus: First login attempt
Environment: Production
Artifact: Login flow
Response: Successfully authenticates
Measure: 90% complete on first try within 2 minutes
```

---

### ❌ Implementation-specific

```
Quality: Performance
Scenario: Use Redis cache for all database queries
```

### ✅ Outcome-focused

```
Quality: Performance Efficiency
Source: End user
Stimulus: Requests frequently accessed data
Environment: Normal operation
Artifact: Data retrieval layer
Response: Returns the requested data within the agreed freshness bound
Measure: 95th percentile response time < 200ms under the specified workload;
         returned data is no more than 5 minutes old
```

---

## Template for Your Scenarios

````markdown
### [Your Scenario Title]

```text
ID: QR-XXX-NNN
Quality: [ISO 25010 Characteristic] - [Sub-characteristic]
Priority: [Critical/High/Medium/Low]

Source:    [Who/what triggers]
Stimulus:  [What event occurs]
Environment: [Under what conditions]
Artifact:  [Which system part]
Response:  [How system reacts]
Measure:   [Quantifiable success criteria]
```
````

Copy this template and fill in your specific requirements.
