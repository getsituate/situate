# Listening room

Open [index.html](index.html) directly from disk. This is an offline composition with fictional albums, artists, tracks, and notes, not an application release. Changes exist only in page memory and reset on reload. There is no audio playback, AI, account connection, service call, or persistent storage.

## Composition and controls

The welcome pairs Bend with a record resting on its sleeve. Below it, the side-indexed listening card connects an album, a record side, a track, and a written detail. The work surface has no character or ambient motion.

- **Records:** select an album, then Side A or Side B and a track. Notes are independent for each album/side/track combination.
- **Keep note:** copies the text into the visible note. Blank or whitespace-only input explains what is missing and focuses the field. Tracks without a note offer a writing prompt.
- **Restore kept note / Clear draft:** replaces the unkept text with the retained note, or clears an unkept draft. Changing albums, sides, or tracks discards unkept edits; it does not discard kept notes.
- **Next up:** check and uncheck the listening task. The open count changes immediately, without animation.
- **Point to the record:** requests the kit's one-second `point` gesture. **Pause motion / Resume motion** preserves the pause choice across replays. **Show still** cancels the gesture. Nothing plays automatically. Reduced motion takes precedence; the scene also has a static SVG fallback without JavaScript.

## Sources and provenance

| Source                                                                                                                                                                                                                                                                                                                                                                                       | Use                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Handbook](../../README.md) and its [principles](../../docs/principles.md), [type/tokens](../../docs/tokens-and-typography.md), [layout](../../docs/layout-and-components.md), [illustration](../../docs/illustration.md), [motion](../../docs/motion.md), [voice](../../docs/voice.md), [implementation](../../docs/implementation.md), and [provenance](../../docs/provenance.md) chapters | Identity, composition, semantics, writing, and reuse boundaries              |
| [Token source](../../tokens.json) and [generated CSS](../../tokens.css)                                                                                                                                                                                                                                                                                                                      | Shared palette, type, spacing, and shape; CSS is linked directly, not copied |
| [Kit manual](../../bend/README.md), [renderer](../../bend/bend.js), [motion controller](../../bend/motion.js), and [point/curious export](../../bend/svg/point-curious.svg)                                                                                                                                                                                                                  | Unmodified character and motion, plus the no-JavaScript fallback             |
| [Visual reference](../../reference/index.html), its [opening/component styles](../../reference/reference.css), and [book source](../../assets/book.svg)                                                                                                                                                                                                                                      | Current rendered identity, surface recipes, and offset-plane construction    |
| [Wordmark](../../assets/wordmark.svg)                                                                                                                                                                                                                                                                                                                                                        | Unmodified header artwork                                                    |
| [Product concept](../../../../docs/product-concept.md), [positioning](../../../../docs/positioning.md), [foundations](../../../../requirements/data/foundations.md), and [decision authority](../../../../requirements/data/goals/GOAL-0004-decision-authority.md)                                                                                                                           | Single-person scope and limits on product claims                             |
| [Transfer brief](../../validation/transfer-brief.md) and [validation guide](../../validation/README.md)                                                                                                                                                                                                                                                                                      | Composition scope and verification                                           |

The record, sleeve, and surrounding curves are original inline SVG in `index.html`; the three abstract cover motifs are original CSS in `listening-room.css`. Their colors resolve through the shared tokens. Bend's geometry is neither copied nor modified. `listening-room.js` provides local state and connects the canonical renderer/controller. No downloaded assets, font files, or new runtime dependencies are included. The [repository licensing status](../../../../README.md#license) remains unchanged; this example grants no separate license.

## Checks

From the repository root:

```sh
node design/brand/build-tokens.cjs --check
node design/brand/bend/generate.cjs --check
node --test design/brand/bend/bend.test.cjs
node design/brand/validation/check.cjs
PLAYWRIGHT_MODULE=/path/to/existing/playwright \
  node design/brand/examples/listening-room/browser.test.cjs
```

The browser script uses installed Chrome (`BROWSER_CHANNEL` can select another installed channel). Screenshots go to a temporary directory, or to `LISTENING_SCREENSHOTS` when set. It does not install or download anything.

Verified in installed Chrome 154.0.8037.58 on macOS:

- Local interactions, blank-input recovery, literal rendering of entered markup, independent notes, task reversal, and reload reset.
- Keyboard activation, native side-radio navigation, focus on validation failure, and a 3 px focus outline. Chromium accessibility-tree assertions check conditional error and motion descriptions before, during, and after the corresponding states.
- No horizontal overflow at 320, 375, 768, and 1440 px, with long content, system-font fallback, and 200% CSS zoom. Character, record, and sleeve bounds stay within the stage.
- Sampled computed text contrast: 5.16:1 or higher; sampled essential control boundaries: 3.89:1 or higher. This is not an exhaustive accessibility audit.
- Finite completion, replacement, persistent pause, stop, offscreen suspension, a synthetic document-hidden event, live/startup reduced motion, teardown, and simulated cached-page restoration.
- Loaded local images, unique IDs, no browser errors or attempted remote requests, and readable static content with JavaScript off.

Visual inspection covered desktop and narrow layouts, the static and paused pointing scene, and the character on paper and plum. The face, opening, shoulder layering, rim, and crease remain visible; the record is separate from the hand. This is visual judgment, not evidence of emotion recognition or user preference.

## Guidance gaps and limitations

- The frozen exercise's write boundary prevented central provenance registration during authoring. The local record above is now also registered in the [central manifest](../../docs/provenance.md). Shared token and character sources are unchanged.
- No record-specific component or track-numbering recipe is defined. Side-local numbering and one note per track are example-level choices, not product requirements. No blocking visual instruction conflict was found.
- Unkept edits are not retained when changing selection; there is no note history or undo for replacing a kept note. The task remains directly reversible.
- CSS zoom checks enlargement/reflow, not browser chrome zoom. Physical touch, screen-reader output, other browsers/operating systems, real OS background suspension, and actual back/forward-cache navigation were not tested.
- The narrowest stage has little lateral clearance. Automated bounds checks do not assess the comfort of that crop. This composition is not user research or evidence of general brand-transfer reproducibility. The [transfer review](../../validation/transfer-review.md) separates the first submission's findings from subsequent corrections.
