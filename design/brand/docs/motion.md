# Motion

[Handbook](../README.md) · [Character kit](../bend/README.md) · [Motion implementation](../bend/motion.js)

Motion serves finite character gestures, restrained environmental movement in an expressive brand stage, and compact loading feedback. Bend can greet, consider, gather, celebrate, and point, then rest. Broad ribbons can drift slowly behind a welcome when that movement is easy to pause. Full-character and environmental loops do not belong in daily reading or editing; the miniature loading mark is limited to an actual pending operation.

## Choose the reason before the animation

| Context                               | Motion decision                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| First welcome                         | One brief greeting or a finite, skippable introduction; optional slow environmental ribbon drift with a prominent pause control |
| Returning to daily work               | Static character or no character                                                                                                |
| Hovering a control                    | Color or border feedback; do not wave in response to incidental pointer movement                                                |
| Reading or editing                    | No ambient scene or character animation                                                                                         |
| An operation is pending               | Optional Mini Bend eye frames beside a precise status label; static with reduced motion                                         |
| Ordinary task completion              | Checkbox and text state update; no mascot celebration                                                                           |
| Substantial, user-directed completion | One small celebration after the result exists                                                                                   |
| Asking for missing information        | Static unsure expression and a precise question                                                                                 |
| Error or consequential review         | No decorative gesture, except the finite unexpected-error recovery gesture                                                      |

The unexpected-error recovery dialog may show Bend lowering its gaze and settling once, within one second, then remaining still. The gesture never delays actions, repeats for the same incident, or appears beside validation, permission or data-loss explanations. Reduced motion and hidden-page transitions settle it immediately.

A motion control controls decoration, not the operation being illustrated. A person can pause or suppress motion and still finish the same work. A gesture must not be the only way to understand progress, completion, uncertainty, or a next step.

## Timing and shape

Use `cubic-bezier(.22,.7,.25,1)` for settling gestures: a clear start and a soft arrival without springy overshoot. UI feedback should be short, about 160 ms. A small object settling can take up to 700 ms. Individual scene entrances, when needed, should finish within roughly 2200 ms. A deliberately staged introduction may combine several distinct beats within the bounded sequence described below. Do not repeatedly chain scene entrances as a substitute for an infinite loop.

The Bend controller uses finite gestures with these durations:

| Gesture     | Typical pose / expression     | Duration | Character of movement                               |
| ----------- | ----------------------------- | -------: | --------------------------------------------------- |
| `hello`     | `wave` / `welcome`            |  1400 ms | Small figure tilt and a raised-arm wave             |
| `consider`  | `read` or `rest` / `thinking` |  1600 ms | A slight settled tilt and minimal face shift        |
| `gather`    | `carry` / `welcome`           |  1300 ms | A small shift with hands and props moving together  |
| `celebrate` | `celebrate` / `pleased`       |  1100 ms | A brief lift, then return to the grounded pose      |
| `point`     | `point` / `curious`           |  1000 ms | A small turn and a restrained pointing-arm movement |

The static pose and expression remain separate choices. Calling `play('hello')` does not turn a reading pose into a wave pose. Choose the pose first, then apply the gesture that fits it.

Keep whole-figure movement modest: a few viewBox units of translation and a few degrees of rotation. The kit's celebration lifts about 8 units in the `320 × 320` frame. Its wave can rotate the raised arm more than the body. These local movements are preferable to sliding the whole SVG across the screen, rubber-band stretching, or bouncing through several overshoots.

For held objects, transform the gripping hands and object coherently. Do not animate a hand away from a book to make a wave. Placement transforms belong outside the animated figure; the controller owns its motion transforms. See the [kit manual](../bend/README.md) for extension points rather than replacing inline transforms by guesswork.

## Finite character gestures

