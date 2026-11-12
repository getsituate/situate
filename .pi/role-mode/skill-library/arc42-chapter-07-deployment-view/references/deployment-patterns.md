# Deployment Patterns Reference

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Common deployment patterns for arc42 Chapter 7 documentation.

## Pattern: Single Node Deployment

**When to Use**: Small systems, development environments, simple on-prem setups

### Structure

- One physical or virtual host
- All components co-located
- Shared database and message broker
- Simple reverse proxy for routing

### Example

```
[Docker Host]
├── [Web UI Container]
├── [Backend API Container]
├── [Database Container]
└── [Message Broker Container]
```

### Documentation Focus

- Container/resource limits
- Volume persistence strategy
- Local development setup
- Simple environment variables

---

## Pattern: Multi-Tier Deployment

**When to Use**: Web applications with clear separation of concerns

### Structure

- **Presentation Tier**: Load balancer + web servers
- **Application Tier**: Application servers/APIs
- **Data Tier**: Databases, caches, message queues

### Example

```
[Load Balancer]
    │
    ├── [Web Server 1] ──┐
    ├── [Web Server 2] ──┼── [App Server Cluster] ─── [Database Cluster]
    └── [Web Server N] ──┘
```

### Documentation Focus

- Load balancing strategy
- Session management
- Database replication
- Network segmentation

---

## Pattern: Microservices Deployment

**When to Use**: Distributed systems, independent service scaling

### Structure

- Container orchestration (Kubernetes, Docker Swarm)
- Service mesh for communication
- Independent scaling per service
- Shared infrastructure services

### Example

```
[Kubernetes Cluster]
├── [Ingress Controller]
├── [Namespace: Frontend]
│   ├── [Web UI Pod]
│   └── [Mobile API Pod]
├── [Namespace: Backend]
│   ├── [Order Service Pod]
│   ├── [Payment Service Pod]
│   └── [Notification Service Pod]
└── [Namespace: Data]
    ├── [PostgreSQL StatefulSet]
    ├── [Redis Cluster]
    └── [Kafka Cluster]
```

### Documentation Focus

- Service discovery mechanism
- Inter-service communication
- Scaling policies
- Resource quotas

---

## Pattern: Multi-Region Deployment

**When to Use**: High availability, disaster recovery, global user base

### Structure

- Primary and secondary regions
- Data replication between regions
- Global load balancing
- Failover mechanisms

### Example

```
[Global Load Balancer]
    │
    ├── [Region: US-East]
    │   ├── [App Cluster]
    │   ├── [Database Primary]
    │   └── [Cache Layer]
    │
    └── [Region: EU-West]
        ├── [App Cluster]
        ├── [Database Replica]
        └── [Cache Layer]
```

### Documentation Focus

- Replication lag and consistency
- Failover procedures
- Data residency compliance
- Cross-region latency

---

## Pattern: Hybrid Cloud Deployment

**When to Use**: Gradual cloud migration, regulatory requirements, cost optimization

### Structure

- On-premise components
- Cloud-native components
- Secure connectivity (VPN, Direct Connect)
- Data synchronization

### Example

```
[On-Premise DC] ←──VPN──→ [Cloud VPC]
├── [Legacy DB]           ├── [Cloud App Cluster]
├── [Mainframe]           ├── [Serverless Functions]
└── [File Shares]         └── [Cloud Storage]
```

### Documentation Focus

- Network connectivity
- Data flow and synchronization
- Security boundaries
- Migration strategy

---

## Pattern: Edge Deployment

**When to Use**: IoT, content delivery, low-latency requirements

### Structure

- Central cloud services
- Edge nodes/locations
- Local processing capabilities
- Sync mechanisms

### Example

```
[Cloud Control Plane]
    │
    ├── [Edge Node: Factory A]
    │   ├── [Local Gateway]
    │   ├── [Edge Database]
    │   └── [ML Inference]
    │
    └── [Edge Node: Store B]
        ├── [Local Gateway]
        └── [Edge Cache]
```

### Documentation Focus

- Edge autonomy capabilities
- Sync conflict resolution
- Bandwidth constraints
- Local storage limits

---

## Configuration Patterns

### Environment-Based Configuration

```yaml
# Development
LOG_LEVEL: debug
FEATURE_FLAGS:
  - experimental_ui
  - beta_api

# Production
LOG_LEVEL: warn
FEATURE_FLAGS:
  - stable_features_only
```

### Secret Management Patterns

These are deployment options for hypothetical systems, not script dependencies. Situate scripts consume supported environment variables or the private repository-root `.env` parsed as data; they do not fetch secrets or require a secret-manager CLI.

1. **Environment Variables**: Simple, 12-factor app style
2. **Secret Management Services**: AWS Secrets Manager, Azure Key Vault, HashiCorp Vault
3. **File-Based**: Mounted secrets in containers
4. **Configuration Servers**: Spring Cloud Config, Consul

### Documentation Template for Secrets

```markdown
| Secret Name | Purpose           | Location            | Rotation      |
| :---------- | :---------------- | :------------------ | :------------ |
| DB_PASSWORD | Database access   | AWS Secrets Manager | 90 days       |
| API_KEY     | External API auth | Kubernetes Secret   | On compromise |
```

---

## Network Topology Patterns

### DMZ Pattern

```
[Internet] → [Firewall] → [DMZ: Load Balancer] → [Firewall] → [Internal: App Servers]
```

### Zero Trust Pattern

```
[User/Device] → [Identity Verification] → [Policy Engine] → [Resource Access]
```

### Service Mesh Pattern

```
[Service A] ←→ [Sidecar Proxy] ←→ [Service Mesh Control Plane] ←→ [Sidecar Proxy] ←→ [Service B]
```

---

## Scaling Patterns

### Horizontal Pod Autoscaling (Kubernetes)

```yaml
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Database Read Replicas

```
[Write] → [Primary DB] → [Replication] → [Read Replica 1]
                                     → [Read Replica 2]
```

### CDN + Cache Layers

```
[User] → [CDN] → [Edge Cache] → [Origin Server] → [Database]
```

---

## Example: Complete Deployment Documentation

See the [chapter template](../assets/template.md) for a full example combining these patterns.
