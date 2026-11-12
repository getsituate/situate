---
name: arc42-chapter-05-building-block-view
description: Best practices for creating arc42 Chapter 5 "Building Block View" - static system decomposition into hierarchies of black boxes and white boxes. Use when documenting software architecture structure, creating building block hierarchies, writing black-box or white-box descriptions, determining appropriate granularity levels, or avoiding common building block anti-patterns.
---

# Building block view

The CTO owns the structural view. Establish whether the request concerns a proposed design or existing implementation and label that distinction clearly.

Begin with the system boundary from chapter 3. Show a readable decomposition into meaningful responsibilities. For each component, explain its purpose, exposed interfaces, owned data, and important dependencies. For implemented components, link to real code locations.

Explain why boundaries were chosen and how dependency direction is enforced where relevant. Refine a component only when its internal complexity, risk, or audience need warrants it; do not document every class or manufacture layers.

Keep each diagram at one abstraction level. Every detailed component should have a clear parent. Use the same names in runtime and deployment views. Check for missing ownership, unexplained dependencies, and divergence between diagrams and code. Proposed components must not masquerade as implemented ones.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Core Concepts

### What is the Building Block View?

The Building Block View shows the **static decomposition** of the system into building blocks (modules, components, subsystems, classes, interfaces, packages, libraries, frameworks, layers, partitions, tiers, functions, etc.) as well as their dependencies.

**Analogy**: Like a **floor plan** of a house - it shows the static structure, not the dynamic behavior.

**Purpose**:

- Maintain an overview of source code through abstraction
- Communicate with stakeholders on an abstract level
- Hide implementation details while showing structure

### Black Box vs White Box

| Aspect         | Black Box                   | White Box                               |
| -------------- | --------------------------- | --------------------------------------- |
| **Visibility** | Hides internal workings     | Exposes internal structure              |
| **Purpose**    | Describe WHAT it does       | Describe HOW it's structured internally |
| **Content**    | Responsibility + interfaces | Decomposition into smaller black boxes  |
| **Usage**      | Level 1 building blocks     | Level 1 system, Level 2+ refinements    |

**Key Principle**: Information hiding - you only need to know a black box's responsibility and interfaces to use it. Internal changes should not require consumer changes when the interface's behavioral contract remains unchanged.

## Hierarchical Structure

### Level 0: Context View (Section 3)

- The complete system as a **single black box**
- Shows system boundary and external interfaces
- Starting point for the building block hierarchy

### Level 1: Whitebox Overall System (MANDATORY)

- **White box description** of the complete system
- Shows a readable top-level decomposition, grouped by responsibility rather than a fixed block count
- **Black box descriptions** of all contained building blocks
- **Always document Level 1** - it's your most stable, essential view

### Level 2: Whitebox Selected Building Blocks

- Zoom into **some** (not all) Level 1 building blocks
- White box description of selected Level 1 blocks
- Black box descriptions of their internal building blocks
- **Partial refinement** - only important/complex blocks

### Level 3+: Further Refinement

- Continue zooming into selected Level 2 blocks
- Same pattern: white box parent → black box children
- Stop when further detail adds no value

**Hierarchy Visualization**:

```
Level 0: [System] (Black Box - Context View)
           ↓
Level 1: ┌─────────────────┐ (White Box)
         │  System         │
         │ ┌───┐ ┌───┐    │
         │ │ A │ │ B │... │ (Black Boxes)
         │ └───┘ └───┘    │
         └─────────────────┘
           ↓ (refine selected)
Level 2: ┌─────────┐ (White Box of A)
         │    A    │
         │ ┌─┐ ┌─┐ │
         │ │1│ │2│ │ (Black Boxes)
         │ └─┘ └─┘ │
         └─────────┘
```

## Organize Chapter 5 by Level

Structure the chapter's subsections and included topic files in level order, not as a flat list of components or a depth-first tour of one branch:

1. **Level 1**: Describe the overall system as a white box and all its immediate children as black boxes.
2. **Level 2**: Group the selected refinements of Level 1 children in a dedicated section. Finish these descriptions before introducing Level 3.
3. **Level 3 and deeper**: Use a separate section for each further level. Within that section, group refinements by their parent building block so the decomposition hierarchy remains visible.

