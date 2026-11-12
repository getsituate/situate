---
name: arc42-chapter-07-deployment-view
description: Best practices for creating arc42 Chapter 7 "Deployment View" documentation. Use when documenting technical infrastructure, hardware, deployment structures, network topologies, environment configurations, or mapping software building blocks to infrastructure. Triggers on requests involving deployment diagrams, infrastructure documentation, environment setup, hardware requirements, or deployment architecture.
---

# Deployment view

The CTO owns deployment and operations. Begin with actual or explicitly proposed runtime targets; do not assume servers, containers, or a cloud provider. Desktop devices and local storage are deployment nodes when applicable.

Map software artifacts and building blocks to their execution and storage locations. Explain relevant communication paths, trust boundaries, environment differences, and who controls each part. Separate the developer tooling environment from the product runtime.

Cover installation or delivery, updates, configuration sources, persistence, recovery, and observability only as applicable. Document configuration names and purposes, never credentials or sensitive values. Reference reusable deployment definitions rather than copying their full contents.

Mark unavailable or planned environments honestly. Verify implemented claims against build and deployment assets. Identify untested backup or recovery assumptions explicitly; an existing backup setting is not proof that restoration works. Link operational risks to chapter 11 and significant choices to chapter 9.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Core Purpose

The Deployment View answers:

- **Where** do building blocks run?
- **In which environments** does the system operate?
- **With which settings** is it configured?
- **How** are software artifacts mapped to hardware?

## What Belongs in Chapter 7

### Required Content

1. **Technical Infrastructure Overview**
   - Nodes (servers, processors, clusters, containers)
   - Network topology and connections
   - Geographical distribution (if relevant)
   - Environments (dev, test, staging, production)

2. **Software-to-Hardware Mapping**
   - Which building blocks run on which nodes
   - Deployment artifacts (binaries, containers, configs)
   - m:n relationships between software and infrastructure

3. **Runtime Configuration**
   - Environment variables and config files
   - Feature flags and connection strings
   - Required vs. optional settings
   - Default values and overrides

4. **Operational Concerns**
   - Scalability mechanisms
   - Redundancy and failover
   - Security boundaries and trust zones
   - Backup and persistence strategies

### Optional but Recommended

- Quality/performance features (throughput, latency, availability)
- Infrastructure decisions and rationale
- Links to deployment assets (Dockerfiles, Terraform, Helm charts)
- Monitoring and operational procedures

## What Does NOT Belong Here

- Re-explanation of building blocks (see Chapter 5)
- Detailed runtime scenarios (see Chapter 6)
- Interface specifications (see Chapter 3 or 8)
- Actual secret values (document names/locations only)
- Unstructured dumps of all possible settings

## Structure Template

```markdown
## 7. Deployment View

<Brief intro: environments, operational priorities>

### 7.1 Infrastructure Level 1

<Diagram: nodes, connections, trust boundaries>

#### Motivation

<Why this topology? Key decisions driving the structure>

#### Quality/Performance Features (optional)

<Throughput, latency, availability targets>

#### Mapping: Building Blocks to Infrastructure

| Building Block | Runs On | Notes |
| :------------- | :------ | :---- |
| ...            | ...     | ...   |

#### Configuration

| Key/Setting | Default | Required | Where Set | Impact |
| :---------- | :------ | :------- | :-------- | :----- |
| ...         | ...     | ...      | ...       | ...    |

### 7.2 Infrastructure Level 2 (optional)

<Zoom into specific infrastructure elements>

#### 7.2.1 <Infrastructure Element>

<Internal structure, operational details>

##### Configuration

<Settings specific to this element>
```

## Documentation Formats

### 1. UML Deployment Diagrams

- Use for visualizing nodes, artifacts, and communication paths
- Supports nested nodes for hierarchical structures
- Standard notation: 3D boxes for nodes, rectangles for artifacts

### 2. Tables

- Use for mapping building blocks to infrastructure
- Alternative when diagrams become too complex
- Easier to maintain for simple deployments

### 3. Network/Topology Diagrams

- Use free-form graphics for enterprise-level views
- Consistent iconography with defined semantics
- Often preferred by infrastructure/ops teams

## Key Principles

### Hierarchical Documentation

- Start with high-level overview (Level 1)
- Drill down only where necessary (Level 2+)
- Align with Building Block View hierarchy from Chapter 5

### Environment Coverage

- Document all relevant environments
- Describe the supported product runtime, including device-local execution; do not invent a production server environment
- Include local development if onboarding matters
- Copy 7.1 structure for multiple environments

### Configuration Structure

- Group by domain/feature
- Document defaults and overrides
- Indicate required vs. optional
- Explain behavioral impact
- NEVER include actual secret values

### Traceability

- Map deployed software to Chapter 5 and explain infrastructure dependencies separately
- Use consistent naming across chapters
- Cross-reference related decisions in Chapter 9

## Common Anti-Patterns to Avoid

1. **Prod-Only Documentation**
   - Mistake: Only documenting production
   - Fix: Include dev/test environments as first-class citizens

2. **Mixing Behavior and Placement**
   - Mistake: Detailed runtime flows in deployment view
   - Fix: Keep deployment focused on "where"; behavior belongs in Chapter 6

3. **Configuration Chaos**
   - Mistake: Unstructured list of all settings
   - Fix: Group, prioritize, document impact

4. **Missing Operational Boundaries**
   - Mistake: Not documenting who owns what
   - Fix: Clarify ops boundaries and control domains

5. **Orphaned Diagrams**
   - Mistake: Deployment diagrams not traceable to building blocks
   - Fix: Map software boxes to Chapter 5 and distinguish infrastructure-only nodes and external systems

6. **Duplicating IaC**
   - Mistake: Copying every Terraform setting
   - Fix: Chapter 7 is the map; IaC is the construction crew

## Deployment View vs. Runtime View

| Aspect       | Deployment View (Ch. 7)     | Runtime View (Ch. 6)           |
| :----------- | :-------------------------- | :----------------------------- |
| **Focus**    | Static structure, placement | Dynamic behavior, interactions |
| **Question** | "Where does it run?"        | "How does it behave?"          |
| **Elements** | Nodes, artifacts, networks  | Objects, messages, sequences   |
| **Timing**   | Design/deployment time      | Runtime                        |
| **Changes**  | Infrequent (infrastructure) | Frequent (scenarios)           |

## Done-When Checklist

- [ ] Main environments/variants described
- [ ] Building blocks mapped to nodes
- [ ] Key runtime configuration documented
- [ ] Operational concerns acknowledged
- [ ] Newcomer can answer "where does this run?"
- [ ] Newcomer can answer "what do I need to configure?"

## Resources

- Read [deployment patterns](references/deployment-patterns.md) when comparing runtime placements; select only applicable patterns.
- Use the [review checklist](references/checklist.md) for relevant environments and boundaries.
- Adapt the [chapter template](assets/template.md) to AsciiDoc without inventing environments.
