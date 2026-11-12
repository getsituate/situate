# Quality Scenarios Examples

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Concrete examples of quality scenarios across different domains and quality dimensions.

## Table of Contents

1. [Performance & Efficiency](#performance--efficiency)
2. [Reliability & Availability](#reliability--availability)
3. [Security](#security)
4. [Maintainability](#maintainability)
5. [Usability](#usability)
6. [Flexibility & Changeability](#flexibility--changeability)
7. [Operability](#operability)
8. [Data Quality](#data-quality)
9. [Integration & Interoperability](#integration--interoperability)
10. [Compliance & Governance](#compliance--governance)

---

## Performance & Efficiency

### API Response Time

**Context**: REST API serving mobile and web clients.

**Trigger**: Authenticated user requests data via API.

**Acceptance Criteria**:

- 95% of API requests complete within 200ms
- 99% of API requests complete within 500ms
- Database queries for list endpoints complete within 100ms
- Static assets served from CDN within 50ms

---

### Search Performance

**Context**: E-commerce product search with millions of items.

**Trigger**: User enters search query.

**Acceptance Criteria**:

- First search results appear within 300ms
- Full result set loads progressively without blocking UI
- Search suggestions appear within 100ms of typing
- Facet/filter updates complete within 200ms

---

### Concurrent User Load

**Context**: Ticketing system for high-demand events.

**Trigger**: Ticket sale opens with 50,000 users waiting.

**Acceptance Criteria**:

- System supports 50,000 concurrent users
- Queue system maintains fair ordering
- Payment processing handles 1,000 transactions/minute
- No user session timeouts during 30-minute queue wait

---

### Mobile Battery Efficiency

**Context**: Location-tracking mobile application.

**Trigger**: App runs in background tracking user location.

**Acceptance Criteria**:

- Background location tracking uses < 5% battery per hour
- Foreground operation uses < 2% battery per hour
- Network requests batched to minimize radio usage
- GPS polling frequency adjusts based on movement speed

---

### Batch Processing Throughput

**Context**: Nightly ETL process for data warehouse.

**Trigger**: Scheduled batch job starts at 2 AM.

**Acceptance Criteria**:

- Process 10 million records within 4 hours
- Memory usage stays below 8GB
- Failed records logged for manual review (< 0.1% failure rate)
- Progress reporting every 5 minutes

---

## Reliability & Availability

### System Availability

**Context**: Customer-facing SaaS platform.

**Trigger**: Continuous operation 24/7.

**Acceptance Criteria**:

- 99.9% uptime measured monthly (max 43 minutes downtime)
- Scheduled maintenance windows < 4 hours/month with 7-day notice
- Unplanned downtime incidents < 2 per month
- Status page updates within 5 minutes of incident detection

---

### Graceful Degradation

**Context**: E-commerce checkout with external payment provider.

**Trigger**: Payment service experiences outage.

**Acceptance Criteria**:

- Checkout flow continues with "pay later" option
- Order saved for payment retry within 24 hours
- Customer notified via email with payment link
- Admin alerted within 2 minutes of payment service failure

---

### Data Consistency

**Context**: Distributed inventory system across multiple warehouses.

**Trigger**: Order placed affecting inventory in multiple locations.

**Acceptance Criteria**:

- Inventory counts consistent across all nodes within 5 seconds
- No overselling (negative inventory) under normal operation
- Conflict resolution for simultaneous updates within 10 seconds
- Audit log captures all inventory changes with timestamps

---

### Disaster Recovery

**Context**: Financial trading platform.

**Trigger**: Primary data center becomes unavailable.

**Acceptance Criteria**:

- Failover to secondary site completes within 5 minutes
- Zero data loss for committed transactions
- Trading resumes with read-only mode until full verification
- RTO (Recovery Time Objective): 15 minutes
- RPO (Recovery Point Objective): 0 minutes (zero data loss)

---

### Circuit Breaker Pattern

**Context**: Microservices architecture with external integrations.

**Trigger**: External service becomes slow or unresponsive.

**Acceptance Criteria**:

- Circuit opens after 5 consecutive failures
- Fallback response returned within 100ms when circuit open
- Circuit half-opens after 30 seconds to test recovery
- Health check endpoint reflects circuit state
- Automatic alert when circuit opens

---

## Security

### Authentication

**Context**: Multi-tenant SaaS application.

**Trigger**: User attempts to access protected resource.

**Acceptance Criteria**:

- 100% of API requests authenticated (no anonymous access to protected endpoints)
- JWT tokens expire after 24 hours
- Refresh tokens valid for 30 days with rotation
- Multi-factor authentication enforced for admin roles
- Failed login attempts rate-limited (5 attempts per 15 minutes)

---

### Authorization

**Context**: Healthcare records system with role-based access.

**Trigger**: User attempts to view patient record.

**Acceptance Criteria**:

- Access control checks complete within 50ms
- Users see only records for their assigned patients
- Break-glass access for emergencies logged with justification
- Permission changes effective within 60 seconds
- All access attempts logged with user, timestamp, resource, outcome

---

### Data Encryption

**Context**: Financial services application handling sensitive data.

**Trigger**: Sensitive data stored or transmitted.

**Acceptance Criteria**:

- All PII encrypted at rest using AES-256
- All data in transit uses TLS 1.3
- Encryption keys rotated every 90 days
- Key management separated from application layer
- No sensitive data in application logs

---

### Vulnerability Management

**Context**: Public-facing web application.

**Trigger**: New security vulnerability disclosed or discovered.

**Acceptance Criteria**:

- Critical vulnerabilities patched within 24 hours
- High vulnerabilities patched within 7 days
- Medium vulnerabilities patched within 30 days
- Security scanning runs daily in CI/CD pipeline
- Dependency vulnerabilities checked on every build

---

### Audit Logging

**Context**: Compliance-sensitive enterprise system.

**Trigger**: User performs sensitive action.

**Acceptance Criteria**:

- 100% of data modifications logged
- Audit logs immutable (append-only)
- Logs retained for 7 years
- Log entries include: who, what, when, where, outcome
- Tampering attempts detected and alerted

---

## Maintainability

### Code Understandability

**Context**: Large codebase with rotating team members.

**Trigger**: New developer joins the team.

**Acceptance Criteria**:

- New developer can make first code change within 3 days
- Architecture decision records (ADRs) exist for major decisions
- README files in each module explain purpose and boundaries
- Code review comments address understandability issues
- Cyclomatic complexity < 10 for all functions

---

### Testability

**Context**: Complex business logic requiring comprehensive testing.

**Trigger**: Developer writes or modifies code.

**Acceptance Criteria**:

- Unit test coverage > 80% for business logic
- Integration tests for all external dependencies
- Tests run in CI/CD within 10 minutes
- Flaky tests identified and fixed within 48 hours
- Test data builders available for all domain objects

---

### Bug Fix Cycle Time

**Context**: Production system with frequent bug reports.

**Trigger**: Critical bug reported in production.

**Acceptance Criteria**:

- Bug reproduced in test environment within 4 hours
- Root cause identified within 1 business day
- Fix deployed to production within 3 business days
- Regression test added for all critical bug fixes
- Post-mortem documented for systemic issues

---

### Dependency Management

**Context**: Application with many third-party dependencies.

**Trigger**: Security vulnerability found in dependency.

**Acceptance Criteria**:

- Dependency inventory updated automatically
- Outdated dependencies flagged in CI/CD
- Breaking changes identified before upgrade
- Rollback plan exists for dependency updates
- Automated tests verify functionality after updates

---

### Technical Debt Tracking

**Context**: Long-running project with accumulated technical debt.

**Trigger**: Technical debt item identified during development.

**Acceptance Criteria**:

- Debt items tracked in backlog with estimated effort
- Debt ratio (debt effort / feature effort) < 20%
- Critical debt items addressed within current quarter
- Debt items reviewed in sprint planning
- Architecture fitness functions prevent new debt categories

---

## Usability

### Onboarding Experience

**Context**: SaaS application with trial-to-paid conversion goals.

**Trigger**: New user signs up for trial account.

**Acceptance Criteria**:

- User completes core setup within 5 minutes
- Interactive tutorial guides through first workflow
- Contextual help available on every screen
- Empty states guide users to next actions
- Progress indicator shows setup completion

---

### Task Completion Time

**Context**: CRM system used by sales representatives.

**Trigger**: Sales rep needs to log customer interaction.

**Acceptance Criteria**:

- Log interaction task completes in < 30 seconds
- Common actions accessible within 2 clicks
- Auto-complete reduces data entry by 50%
- Mobile app supports offline task completion
- Power-user keyboard shortcuts documented

---

### Error Handling

**Context**: E-commerce checkout process.

**Trigger**: User encounters error during checkout.

**Acceptance Criteria**:

- Error messages explain what happened in plain language
- Recovery actions clearly suggested
- User input preserved when possible
- Error logged with context for support team
- User can contact support directly from error screen

---

### Accessibility

**Context**: Government service website (WCAG 2.1 AA required).

**Trigger**: User with screen reader accesses application.

**Acceptance Criteria**:

- 100% of functionality accessible via keyboard
- Screen reader announces all dynamic content changes
- Color contrast ratio ≥ 4.5:1 for normal text
- Focus indicators visible on all interactive elements
- Automated accessibility tests pass in CI/CD

---

### Mobile Responsiveness

**Context**: Consumer web application with mobile traffic.

**Trigger**: User accesses site on mobile device.

**Acceptance Criteria**:

- Layout adapts to screen sizes from 320px to 1920px
- Touch targets minimum 44x44 pixels
- Mobile page weight < 1MB
- Time to interactive < 3 seconds on 3G
- No horizontal scrolling required

---

## Flexibility & Changeability

### Feature Addition

**Context**: E-commerce platform with frequent feature releases.

**Trigger**: Product team requests new checkout feature.

**Acceptance Criteria**:

- New feature implemented within 2 sprints
- No changes required to existing checkout flow
- Feature flag allows gradual rollout
- A/B testing framework supports experiment
- Rollback possible within 5 minutes

---

### Configuration Changes

**Context**: Multi-tenant SaaS with tenant-specific settings.

**Trigger**: Customer requests configuration change.

**Acceptance Criteria**:

- Configuration changes apply within 60 seconds
- No deployment required for config changes
- Changes validated before application
- Audit log tracks all configuration changes
- Invalid configurations rejected with clear errors

---

### API Versioning

**Context**: Public API with many consumers.

**Trigger**: Breaking change needed in API.

**Acceptance Criteria**:

- New API version deployed alongside old version
- Deprecation notice provided 6 months in advance
- Migration guide published with examples
- Old version supported for minimum 12 months
- Usage analytics track adoption of new version

---

### Database Schema Evolution

**Context**: Application with zero-downtime deployment requirement.

**Trigger**: Schema change required for new feature.

**Acceptance Criteria**:

- Schema changes deploy without downtime
- Backward-compatible migrations (expand-contract pattern)
- Rollback script tested for every migration
- Data integrity verified after migration
- Migration completes within 5 minutes for tables < 1M rows

---

### Platform Portability

**Context**: Application deployed across cloud providers.

**Trigger**: Need to migrate from AWS to Azure.

**Acceptance Criteria**:

- Application deploys to new provider within 2 weeks
- No code changes required (infrastructure only)
- Containerized deployment using standard tools
- Configuration externalized from code
- Integration tests pass on both platforms

---

## Operability

### Deployment

**Context**: Microservices architecture with frequent deployments.

**Trigger**: Developer merges code to main branch.

**Acceptance Criteria**:

- Deployment to production completes within 15 minutes
- Zero-downtime deployment using rolling updates
- Automated rollback if health checks fail
- Deployment notifications sent to team Slack
- All deployments logged with commit SHA and deployer

---

### Monitoring

**Context**: Distributed system with many components.

**Trigger**: System runs in production.

**Acceptance Criteria**:

- 100% of services have health check endpoints
- Key metrics collected: latency, errors, traffic, saturation
- Dashboards show real-time system health
- Alerting on SLO breaches within 2 minutes
- Runbooks linked from every alert

---

### Log Management

**Context**: High-throughput application generating millions of log entries.

**Trigger**: Developer needs to investigate production issue.

**Acceptance Criteria**:

- Logs searchable within 30 seconds of generation
- Structured logging format (JSON) for all services
- Log retention: 7 days hot, 90 days warm, 1 year cold
- Sensitive data automatically redacted
- Correlation IDs trace requests across services

---

### Backup and Recovery

**Context**: Database with critical business data.

**Trigger**: Data loss incident or recovery test.

**Acceptance Criteria**:

- Automated backups every 4 hours
- Point-in-time recovery possible within 1 hour
- Backup restoration tested monthly
- Recovery time objective (RTO): 4 hours
- Recovery point objective (RPO): 4 hours

---

### Scaling

**Context**: E-commerce platform with seasonal traffic patterns.

**Trigger**: Traffic increases 10x during holiday season.

**Acceptance Criteria**:

- Auto-scaling adds capacity within 3 minutes
- Manual scaling completes within 10 minutes
- Scaling events logged with before/after metrics
- Cost alerts when scaling exceeds budget
- Scale-down happens gradually to avoid thrashing

---

## Data Quality

### Data Accuracy

**Context**: Financial reporting system.

**Trigger**: Monthly financial report generated.

**Acceptance Criteria**:

- Report balances reconcile to 100% accuracy
- Data validation rules catch 99.9% of errors
- Audit trail shows all data transformations
- Source data lineage tracked for every value
- Data quality scorecard published monthly

---

### Data Completeness

**Context**: Customer database for marketing campaigns.

**Trigger**: Marketing team requests customer segment.

**Acceptance Criteria**:

- Customer records 95% complete for required fields
- Missing data flagged for data stewards
- Data enrichment processes run weekly
- Incomplete records excluded from critical processes
- Data completeness trends tracked over time

---

### Data Timeliness

**Context**: Real-time analytics dashboard.

**Trigger**: Business user views dashboard.

**Acceptance Criteria**:

- Dashboard data never more than 5 minutes behind
- Critical metrics updated within 1 minute
- Data freshness indicator visible on dashboard
- Stale data automatically flagged
- Latency SLAs defined per data source

---

### Data Consistency

**Context**: Customer data replicated across multiple systems.

**Trigger**: Customer updates profile information.

**Acceptance Criteria**:

- Profile changes propagate to all systems within 1 minute
- Conflict resolution for simultaneous updates
- Consistency checks run hourly
- Inconsistencies alerted to data team
- Master data management system as source of truth

---

## Integration & Interoperability

### API Integration

**Context**: Integration with third-party payment provider.

**Trigger**: Customer initiates payment.

**Acceptance Criteria**:

- Payment API response within 3 seconds
- Timeout handling with graceful degradation
- Retry logic for transient failures (max 3 attempts)
- Idempotency keys prevent duplicate charges
- Webhook processing acknowledges within 30 seconds

---

### Data Exchange

**Context**: Nightly data sync with partner system.

**Trigger**: Scheduled batch transfer starts.

**Acceptance Criteria**:

- Data transfer completes within 2 hours
- Data validation catches format errors
- Failed records quarantined for manual review
- Checksum verification ensures data integrity
- Partner notified of transfer completion/failure

---

### Protocol Support

**Context**: IoT platform supporting multiple device types.

**Trigger**: New device connects to platform.

**Acceptance Criteria**:

- Support for MQTT, HTTP, and CoAP protocols
- Protocol auto-negotiation during connection
- Message format validation per protocol
- Protocol-specific optimizations applied
- Fallback protocol if primary fails

---

### Legacy Integration

**Context**: Modern system integrating with mainframe.

**Trigger**: Modern app requests legacy data.

**Acceptance Criteria**:

- Anti-corruption layer isolates legacy complexity
- Request translation completes within 500ms
- Legacy system downtime doesn't cascade
- Data mapping documented and versioned
- Integration tested with legacy test environment

---

## Compliance & Governance

These examples are hypothetical control objectives, not legal interpretations. Establish the applicable provisions, scope, exceptions, and reviewed obligations before adopting any retention, deletion, audit, or encryption target.

### Regulatory Compliance

**Context**: Healthcare application (HIPAA compliance required).

**Trigger**: Annual compliance audit.

**Acceptance Criteria**:

- 100% of PHI access logged
- Encryption at rest and in transit verified
- Business associate agreements current
- Risk assessment completed annually
- Staff training records up to date

---

### Data Retention

**Context**: System subject to GDPR requirements.

**Trigger**: Data retention period expires.

**Acceptance Criteria**:

- Automated deletion after retention period
- Deletion confirmation logged
- User deletion requests processed within 30 days
- Data export provided in machine-readable format
- Right to be forgotten implemented across all systems

---

### Audit Support

**Context**: Financial system with SOX requirements.

**Trigger**: External auditor requests evidence.

**Acceptance Criteria**:

- All financial transactions traceable
- Change management records complete
- Access control reviews documented quarterly
- Segregation of duties enforced
- Audit artifacts generated within 1 business day

---

## Using These Examples

### Adaptation Guidelines

When adapting these examples for your system:

1. **Adjust thresholds** to your context (e.g., response time depends on user expectations)
2. **Add context** specific to your domain and stakeholders
3. **Refine triggers** to match your system's actual events
4. **Prioritize** based on stakeholder needs and business impact
5. **Make measurable** - every criterion should be testable

### Template for New Scenarios

```markdown
### [Scenario Name]

**Context**:
[1-3 sentences explaining the system situation and why this matters]

**Trigger**:
[Specific event or condition that initiates this scenario]

**Acceptance Criteria**:

- [Specific, measurable criterion with numeric threshold]
- [Additional criteria...]

**Tags**: #[q42-dimension] #[additional-tags]
```

### Validation Checklist

Before finalizing a scenario:

- [ ] Context explains why this matters
- [ ] Trigger is specific and observable
- [ ] All criteria are measurable
- [ ] Units are specified (ms, %, count, etc.)
- [ ] Thresholds are realistic and testable
- [ ] Q42 tags are appropriate
- [ ] Stakeholders have validated the scenario
