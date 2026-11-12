# Architecture constraints: reference examples

All organizations, policies, budgets, targets, technology selections, and approval records below are synthetic. They illustrate documentation, not Situate commitments, current recommendations, or evidence of legal obligations. Version numbers illustrate specificity; they are not toolchain recommendations.

In a real chapter, replace fictional source descriptions with actual references. Include applicability, approval status, rationale, and the authority who can clarify or change each restriction, using the [supporting detail template](checklists.md#supporting-detail). The compact tables below illustrate category coverage rather than providing complete evidence records.

## Example: e-commerce platform

### 2.1 Technical constraints

| ID   | Constraint                                                       | Rationale and fictional source                                                                   |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TC-1 | Implement backend services in Java 21 LTS.                       | Organization standard; existing expertise and support arrangements.                              |
| TC-2 | Use Spring Boot 3.2+ as the application framework.               | Approved organization-wide framework decision.                                                   |
| TC-3 | Use PostgreSQL 15+ as the primary database.                      | Database policy; central database administration support.                                        |
| TC-4 | Use Redis for approved caching and session-management workloads. | Platform team's caching-layer decision; data eligibility is governed separately.                 |
| TC-5 | Deploy on AWS EKS with the approved multi-region topology.       | Approved cloud strategy and deployment plan.                                                     |
| TC-6 | Describe REST APIs with OpenAPI 3.0.                             | API-first policy supporting generated clients.                                                   |
| TC-7 | Deliver Docker container images as deployment artifacts.         | Approved deployment pipeline contract.                                                           |
| TC-8 | Do not introduce serverless function deployments.                | Architecture board's operational and cost policy; this does not eliminate dependence on AWS EKS. |

### 2.2 Organizational constraints

| ID   | Constraint                                                                      | Rationale and fictional source                                                     |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| OC-1 | Development is distributed across Berlin, London, and Bangalore.                | Approved staffing and support plan.                                                |
| OC-2 | Each squad has at most eight members.                                           | Approved team-size policy; not a universal implication of a “two-pizza team.”      |
| OC-3 | Use Scrum with two-week sprints.                                                | Organization-wide delivery-process decision.                                       |
| OC-4 | Coordinate production releases on a quarterly release train.                    | Integration dependencies with other systems.                                       |
| OC-5 | Do not use external consultants or contractors.                                 | Approved budget and internal knowledge-retention policy.                           |
| OC-6 | Use A/B testing for eligible new features under the approved experiment policy. | Product owner's evidence-gathering process; privacy and safety review still apply. |

### 2.3 Political and governance constraints

| ID   | Constraint                                                            | Rationale and fictional source                                |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| PC-1 | Integrate with the central SAP ERP as the financial system of record. | CFO-approved financial-data ownership decision.               |
| PC-2 | Use the organization-wide Microsoft Entra ID identity provider.       | Enterprise architecture's single sign-on policy.              |
| PC-3 | Do not directly change the legacy warehouse database.                 | Data team's ownership boundary and migration-risk assessment. |
| PC-4 | Integrate only with Stripe and PayPal for payments.                   | Approved payment-provider procurement list.                   |

### 2.4 Legal, regulatory, and contractual constraints

| ID   | Constraint                                                                                                        | Rationale and fictional source                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| LC-1 | Keep the customer records covered by the residency clause in the specified EU regions, including covered backups. | Fictional customer contract, reviewed for its data and location scope. This is not inferred from GDPR.                   |
| LC-2 | Apply the validated PCI DSS assessment scope and required controls to the cardholder-data environment.            | Fictional payment compliance assessment; the relevant validation level and scope require evidence.                       |
| LC-3 | Use only MIT, Apache-2.0, or BSD dependencies without an exception review.                                        | Fictional legal/procurement policy, not a license selection for Situate; specific dependency terms still require review. |
| LC-4 | Retain audit records for the financial transactions and period identified in the approved control record.         | Fictional SOX-related controls assessment; it does not establish a blanket duty for all data or logs.                    |
| LC-5 | Meet 99.95% checkout availability within the contract's measurement window and exclusions.                        | Fictional enterprise customer service-level agreement.                                                                   |

### 2.5 Conventions

| ID   | Convention                                                                               | Rationale and fictional source                                               |
| ---- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| CO-1 | Write architecture documentation in AsciiDoc using arc42.                                | Team documentation standard and version-control workflow.                    |
| CO-2 | Use Conventional Commits for Git commits.                                                | Approved changelog automation and versioning workflow.                       |
| CO-3 | Apply the Google Java Style Guide through the configured formatter.                      | Team code-style standard.                                                    |
| CO-4 | Use semantic versioning for public APIs under the documented compatibility policy.       | API governance decision making breaking changes visible.                     |
| CO-5 | Apply an 80% line-coverage gate to newly added backend code, with documented exclusions. | Fictional CI quality policy; coverage alone does not establish test quality. |
| CO-6 | Name feature branches `feature/TICKET-123-description`.                                  | Project tracking integration convention.                                     |

## Example: iOS mobile application

### 2.1 Technical constraints

| ID   | Constraint                                                                                        | Rationale and fictional source                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TC-1 | Set iOS 16 as the minimum deployment target.                                                      | Approved product compatibility decision based on a fictional audience analysis; no real adoption percentage is asserted. |
| TC-2 | Use Swift 5.9+ within the supported build-toolchain matrix.                                       | Team language decision and toolchain support policy.                                                                     |
| TC-3 | Use SwiftUI for the interface.                                                                    | Approved UI framework decision.                                                                                          |
| TC-4 | Use Core Data for local persistence.                                                              | Approved persistence decision, with possible iCloud integration assessed separately.                                     |
| TC-5 | Use URLSession for network requests; do not add an external HTTP client library without approval. | Dependency and networking policy.                                                                                        |
| TC-6 | Distribute production releases through the Apple App Store only.                                  | Approved distribution strategy; enterprise distribution is out of scope.                                                 |

### 2.2 Organizational constraints

| ID   | Constraint                                                                                     | Rationale and fictional source                                                     |
| ---- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| OC-1 | Staff the application with two iOS developers.                                                 | Approved startup budget.                                                           |
| OC-2 | Manage work through Kanban with a weekly planning and review cadence.                          | Team workflow decision; Kanban does not itself prescribe sprints.                  |
| OC-3 | Plan feature releases every two weeks.                                                         | Product owner's release policy, subject to release qualification and store review. |
| OC-4 | Developers own verification; use TestFlight for beta distribution without a dedicated QA role. | Staffing and testing plan; beta distribution does not replace verification.        |

### 2.3 Political and governance constraints

| ID   | Constraint                                                                            | Rationale and fictional source             |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| PC-1 | Integrate with the existing backend API; changes require the backend team's approval. | API ownership and compatibility agreement. |
| PC-2 | Obtain marketing approval for changes to the shared design system.                    | Corporate identity governance policy.      |

### 2.4 Legal and distribution constraints

| ID   | Constraint                                                                                                                                  | Rationale and fictional source                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LC-1 | Obtain opt-in before enabling the tracking covered by the approved consent assessment; support the applicable personal-data export process. | Fictional reviewed privacy assessment identifying the processing, legal basis, applicable rights, and platform rules. This is not a claim that all tracking has the same consent requirements. |
| LC-2 | Follow the App Store Review Guidelines applicable to the release.                                                                           | Distribution agreement and platform review requirements.                                                                                                                                       |
| LC-3 | Exclude health-data storage from the product scope.                                                                                         | Fictional business risk decision, cross-referenced from product scope; not a claim that storing health data automatically requires medical-device certification.                               |

### 2.5 Conventions

| ID   | Convention                                                                                                       | Rationale and fictional source                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CO-1 | Run SwiftLint using the approved rule configuration.                                                             | Automated style-review convention.                                                                                   |
| CO-2 | Use MVVM for the screens covered by the approved UI architecture decision.                                       | Team's separation and testability convention; not a universal requirement for iOS.                                   |
| CO-3 | Use Swift Testing for eligible unit tests with the approved Xcode/toolchain and deployment-target configuration. | Team test-framework decision; framework availability must be checked rather than inferred from an iOS version label. |
| CO-4 | Give UI-test interaction targets stable accessibility identifiers; review accessibility labels separately.       | UI automation convention; identifiers do not replace accessible names or accessibility testing.                      |

## Example: microservices platform

### 2.1 Technical constraints

| ID   | Constraint                                                                | Rationale and fictional source                                                            |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| TC-1 | Orchestrate containers with Kubernetes.                                   | Platform team's approved runtime decision.                                                |
| TC-2 | Use Istio as the service mesh.                                            | Approved observability and service-security integration.                                  |
| TC-3 | Give each service its own database ownership boundary.                    | Approved data ownership policy; physical isolation requirements are specified separately. |
| TC-4 | Use REST for synchronous calls and events for asynchronous communication. | Approved communication-pattern policy.                                                    |
| TC-5 | Use Kong as the API gateway.                                              | Central API-management decision.                                                          |
| TC-6 | Integrate with Prometheus, Grafana, and Jaeger.                           | Platform observability policy.                                                            |
| TC-7 | Use HashiCorp Vault through the approved credential-delivery interface.   | Fictional platform security policy, not a requirement for Situate scripts.                |

### 2.2 Organizational constraints

| ID   | Constraint                                                                       | Rationale and fictional source                                                            |
| ---- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| OC-1 | Assign no more than eight people to each service team.                           | Approved staffing policy; team-size limits do not follow automatically from Conway's law. |
| OC-2 | Maintain a separate CI/CD pipeline for each service.                             | Approved independent-deployment policy.                                                   |
| OC-3 | Provide an on-call rotation for each service.                                    | Service ownership and support policy.                                                     |
| OC-4 | Do not schedule cross-team deployments on Fridays without an approved exception. | Change-management policy.                                                                 |

### 2.3 Political and governance constraints

| ID   | Constraint                                                                                    | Rationale and fictional source                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-1 | Keep service implementations below 10,000 lines of code unless the CTO approves an exception. | Fictional CTO directive; an arbitrary size threshold does not demonstrate a sound service boundary and should be challenged through review. |
| PC-2 | Register each service in the internal developer portal.                                       | Platform engineering's ownership and discovery policy.                                                                                      |
| PC-3 | Do not access another service's database directly.                                            | Approved data ownership boundary.                                                                                                           |

### 2.4 Legal, contractual, and security-policy constraints

| ID   | Constraint                                                                                                                   | Rationale and fictional source                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| LC-1 | Retain only the audit-record classes listed in the reviewed schedule for seven years; use separate schedules for other logs. | Fictional records-retention assessment with a specific contractual or legal basis. Seven years is not a default requirement for all logs. |
| LC-2 | Exclude personal data from standard application logs, using the approved field allowlist.                                    | Fictional privacy and security policy; GDPR is not a blanket ban on all logging of personal data.                                         |
| LC-3 | Use TLS 1.3 on the covered links and the approved encryption configuration for covered stored data.                          | Fictional security policy with defined scope and exceptions; this exact protocol version is not inferred from a generic legal label.      |

### 2.5 Conventions

| ID   | Convention                                                                   | Rationale and fictional source                                                           |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CO-1 | Follow the 12-factor application practices adopted in the platform standard. | Approved deployment and configuration conventions; applicable exceptions are documented. |
| CO-2 | Define APIs in OpenAPI before implementation.                                | Contract-first development convention.                                                   |
| CO-3 | Use semantic versioning for service APIs under the compatibility policy.     | Breaking-change communication convention.                                                |
| CO-4 | Expose `/health/live` and `/health/ready` for the configured probes.         | Fictional platform endpoint convention; Kubernetes does not mandate these paths.         |

## Contrasting contexts: small team and enterprise

### Startup with a small set of restrictions

| ID   | Constraint                                                         | Rationale and fictional source                                                                                                  |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| TC-1 | Use Kotlin, Spring Boot, and PostgreSQL for the initial service.   | Approved stack decision based on existing team expertise; split into separate records if ownership or review conditions differ. |
| TC-2 | Deploy on Hetzner Cloud within a USD 200 monthly hosting budget.   | Approved provider selection and budget; no general privacy-compliance guarantee is implied.                                     |
| OC-1 | Deliver with three developers; no additional hiring in this phase. | Seed-stage staffing budget.                                                                                                     |
| OC-2 | Deliver the agreed MVP scope within three months.                  | Approved runway and delivery plan; negotiate scope through the requirements workflow if infeasible.                             |

### Enterprise with multiple owners

| ID   | Constraint                                                                                          | Rationale and fictional source                                           |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TC-1 | Use Java 17 LTS as the only JVM language.                                                           | Enterprise architecture board's approved standard.                       |
| TC-2 | Use Oracle Database for covered business persistence.                                               | Central database administration policy.                                  |
| TC-3 | Deploy only through the internal OpenShift platform.                                                | Approved hosting strategy.                                               |
| TC-4 | Route external APIs through the central API gateway.                                                | Security architecture policy.                                            |
| OC-1 | Coordinate delivery across sites in Germany, the United States, India, and Poland.                  | Approved staffing model.                                                 |
| OC-2 | Use two-week sprints and quarterly coordinated releases.                                            | Release-train policy.                                                    |
| OC-3 | Obtain security review before adding external libraries.                                            | Information-security dependency policy.                                  |
| PC-1 | Keep SAP as the financial system of record.                                                         | CFO-approved ownership decision.                                         |
| PC-2 | Do not change the existing CRM without its owner's approval.                                        | Sales system ownership agreement.                                        |
| LC-1 | Apply the privacy and financial controls identified in the reviewed GDPR/SOX applicability records. | Fictional legal and compliance assessment specifying actual obligations. |
| LC-2 | Obtain legal review before adopting open-source components.                                         | Intellectual-property review policy; no license is selected here.        |

The difference is ownership and applicability, not a required number of entries. Neither a short list nor a long list is evidence of completeness by itself.

## Worked conflict: performance and a contractual caching restriction

### Scenario

A fictional API has these inputs:

- **QR-1, quality requirement:** p99 response time below 200 ms under the specified test workload.
- **LC-1, contractual restriction:** specified customer personal data must not be stored in application caches, as defined by the contract's covered fields and storage systems.
- **TC-2, approved integration restriction:** aggregate data from five specified services.

The fictional baseline test exceeds 200 ms. GDPR does not itself establish LC-1. Before using the scenario in a real system, verify the actual contract clause, interpretation, data scope, and measurements.

### Analysis and options

1. **Classify data and storage.** Identify covered personal data, other data, derived aggregates, read models, logs, replicas, and caches. Removing names does not prove anonymity. A durable read model must not be used to evade a restriction whose scope also covers that storage.
2. **Optimize within the restrictions.** Evaluate parallel service calls, query/index tuning, smaller payloads, and caching only data outside LC-1's scope. GraphQL may help select fields but does not by itself solve latency or compliance.
3. **Assess read models.** A CQRS design can separate read and write models, but introduces additional storage, update propagation, and possible eventual consistency. Verify that the proposed data is permitted and that query patterns actually benefit.
4. **Request changes where needed.** A shorter cache time to live is not compliant with an unchanged prohibition. Ask the contract owner whether an amendment is possible. Alternatively, seek approval to change QR-1 or the integration requirement through the appropriate workflow.
5. **Record the approved outcome.** Do not present an option or an unmeasured estimate as a solution. Keep remaining risk and performance verification visible.

### Synthetic resolution and ADR

Suppose the fictional contract review confirms that a product-catalog-only read model is outside the covered data scope. The product owner approves a separate 300 ms p99 target for requests that still aggregate covered personal data. A 150 ms p99 target is adopted for the catalog path. These are fictional approved targets, not measured results or recommended defaults.

```asciidoc
=== ADR-042: Read models under a contractual caching restriction

Status:: Accepted in this fictional scenario

==== Context

* QR-1 originally required p99 API response time below 200 ms under the agreed workload.
* LC-1 prohibits application caching of the customer personal data listed in the reviewed contract record.
* TC-2 requires integration with five services.
* The baseline workload exceeds the original response-time target.
* The contract reviewer confirmed the proposed product-catalog model is outside LC-1's covered data scope.
* The product owner approved separate catalog and personal-data response-time targets through the requirements workflow.

==== Decision

Use separate read and write models for the product-catalog path.
The read model contains only the reviewed catalog fields permitted by LC-1.
Do not cache the covered personal data; optimize its service calls separately.
Keep personal-data validation in the relevant write path; CQRS alone does not establish its correctness.
Link the contract review, approved target changes, and data-field specification.

==== Consequences

* Positive: The catalog path can use pre-aggregated data without storing fields covered by LC-1.
* Positive: Revised targets distinguish the catalog path from personal-data aggregation.
* Negative: Additional model maintenance and operational complexity.
* Negative: Catalog updates may be eventually consistent; define acceptable lag and behavior.
* Pending verification: Measure p99 latency, data eligibility, and update behavior under the agreed workloads.
* Review trigger: Changes to contract scope, data fields, service dependencies, or target workloads.
```

The ADR does not claim a percentage of requests now meets the target or that the whole system is legally compliant. Those conclusions require their own evidence.

## ID conventions

Preserve existing stable IDs. The following schemes are options for new records, not a requirement to rename established records.

### Category prefixes

| Prefix | Meaning                            | Example    |
| ------ | ---------------------------------- | ---------- |
| TC-XX  | Technical constraint               | TC-1, TC-2 |
| OC-XX  | Organizational constraint          | OC-1, OC-2 |
| PC-XX  | Political or governance constraint | PC-1, PC-2 |
| LC-XX  | Legal or contractual constraint    | LC-1, LC-2 |
| CO-XX  | Convention                         | CO-1, CO-2 |

### Domain-qualified IDs

These can help when multiple domains maintain separate constraint sets.

| Prefix       | Meaning                       | Example     |
| ------------ | ----------------------------- | ----------- |
| TC-PLAT-XX   | Platform technical constraint | TC-PLAT-1   |
| TC-FE-XX     | Frontend technical constraint | TC-FE-1     |
| TC-BE-XX     | Backend technical constraint  | TC-BE-1     |
| OC-GLOBAL-XX | Organization-wide constraint  | OC-GLOBAL-1 |

## Common documentation errors

### Unnecessary version precision

**Weak:** “Use PostgreSQL 14.2 with PostGIS 3.2.1,” without a source for those exact versions.

**Better:** “Use PostgreSQL 14+ with the PostGIS extension for the covered geospatial data,” if that is the approved compatibility range. Link the supported version matrix. Preserve exact pins when reproducibility, support, or security policy actually requires them; do not broaden an approved restriction merely to simplify prose.

### Vague technology preferences

**Weak:** “Use modern technologies.”

**Better:** “Use Spring Boot 3.x with Java 21 for the covered backend services, as required by the approved platform standard.” A concrete technology selection without an approved source remains a proposal, not a constraint.

### Several independent restrictions in one entry

**Weak:** “Use Java, Spring Boot, PostgreSQL, and AWS.”

**Better:** Split entries when they have distinct sources, scope, or change authorities:

```text
TC-1: Java 21 for backend services; source: language standard.
TC-2: Spring Boot 3.2+; source: application framework decision.
TC-3: PostgreSQL 15+; source: database support policy.
TC-4: AWS hosting; source: approved cloud strategy.
```

### Missing rationale or evidence

**Weak:** `| TC-1 | Java 21 | |`

**Better:** `| TC-1 | Java 21 for backend services | Approved platform standard; LTS support and team expertise; link decision and owner. |`

### Unsupported compliance claims

**Weak:** “GDPR requires all personal data to stay in the EU and forbids caching.”

**Better:** Record the reviewed obligation for the actual processing. If a customer contract requires EU-region storage or prohibits specified caches, identify that clause, scope, and owner separately from GDPR. Do not invent a legal source when no evidence is available.
