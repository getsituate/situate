# Technique selection

Use mechanisms in service of an intended movement. The categories below overlap: a Rive character can contain keyed bones, springs, and a state machine; a particle system can be driven by a gesture. References and evidence boundaries are listed in [Sources](sources.md).

## Selection matrix

| Technique                             | Choose it for                                                                | JavaScript implementation route                                                                               | Main constraint / simpler fallback                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Keyframes and tweens                  | Designed poses, repeatable transitions, precisely timed sequences            | `Element.animate()`; Motion `animate`; GSAP timeline                                                          | Fixed poses do not inherently adapt to changing input; CSS transition for simple state changes          |
| Springs                               | Responsive settling, snap-back, switches, direct-manipulation release        | Motion spring values or spring transitions; position, velocity, target, stiffness, damping, mass              | Overshoot can harm readability and target acquisition; use a well-damped response or immediate state    |
| Gesture-driven motion                 | Dragging, swiping, bounded tilt, scrubbing                                   | Pointer Events and pointer capture; map input into motion values; spring only after release where appropriate | Pointer cancellation, coordinate spaces, keyboard equivalent; buttons can perform the same action       |
| Physics simulation                    | Collision, gravity, momentum, constraints among several bodies               | Fixed-step simulation inside `requestAnimationFrame`; consider a physics engine when collisions warrant it    | Unbounded timesteps and too many bodies; use a deterministic keyed effect when simulation adds no value |
| SVG paths                             | Stroke reveal, paths through space, shape transformation                     | Dash offset; sampled `getPointAtLength()`; compatible `d` interpolation or a morphing library                 | Path topology, coordinate mapping, paint cost; crossfade distinct shapes when morphing is misleading    |
| Layout and shared-element transitions | Reordering, grid/list changes, expanding an object while preserving identity | FLIP, GSAP Flip, framework layout animation; View Transitions where supported                                 | Measurement, identity, scroll offsets, transformed ancestors, text distortion; immediate layout change  |
| Skeletal rigs                         | Articulated characters and many reusable poses                               | Rive-authored bones for 2D; loaded rig and `THREE.AnimationMixer` for 3D                                      | Requires a real rig, skin weights, pivots, and clips; grouped SVG parts for simple articulation         |
| Shaders                               | Procedural surfaces, distortion, lighting, rich pixel effects                | WebGL shader via Three.js `ShaderMaterial`; JavaScript updates uniforms                                       | GPU code is GLSL here, not JavaScript; fill rate, context loss, reduced-motion poster                   |
| Particles                             | Brief celebration, trails, impact, atmospheric detail                        | Canvas 2D pooled particles; WebGL buffers/instancing for larger justified workloads                           | Overdraw, allocations, perpetual emitters; a single restrained accent or static confirmation            |
| Flipbooks and video                   | Pre-rendered effects too costly or difficult to reproduce live               | Sprite atlas frame selection, Canvas `drawImage`, or HTML video playback                                      | Transfer/decode/memory/alpha/seeking limits; poster frame and visible controls                          |
| Rive and Lottie                       | Designer-authored vector motion with runtime playback                        | Rive `.riv` runtime and authored state machine/data binding; `lottie-web` JSON playback/segments              | Export features and runtime compatibility; static SVG plus ordinary HTML state                          |

## Keyframes: design the intermediate states

Use a tween when interpolation between two states is enough. Use explicit keyframes for anticipation, overshoot, contact, or a distinct settle. Shape the intervals as well as the poses: equal time spacing does not mean equal apparent speed.

A common useful composition is a primary translation with a smaller scale change that settles later. Put separate transform owners on nested wrappers when necessary. Do not make a long timeline responsible for whether an application action succeeds.

