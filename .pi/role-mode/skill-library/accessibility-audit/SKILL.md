---
name: accessibility-audit
description: Evaluate accessibility of a scoped concept or interface, including keyboard, semantics, contrast, feedback and touch. Use during design and prototype review.
---

# Accessibility audit

Establish the surface, target platform, fidelity and whether fixes are authorized. A wireframe can expose structural issues but cannot prove rendered contrast or assistive-technology support.

Review applicable concerns:

- Meaningful structure, reading order, labels and control roles.
- Keyboard access, visible focus, logical focus movement and escape from overlays.
- Understandable errors and status changes, not information carried only by color.
- Measured text and control contrast against actual backgrounds.
- Zoom, text resizing, reflow, touch targets and alternatives to precise gestures.
- Reduced motion and alternatives to time-sensitive interactions.

Use native semantics and platform conventions where available. Apply relevant WCAG criteria for web surfaces; use platform accessibility APIs and guidance for native surfaces. Name the criterion behind a finding rather than treating aesthetic preferences as violations.

Verify using the rendered surface, keyboard operation, available automated checks and assistive technology when available. Distinguish confirmed failures, suspected barriers and untested areas. Automated checks alone do not establish conformance.

Report each issue with location, user impact, evidence and a scoped remedy. Fix only when requested. Preserve intended behavior and do not add unrelated flows. State unavailable test tools or devices and avoid blanket accessibility claims.
