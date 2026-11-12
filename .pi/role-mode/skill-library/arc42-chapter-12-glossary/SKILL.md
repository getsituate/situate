---
name: arc42-chapter-12-glossary
description: Best practices for creating and maintaining arc42 Chapter 12 "Glossary". Use when writing glossary entries, defining domain terms, documenting technical terminology, creating ubiquitous language references, or explaining abbreviations in arc42 architecture documentation.
---

# Glossary

The CEO maintains the meaning of domain terms with user input; the CTO contributes system-specific technical terms. Use one shared vocabulary rather than role-specific glossaries.

Read actual term usage before defining it. Include terms whose ambiguity, abbreviation, or specialized meaning could cause misunderstanding. There is no minimum entry count. Avoid a general technology encyclopedia.

For each entry, provide a preferred term and a concise definition. Identify meaningful synonyms, distinguish concepts that happen to share a name, and cross-reference related definitions. Where a term has different meanings in different contexts, name those contexts instead of forcing a false equivalence.

Keep business definitions independent of incidental implementation details. Sort entries for lookup and use working AsciiDoc anchors for references. Check for circular definitions and inconsistent usage across the catalog and architecture. Ask before redefining agreed concepts; unresolved terminology should remain visibly open.

Examples and template values below are hypothetical, not Situate requirements or implementation evidence. Use the repository's AsciiDoc structure and approved catalog targets; adapt formats without creating parallel specifications.

## When to Use This Skill

Use when:

- Creating or updating an arc42 glossary (Section 12)
- Defining domain terms for business stakeholders
- Documenting technical terminology
- Establishing ubiquitous language (DDD)
- Explaining abbreviations and acronyms
- Translating terms for multi-language teams
- Reviewing glossary quality

## Core Principles

### 1. Purpose of the Glossary

The glossary ensures all stakeholders share identical understanding of important terms:

- Identifies a preferred term and records meaningful synonyms
- Distinguishes homonyms by context rather than forcing one meaning
- Serves as normative translation reference
- Documents "ubiquitous language" from Domain-Driven Design

### 2. Content Scope

Include:

- **Domain Terms**: Business concepts specific to your problem space (e.g., "Policy", "Claim", "Underwriting" in insurance)
- **Technical Terms**: System-specific technical concepts (e.g., "Aggregation Root", "Event Stream", "Circuit Breaker")
- **Abbreviations**: All non-obvious acronyms and short forms
- **Synonyms**: Document preferred term and alternatives

Exclude:

- General programming terms ("Java", "REST", "Database")
- Standard industry terminology ("UML", "HTTP", "JSON")
- Trivia and obvious definitions
- Terms defined elsewhere (reference instead)

## Structure and Format

### Basic Table Format

```asciidoc
[cols="1,3"]
|===
| Term | Definition

| <Term-1>
| <Clear, concise definition>

| <Term-2>
| <Clear, concise definition>
|===
```

### Translation References

When a translated product term matters, reference its central localization catalog entry. Keep definitions and examples in English; do not create a parallel translation catalog.

### Recommended Columns

1. **Term**: The term being defined (noun, singular, capitalized for domain terms)
2. **Definition**: Clear, concise explanation (1-2 sentences)
3. **Category** (optional): Domain | Technical | Abbreviation
4. **Translation** (optional): For multi-language environments
5. **See Also** (optional): Related terms for cross-referencing

## Domain Terms vs. Technical Terms

### Domain Terms (Business Language)

- Concepts from the business/problem domain
- Used by domain experts and business stakeholders
- Part of the ubiquitous language (DDD)
- Often nouns representing business entities or processes

**Examples:**

- "Order" - Customer request to purchase products
- "Shipment" - Physical delivery of ordered goods
- "Invoice" - Bill for delivered goods/services

### Technical Terms (Solution Language)

- Concepts from the technical implementation
- Used by developers and architects
- Specific to your system's design
- May map domain concepts to technical representations

**Examples:**

- "Order Aggregate" - Consistency boundary for order-related entities
- "Event Store" - Database for persisting domain events
- "API Gateway" - Entry point for external API calls

### Relationship

```
Domain Term          Technical Term
-----------          --------------
Order        ----->  Order Aggregate
             ----->  OrderEntity
             ----->  OrderDTO
```

Document both when they differ significantly. Use domain terms primarily in business contexts, technical terms in implementation contexts.

## Best Practices

### 1. Keep It Compact

- Include terms needed to resolve actual ambiguity; there is no target count
- Focus on terms that cause confusion or have specific meanings
- Better explicit than implicit - but avoid trivial definitions

### 2. Use Consistent Structure

Each definition should:

