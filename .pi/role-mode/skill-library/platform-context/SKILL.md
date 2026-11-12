---
name: platform-context
description: Review app UI in its platform context using the Vue design workshop, native windows, viewport profiles, safe areas, and keyboard-dependent layouts.
---

# Platform context

1. **Name the host.** Identify the target OS, native or browser host, device class, input method and consequential states. Read the [platform guidance](../../../../design/platform-context/platform-guidance.md). Distinguish native captures from simulated profiles; sampled dimensions are assumptions, not platform guarantees. Brand artwork and illustration studies do not need app frames.

2. **Use the independent workshop.** Read the [design workshop guide](../../../../docs/development/design-workshop.md). Render the workshop's own Vue view in its clean preview window. Use local components, styles and brand assets under `client/workshop/`; do not alter or import production UI for an experiment. Keep scenario selectors, state controls and environment settings in the separate controls window. Do not create standalone HTML prototypes, iframe replicas or illustrated titlebars around app content. Native desktop chrome belongs to the current operating system, not the view.

3. **Exercise the environment.** Offer appropriate macOS, Windows, named Linux, iOS and Android profile dimensions. Keep size, platform-specific app behavior, safe areas and keyboard occlusion explicit. A named profile is not an emulator: switching to Windows on macOS does not render a Windows window manager. For text entry, test keyboard-open and keyboard-closed available space while preserving drafts and focus. Simulated space must not be counted twice alongside native safe-area or viewport information.

4. **Check the rendered view.** Inspect screenshots at intended and constrained sizes, and exercise focus, text growth, scroll regions, dialogs and errors. Essential controls must remain reachable within the effective app rectangle. Use `accessibility-audit` and `interaction-states-pass` for deeper reviews. Changing an environment must not reset the interaction scenario. Keep the preview free of labels, state selectors, boundary overlays and review explanations.

5. **Record evidence and limits.** Link the workshop scenario and record its environment settings, renderer and tested dimensions in adjacent notes. Separate design choices from OS support commitments and implementation claims. Verify native dragging, titlebars, actual keyboard delivery, platform fonts and assistive technology on the target runtime; a simulated profile cannot establish them. For review-only requests, report findings without editing files.
