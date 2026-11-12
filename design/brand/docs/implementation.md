# Implementation

[Handbook](../README.md) · [Visual reference](../reference/index.html) · [Character kit](../bend/README.md) · [Validation](../validation/README.md)

## Canonical files

| File                                                                                                                     | Responsibility                                                                     | Edit policy                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`tokens.json`](../tokens.json)                                                                                          | Shared color, type, spacing, radius, stroke, and motion values                     | Edit source, then regenerate CSS                                                                                      |
| [`build-tokens.cjs`](../build-tokens.cjs)                                                                                | Deterministic token-to-CSS generation                                              | Keep validation and output synchronized                                                                               |
| [`tokens.css`](../tokens.css)                                                                                            | Browser-ready `--situate-*` variables                                              | Generated; do not hand-edit                                                                                           |
| [`bend/bend.js`](../bend/bend.js)                                                                                        | Bend's body, face, pose, prop, and SVG rendering                                   | Extend here rather than duplicating paths                                                                             |
| [`bend/motion.js`](../bend/motion.js)                                                                                    | Finite gesture controller                                                          | Keep work state separate from animation                                                                               |
| [`bend/performance.js`](../bend/performance.js)                                                                          | Deterministic articulated body, arm, and facial channels                           | Read canonical SVG geometry; the embedding scene owns time and lifecycle                                              |
| [`bend/mini/`](../bend/mini/)                                                                                            | Compact SVG and ASCII mark, busy-only frame controller, CSS, and generated exports | Separate optical master; see the [Mini Bend API](../bend/mini/README.md)                                              |
| [`bend/generate.cjs`](../bend/generate.cjs)                                                                              | Static SVG generation and consistency check                                        | Regenerate after source changes                                                                                       |
| [`bend/svg/`](../bend/svg/)                                                                                              | Ready-to-place static Bend exports                                                 | Generated; do not hand-edit                                                                                           |
| [`assets/`](../assets/)                                                                                                  | Original SVG assets and documented print exports                                   | Edit SVG sources; generated panorama layers and the DOCX PNG are exceptions                                           |
| [`build-scenes.cjs`](../build-scenes.cjs)                                                                                | Splits the canonical panorama into four independent SVG layers                     | Edit named groups in `assets/panorama.svg`, then regenerate; do not hand-edit `panorama-back-*` or `panorama-front-*` |
| [`reference/index.html`](../reference/index.html)                                                                        | Brand overview and interactive examples                                            | Composition and behavior guidance, not an asset catalogue or product application                                      |
| [`reference/illustrations.html`](../reference/illustrations.html), [`illustrations.css`](../reference/illustrations.css) | Complete visual selection of objects, backgrounds and compositions                 | Reuse source SVGs; keep the catalogue inventory checks in `reference.test.cjs` current                                |
| [`reference/reference.css`](../reference/reference.css)                                                                  | Concrete compositions and component styling                                        | Consume tokens; keep generic values centralized                                                                       |
| [`reference/reference.js`](../reference/reference.js)                                                                    | Reference controls and simulated state                                             | No AI or external service behavior                                                                                    |
| [`reference/mini-example.js`](../reference/mini-example.js)                                                              | Local loading simulation and miniature lifecycle integration                       | Operation timer independent of motion; no real file loading                                                           |
| [`examples/listening-room/`](../examples/listening-room/)                                                                | New composition, musical collection, and side-indexed listening note               | Consume shared sources; example behavior is not product scope                                                         |
| [`examples/first-hello/`](../examples/first-hello/)                                                                      | Ten-second welcome score, player, and isolated gesture study                       | No onboarding integration or real-operation dependency                                                                |

The reference is a small dependency-free HTML/CSS/SVG/vanilla JavaScript package. This format does not select the application framework, plugin runtime, storage model, or theming API.

## Read and extend tokens

`tokens.json` groups named string values under objects such as `colors`, `type`, `spacing`, `radii`, `strokes`, and `motion`. Top-level keys beginning with `$` contain descriptive metadata and are skipped by the generator. Each token name becomes `--situate-<name>`; names must be unique across groups.

For example, `colors.paper` supplies `--situate-paper`, and `type.font-body` supplies `--situate-font-body`. Use those roles in CSS:

```css
.personal-panel {
  background: var(--situate-surface);
  color: var(--situate-ink);
  font-family: var(--situate-font-body);
  border: 1px solid var(--situate-line);
}

.personal-panel p {
  line-height: var(--situate-leading-body);
}
```

Before adding a token, decide whether it is a reusable role or a one-off illustration detail. Use an existing role when the purpose is the same. Keep character colors and geometry synchronized with the renderer if changing an artwork role. Do not create a `page-two-purple` variable for an existing violet or a whole second palette for an empty state.

