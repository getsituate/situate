# A first hello

[Open the introduction](index.html) · [Brand handbook](../../README.md) · [Performance rig](../../bend/PERFORMANCE.md)

A ten-second, silent first-welcome study for Situate. Bend arrives with a small, rigid-body sway, greets the viewer, gives one wink, and presents tasks, notes, and documents. The final composition remains still around the original Situate wordmark.

This is an animation example, not a shipped onboarding flow or a requirement to show an introduction on every launch. It contains no account setup, AI, service connection, storage, voice track, or application navigation. Mouth movement is silent character acting, not recorded speech or phoneme synchronization. The intended audience is one person discovering a personal place for organization, not a team or a developer console. The scope follows [GOAL-0001](../../../../requirements/data/goals/GOAL-0001-connected-organization.md) and [GOAL-0005](../../../../requirements/data/goals/GOAL-0005-personal-connection.md); the animation does not establish those goals' outcomes.

## Storyboard

One continuous composition opens from a close greeting into a wider illustrated world. The framing changes uniformly around Bend; the character is not stretched to simulate a camera move.

| Time         | Action and focus                                                                                                                            | Visible text                                      | Arrival and hold                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0.00–1.90 s  | Bend rocks from side to side as one firm arch, then settles its weight. Three diminishing tilts accompany a short move toward the center.   | “Hi, I’m Bend.”                                   | Text is fully visible from 0.48 s. The movement leads toward the center, rather than moving several unrelated objects at once.       |
| 1.90–3.85 s  | The hand rises before the wrist waves. Three small mouth openings accompany the greeting; one right-eye wink follows.                       | “Hi, I’m Bend.”                                   | Mouth accents center on 2.16, 2.49 and 2.89 s; the wink centers on 3.42 s. The greeting remains fully visible until 3.55 s.          |
| 3.85–6.85 s  | Bend glances toward the new material and opens its arms. Plum rises into the field; ribbons and three objects arrive as the view opens out. | “Tasks. Notes. Documents.”                        | The heading is fully visible from 4.95–6.48 s. Object arrivals finish by 5.98 s, and their labels remain in the ending.              |
| 6.85–10.00 s | The original wordmark appears. Bend relaxes its arms and gives one natural blink, then rests.                                               | “Situate. Your personal organization, connected.” | The ending is fully visible from 7.35 s. All visible motion has settled by 9.20 s; the complete ending remains after playback stops. |

These times are authored choices, not tested reading-speed or preference findings. Small-screen layouts recompose the three objects above Bend instead of cropping the desktop arrangement. Stage height responds to viewport height so pause and skip remain visible on the tested short screens; compact layouts also reduce the objects and ending typography. The closest character framing is reduced below 360 CSS px to protect the waving hand.

## Playback and still access

- The introduction plays once on opening when motion is permitted and the stage is visible. There is no loop or recurring idle blink.
- **Pause / Resume** preserves the current frame. **Restart** preserves an explicit pause choice. After completion, **Replay introduction** is an explicit request to play again.
- **Skip to end** immediately shows the complete final composition. It does not navigate or perform an application action.
- Scrubbing pauses playback at the selected frame; resume is explicit.
- Hidden documents and offscreen stages suspend the clock rather than accumulating elapsed wall time. Returning to view does not override a user pause.
- Reduced motion shows the ending from the start. A live preference change stops playback and shows that same ending. Clearing the preference does not automatically replay it.
- **Read the introduction** exposes the complete text and an account of the visual action without requiring timed reading. The changing artwork does not generate per-frame live-region announcements.
- The gesture study below the film plays each selection once. It has its own still control. Starting a gesture pauses the introduction.
- Page teardown cancels both animation-frame schedules, removes listeners/observers, and restores both rigs. Cached-page restoration restores the introduction's position and pause choice; the isolated gesture returns to rest.

Without JavaScript, the full ending, transcript, and static character remain readable. Missing runtime scripts leave the still introduction available rather than claiming that playback is running.

## Source and construction

| File                                                     | Role                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`timeline.js`](timeline.js)                             | Pure, deterministic ten-second score and five finite gesture samples; also loadable with CommonJS |
| [`intro.js`](intro.js)                                   | Two bounded clocks, scene composition, controls, visibility/reduced-motion handling, and teardown |
| [`intro.css`](intro.css)                                 | Responsive staging and controls using the shared tokens                                           |
| [`index.html`](index.html)                               | Static ending, local assets, accessible text, controls, and gesture study                         |
| [`../../bend/performance.js`](../../bend/performance.js) | Reusable articulated body, facial, and arm channels; no clock of its own                          |
| [`../../bend/bend.js`](../../bend/bend.js)               | Unchanged canonical character renderer                                                            |

