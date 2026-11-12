# Bend mini

A monochrome optical symbol for small supporting accents, with an optional stepped loading expression. It is separate from the [full Bend character](../README.md): the full character's 64 px minimum, crown face, colors, and anatomy are unchanged.

## Shape and scale

The SVG preserves the `quiet-mark` symbol from Design 04, **Soft precision**, in `design/brand-discovery/kinetic/index.html` at commit `6a00ee9` on `archive/brand-explorations-2026-09-30`. Its `0 0 32 32` viewBox contains the original round-capped arch (`M7 25V13a9 9 0 0 1 18 0v12`, stroke 7) and eyes (`M13 11v3m6-3v3`, stroke 1.6). This historical optical symbol has its eyes in the opening; that placement does not apply to the full character.

- **SVG:** 24 px by default, intended at 16, 24, or 32 px. Set `--bend-mini-size` on the icon or its container. `mini.css` enforces a 16 px minimum. Keep the square proportions.
- **ASCII:** exactly 5 columns by 3 rows of 7-bit ASCII. The default 10 px monospace font and line-height 1 produce a `5ch × 3em` box, approximately 30 × 30 px depending on installed font metrics. Do not squeeze it into a 16 px icon box. Preserve spaces, including the space at the end of the first row.
- Both formats inherit `currentColor`. Use ink on paper/surface, surface on plum, or optionally violet-deep through surrounding CSS. The token properties are `--situate-ink`, `--situate-surface`, `--situate-plum`, and `--situate-violet-deep`.
- The stylesheet reserves an 8 px inline-end gap beside text. It styles only `.bend-mini` and its format classes; it does not style arbitrary spans or pages.

There are no arms, mouth, props, depth, or whole-body movement in this variant. Do not add bounce, spin, travel, scaling, or opacity pulses.

## Rendering

Load `mini.css` and the classic script `mini.js`. Loading [the canonical token CSS](../../tokens.css) also supplies the shared spacing and font stack. The browser global is `window.SituateBendMini`; CommonJS consumers can `require('./mini.js')` for rendering and immutable geometry, frame, and score data. Rendering has no DOM dependency.

```js
const markup = SituateBendMini.render({
  format: "svg",
  decorative: true,
  title: "Bend",
});
```

`render({format = 'svg', decorative = true, title = 'Bend'})` returns one self-contained SVG or span, with no IDs, external symbols, or autonomous animation:

| Option       | Values                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| `format`     | `'svg'` or `'ascii'`                                                           |
| `decorative` | Boolean; use `true` when adjacent words already provide the meaning            |
| `title`      | Nonempty text without control characters; escaped before insertion into markup |

Decorative roots have `aria-hidden="true"`. Informative roots have `role="img"` and a stable `aria-label` taken from `title`. ASCII punctuation is hidden inside the named root and neither format adds a live region. Frame changes never change the accessible name. Put actual loading messages, errors, and outcomes in adjacent application-owned text, not the title or frame punctuation.

SVG roots have `width="24" height="24"`. All roots have `data-bend-mini="svg"` or `"ascii"`, the classes `bend-mini bend-mini--svg` or `bend-mini bend-mini--ascii`, and `data-mini-frame="rest"`. The ASCII root preserves whitespace even without the stylesheet; load the stylesheet for its font and fixed box. SVG paths are identified by `data-mini-body` and `data-mini-eyes`; the ASCII content has `data-mini-glyph`.

Invalid option types, unknown formats, empty titles, and malformed controller roots throw `TypeError`.

## Busy-state controller

Insert the returned markup before creating a controller:

```js
const host = document.querySelector("#loading-icon");
host.innerHTML = SituateBendMini.render({ format: "ascii" });
const mini = SituateBendMini.create(host.firstElementChild);

// Connect these calls to the actual operation's lifecycle.
mini.setBusy(true);
mini.setBusy(false);

// Motion controls do not pause or cancel the operation.
mini.pause();
mini.resume();

// Dispose when the containing view is removed.
mini.destroy();
```

`create(renderedRoot)` starts still and returns:

