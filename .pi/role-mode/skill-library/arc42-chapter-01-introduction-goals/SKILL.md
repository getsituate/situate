---
name: arc42-chapter-01-introduction-goals
description: |
  Create and review arc42 Chapter 1 "Introduction and Goals" for software architecture documentation.
  Use when users need to: (1) Write the introduction section of an arc42 document, (2) Define quality goals and requirements,
  (3) Document stakeholder expectations, (4) Review or improve an existing Chapter 1, (5) Structure business goals and functional requirements.
  Enforces best practices for requirements overview, quality scenarios, and stakeholder tables.
---

# Introduction and goals

Read the relevant product documentation and catalog entries before editing. Summarize the problem, intended users, useful outcomes, and essential capabilities. Link requirement IDs rather than reproducing the catalog.

The CEO leads purpose, stakeholder expectations, and business priorities. The CTO contributes architectural implications and the feasibility of quality goals. Neither perspective substitutes for the user's approval.

Select only the quality goals that actually drive architectural choices. Explain their user value and refer to measurable scenarios in chapter 10. Unknown thresholds remain questions, not invented requirements. Do not turn implementation tactics into user needs.

Identify stakeholder roles and their concrete concerns without publishing personal contact details or private research. Confirm that the chapter distinguishes agreed scope from hypotheses and aligns with chapter 3. Keep it an orientation, not a complete product specification.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Core Principle

Chapter 1 answers: **"Why does this system exist and what must it achieve?"**

All architectural decisions flow from this foundation. A well-written Chapter 1 provides the context and criteria against which the architecture will be judged.

## Chapter Structure

### 1.1 Requirements Overview

**Purpose**: Compact summary of functional requirements and driving forces.

**Content Guidelines**:

- Keep it under one page when possible
- Focus on the essence - what problem does the system solve?
- Highlight business goals explicitly
- Reference detailed requirements documents rather than duplicating them
- Use diagrams (use cases, BPMN, activity diagrams) if they add clarity

**Forms** (choose based on context):

- Short textual description
- Tabular use-case format
- Numbered list of key requirements
- Activity/BPMN diagrams for complex workflows

**Anti-Patterns to Avoid**:

- ❌ Copy-pasting entire requirements specifications
- ❌ Vague statements like "The system shall be user-friendly"
- ❌ Listing every minor feature
- ❌ Omitting business context

**Quality Checklist**:

- [ ] Business goals are explicitly stated
- [ ] Problem domain is clearly described
- [ ] Essential features are identified
- [ ] References to detailed requirements exist
- [ ] Scope boundaries are clear

---

### 1.2 Quality Goals

**Purpose**: Prioritize a small set of quality goals that drive architectural decisions; three to five is a starting point, not a quota.

**Critical Distinction**: Quality goals for the ARCHITECTURE, not project goals. These are the qualities stakeholders will use to judge the architecture's success.

**The Q42 Quality Model**:
Use the 9 Q42 dimensions as tags/labels for quality requirements:

| Dimension       | Covers                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| `#reliable`     | Available, robust, fault-tolerant, consistent, recoverable, safe, secure |
| `#flexible`     | Easy to change, configurable, integratable, infrastructure flexibility   |
| `#maintainable` | Analyzable, modifiable, testable, debuggable, predictable effort         |
| `#efficient`    | Fast, responsive, resource-efficient (CPU, memory, network)              |
| `#usable`       | Easy to use, attractive, accessible, intuitive                           |
| `#operable`     | Easy to install, operate, monitor, administer                            |
| `#suitable`     | Provides required functions and characteristics                          |
| `#secure`       | Confidential, accountable, integrous                                     |
| `#safe`         | Fail-safe, fault-isolating, early risk detection                         |

**Quality Scenarios - The Essential Format**:

Quality goals must be specified through **scenarios** - concrete, measurable descriptions of system behavior.

**Scenario Types**:

1. **Usage scenarios**: How the system reacts under normal use
2. **Change scenarios**: How the system behaves when modified
3. **Failure scenarios**: How the system behaves under problems

**Two-Tier Approach for Scenarios**:

**Tier 1 - Simple Requirements** (for straightforward cases):

