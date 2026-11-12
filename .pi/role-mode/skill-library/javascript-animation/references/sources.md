# Sources and evidence boundaries

## Video reference

[John Kim — AI App Animations is Hard Until You Learn This](https://www.youtube.com/watch?v=f-Ar8mwm3kQ).

**Available evidence:** the public video description and chapter list. **Unavailable evidence:** the spoken transcript and a visual review of the video. The caption endpoint returned an empty response, and the transcript endpoint returned HTTP 400. The description is not a substitute for the transcript; do not attribute detailed advice, quotes, or demonstrated visual quality to the speaker on this basis.

The description lists keyframes, springs, gestures, physics, SVG paths, layout transitions, skeletal rigs, shaders, particles, flipbooks/video, and Rive/Lottie. It mentions a puzzle app with characters, a morphing hero scene, gesture-driven tilt, and completion confetti, as well as combining techniques and reviewing generated motion.

The published chapter markers locate topics, not verified spoken claims:

| Time  | Chapter topic                          |
| ----- | -------------------------------------- |
| 03:16 | Taste, craft, and delight              |
| 05:02 | Animation toolbox                      |
| 12:32 | Rive, Lottie, and open-source examples |
| 14:08 | Composing animations                   |
| 17:34 | Codex computer use with Rive           |
| 21:59 | Cheat sheet and closing thoughts       |

The JavaScript mappings, creative workflow, example parameters, and implementation cautions in this skill are an independent synthesis, not a reconstruction of the spoken tutorial. A transcript would allow a closer comparison with the speaker's actual explanations; it would still not establish the quality of the visual motion without viewing it.

## Design principles

- [Interaction Design Foundation: applying animation principles to UI](https://assets.interaction-design.org/literature/article/ui-animation-how-to-apply-disney-s-12-principles-of-animation-to-ui-design) — explanatory guidance on anticipation, staging, and overlapping action; consulted through search excerpts. This is not empirical evidence that a particular effect improves conversion or usability.

The duration ranges and suggested combinations in this skill are design starting points, not measured universal optima. Prefer project motion tokens and rendered comparison over treating these numbers as standards.

## Primary implementation references

Consulted documentation or documentation excerpts:

- [MDN: Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate) — native keyframes, timing options, return value, and multiple effects on an element.
- [MDN: using WAAPI](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API) — browser animation engine and JavaScript playback control; only a bounded introductory excerpt was reviewed.
- [MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) — timestamps, refresh rates, one-shot scheduling, and background behavior.
- [MDN: Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) — unified pointer input and capture; consult the detailed event sections when implementing gesture cancellation.
- [MDN: SVG d](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/d) — path command structure and geometry.
- [Motion: animate](https://motion.dev/docs/animate) — hybrid versus mini capabilities, SVG drawing, keyframes, and timeline sequences.
- [Motion: motion values](https://motion.dev/docs/motion-value) — velocity, change subscriptions, `jump`, and stopping active animation; API excerpts retrieved through Context7.
- [Motion: spring values](https://motion.dev/docs/spring-value) — physical spring options and velocity-sensitive response; API excerpts retrieved through Context7.
- [GSAP: Flip](https://gsap.com/docs/v3/Plugins/Flip/) — capture/mutate/animate workflow, nested transforms, interruptions, and layout options.
- [Rive: Web JavaScript runtime](https://rive.app/docs/runtimes/web/web-js) — runtime packages, loading, renderer selection, authored state machines, and surface sizing. API names and recommended renderer packages can change; verify against the installed release.
- [Lottie Web: loadAnimation options](https://github.com/airbnb/lottie-web/wiki/loadAnimation-options) — renderer, autoplay, loop, and asset inputs; API excerpts retrieved through Context7.
- [Lottie Web: usage](https://github.com/airbnb/lottie-web/wiki/Usage) — segments, frame seeking, and destruction; API excerpts retrieved through Context7.
- [Three.js: AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html) — clip playback, delta time in seconds, stopping actions, and uncaching.
- [Three.js: ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) — GLSL programs and JavaScript-updated uniforms for the WebGL renderer.

Additional API lookup links for implementation details, not independently reviewed in depth:

- [MDN: stroke-dashoffset](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dashoffset).
- [MDN: HTMLMediaElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement).

No third-party animation assets or tutorial source files are bundled. Inspect the applicable terms before adopting a dependency, plugin, exported animation, or example asset; an open runtime does not license every asset it can play.

## Performance and accessibility

- [web.dev: high-performance CSS animations](https://web.dev/articles/animations-guide) — transform/opacity, rendering costs, measured layer promotion, and browser profiling.
- [web.dev: prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion) — CSS and JavaScript preference handling, including changes during playback; consulted through search excerpts.
- [W3C: Animation from Interactions, SC 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — disabling nonessential interaction-triggered motion, Level AAA; consulted through search excerpts.
- [W3C: Pause, Stop, Hide, SC 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) — conditions for automatically starting movement and separate requirements for auto-updating content, Level A.
- [W3C: Three Flashes or Below Threshold, SC 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) — flash thresholds and why reduced-motion support alone is insufficient, Level A.

Library capability statements describe available mechanisms, not performance guarantees. Browser support, asset compatibility, accessibility, and perceived quality must be checked in the actual integration.
