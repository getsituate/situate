# Architecture constraints: checklists and templates

Use these prompts to discover relevant restrictions, not to manufacture a fixed number of constraints. Record evidence and unresolved questions. Example technologies, numbers, and policies are synthetic and do not establish Situate commitments.

## Discovery checklist

### Technical constraints

#### Hardware and infrastructure

- [ ] Is hosting prescribed: on-premises, cloud, or hybrid?
- [ ] Are particular cloud providers required or prohibited?
- [ ] Are there memory, CPU, storage, or capacity limits?
- [ ] Are server locations restricted? What policy, contract, or applicable provision establishes the scope?
- [ ] Are firewall, VPN, connectivity, or other network restrictions relevant?

#### Software and technologies

- [ ] Are programming languages mandatory?
- [ ] Are frameworks or libraries required or restricted?
- [ ] Are database technologies prescribed?
- [ ] Are message brokers or caching mechanisms prescribed?
- [ ] Are particular operating systems required?

#### Interfaces and protocols

- [ ] Are API protocols prescribed, such as REST, GraphQL, or gRPC?
- [ ] Are data formats prescribed, such as JSON, XML, or Protobuf?
- [ ] Are authentication protocols prescribed, such as OAuth 2.0 or SAML?
- [ ] Are integration patterns or compatibility requirements mandatory?

### Organizational constraints

#### Resources

- [ ] Are budgets capped, and which costs do those caps include?
- [ ] Are deadlines or time-to-market targets fixed?
- [ ] Is team size or composition restricted?
- [ ] Are particular roles required, such as architecture or quality assurance?

#### Processes and methods

- [ ] Is a development method prescribed, such as Scrum, Kanban, or SAFe?
- [ ] Is a release cadence required?
- [ ] Are change-management and approval processes defined?
- [ ] Are on-call or support duties required?

#### Tools and infrastructure

- [ ] Are development tools, including IDEs, prescribed?
- [ ] Are CI/CD tools or delivery pipelines prescribed?
- [ ] Are documentation tools prescribed?
- [ ] Are project-management tools prescribed?

### Political and governance constraints

#### Decisions and authority

- [ ] Are there approved management or executive decisions affecting the project?
- [ ] Are there enterprise architecture mandates?
- [ ] Which stakeholders must be consulted or approve changes?
- [ ] Which dependencies are owned by other departments?

#### Strategy and standards

- [ ] Are organization-wide architecture standards binding?
- [ ] Are particular systems designated as systems of record?
- [ ] Are there buy-versus-build rules?
- [ ] Are open-source procurement or contribution policies defined?

### Legal, regulatory, and contractual constraints

#### Privacy and compliance

- [ ] Which privacy laws, such as GDPR or CCPA, apply to the actual processing and actors?
- [ ] Are data-location or transfer restrictions applicable? What is their specific basis?
- [ ] Are sector rules or standards, such as HIPAA, PCI DSS, or SOX, relevant to this scope?
- [ ] Are audit or logging duties defined, including retention and deletion limits?
- [ ] Has an appropriate expert reviewed the interpretation and resulting technical restriction?

GDPR alone does not establish EU-only storage or a general caching ban. Check the processing purpose, data categories, applicable obligations, and any separate contract or policy. Do not infer a health-data storage prohibition from a generic reference to medical-device certification.

#### Licensing and intellectual property

- [ ] Are open-source license review or compatibility rules defined?
- [ ] Are commercial licenses required for the intended use or distribution?
- [ ] Are patent or other intellectual-property restrictions relevant?
- [ ] Do export controls apply to the product, recipient, use, or destination?

#### Contracts and service levels

- [ ] Are contractual service-level agreements applicable?
- [ ] Are support obligations defined?
- [ ] Do liability terms affect design or delivery choices?
- [ ] Do confidentiality agreements restrict access, storage, publication, or sharing?

### Conventions

#### Code and development

- [ ] Are coding style guides binding?
- [ ] Are testing standards or coverage gates defined, with a clear scope?
- [ ] Are code-review processes prescribed?
- [ ] Are naming conventions established?

#### Documentation

- [ ] Is the architecture documentation format prescribed?
- [ ] Are API documentation standards defined?
- [ ] Are other technical documentation rules relevant to architecture or delivery?

#### Version control and releases

