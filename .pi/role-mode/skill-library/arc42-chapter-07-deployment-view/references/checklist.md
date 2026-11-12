# Chapter 7 Review Checklist

Examples, priorities, and numerical targets are illustrative, not Situate commitments. Select relevant material from approved requirements and distinguish proposals from verified behavior.

Comprehensive checklist for reviewing arc42 Chapter 7 "Deployment View" documentation.

## Structure and Completeness

### Infrastructure Overview

- [ ] Level 1 infrastructure diagram exists
- [ ] All major environments documented (dev, test, prod)
- [ ] Geographical distribution shown (if applicable)
- [ ] Network topology illustrated
- [ ] Trust boundaries clearly marked

### Software-to-Hardware Mapping

- [ ] All building blocks from Chapter 5 mapped to infrastructure
- [ ] Deployment artifacts identified (containers, binaries, configs)
- [ ] m:n relationships explained
- [ ] Multiple deployment variants documented (if applicable)

### Configuration

- [ ] Environment variables documented
- [ ] Config file locations specified
- [ ] Default values listed
- [ ] Required vs. optional settings distinguished
- [ ] Setting impact explained
- [ ] Secret locations documented (not values!)

## Quality and Clarity

### Diagrams

- [ ] Diagrams use consistent notation
- [ ] All symbols defined or self-explanatory
- [ ] Diagrams readable at intended output size
- [ ] Cross-references to Chapter 5 building blocks clear
- [ ] Legend included for complex diagrams

### Tables

- [ ] Mapping table connects building blocks to nodes
- [ ] Configuration table includes all key settings
- [ ] Table columns are sortable/filterable (if digital)
- [ ] Units specified where applicable

### Text

- [ ] Motivation section explains "why this structure"
- [ ] Operational concerns addressed
- [ ] Technical terms defined or linked to glossary
- [ ] No duplication of Chapter 5 or 6 content

## Technical Accuracy

### Infrastructure

- [ ] Node specifications realistic (CPU, RAM, storage)
- [ ] Network bandwidth/latency documented
- [ ] Scaling mechanisms described
- [ ] Redundancy and failover explained
- [ ] Single points of failure identified

### Security

- [ ] Security zones/boundaries marked
- [ ] Data classification by zone
- [ ] Authentication/authorization points shown
- [ ] Encryption in transit documented
- [ ] Secret management approach specified

### Operations

- [ ] Monitoring approach mentioned
- [ ] Backup strategy documented
- [ ] Disaster recovery procedures referenced
- [ ] Maintenance windows considered
- [ ] Deployment procedures linked

## Consistency

### Cross-References

- [ ] Building block names match Chapter 5
- [ ] Interface references match Chapter 3
- [ ] Decision references match Chapter 9
- [ ] Quality goal references match Chapter 10

### Naming

- [ ] Consistent terminology throughout
- [ ] Environment names standardized
- [ ] Node naming follows convention
- [ ] Service names match runtime view

### Versioning

- [ ] Infrastructure versions noted (if relevant)
- [ ] Configuration format versions documented
- [ ] Deprecated settings marked

## Practical Usability

### For Developers

- [ ] Local development setup documented
- [ ] Required tools listed
- [ ] Environment setup steps clear
- [ ] Configuration override examples provided

### For Operators

- [ ] Production topology clear
- [ ] Scaling procedures referenced
- [ ] Troubleshooting guidance included
- [ ] Runbook links provided

### For Newcomers

- [ ] Can answer "where does this run?"
- [ ] Can answer "what do I need to configure?"
- [ ] High-level diagram understandable without deep context
- [ ] Terminology accessible or explained

## Common Issues to Check

### Anti-Patterns

- [ ] Not prod-only (dev/test included)
- [ ] Not mixing behavior with placement
- [ ] Configuration has structure, not chaos
- [ ] Operational boundaries documented
- [ ] Diagrams traceable to building blocks
- [ ] Not duplicating IaC code

### Missing Information

- [ ] Resource requirements specified
- [ ] Dependencies on external services noted
- [ ] License requirements mentioned
- [ ] Compliance considerations addressed

### Outdated Content

- [ ] Infrastructure matches current state
- [ ] Configuration options current
- [ ] Links to deployment assets valid
- [ ] Contact information current

## Sign-Off

- [ ] Reviewed by architect
- [ ] Reviewed by operations team
- [ ] Reviewed by security team (if applicable)
- [ ] Stakeholder feedback incorporated
- [ ] Version/date noted

## Quick Review Questions

Ask these to validate the deployment view:

1. Can a new developer set up their local environment using only this chapter?
2. Can an operator understand the production topology without asking questions?
3. Are all secrets referenced but never exposed?
4. Is the disaster recovery approach clear?
5. Can someone identify single points of failure?
6. Are scaling limits and triggers documented?
7. Is the network segmentation strategy understandable?
8. Do the diagrams match the text descriptions?

If all answers are "yes", your Chapter 7 is in good shape.