From the repository root:

```sh
node design/brand/build-tokens.cjs
node design/brand/build-tokens.cjs --check
```

The first command writes generated CSS. The second checks consistency without updating it. Include both source and generated changes together. A successful consistency check does not establish contrast, responsive behavior, or correct product claims.

## Workflow: a new screen

1. **Name the real task.** Decide whether this is daily work or an expressive welcome. Read [principles](principles.md) and identify the product boundary in the relevant requirements before introducing an action.
2. **Start from content.** Write the title, source, main action, and needed states using [voice](voice.md). Use synthetic data for a reference. Separate any simulation notice from the simulated work surface.
3. **Choose the composition.** Start with a panel or page recipe from [layout](layout-and-components.md). Use paper/surface and ink first; add one main accent and only the illustration that earns its space.
4. **Load canonical CSS.** Link `tokens.css` before page styles. Do not fetch JSON in the browser just to create variables; local `file://` loading and network-free use should work.
5. **Implement semantics first.** Use a real heading hierarchy, buttons, links, labels, native inputs, and appropriate dialog behavior. Make state understandable in words and native control states.
6. **Place optional art.** Reuse an SVG object or render Bend; do not trace a screenshot. Keep decoration out of the task's reading and focus order.
7. **Adapt layout.** Test narrow containers, long names, system-font fallbacks, and zoom. Do not solve overflow by reducing essential text or clipping controls.
8. **Verify the complete experience.** Use the checks below; generation checks alone cannot validate the screen.

## Workflow: a new illustration

1. Choose one subject and the objects that explain it. Use [illustration recipes](illustration.md), not a collection of unrelated decorative shapes.
2. Open an existing SVG source from `assets/` to inspect its viewBox, palette, layer order, and depth treatment. Work in vector geometry. PNG previews are for inspection only.
3. Keep the character separate from the scene. Render Bend from `bend.js` or use an unmodified generated export; place it by scaling the whole SVG uniformly.
4. Put words and actions in HTML unless the text is intrinsic artwork such as the vector wordmark. Avoid baking copy into illustration paths.
5. Check the composition on paper and on its intended field, at full size and thumbnail size. Ensure negative space and focal order survive cropping.
6. Give the new SVG a descriptive English filename. Record its source, dependencies and category in [provenance](provenance.md), and add its source link and previews to the [illustration catalogue](../reference/illustrations.html). Objects, background elements and compositions each have one catalogue entry. Identity marks, generated layers and character exports retain their specialist references. Update the inventory checks in `reference/reference.test.cjs`; do not start another partial gallery. Do not add a license grant.
7. If character source changed, regenerate Bend exports and run the consistency check. If tokens changed, regenerate CSS too. If the panorama changed, run `node design/brand/build-scenes.cjs` and its `--check` mode. Keep the `data-scene-layer` groups named `back-ribbons`, `back-objects`, `front-ribbons`, and `front-objects`; the generator preserves those groups and local symbol definitions in standalone exports.

## Workflow: Bend in a new situation

First see whether a supported pose and expression already communicate the situation. Poses are `rest`, `wave`, `read`, `carry`, `celebrate`, and `point`; expressions are `welcome`, `curious`, `thinking`, `pleased`, and `unsure`.

A classic-script example for an HTML file one directory below `design/brand/`, such as a reference page:

```html
<link rel="stylesheet" href="../tokens.css" />
<div id="welcome-bend"></div>
<button id="greet-bend" type="button">Say hello to Bend</button>
<script src="../bend/bend.js"></script>
<script src="../bend/motion.js"></script>
<script>
  (() => {
    const host = document.querySelector("#welcome-bend");
    host.innerHTML = window.SituateBend.render({
      idPrefix: "welcome-bend-1",
      pose: "wave",
      expression: "welcome",
      title: "Bend waves hello",
      decorative: false,
    });
    const controller = window.SituateBendMotion.create(
      host.querySelector("svg"),
    );
    document.querySelector("#greet-bend").addEventListener("click", () => {
      controller.play("hello");
    });
    window.addEventListener("pagehide", () => controller.destroy(), {
      once: true,
    });
  })();
</script>
```

`render()` returns SVG markup, not a DOM node. This example inserts only markup produced by the known renderer with explicit options. Do not use the pattern to insert arbitrary user HTML. For a decorative character beside text that already supplies its meaning, use `decorative: true` instead.