WAAPI uses milliseconds; Motion and GSAP duration options generally use seconds. Check the exact API rather than transferring numbers unchanged. See [MDN Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate) and [Motion animate](https://motion.dev/docs/animate).

## Springs: velocity is part of the state

For a damped spring:

`mass * acceleration = -stiffness * (position - target) - damping * velocity`

Increasing stiffness strengthens the restoring force; damping removes energy; mass changes the response. Their combined effect matters more than any one number. For this model, damping ratio is `damping / (2 * sqrt(stiffness * mass))`: below one is underdamped, one is critically damped, and above one is overdamped.

A spring should retarget from its current position and velocity rather than restart from a canned keyframe. Define rest thresholds for both displacement and speed. Prefer a maintained solver to an unbounded hand-written Euler loop for production interaction. See [Motion spring values](https://motion.dev/docs/spring-value).

During a drag, direct one-to-one tracking often feels more responsive than a spring chasing the pointer. Preserve release velocity where appropriate, then settle to the target. Do not apply bounce to every property just because the library supports it.

## Gestures: preserve control

On `pointerdown`, accept the intended button/pointer and capture its ID. Measure the relevant coordinate space. On `pointermove`, update a bounded target and coalesce rendering work. On `pointerup`, release or snap based on the defined rule. Handle `pointercancel` and `lostpointercapture` without accidentally committing an action.

Choose `touch-action` deliberately: for example, horizontal manipulation inside a vertically scrolling page may use `pan-y`. Do not indiscriminately disable touch scrolling across the page. Limit tilt to decorative inner artwork rather than moving the hit target itself. Recompute bounds after resize or scrolling; do not assume a cached rectangle lasts forever.

Provide non-drag controls and keyboard behavior that change the same semantic state. Gesture flair must not be the only route to an operation. See [Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events).

## Physics and particles: time, bounded work, finite lifetimes

Use `requestAnimationFrame(timestamp)` as the render clock. For simulation, accumulate elapsed seconds and run bounded fixed-size steps; cap catch-up iterations after stalls. Reset the clock when resuming after backgrounding. For deterministic scrubbing, derive state from progress instead of advancing an irreversible simulation.

A small ballistic particle can be evaluated analytically from its birth state:

`x(t) = x0 + vx * t`

`y(t) = y0 + vy * t + 0.5 * gravity * t * t`

This needs neither a collision engine nor frame-dependent incremental movement. Store birth time and lifetime, remove expired particles, cap emissions, reuse buffers when needed, and stop the loop when nothing remains. Use seeded random values for repeatable captures, not fresh random values on every frame. The acknowledgment of success must remain visible without the particles.

Render Canvas at a deliberately chosen pixel ratio; a device-pixel ratio of three means nine times as many backing pixels as one at the same CSS dimensions. Measure quality against cost. See [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

## SVG: three separate problems

1. **Draw:** animate `stroke-dashoffset` against a known path length. This reveals a stroke; it does not change geometry. Filled shapes may need a mask rather than a dash effect.
2. **Travel:** sample `getPointAtLength(progress * totalLength)` or use a motion-path API. For a DOM follower, transform SVG coordinates into the correct viewport/container coordinate system. Tangent samples can orient the follower.
3. **Morph:** interpolate matching path commands and control points, or normalize shapes with a dedicated morphing tool. Arbitrary `d` strings do not reliably tween into one another. Different holes, winding, subpaths, or point correspondence can produce collapsed or self-intersecting intermediate shapes.

Review the middle of a morph, not just its endpoints. If there is no meaningful correspondence, use a cut, mask, or crossfade instead. Motion's special `pathLength` drawing property is not an arbitrary-shape morphing engine. See [Motion animate: SVG paths](https://motion.dev/docs/animate) and [SVG d](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/d).

## Layout: preserve identity without fighting layout

FLIP means First, Last, Invert, Play:

1. Read initial geometry.
2. Apply the actual final layout.
3. Read final geometry and compute visual offsets.
4. Animate those offsets back to identity.

Batch the measurements. In a framework, the final measurement must follow the committed DOM update, not merely the state setter. Use stable item identities. Interruptions, reparenting, nested transforms, and scroll containers are reasons to use a mature implementation rather than extending a four-line demo indefinitely.

Scaling a box can distort its text, borders, and corners; isolate content or choose a measured alternative. Removing elements from flow for the animation can collapse their parent. GSAP Flip's `absolute` and `scale` options have tradeoffs, not universally better defaults. See [GSAP Flip](https://gsap.com/docs/v3/Plugins/Flip/).

## Rigs, authored assets, and runtime state

A rig is a hierarchy of joints and deformable artwork, not just a moving image. Design readable key poses and correct pivots first, then blend or transition between them. Three.js can play clips with `AnimationMixer.update(deltaSeconds)`; it does not invent the character, rig, or motion clips. Stop actions before uncaching the root; dispose exclusively owned graphics resources separately. See [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html).

Rive supports authored interactive behavior through state machines and data binding. Verify the actual file's artboard, state-machine name, exposed properties, and renderer requirements. Missing names must not silently fall back to unrelated playback. Initialize after loading, size the backing surface correctly, handle errors, and clean up the instance on teardown. See [Rive Web](https://rive.app/docs/runtimes/web/web-js).

Lottie is well suited to authored timeline playback and named or frame-based segments. Host application logic can choose segments; this is different from an authored Rive state machine. Test exporter/runtime feature support, external images and fonts, and the chosen SVG/Canvas renderer. Disable autoplay when appropriate, wait for readiness, and call `destroy()` on teardown. See [Lottie usage](https://github.com/airbnb/lottie-web/wiki/Usage).

Neither format is automatically small, fast, accessible, or free to redistribute. Keep meaningful status and interactive controls in HTML, with the animation as a visual companion.

## Shaders and pre-rendered imagery

A WebGL shader can deform vertices or determine pixel color; JavaScript supplies progress, time, pointer coordinates, resolution, and other uniforms. Prefer a normalized progress uniform for an effect that must reverse or scrub predictably. Do not compile a material on every frame. Resize deliberately, cap render resolution where justified, and handle context loss and disposal. `ShaderMaterial` refers to Three.js's WebGL/GLSL path, not a portable WebGPU/WGSL API. See [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html).

Pre-rendering trades runtime computation for assets and decoding. For a sprite sequence, calculate `frame = min(frameCount - 1, floor(progress * frameCount))`; source rectangles must match the atlas layout. Budget decoded memory, not just compressed download size. For video, handle rejected `play()` promises, readiness, posters, and controls. Repeated `currentTime` changes may seek imprecisely or stall; do not promise frame-perfect scroll scrubbing without testing the encoding and devices. See [HTMLMediaElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement).

## Composition recipes

These are concept sketches, not prescriptions to use every listed technique:

- **Tactile card:** direct pointer tracking → release spring → small inner-artwork follow-through. Keep the text and interactive target stable. Reduced motion uses direct state changes with no tilt.
- **Completion moment:** update the real result immediately → draw a confirmation stroke → one short particle burst → settle. Reduced motion shows the result and completed symbol without the burst. Do not celebrate speculative server success.
- **Expandable object:** preserve identity through FLIP → reveal detail with a short overlap → stop. Keep focus and reading order correct; closing reverses or retargets from the current state.
- **Expressive hero:** one designed SVG morph or character action → a restrained supporting surface effect → a still hold. Reduced motion uses a readable pose or labeled static sequence. Do not combine endless parallax, oscillation, video, and particles by default.
