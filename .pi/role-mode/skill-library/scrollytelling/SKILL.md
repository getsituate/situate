---
name: scrollytelling
description: Design or review scroll-driven website narratives, product landing pages, sticky visual sequences, and scroll-linked interactions. Use for scrollytelling storyboards, implementation handoffs, or reviews of narrative clarity, mobile behavior, accessibility, and motion performance.
---

# Scrollytelling

Use scrolling to explain a sequence, relationship, or transformation. Animation must help the audience understand something, not merely delay access to it. A readable static page is the baseline; motion is an enhancement.

## Establish the purpose

Read the relevant product context, approved claims, existing page, and target-device constraints. For Situate, start with repository-relative `design/brand/README.md` and its applicable motion and token guidance. Reuse canonical brand assets rather than creating a competing visual system.

Identify the audience, the question the page answers, and the action visitors should be able to take. Ask only about uncertainties that materially affect the design. Do not imply that a demonstrated product capability is implemented without checking.

Decide whether scrollytelling is useful at all:

- Use it when staged explanation makes a complex concept easier to understand or when intermediate visual states carry meaning.
- Prefer ordinary content for quick lookup, repeated operational tasks, or information people need to scan and compare freely.
- Compare with a static alternative. If removing motion loses no useful meaning, simplify the effect or remove it.
- Do not claim improved conversion, engagement, or comprehension without evidence. Scroll depth and dwell time alone cannot distinguish interest from confusion.

## Build a narrative before choosing effects

For advertising or product landing pages whose message is not yet clear, use [StoryBrand messaging](../storybrand-messaging/SKILL.md) to establish the audience, problem, outcome, evidence, and action before choosing the sequence. Do not force its seven elements into seven scroll sections.

Write a short static outline first. For a product page, a possible sequence is context, problem, demonstrated change, outcome, and next action; adapt it rather than treating it as a mandatory formula. Keep the core value and primary action understandable without completing the story.

Create a storyboard with one main idea per beat. Record:

| Beat | Reader question and takeaway | Visible text and visual state | Trigger or progress mapping | Mobile treatment | Reduced-motion/static equivalent |
| ---- | ---------------------------- | ----------------------------- | --------------------------- | ---------------- | -------------------------------- |

For each visual change, explain what it adds to understanding. Describe entry, hold, exit, and backward-scroll behavior. Keep explanatory text available long enough to read at the visitor's own pace. Do not make essential information transient or available only at one precise scroll position.

Use normal-flow sections between intensive scenes. Avoid long scroll distances with little visible change, ambiguous endings, or a full page of pinned scenes. Make major sections directly reachable where useful; visitors should not need to replay the whole narrative to find details or act.

## Choose a pattern and the smallest mechanism

Distinguish two interaction models:

- **Scroll-triggered:** crossing a threshold activates a state or starts an animation on its own clock. Suitable for step changes and brief emphasis.
- **Scroll-linked:** scroll position controls progress. Stopping holds the state; reversing scroll reverses the transformation. Suitable when intermediate states explain something.

| Pattern                             | Purpose                                               | Implementation direction                                             | Main risk                                                   |
| ----------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Sticky visual with normal-flow text | Explain one graphic or interface across several steps | CSS `position: sticky` with IntersectionObserver or Scrollama        | Visual competes with text or consumes too much mobile space |
| Progressive disclosure              | Add relevant detail in a comprehensible order         | Step triggers and explicit visual states                             | Essential content becomes hidden or transient               |
| Continuous transformation           | Explain a meaningful change, assembly, or comparison  | CSS scroll timelines or GSAP ScrollTrigger scrubbing                 | Unclear intermediate states and excessive scroll distance   |
| Brief pinned scene                  | Hold a key explanation in view                        | CSS sticky where sufficient; ScrollTrigger for coordinated sequences | Feels stalled even if native scrolling remains intact       |
| Parallax                            | Add restrained depth when justified                   | Layer transforms with a reduced-motion alternative                   | Discomfort, distraction, and little explanatory value       |

Read current API documentation and check target-browser support before specifying implementation details. Do not embed dated browser-version assumptions in a design. Use feature detection and a readable fallback for CSS scroll timelines.

