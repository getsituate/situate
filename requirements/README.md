# Situate · Requirements

Local read-only viewer for product requirements. Markdown files in `data/` are the source; the website has no editing or commenting features.

## Getting started

Requires Node.js 22.12 or later and npm.

```sh
cd requirements
npm ci
npm run dev
```

Open the local address printed in the terminal. Changes to Markdown files reload the viewer. Invalid metadata appears in the terminal and the Vite error overlay.

```sh
npm run validate  # Check metadata, IDs and references
npm test          # Data and logic tests
npm run build     # Generate a static website in dist/
npm run preview   # Preview the build locally
```

For browser tests, run `npx playwright install chromium` once, then `npm run test:e2e`. These tests use a temporary copy with fixtures, not the actual collection.

A published build contains all text from `data/`. Keep confidential material outside this public repository; record only non-identifying provenance for private sources.

## Maintaining content

- `data/foundations.md`: constraints and deliberate exclusions.
- `data/goals/`: one Markdown file per goal, including the user problem and desired outcome.
- `data/requirements/`: one Markdown file per requirement, with rationale, source, acceptance criteria and open questions.
- `templates/`: templates excluded from the collection. Copy one into the appropriate data folder and complete it.

IDs are permanent and unique: `GOAL-0001` or `REQ-0001`. Do not reuse rejected IDs. Use English filenames; subfolders are supported.

### Metadata

| Field      | Usage                                                        |
| ---------- | ------------------------------------------------------------ |
| `id`       | Unique ID matching the entry type                            |
| `type`     | `goal` or `requirement`                                      |
| `title`    | Short, informative title                                     |
| `status`   | `approved` or `rejected`                                     |
| `area`     | Area as free text; use consistent spelling for the same area |
| `priority` | Requirements only: `must`, `should`, `could`                 |
| `goals`    | Requirements only: list of at least one existing goal ID     |

All listed fields are mandatory for their respective type. Status describes the product decision, not implementation progress. Content completeness and testability require joint review; technical validation does not replace it.

Goal references appear on both sides. Additional document references can use relative Markdown links, such as `[Foundations](../foundations.md)`. Local file targets must be existing goals, requirements or `foundations.md` within `data/`. Link to sections with `#acceptance-criteria`: headings are lowercased, spaces replaced with hyphens and punctuation removed. Duplicate headings receive suffixes `-1`, `-2`, etc. Section references are also validated. Public sources outside the collection can be specified as URLs or as text with a public path and location. For unavailable private sources, state the source type and its availability without including identifying details.

### Acceptance criteria and milestones

Requirements can store their complete acceptance criteria in the optional `acceptanceCriteria` frontmatter list:

```yaml
acceptanceCriteria:
  - id: AC-01
    text: Installed plugins are listed with their current status.
    milestone: MVP
    status: implemented
  - id: AC-02
    text: Affected dependencies are shown before disabling a plugin.
    milestone: Plugin dependencies
    status: open
  - id: AC-03
    text: Plugin source remains inspectable during recovery.
    status: in-progress
```

This is a synthetic format example, not a delivery assignment or implementation claim for the catalog.

- `id`: stable within the requirement, in the form `AC-01`. Do not renumber or reuse IDs when criteria move or are removed.
- `text`: required plain text describing one independently verifiable criterion. Split criteria spanning different delivery increments without changing the intended behavior.
- `status`: required implementation state: `open`, `in-progress` or `implemented`. This is independent of the requirement's product decision (`approved` / `rejected`).
- `milestone`: optional, non-empty single-line name. Omit it for unplanned scope. Exact names group criteria across requirements; use consistent spelling and capitalization. No separate milestone registry, dates or issues are required.

Assign one milestone per criterion. To put an entire requirement in one milestone, give all its criteria that name. Unknown criterion fields, duplicate local IDs and invalid states fail validation.

When converting an existing requirement, move **all** its acceptance criteria into this list and remove the Markdown `Acceptance criteria` section. Do not maintain two sources or omit deferred criteria. The viewer generates that section and preserves its `#acceptance-criteria` link. Existing Markdown-only requirements remain readable and show **Implementation not tracked**, not **Open** or **Implemented**. No existing content is migrated automatically.

The **Milestones** view lists named groups and unplanned structured criteria. A milestone page shows only its assigned criteria, grouped by requirement, with separate scope and overall counts. Overall progress includes unplanned criteria: a completed MVP can coexist with a partially implemented requirement. Rejected requirements retain their visible decision badge and any explicitly recorded assignments; implementation does not reverse that decision. Requirements without structured criteria are excluded from milestone counts.

Implementation summaries are derived from recorded criterion states: all implemented means **Implemented**; some implemented means **Partially implemented**; otherwise any in-progress criterion means **In progress**, and all open means **Open**. These are manually maintained records, not automatic claims from issue closures or test results.

The viewer remains read-only. Change names, assignments and states in the source Markdown files. Milestone links such as `#milestones?name=MVP` can be bookmarked; `#milestones?name=` shows unplanned criteria.

Search covers IDs, titles, areas, body text, goal IDs, structured acceptance criteria and milestone names. Filters and search are stored in the URL; individual entries have permanent links such as `#entry/REQ-0001`.
