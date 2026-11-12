# Checking the brand sources

[Handbook](../README.md) · [Visual reference](../reference/index.html) · [Character kit](../bend/README.md)

Use automated checks to catch broken assets and behavior, then inspect the rendered composition. A passing script does not establish emotional fit, expression recognition, or accessibility conformance.

## Source and export checks

From the repository root, with Node.js 22 or later:

```sh
node design/brand/validation/check.cjs
node --test design/brand/bend/bend.test.cjs
node --test design/brand/bend/mini/mini.test.cjs
```

The first command checks generated token, scene-layer, full-character SVG, and miniature SVG/ASCII consistency, all 30 pose/expression combinations, deterministic rendering, accessible SVG labeling, namespaced references, and local document links. The character tests cover the renderer's own input and geometry contracts.

To regenerate assets after editing their canonical sources:

```sh
node design/brand/build-tokens.cjs
node design/brand/build-scenes.cjs
node design/brand/bend/generate.cjs
node design/brand/bend/mini/generate.cjs
```

Review the resulting diff. Do not update generated files merely to make a check pass without understanding the source change.

## Browser checks

`browser.cjs` uses an existing Playwright installation and Chrome. Neither is downloaded by the script. If Playwright is already resolvable by Node and Chrome is installed:

```sh
node design/brand/validation/browser.cjs
```

For an installation outside the repository, set `PLAYWRIGHT_MODULE` to that package's directory. Set `BROWSER_EXECUTABLE` to an existing compatible Chromium executable, or `BROWSER_CHANNEL` to an installed Playwright-supported Chromium channel. `BRAND_SCREENSHOT_DIR` optionally selects an output directory; otherwise captures go to a temporary directory. Do not commit machine-specific paths or generated browser logs.

The suite checks:

- Parsed SVGs and visible body details with and without the rear arms, including sampled waving angles.
- Five distinct rendered expression images on paper and plum.
- Finite completion, replacement, pause/resume, stop, destruction, offscreen suspension, and live reduced-motion changes.
- A synthetic document-visibility event. This is not a test of real operating-system suspension or lifecycle recovery.
- Local pages at 320, 390, and 1440 CSS pixels, including overflow, loaded images, unique IDs, script errors, and external requests.

For the brand overview's local controls, ambient layers, accepted long names, mobile character clearance and conditional accessible descriptions, plus the illustration catalogue's inventory and browser layout, also run:

```sh
node design/brand/reference/reference.test.cjs --browser
```

This uses the same `PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE`, and `BROWSER_CHANNEL` settings. Chrome is the default; it does not download a browser.

The catalogue checks account for every SVG in `assets/`: reusable objects, background elements and compositions have one catalogue entry, while identity marks and generated layers have explicit separate roles. Source links, paired paper/plum previews and decorative-image semantics are checked alongside offline use, keyboard navigation, 320/375/768/1440 px reflow and 200% CSS zoom. Run the same command without `--browser` for source-only checks. `SCREENSHOT_DIR` optionally saves rendered reference and catalogue captures outside the source tree.

For the Listening room's album/side/track interactions, reversible task, input recovery, motion, responsive layout, and accessibility-tree descriptions:

```sh
node design/brand/examples/listening-room/browser.test.cjs
```

This script accepts `PLAYWRIGHT_MODULE`, `BROWSER_CHANNEL` (Chrome by default), and `LISTENING_SCREENSHOTS` for an optional capture directory. Its 200% CSS zoom and synthetic lifecycle checks are not actual browser-zoom or OS-lifecycle tests. See its [implementation note](../examples/listening-room/implementation.md) for scope.

For articulated facial/arm/gait channels and the ten-second introduction:

```sh
node --test design/brand/bend/performance.test.cjs
node --test design/brand/examples/first-hello/timeline.test.cjs
PLAYWRIGHT_MODULE=/path/to/existing/playwright node design/brand/bend/performance.browser.test.cjs
PLAYWRIGHT_MODULE=/path/to/existing/playwright node design/brand/examples/first-hello/browser.test.cjs
```

The [rig manual](../bend/PERFORMANCE.md) and [introduction notes](../examples/first-hello/README.md) document their geometry, clock, lifecycle, and sampled-browser limits. These checks do not establish perceived personality or natural gait.

For the miniature SVG/ASCII controller and its integration into the brand reference:

```sh
PLAYWRIGHT_MODULE=/path/to/existing/playwright node design/brand/bend/mini/browser.test.cjs
PLAYWRIGHT_MODULE=/path/to/existing/playwright node design/brand/reference/mini-example.test.cjs
```

The [miniature manual](../bend/mini/README.md) covers its source, discrete frame score, and controller checks. The reference suite checks both formats, 320/375/768/1440 px layouts, 200% CSS zoom, keyboard operation, status announcements in the DOM, exclusion of decorative punctuation from the Chromium accessibility tree, explicit and reduced-motion pause, independent completion, error/cancel/retry, simulated page-cache events, and no-JavaScript fallbacks. `MINI_SCREENSHOTS` optionally chooses a capture directory for either suite. CSS zoom and synthetic lifecycle events are not actual browser zoom or OS suspension tests; accessibility-tree checks are not screen-reader speech verification.

Keep browser versions with review results. Font fallback can change wrapping and screenshots; do not treat one machine's raster output as a universal typography specification.

## Rendered review

Inspect the anatomy close-up first, then the full composition. Check static expressions without their labels, a mid-gesture frame, a small instance, a dense reading area, and a narrow viewport. Look for shoulder lines that cover body details, disconnected hands, clipped faces, props that drift out of a grip, and illustrations that compete with the primary action.

Operate interactive examples with both pointer and keyboard. Check focus after updates, invalid input and recovery, repeated actions, reset, long text, and enlargement. Pause motion before changing a pose or starting another scene, then test the reduced-motion preference while a gesture is already running. User content changes must not wait for a decorative animation.

Measure text and essential-control contrast against actual rendered backgrounds. The token contrast table does not cover opacity, overlays, images, or every hover/focus state. Test screen-reader output and physical touch devices separately where available; semantic markup and automated snapshots alone do not establish that experience.

## Transfer to a new composition

The [listening-room exercise](transfer-brief.md) defines a fresh-context task and review criteria before its output is inspected. It asks a new contributor to make a context-specific component, illustration, and Bend interaction using only the current brand packet, without changing that packet during the attempt.

Review the first submitted artifact against those criteria before supplying corrections. Record concrete findings, any revisions, and the limits of the exercise. A transfer review assesses a bounded composition, not general model capability or user usability. The [recorded review](transfer-review.md) identifies the frozen packet, first-submission findings, corrections, and untested areas; the [Listening room](../examples/listening-room/index.html) is the resulting composition.
