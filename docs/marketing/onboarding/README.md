# Marketing and social media onboarding pack

The pack contains six documents for marketing and social media colleagues without repository access. Source filenames, document titles, exported topic folders and PDF filenames follow the same consecutive order:

1. `01-welcome-to-situate`
2. `02-product-introduction`
3. `03-audience-problems-and-positioning`
4. `04-brand-voice-and-writing-examples`
5. `05-content-and-community-playbook`
6. `06-brand-assets-and-examples`

Each basename identifies one Markdown source in this directory and one exported topic folder. The PDF inside that folder adds the extraction date. The exporter validates the order and title numbers. It produces five newly rendered PDFs, a copy of the canonical product introduction PDF, six dated editable Markdown copies, a selected artwork library and illustrative interface previews.

[`02-product-introduction.md`](02-product-introduction.md) is the single editable product introduction source. Update its [PDF](02-product-introduction.pdf) alongside authorized content or presentation changes before exporting. Its document number is 2; its own sections run from 1 to 8.

## Sources and editorial boundaries

| Document                           | Primary sources                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start here                         | The accompanying documents                                                                                                                                                                                                                                                                                                                                                           |
| Situate: a product introduction    | [Canonical introduction](02-product-introduction.md) and [PDF](02-product-introduction.pdf)                                                                                                                                                                                                                                                                                          |
| Audience, problems and positioning | [Positioning](../../positioning.md), [business model](../../product-concept.md#free-application-and-optional-services), [foundations](../../../requirements/data/foundations.md), [connected organization goal](../../../requirements/data/goals/GOAL-0001-connected-organization.md), [personal connection goal](../../../requirements/data/goals/GOAL-0005-personal-connection.md) |
| Brand voice and writing examples   | [Voice](../../../design/brand/docs/voice.md), [website copy](../../../website/messages.en.json)                                                                                                                                                                                                                                                                                      |
| Content and community playbook     | [Website birthday story](https://reboot.getsituate.com/#story), [onboarding feedback](../../feedback/onboarding-feedback.md), [ongoing feedback](../../feedback/ongoing-product-feedback.md)                                                                                                                                                                                         |
| Brand assets and examples          | [Brand handbook](../../../design/brand/README.md), [illustration](../../../design/brand/docs/illustration.md), [tokens](../../../design/brand/tokens.json), [provenance](../../../design/brand/docs/provenance.md), [capture manifest](../../../website/media/manifest.json)                                                                                                         |

The automation examples describe possible personal workflows within [configured plugin execution](../../../requirements/data/requirements/REQ-0031-run-plugins-independently-of-views.md) and [email drafting](../../../requirements/data/requirements/REQ-0003-save-email-drafts.md). They do not establish current feature availability.

The playbook's content experiments and writing examples are suggestions, not historical campaigns or research findings. Current foundations govern product scope and execution policy. The product introduction supplies the prototype description; its inclusion does not qualify the main application's capabilities. Report substantive conflicts between sources separately before using the affected claims publicly. Follow the [licensing guide](../../../LICENSING.md) for MIT software and documentation, CC BY 4.0 artwork, attribution and third-party exceptions.

Refresh the prose against these sources before making a later extract. Exporting again changes file names and rebuilds the documents; it does not automatically research or update their meaning. The exported pack has no repository links, owner fields, status fields or revision-date fields. Dates appear in file names and references to those files.

## Existing document tools

- [Website legal browser checks](../../../website/legal/browser.test.mjs) already use Playwright's `page.pdf()` for A4 review files. Their print styles are intended for legal pages rather than this reading pack.
- [The scoped onboarding exporter](../../../design/marketing-onboarding/export.mjs) reuses the installed Playwright browser launcher and root lockfile's `marked` parser. It reads canonical color tokens and wordmark artwork. It adds no package, font download, cloud converter or upload step.

## Build an extract

Use the repository's Volta-pinned Node.js and local root/client dependencies. If they are absent, install them through `node tools/npm-ci.mjs` and `node tools/npm-ci.mjs client`. An installed Playwright Chromium browser is required; the exporter does not download one.

From the repository root:

```sh
node tools/run-coordinated.mjs -- node design/marketing-onboarding/export.mjs \
  --date YYYY-MM-DD \
  --output /path/to/existing-parent/marketing-onboarding-YYYY-MM-DD \
  --proofs /path/to/temporary-review-images
```

For a new extract, replace `YYYY-MM-DD` with the extraction date. To revise a delivered pack while retaining its filenames, use its existing date and a fresh temporary output destination. Back up the delivered pack, inspect the new PDFs, then replace only the corresponding PDFs and editable copies. Keep existing assets and unrelated files intact.

The output destination must not exist; its parent must exist. The exporter never replaces existing material. It builds a complete pack in a temporary sibling directory and moves it into the exclusively reserved destination only after successful rendering. The optional `--proofs` directory contains HTML page review images for the five rendered guides. Inspect the preserved product PDF separately.

The result contains:

- Six topic folders numbered `01` through `06`, each with a matching numbered and dated PDF.
- `06-brand-assets-and-examples/brand-artwork/`: canonical SVG copies and transparent PNG conversions.
- `06-brand-assets-and-examples/illustrative-interface-previews/`: unchanged synthetic WebP captures and PNG conversions.
- A dated asset-notices text with the provider-icon license retained.
- `editable-sources/`: dated Markdown copies with asset references and color values resolved.

Every delivered file includes the extraction date. Existing asset bytes are copied without pretending the original artwork was created on that date. No account, employee information, credentials, customer material or repository snapshot is exported. The exporter blocks page network requests, detects missing images and page overflow, and does not publish to Google Drive.

## Check and inspect

```sh
node tools/run-coordinated.mjs -- node --test design/marketing-onboarding/export.test.mjs
node tools/test.mjs --quick --changed
node tools/test.mjs --feedback --changed
```

Tests cover date validation, source restrictions, consecutive numbering, a single product source, approved website links, repository-independent output and refusal of existing destinations. The renderer allows the reviewed public website links without fetching them; HTML, external images and other links are rejected. The exporter checks browser layout for the five rendered guides and copies the canonical product PDF byte-for-byte. Inspect every resulting PDF page for pagination, visual hierarchy, wordmark proportions and image legibility. HTML review screenshots do not by themselves verify PDF text extraction or pagination. The PDFs are reading documents, not product screenshot baselines or Word pagination qualification.
