# Workshop brand snapshot

These are independent copies for Vue design experiments:

- `tokens.css`: initial values from [`design/brand/tokens.css`](../../../../design/brand/tokens.css).
- `assets/wordmark.svg`: the canonical [wordmark](../../../../design/brand/assets/wordmark.svg).
- `assets/book.svg`, `page.svg`, `card.svg` and `folded-leaf.svg`: unchanged copies of the [canonical paper objects](../../../../design/brand/docs/provenance.md#asset-manifest). The onboarding welcome composes them with locally authored ribbons and the burst outline from `design/brand/assets/panorama.svg`.
- `assets/collection-folder.svg`, `linked-notes.svg`, `folded-map.svg`, `paper-tray.svg` and `modular-pieces.svg`: unchanged copies of the [canonical paper objects](../../../../design/brand/docs/provenance.md#asset-manifest), used alongside Bend in workspace setup. The setup illustrations use locally composed saturated ribbons; the canonical objects and character keep their colors.
- `bend/svg/wave-welcome.svg`: the canonical [wave/welcome Bend export](../../../../design/brand/bend/svg/wave-welcome.svg), including its geometry and motion origins.
- `bend/svg/point-curious.svg`: the canonical [point/curious Bend export](../../../../design/brand/bend/svg/point-curious.svg), used as a still illustration in the plugin collection’s empty state.
- `bend/svg/rest-welcome.svg`, `carry-welcome.svg`, `rest-unsure.svg` and `celebrate-pleased.svg`: canonical pose exports copied for the onboarding companion. Their body, face, clipping and motion origins are unchanged; the workshop owns playback.
- `bend/performance.js`: a snapshot of the canonical [performance rig](../../../../design/brand/bend/PERFORMANCE.md), with its global wrapper replaced by an ES module export. Geometry and pose calculations are unchanged. `performance.d.ts` describes the local module API.
- The native icon in `../../src-tauri/icons/icon.png` is copied from the product icon, generated from the canonical [app-icon artwork](../../../../design/brand/assets/app-icon.svg).

Edit workshop tokens locally. Canonical brand generation does not update this folder. Asset refreshes and promotion of experiments are explicit, reviewed copies; never import or synchronize canonical files at runtime or during a build.

The [brand handbook](../../../../design/brand/README.md) remains design guidance. Preserve the [asset provenance](../../../../design/brand/docs/provenance.md), third-party terms and [repository licensing status](../../../../README.md#license). These copies grant no additional redistribution rights.
