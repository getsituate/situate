# Cross-cutting Concepts Checklist

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Use this checklist when identifying and documenting cross-cutting concepts for your arc42 documentation.

## Phase 1: Identification

### Step 1: Review Your System

Look for patterns, rules, or approaches that appear in multiple places:

- [ ] **Domain Model**: Core business entities used across services
- [ ] **Security**: Authentication, authorization, encryption patterns
- [ ] **Error Handling**: How errors are structured and handled
- [ ] **Logging**: Logging format, levels, correlation IDs
- [ ] **Persistence**: Database access patterns, transaction boundaries
- [ ] **API Design**: REST conventions, versioning, pagination
- [ ] **Communication**: Service-to-service communication patterns
- [ ] **Caching**: Caching strategies and invalidation rules
- [ ] **Configuration**: How configuration is managed
- [ ] **Validation**: Input validation approaches
- [ ] **Testing**: Testing strategies and patterns
- [ ] **Deployment**: Build and deployment approaches

### Step 2: Filter by Relevance

For each potential concept, ask:

- [ ] Does this affect **multiple building blocks**? (Not just one)
- [ ] Is this **essential** for understanding the architecture?
- [ ] Does it provide **conceptual integrity** (consistency)?
- [ ] Would developers need this to **implement** features correctly?
- [ ] Is this **specific to your system** (not just framework usage)?

**If NO to any question → Don't document as cross-cutting concept**

### Step 3: Prioritize

Rank identified concepts by importance:

Prioritize by the system's actual quality goals, affected components, and risks. No concept category is mandatory merely because it appears in this checklist; there is no target count.

---

## Phase 2: Documentation

### For Each Concept, Verify:

#### Content Quality

- [ ] **Name**: Clear, intention-revealing name (e.g., «jwt-auth», «circuit-breaker»)
- [ ] **Scope**: Clearly states which building blocks are affected
- [ ] **Explanation**: Describes HOW it works, not just WHAT it is
- [ ] **Rules**: Specific guidelines developers must follow
- [ ] **Examples**: Code snippets or references to real implementation
- [ ] **Rationale**: Why this approach was chosen (brief)

#### Technical Accuracy

- [ ] **Status**: Distinguishes accepted design, proposed mechanisms, and verified implementation
- [ ] **Complete**: Covers all important aspects
- [ ] **Consistent**: Uses same terminology as rest of documentation
- [ ] **Correct**: Technical details are accurate

#### Integration

- [ ] **Building Block Links**: Stereotypes or references in Chapter 5
- [ ] **Glossary Links**: Technical terms linked to glossary
- [ ] **ADR Links**: Related architecture decisions referenced
- [ ] **No Redundancy**: Doesn't repeat building block descriptions

---

## Phase 3: Review

### Self-Review Questions

- [ ] Can a new developer understand HOW to implement features after reading?
- [ ] Are all concepts truly cross-cutting (not single-block)?
- [ ] Is the number of concepts reasonable (not overwhelming)?
- [ ] Are code examples tested and working?
- [ ] Would I want to read this if I joined the project?

### Anti-Pattern Check

- [ ] **No Concept Overload**: Related concepts are grouped for navigation without omitting significant rules
- [ ] **No Single-Block Concepts**: All affect multiple blocks
- [ ] **No Framework Docs**: Only document your specific usage
- [ ] **No Abstract Theories**: Concrete, practical guidance
- [ ] **No Redundancy**: Doesn't duplicate Building Block View

### Link Verification

- [ ] All stereotypes («concept-name») match concept names
- [ ] All building blocks reference applicable concepts
- [ ] All external references are valid
- [ ] Glossary terms are linked

---

## Common Concept Categories

### Essential (Most Systems)

```
8.1 Domain Model / Business Concepts
8.2 Security (Authentication & Authorization)
8.3 Error Handling
8.4 Persistence / Data Access
```

### Common (Many Systems)

```
8.5 Logging & Monitoring
8.6 API Design Conventions
8.7 Communication Patterns
8.8 Caching Strategy
```

### Optional (Specific Needs)

```
8.9 Internationalization (i18n)
8.10 Event Handling / Messaging
8.11 Batch Processing
8.12 Circuit Breaker / Resilience
```

---

## Quick Reference: Is It a Cross-cutting Concept?

| Scenario                                       | Chapter        | Reason                                    |
| ---------------------------------------------- | -------------- | ----------------------------------------- |
| "All services use JWT"                         | 8              | Rule affecting multiple blocks            |
| "Payment Service handles payments"             | 5              | Single building block responsibility      |
| "We use Spring Boot"                           | Don't document | Framework, not your concept               |
| "How to structure REST URLs"                   | 8              | Pattern across all APIs                   |
| "Order entity has these fields"                | 8              | Domain model (if shared) or 5 (if single) |
| "Why we chose PostgreSQL"                      | 9              | Architecture decision                     |
| "Request flows through Gateway → Service → DB" | 6              | Runtime scenario                          |

---

## Example Completed Checklist

### System: E-Commerce Platform

**Identified Concepts**:

1. ✅ Domain Model (Order, Customer, Product aggregates)
2. ✅ JWT Authentication (all services)
3. ✅ Error Handling (consistent API errors)
4. ✅ Structured Logging (correlation IDs)
5. ✅ Repository Pattern (data access)
6. ✅ REST API Conventions (URL structure, pagination)
7. ✅ Circuit Breaker (external service calls)
8. ✅ Event-Driven Communication (async processing)

**Excluded**:

- ❌ "Spring Boot Configuration" - Framework usage
- ❌ "Payment Processing" - Single service concern
- ❌ "Why Microservices" - Architecture decision (Chapter 9)

**Total**: 8 concepts ✅

---

## Final Check Before Publishing

- [ ] All concepts follow naming convention «descriptive-name»
- [ ] Each concept has 8.x heading
- [ ] Code examples compile and run
- [ ] Building blocks reference concepts with stereotypes
- [ ] No TODO or placeholder text remains
- [ ] Reviewed by at least one other team member
- [ ] Links to glossary for technical terms
- [ ] Consistent formatting throughout