The example gives one SVG instance its own prefix. A reusable component needs an instance counter or other document-unique allocator. Do not copy `welcome-bend-1` into every instance. During a page's ordinary teardown, call `destroy()` before removing the SVG. If supporting back/forward cache restoration after `pagehide`, re-create the controller on restoration before allowing another gesture.

`SituateBendMotion.create(svg)` returns `play(name)`, `pause()`, `resume()`, `stop()`, and `destroy()`. The supported gestures are `hello`, `consider`, `gather`, `celebrate`, and `point`. See the [kit manual](../bend/README.md) for return values and detailed lifecycle behavior. Do not infer product state from a resolved gesture promise.

If no existing pose fits, extend the shared pose/prop implementation, not a generated output. Preserve the body, face placement, open negative space, arm attachment, and clipping. Add an export and check it with every supported expression where the kit supports that combination. Verify at 32, 64, and 320 px on paper and ink. Keep hands connected to props throughout a gesture; move them together when needed.

From the repository root:

```sh
node design/brand/bend/generate.cjs
node design/brand/bend/generate.cjs --check
```

## Workflow: a compact loading mark

Use [`SituateBendMini`](../bend/mini/README.md), not the full character renderer or performance rig. The miniature has its own monochrome SVG and five-column ASCII construction. Load `mini.css` and `mini.js`, insert `render({format: 'svg'})` or `render({format: 'ascii'})`, and pass the rendered root to `create()`. Supply busy state through `setBusy(boolean)`; `pause()` and `resume()` affect only the eye frames. Call `destroy()` before removing or replacing the instance.

Keep the result and visible status text in the application's operation model. Stop the mark on every outcome, including failure and cancellation, and preserve immediate results when animation is suppressed. The [reference simulation](../reference/mini-example.js) demonstrates completion, retry, cancellation, global pause, and page-cache restoration without implementing a file or service API. Its four-second timeout is demonstration behavior, not a recommended minimum loading time.

## SVG labels and unique IDs

- For an informative external image, supply a concise HTML `alt`. For decorative artwork, use `alt=""`.
- For informative inline Bend, use `decorative: false` and a meaningful `title`. The renderer associates it with the SVG's accessible label.
- For decorative inline Bend, use `decorative: true`; do not add a redundant title or focus target around it.
- The same page must never contain two identical inline title, mask, clip-path, or symbol IDs. Every call to the full-character `SituateBend.render()` needs a unique `idPrefix`, beginning with a letter and using only letters, digits, underscores, or hyphens.
- A standalone SVG used by `<img>` has its own ID scope. If you paste that file's markup inline, prefix **all** its IDs and references, not just its title. Multiple copies of a scene may otherwise resolve another scene's definitions.
- Keep stable external filenames for assets that other pages use. Update both links and the manifest if an asset moves.

## Offline and font behavior

Use relative URLs, classic scripts, and local stylesheets. Do not add remote font imports, CDN scripts, tracking, fetch calls, install steps, or downloaded images to a brand specimen. If a local development server is useful for inspection, it is optional; direct opening of the reference should remain possible.

System-font rendering is expected to differ across OSs. Inspect the real fallback rather than screenshot-matching with an unlicensed font file. The vector wordmark does not depend on installed fonts; body and display text do. No font binaries are distributed with the brand.

## Verification

Start with the dependency-free source checks:

```sh
node design/brand/build-tokens.cjs --check
node design/brand/build-scenes.cjs --check
node design/brand/bend/generate.cjs --check
node design/brand/bend/mini/generate.cjs --check
```

Use the [validation guide](../validation/README.md) for the maintained test commands and scope. Report which commands actually ran, not just which ones are available.

For every new screen or composition, also inspect:

- **Links and offline use:** all local files resolve; no reference points to a removed source; there are no network requests required for rendering or interaction.
- **Keyboard:** visible focus, sensible order, native control operation, dialog dismissal and focus return, no trapped or unreachable action.
- **Reflow:** 320/375/768/1440 px widths, long labels, 200% zoom, and no clipped focus rings or essential content.
- **Contrast and meaning:** actual foreground/background pairs, selected and disabled states, text alternatives, non-color state indicators, and accessible descriptions before failure, during failure, and after recovery.
- **Motion:** reduced motion at startup and after a setting change; repeated activation; pause/resume/stop; hidden and offscreen behavior; controller teardown.
- **SVG:** unique inline IDs, local definitions, clean proportions, paper/ink recognition, and no independent copy of character geometry.
- **Claims and provenance:** synthetic content, accurate simulation explanation, no unverified AI/security claims, no private information, accurate license scope and attribution.

Record limitations explicitly. Static analysis does not replace a browser check; a browser check on one OS does not establish font parity or support on every target platform. Validation results describe the files and environment tested, not product readiness.
