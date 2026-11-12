# Licensing and reuse

Situate uses the [MIT License](LICENSE) for its original software and documentation and [Creative Commons Attribution 4.0 International (CC BY 4.0)](LICENSES/CC-BY-4.0.txt) for its original artwork. Third-party material keeps its own terms. The [trademark policy](TRADEMARKS.md) addresses product identity, not permission to use the code or artwork under those licenses.

## Which license applies?

| Material                                                                                               | License and scope                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Original source code, tests, scripts, configuration, documentation and technical diagrams              | MIT, unless a separate notice identifies other terms                                              |
| UI components, stylesheets, design tokens, layout implementations, renderers and animation controllers | MIT; reuse and modification do not require a different interface design                           |
| Original illustrations, Bend and Mini Bend artwork, wordmarks and app-icon artwork                     | CC BY 4.0, including copies, generated exports and the artwork embedded in examples or interfaces |
| Third-party code, icons, fonts and other material                                                      | Their respective licenses and notices; not relicensed by this document                            |

Artwork includes the assets in [`design/brand/assets/`](design/brand/assets/), [Bend SVG exports](design/brand/bend/svg/), [the anatomy illustration](design/brand/bend/anatomy.svg), and Mini Bend's [SVG](design/brand/bend/mini/mini.svg), [light SVG](design/brand/bend/mini/mini-light.svg) and [ASCII artwork](design/brand/bend/mini/mini.txt). It also includes original inline illustrations in the brand examples and workshop, artwork copies under [`client/workshop/src/brand/`](client/workshop/src/brand/), and the Situate app-icon exports under [`client/app/src-tauri/icons/`](client/app/src-tauri/icons/) and [`client/workshop/src-tauri/icons/`](client/workshop/src-tauri/icons/). The [brand provenance manifest](design/brand/docs/provenance.md) identifies canonical sources and their roles.

The software that renders or animates artwork is MIT-licensed; the artwork is offered under CC BY 4.0. Screenshots and other composite media can contain both original Situate material and third-party material. Retain the applicable notices for each part; a screenshot does not change the underlying licenses or grant third-party trademark rights.

## Reusing code

MIT permits commercial use, private modifications, redistribution and proprietary derivatives. It does not require publication of changes. Keep the copyright and permission notice in copies or substantial portions of the software, as required by [the license](LICENSE).

The collective credit “Situate contributors” identifies the project's contributors; it does not transfer their copyright or replace existing individual notices.

## Reusing artwork

CC BY 4.0 permits copying, modification and commercial reuse. When sharing artwork, give appropriate credit, identify and link to the license, indicate changes and retain supplied notices as required by [the legal text](LICENSES/CC-BY-4.0.txt). Attribution may be provided in a credits page or another reasonable place for the medium; it need not appear beside every UI illustration.

For the original artwork, use “Situate contributors” as the collective credit and link to the [Situate repository](https://github.com/getsituate/situate), preferably the specific source asset. Preserve any more specific supplied credit. For example:

> Bend artwork by [Situate contributors](https://github.com/getsituate/situate), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Colors and pose modified.

When using this example, link to the specific source where practical and describe the actual changes. Keep supplied copyright and warranty-disclaimer notices available with the material or through a reasonable linked credits resource.

The artwork license does not grant trademark rights or imply endorsement. It does allow artwork, including Bend, to be used outside Situate. The trademark policy does not add a non-commercial restriction, prohibit artistic modifications or withdraw the copyright permissions granted by MIT or CC BY 4.0. Statutory exceptions and limitations remain unaffected.

## Third-party material

Preserve existing third-party notices. Examples include:

- Provider icons: [app sources and license](client/app/src/ai/assets/providers/SOURCES.md) and [workshop sources and license](client/workshop/src/ai/assets/providers/SOURCES.md).
- Bundled AI notices: [AI catalog](client/app/public/licenses/ai-catalog.txt) and [Rig](client/app/public/licenses/rig.txt), plus notices in adapted source files.
- Dictation components: [third-party notices](client/app/src-tauri/dictation/THIRD-PARTY-NOTICES.txt).
- Website assets: [platform provenance](website/media/platforms/provenance.json), [provider-icon license](website/media/provider-icons-license.txt) and [PostHog notices](website/vendor/posthog-LICENSE.txt).
- Other separately licensed material, such as the [Ponytail skill](.pi/role-mode/skill-library/ponytail/LICENSE) and [Tauri updater fixtures](client/app/src-tauri/tests/fixtures/updater/LICENSE-MIT).

This list is not a complete dependency inventory. Distribution of an application or extracted asset collection must retain the notices required for the material actually included. The project licenses grant only rights the respective contributors are entitled to grant.

## License text sources

- **MIT:** [Open Source Initiative text](https://opensource.org/license/mit). The local [`LICENSE`](LICENSE) uses the [SPDX plain-text template](https://github.com/spdx/license-list-data/blob/31846481de7ea17d92f2f46fad76abe58b2e9bb0/text/MIT.txt) with its copyright placeholders completed. The permission and disclaimer text is unchanged.
- **CC BY 4.0:** [Creative Commons' official plain-text legal code](https://creativecommons.org/licenses/by/4.0/legalcode.txt), reproduced without changes in [`LICENSES/CC-BY-4.0.txt`](LICENSES/CC-BY-4.0.txt). SHA-256: `9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411`.

These explanations do not replace or modify the license texts.