```markdown
#### Requirement

[One clear statement]

#### Acceptance Criteria

- [Specific, measurable criterion with numeric threshold]
- [Additional criteria if needed]
```

**Tier 2 - Complex Requirements** (when context matters):

```markdown
#### Context

[1-3 sentences explaining business/technical context]

#### Trigger

[Who/what initiates this requirement]

#### Acceptance Criteria

- [Specific, measurable criterion]
- [Additional criteria...]
```

**Writing Effective Acceptance Criteria**:

- ✅ Be specific: "Response time < 500ms for 95% of requests"
- ❌ Avoid vague: "System should be fast"
- ✅ Include units: "Deployment completes in < 2 hours"
- ❌ Skip unclear: "Deployment is quick"
- ✅ Define thresholds: "99.9% uptime"
- ❌ Avoid unmeasurable: "Highly available"

**Anti-Patterns to Avoid**:

- ❌ Giving every quality concern equal prominence instead of summarizing drivers and linking details in Chapter 10
- ❌ Using buzzwords without concrete scenarios ("scalable", "secure", "robust")
- ❌ Confusing project goals with architectural quality goals
- ❌ Omitting measurable acceptance criteria
- ❌ Writing scenarios that cannot be tested

**Quality Checklist**:

- [ ] Architecturally significant quality goals are identified and prioritized
- [ ] Each goal has concrete scenarios
- [ ] Scenarios include measurable acceptance criteria
- [ ] Stakeholders have validated the scenarios
- [ ] Goals are realistic and achievable
- [ ] Reference to Chapter 10 for complete quality tree exists

---

### 1.3 Stakeholders

**Purpose**: Identify all parties with interest in or impact on the architecture.

**Why It Matters**: Forgotten stakeholders = forgotten requirements. Understanding who cares about the architecture shapes documentation depth and focus.

**Stakeholder Table Format**:

| Role   | Public reference                   | Expectation                                      |
| ------ | ---------------------------------- | ------------------------------------------------ |
| [Role] | [Public team reference, if useful] | [What they need from architecture/documentation] |

**Extended Format** (for complex projects):

| Role   | Public reference        | Relevance for Approval           | Expectation      |
| ------ | ----------------------- | -------------------------------- | ---------------- |
| [Role] | [Public role reference] | [Established decision authority] | [Specific needs] |

**Common Stakeholder Roles**:

| Role                 | Typical Expectations                                  |
| -------------------- | ----------------------------------------------------- |
| **End Users**        | Usable, reliable, available when needed, safe         |
| **Management**       | Efficient (cost), reliable, time-to-market            |
| **Product Owner**    | Flexible for new features, suitable functions         |
| **Developers**       | Flexible code, maintainable, testable, understandable |
| **Testers**          | Testable, reproducible results, automatable           |
| **Administrators**   | Operable, reliable, secure, flexible deployment       |
| **Domain Experts**   | Reliable, efficient, flexible for new functions       |
| **Security Team**    | Secure, auditable, compliant                          |
| **Compliance/Legal** | Regulatory compliance, audit trails                   |

**Stakeholder Classification by Interest and Influence**:

Use a 2x2 matrix for prioritization (keep private if needed):

```
            High Interest    Low Interest
            ┌─────────────┬─────────────┐
High Impact │   KEEP      │   KEEP      │
            │   SATISFIED │   INFORMED  │
            │   (Manage   │   (Monitor) │
            │   closely)  │             │
            ├─────────────┼─────────────┤
Low Impact  │   KEEP      │   MINIMAL   │
            │   INVOLVED  │   EFFORT    │
            │   (Inform)  │   (Monitor) │
            └─────────────┴─────────────┘
```

**Classification Guidance**:

- **High Impact + High Interest**: Involve intensively, proactive communication, satisfy completely
- **High Impact + Low Interest**: Invest effort as needed, keep satisfied
- **Low Impact + High Interest**: Involve actively, helpful for feedback, keep informed
- **Low Impact + Low Interest**: Minimize effort, provide info when necessary

**Anti-Patterns to Avoid**:

- ❌ Omitting the stakeholder table entirely
- ❌ Listing only management stakeholders
- ❌ Forgetting developers and operations teams
- ❌ Not documenting specific expectations
- ❌ Publishing influence/interest matrix without caution

**Quality Checklist**:

