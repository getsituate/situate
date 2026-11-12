# Bend performance rig

`performance.js` adds articulated steps, arm gestures and facial movement to the canonical `rest` / `welcome` SVG. It is intended for finite, staged welcomes. Daily-work artwork should remain still. The [character manual](README.md) remains the source for anatomy, placement, accessibility and color; [motion guidance](../docs/motion.md) covers when movement is appropriate.

The rig has no clock, animation objects, timers, listeners or observers. A scene supplies complete poses, so scrubbing, pausing and replaying do not depend on earlier frames. Static SVG exports and `motion.js` are unchanged. **Do not use this rig and the older motion controller on the same SVG.** Destroy the previous controller before changing ownership.

## Load and create

Load the files as classic scripts and render an inline SVG:

```html
<div id="welcome-art"></div>
<script src="bend.js"></script>
<script src="performance.js"></script>
<script>
  const host = document.querySelector("#welcome-art");
  host.innerHTML = SituateBend.render({
    idPrefix: "welcome-bend",
    pose: "rest",
    expression: "welcome",
    decorative: true,
  });
  const rig = SituateBendPerformance.create(host.querySelector("svg"));
  rig.set({ wave: 1, wavePhase: Math.PI / 2, mouth: 0.6 });
</script>
```

`window.SituateBendPerformance.create(svg)` returns a frozen object with exactly three methods: `set(state)`, `reset()` and `destroy()`. Each returns `undefined`.

- Supply an SVG produced by `render({pose: 'rest', expression: 'welcome', …})`. Other pose/expression combinations, missing geometry and unsupported path commands throw `TypeError`. The rig reads geometry from the SVG; it does not require the renderer global after creation.
- A second `create` on the same SVG destroys the first rig, restores its original artwork, then takes ownership. The first rig can no longer modify the SVG.
- Keep the canonical figure, body, face and rear-arm hierarchy intact. The rig preserves existing DOM nodes, clip references and accessibility attributes. A temporary, privately marked right-eye path is present when eye channels are active.
- Place scene translation or scaling on a wrapper outside the SVG's figure. Do not independently mutate rig-owned path data or figure transforms while the rig is active.
- Use a unique renderer `idPrefix` for each inline SVG, as with the static kit.

## Full-state pose API

`rig.set(state)` accepts an object. Every omitted field becomes zero on every call; it is **not a patch**. For example, `set({mouth: .5})` after a wave opens the mouth and returns the arms to rest. `set({})` restores the exact initial artwork.

| Field       | Range             | Meaning                                                                |
| ----------- | ----------------- | ---------------------------------------------------------------------- |
| `stride`    | 0–1               | Gait amplitude; zero keeps the original body paths                     |
| `phase`     | Any finite number | Gait phase in radians; one cycle is `2 * Math.PI`                      |
| `wave`      | 0–1               | Right arm's blend from rest to raised wave                             |
| `wavePhase` | Any finite number | Wrist/elbow wave phase in radians; no effect when `wave` is zero       |
| `present`   | 0–1               | Both arms open outward; the raised wave takes precedence on the right  |
| `blink`     | 0–1               | Close both eyes to short, curved lids                                  |
| `wink`      | 0–1               | Close only the right eye, with a small matching brow lift              |
| `mouth`     | 0–1               | Blend the original smile into a small rounded, plum-filled opening     |
| `gazeX`     | −1–1              | Eye movement, up to 1.25 SVG units horizontally                        |
| `gazeY`     | −1–1              | Eye movement, up to 1 SVG unit vertically, with a slight brow response |
| `lean`      | −6–6              | Figure rotation in degrees around the canonical `(160, 270)` pivot     |
| `bob`       | −8–8              | Figure translation in SVG units along y; negative moves upward         |

Known numeric fields outside bounded ranges are clamped. Phases remain unrestricted finite radians. Unknown own keys (including symbols) throw `RangeError`. Non-numeric or non-finite values, arrays and non-object states throw `TypeError`. Explicit `undefined` is invalid; omit an unused field instead. Validation finishes before changing the SVG, so an invalid state leaves the previous pose intact.

For a given initial SVG and valid state, output is deterministic regardless of prior poses. Phase fields alone do not alter resting artwork. Both `blink` and `wink` can be supplied: right-eye closure is `1 - (1 - blink) * (1 - wink)`.

```js
// A sampled pose, not a playback command.
rig.set({
  stride: 0.8,
  phase: 1.6 * Math.PI,
  wave: 0.7,
  wavePhase: Math.PI / 2,
  mouth: 0.5,
  gazeX: 1,
  lean: -2,
  bob: -1,
});

rig.reset(); // Restore original nodes and exact original attributes.
rig.destroy(); // Restore again and release ownership.
```

