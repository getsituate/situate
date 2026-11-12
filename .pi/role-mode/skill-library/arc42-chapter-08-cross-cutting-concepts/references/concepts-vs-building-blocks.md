# Concepts vs Building Blocks Decision Guide

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

This reference helps determine whether something should be documented as a cross-cutting concept (Chapter 8) or as a building block (Chapter 5).

## The Fundamental Question

```
┌─────────────────────────────────────────────────────────────┐
│  Does it describe a reusable PATTERN/RULE/PRINCIPLE?        │
│  (HOW something is done)                                    │
├─────────────────────────────────────────────────────────────┤
│  YES → Cross-cutting Concept (Chapter 8)                    │
│  NO  → Building Block (Chapter 5)                           │
└─────────────────────────────────────────────────────────────┘
```

## Decision Matrix

| Question                                       | If YES                | If NO                 |
| ---------------------------------------------- | --------------------- | --------------------- |
| Does it apply to **multiple** building blocks? | Cross-cutting Concept | Building Block        |
| Does it explain **HOW** things work?           | Cross-cutting Concept | Building Block        |
| Is it a **rule** developers must follow?       | Cross-cutting Concept | Building Block        |
| Can it be **instantiated** (has instances)?    | Building Block        | Cross-cutting Concept |
| Is it a **concrete component** in the system?  | Building Block        | Cross-cutting Concept |

## Concrete Examples

### Example 1: Authentication

**Scenario**: Users log in with username/password and receive a JWT token.

**Building Block View (Chapter 5)**:

```
[Auth Service] - Component that issues tokens
├── LoginController - Handles login requests
├── TokenGenerator - Creates JWT tokens
└── UserRepository - Validates credentials
```

**Cross-cutting Concept (Chapter 8)**:

```
8.1 JWT Authentication «jwt-auth»

All backend services validate JWT tokens from the Authorization header.
Rules:
- Tokens expire after 15 minutes
- Services must validate signature
- Claims include userId and roles
- Refresh tokens rotate on use
```

**Why both?**

- Building Block: Describes the Auth Service component
- Concept: Describes the pattern ALL services use for authentication

### Example 2: Error Handling

**Scenario**: The system returns consistent error responses.

**Building Block View (Chapter 5)**:

```
[Error Handler] - Global exception handler
├── ExceptionMapper - Maps exceptions to responses
└── ErrorResponseBuilder - Creates error JSON
```

**Cross-cutting Concept (Chapter 8)**:

```
8.2 Error Handling «error-handling»

All errors follow this JSON structure:
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "requestId": "correlation-id"
  }
}

Rules:
- Classify failures by the API contract, not status class alone; 408 and 429 may be retryable
- Retry only when the operation is safe to repeat or protected by an idempotency contract
- A timeout or 5xx response may leave the outcome unknown; reconcile uncertain effects
- All errors include requestId for tracing
```

### Example 3: Domain Model

**Scenario**: E-commerce system with Orders and Customers.

**Building Block View (Chapter 5)**:

```
[Order Service] - Manages orders
├── OrderController
├── OrderService
└── OrderRepository

[Customer Service] - Manages customers
├── CustomerController
├── CustomerService
└── CustomerRepository
```

**Cross-cutting Concept (Chapter 8)**:

```
8.1 Domain Model

Core entities and relationships:
- Order (aggregate root)
  - OrderLine (child entity)
  - Customer (reference)
- Business rules:
  - Order requires at least one line
  - Total = sum of line totals
```

**Why concept?** The domain model spans multiple services and defines shared understanding.

## Common Mistakes

### Mistake 1: Documenting Framework Usage

❌ **Wrong** (Cross-cutting Concept):

```
8.1 Spring Boot

We use Spring Boot for dependency injection...
```

✅ **Correct**: Don't document framework usage unless you have specific configuration patterns.

### Mistake 2: Single-Block "Concept"

❌ **Wrong** (Cross-cutting Concept):

```
8.1 Payment Processing

The Payment Service processes payments using Stripe...
```

✅ **Correct** (Building Block):

```
5.2 Payment Service

Processes payments using Stripe integration...
```

### Mistake 3: Redundant Documentation

❌ **Wrong** (Both places):

```
5.3 Order Service
The Order Service uses JWT authentication. It validates
tokens in the Authorization header...

8.1 JWT Authentication
All services use JWT authentication. They validate
tokens in the Authorization header...
```

✅ **Correct**:

```
5.3 Order Service «jwt-auth»
Manages order lifecycle...

8.1 JWT Authentication «jwt-auth»
All services validate JWT tokens from the
Authorization header...
```

## Quick Decision Tree

```
Start
│
├─ Is it a specific component/instance?
│  ├─ YES → Building Block (Chapter 5)
│  └─ NO → Continue
│
├─ Does it explain HOW multiple components work?
│  ├─ YES → Continue
│  └─ NO → Architecture Decision (Chapter 9) or Runtime View (Chapter 6)
│
├─ Is it a pattern/rule/principle?
│  ├─ YES → Cross-cutting Concept (Chapter 8)
│  └─ NO → Re-evaluate
│
└─ Does it apply to multiple building blocks?
   ├─ YES → Cross-cutting Concept (Chapter 8) ✓
   └─ NO → Building Block (Chapter 5)
```

## Summary Table

| Document              | Chapter | Describes                  | Example                            |
| --------------------- | ------- | -------------------------- | ---------------------------------- |
| Building Block        | 5       | WHAT components exist      | "Payment Service handles payments" |
| Cross-cutting Concept | 8       | HOW things work (patterns) | "All services use JWT auth"        |
| Architecture Decision | 9       | WHY choices were made      | "We chose JWT over sessions"       |
| Runtime Scenario      | 6       | WHEN things happen         | "Order processing flow"            |

## Key Takeaway

> **Building Blocks** are the actors in your architecture.
> **Cross-cutting Concepts** are the rules they all follow.

Use stereotypes («concept-name») to link building blocks to the concepts they implement.
