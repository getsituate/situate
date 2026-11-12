# ATAM (Architecture Tradeoff Analysis Method) Guide

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Quick reference for using ATAM to evaluate and prioritize quality requirements.

## What is ATAM?

ATAM is a systematic method for evaluating software architectures, developed by the Software Engineering Institute (SEI). It helps:

- Identify quality requirements that drive architecture
- Uncover trade-offs between quality attributes
- Expose risks and sensitivity points
- Validate architectural decisions

## Scenario-Based Review Overview

The agenda below is a simplified, ATAM-inspired review, not the formal SEI ATAM process. Its timing and prioritization suggestions are optional; a short workshop is not a completed formal ATAM evaluation.

### Phase 1: Presentation (Day 1)

1. **Business Drivers Presentation**
   - Stakeholders present business goals
   - Identify key quality attribute requirements
   - Document constraints

2. **Architecture Presentation**
   - Architect presents current architecture
   - Explain approaches to quality attributes
   - Document known risks

### Phase 2: Investigation (Day 2)

3. **Identify Architectural Approaches**
   - Catalog patterns and tactics used
   - Map approaches to quality attributes

4. **Generate Quality Attribute Utility Tree**
   - Brainstorm quality scenarios
   - Organize into hierarchical tree
   - Prioritize scenarios (H/M/L for importance and difficulty)

### Phase 3: Analysis (Day 3)

5. **Analyze Architectural Approaches**
   - Walk through high-priority scenarios
   - Identify sensitivity points
   - Document trade-offs

6. **Present Results**
   - Summarize findings
   - Document risks and non-risks
   - Create action items

## The Utility Tree

The utility tree is the core artifact for organizing quality requirements.

### Structure

```
Quality (Utility)
├── [Quality Attribute 1]
│   ├── [Factor 1]
│   │   ├── Scenario A (H, H) - Importance, Difficulty
│   │   └── Scenario B (H, M)
│   └── [Factor 2]
│       └── Scenario C (M, H)
├── [Quality Attribute 2]
│   └── ...
```

### Prioritization Matrix

For each scenario, assign:

| Priority | Importance | Difficulty | Action                                                                           |
| -------- | ---------- | ---------- | -------------------------------------------------------------------------------- |
| (H, H)   | High       | High       | **Critical** - Architecturally significant                                       |
| (H, M)   | High       | Medium     | **Important** - Validate approach                                                |
| (H, L)   | High       | Low        | **Monitor** - Should be achievable                                               |
| (M, H)   | Medium     | High       | **Review** - May need simplification                                             |
| (M, M)   | Medium     | Medium     | **Document** - Standard implementation                                           |
| (M, L)   | Medium     | Low        | **Defer** - Address if time permits                                              |
| (L, *)   | Low        | Any        | **Lower analysis priority** - Do not change approved scope without authorization |

### Example Utility Tree

```
System Quality
├── Performance
│   ├── Latency
│   │   ├── API response < 200ms (H, H)
│   │   └── Page load < 3s on 3G (H, M)
│   └── Throughput
│       └── Handle 10k concurrent users (H, H)
├── Security
│   ├── Confidentiality
│   │   ├── Encrypt PII at rest (H, M)
│   │   └── TLS 1.3 for all connections (H, L)
│   └── Authentication
│       └── MFA for admin access (H, L)
├── Availability
│   └── Uptime
│       └── 99.9% during business hours (H, H)
└── Maintainability
    ├── Modifiability
    │   └── Deploy new feature in < 1 day (M, H)
    └── Testability
        └── 80% code coverage (M, M)
```

## Key Concepts

### Sensitivity Points

Architecture decisions that significantly impact quality attributes.

**Example:**

- Decision: Use synchronous communication between services
- Sensitivity: Impacts availability (cascading failures) and performance (latency)

### Trade-off Points

Decisions that positively affect one quality attribute while negatively affecting another.

**Common Trade-offs:**

| Decision              | Positive Impact | Negative Impact         |
| --------------------- | --------------- | ----------------------- |
| Database caching      | Performance     | Consistency             |
| End-to-end encryption | Security        | Performance             |
| Microservices         | Scalability     | Complexity, Performance |
| Strong typing         | Maintainability | Development speed       |
| Audit logging         | Security        | Performance, Storage    |

### Risks vs Non-Risks

**Risk:** Architecture decision that may cause problems

- "Using a single database instance creates availability risk"

**Non-Risk:** Architecture decision that appropriately addresses requirements

- "Circuit breaker pattern mitigates cascading failure risk"

