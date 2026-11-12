---
name: performing-penetration-testing
description: Assess application and infrastructure security boundaries, validate suspected vulnerabilities, and report evidence and remediation. Use for requested security reviews or authorized penetration tests.
license: MIT
metadata:
  author: Jeremy Longshore <jeremy@intentsolutions.io>
---

# Penetration Tester

## Authorization and scope

Confirm the exact target, ownership, allowed techniques, environment, and data-handling limits before active testing. A request to review configuration is not permission to scan a public service or exploit a vulnerability. Prefer local synthetic fixtures and read-only configuration review when they answer the question.

Do not install scanners, contact external targets, submit private code to third parties, brute-force credentials, or perform destructive tests without explicit approval. Stop when a finding crosses the agreed boundary.

## Workflow

1. Read the affected code, deployment definitions, and existing security checks. Identify the trust boundary and plausible failure rather than assuming a scanner or plugin exists.
2. Select the smallest assessment that tests the concern: configuration review, dependency checks, a local reproduction, or an authorized scan. Confirm required tools are available; report missing prerequisites instead of claiming coverage.
3. Use synthetic data. Do not copy credentials, personal workspaces, customer data, or production logs into fixtures or reports.
4. Record reproducible evidence, affected versions or configuration, impact, and the limits of the assessment. Separate confirmed vulnerabilities from unverified suspicions.
5. Recommend a scoped correction and a regression check at the affected boundary. Do not claim compliance certification or absence of vulnerabilities from a limited review.
6. Remove owned temporary resources without deleting evidence the user requested. Report incomplete tests and uncertain external effects.

## Severity and reporting

Describe the attack preconditions, affected assets, demonstrated impact, remediation, and verification. Redact secrets and identifying details. Use OWASP, CWE, or CVE identifiers only when applicable and supported by evidence.

For CVSS scoring, the optional [calculator instructions](scripts/README.md) cover the bundled helper. It requires the external `cvss` Python package; do not install it automatically. A score complements evidence and does not establish exploitability.

## Sources and licensing

See [sources and licensing](SOURCES.md) for the upstream skill attribution and retained MIT notice.
