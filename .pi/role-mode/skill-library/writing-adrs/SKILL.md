---
name: writing-adrs
description: Record consequential architecture decisions with context, realistic alternatives, rationale, status, and honest trade-offs.
---

# Architecture decision records

Use an ADR when a technical choice has lasting consequences and its reasoning will matter later. Do not create records for routine edits or to meet a target count. Inspect existing records before allocating an ID or selecting a format.

Use AsciiDoc for Situate architecture records. A compact record should identify:

- A stable ID, descriptive title, date, and decision status.
- The problem, evidence, relevant requirements, and constraints.
- Real options considered and criteria that distinguish them.
- The proposed or accepted choice and its rationale.
- Costs, risks, limitations, and consequences, including operational effects.
- Related decisions, affected views, and verification needs where useful.

Keep alternatives honest; do not invent weak options to justify a preferred answer. Link detailed design instead of embedding an entire specification in the record.

Use `proposed`, `accepted`, `rejected`, `deprecated`, or `superseded` as appropriate, following existing conventions. Record acceptance only after an authorized decision. Accepted means chosen, not necessarily implemented or tested; track implementation evidence separately when needed.

Preserve the reasoning of accepted decisions. For a substantive replacement, create a new record and link both directions, updating the old status without rewriting its history. Editorial corrections may preserve meaning. Bring changes to business scope, spending, or commitments back to the user before treating them as approved.
