# Product Capability Catalog — Working framework

External lookup title: **Fachliche Leistungsübersicht – Arbeitsrahmen**. External filename identifier: `leistungsuebersicht-arbeitsrahmen.md`; this English file is the sole framework.

## Scope and authority

Documentation date: **9 November 2026**. [Repository guidelines](../../AGENTS.md) require English content and filenames, stable identifiers, reviewed non-identifying summaries and no private source paths.

The catalog supplements [product direction](../product-concept.md) and [positioning](../positioning.md), without replacing the [requirements catalog](../../requirements/README.md) or [foundations](../../requirements/data/foundations.md). Requirement approval is not delivery evidence. Use the recorded product revision and area evidence for support assessments, rather than introductory or historical descriptions.

Target: the **main application**, `client/app/` and `client/crates/`, with macOS and iOS assessed separately. Source baseline: branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` (5 November 2026). Historical prototype and synthetic workshop findings cannot establish main-application support. Shared/browser tests cannot qualify native platforms. No released version is claimed.

## Canonical documentation and ownership

[Situate — Product Capability Catalog](README.md) and its linked area files form the authoritative capability overview. The six area files define the 44 listed identifiers. Documents records a tentative future target, not current support. This framework governs authoring and publication, not a second set of ratings. Fact-checks remain evidence inputs. The [complete Markdown reading edition](Situate-Product-Capability-Catalog.md) is generated from the overview and area files; never edit it as an independent source. Do not introduce additional export formats or edit generated requirement views or architecture output.

Each area file owns its capability definitions, assessments and evidence. `README.md` owns the benefit-led area overview, shared prerequisites, the status legend, navigation and cross-area questions. Editorial maintenance and publication tasks belong here, not in the reader-facing catalog. Do not maintain a second capability assessment in this framework.

Functional areas are not workspaces: workspaces deliberately separate environments such as private and professional life. Use cases describe tasks and outcomes; person/situation-specific adaptations are outside this catalog.

## Area and report inventory

Paths are repository-relative. `bundle:` identifies an exact filename in the supplied external research collection, not a repository link. Keep that collection outside Git. PDFs are derivatives, not independent evidence. The five technical reports concern the source baseline above; the Notes area also includes a separate non-identifying prototype user report dated 9 November 2026. Documents require no technical report. Report dates are not inferred execution dates. The publication rules below distinguish retained evidence from external originals.

| Functional area | Stable identifiers                               | Exclusive output                                     | Available reports                                                                                         | Scope, evidence and open mapping                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notes           | N01, N02, N03, N04, N05, N06, N07, N08, N09, N10 | `docs/product-capability-catalog/notes.md`           | `docs/note-capabilities-fact-check.md`; `bundle:note-capabilities-fact-check.md` (identical Markdown)     | Date unstated. Main application, primarily macOS/workspace text; code and recorded synthetic checks, not live-model quality or native iOS qualification.                                                                                                                                                       |
| Task management | A01, A02, A03, A04, A05, A07                     | `docs/product-capability-catalog/task-management.md` | `docs/task-management-capabilities-fact-check.md`; `bundle:Task-Management-Faehigkeiten_Fact-Check_DE.md` | Investigation date unstated. Writable macOS/application-local iOS workspaces and working model access; code and recorded synthetic checks, with native-host tests blocked. Imported copies are distinct from external originals.                                                                               |
| Email           | E01, E02, E03, E04, E05, E06, E07                | `docs/product-capability-catalog/email.md`           | `docs/email-capabilities-fact-check.md`; `bundle:E-Mail-Faehigkeiten_Fact-Check_DE.md`                    | Date unstated. Main application and separate prototype; conditional Gmail analysis. Recorded simulated-model checks concern the prototype, not Gmail.                                                                                                                                                          |
| Calendar        | K01, K02, K03, K04, K05, K06, K07                | `docs/product-capability-catalog/calendar.md`        | `bundle:Kalender-Faehigkeiten_Fact-Check.md`                                                              | 7 November 2026. Main application under Google-connector assumption; code and recorded synthetic checks, not native end-to-end qualification. Prototype assessment is historical-document-only.                                                                                                                |
| Documents       | D01, D02, D03, D04, D05, D06, D07, D08           | `docs/product-capability-catalog/documents.md`       | Product-owner specification, 9 November 2026; no report required                                          | [Documents](documents.md) owns the product-specified non-support and provisional future target. All eight definitions are present, based on the jointly developed capability collection.                                                                                                                       |
| Plugins         | P01, P02, P03, P04, P05, P06                     | `docs/product-capability-catalog/plugins.md`         | `bundle:Situate_Plugin-Entwicklung_Analyse.md`                                                            | 6 November 2026. Main application and separately inspected prototype; code, inspected test sources and inherited records; no tests executed for that report. Collection workflows use custom plugin logic over callable views/services and version-checked storage; practical quality remains plugin-specific. |

These allocations cover **44 stable identifiers**. The current identifier list defines coverage; expanding the scope requires a new product decision. Preserve identifiers and their meanings without renumbering or reuse. D01–D08 are defined in [Documents](documents.md), with product-specified non-support and tentative future status.

## Shared boundaries

The collection describes capabilities and a tentative target set, not blanket current availability or a development commitment. Apply the [shared prerequisites and connector scope](README.md#shared-prerequisites-and-boundaries) to every area; keep the single connector notice there rather than repeating it per capability. Email and Calendar describe capabilities directly under the fulfilled prerequisites, while retaining Situate's own execution limits.

For **D01–D08**, preserve the [product-specified current non-support and tentative target](documents.md). Do not request validation reports, inspect implementation or run capability/product tests for this area. The definitions describe desired benefits, not evidence of current support.

## Assessment standard

Assess the described result in an ordinary collaborative workflow, not an expanded promise. Questions, suggested candidates, choices, refinements and several search/read/edit steps are part of the capability. Situate must make a substantial contribution; returning the essential work to the user is not equivalent to doing it through dialogue. That contribution alone does not establish full support if an essential part of the described result remains unreachable.

Use the existing [status vocabulary](README.md#status-and-evidence-legend). **Supported** means: suitable evidence establishes an executable workflow through which the described result can be achieved within the stated scope. Dialogue, choices between suggestions and multiple steps may be part of that workflow. A practical trial of every case is not required. Code analysis can establish that workflow. Missing guarantees for unlimited data, exhaustive retrieval or perfect answers are not enough for **Partially supported**. That status needs an essential unavailable part, an explicitly narrower usable result or evidenced recurring difficulties under ordinary conditions. **Unclear** is appropriate when the available evidence cannot settle the actual workflow, not merely because a live trial is absent.

For plugin capabilities, trace the result through authoring/activation, invocation, required host operations and return or persistence of the result. Distinguish ordinary plugin-specific logic from a missing or genuinely unresolved host mechanism. The absence of a prebuilt domain component or a full practical trial does not by itself make the result unreachable. Conversely, a list of primitives alone is insufficient: explain how the necessary steps connect.

Keep support and evidence separate. Attribute user reports to the relevant product version; prototype experience is not main-application qualification. Summarize private experiences without service, collection or personal details that could identify the source. Evaluate coverage against the task: locating requested information differs from producing a complete inventory. Do not silently weaken a completeness promise that is part of the benefit.

For any status change, record the current reasoning in the owning entry and evidence section. Explain the old/new status and reason in the handover, not as a change log in the catalog. Compare similar workflows across areas while preserving actual differences in tools, sources and platform access.

## Common section template and evidence rules

Introduce each area with its practical scope and link to shared conditions. Put the activity and usable result first in each entry, then repeat:

```markdown
### ID — Capability name

