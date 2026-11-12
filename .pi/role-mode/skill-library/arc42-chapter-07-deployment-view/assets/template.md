# Chapter 7: Deployment View - Template

Adapt this template to the existing AsciiDoc chapter or ADR format. Example infrastructure, settings, and targets are hypothetical; retain only supported project facts.

Copy this template as a starting point for your arc42 Chapter 7 documentation.

---

## 7. Deployment View

<Short introduction describing the environments your system runs in and any operational priorities or constraints.>

Example:

> The system operates in three environments: local development (Docker Compose), staging (single Kubernetes cluster), and production (multi-region Kubernetes). This chapter focuses primarily on the production deployment while referencing the other environments where they differ significantly.

---

### 7.1 Infrastructure Level 1

<Insert your main deployment diagram here. This should show the highest level view of your infrastructure: nodes, connections, trust boundaries, and where building blocks run.>

**Diagram Options:**

- UML Deployment Diagram (formal, tool-supported)
- Network Topology Diagram (intuitive for ops teams)
- Cloud Architecture Diagram (using provider icons)

#### Motivation

<Explain why this deployment structure was chosen. What drove the decisions?>

Example:

> The multi-region deployment ensures high availability with RPO < 1 hour and RTO < 4 hours. The primary region handles all write traffic while read replicas in secondary regions serve local traffic to minimize latency for global users.

#### Quality and/or Performance Features

<Document relevant infrastructure qualities if they are architecturally significant.>

| Aspect         | Target  | Implementation                                           |
| :------------- | :------ | :------------------------------------------------------- |
| Availability   | 99.9%   | Multi-AZ deployment with automatic failover              |
| Latency (p99)  | < 200ms | CDN + edge caching                                       |
| Throughput     | 10k RPS | Horizontal pod autoscaling                               |
| Data Residency | EU-only | Primary region in Frankfurt, no cross-border replication |

#### Mapping: Building Blocks to Infrastructure

<Table showing which building blocks (from Chapter 5) run on which infrastructure elements.>

| Building Block  | Runs On                  | Notes                                   |
| :-------------- | :----------------------- | :-------------------------------------- |
| <Block Name>    | <Node/Container/Service> | <Scaling, redundancy, or other notes>   |
| Web Frontend    | CDN + S3                 | Static assets, edge-cached globally     |
| API Gateway     | Kubernetes (Ingress)     | Nginx ingress controller, rate limiting |
| Order Service   | Kubernetes (Pods)        | 3-5 replicas, HPA based on CPU          |
| Payment Service | Kubernetes (Pods)        | 2-3 replicas, critical path             |
| PostgreSQL      | RDS (Primary + Replica)  | Multi-AZ, automated backups             |
| Redis           | ElastiCache              | Session store, cache layer              |

#### Configuration

<Document the key runtime configuration settings. Focus on what changes behavior and where it's set.>

**Configuration Model:**
<Explain how configuration is loaded: environment variables, config files, secret managers, etc.>

Example:

> Configuration follows a hierarchy: Environment Variables → Config Maps → Default Values. Secrets are injected via AWS Secrets Manager at pod startup.

**Key Settings:**

| Key / Setting         | Default | Required | Where Set            | What It Influences             |
| :-------------------- | :------ | :------- | :------------------- | :----------------------------- |
| `LOG_LEVEL`           | `info`  | No       | Environment Variable | Application logging verbosity  |
| `DB_MAX_CONNECTIONS`  | `20`    | No       | ConfigMap            | Database connection pool size  |
| `FEATURE_FLAG_NEW_UI` | `false` | No       | Feature Flag Service | UI component visibility        |
| `API_RATE_LIMIT`      | `1000`  | No       | Environment Variable | Requests per minute per client |
| `PAYMENT_API_KEY`     | -       | Yes      | AWS Secrets Manager  | External payment provider auth |

**Environment-Specific Values:**

| Setting         | Development | Staging      | Production                                           |
| :-------------- | :---------- | :----------- | :--------------------------------------------------- |
| `LOG_LEVEL`     | `debug`     | `info`       | `warn`                                               |
| `DB_HOST`       | `localhost` | `staging-db` | `prod-db.cluster-xyz.eu-central-1.rds.amazonaws.com` |
| `REPLICA_COUNT` | `1`         | `2`          | `3`                                                  |

---

### 7.2 Infrastructure Level 2

<Zoom into specific infrastructure elements from Level 1 that need more detail. Create a subsection for each element that warrants deeper documentation.>

#### 7.2.1 <Infrastructure Element Name>

<Diagram or description of the internal structure of this element.>

Example: "Kubernetes Cluster - Production"

##### Internal Structure

<Describe the internal components, node pools, namespaces, etc.>

Example:

> The production cluster consists of:
>
> - **Control Plane**: Managed by AWS EKS across 3 AZs
> - **Node Pools**:
>   - `general`: 3-10 nodes (t3.large) for general workloads
>   - `compute`: 2-5 nodes (c5.xlarge) for CPU-intensive tasks
>   - `memory`: 2-4 nodes (r5.large) for cache and session stores
> - **Namespaces**: `frontend`, `backend`, `data`, `monitoring`, `ingress-nginx`

##### Configuration

<Settings specific to this infrastructure element.>

| Setting               | Value      | Purpose                          |
| :-------------------- | :--------- | :------------------------------- |
| Kubernetes Version    | 1.28       | Container orchestration platform |
| Cluster Autoscaler    | Enabled    | Automatic node scaling           |
| Pod Security Standard | Restricted | Security policy enforcement      |
| Network Plugin        | Calico     | Network policies and isolation   |

##### Operational Notes

<Any operational procedures, monitoring, or special considerations.>

Example:

> - **Monitoring**: Prometheus + Grafana in `monitoring` namespace
> - **Logging**: Fluent Bit → CloudWatch Logs
> - **Alerting**: PagerDuty integration for critical alerts
> - **Backup**: Velero for cluster state backup nightly

---

#### 7.2.2 <Another Infrastructure Element>

<Repeat structure as needed for other elements requiring detail.>

---

## Appendix: Deployment Assets

<Links to the actual deployment artifacts. This keeps Chapter 7 as the map while pointing to the construction crew.>

| Asset Type      | Location                     | Description                       |
| :-------------- | :--------------------------- | :-------------------------------- |
| Docker Images   | `docker.io/myorg/`           | Container images for all services |
| Helm Charts     | `/deploy/helm/`              | Kubernetes deployment charts      |
| Terraform       | `/infrastructure/terraform/` | Infrastructure as Code            |
| Docker Compose  | `/docker-compose.yml`        | Local development setup           |
| CI/CD Pipelines | `/.github/workflows/`        | Deployment automation             |

---

## Appendix: Environment Overview

<Quick reference for all environments.>

| Environment | Purpose           | Infrastructure         | Access            |
| :---------- | :---------------- | :--------------------- | :---------------- |
| Local       | Development       | Docker Compose         | Developer laptops |
| CI          | Automated testing | GitHub Actions runners | CI system only    |
| Staging     | Pre-production    | Single-region K8s      | Team internal     |
| Production  | Live system       | Multi-region K8s       | Restricted        |