- [ ] Is a branching strategy prescribed, such as trunk-based development or Git Flow?
- [ ] Is a versioning scheme prescribed, such as SemVer?
- [ ] Are commit-message conventions defined?

## Constraint table templates

Keep the table concise and link to a detail record when needed. Do not publish confidential source material; use an approved public summary when appropriate and make evidence limitations explicit.

### AsciiDoc

```asciidoc
=== 2.X [Category] Constraints

[cols="1,3,2", options="header"]
|===
| ID | Constraint | Rationale and source

| [ID]-1
| [Precise restriction and applicability]
| [Reason; source link; status; owner or link to detail record]

| [ID]-2
| [Precise restriction and applicability]
| [Reason; source link; status; owner or link to detail record]
|===
```

### Markdown

```markdown
### 2.X [Category] Constraints

| ID     | Constraint                              | Rationale and source            |
| ------ | --------------------------------------- | ------------------------------- |
| [ID]-1 | [Precise restriction and applicability] | [Reason; source; status; owner] |
| [ID]-2 | [Precise restriction and applicability] | [Reason; source; status; owner] |
```

### Supporting detail

```text
ID: [Stable identifier]
Restriction: [Which choices are restricted?]
Applicability: [Components, environments, data, jurisdiction, and time period]
Status: [Confirmed obligation / approved organizational choice / unverified assumption]
Source: [Applicable provision, contract, policy, or decision; date/version and reference]
Rationale: [Why the restriction exists]
Authority: [Who can clarify, approve an exception, or change it]
Negotiability: [Conditions for change, or unresolved question]
Review: [Review date or trigger, if known]
Related records: [Requirements, decisions, conflicts]
```

## Conflict documentation template

```asciidoc
=== Conflict: [Short description]

==== Affected constraints and requirements

* [Constraint A ID]: [Restriction, source, and scope]
* [Constraint B ID]: [Restriction, source, and scope]
* [Related quality target ID, if applicable]: [Target]

==== Problem

[Why the restrictions or target appear incompatible; evidence and remaining uncertainty]

==== Evaluation criteria

* [Criterion 1]: [Priority and authority that established it]
* [Criterion 2]: [Priority]
* [Applicable obligations that cannot be waived by the project]

==== Options

. Option A: [Description]
** Benefits: [...]
** Drawbacks: [...]
** Constraints satisfied: [...]
** Constraints violated or requiring approved changes: [...]
** Evidence and verification needed: [...]

. Option B: [Description]
** Benefits: [...]
** Drawbacks: [...]
** Constraints satisfied: [...]
** Constraints violated or requiring approved changes: [...]
** Evidence and verification needed: [...]

==== Decision or escalation

[Proposed / approved / unresolved; chosen option and rationale, if approved]
[Responsible authority; approval evidence or pending clarification]
[Link the ADR and any authorized requirement or policy changes]

==== Trade-offs

* [Cost, complexity, privacy, consistency, performance, or other consequence]
* [Remaining limitation]

==== Follow-up

* [Action, owner, and verification]
* [Review trigger]
```

An option that violates an unchanged binding restriction is not an approved resolution. Escalate it as a request for change or reject it; do not present project approval as a waiver of applicable law.

## Review checklist

### Completeness

- [ ] Technical, organizational, governance, legal/contractual, and convention categories have been considered.
- [ ] Relevant restrictions affecting choices are recorded without a numerical quota.
- [ ] Long-standing but implicit restrictions have been investigated.
- [ ] Unresolved questions have owners rather than invented answers.

### Quality and evidence

- [ ] Each constraint has a unique, stable ID.
- [ ] Each restriction is precise, verifiable, and measurable where measurement is relevant.
- [ ] Each entry has a rationale and a source with enough detail to establish applicability.
- [ ] Each entry identifies its scope, status, and clarification/change authority.
- [ ] The wording is concise without omitting exceptions or conditions.
- [ ] Legal interpretations have specific evidence and appropriate expert review.
- [ ] Synthetic examples have not been treated as project policy or legal evidence.

### Boundaries

- [ ] Functional and quality requirements are distinguished from restrictions on solutions.
- [ ] Proposed local design choices have not been presented as mandatory external constraints.
- [ ] Approved decisions that constrain this project are cross-referenced with their scope.
- [ ] Existing catalog records and policies are linked rather than replaced by parallel rules.