Benefit: Activity and usable result, distinguishing a proposal, chat result, saved file or external action.
Support: Supported / Partially supported / Not supported at reviewed revision / Unclear.
Prerequisites and limits: Conditions and material limits for that task, not a catalogue of possible errors.
Evidence: What the evidence establishes and what remains unmeasured; link to the detailed record.
```

Use the catalog's [status and evidence legend](README.md#status-and-evidence-legend). Attribute inherited test records; reading tests is not executing them. General model ability alone proves no reachable workflow; code analysis can establish support without a live run. Do not infer whole-collection coverage from selected examples.

Keep detailed source locations, exact tool limits, report dates and recorded results in the area's evidence section. Attribute inherited results once without narrating failed test filters, editing sessions or repeated non-execution. Preserve product revision and original report dates; documentation dates do not establish a new product assessment. Link public evidence and summarize private sources without identifying paths.

## Maintenance and publication prerequisites

- Edit definitions and ratings in the owning area file. Preserve identifiers and meanings; the current list defines coverage. Scope expansion requires a new product decision.
- Keep the shared connector scope attached to Email and Calendar. Keep the Documents target tentative and current non-support explicit; no document implementation review is required.
- Revisit only claims affected by product changes or decisive evidence gaps. Requirement approval and inspected test code do not by themselves upgrade support. Keep reports as evidence rather than competing current catalogs.
- Retain `docs/note-capabilities-fact-check.md`, `docs/task-management-capabilities-fact-check.md` and `docs/email-capabilities-fact-check.md` as version-controlled historical evidence inputs, alongside their PDF derivatives. Their original assessments, dates and recorded results are not the current catalog's ratings; do not rewrite them to match later editorial decisions.
- The Calendar and Plugin reports identified as `bundle:` inputs remain external originals. The area files contain non-identifying summaries and supporting public code references, not copies of those reports. Preserve the exact source identities and evidence limits. Publishing an original report requires a separate redistribution review; private source collections remain outside Git.
- Preserve the non-identifying scope of the prototype user report in Notes. Do not add private source records or personal collection details.

## Reading edition generation

Run from the repository root with Volta's shims first on `PATH`:

```sh
node tools/run-coordinated.mjs -- python3 docs/product-capability-catalog/generate-reading-edition.py
node tools/run-coordinated.mjs -- node node_modules/prettier/bin/prettier.cjs --write docs/product-capability-catalog/Situate-Product-Capability-Catalog.md
python3 docs/product-capability-catalog/generate-reading-edition.py --check
```

The generator copies the overview and six area sources, adjusts heading levels and internal links, and places technical evidence after the capabilities. The functional overview comes first; a compact contents list and the named capability index provide navigation without an exhaustive opening outline. The working framework is not a catalog chapter. The check verifies source/output agreement, identifiers, status vocabulary, contents and local links. The registered `design-unit` suite also exercises the generator's rejection of invalid identifiers, statuses, headings and links without changing the catalog sources. Prettier remains the formatting authority. Keep any existing translations or exports synchronized from these sources; currently only the English Markdown reading edition is present.

## Verification and completion

Use Volta and the [test guide](../development/testing.md): run `node tools/test.mjs --quick --changed` and `node tools/test.mjs --feedback --changed` for affected checks. Inspect selection with `--list`; unrelated untracked PDFs broaden it. For this documentation-only scope, run Prettier and `design/brand/validation/check.cjs` through `node tools/run-coordinated.mjs --` when that happens, and report omitted broader suites. No application build or product tests are required.

Check all 44 stable IDs, assigned paths, links, provenance, language and privacy. The catalog index must distinguish definition coverage from support and evidence questions. Keep its completion state and source-update rules current. Keep links to the Documents definitions current; their presence does not establish product support or require a new overall investigation.