Each refinement must name and link to its parent description in the preceding level. Describe its immediate children beneath that white box; place their internal refinements in the next level's section, not alongside their black-box descriptions. Keep sibling blocks at the same heading depth within their parent group. Document only selected refinements; do not create empty levels or invent components to complete the hierarchy.

When splitting the chapter into files, mirror these level and parent groups in the topic-file organization and include order. Preserve stable anchors and update affected links if an authorized restructuring moves existing content. This organization applies to the building block view, not to the ordering of other arc42 chapters.

## Templates

### White Box Template

Use this for:

- Level 1: Overall system
- Level 2+: Selected building blocks from previous level

**Structure**:

1. **Overview Diagram**
   - Shows the decomposition
   - Parent as container, children inside
   - Dependencies between children

2. **Motivation/Design Rationale** (REQUIRED)
   - WHY this decomposition?
   - What criteria drove the structure?
   - Brief justification for each decision

3. **Contained Black Boxes**
   - Name and responsibility for each
   - Can use table format (concise) or individual descriptions (detailed)

4. **Important Interfaces** (optional)
   - Only if not covered in black box descriptions
   - Signatures or examples suffice

### Black Box Template

Use this for every building block within a white box.

**Structure**:

1. **Purpose/Responsibility** (REQUIRED)
   - What does this building block do?
   - One clear, concise sentence

2. **Interface(s)**
   - How to interact with this block?
   - Input/output, method signatures
   - Quality characteristics (performance, availability)

3. **Quality/Performance Characteristics** (optional)
   - Availability, runtime behavior, throughput
   - Only if relevant for understanding

4. **Directory/File Location** (optional)
   - Where to find the code
   - Package, namespace, folder path

5. **Fulfilled Requirements** (optional)
   - Traceability to requirements
   - Only if needed

6. **Open Issues/Problems/Risks** (optional)
   - Known limitations
   - Technical debt

## How Many Levels?

### Typical Guidelines

- **Minimum**: Level 1 only (for simple systems)
- **Typical**: Level 1 + selective Level 2
- **Maximum**: Level 1-3 (for complex systems)
- **Rarely**: Level 4+ (only for very complex, critical components)

### When to Stop

Stop refining when:

- The building block is simple and obvious
- Further detail adds no communication value
- The code is self-explanatory
- Maintenance effort exceeds value

**Golden Rule**: Prefer relevance over completeness. Document important, surprising, risky, complex, or volatile blocks. Skip normal, simple, boring, standardized parts.

## Granularity Guidelines

### Finding the Right Level

**Too coarse**: Single building block does everything

- Problem: No abstraction, no structure visible
- Solution: Decompose by responsibility

**Too fine**: Dozens of tiny building blocks at Level 1

- Problem: Overwhelming, hard to understand
- Solution: Group by cohesion, move details to Level 2

### Cohesion as Primary Driver

Group elements that BELONG together:

- Similar business functions or processes
- Operating on similar data
- Used by similar users/stakeholders
- Similar technologies or implementation rules
- Similar deployment characteristics
- Same team maintains them

## Common Anti-Patterns

### Anti-Pattern 1: Diagrams of Death

**Symptom**: One huge diagram with 50+ boxes and lines everywhere
**Solution**: Use hierarchical decomposition; split diagrams when labels or relationships become hard to follow

### Anti-Pattern 2: Completeness Obsession

**Symptom**: Documenting EVERY building block at EVERY level
**Solution**: Partial refinement - only important/complex blocks

### Anti-Pattern 3: Inconsistent Refinement

**Symptom**: Jumping from Level 1 to Level 4, skipping intermediate levels
**Solution**: Every detailed block must have uninterrupted parent chain to Level 1

### Anti-Pattern 4: Missing Design Rationale

**Symptom**: Diagrams without explanations WHY structured this way
**Solution**: Always justify white box decomposition

### Anti-Pattern 5: Black Box with Visible Internals

**Symptom**: Black box description reveals implementation details
**Solution**: Information hiding - interface and responsibility only

### Anti-Pattern 6: No Source Code Mapping