Scrollama coordinates step detection using IntersectionObserver; it does not supply the visual storytelling itself. GSAP ScrollTrigger supports triggers, pinning, and scrubbing, but is not required for a simple sticky layout. Inspect existing tooling and dependency terms before recommending a new library. Do not add several scroll engines for one story without a concrete need.

For video, image sequences, canvas, or 3D, first justify why simpler visuals cannot explain the change. Include loading, seeking, decoding, memory, and static alternatives in the feasibility discussion. Keep important text and controls in semantic HTML rather than only inside rendered imagery.

## Preserve user control and access

Scrollytelling is an editorial structure; scrolljacking changes expected scrolling behavior. Preserve native scrolling, direction, keyboard navigation, and browser history. Avoid intercepting wheel or touch input, forced section snapping, and vertical gestures that unexpectedly move the page horizontally.

Native scrolling alone does not guarantee usability: long pinned sequences can still feel broken or coercive. Test the perceived interaction, not just the event-handling implementation.

Design accessibility and fallbacks alongside the primary sequence:

- Preserve semantic headings, logical document order, readable contrast, and visible keyboard focus.
- Keep links and controls usable without precise scrolling; do not move focus when a story step changes.
- Respect `prefers-reduced-motion`. Replace nonessential travel, zoom, and parallax with understandable static states or restrained changes; do not freeze the page halfway through a transition.
- Consider a visible motion control for motion-heavy pages. WCAG 2.3.3 addresses interaction-triggered animation at Level AAA; satisfying it alone does not establish overall accessibility conformance.
- Keep the complete explanation available without animation, unsupported APIs, or successful JavaScript initialization. A static alternative may need several labeled images, not just the final frame.
- Make mobile a separate composition decision. Reduce or remove pinning, stack content when needed, account for changing viewport height, and test real touch input.

## Set performance constraints

Prefer `transform` and `opacity` for animation. Avoid repeated layout and paint work from animating geometry properties or reading layout after DOM writes. Use observer-based step detection rather than repeatedly measuring every element in a scroll handler. Apply `will-change` selectively, only when measurements justify it.

Reserve media dimensions to reduce layout shifts. Size and load media according to the device and scene; do not preload an entire heavy sequence by default. Agree on measurable loading and runtime budgets with engineering rather than promising smoothness from the library choice alone.

## Validate and hand off

Use `make-a-prototype` when an interaction question needs a rendered test and `accessibility-audit` for a broader accessibility review. Test the smallest representative sequence before expanding the page.

Exercise:

- Slow reading, fast scrolling, reversal, and stopping between states.
- Section links, reload at a nonzero scroll position, and browser back navigation.
- Keyboard navigation, focus visibility, text enlargement, and reduced motion.
- Narrow screens, orientation changes, changing mobile browser chrome, and real touch input.
- Slow media loading, unavailable JavaScript, and unsupported animation features.
- Runtime performance on representative devices, including layout shifts and dropped frames.

Evaluate whether people understand the intended takeaway and can find information and complete the intended action. Separate observed user evidence from expert review and simulated walkthroughs. Report untested behavior explicitly; code inspection is not a rendered check.

Deliver only the artifact needed for the request: a critique, storyboard, scoped prototype, or implementation handoff. A handoff should include the chosen narrative, state and scroll mappings, mobile and static equivalents, asset needs, and acceptance checks. Keep design rationale in accompanying notes, not in product copy. Do not modify production architecture or approved product scope through a design exercise.

## Sources

Consult these for the relevant decision, not as a required reading sequence:

- [Nielsen Norman Group: Scrolljacking 101](https://www.nngroup.com/articles/scrolljacking-101/) — usability observations about scrolljacking, not evidence that all scrollytelling performs poorly.
- [Scrollama](https://russellsamora.github.io/scrollama/) — step detection and sticky-graphic patterns.
- [MDN: CSS scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations) — scroll and view timelines.
- [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) — triggering, pinning, and scrubbing.
- [W3C: Understanding WCAG 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) — motion sensitivity and interaction-triggered animation.
- [web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide) — rendering costs and performance measurement.