- A gesture runs once and returns to a readable static pose.
- Repeated explicit activation may replay it, but replace the active gesture instead of building a queue of waves.
- Do not schedule recurring gestures with `setInterval`, a repeating timeout, or an animation completion callback.
- Object entrances and result-settling movements also finish once. Environmental ribbon drift is a separate, bounded brand-stage treatment described below.
- Do not replay Bend's greeting merely because someone scrolls the same scene into view again.
- Keep the user in control: no motion-triggered focus movement, navigation, or mandatory delay before an action becomes available.

## Expressive first welcomes

A dedicated first-welcome scene can give Bend more personality than a small contextual gesture. The [ten-second introduction](../examples/first-hello/index.html) combines a short, rigid-body rocking arrival, an anticipatory arm raise, a wave with wrist follow-through, small mouth movements, one wink, and an open-arm presentation. It finishes in a complete, static composition. This is not permission for an idle character to keep moving during daily work, or a commitment to show an introduction on every application launch.

Use the [performance rig](../bend/PERFORMANCE.md) for these articulated movements. It derives moving paths from a canonical `rest` / `welcome` SVG rather than substituting another drawing:

- **Face:** blink individual eyes, move the gaze within the crown, and open the plum-colored mouth modestly. A few purposeful accents convey more than continuous lip flapping. Silent mouth acting is not voice playback or lip synchronization.
- **Arms:** keep shoulder origins behind the body. Lead with the arm and let the wrist follow, rather than rotating the entire illustration for every gesture. Return to a readable held pose.
- **Arrival:** the introduction keeps the arch firm and rocks the whole figure with `lean` and a small tilt-linked `bob`, leaving `stride` at zero. Short scene travel accompanies three diminishing weight shifts; there is no independent leg bending or shadow pulse. If using the rig's optional articulated stride elsewhere, keep depth, highlight, and inset coherent. Do not add separate feet, stretch the crown, or close the opening. Neither approach is a ground-contact solver.
- **Staging:** let the greeting own the close view, then open the composition for the objects and product name. Keep required text steady for reading and retain the complete message in the final frame and transcript.

The scene, not the rig, owns a single elapsed-time clock. Pause, seek, skip, live reduced motion, offscreen suspension, and teardown must govern the whole composition together. Do not attach the older gesture controller and the performance rig to the same SVG. A ten-second welcome is a finite film, not ten seconds of mandatory waiting: provide an immediate skip/still alternative, and never gate application state on completion. The [storyboard and playback contract](../examples/first-hello/README.md) show a complete example.

## Compact loading feedback

[Mini Bend](../bend/mini/README.md) has a separate stepped score for small SVG and ASCII marks. The 2400 ms cycle holds rest for 900 ms, a slight downward eye change for 600 ms, a blink for 120 ms, then rest for 780 ms. The arch never moves or changes opacity. There is no easing between frames, whole-body bounce, spin, wave, or mouth acting.

This is an indeterminate activity cue, not a percentage, an estimate, an AI thinking state, or a completion signal:

- Start only when the corresponding operation is pending. Do not use it as a standing idle animation, on hover, or beside every row in a busy list. Prefer one cue for the affected region.
- End immediately on success, failure, cancellation, or removal. Do not lengthen an operation to display a complete cycle. Fast work may finish before the eyes change.
- Keep a stable, descriptive label beside it. Hide decorative SVG and ASCII punctuation from assistive technology; announce meaningful status changes, not every frame.
- Pause the eye frames with the containing surface's motion control. Reduced motion shows the resting mark. Neither setting pauses or cancels the actual operation.
- Suspend frame timers while hidden, offscreen, or covered by a modal. Do not replay elapsed background frames on return. The controller handles visibility and reduced motion; the embedding surface handles modal and page teardown policy.

In the chat composer, Mini Bend uses gentle continuous eye movement between its existing gestures while a response is processing or streaming. Long motionless holds would make ongoing work indistinguishable from a stalled response. This exception applies only below the chat input, not to global artwork, tabs, or lists. Preserve the resting geometry, explicit pause, reduced-motion stillness, and visibility suspension. Updated comments may use a short typing-like reveal with a stable line box and complete accessible announcements; reduced motion displays the complete text directly.

