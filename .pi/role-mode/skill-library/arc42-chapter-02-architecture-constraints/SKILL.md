---
name: arc42-chapter-02-architecture-constraints
description: Identify and document architecture constraints in arc42 chapter 2, with sources, rationale, and scope distinct from proposed design choices. Includes categories, templates, discovery and review checklists, stakeholder interviews, examples, and conflict analysis.
---

# Architecture constraints

Use this skill to identify, categorize, review, or document restrictions on architecture and delivery choices in arc42 chapter 2.

## Situate responsibilities and safeguards

Inspect `requirements/data/foundations.md` and relevant decisions. Reference existing constraints rather than creating parallel rules. Document a restriction only when it affects available design or delivery choices.

For each restriction, record its meaning, source, applicability, rationale, and who can clarify or change it. Distinguish external obligations, approved organizational choices, and unverified assumptions. A preferred technology is not automatically mandatory.

The CEO clarifies commercial, budget, organizational, and legal boundaries. The CTO clarifies technical and operational restrictions and their consequences. Legal claims require specific evidence and appropriate expert review; do not infer data-residency or licensing obligations from broad labels.

Expose conflicting restrictions and their effects before proposing a resolution. Do not relax approved constraints silently. Keep unresolved proposals visibly separate, and update the requirements catalog only through its established workflow. Check links and consistency with chapters 3, 4, and 9.

## Definition and boundaries

A constraint limits the architect's freedom to choose a design, implementation, or development process. It may apply to one system or to a whole organization. Some constraints are negotiable, but they remain binding within their approved scope until the responsible authority changes them.

| Aspect              | Requirement                                      | Constraint                                      | Architecture decision                |
| ------------------- | ------------------------------------------------ | ----------------------------------------------- | ------------------------------------ |
| Question            | What outcome must the system provide?            | Which choices are restricted?                   | Which solution do we choose?         |
| Example             | Respond in under one second                      | Use Java for backend services                   | Use Redis for caching                |
| Effect              | Defines a result to achieve                      | Narrows the solution space                      | Selects a solution within that space |
| Main arc42 location | Chapter 1 overview; chapter 10 quality scenarios | Chapter 2                                       | Chapters 4 and 9                     |
| Change              | Through requirements approval                    | Through the authority that owns the restriction | Through decision review              |

Constraints are a kind of requirement; this distinction helps organize the documentation rather than defining mutually exclusive classes. A performance target is normally a quality requirement, not a technology restriction. An approved organization-wide technology decision can constrain a project; a technology proposed by the project is not yet an external constraint. Cross-reference the governing decision instead of duplicating its rule.

## Categories to investigate

These categories guide discovery, not a quota. Use the categories that help readers find applicable restrictions; do not invent constraints to fill a section. All example policies and numbers in this skill and its references are synthetic, not Situate commitments or recommended defaults.

### Technical constraints

| Area                        | Example restrictions to investigate                                         |
| --------------------------- | --------------------------------------------------------------------------- |
| Hardware and infrastructure | Own data center; memory, CPU, storage, or network limits                    |
| Software                    | Required database or message broker, such as PostgreSQL or RabbitMQ         |
| Operating systems           | A required host or client operating system                                  |
| Programming languages       | Approved backend or frontend languages                                      |
| Frameworks and libraries    | Required framework version; restrictions on external UI libraries           |
| Interfaces                  | Required protocols, data formats, or OpenAPI specification version          |
| Hosting                     | Approved cloud providers; on-premises or hybrid deployment; location policy |

### Organizational constraints

| Area                     | Example restrictions to investigate                                        |
| ------------------------ | -------------------------------------------------------------------------- |
| Organization             | Distributed sites; team size or required roles                             |
| Resources                | Budget ceiling; delivery deadline; hiring or contractor limits             |
| Organizational standards | Applicable certification scope; approved workflow or task-management tools |
| Development process      | Scrum cadence, Kanban policies, release and change-management processes    |
| Knowledge management     | Required documentation tools and formats                                   |

### Political and governance constraints

Use this category for authority, stakeholder, and organizational dependencies. Describe the restriction neutrally rather than attributing motives.

| Area                  | Example restrictions to investigate                           |
| --------------------- | ------------------------------------------------------------- |
| Leadership decisions  | Approved migration strategy or architecture mandate           |
| Stakeholder interests | Required consultation; changes reserved to another department |
| Group-wide rules      | Shared identity provider or central logging infrastructure    |
| Approval hierarchy    | Who authorizes investment, licenses, or exceptions            |
| System ownership      | An existing system of record that the project cannot replace  |

### Legal, regulatory, and contractual constraints

Identify the applicable provision, jurisdiction, affected data or activity, scope, and reviewed interpretation. A legal label alone is not an implementable restriction.

| Area                                | Questions to resolve                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy                             | Which GDPR, Swiss data-protection law, or other provisions apply to this processing?                                                   |
| Sector obligations                  | Do HIPAA, SOX, or PCI DSS apply, and to which actors, systems, or transactions? PCI DSS is an industry standard, not itself a statute. |
| Licensing and intellectual property | Which license terms, procurement policies, or review requirements restrict reuse?                                                      |
| Export controls                     | Which products, destinations, recipients, and rules are in scope? Do not invent a universal cryptographic key-size limit.              |
| Contracts                           | Which availability, support, confidentiality, or liability terms affect architecture?                                                  |

