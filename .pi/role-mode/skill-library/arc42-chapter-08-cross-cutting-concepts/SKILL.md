---
name: arc42-chapter-08-cross-cutting-concepts
description: Best practices for arc42 Chapter 8 "Cross-cutting Concepts". Use when documenting cross-cutting architecture concepts, identifying reusable patterns, describing domain models, security concepts, error handling strategies, or explaining HOW the architecture works across multiple building blocks. Triggers on requests involving "cross-cutting concepts", "arc42 chapter 8", "architecture patterns", "domain model documentation", "security concept", "error handling concept", or when distinguishing concepts from building blocks.
---

# Cross-cutting concepts

The CTO documents mechanisms whose explanation would otherwise be repeated across components. Select concepts because they affect current design, not because they appear in a standard checklist.

For each concept, state the problem, affected components, governing rule, concrete mechanism, and relevant limits or failure behavior. Examples may include authorization, persistence, synchronization, error handling, configuration, or diagnostics, but none are mandatory without a system need.

Reference implementation locations or short representative examples for existing mechanisms. Label proposed mechanisms and unresolved choices. Explain system-specific behavior rather than teaching a framework or repeating component descriptions.

Link rationale to architecture decisions and expected outcomes to quality scenarios. Check that the same rule is described consistently in building-block and runtime views. If a rule applies to only one component, usually document it there instead.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## Core Principle