| Member             | Behavior                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setBusy(boolean)` | Only `true` permits animation. `false` cancels the timer and restores rest immediately. Repeated `true` does not restart an active score. Nonboolean arguments throw while the controller is alive. |
| `pause()`          | Explicit, persistent pause; restores rest, even if already idle. Later busy changes do not clear it.                                                                                                |
| `resume()`         | Clears the explicit pause; only starts motion if busy and eligible to animate.                                                                                                                      |
| `destroy()`        | Cancels work, restores rest, clears busy, removes listeners, and disconnects observers. Idempotent. All subsequent method calls are no-ops.                                                         |
| `state`            | A fresh read-only snapshot: `{busy, paused, running, destroyed, frame}`. `running` means one frame timeout is pending, not that the external operation is progressing.                              |

A `WeakMap` gives each root one controller owner. Creating a second controller destroys the first. Do not replace the root's paths or glyph span while its controller is alive.

The caller owns the operation, status label, `aria-busy`, results, and page lifecycle, including `pagehide`/`pageshow`. The controller never infers busy state from attributes and never updates those application states. These frames are not percentages, elapsed-work estimates, or completion events.

### Shared score

Both formats use the same discrete 2400 ms score, without interpolation:

| Frame | Duration | SVG eyes                                              |
| ----- | -------- | ----------------------------------------------------- |
| rest  | 900 ms   | Original vertical eyes                                |
| focus | 600 ms   | Eyes lowered by 1.5 viewBox units                     |
| blink | 120 ms   | Small horizontal lids centered at x=13 and x=19, y=13 |
| rest  | 780 ms   | Original vertical eyes                                |

ASCII strings in JSON notation, with significant spaces preserved:

```json
{
  "rest": " .-. \n|' '|\n|   |",
  "focus": " .-. \n|. .|\n|   |",
  "blink": " .-. \n|- -|\n|   |"
}
```

The chat composer uses a separate continuous active-eye treatment between gestures, as specified in [motion guidance](../../docs/motion.md#compact-loading-feedback). The shared controller and score below remain unchanged for other surfaces.

The score repeats only while the caller's busy state is true. There is at most one bounded frame timeout per controller; there is no animation-frame loop or CSS animation.

### Suspension

Reduced motion always means static rest, including live preference changes. Explicit resume cannot override that preference. Hidden documents, detached roots, zero-size/hidden roots, and offscreen roots suspend scheduling. Every suspension restores rest and every eligible resumption restarts the full initial 900 ms rest; elapsed hidden time is never caught up.

Viewport bounds are checked before scheduling and on frame callbacks. `IntersectionObserver` also detects clipping; visibility, resize, and captured scroll events trigger rechecks. A document mutation observer detects removal, reinsertion, and style/class/hidden changes without polling. Destroy controllers for discarded views rather than retaining their listeners indefinitely.

In browsers without `IntersectionObserver`, the resize/scroll fallback checks viewport bounds but cannot fully detect clipping by overflow ancestors. Occlusion by other elements or modal overlays is not detected; the caller should pause decorative motion in those situations. Modern DOM APIs, timers, and media queries are expected; no polyfills are included.

## Exports and checks

`generate.cjs` writes these deterministic exports from the renderer and [canonical tokens](../../tokens.json):

- [`mini.svg`](mini.svg): ink, with `currentColor` strokes and a root color from `colors.ink`.
- [`mini-light.svg`](mini-light.svg): the same geometry, with a root color from `colors.surface`.
- [`mini.txt`](mini.txt): the exact rest ASCII string, without a final newline.

When using an SVG as an external image, provide the appropriate `alt` on the image element. External images cannot inherit the host page's text color. Use inline rendering when inherited color or motion is needed.

Run from the repository root:

```sh
node design/brand/bend/mini/generate.cjs
node design/brand/bend/mini/generate.cjs --check
node --test design/brand/bend/mini/mini.test.cjs
node design/brand/bend/mini/browser.test.cjs
```

The browser test uses an existing Playwright module and installed Chrome. If the module is outside Node's search path, set `PLAYWRIGHT_MODULE` to its module directory; `PLAYWRIGHT_CHANNEL` defaults to `chrome`. No download or package installation is part of these commands. Captures go to a temporary directory unless `MINI_SCREENSHOTS` is supplied; keep captures outside version control.

Unit checks cover exact geometry, historical-source comparison when that commit is available, 7-bit ASCII grids, escaping, validation, frozen data, canonical export colors, and deterministic drift detection. Browser checks cover both formats with and without `IntersectionObserver`, exact frame boundaries, body and box stability, busy/pause/resume, live reduced motion, simulated document visibility, clipping, viewport suspension, removal/reinsertion, replacement ownership, and teardown accounting. Chrome accessibility-tree checks cover stable informative names and ignored decorative roots. The screenshot includes SVG sizes and all ASCII frames on light and plum grounds, and the test reports the actual system font used.

These checks are not cross-browser verification, screen-reader speech testing, audience-recognition research, or an accessibility-conformance assessment. Inspect default-size glyphs and leg continuity on the installed fonts of each supported platform.

## Provenance and rights

The miniature geometry is original project material recovered from the historical symbol above. Its ASCII counterpart, renderer, controller, and exports are maintained here; no outside artwork or font files are bundled. The artwork, including SVG and ASCII exports, uses CC BY 4.0; the renderer, controller and documentation use MIT. See [provenance and licensing terms](../../docs/provenance.md#licensing) for attribution and the separate trademark policy.