## Workshop Facilitation

### Before the Workshop

1. **Prepare materials:**
   - Architecture diagrams
   - Current quality requirements
   - ISO 25010 checklist

2. **Invite stakeholders:**
   - Business representatives
   - Architects
   - Developers
   - Operations/DevOps
   - Security team
   - End users (if possible)

3. **Set agenda:**
   - 4-6 hours for utility tree generation
   - Agree duration and scope with participants; formal ATAM requires its own process and preparation

### During the Workshop

#### Step 1: Context Setting (30 min)

- Explain ATAM process
- Review business drivers
- Clarify scope

#### Step 2: Quality Attribute Brainstorming (60 min)

Use ISO 25010 as a checklist:

```
For each characteristic:
1. Ask: "Is this relevant to our system?"
2. If yes: "What specific scenarios matter?"
3. Write scenarios on sticky notes/cards
4. Group by similarity
```

#### Step 3: Build Utility Tree (90 min)

1. **Start with root:** "System Quality"
2. **Add branches:** Quality attributes (Performance, Security, etc.)
3. **Add sub-branches:** Factors or sub-characteristics
4. **Attach leaves:** Scenarios with priorities

**Facilitation Tips:**

- Use whiteboard or digital collaboration tool
- Encourage specific, measurable scenarios
- Challenge vague requirements
- Capture trade-off discussions

#### Step 4: Prioritization (60 min)

For each scenario:

1. **Importance:** How critical to business success? (1-5)
2. **Difficulty:** How hard to achieve? (1-5)
3. **Mark:** (H/M/L) based on thresholds

**Thresholds example:**

- High: Score 4-5
- Medium: Score 2-3
- Low: Score 1

#### Step 5: Analysis of High-Priority Scenarios (Remaining time)

For each (H,H) and (H,M) scenario:

1. Walk through architecture
2. Identify sensitivity points
3. Document risks and non-risks
4. Note trade-offs

### After the Workshop

1. **Document results:**
   - Final utility tree
   - Prioritized scenarios
   - Risk list
   - Trade-off analysis

2. **Create action items:**
   - Address high risks
   - Validate architectural approaches
   - Update architecture documentation

3. **Communicate:**
   - Share results with stakeholders
   - Update project plans
   - Schedule follow-up reviews

## ATAM Light (Simplified Version)

For smaller projects or time-constrained situations:

### 2-Hour Mini-ATAM

1. **Introduction (15 min)**
   - Business context
   - Architecture overview

2. **Utility Tree Generation (45 min)**
   - Brainstorm top 3-5 quality attributes
   - Write 2-3 scenarios per attribute
   - Quick prioritization (H/M/L)

3. **Scenario Walkthrough (45 min)**
   - Analyze top 5 scenarios
   - Identify risks and trade-offs

4. **Wrap-up (15 min)**
   - Summarize findings
   - Define next steps

## Integration with arc42

### Chapter 1.2 (Quality Goals)

- Document top 3-5 quality goals
- High-level, stakeholder-facing

### Chapter 10 (Quality Requirements)

- Full utility tree
- Detailed scenarios
- Prioritization matrix
- Trade-off analysis

### Chapter 9 (Architecture Decisions)

- Reference quality requirements
- Document decisions made to satisfy scenarios
- Explain trade-offs

### Chapter 4 (Solution Strategy)

- Map architectural approaches to quality attributes
- Show how tactics address scenarios

## Common Pitfalls

### 1. Too Many Scenarios

- **Problem:** 50+ scenarios, all "high priority"
- **Solution:** Limit to 15-20, force ranking

### 2. Vague Scenarios

- **Problem:** "System should be secure"
- **Solution:** Use 6-part structure, require measures

### 3. Missing Stakeholders

- **Problem:** Only developers participate
- **Solution:** Include business, ops, security

### 4. Ignoring Trade-offs

- **Problem:** Assume all qualities can be maximized
- **Solution:** Explicitly document and decide on trade-offs

### 5. No Follow-through

- **Problem:** Workshop results sit in document
- **Solution:** Create actionable items, assign owners

## Tools

- **Whiteboard + Sticky notes:** Best for in-person workshops
- **Miro / Mural:** Digital collaboration
- **PlantUML / Graphviz:** Generate tree diagrams
- **Excel / Sheets:** Prioritization matrices

## Further Reading

- SEI ATAM Technical Report (CMU/SEI-2000-TR-004)
- "Software Architecture in Practice" (Bass, Clements, Kazman)
- arc42 Quality Model: https://quality.arc42.org
