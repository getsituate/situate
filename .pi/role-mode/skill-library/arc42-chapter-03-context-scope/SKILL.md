---
name: arc42-chapter-03-context-scope
description: Guide for creating arc42 Chapter 3 "Context and Scope" documentation. Use when documenting system boundaries, creating context diagrams, defining external interfaces, or distinguishing between business and technical context. Helps with scope definition, interface documentation, and avoiding common anti-patterns in architecture documentation.
---

# Context and scope

Start from agreed product scope and exclusions. Treat the system as a single unit; its internal decomposition belongs in chapter 5.

The CEO describes users, external business partners or systems, responsibilities, and information exchanged. The CTO describes the corresponding technical channels, formats, authentication, and trust boundaries where these affect design. Technical context is useful for software integrations as well as hardware systems.

Use labeled directional connections and a short interface table when helpful. State what crosses each boundary, who controls each side, and which dependencies matter. Managed infrastructure is not automatically outside the system boundary: explain the chosen boundary and distinguish system scope from operational control.

Include known external interactions without speculating about future integrations. Mark unresolved interfaces as open questions. Avoid secret endpoints, credentials, and private infrastructure details. Check that names and boundaries remain consistent with the catalog and chapters 5–7.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Core Concepts

### Business Context vs Technical Context

**Business Context (Domain Context)**

- Focus: WHAT is exchanged (domain data, business processes)
- Shows: Communication partners, data flows, business relationships
- Audience: Business stakeholders, product owners, domain experts
- Contains: Users, external systems, data inputs/outputs
- Excludes: Protocols, hardware, technical infrastructure

**Technical Context**

- Focus: HOW data is exchanged (channels, protocols, infrastructure)
- Shows: Communication channels, protocols, hardware dependencies
- Audience: Infrastructure architects, DevOps, developers
- Contains: Network protocols, hardware interfaces, transmission media
- When useful: Software integrations, trust boundaries, deployment channels, embedded systems, or hardware dependencies

**Decision Rule**: Describe business context. Add technical context when channels, protocols, authentication, or infrastructure affect architectural choices, including in software-only systems.

## Context Diagram Best Practices

### Visual Structure

1. **Center**: Your system as a black box (single component/box)
2. **Surround**: External entities (users, systems, organizations)
3. **Connect**: Labeled arrows showing data flow direction
4. **Label**: Every arrow with the data/information exchanged

### Diagram Types (Choose based on context)

- **UML Component Diagram**: Recommended - shows system as black box with interfaces
- **UML Use Case Diagram**: Good for user-centric systems
- **UML Communication Diagram**: Shows interactions between actors
- **C4 System Context Diagram**: Excellent for software systems
- **Custom "Boxes and Lines"**: Acceptable when UML is too heavy

### Layout Guidelines

- Place your system in the center
- Arrange external entities around the perimeter
- Keep lines straight when possible
- Avoid crossing arrows
- Group related entities visually
- Use consistent shapes throughout

## External Interface Documentation

### Interface Template (for complex interfaces)

```
Interface ID: [Unique identifier]
Name: [Descriptive name]
Version: [Current version]

Business Context:
- Business Processes: [Which processes use this interface]
- Interface Data: [What data is exchanged]
- Direction: [Inbound/Outbound/Bidirectional]

Technical Context:
- Protocol: [HTTP, gRPC, MQTT, etc.]
- Data Format: [JSON, XML, Protobuf, etc.]
- Authentication: [Method used]
- Frequency: [Real-time, batch, on-demand]

Quality Requirements:
- Performance: [Latency, throughput]
- Availability: [Uptime requirements]
- Security: [Encryption, access control]

Error Handling:
- Retry Strategy: [How failures are handled]
- Fallback: [Backup mechanisms]
```

### What to Document

**Always include:**

- All external communication partners (Tip 3-9: Show ALL!)
- Direction of data flow
- Type of data exchanged
- Critical dependencies

**For business context:**

- Domain-specific inputs and outputs
- Business processes involved
- User roles and responsibilities

**For technical context:**

- Communication channels
- Protocols and formats
- Hardware interfaces (if applicable)
- Network topology

## Scope Definition

### Defining System Boundaries

**Inside the System:**

- Components you build or control
- Internal data stores
- Business logic you implement
- User interfaces you create

**Outside the System:**

- External systems you integrate with
- Third-party services
- User roles (actors)
- Infrastructure outside the chosen system scope; operational control alone does not determine scope

### Scope Clarification Questions

