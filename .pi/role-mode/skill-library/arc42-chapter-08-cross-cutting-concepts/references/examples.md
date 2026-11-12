# Cross-cutting Concepts Examples

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

This reference provides concrete examples of well-documented cross-cutting concepts for inspiration.

## Table of Contents

1. [Domain Model Example](#domain-model-example)
2. [Security Concept Example](#security-concept-example)
3. [Error Handling Example](#error-handling-example)
4. [Logging Concept Example](#logging-concept-example)
5. [Persistence Concept Example](#persistence-concept-example)
6. [API Design Example](#api-design-example)

---

## Domain Model Example

### Concept: Order Management Domain Model

**Applies to**: Order Service, Payment Service, Shipping Service, Notification Service

**Description**:
The domain model defines the core entities and their relationships for order management across all services.

**Key Entities**:

| Entity    | Responsibility         | Key Attributes                         |
| --------- | ---------------------- | -------------------------------------- |
| Order     | Central aggregate root | orderId, customerId, status, createdAt |
| OrderLine | Individual line items  | productId, quantity, price             |
| Customer  | Order initiator        | customerId, email, shippingAddress     |
| Payment   | Financial transaction  | paymentId, amount, status, method      |

**Business Rules**:

1. An Order must have at least one OrderLine
2. Order total must equal sum of all OrderLine totals
3. Order status transitions: CREATED → CONFIRMED → PAID → SHIPPED → DELIVERED
4. Cancellation allowed only before SHIPPED status

**Implementation Notes**:

- All entities use UUID for identifiers
- Immutable value objects for Money, Address
- Aggregate roots enforce invariants

---

## Security Concept Example

### Concept: JWT-Based Authentication «jwt-auth»

**Applies to**: All backend services (Order, Payment, User, Inventory)

**Overview**:
All service-to-service and client-to-service communication uses JWT tokens for authentication and authorization.

**Token Structure**:

```json
{
  "sub": "user-123",
  "roles": ["USER", "PREMIUM"],
  "iat": 1640995200,
  "exp": 1640996100,
  "jti": "unique-token-id"
}
```

**Workflow**:

1. **Token Acquisition**
   - Client authenticates with Auth Service using credentials
   - Auth Service returns access token (15 min expiry) and refresh token (7 days)

2. **Token Usage**
   - Include in Authorization header: `Bearer <token>`
   - Services verify the signature with the configured verification key and allowed algorithms, then validate issuer, audience, expiry, and other required claims

3. **Token Refresh**
   - Use refresh token to obtain new access token
   - Refresh tokens are rotated on each use

**Implementation Rules**:

```java
// All controllers use @PreAuthorize
@RestController
public class OrderController {

    @PreAuthorize("hasRole('USER')")
    @PostMapping("/orders")
    public ResponseEntity<Order> createOrder(@RequestBody CreateOrderRequest request) {
        // Implementation
    }

    @PreAuthorize("hasRole('ADMIN') or @orderSecurity.isOwner(#orderId, authentication)")
    @GetMapping("/orders/{orderId}")
    public ResponseEntity<Order> getOrder(@PathVariable String orderId) {
        // Implementation
    }
}
```

**Security Requirements**:

- Tokens must be transmitted over HTTPS only
- Access tokens expire after 15 minutes
- Refresh tokens are single-use
- Failed authentication returns 401, insufficient permissions return 403

---

## Error Handling Example

### Concept: Consistent Error Responses «error-handling»

**Applies to**: All REST API endpoints

**Error Response Structure**:

```json
{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order with id 'ORD-123' not found",
    "details": {
      "orderId": "ORD-123",
      "timestamp": "2024-01-15T10:30:00Z"
    },
    "path": "/api/v1/orders/ORD-123",
    "requestId": "req-abc-123"
  }
}
```

**HTTP Status Codes**:

| Code | Usage                      | Example                               |
| ---- | -------------------------- | ------------------------------------- |
| 400  | Bad Request - client error | Invalid input, validation failed      |
| 401  | Unauthorized               | Missing or invalid token              |
| 403  | Forbidden                  | Valid token, insufficient permissions |
| 404  | Not Found                  | Resource doesn't exist                |
| 409  | Conflict                   | Business rule violation               |
| 422  | Unprocessable Entity       | Semantic validation failed            |
| 500  | Internal Server Error      | Unexpected server error               |

**Implementation Pattern**:

```java
@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleOrderNotFound(
            OrderNotFoundException ex,
            WebRequest request) {

        ErrorResponse error = ErrorResponse.builder()
            .code("ORDER_NOT_FOUND")
            .message(ex.getMessage())
            .details(Map.of("orderId", ex.getOrderId()))
            .path(request.getDescription(false))
            .requestId(MDC.get("requestId"))
            .build();

        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneric(Exception ex) {
        // Log stack trace, return generic message
        ErrorResponse error = ErrorResponse.builder()
            .code("INTERNAL_ERROR")
            .message("An unexpected error occurred")
            .requestId(MDC.get("requestId"))
            .build();

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
```

**Logging Requirements**:

- All 5xx errors logged with full stack trace
- All 4xx errors logged at WARN level
- Include requestId for correlation

---

## Logging Concept Example

### Concept: Structured Logging with Correlation IDs «logging»

**Applies to**: All services

**Log Format**:
All logs are output as JSON with consistent fields:

```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "INFO",
  "logger": "com.example.OrderService",
  "message": "Order created successfully",
  "thread": "http-nio-8080-exec-1",
  "correlationId": "corr-abc-123",
  "requestId": "req-xyz-789",
  "userId": "user-456",
  "context": {
    "orderId": "ORD-789",
    "customerId": "CUST-123"
  }
}
```

**Log Levels**:

| Level | Usage                | Example                          |
| ----- | -------------------- | -------------------------------- |
| ERROR | Unexpected failures  | Database connection lost         |
| WARN  | Recoverable issues   | Retry attempt failed             |
| INFO  | Significant events   | Order created, payment processed |
| DEBUG | Detailed diagnostics | SQL queries, request details     |
| TRACE | Very detailed        | Method entry/exit                |

**Correlation ID Propagation**:

1. **Entry Point**: Gateway generates correlationId if not present
2. **Propagation**: Passed via X-Correlation-Id header
3. **MDC**: Stored in Mapped Diagnostic Context for all log entries
4. **Downstream**: Included in all service calls

**Implementation**:

```java
// Filter to extract/set correlation ID
@Component
public class CorrelationIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) {
        String correlationId = request.getHeader("X-Correlation-Id");
        if (correlationId == null) {
            correlationId = UUID.randomUUID().toString();
        }

        MDC.put("correlationId", correlationId);
        response.setHeader("X-Correlation-Id", correlationId);

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}

// Usage in code
@Service
public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    public Order createOrder(CreateOrderRequest request) {
        log.info("Creating order for customer: {}", request.getCustomerId());
        // Implementation
        log.info("Order created: {}", order.getId());
        return order;
    }
}
```

---

## Persistence Concept Example

### Concept: Database Access and Transaction Boundaries «persistence»

**Applies to**: All services with database access

**Architecture**:

- **Repository Pattern**: All database access through repository interfaces
- **Transaction Boundaries**: Defined at service layer
- **Optimistic Locking**: Version field for concurrent updates

**Transaction Rules**:

1. **Read-Only Transactions**: Use for queries

   ```java
   @Transactional(readOnly = true)
   public Order getOrder(String orderId) { }
   ```

2. **Write Transactions**: Default for modifications

   ```java
   @Transactional
   public Order createOrder(CreateOrderRequest request) { }
   ```

3. **Transaction Boundaries**: One transaction per business operation
   - Don't span multiple service calls
   - Don't span external API calls

**Entity Design**:

```java
@Entity
@Table(name = "orders")
public class Order {
    @Id
    private UUID id;

    @Version
    private Long version; // Optimistic locking

    @Column(nullable = false)
    private String customerId;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    @JoinColumn(name = "order_id")
    private List<OrderLine> lines = new ArrayList<>();

    // Getters, setters, business methods
}
```

**Query Patterns**:

- Use Spring Data JPA for simple queries
- Use @Query for complex JPQL
- Use EntityManager for dynamic queries
- Always limit result sets

**Performance Guidelines**:

- Use FetchType.LAZY for associations
- Use @EntityGraph for eager fetching when needed
- Batch operations for bulk inserts
- Index frequently queried columns

---

## API Design Example

### Concept: REST API Design Conventions «api-design»

**Applies to**: All REST endpoints

**URL Structure**:

```
/api/{version}/{resource}/{id}/{sub-resource}
```

Examples:

- `GET /api/v1/orders` - List orders
- `GET /api/v1/orders/123` - Get specific order
- `POST /api/v1/orders` - Create order
- `PUT /api/v1/orders/123` - Update order
- `DELETE /api/v1/orders/123` - Delete order
- `GET /api/v1/orders/123/items` - Get order items

**HTTP Methods**:

| Method | Usage             | Idempotent                        |
| ------ | ----------------- | --------------------------------- |
| GET    | Retrieve resource | Yes                               |
| POST   | Create resource   | No                                |
| PUT    | Full update       | Yes                               |
| PATCH  | Partial update    | Depends on the operation contract |
| DELETE | Remove resource   | Yes                               |

**Request/Response Patterns**:

**Collection Response**:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "size": 20,
    "totalElements": 150,
    "totalPages": 8
  },
  "links": {
    "self": "/api/v1/orders?page=1",
    "next": "/api/v1/orders?page=2",
    "last": "/api/v1/orders?page=8"
  }
}
```

**Query Parameters**:

- `?page=1&size=20` - Pagination
- `?sort=createdAt,desc` - Sorting
- `?status=ACTIVE` - Filtering
- `?fields=id,name,status` - Field selection

**Versioning Strategy**:

- URL path versioning: `/api/v1/`, `/api/v2/`
- Breaking changes require new version
- Support current and previous version
- Deprecation headers for old versions

**Idempotency**:

For non-idempotent operations (POST, PATCH), support idempotency keys:

```
POST /api/v1/orders
Idempotency-Key: unique-key-123

{
  "customerId": "CUST-123",
  "items": [...]
}
```

**Response Codes**:

- 200 OK - Success
- 201 Created - Resource created
- 204 No Content - Success, no body
- 400 Bad Request - Validation error
- 401 Unauthorized - Authentication required
- 403 Forbidden - Permission denied
- 404 Not Found - Resource not found
- 409 Conflict - Business rule violation
- 429 Too Many Requests - Rate limit exceeded

---

## Summary

These examples demonstrate:

1. **Clear scope** - Each concept affects multiple building blocks
2. **Practical focus** - HOW it works, not abstract theory
3. **Code examples** - Concrete implementation guidance
4. **Consistency** - Patterns applied uniformly across the system
5. **Traceability** - Clear indication of which components use the concept

Use these as templates when documenting your own cross-cutting concepts.
