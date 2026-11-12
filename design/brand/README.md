# Situate brand handbook

Situate's visual identity is **Bend in Motion**: warm paper, plum-colored type, clear saturated color, generous curves, and Bend, an open violet arch with an expressive face. It is a personal world for one person's tasks, knowledge, and documents—not a team dashboard or a developer console.

This handbook guides the official Situate identity. Its visual guidance does not restrict modifications permitted by the [software and artwork licenses](../../LICENSING.md); use as a product or service identity is addressed by the [trademark policy](../../TRADEMARKS.md).

The same identity has two levels of expression. Welcomes and occasional achievements can be richly illustrated. Daily work stays quiet: legible content, restrained color, and little or no character animation. These are complementary uses of one brand, not alternative directions.

## Start here

| Your task                                       | Read                                                           | Use                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Understand the identity and its limits          | [Brand principles](docs/principles.md)                         | [Offline visual reference](reference/index.html)                             |
| Choose color, type, and spacing                 | [Tokens and typography](docs/tokens-and-typography.md)         | [Token source](tokens.json), [generated CSS](tokens.css)                     |
| Build a screen or reusable component            | [Layout and components](docs/layout-and-components.md)         | [Reference styles](reference/reference.css)                                  |
| Choose an illustration or background element    | [Illustration and identity](docs/illustration.md)              | [Complete illustration catalogue](reference/illustrations.html)              |
| Use the wordmark or app icon                    | [Identity guidance](docs/illustration.md#wordmark)             | [Identity sources](docs/provenance.md#identity-marks)                        |
| Place or animate Bend                           | [Illustration](docs/illustration.md), [motion](docs/motion.md) | [Character kit manual](bend/README.md)                                       |
| Use a small mark or loading indicator           | [Mini Bend](bend/mini/README.md)                               | [SVG and ASCII reference](reference/index.html#mini-bend)                    |
| Stage a more expressive welcome                 | [Performance rig](bend/PERFORMANCE.md)                         | [Ten-second introduction and gesture study](examples/first-hello/index.html) |
| Write labels, explanations, and messages        | [Voice](docs/voice.md)                                         | [Product positioning](../../docs/positioning.md)                             |
| Implement, extend, and check the system         | [Implementation](docs/implementation.md)                       | [Token generator](build-tokens.cjs), [Bend generator](bend/generate.cjs)     |
| Study a complete composition in another context | [Listening room](examples/listening-room/index.html)           | [Sources and controls](examples/listening-room/implementation.md)            |
| Review checks and their limits                  | [Validation](validation/README.md)                             | [Fresh-context transfer review](validation/transfer-review.md)               |
| Check origins and reuse restrictions            | [Provenance](docs/provenance.md)                               | [Repository licensing status](../../README.md#license)                       |

Open `reference/index.html` directly in a browser for the brand overview, or `reference/illustrations.html` to choose artwork. Both use local HTML, CSS and SVG; no network connection, downloaded fonts or package installation is needed. The Markdown handbook is also readable directly in this repository.

## Reference structure

| Location                                                                                                | Purpose                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Brand overview](reference/index.html)                                                                  | Color, typography, density, composition and motion in context.                                                                            |
| [Illustration catalogue](reference/illustrations.html)                                                  | The complete selection of reusable objects, background elements and compositions, with links to their SVG sources and the character kits. |
| [Bend kit](bend/index.html), [kit manual](bend/README.md) and [Mini Bend manual](bend/mini/README.md)   | Character construction, supported poses, expressions and compact marks.                                                                   |
| [First hello](examples/first-hello/index.html) and [Listening room](examples/listening-room/index.html) | Applications of the same brand to a welcome and a personal collection; not alternate brand directions.                                    |
| [Validation](validation/README.md)                                                                      | Test procedures and bounded review records, not a second source of design rules.                                                          |

Choose artwork in the catalogue and follow the handbook for its use. Shared SVG geometry lives in `assets/` and character geometry in its renderers. Example-specific artwork stays with its example and is linked from the catalogue.

## Sources of authority

- This handbook defines visual and editorial decisions for the selected identity. New component constructions and composition recipes are design guidance, not findings from user testing.
- `tokens.json` is the machine-readable token source; `tokens.css` is generated from it. Do not maintain another palette in a screen stylesheet.
- `bend/bend.js` owns full-character geometry and expressions. Generated SVGs and motion use that same character; do not redraw it from a screenshot. `bend/mini/mini.js` owns the separate compact SVG mark and ASCII frames, not a scaled-down full character.
- The [product concept](../../docs/product-concept.md), [positioning](../../docs/positioning.md), and [requirements foundations](../../requirements/data/foundations.md) govern product meaning. Brand examples do not change those documents or prove that a capability exists.

All personal content in the brand examples is synthetic. Interactive examples simulate behavior locally; they do not run AI, connect services, or establish application storage, security, synchronization, theme, or platform guarantees. A dark illustration backdrop is not a dark-mode specification. No claim of user validation is made for the handbook or reference.

Original artwork is available under CC BY 4.0; code and documentation use MIT. See [provenance](docs/provenance.md#licensing) and the [licensing guide](../../LICENSING.md) for attribution, scope and third-party exceptions.
