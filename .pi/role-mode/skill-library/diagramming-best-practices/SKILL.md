---
name: diagramming-best-practices
description: Create and review focused architecture diagrams with consistent abstraction, labels, and supported text-based rendering.
---

# Architecture diagrams

Identify the reader's question before drawing. Choose a context, component, sequence, deployment, or data view accordingly. A diagram should explain one coherent concern, not reproduce the entire system.

Use the notation supported by the document toolchain. Mermaid and PlantUML are options, not assumed dependencies. In AsciiDoc, confirm how diagram blocks render before relying on them.

Keep names consistent with the text and implementation. Label relationships with their meaning and direction; distinguish information flow from dependency. Separate abstraction levels and show system or trust boundaries where relevant.

## Avoid the Diagram of Death

Do not pack an entire workflow or system into one oversized diagram. Too many elements, crossing edges, and text-heavy boxes obscure the question it should answer.

Prefer 7 ± 2 primary elements per diagram (5–9 participants, components, states, or steps). Use this as a readability heuristic, not a quota: fewer elements are fine. When a view grows beyond this range or becomes hard to follow, split it by concern or abstraction level. Use an overview with separate detail diagrams; for workflows, separate the main path from recovery and failure paths while keeping their connection explicit. Do not hide complexity inside giant grouped boxes or shrink the text to make everything fit.

Use compact language in nodes and edge labels: short names, verb phrases for actions, and brief questions for decisions. Keep one idea per label. Move explanations, implementation details, and qualifications into accompanying prose or a table. For example, use “Restore backup” rather than “Restore complete original state; keep backup intact; retry interrupted restoration,” and explain the recovery guarantees beside the diagram. Preserve distinctions that affect the reader's interpretation; avoid cryptic abbreviations.

## Route edges without collisions

- Avoidable arrow and edge crossings must be eliminated. Reorder nodes or participants, adjust ranks, ports and routing, or split the view by concern before accepting the diagram.
- Arrows, arrowheads and boundary lines must not overlap text. Leave visible clearance around edge labels, multiline labels, node text and group headings. Keep labels distinct from one another.
- Preserve relationship meaning and direction while improving the layout. Do not remove required edges, shrink text or hide collisions behind opaque labels to make the diagram appear clear.
- If a crossing is structurally unavoidable, make the routes unambiguous and distinguish crossings from connected junctions. Explain non-obvious notation beside the diagram.

## Review

Explain any non-obvious notation. Do not rely on color alone to convey meaning. Include enough accompanying text to clarify intent, limitations, and whether the view is proposed or implemented.

Verify participants, edges, and referenced locations against sources. Render every new or changed diagram locally and inspect the final rendered artifact at its intended reading size. Check arrow crossings, arrowheads, label clearance, group boundaries, clipping and readability. Repeat this inspection after the last layout change; successful parsing or rendering alone does not establish a readable layout.

Use geometric overlap and crossing checks where available to supplement visual inspection, not replace it. If a local renderer is unavailable, report visual verification as blocked rather than treating the diagram as reviewed. Never send private architecture to an external renderer without authorization.