The [reference example](../reference/index.html#mini-bend) uses a separate four-second simulation timer and explicit complete, error, and cancel controls. Real integrations must derive busy state and text from the operation, not from that demonstration delay.

## Environmental ribbon movement

A visible welcome or brand stage may keep a small amount of slow movement after Bend has settled. This is not a daily-work behavior and does not authorize a repeating wave, bobbing character, or orbiting task list.

- Use a 12–15 second `ease-in-out` cycle on broad background ribbons. A suitable full-size scene range is about -12 to +14 illustration units horizontally, +6 to -9 vertically, and -2 to +2 degrees. Reduce or omit movement when a crop makes it distracting.
- Move at most two or three background layers slowly, with differing phases. Keep Bend, labels, controls, and the main focal objects steady unless a person deliberately triggers a finite gesture.
- Keep the stage visually bounded. Stop at the border; no ribbons drift across unrelated content or behind editable text.
- Provide a prominent “Pause motion” control while the stage is visible. It must pause environmental layers as well as an active gesture, and expose the current state. A user pause remains in effect when the scene leaves and re-enters view.
- Suspend environmental animation while the document is hidden, the stage is offscreen, or a modal covers it. Do not spend background attention or processing on unseen decoration.
- With reduced motion, show the static scene. Do not replace a broad slow loop with a small fast one.

Static composition remains a complete alternative when motion is unavailable or paused. A page containing only quiet daily work does not need an ambient-motion toggle because it should not start environmental loops.

## Reduced motion and lifecycle

Respect `prefers-reduced-motion: reduce` at initial render and when it changes. Associate a device-preference or unavailable-motion explanation with a control only while that explanation is true. When motion becomes available, remove the conditional `aria-describedby` reference as well as hiding its message; otherwise assistive technology can still announce that motion is off. Show the static meaningful pose and the same text/result. Do not replace a large movement with a smaller endless one. Avoid smooth scrolling in reduced-motion mode.

The basic `motion.js` controller handles reduced motion, document visibility, and offscreen suspension for the character. The separate `mini/mini.js` controller handles these for a busy miniature mark. The `performance.js` rig has no clock or lifecycle policy; its embedding scene must provide these behaviors, as the introduction example does. The embedding page is still responsible for its own CSS transitions, separate objects, overlays, and scroll behavior. Pause decorative scene motion while a dialog covers it, and destroy controllers when their SVG nodes are removed. A character removed from the DOM must not leave animation work or event listeners behind.

Provide a prominent labeled motion control whenever environmental loops are used, and where a page contains several decorative demonstrations or an entrance that may still be in progress. State its current effect: “Pause motion” and “Resume motion,” with appropriate pressed state when implemented as a toggle. An OS preference takes precedence over the page's resume action. Do not make someone find a settings screen to stop distracting decoration.

## Separate operation state from animation state

Update operation state from the actual operation, not from `animation.finished`. In a demonstration, the mock state transition belongs to the simulation code. In a product, it belongs to the result of the operation. Neither should wait for Bend to finish waving.

Similarly, a paused or unsupported animation does not mean the work failed. A stopped gesture does not cancel an external action. Never describe the motion controller as an AI lifecycle controller or a safety mechanism.

## Motion review

1. Activate the gesture several times quickly. There should be no growing queue or accumulated transforms.
2. Pause mid-gesture, resume, then stop. The resting figure should remain intact.
3. Change the OS motion setting while a gesture is active. The result and all controls must remain available.
4. Move the scene offscreen and switch browser tabs. Character and environmental motion must suspend. On return, a user-paused scene must stay paused.
5. Open and close a dialog. Resume only what the person has not paused or suppressed.
6. Remove the scene and call `destroy()`. Check for errors and unwanted listeners or ongoing animation work.
7. Disable JavaScript or the animation API. Static artwork and the page's explanation should remain understandable.

These are review steps, not a claim that every browser or embedding has passed them. Use the [validation guide](../validation/README.md) for executable checks and recorded verification scope.
