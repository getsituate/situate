# Playful Mini Bend

An exploratory workshop-only waiting mark. Its rigid-body gestures depart from the canonical Mini Bend's stationary arch; they are not a replacement brand motion specification.

```vue
<MiniBendPlayful :busy="working" :paused="motionPaused" variant="mixed" />
```

Import `MiniBendPlayful.vue` from this directory. `busy` is required. `paused` defaults to `false`; `variant` defaults to `mixed`; the ten selectable scene IDs and labels are exported as `gestures` from `gestures.ts`. There are no emitted events or operation callbacks.

- **Peek:** disappear below the stage, peek around a side, withdraw, then return.
- **Lap:** walk out of one side and reappear from the opposite side.
- **Overshoot:** leave, slide back a little too far, pause, then correct with two small steps.
- **Sides:** peek from each side in turn before returning through the bottom centre.

- **Wave:** lean away while one end of the arch lifts and waves twice.
- **Tiptoe:** take three cautious, alternating steps.
- **Stretch:** spread both ends, lift the crown, then settle.
- **Hop:** gather into a small crouch, hop, then absorb the landing.
- **Dance:** take a playful two-step with alternating ends.
- **Bow:** bring the ends inward and hold a modest bow before straightening.

The crown and two independently bending ends meet in a continuous resting arch. Cubic curves maintain a fixed root and vertical tangent rather than rotating a straight segment at a hinge. A smooth interpolation slows into and out of each held bend. Scene time comes from the body animation; a frame callback updates only the two paths during larger gestures and stops during eye-only rests. Scenes use separate body, left-end, right-end and eye channels. They last roughly 3–4 seconds. Mixed mode uses three different ten-scene orders without adjacent repeats; direction, limb amplitude and pacing vary on subsequent passes. This is a reproducible repertoire, not unlimited random choreography. The 5.2–8.8-second intervals between scenes contain small eye movements and occasional single or double blinks, with the body resting. The first scene waits 1.8 seconds. Timing is independent of progress, elapsed operation time and outcomes. The fixed clipped stage allows whole-body movement without changing the label's position. Repositioning between edges occurs only while fully outside the stage.

The SVG inherits `currentColor`. Its fixed square defaults to 32 CSS pixels; set `--mini-bend-playful-size` to choose a size clamped to 28–36 pixels. The padded viewBox leaves room for movement without moving surrounding text. The resting outline and eyes derive from [canonical Mini Bend](../../../../design/brand/bend/mini/README.md), copied locally rather than imported. Splitting the arch into flexible ends and adding body choreography are exploratory departures from the canonical mark. Existing [provenance and licensing terms](../../../../design/brand/docs/provenance.md) apply; no additional license is granted.

## Embedding

The parent owns descriptive status text, meaningful announcements, busy state, errors and outcomes. This SVG is decorative and never announces frames, receives focus, or supplies a completion signal. Keep its label stable during gestures. A motion pause control should set `paused`; it must not pause the associated operation. Set `paused` while a modal or other surface covers the mark. Intersection observation does not detect occlusion or an ancestor's `visibility: hidden` or opacity.

Busy ending, explicit pause, reduced motion, document hiding and offscreen suspension cancel body, limb and idle-eye animation and scheduling, restoring the resting mark. Resuming starts a fresh initial rest rather than catching up. Reduced motion is respected at mount and on live changes, and takes precedence over the pause control. Changing the variant restarts the initial rest. Unmount removes observers, listeners and scheduled work. Without intersection observation, media-query support or Web Animations, the mark stays static.

## Checks

From `client/`:

```sh
npm run test --workspace @situate/workshop -- src/mini-bend-playful
npm run build:design
```

Unit tests cover geometry, decorative semantics, gesture sequencing, timer bounds, interruption, persistent pause, live reduced motion, visibility, offscreen state, missing APIs and teardown. Browser rendering should additionally check all ten scenes at actual size, pause/resume, preference changes and clipping. Unit mocks do not validate interpolation or SVG rendering. Integration in chat, status announcements and the parent's pause control require separate checks.
