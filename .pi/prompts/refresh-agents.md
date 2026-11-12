---
description: Refresh the documentation index in AGENTS.md using current repository sources
---

Update the root `AGENTS.md` so agents can quickly locate Situate's documentation. Change only its `## Documentation Overview` section. If the older heading `## Architecture Documentation Overview` exists, replace that section instead. If neither exists, append the new section. A section ends at the next level-two heading or the end of the file; preserve everything outside it, including existing local edits.

## Discover the sources

- Read `AGENTS.md` and the repository's documentation entry points first.
- Inventory the entire `docs/` tree, including documentation formats other than Markdown. Also inspect `requirements/`, `design/`, and tracked README files elsewhere in the repository for documentation that belongs in the map.
- Use the current checkout, not remembered paths or another project's structure. Include newly discovered documentation areas; remove references to files that no longer exist.
- Read the source documents before describing their purpose or decisions. Follow relevant repository-local links to find canonical sources rather than indexing every duplicate reference.
- Stay within repository documentation. Exclude dependencies, generated output, test fixtures, private notes, ignored files, credentials, and external workspaces. Do not follow symlinks outside the repository.

## Build the overview

Use level-three headings within `## Documentation Overview` and compact Markdown tables with repository-root-relative links.

### Documentation map

Group the available documentation by topic. For each topic, give its purpose, entry point, and a few useful files or subdirectories. Cover the actual sources for:

- Product concept and positioning.
- Architecture and architectural decisions.
- Development workflows, testing, and provider qualification.
- Goals, requirements, and their authoring conventions.
- Brand, voice, visual design, motion, and platform guidance.
- Other documented areas found during discovery.

This is a navigation aid, not a complete file listing. Link to a collection's own index when it already provides detailed navigation.

### Architecture reference

Inspect `docs/architecture/` to determine its real organization. List the available chapters or major topics with their titles, a brief explanation, and links. Retain documented chapter numbers where present; do not assume an arc42 layout or invent missing chapters.

### Task lookup

Map common development situations to the smallest useful set of reading links. Derive the recommendations from the sources, covering feature work, architectural changes, testing, interface design, user-facing language, and requirement changes where documentation exists. Include deployment or other specialized situations only when supported by actual documents.

### Decisions worth knowing

Surface only currently applicable architectural and product decisions that affect implementation but are easy to miss in nearby code. Give each decision's existing identifier or title, its practical consequence, and a source link.

Read candidate decisions and their status or superseding references before selecting them. Favor durable boundaries, cross-cutting constraints, product scope, and business rules. Leave out overturned decisions, completed migrations, temporary plans, and configuration choices already obvious in code. Omit this subsection if no decisions qualify.

## Verify the edit

- Keep the index in English and descriptions short; do not duplicate the documents themselves.
- Preserve goal and requirement identifiers. Distinguish accepted decisions from proposals, hypotheses, and open questions; a plan is not proof of implementation.
- Check every local link and any heading anchors against the current files.
- Do not invent documentation, resolve conflicting decisions, or edit source documents as part of this refresh. Report unresolved source conflicts separately.
- Review the diff to ensure only the intended overview changed and all other repository instructions remain intact. Repeated runs against unchanged sources should not create duplicate sections or needless reordering.
- Summarize the changed index and any unresolved links or ambiguities in the response. Do not commit or publish changes.