The character is rendered as `rest` / `welcome`, with a unique ID prefix per instance. Arrival uses the rig's whole-figure `lean` and `bob` channels with `stride: 0`: the body, depth, highlight, and inset retain their original paths. Three alternating tilts diminish from about 4.4 degrees to 1.9 degrees; a small lift follows the tilt instead of adding an independent bounce. Horizontal travel is 60 CSS px on desktop and 32 CSS px on narrow screens. The shadow stays steady. The isolated **Rock side to side** gesture uses the same score, without scene travel; its programmatic key is `walk`.

There is no independent copy of the crown, feet, highlight, inset, or static expressions in this scene. Facial and arm acting use the shared rig. The older gesture controller is not attached to either instance.

New scene code and choreography are original project work. The wordmarks, ribbon layer, book, page, and card come from the [existing artwork](../../docs/provenance.md); no third-party assets or font files are added. Shared [tokens](../../tokens.json) remain unchanged. The example's code uses MIT and its original artwork uses CC BY 4.0; see [Licensing and reuse](../../../../LICENSING.md) for attribution and the separate trademark policy.

The staging uses one dominant action at a time, anticipation before the wave, wrist follow-through, and a held ending. The [UI Skills animation guidance](https://www.ui-skills.com/skills/raphaelsalaja/12-principles-of-animation) was consulted for staging and restrained deformation, not copied as code. Interface-duration limits in that guidance do not define the duration of a character film.

## Optional video export

The browser page remains the interactive source. A local MP4 can be rendered from the same score with existing Playwright, Chrome, and ffmpeg installations:

```sh
PLAYWRIGHT_MODULE=/path/to/existing/playwright \
  node design/brand/examples/first-hello/render.cjs /path/to/new-introduction.mp4
```

The exporter samples 300 frames at 30 fps for a ten-second, 1200 × 640 silent movie. It captures the scene only, without player controls. It refuses an existing output file and removes temporary encoding files. `FFMPEG_BINARY` can select an existing ffmpeg executable. No tool is installed or downloaded. Keep generated previews outside the source tree; rasterized system-font appearance depends on the rendering machine.

## Checks

From the repository root, using existing Node.js, Playwright, and Chrome installations:

```sh
node --test design/brand/examples/first-hello/timeline.test.cjs
node --test design/brand/bend/performance.test.cjs
PLAYWRIGHT_MODULE=/path/to/existing/playwright \
  node design/brand/bend/performance.browser.test.cjs
PLAYWRIGHT_MODULE=/path/to/existing/playwright \
  node design/brand/examples/first-hello/browser.test.cjs
node design/brand/validation/check.cjs
```

`INTRO_SCREENSHOTS` optionally selects a capture directory. `BROWSER_CHANNEL` selects an installed Chromium channel for the introduction test; the rig test uses `BEND_BROWSER_CHANNEL`. The scripts do not install packages or download a browser.

The browser checks cover finite completion, frame stability while paused, restart/seek/replay, skip, reduced motion, hidden/offscreen suspension, keyboard controls, static fallback, and teardown. They also sample the scene at several times and widths, verify unchanged body paths throughout arrival and isolated rocking, and check arrival clearance. Rig checks cover independent facial/arm channels, alternating arch ends, protected body details, geometry bounds, and exact restoration.

Recorded check on 2026-10-01: Chrome `154.0.8037.58` on macOS. Source, renderer, rig, and score checks passed. The introduction suite captured 71 scene samples at widths 320, 375, 768, and 1280 CSS px, plus 320 × 568, 375 × 667, 390 × 844, 701 × 700, and 1280 × 720 viewports. Its uninterrupted browser playback took approximately ten seconds; the checked runs had no script errors, missing assets, or external requests. The MP4 export was verified as 300 H.264 frames at 30 fps, 1200 × 640, exactly 10.000 seconds, with no audio stream. Rendered samples were inspected for rigid-body arrival, framing, facial/arm changes, label collisions, and the ending. This does not constitute a subjective real-time viewing study.

Geometric tests and sampled frames do not establish perceived personality or natural ground contact. The arrival is a stylized rigid-body sway, not a simulated human gait or inverse-kinematics solution. Synthetic lifecycle events are not an actual OS suspension or back/forward-cache test. Cross-browser, physical-touch, screen-reader speech, and audience-recognition testing remain outside these checks.