### Currency

- [ ] Constraints remain applicable to the current scope and source versions.
- [ ] Superseded constraints are marked or removed from the active list while preserving necessary traceability.
- [ ] New approved restrictions have been added.
- [ ] Review dates, triggers, and exception conditions are accurate where recorded.

### Conflicts and consistency

- [ ] Conflicting restrictions and affected quality targets are identified.
- [ ] Evidence distinguishes observed conflicts from untested concerns.
- [ ] Approved resolutions include authority, rationale, and trade-offs.
- [ ] Unresolved conflicts remain visible with an escalation owner.
- [ ] Links resolve and chapter 2 is consistent with chapters 3, 4, and 9.

## Stakeholder interview questions

In Situate, the CEO clarifies commercial, budget, organizational, and legal boundaries; the CTO clarifies technical and operational restrictions and consequences. The stakeholder groups below are discovery perspectives, not additional Situate roles or delegated approval powers. Route legal interpretations to appropriate expert review.

### Product owner or business perspective

1. What budget limits or deadlines affect the available choices?
2. Which regulatory obligations are believed to apply, and who can provide the evidence and interpretation?
3. Which service levels or other contractual duties apply?
4. Who must be consulted or approve architecture changes?

### Enterprise architecture perspective

1. Which technology standards are binding, and where are they approved?
2. Which hosting or cloud-provider rules apply?
3. Which integration patterns or existing systems must we use?
4. Which organization-wide security or compliance policies apply to this project?

### Development team perspective

1. Which languages or frameworks are mandated rather than preferred?
2. Which coding guidelines or style guides apply?
3. Which development and deployment tools are required?
4. Which testing or coverage rules are binding, and what do they cover?

### Security and compliance perspective

1. Which privacy laws and specific provisions apply to this processing?
2. Which sector obligations or standards apply, and to which parts of the system?
3. Which audit, logging, retention, and deletion rules apply?
4. Which license restrictions or review procedures apply to dependencies and redistribution?

### Operations and delivery perspective

1. Which deployment and hosting restrictions are binding?
2. Which monitoring and logging solutions are prescribed?
3. Which on-call and support obligations apply?
4. Which change-management and release-approval processes must we follow?

For every answer, ask for its source, applicability, approval status, owner, and conditions for an exception or change.

## Quick reference: requirement, constraint, decision

| Aspect            | Requirement                                      | Constraint                          | Decision                     |
| ----------------- | ------------------------------------------------ | ----------------------------------- | ---------------------------- |
| Question          | What must the system do or achieve?              | Which choices are restricted?       | How do we solve the problem? |
| Synthetic example | Respond in under one second                      | Use Java for backend services       | Use Redis for caching        |
| Freedom           | Multiple possible solutions                      | Reduced solution space              | Selected solution            |
| arc42 location    | Chapter 1 overview; chapter 10 quality scenarios | Chapter 2                           | Chapters 4 and 9             |
| Change            | Requirements approval                            | Owning authority; may be negotiable | Decision review              |

Constraints are requirements that restrict choices. A decision made outside the project can become a project constraint when its approved scope applies.

## Common documentation patterns

### Organization standard

```text
[Technology] is required for [scope].
Source: [Approved organization standard, version/date and link].
Rationale: [Verified support arrangements, expertise, or compatibility needs].
Authority and exception process: [Owner and conditions].
```

### Compliance obligation

```text
[Restriction] applies to [processing, actors, data, jurisdiction, or activity].
Source: [Applicable provision, standard, or contract and reviewed interpretation].
Rationale: [Specific obligation and evidenced consequence of noncompliance].
Clarification owner: [Responsible role and expert reviewer].
```

### Resource limit

```text
[Restriction] applies within [budget, delivery period, and resource scope].
Source: [Approved budget or plan, date and owner].
Change authority: [Role and approval process].
```

### Strategic decision

```text
[Restriction] follows [Decision-maker]'s approved decision dated [Date].
Strategy: [Name and reference].
Applicability and negotiability: [Scope, exception conditions, and authority].
```

### Team convention

```text
[Convention] applies to [Scope].
Source: [Team decision, date and link].
Rationale: [Concrete benefit or constraint].
Review or change process: [Owner and trigger].
```