- [ ] All relevant stakeholder roles are identified
- [ ] Public role references are current; private contact details are excluded
- [ ] Specific expectations are documented
- [ ] Stakeholders are classified by interest/influence
- [ ] Table is maintained and updated

---

## Common Anti-Patterns Summary

### Documentation Anti-Patterns

1. **The Novel**: Writing pages when a paragraph suffices
2. **The Copy-Paste**: Duplicating requirements documents
3. **The Vague**: Using buzzwords without concrete meaning
4. **The Kitchen Sink**: Including every possible requirement
5. **The Orphan**: No connection to business goals

### Quality Goal Anti-Patterns

1. **Buzzword Bingo**: "Scalable, secure, robust, performant" without specifics
2. **Project Confusion**: Mixing project goals with architectural quality goals
3. **The Wishlist**: Unrealistic or unmeasurable goals
4. **The Dump**: Listing 20+ goals in Chapter 1
5. **The Untestable**: Goals that cannot be verified

### Stakeholder Anti-Patterns

1. **The Management Bubble**: Only listing executives
2. **The Forgotten**: Missing developers, testers, ops
3. **The Ghost**: Stakeholders listed but never consulted
4. **The Static**: Table never updated as project evolves

---

## Quick Reference: Chapter 1 Checklist

Use this before finalizing Chapter 1:

### Requirements Overview

- [ ] Under one page (unless exceptional complexity)
- [ ] Business goals explicitly stated
- [ ] Problem/solution clearly described
- [ ] References to detailed requirements provided
- [ ] Scope boundaries defined

### Quality Goals

- [ ] A focused set of top goals is summarized in Chapter 1
- [ ] Each goal expressed as concrete scenario
- [ ] Measurable acceptance criteria included
- [ ] Stakeholders involved in definition
- [ ] Reference to Chapter 10 quality tree

### Stakeholders

- [ ] Table with roles, public references where useful, and expectations
- [ ] Technical stakeholders included (dev, test, ops)
- [ ] Business stakeholders included
- [ ] Classification by interest/influence done
- [ ] Expectations are specific and actionable

---

## Example: Well-Written Quality Goal

**Poor**:

> The system shall be scalable.

**Better**:

> **Performance under Load**: The system must handle 10,000 concurrent users with response times under 2 seconds for 95% of requests.

**Best** (Full Scenario):

> #### Context
>
> A hypothetical e-commerce platform must remain usable during promotional traffic spikes.
>
> #### Trigger
>
> A promotional event causes sudden traffic increase.
>
> #### Acceptance Criteria
>
> - System supports 10,000 concurrent users without degradation
> - 95% of API requests complete within 2 seconds
> - In a 30-minute load test with 10,000 concurrent users, fewer than 0.1% of requests fail
> - Requests already accepted before a capacity change are not lost
>
> Scaling mechanisms and connection-pool settings belong in strategy or design sections, not in this outcome statement.

---

## Example: Stakeholder Table

| Role                    | Public reference | Expectation                                                                   |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------- |
| Product Owner           | Product team     | Architecture enables 2-week release cycles; supports A/B testing              |
| Lead Developer          | Development team | Clean code structure, comprehensive testability, clear module boundaries      |
| DevOps Engineer         | Operations team  | Automated deployment, container orchestration, monitoring integration         |
| QA Lead                 | Test team        | Test automation support, reproducible environments, performance test hooks    |
| Security Officer        | Security team    | OAuth 2.0/OIDC support, audit logging, data encryption at rest and in transit |
| End User Representative | Customer Panel   | Mobile-responsive, accessible (WCAG 2.1 AA), intuitive navigation             |

---

## When to Use This Skill

Trigger this skill when users:

- Ask for help writing arc42 Chapter 1
- Need to define quality goals or requirements
- Want to document stakeholder expectations
- Request review of existing Chapter 1 content
- Need guidance on structuring business goals
- Ask about quality scenarios or the Q42 model

## References

- Read [quality scenario examples](references/quality-scenarios-examples.md) when drafting measurable goals.
- Use [stakeholder templates](references/stakeholder-templates.md) for discovery; exclude private contacts from public documentation.
- Consult the [Q42 quick reference](references/q42-quick-reference.md) when categorizing quality concerns.