GDPR does not automatically require EU-only storage or prohibit caching personal data. A residency rule or caching restriction needs its own evidenced basis, such as an applicable provision, contract, or approved policy. A short cache lifetime does not by itself establish compliance. Likewise, storing health data does not automatically require medical-device certification; assess the intended use and applicable rules with qualified reviewers.

### Conventions

| Area          | Example restrictions to investigate                                       |
| ------------- | ------------------------------------------------------------------------- |
| Code          | Approved style guides and review conventions                              |
| Documentation | Architecture format and API documentation standards                       |
| Naming        | Package, branch, class, or identifier conventions                         |
| Versioning    | API versioning, release tags, and commit-message conventions              |
| Testing       | Approved test standards or coverage gates, with their scope and rationale |

A convention belongs here only if it materially affects architecture or delivery. Link routine guidance maintained elsewhere.

## Discovery and documentation workflow

1. Read the existing foundations, catalog entries, policies, contracts, and relevant decisions. Identify their scope and status before interviewing stakeholders.
2. Use the [discovery checklist and stakeholder interviews](references/checklists.md) to uncover restrictions that may otherwise remain implicit. Ask who owns each restriction and what evidence supports it.
3. Separate confirmed obligations and approved choices from preferences, proposals, and unverified assumptions. Keep unanswered questions visible with an owner for clarification.
4. Record each relevant constraint once, using a stable ID, a precise restriction, its source and rationale, applicability, and change authority. Link the source of truth when one already exists.
5. Identify conflicts and their effects on feasible solutions. Obtain a decision from the responsible authority rather than silently choosing which restriction to ignore.
6. Review validity when policies, technology, contracts, organization, or scope change. Record review dates or triggers where useful; not every constraint has an expiry date.
7. Check cross-references and consistency with context and scope (chapter 3), solution strategy (chapter 4), and decisions (chapter 9).

Document as many relevant constraints as the system needs. Prioritize by architectural impact and group related entries for readability; do not impose a minimum or maximum number per category.

## Documentation structure

Use sections for technical, organizational, governance, legal/contractual, and convention constraints where applicable. Keep confirmed entries distinct from unresolved candidates.

A compact table can link to the supporting detail:

```asciidoc
== 2. Architecture Constraints

=== 2.1 Technical Constraints

[cols="1,3,2", options="header"]
|===
| ID | Constraint | Rationale and source

| TC-1
| Backend services use Kotlin 1.9+ on JVM 21.
| Approved fictional organization stack; link the decision and applicability record.

| TC-2
| PostgreSQL 15+ is the primary database.
| Fictional database policy; the central database team maintains it.
|===
```

For each entry, include or link:

- Meaning and affected design or delivery choices.
- Applicable components, environments, data, jurisdictions, and time period.
- Evidence, source, approval status, and rationale.
- Owner or authority who can clarify, approve exceptions, or change it.
- Negotiability, exception conditions, and review trigger where known.

Use the [table and conflict templates](references/checklists.md) for fuller records. See [synthetic worked examples](references/examples.md) for e-commerce, iOS, microservices, small-team and enterprise contexts, ID schemes, and common documentation errors. Copy only structure that fits the actual evidence, not the example policies.

## Conflicting restrictions

A quality target can conflict with a constraint even though it is not itself a chapter 2 restriction. For example, a fictional API has a 500 ms response target, must aggregate three services, and is subject to a contract prohibiting storage of specified personal data in caches.

1. Verify the target, contract clause, scope, and evidence of the performance problem. Do not relabel the caching policy as a blanket GDPR rule.
2. Document each restriction and why they appear incompatible. Distinguish demonstrated conflicts from untested concerns.
3. Compare feasible options: parallel calls, query/index tuning, pre-aggregation of permitted data, or a request to revise the target or contract. Pre-aggregation can also create stored personal data and needs review.
4. Assess security, privacy, cost, complexity, and consistency consequences. A shorter time to live is an option only if the governing restriction permits it or its owner approves a change.
5. Escalate unresolved trade-offs to the relevant authority. Management cannot waive an applicable legal obligation. A negotiable organizational preference is not equivalent to law.
6. Record the approved decision and remaining limitations. Cross-reference an ADR when the resolution is an architectural choice; use the established requirements workflow for target changes.

## Review and anti-patterns

- **Unfiltered inventories:** Include restrictions that affect choices, not every team habit. Prioritize without dropping relevant obligations to meet a quota.
- **Missing rationale:** Replace “we must use Java” with the approved version/scope, source, owner, and reason.
- **Requirements presented as constraints:** Put “the system must scale” in quality goals or measurable scenarios; record a mandatory deployment platform as a constraint only if approved.
- **Implicit rules:** Record relevant restrictions even if long-standing team members consider them obvious.
- **Immutable-by-default assumptions:** State who can change a constraint and under what conditions. Do not relax it without approval.
- **Unsupported legal conclusions:** Cite the applicable basis and reviewed interpretation. Synthetic examples are not evidence.
- **False resolution:** Do not mark a conflict solved merely because an option exists. Capture approval, verification, and unresolved consequences.

Finish with the [review checklist](references/checklists.md). Confirm specificity, evidence, applicability, current validity, ownership, conflict status, and working links.