`reset()` leaves the rig reusable. `destroy()` is idempotent; subsequent `set()` and `reset()` calls throw `Error`. Call `destroy()` before removing the scene. Neither method replaces the original face nodes or saves a modified pose as the baseline.

## Articulation

### Rigid rocking

For a firm, object-like arrival, leave `stride` at zero and animate `lean` with a small accompanying `bob`. The complete arch, face, and resting arms then move together around the canonical lower pivot; the four body paths remain unchanged. Keep travel short and reduce the tilt before settling. The [introduction score](../examples/first-hello/timeline.js) shares this movement between its arrival and isolated rocking gesture.

### Articulated steps

The two existing arch ends alternate half a cycle apart. Each cycle spends 60% in a supported backward sweep and 40% in a lifted forward return. At full stride, each end advances or retreats by at most 20 SVG units and lifts by at most 20. Reduce `stride` while starting and settling the scene rather than abruptly enabling full-amplitude steps.

Body, depth, highlight and inset all use the same spatial deformation. Their path data is read from the supplied SVG and converted to absolute segments; lower curves are subdivided before skinning. Deformation starts below y = 176, just beyond the shoulder caps, and eases into full movement by y = 256. The crown and shoulder positions are fixed in figure coordinates. There are no detached feet, lower connector or whole-head stretch. At zero stride, original path strings return exactly, without conversion or approximation.

The gait includes opposite arm swings. These diminish as a presentation or wave takes over. Horizontal scene travel is separate: the rig is not a ground-contact or inverse-kinematics solver. Coordinate the scene's travel and gait phase to avoid visibly sliding planted ends; prefer small steps and modest whole-figure motion.

### Arms and face

Rest arm curves come from the supplied SVG. Subdivided curves blend through elbow and wrist positions while the shoulders remain at `(103, 169)` and `(225, 169)`. The right wrist and elbow have slightly offset wave phases and a short finger gesture. Rear paint order and the existing exterior clips are retained, protecting body details and the empty opening.

Eye closure changes each eye's local curve and line weight, not the size of the face. Gaze stays within the crown. The mouth blends between a smile and a small closed contour filled with the face's existing plum color; it does not introduce teeth, tongue, accessories or separate assets.

## Scene lifecycle

The host scene owns elapsed time, scheduling and motion policy:

- Keep the sequence finite; settle at a readable static pose. Use `set({})` or `reset()` for the original neutral artwork, or hold a deliberate presentation pose without scheduling further frames.
- Do not advance elapsed time while paused, hidden or offscreen. Resume from the same elapsed time rather than jumping ahead by wall-clock time.
- Respect reduced motion at startup and when the preference changes. Show a static meaningful pose, with the same text and controls.
- Suspend decorative motion while a modal covers the scene. Preserve explicit user pause choices.
- Keep real operation state independent of the pose or sequence completion.

The rig cannot detect that the old controller is idle but still owns the SVG. Exclusive ownership is the embedding scene's responsibility. It also does not detect CSS clipping imposed by an external layout.

## Verification

No install, download or server is needed. From the repository root:

```sh
node --test design/brand/bend/performance.test.cjs
node --test design/brand/bend/bend.test.cjs
node design/brand/bend/generate.cjs --check

# Use an already-installed Playwright module and Chrome:
PLAYWRIGHT_MODULE=/path/to/existing/playwright \
  node design/brand/bend/performance.browser.test.cjs
```

`BEND_BROWSER_CHANNEL` optionally selects another installed Chromium channel; the default is `chrome`. `BEND_PERFORMANCE_SCREENSHOTS` optionally selects a proof output directory. Otherwise proofs are written to a temporary directory and its location is printed. Nothing is downloaded or written into the asset library.

The Node suite checks source isolation, API shape, validation, clamping, phase periodicity, full-state determinism, replacement ownership and exact restoration using a minimal DOM fixture. It does not model browser geometry or rasterization.

The browser suite checks sampled phase/gesture combinations at maximum stride and extreme figure offsets, plus intermediate expressions. It checks path bounds including stroke margins, face containment on the crown, root-cap coverage, the clear central opening, alternating support/flight and visible eye/mouth changes. Raster comparisons with rear arms removed check the protected highlight/inset, including the upper shoulder contours. Separate comparisons check crown stability. Lifecycle checks use real DOM identity and serialization. Network requests are blocked and reported as failures. Light and dark proof sheets include rest, both steps, a partial wave, raised wave, wink, blink and presentation.

These are sampled Chromium checks, not exhaustive continuous-state coverage or cross-browser certification. Lower-curve skinning is an approximation; antialiasing may differ when straight strokes become segmented curves. Exact DOM restoration is checked at zero state, reset and destroy, not pixel equality between a moving lower body and the static illustration. Inspect the proof sheets and the complete staged sequence: automated geometry checks do not measure warmth, timing or perceived ground contact.
