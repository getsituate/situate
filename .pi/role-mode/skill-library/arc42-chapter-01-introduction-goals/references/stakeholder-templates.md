# Stakeholder Templates

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Use these tables for stakeholder discovery across common project types. In public documentation, replace the contact column with a public team or role reference and keep personal contacts and influence assessments private. The role lists do not expand Situate's supported platforms or product scope.

## Table of Contents

1. [Web Application (SaaS)](#web-application-saas)
2. [Mobile Application](#mobile-application)
3. [Enterprise System](#enterprise-system)
4. [API/Backend Service](#apibackend-service)
5. [Microservices Architecture](#microservices-architecture)
6. [Legacy Modernization](#legacy-modernization)
7. [Open Source Project](#open-source-project)

---

## Web Application (SaaS)

Typical for: Customer-facing SaaS platforms, B2B web applications

| Role                    | Contact        | Expectation                                                                        |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------- |
| Product Owner           | [Name]         | Architecture enables 2-week release cycles; supports A/B testing and feature flags |
| Lead Developer          | [Name]         | Clean component structure, RESTful API design, comprehensive testability           |
| Frontend Developer      | [Name]         | Responsive design system, component library, state management patterns             |
| DevOps Engineer         | [Name]         | Container orchestration, automated deployment, monitoring integration              |
| QA Lead                 | [Name]         | E2E test automation, performance test environment, bug reproduction support        |
| UX Designer             | [Name]         | Design system implementation, accessibility support, performance budget            |
| Security Officer        | [Name]         | OWASP compliance, security scanning, incident response procedures                  |
| Customer Success        | [Name]         | Admin dashboard for customer management, analytics for usage patterns              |
| End User Representative | Customer Panel | Fast load times, intuitive navigation, mobile-responsive, accessible               |
| Compliance Officer      | [Name]         | GDPR/privacy compliance, data retention policies, audit capabilities               |

**Additional Considerations**:

- Distinguish between internal users (admins) and external users (customers)
- Consider different customer tiers (free vs. paid, small vs. enterprise)
- Include marketing team if SEO/analytics requirements exist

---

## Mobile Application

Typical for: iOS/Android consumer apps, B2B mobile solutions

| Role                    | Contact      | Expectation                                                                   |
| ----------------------- | ------------ | ----------------------------------------------------------------------------- |
| Product Manager         | [Name]       | Architecture supports iOS and Android with shared business logic              |
| Mobile Lead (iOS)       | [Name]       | Swift/SwiftUI patterns, iOS HIG compliance, App Store requirements            |
| Mobile Lead (Android)   | [Name]       | Kotlin/Jetpack patterns, Material Design, Play Store requirements             |
| Backend Developer       | [Name]       | Mobile-optimized APIs, offline sync support, push notification infrastructure |
| UX Designer             | [Name]       | Platform-specific UX patterns, gesture support, accessibility                 |
| QA Engineer             | [Name]       | Device farm testing, automated UI tests, beta distribution                    |
| DevOps Engineer         | [Name]       | CI/CD for mobile builds, code signing management, OTA updates                 |
| Security Officer        | [Name]       | Certificate pinning, secure storage, biometric auth support                   |
| End User Representative | Beta Testers | Fast launch time, offline functionality, battery efficiency                   |
| App Store Reviewer      | Apple/Google | Guidelines compliance, privacy permissions, content policies                  |

**Additional Considerations**:

- Platform-specific requirements (iOS vs Android)
- Offline/online synchronization needs
- App store approval processes
- Device fragmentation challenges

---

## Enterprise System

Typical for: Internal business systems, ERP, CRM, workflow platforms

| Role                   | Contact          | Expectation                                                             |
| ---------------------- | ---------------- | ----------------------------------------------------------------------- |
| Business Owner         | [Name]           | ROI justification, alignment with business strategy, scalability        |
| Enterprise Architect   | [Name]           | Integration with existing systems, technology standards compliance      |
| Department Head        | [Name]           | User adoption support, training documentation, change management        |
| Lead Developer         | [Name]           | Maintainable code, integration patterns, legacy system connectivity     |
| Database Administrator | [Name]           | Data modeling, query performance, backup/recovery procedures            |
| Security Team          | [Name]           | SSO/LDAP integration, role-based access, compliance (SOX, HIPAA)        |
| IT Operations          | [Name]           | Monitoring, alerting, runbooks, disaster recovery                       |
| Compliance Officer     | [Name]           | Audit trails, regulatory compliance, data governance                    |
| End Users              | Department Staff | Integration with daily workflow, minimal training required, reliability |
| Vendor Management      | [Name]           | License tracking, vendor support, contract compliance                   |

**Additional Considerations**:

- Integration with legacy systems (mainframes, old databases)
- Strict compliance requirements (SOX, HIPAA, GDPR)
- Change management and user training
- Long-term maintenance and support contracts

---

## API/Backend Service

Typical for: REST/GraphQL APIs, microservices backends, integration platforms

| Role                    | Contact     | Expectation                                                     |
| ----------------------- | ----------- | --------------------------------------------------------------- |
| API Product Manager     | [Name]      | API versioning strategy, developer portal, usage analytics      |
| Lead Backend Developer  | [Name]      | Clean API design, comprehensive documentation, test coverage    |
| API Consumer (Internal) | [Name]      | Clear documentation, SDKs/client libraries, sandbox environment |
| API Consumer (External) | Partner Dev | Stable contracts, changelog, deprecation policies, rate limits  |
| DevOps Engineer         | [Name]      | Containerization, auto-scaling, API gateway configuration       |
| QA Engineer             | [Name]      | Contract testing, load testing, error scenario coverage         |
| Security Officer        | [Name]      | Authentication/authorization, API security, threat protection   |
| Platform Engineer       | [Name]      | Service mesh, observability, circuit breaker patterns           |
| Documentation Writer    | [Name]      | OpenAPI/Swagger specs, code examples, quickstart guides         |
| Performance Engineer    | [Name]      | Latency budgets, throughput requirements, caching strategy      |

**Additional Considerations**:

- Internal vs external API consumers
- API versioning and backward compatibility
- Developer experience (documentation, SDKs)
- Rate limiting and quota management

---

## Microservices Architecture

Typical for: Distributed systems, cloud-native applications

| Role                   | Contact | Expectation                                                           |
| ---------------------- | ------- | --------------------------------------------------------------------- |
| System Architect       | [Name]  | Service boundaries, inter-service communication, data ownership       |
| Tech Lead (Service A)  | [Name]  | Service autonomy, clear API contracts, independent deployment         |
| Tech Lead (Service B)  | [Name]  | Service autonomy, event-driven patterns, database per service         |
| Platform Engineer      | [Name]  | Kubernetes, service mesh, observability stack, GitOps                 |
| DevOps Engineer        | [Name]  | CI/CD pipelines, environment parity, feature flags                    |
| SRE (Site Reliability) | [Name]  | SLAs/SLOs, error budgets, on-call procedures, chaos engineering       |
| Data Architect         | [Name]  | Data consistency patterns, event sourcing, CQRS where appropriate     |
| Security Engineer      | [Name]  | Zero-trust architecture, mTLS, secrets management, policy enforcement |
| QA Lead                | [Name]  | Contract testing, integration testing strategy, test data management  |
| Product Owner          | [Name]  | Feature decomposition across services, release coordination           |

**Additional Considerations**:

- Service ownership and team autonomy
- Distributed tracing and observability
- Data consistency across services
- Testing strategies for distributed systems

---

## Legacy Modernization

Typical for: Replacing or refactoring legacy systems

| Role                    | Contact    | Expectation                                                       |
| ----------------------- | ---------- | ----------------------------------------------------------------- |
| Business Stakeholder    | [Name]     | Feature parity, minimized disruption, ROI within 2 years          |
| Legacy System Expert    | [Name]     | Complete knowledge transfer, documentation of business rules      |
| Modernization Architect | [Name]     | Strangler fig pattern, incremental migration, rollback capability |
| Integration Specialist  | [Name]     | Anti-corruption layers, adapter patterns, data synchronization    |
| Data Migration Engineer | [Name]     | Data cleansing, ETL processes, validation, rollback procedures    |
| QA Lead                 | [Name]     | Regression testing, parallel running, data validation             |
| Change Manager          | [Name]     | User training, communication plan, support transition             |
| Compliance Officer      | [Name]     | Audit continuity, data retention, regulatory approval             |
| Operations Team         | [Name]     | Parallel operation support, monitoring both systems, runbooks     |
| End Users               | User Group | Minimal retraining, performance improvement, no data loss         |

**Additional Considerations**:

- Risk management and rollback strategies
- Knowledge transfer from legacy experts
- Parallel operation during transition
- Data migration validation

---

## Open Source Project

Typical for: Public libraries, frameworks, tools

| Role                  | Contact              | Expectation                                                             |
| --------------------- | -------------------- | ----------------------------------------------------------------------- |
| Project Maintainer    | [Name]               | Clear contribution guidelines, code review process, release management  |
| Core Contributor      | [Name]               | Architecture decision records, technical roadmap, API stability         |
| Community Contributor | GitHub Contributors  | Good first issues, documentation, welcoming community                   |
| Library Consumer      | [Name]               | Stable API, semantic versioning, upgrade guides, backward compatibility |
| Documentation Lead    | [Name]               | API docs, tutorials, examples, changelog                                |
| Security Reporter     | Security Researchers | Security policy, responsible disclosure, CVE handling                   |
| CI/CD Maintainer      | [Name]               | Automated testing, release automation, multi-platform builds            |
| Trademark/Legal       | [Name]               | License compliance, CLA, trademark guidelines                           |
| Downstream Maintainer | Distro Packagers     | Stable releases, build reproducibility, dependency management           |
| End User              | Developer Community  | Clear README, quickstart, troubleshooting guides                        |

**Additional Considerations**:

- Community building and governance
- Contributor license agreements (CLA)
- Long-term maintenance commitment
- Security disclosure policies

---

## Quick Stakeholder Discovery Questions

Use these questions to identify stakeholders you might have missed:

### Technical Stakeholders

- Who deploys this system to production?
- Who monitors it once it's running?
- Who investigates when alerts fire at 3 AM?
- Who maintains the CI/CD pipeline?
- Who reviews pull requests?
- Who tests this system?
- Who handles security incidents?

### Business Stakeholders

- Who pays for this system?
- Who decides if the project succeeds or fails?
- Who will use this system daily?
- Who trains users on this system?
- Who supports users when they have problems?
- Who ensures compliance with regulations?

### External Stakeholders

- Are there third-party integrators?
- Are there customers/end users?
- Are there auditors or regulators?
- Are there partners who depend on this?
- Are there vendors/suppliers?

---

## Stakeholder Classification Template

After identifying stakeholders, classify them by interest and influence:

```
STAKEHOLDER CLASSIFICATION MATRIX

High Interest          Low Interest
┌────────────────────┬────────────────────┐
│ HIGH IMPACT         │ HIGH IMPACT         │
│ • [Stakeholder 1]   │ • [Stakeholder 4]   │
│ • [Stakeholder 2]   │                     │
│   Strategy: Manage  │   Strategy: Keep    │
│   closely, satisfy  │   satisfied         │
├────────────────────┼────────────────────┤
│ LOW IMPACT          │ LOW IMPACT          │
│ • [Stakeholder 3]   │ • [Stakeholder 5]   │
│                     │                     │
│   Strategy: Keep    │   Strategy: Monitor │
│   informed, involve │                     │
└────────────────────┴────────────────────┘
```

**Classification Guidelines**:

- **High Impact + High Interest**: Project sponsor, key customers, lead architect
- **High Impact + Low Interest**: Executives, compliance officers, security team
- **Low Impact + High Interest**: Enthusiastic users, junior developers, QA team
- **Low Impact + Low Interest**: Peripheral vendors, occasional users

---

## Stakeholder Table Maintenance

**When to Update**:

- New team members join
- Organization restructuring
- New compliance requirements
- Project phase changes (dev → ops)
- Major architectural decisions

**Keep Current**:

- Contact information (especially after reorgs)
- Roles and responsibilities
- Expectations (they evolve)
- Classification matrix

**Red Flags**:

- Stakeholder table not updated in 6+ months
- Key stakeholders missing (no devops, no security)
- Generic expectations ("wants good system")
- No contact information provided
