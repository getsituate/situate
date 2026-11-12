---
name: capture-and-maintain-requirements
description: Turn clarified needs and sources into verifiable requirements and maintain goals, constraints, and exclusions in the Markdown catalog. Use to create, refine, or explicitly modify these contents.
---

# Capture and maintain requirements

## Preparation and format

Read the [data conventions](../../../../requirements/README.md), [requirement template](../../../../requirements/templates/requirement.md), and, for goal changes, [goal template](../../../../requirements/templates/goal.md). Repository paths are relative to the project root; links are relative to this skill.

Read `requirements/data/foundations.md` and affected goals and requirements before writing. Search for similar entries and references to IDs being changed. For advice or review only, propose changes without editing files.

| Field           | Goals                    | Requirements                       |
| --------------- | ------------------------ | ---------------------------------- |
| `id`            | `GOAL-` plus four digits | `REQ-` plus four digits            |
| `type`          | `goal`                   | `requirement`                      |
| `title`, `area` | Nonempty text            | Nonempty text                      |
| `status`        | `approved`, `rejected`   | `approved`, `rejected`             |
| `priority`      | Do not use               | `must`, `should`, `could`          |
| `goals`         | Do not use               | Nonempty list of existing goal IDs |

The current repository format prevails if it differs. Do not change the schema to fit an entry. Reuse topic areas consistently without adding a taxonomy.

## From input to requirement

1. Separate observations, goals, requirements, solutions, constraints, and exclusions. Use `clarify-goals-and-user-problems` for unresolved goals.
2. Compare candidates with the collection. Preserve new sources and conditions even when no new requirement is needed.
3. Describe one coherent behavior or verifiable quality: **Who or what must enable which outcome under which conditions?**
4. Explain the user problem and existing goal it serves.
5. Add observable acceptance criteria, source, and open questions. Separate sourced statements from proposals.
6. Clarify missing required fields before writing. Never invent a goal or priority to pass validation. Proposed priorities require explicit agreement, even with a shared default.
7. Create or update jointly clarified content selected by the user as `approved`. Unresolved proposals remain in dialogue. Then use `review-requirements`.

Process large documents section by section. Present candidates and uncertainties before turning mentions into files. Neither sources nor successful validation imply approval.

## Content quality

- **Description:** unambiguous behavior, conditions, boundaries, and relevant failure cases; not a bundle of independent features.
- **Rationale:** concrete value and goal connection, not a repeated title.
- **Source:** link to a public file or URL with a section or timestamp when available. For private discussions, record only non-identifying provenance, the known date if safe to disclose, and whether the source is publicly available. Never publish participant identities, confidential paths, or private transcripts. Flag missing provenance rather than inventing it.
- **Acceptance criteria:** externally testable outcomes as clear statements or Given/When/Then, not implementation steps such as “create a database table.”
- **Open questions:** pending decisions, assumptions, and evidence. Do not replace unknown limits with invented test values.

“Fast,” “easy,” and “secure” are not testable without context. Ask for a relevant situation and verifiable standard. Nonfunctional qualities are valid requirements. Technology preferences are not automatically needs, but explicit integration or platform constraints must be preserved.

## Priority and decisions

- `must`: the agreed outcome is impossible without it.
- `should`: important, but an acceptable interim solution exists.
- `could`: extra value once more important needs are met.
- Only `approved` and `rejected` are available. Include jointly clarified content as `approved`; explicitly discarded content as `rejected`. Exploration alone does not authorize decided entries.
- Decided does not mean implemented; status is not development progress.
- Conflicts remain linked open questions, not `conflict` or `clarification-needed` statuses.
- Deferral is not rejection. Preserve decision status and document agreed timing exclusions in foundations without inventing deadlines.
- Clarify substantive changes to decided entries in advance. Wording corrections that preserve meaning do not require a new status.

## IDs, changes, and references

- Check the full catalog and assign the next free ID of each type. Consult Git history where needed to avoid reusing removed IDs. If unavailable, clarify allocation rather than asserting uniqueness.
- Keep existing IDs and paths stable where possible. Recheck a new ID immediately before writing.
- Preserve sources, rationales, and questions during refinement. Do not overwrite unrelated local edits.
- Every requirement must reference at least one genuinely relevant goal through `goals`; no placeholder goals for schema validity.
- Express other relationships as relative Markdown links to existing entries or foundations. Do not add relationship fields or a graph schema.
- Do not independently delete or merge duplicates. Propose a canonical entry and explain effects on sources and links; merge only after approval.

## Constraints and exclusions

Maintain both in `requirements/data/foundations.md`, not new file types.

**Constraint:** state restriction, origin, rationale, and consequences. Distinguish external rules, explicit product decisions, and assumptions. A technical preference is not an immutable boundary. Legal claims need specific evidence; do not infer blanket legal rules from keywords.

**Exclusion:** state what is excluded and where included scope ends, with reason, source, and known decision. Distinguish “not now,” “not part of this,” and “another system’s responsibility.” Document boundaries only where misunderstanding is plausible.

Unconfirmed proposals remain explicitly open questions or proposals, not active rules. Mention later timeframes only if agreed. Expose contradictions with foundations instead of silently overwriting either side.

## Completion

Run `npm --prefix requirements run validate` from the project root. Fix link/metadata causes, not the validator. Report missing dependencies or blockers honestly. Briefly report IDs, paths, open decisions, and validation. No commit or publishing without a request.
