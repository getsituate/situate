---
name: javascript-animation
description: Design, implement, or critique expressive web and app animations with JavaScript. Use for motion concepts, keyframes, springs, gestures, physics, SVG morphing, layout transitions, character rigs, shaders, particles, sprite/video playback, Rive, Lottie, and coordinated animation sequences. Covers art direction, implementation choices, interruption, accessibility, and performance.
---

# JavaScript animation

Create motion with a clear intention, coherent visual character, and reliable interaction behavior. Choose the movement before the library. A technically smooth animation can still have poor staging, weight, or rhythm.

## Load the relevant guidance

- Read [Technique selection](references/techniques.md) when choosing mechanisms or combining them.
- Read [JavaScript recipes](references/javascript-recipes.md) before implementation. Examples are small patterns, not complete component architectures.
- Read [Sources](references/sources.md) when checking provenance or locating primary API documentation. Check the installed library version before using an API.
- Use `scrollytelling` for scroll-driven narrative structure. This skill handles the motion within a scene, not the editorial structure of an entire page.
- For Situate-branded work, start with repository-relative `design/brand/README.md` and applicable motion guidance. Brand constraints take precedence over generic example values.

## 1. Establish the motion brief

Inspect the existing interface, framework, animation dependencies, assets, target devices, and approved visual language. Ask only about unknowns that change the design.

Identify:

- **Purpose:** feedback, orientation, explanation, direct manipulation, expression, or celebration.
- **Subject:** what should receive attention, and what should remain quiet?
- **Character:** choose two or three concrete qualities, such as precise/light, elastic/playful, or weighted/calm. Translate these into acceleration, travel, deformation, and settling behavior.
- **Frequency:** a rare milestone can carry more expression than an action repeated dozens of times.
- **Constraints:** semantic content, keyboard behavior, touch input, motion preference, loading, asset rights, and runtime budget.

Use a static state as the baseline. Motion may add delight without explaining a task, but it must not obstruct that task. Never invent product capabilities to make a sequence more impressive.

## 2. Explore distinct movement ideas

For an open creative brief, propose two or three genuinely different concepts, not the same fade with different durations. For example: a continuous object transformation, a crisp mechanical assembly, and an elastic response to touch. For a narrowly specified fix, do not manufacture alternatives.

Describe each concept in terms of subject, trigger, silhouette, motion path, rhythm, and ending. Compare fit, legibility, asset effort, and runtime cost. Select one direction before implementing the whole scene.

Use these principles deliberately:

| Principle                  | Practical application                                                                | Avoid                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Staging                    | One dominant action per beat; use stillness and contrast to direct attention         | Every element moving with equal intensity                                               |
| Timing and spacing         | Tune both duration and how distance changes over time                                | Assuming a longer duration always feels smoother                                        |
| Anticipation               | Brief preparation before a major illustrative action                                 | Delaying ordinary button feedback or work execution                                     |
| Slow in/out                | Shape acceleration and deceleration to suggest weight and intent                     | One easing curve for every action; banning linear motion even for constant-speed travel |
| Follow-through and overlap | Secondary parts settle slightly after the primary body                               | Arbitrary stagger unrelated to structure                                                |
| Squash and stretch         | Deform an illustrative body subtly while retaining recognizable volume               | Distorting text, controls, or a mark whose geometry must remain fixed                   |
| Arcs                       | Let organic subjects follow curved paths; use straight motion for precise mechanisms | Curves added without spatial motivation                                                 |
| Secondary action           | Add one supportive detail, such as a shadow settling after contact                   | Competing focal points and perpetual decorative loops                                   |
| Exaggeration               | Amplify the one property that carries the idea                                       | Maximizing bounce, blur, scale, and particles together                                  |
| Continuity and appeal      | Preserve identity and recognizable poses across the change                           | Hiding poor intermediate shapes behind speed or effects                                 |

These are design heuristics, not a requirement to apply every traditional animation principle to every interface. See the UI-principles source in [Sources](references/sources.md).

## 3. Specify the choreography

Make a compact motion score before implementation:

| Beat | Trigger and semantic state | Primary subject and properties | Timing / spring / progress mapping | Secondary action | Interruption / reverse | Reduced-motion equivalent |
| ---- | -------------------------- | ------------------------------ | ---------------------------------- | ---------------- | ---------------------- | ------------------------- |

Record start, transition, settle, and final states. Mark whether each beat is controlled by time, gesture, scroll progress, simulation, or an authored state machine. Keep business state separate from playback state.

For each property, establish one owner. For example, an outer wrapper owns layout movement, an inner layer owns press scale, and an SVG path owns shape change. Two independent engines must not overwrite the same transform.

Suggested tuning starting points, not universal standards:

