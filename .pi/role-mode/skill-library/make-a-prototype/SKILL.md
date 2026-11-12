---
name: make-a-prototype
description: Build a scoped interactive prototype to test a specific usability question. Use when static sketches cannot answer a flow or feedback question.
---

# Make a prototype

Agree on the question, scenario, entry state and observable outcome. Choose the lowest fidelity that can answer it. A clickable storyboard is enough for navigation questions; editing, feedback or recovery questions may need working state.

Inspect existing tooling and components before introducing dependencies. Respect approved technology constraints for implementation-like prototypes; explicitly distinguish a disposable sketch from production architecture. Do not turn a prototype request into application implementation.

Use synthetic content and local fixtures. Do not connect real accounts, send messages, charge money or run live AI merely to demonstrate a flow. Identify simulated effects in the surrounding prototype notes; do not present them as implemented capabilities.

Implement the tested path and the relevant alternate or failure path. Keep state and feedback coherent:

- Controls required by the task work and have understandable labels.
- Back, cancel and retry behave consistently within the chosen scope.
- Pending, completed and uncertain outcomes are distinguishable where applicable.
- Keyboard focus and touch behavior suit the intended device.
- Out-of-scope controls do not falsely imply working effects.

Add persistence, animation and simulated latency only if the test needs them. Do not require a design system or high-fidelity visuals for an early flow test.

Run through the scenario in the rendered artifact, including its important interruption. Check console errors and relevant automated tests when available. State exactly what was exercised, what is simulated and what could not be verified. Code inspection alone is not proof of rendered behavior.

Create Situate app prototypes in the independent [Vue design workshop](../../../../docs/development/design-workshop.md) under `client/workshop/`. Use its own Vue components, styles and brand snapshot, without live imports from the product. Share the technology and conventions, not mutable UI source. Keep synthetic fixtures, simulated services and proposal notes separate from production services and the requirements catalog. Copy and integrate selected designs into production only after explicit implementation approval; do not synchronize automatically or create a standalone HTML replica. Report the test question, working scope, limitations and next decision.