- Start with the term's category (noun, verb, concept)
- Be 1-2 sentences maximum
- Avoid circular definitions (don't use Term B to define Term A if Term A defines Term B)
- Be precise and unambiguous

### 3. Alphabetical Ordering

- Sort terms alphabetically for easy lookup
- Group by category only if glossary exceeds 30 terms
- Use consistent casing (recommend: capitalized for domain terms)

### 4. Cross-Reference Related Terms

```asciidoc
| Policy
| Insurance contract. See also: <<Coverage>>, <<Premium>>
```

### 5. Document Synonyms Explicitly

```asciidoc
| Customer (preferred)
| Person or organization purchasing goods/services.
  Synonyms: Client, Buyer, Purchaser
```

## Anti-Patterns to Avoid

### 1. The Encyclopedia

❌ **Don't**: Include 100+ terms covering every possible concept
✅ **Do**: Focus on terms that are used, important, and potentially confusing

### 2. The Circular Definition

❌ **Don't**:

- "Order: See Purchase"
- "Purchase: See Order"

✅ **Do**:

- "Order: Customer request to buy products. Synonym: Purchase"
- "Purchase: See Order"

### 3. The Trivia Collection

❌ **Don't**: Define "Java", "HTTP", "Database", "REST"
✅ **Do**: Define "Policy Engine", "Risk Assessment", "Underwriting"

### 4. The Implementation Leak

❌ **Don't**: Mix technical implementation details into domain definitions
✅ **Do**: Keep domain and technical terms separate or clearly marked

### 5. The Orphaned Definition

❌ **Don't**: Define terms not used elsewhere in the documentation
✅ **Do**: Every glossary term should appear in the arc42 document

### 6. The Ambiguous Definition

❌ **Don't**: "User: Someone who uses the system"
✅ **Do**: "User: Authenticated person interacting with the booking system"

## Integration with Other arc42 Sections

### Section 8 - Crosscutting Concepts

The glossary may overlap with domain models in Section 8:

- **Option A**: Keep domain model in Section 8, definitions in Section 12
- **Option B**: Include domain terms in Section 8 glossary subsection
- **Recommendation**: Use Section 8 for graphical domain models, Section 12 for textual definitions

### Section 3 - Context and Scope

Business terms from the context diagram should be defined in the glossary.

### Section 5 - Building Block View

Technical terms used in building block descriptions should be defined.

## Maintenance and Governance

### Ownership

- **Agile teams**: Product Owner maintains the glossary
- **Traditional projects**: Project Manager or Business Analyst
- **Architecture focus**: Lead Architect

### Review Triggers

Update the glossary when:

- New business terms are introduced
- Stakeholders report confusion about terminology
- Onboarding new team members reveals gaps
- Domain model evolves
- Multiple terms are used for same concept

### Version Control

- Track glossary changes with the arc42 document
- Review glossary in iteration retrospectives
- Validate terms are used consistently across documentation

## Example Glossary

```asciidoc
== 12. Glossary

[cols="1,3"]
|===
| Term | Definition

| Booking
| Reservation of a resource for a specific time period by a customer.

| Cancellation
| Annulment of a booking before the reserved time period begins.

| Customer
| Person or organization registered in the system who can make bookings.
  Synonyms: Client, Account Holder

| No-Show
| Booking where the customer doesn't appear without cancellation.

| Resource
| Bookable entity (room, vehicle, equipment) managed by the system.

| Slot
| Specific time period available for booking a resource.

| Waitlist
| Queue of customers requesting a booking for an unavailable slot.
|===
```

## Checklist

Before finalizing the glossary, verify:

- [ ] Contains relevant terms with demonstrated ambiguity or specialized meaning
- [ ] Terms are alphabetically sorted
- [ ] Each definition is clear and concise (1-2 sentences)
- [ ] No circular definitions exist
- [ ] Domain and technical terms are distinguished (if both present)
- [ ] Abbreviations are expanded on first use
- [ ] Synonyms are documented with preferred term marked
- [ ] All terms appear elsewhere in the documentation
- [ ] No standard industry terms are defined (UML, HTTP, etc.)
- [ ] Multi-language translations included (if needed)
- [ ] Cross-references to related terms added
- [ ] Stakeholders have reviewed for accuracy

## Quick Reference

| Aspect            | Recommendation                                                |
| ----------------- | ------------------------------------------------------------- |
| Size              | Driven by actual terminology needs                            |
| Format            | Alphabetical table                                            |
| Columns           | Term, Definition, (Category), (Translation)                   |
| Definition length | 1-2 sentences                                                 |
| Ordering          | Alphabetical                                                  |
| Ownership         | CEO for domain terms, CTO for system-specific technical terms |
| Review frequency  | When terms, contexts, or reported ambiguities change          |

## Resources

- arc42 Tips: https://docs.arc42.org/section-12/
- Domain-Driven Design: Ubiquitous Language pattern
- Tip 12-1: Take the glossary seriously
- Tip 12-2: Document as table
- Tip 12-3: Add graphical model
- Tip 12-4: Include translations
- Tip 12-5: Keep it compact
- Tip 12-6: Assign ownership