- Immediate input feedback: roughly 80–160 ms.
- Local state transition: roughly 160–320 ms.
- Larger explanatory or expressive beat: roughly 350–700 ms, with a readable hold where needed.
- Stagger: roughly 20–60 ms between a small number of related items; cap the total delay for larger lists.

Springs settle according to their parameters and thresholds; do not promise an exact duration for a physics-based spring. Keep application response immediate even when an illustration continues settling.

## 4. Choose the smallest suitable mechanism

Use CSS transitions for simple declarative state changes; JavaScript can toggle the state. Use the Web Animations API for explicit keyframes and playback control. Prefer an existing Motion or GSAP installation over adding a competing engine. Add Canvas, WebGL, Rive, or Lottie only when the required visual or authoring workflow warrants it.

Read the technique matrix before escalating. Distinguish:

- A spring returning one value to a target from a collision simulation.
- Drawing a path, moving along it, and morphing its geometry.
- A runtime that plays artwork from the editor or rig needed to author that artwork.
- A deterministic timeline from interaction-driven state transitions.

Check dependency, plugin, font, and asset licenses separately. Public examples and marketplace assets are not automatically redistributable. Do not install packages or download illustrative assets merely to demonstrate the range of available tools.

## 5. Implement for interruption and lifecycle

Build one representative beat first, including its reduced-motion treatment. Review it rendered before expanding the sequence.

- Keep semantic state authoritative. Successful operations, focus changes, and navigation must not depend on an animation reaching its last frame.
- Define the interruption policy: reverse, retarget from the current value/velocity, finish immediately, or replace. Avoid blind cancellation followed by a restart from the original keyframe.
- Let one render loop own a simulation. Use elapsed time, not a fixed increment per frame. Bound catch-up work after backgrounding.
- Handle repeated activation, rapid reversal, `pointercancel`, resize, unmount, and failed media loads.
- Cancel owned animations and animation frames; remove listeners; disconnect observers; dispose renderer resources. Do not cancel animations belonging to other components.
- Avoid unhandled rejections from cancelled WAAPI `finished` promises. Avoid accumulating filled animations as permanent component state.
- For React or similar frameworks, bind setup and cleanup to component lifecycle, measure after the relevant DOM commit, and test repeated setup/cleanup. Do not create animation instances during render.

## 6. Make access and performance part of the design

Respect `prefers-reduced-motion` at initialization and when it changes. Replace nonessential travel, zoom, oscillation, parallax, and particles with a clear static state; do not merely speed them up or freeze mid-transition. A short opacity change is an option, not a universally safe substitute.

Keep controls and important information in semantic HTML. Decorative Canvas/SVG layers must not steal pointer events or accessibility focus. Provide keyboard alternatives to drag interactions. Do not announce every animation frame to assistive technology.

Provide pause/stop/hide controls where required for automatically starting movement lasting more than five seconds alongside other content. Avoid flashing effects; a reduced-motion switch is not a substitute for flash safety. WCAG 2.3.3 addresses interaction animation at Level AAA; it does not alone establish accessibility conformance.

Prefer transform and opacity for DOM motion, but measure rather than assuming compositor execution. Batch layout reads and writes. Reserve dimensions for media. Use `will-change` only when profiling justifies it, and remove it when no longer needed. SVG path changes, large blurs, masks, particle counts, texture sizes, and high device-pixel ratios all deserve explicit profiling.

Set budgets for the actual device and scene. A 60 Hz display has about 16.7 ms per frame and 120 Hz about 8.3 ms for all work, not just animation code. Stop decorative work offscreen and when the document is hidden. A GPU effect can still be slow or battery-intensive.

## 7. Review the actual motion

Use a browser preview and a recording when available. Watch once at normal speed for feel, then inspect slow playback for collisions, shape discontinuities, clipped overshoot, and poor poses. A screenshot cannot verify timing or interruption.

Check:

- Is the intended focal point obvious? Does the action read without explanatory copy?
- Are acceleration, weight, deformation, and settling consistent with the chosen character?
- Does one expressive detail contribute more than several generic effects?
- Do rapid repeats, reverse input, and mid-flight changes preserve continuity?
- Is the final state exact and usable without waiting for decorative motion?
- Does reduced motion work both on initial load and when enabled during playback?
- Do keyboard, touch, narrow screens, zoom, and content changes work?
- Do failed assets, unsupported APIs, background/resume, and teardown leave a usable state?
- Do representative-device traces show acceptable frame time, paint, memory, and loading cost?

Do not label motion polished, accessible, or performant solely from code inspection. Report what was rendered and measured, and what remains untested. Refine the highest-impact problem before adding another effect.

Deliver the requested artifact: concept, motion score, scoped implementation, or critique. Include the relevant source links and verification limits in the handoff, not in the interface itself.