1. Which components do we build vs. integrate?
2. What data enters the system? What leaves?
3. Who are the users? What are their roles?
4. Which external systems must we interface with?
5. What is explicitly OUT of scope?

## Anti-Patterns to Avoid

### ❌ Anti-Pattern: Missing External Systems

**Problem**: "We'll figure out integrations later"
**Impact**: Critical dependencies discovered too late
**Solution**: Document known external interfaces and mark unresolved details; do not invent future integrations

### ❌ Anti-Pattern: Mixing Business and Technical

**Problem**: Showing HTTP protocols in business context
**Impact**: Confuses business stakeholders
**Solution**: Keep them separate or clearly distinguish (Tip 3-10)

### ❌ Anti-Pattern: Too Much Detail

**Problem**: Showing internal components in context diagram
**Impact**: Loses the big picture
**Solution**: Black box only - internals go to Chapter 5 (Tip 3-5)

### ❌ Anti-Pattern: Data Flow Confusion

**Problem**: Showing dependencies instead of data flows
**Impact**: Unclear what is actually exchanged
**Solution**: Label arrows with data/information (Tip 3-11)

### ❌ Anti-Pattern: Scope Creep via Context

**Problem**: Vague boundaries lead to "while we're at it..."
**Impact**: Uncontrolled expansion
**Solution**: Explicitly state what is OUT of scope

### ❌ Anti-Pattern: Ignoring Transitive Dependencies

**Problem**: Only showing direct connections
**Impact**: Missing critical indirect dependencies
**Solution**: Show consequential transitive dependencies without expanding the diagram into the entire ecosystem

## Practical Checklist

### Before You Start

- [ ] Identify all stakeholders who need to understand the context
- [ ] List known external systems (even if details are unclear)
- [ ] Determine if technical context is needed
- [ ] Choose appropriate diagram type

### Creating Business Context

- [ ] List ALL external communication partners
- [ ] Define user roles and actors
- [ ] Identify data inputs (what enters the system)
- [ ] Identify data outputs (what leaves the system)
- [ ] Document business processes involved
- [ ] Create context diagram
- [ ] Add explanatory text for complex interfaces

### Creating Technical Context (if needed)

- [ ] Identify communication channels
- [ ] Document protocols used
- [ ] Map business data flows to technical channels
- [ ] Note hardware dependencies
- [ ] Create technical context diagram

### Review

- [ ] Can a new team member understand the boundaries?
- [ ] Are all external interfaces shown?
- [ ] Is the distinction between business/technical clear?
- [ ] Are quality requirements at interfaces noted?
- [ ] Is the scope explicitly defined (including exclusions)?

## Integration with Other Chapters

**Chapter 1 (Introduction)**: Context supports quality goals and stakeholder understanding
**Chapter 2 (Constraints)**: External interfaces may impose constraints
**Chapter 5 (Building Blocks)**: Level 1 must be consistent with context (Tip 5-4)
**Chapter 6 (Runtime)**: Context scenarios inform runtime views
**Chapter 9 (Decisions)**: Interface decisions often documented here
**Chapter 11 (Risks)**: External dependencies are common risks

## Examples in Practice

### Example 1: Web Application

**Business Context**: Users exchange orders and confirmations with a shopping system; the system exchanges payment requests with a payment provider and notification content with an email service.
**Technical Context**: Users reach the system over HTTPS; payment and email integrations use authenticated HTTPS APIs. An internal database stays inside the system boundary and is decomposed in Chapter 5.

### Example 2: Embedded System (Automotive)

**Business Context**: Driver → Infotainment System → Navigation Data, Media Sources
**Technical Context**: CAN Bus, Bluetooth, USB, Display Hardware

### Example 3: Information System

**Business Context**: Employees → HR System → Payroll System, Identity Provider
**Technical Context**: REST APIs, SAML, LDAP, Message Queue

## Quick Reference

| Aspect   | Business Context | Technical Context |
| -------- | ---------------- | ----------------- |
| Focus    | Domain data      | Infrastructure    |
| Question | What?            | How?              |
| Audience | Business         | Technical         |
| Diagram  | Logical          | Deployment        |
| Always?  | Yes              | Only if needed    |

## When to Use This Skill

- Creating or reviewing arc42 Chapter 3
- Drawing system context diagrams
- Documenting external interfaces
- Defining system scope and boundaries
- Distinguishing business from technical concerns
- Identifying integration points
- Reviewing architecture documentation for completeness