Cross-cutting concepts provide **solutions to recurring problems** that affect multiple building blocks. They explain HOW the architecture works, not WHAT it consists of (that's the Building Block View).

## Concepts vs Building Blocks

| Aspect       | Building Blocks (Chapter 5) | Cross-cutting Concepts (Chapter 8)    |
| ------------ | --------------------------- | ------------------------------------- |
| **Question** | WHAT is the structure?      | HOW does it work?                     |
| **Focus**    | Static decomposition        | Rules, patterns, principles           |
| **Scope**    | Individual components       | Multiple building blocks              |
| **Example**  | "Payment Service"           | "All services use JWT authentication" |

**Key distinction**: Building blocks are the "boxes" in your architecture; concepts are the rules that govern how those boxes behave.

## When to Use Cross-cutting Concepts

Document a concept when it:

- Applies to **multiple building blocks** (not just one)
- Provides **conceptual integrity** (consistency across the system)
- Contains **implementation rules** developers must follow
- Describes **recurring patterns** or approaches
- Cannot be assigned to a single building block

## Typical Cross-cutting Concepts

### Domain Concepts

- Domain models and business entities
- Business rules and invariants
- Domain-driven design patterns

### User Experience (UX)

- UI patterns and component libraries
- Internationalization (i18n) strategy
- Accessibility guidelines

### Safety & Security

- Authentication and authorization
- Data encryption (at rest and in transit)
- Input validation and sanitization
- Audit logging

### Architecture & Design Patterns

- Layered architecture rules
- Dependency injection patterns
- Event-driven architecture patterns
- Circuit breaker pattern

### "Under-the-Hood" Technical Concepts

- **Persistence**: ORM strategy, transaction boundaries
- **Error Handling**: Exception hierarchy, error responses
- **Logging**: Log levels, correlation IDs, structured logging
- **Communication**: Sync vs async, retry strategies
- **Caching**: Cache invalidation, TTL strategies
- **Configuration**: Externalized config, feature flags

### Development Concepts

- Build and deployment pipelines
- Code generation approaches
- Testing strategies

### Operational Concepts

- Monitoring and alerting
- Health checks
- Scaling strategies
- Disaster recovery

## Structure Guidelines

### Section Organization

```
8. Cross-cutting Concepts

8.1 [Concept Name]
    [Explanation of the concept]

8.2 [Concept Name]
    [Explanation of the concept]
```

### Recommended Number of Concepts

Choose concepts by architectural significance, not by count. Group related concepts and split large explanations when navigation becomes difficult.

**Rule of thumb**: Only document concepts that are essential for understanding the architecture. When in doubt, leave it out.

## Content Guidelines

### DO

- Explain **HOW** the concept works in practice
- Include **code examples** or reference implementations
- Link concepts to building blocks that use them
- Use intention-revealing names (e.g., «circuit-breaker», «jwt-auth»)
- Document decisions, not theories
- Show real examples from your codebase

### DON'T

- Don't document concepts that apply to only one building block
- Don't copy-paste large code blocks (reference them instead)
- Don't describe abstract theories without practical application
- Don't document standard framework usage (e.g., "we use Spring")
- Don't repeat what's in the Building Block View

## Linking Concepts to Building Blocks

Use stereotypes to mark building blocks that implement concepts:

```
[Building Block A] «jwt-auth»
[Building Block B] «jwt-auth»
[Building Block C] «circuit-breaker»
```

Then reference the concept in Chapter 8:

```
8.1 JWT Authentication «jwt-auth»

All backend services use JWT tokens for authentication...
```

## Anti-Patterns to Avoid

### 1. Concept Overload

❌ Documenting 15+ concepts because the template suggests them
✅ Select concepts that explain important shared rules in this system

### 2. Single-Block Concepts

❌ "Payment Service Concept" - describes only the payment service
✅ Move to Building Block View (Chapter 5)

### 3. Framework Documentation

❌ "Spring Boot Concept" - explaining how Spring Boot works
✅ Only document your specific configuration/usage

### 4. Abstract Theories

❌ "We believe in clean code"
✅ "All public methods must have null checks (see Example 8.1)"

### 5. Redundancy with Building Blocks

❌ Repeating building block descriptions in concepts
✅ Reference building blocks, explain the cross-cutting rule

## Quality Checklist

Before finalizing Chapter 8, verify:

- [ ] Each concept affects multiple building blocks
- [ ] Concepts explain HOW, not WHAT
- [ ] Code examples or references are included
- [ ] Building blocks reference applicable concepts
- [ ] Concepts are relevant and organized for lookup rather than selected to meet a quota
- [ ] Each concept has a clear, intention-revealing name
- [ ] Domain model is documented (if applicable)
- [ ] Security concepts are covered (if applicable)

## Example Structure

```asciidoc
== 8. Cross-cutting Concepts

=== 8.1 Domain Model

The core domain entities and their relationships...

[plantuml]
----
class Order {
  +OrderId id
  +CustomerId customerId
  +List<OrderLine> lines
}
----

=== 8.2 Authentication Concept «jwt-auth»

All backend services authenticate requests using JWT tokens.

.Workflow:
1. Client obtains token from Auth Service
2. Token included in Authorization header
3. Services validate token signature
4. Claims extracted for authorization

.Example:
[source,java]
----
@PreAuthorize("hasRole('USER')")
public Response createOrder(CreateOrderRequest request) {
    // Implementation
}
----

=== 8.3 Error Handling Concept

All errors follow a consistent structure...

=== 8.4 Circuit Breaker «circuit-breaker»

External service calls use circuit breaker pattern...
```

## References

Read [concept examples](references/examples.md) for representative structures, the [concepts vs. building blocks guide](references/concepts-vs-building-blocks.md) when placement is unclear, and the [review checklist](references/checklist.md) before finalizing a concept.

For arc42 guidance, see:

- [arc42 Concepts Documentation](https://docs.arc42.org/section-8/)
- [Tip 8-1: Explain the Concepts](https://docs.arc42.org/tips/8-1/)
- [Tip 5-10: Use crosscutting concepts for similarities](https://docs.arc42.org/tips/5-10/)
- [Tip 8-11: Hyperlink between Building Blocks and Concepts](https://docs.arc42.org/tips/8-11/)

## Quick Decision Tree

```
Should this be a cross-cutting concept?
│
├─ Does it apply to multiple building blocks?
│  ├─ NO → Document in Building Block View (Chapter 5)
│  └─ YES → Continue
│
├─ Does it explain HOW something works?
│  ├─ NO → Might be Building Block or ADR (Chapter 9)
│  └─ YES → Continue
│
├─ Is it a rule/pattern/principle?
│  ├─ NO → Might be runtime scenario (Chapter 6)
│  └─ YES → Cross-cutting Concept ✓
```