**Symptom**: Building blocks don't correspond to actual code structure
**Solution**: Align with directory/file structure, document location

### Anti-Pattern 7: Technology Over Business

**Symptom**: Decomposition follows tech stack ("React Layer", "Database Layer") instead of domains
**Solution**: Prefer functional/business decomposition over technical layering

## Best Practices

### Do's

1. **Always document Level 1** - it's your friend
2. **Justify every white box** - explain the design rationale
3. **Use tables for simple black boxes** - concise and scannable
4. **Map to source code** - document where to find the implementation
5. **Use meaningful names** - building block names reveal responsibility
6. **Align with context view** - external interfaces must be consistent
7. **Leverage concepts** - use Section 8 (Crosscutting Concepts) for recurring patterns

### Don'ts

1. Don't document everything - partial refinement is sufficient
2. Don't skip levels - maintain consistent hierarchy
3. Don't expose internals in black boxes
4. Don't create diagrams without accompanying text
5. Don't force unrelated responsibilities together to meet a diagram-size target
6. Don't maintain deep hierarchies unless necessary

## Table Format for Black Boxes

For concise documentation, use this table format:

| Name         | Responsibility                                      | Interfaces                     | Code Location        |
| ------------ | --------------------------------------------------- | ------------------------------ | -------------------- |
| UserService  | Manages user registration, authentication, profiles | UserAPI (REST), UserRepository | `com.example.users`  |
| OrderService | Handles order creation, validation, processing      | OrderAPI (REST), PaymentClient | `com.example.orders` |

Add columns as needed: Quality Characteristics, Fulfilled Requirements, etc.

## Example Structure

```
5. Building Block View

5.1 Level 1: White Box Overall System
    ├─ Overview Diagram
    ├─ Motivation: "Decomposed by functional domains..."
    ├─ Contained Black Boxes (table or descriptions)
    └─ Important Interfaces

5.2 Level 2
    5.2.1 White Box <Building Block A>
        ├─ Overview Diagram
        ├─ Motivation
        ├─ Contained Black Boxes
        └─ Black Box <A.1>
            ├─ Purpose
            ├─ Interface
            └─ Code Location
        └─ Black Box <A.2>
            ...

    5.2.2 White Box <Building Block B>
        ...

5.3 Level 3 (if needed)
    5.3.1 Refinements within <Building Block A>
        5.3.1.1 White Box <Building Block A.1>
            ├─ Parent: link to A.1 in the Level 2 white box of A
            ├─ Overview Diagram and Motivation
            └─ Contained Black Boxes <A.1.1>, <A.1.2>

    5.3.2 Refinements within <Building Block B> (if needed)
        ...
```

## Consistency Rules

1. **External Interface Consistency**: Level 1 must match Context View (Section 3)
2. **Hierarchy Consistency**: Every Level 2+ block must have a parent in the previous level
3. **Refinement Consistency**: If a block appears in a white box, it must be documented
4. **Naming Consistency**: Use same names across all sections and diagrams

## Integration with Other Sections

- **Section 3 (Context)**: Level 1 must be consistent with external interfaces shown there
- **Section 6 (Runtime)**: Runtime views explain HOW building blocks interact
- **Section 7 (Deployment)**: Deployment may influence building block boundaries
- **Section 8 (Concepts)**: Crosscutting concepts explain patterns across building blocks
- **Section 9 (Decisions)**: Architecture decisions may explain WHY certain decompositions exist

## Quick Checklist

Before finalizing Chapter 5, verify:

- [ ] Level 1 is documented (mandatory)
- [ ] Level 1 external interfaces match Context View
- [ ] Every white box has a design rationale
- [ ] Every black box has a clear responsibility
- [ ] Each diagram is readable at its intended size and uses one abstraction level
- [ ] Source code locations are documented (optional but recommended)
- [ ] Chapter sections and topic-file includes proceed level by level, not depth first
- [ ] Refinements are grouped by parent and link to that parent in the preceding level
- [ ] Hierarchy is consistent (no skipped levels)
- [ ] Only important/complex blocks refined at Level 2+
- [ ] Building block names are meaningful
- [ ] Diagrams have accompanying text descriptions
