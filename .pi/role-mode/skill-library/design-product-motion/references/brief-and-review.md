# Motion brief and review worksheet

Use the relevant sections for the size of the motion task. Keep exploratory notes beside the workshop study; do not turn this worksheet into fictional product copy.

## Brief

- **Audience and moment:** who sees the motion, when, and how often?
- **Purpose:** what changes in understanding or feeling? What is the next user action?
- **Surface:** containing viewport, host constraints, supported sizes and safe-area assumptions.
- **Scope:** decorative welcome, transition, confirmed achievement or real pending state; what the animation must not imply.
- **Visual vocabulary:** canonical assets and fixed identities; authorized new illustrations; layer order, text zones and character clearance.
- **Playback:** duration, Skip, pause, replay, reduced-motion still and navigation policy.
- **Destination:** exact next scene, shared elements and their terminal positions; behavior on interruption.
- **Resources:** existing dependencies, approved references, asset rights and any unresolved cost approvals.
- **Review question:** the most important assumption to evaluate, separate from technical correctness.

## Score

| Time range     | Act and focal subject               | Incoming state         | Action and copy                         | Outgoing state / handoff |
| -------------- | ----------------------------------- | ---------------------- | --------------------------------------- | ------------------------ |
| Opening        | Establish attention                 | Initial composition    | One readable gesture                    | Stable subject           |
| Development    | Reveal the relationship             | Previous act's end     | Staged action, not simultaneous clutter | Clear visual idea        |
| Resolution     | Complete that idea                  | Intentional transition | Settle and reveal final copy            | Complete still           |
| Hold / handoff | Make the next action understandable | Settled frame          | Readable hold, then exit if appropriate | Actual destination       |

Replace these descriptions with concrete scene states and authored times. Not every sequence needs four acts. A short confirmation gesture should not become a welcome film. No fixed duration is evidence of sufficient reading time.

## Review matrix

| Layer          | Checks                                                                                                                                                                              | Evidence                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Score          | Same time and viewport produce the same frame, including backward seek; invalid times clamp; act boundaries are continuous where intended; closing hold is still                    | Unit tests of pure frame data                                     |
| Geometry       | Background covers the intended surface; faces, text and controls remain clear; decorative cropping is intentional; terminal shared elements align with the destination              | Bounds checks and rendered frames before/at/after transitions     |
| Lifecycle      | Pause freezes all layers; hidden/offscreen/modal suspension stops time; resume does not jump; completion occurs once; inspection does not navigate; reset/unmount dispose resources | Component tests plus real playback                                |
| Accessibility  | Keyboard pause/skip; focus visibility and recovery; stable labels; contrast over every ground; live reduced motion; text equivalent; no flashing or frame-by-frame announcements    | Rendered interaction checks; name untested assistive technologies |
| Composition    | Wide and narrow layouts preserve hierarchy and meaning; no accidental horizontal overflow; safe-area assumptions are explicit                                                       | Desktop and portrait captures, including a constrained size       |
| Motion quality | Deliberate anticipation and settling; readable pacing; no popping, stalled masks or unintended idle loops; convincing closing hold                                                  | Complete uninterrupted playback, not screenshots alone            |
| Integration    | Actual next screen appears once; controls follow the visible scene; no duplicate greeting, sudden background change or shared-element jump                                          | End-to-end walkthrough across completion and Skip                 |

A useful starting browser matrix is Chromium and WebKit at 1280×900, 1440×900, 390×844 and 320×568. Adjust to the actual target surface. These dimensions are not device emulation or native accessibility verification.

Capture the first frame, each focal beat, transition boundaries, settled still, last frame and first destination frame. Wait for fonts and assets before deterministic captures. Label captures with scenario, viewport, engine and time so comparisons use equivalent moments.

For frame-time measurements, state browser, viewport and test conditions. Do not equate a good average frame rate with good pacing, or one desktop run with mobile-device performance.

## Diagnose before embellishing

| Symptom                                                | Inspect first                                                  | Typical correction                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Fullscreen still looks like a card                     | Host padding, max-width, border radius and background coverage | Fix the containing surface before scaling the artwork                      |
| The film feels busy                                    | Competing focal actions and moving text                        | Stagger meaningful actions and protect reading areas                       |
| Bend feels like a sticker                              | Whole-figure motion replacing gaze, pose and gesture           | Use the canonical articulated rig with a clear intention                   |
| An object jumps when scrubbing backward                | Incremental transforms or stale visibility state               | Derive the complete layer state from time                                  |
| Portrait crops the important content                   | Landscape coordinates and blanket scaling                      | Recompose text, character and object clusters for the available shape      |
| The ending feels cut off                               | Last gesture, hold duration and unmount boundary               | Resolve and hold before the host transition                                |
| The next screen feels disconnected                     | Ground color, wordmark position, repeated art and focus        | Review the real destination and author the seam explicitly                 |
| Controls disappear at the close                        | Ancestor opacity, masks and decorative stacking                | Keep controls outside animated art layers                                  |
| Pause stops only part of the scene                     | Independent CSS animations or clocks                           | Coordinate all decorative layers under one playback policy                 |
| Reduced motion technically works but loses the message | Immediate unmount of a supposedly readable still               | Put essential meaning in the destination or retain a user-controlled still |

## Method references

These are references for construction and review, not dependencies or evidence of usability. Verify current licensing before copying any material.

- [Howseen: Claude motion design](https://github.com/howseen-ai/claude-motion-design): explicit brief, timed states, key-frame probes, deterministic seeking and boundary checks. Its HTML/video-rendering workflow is not the Vue workshop architecture. The repository identifies MIT code and separately licensed third-party media.
- [Gemini motion-graphics study](https://github.com/brandonvant/gemini-motion-graphics): inspect `STORYBOARD.md` and `CONTINUITY.md` for named acts, incoming/outgoing states and held lockups. Treat it as a structural reference, not a license to copy its code, assets, branding or flash effects; no repository license was identified in the source review.
- [Cutiz: practical motion-design workflow](https://cutiz.app/en/blog/claude-motion-graphics): separate story, design, motion and delivery reviews. This is commercial editorial guidance, not a controlled comparison of tools or models.

The [local welcome studies](../../../../../client/workshop/src/onboarding/welcome-variants/) illustrate a Vue implementation of these ideas. Inspect their `design-notes.md`, `timeline.ts` and component tests rather than assuming every implementation detail is reusable. Use the [workshop browser test setup](../../../../../docs/development/design-workshop.md#verification) to exercise the host transition and frame inspector. The [canonical motion handbook](../../../../../design/brand/docs/motion.md) remains the authority for Situate's motion character and lifecycle constraints.
