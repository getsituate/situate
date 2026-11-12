---
id: REQ-0026
type: requirement
title: Provide plugin-defined views
status: approved
priority: must
area: Integrations
goals: [GOAL-0005]
---

## Description

Plugins must be able to provide their own visual views within Situate. The views available to users must not be limited to those built into the application. Plugin authors must be able to define how their plugin presents its content or functionality through extension points, without changing Situate's core application code.

This capability complements [modifying existing views and theming](REQ-0027-customize-existing-views-and-theming.md) and [extending interface elements and layout](REQ-0028-extend-interface-elements-and-layout.md). The [plugin platform compatibility requirement](REQ-0014-plugin-platform-compatibility.md) also applies to plugin-defined views.

Host and plugin interfaces must use Vue. Situate must supply the same shared Vue component implementations to its host interface and plugins, not merely matching styles or separate lookalike libraries. These components provide centrally evolved defaults, adapt to their available container size, and are centrally verified on supported device platforms. Plugins should use them by default to feel like part of the application. Fully custom components and views remain possible; the library is not a restriction to a fixed widget vocabulary.

Plugin views may execute as ordinary Vue components in the host UI under the [trusted-plugin contract](../foundations.md#plugin-trust-and-synchronization-ownership). Independently terminating a stuck view while keeping the application responsive is not required. A faulty view can freeze the application and require a forced restart, potentially losing unsaved state. This risk also applies to previews and UI checks; code staging and temporary test data do not isolate execution failures. [Plugin-free recovery](REQ-0032-manage-plugin-status-and-disabling.md) must remain reachable after such a failure and allow source inspection and repair before any plugin imports. Services and chat tools retain their supervised execution contract.

A plugin may provide its own settings page within [plugin management](REQ-0032-manage-plugin-status-and-disabling.md). That page follows the same Vue view rules and uses the same supplied components as other plugin views; no separate declarative settings-form generator is required. Disabled plugins do not execute their settings pages.

Plugin views must support plain JavaScript and locally compiled Vue templates without mandatory TypeScript, JSX or an external build pipeline. Mobile plugin authoring must not require a Node.js build pipeline. TypeScript may remain part of host tooling without becoming a plugin-authoring requirement.

Shared components and the plugin SDK should expose small, stable public contracts, including component props, events and slots, rather than requiring plugins to depend on implementation details. These public contracts follow the [plugin interface compatibility policy](REQ-0070-preserve-plugin-api-compatibility.md), including its six-month minimum and long-term objective of never breaking interfaces. This does not commit to every third-party library version. Prototype behavior is not evidence of long-term compatibility. Plugins can define local components and explicitly export reusable components through [declared dependencies](REQ-0001-create-integrations.md); component names are local by default, with no automatic global component pool.

Each workspace's [named topic tabs](REQ-0011-work-on-topics-in-parallel.md) contain independent pane layouts. Each pane displays exactly one active view instance, not a group of view tabs. On sufficiently large displays, users must be able to freely move and resize tiled panes and maximize a view within the active tab. Opening a built-in or plugin view uses the focused pane and adds a target to its history; ordinary view opening does not create another tab or pane or change maximization. Splitting, moving, resizing and maximizing are explicit layout actions, not plugin-selected opening defaults. Without any open tab, navigation creates one tab with one pane. Responsive behavior normally presents one pane with quick switching within the active tab on a phone and permits tiling on larger displays. Narrow presentation and temporary maximization preserve the underlying pane arrangement. Pane movement and divider resizing support pointer and keyboard interaction. Narrow presentation offers pane-title switching with bounded swipes and keyboard alternatives, without taking over content gestures. These standard view capabilities do not depend on optional extensions to the surrounding interface.

Each pane has independent back and forward navigation. Opening another view in the active pane adds a navigation target to that pane's history; back and forward restore the selected target in the same pane without navigating other panes. A new navigation after going back discards that pane's forward branch without deleting the referenced content or conversations. Moving a pane retains its history; resizing and maximizing do not add history entries. History is distinct from keeping every previous view mounted. Closing a pane releases its view-scoped resources but does not stop workspace-owned agent or plugin work.

Opening a different file, revision or conversation creates a navigation target. Scrolling, changing selection or switching reading/source mode updates the current entry's presentation state instead of adding an entry. Back and forward remain local even when the target conversation is already displayed elsewhere; main-navigation conversation selection instead reveals an open instance under [REQ-0011](REQ-0011-work-on-topics-in-parallel.md). Initially there is no product-imposed pane-history limit. A deleted content target or unavailable plugin view remains in history with an explanatory unavailable state and applicable actions to retry, go back or open another view; it is not silently replaced with different content. Pinned views are available from the main menu and empty-pane chooser; all registered available views remain discoverable without pins.

The agent must be able to open views and select or show entries in them. Plugins can also offer [content-reference actions that open a fresh chat](REQ-0030-open-chats-with-content-references.md).

Local development must include previews at different screen sizes and agent-accessible interaction and screenshot capabilities. Situate writes automated plugin tests, including UI tests, with synthetic data and separate test configurations. Agent-led investigation may read real workspace data and accounts under the same ordinary access rules in [REQ-0033](REQ-0033-stage-and-activate-plugin-changes.md); incidental writes to real external services remain prohibited during trials and task scope and configured access remain applicable. No additional technical sandbox is prescribed. A resized preview does not replace verification on target platforms.

## Rationale

Users need ways of presenting information that reflect their own working methods. Plugin-defined views let their personal system go beyond the application's built-in presentations.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Plugin-defined visual views were explicitly requested and classified as must-have. The Pi Coding Agent was cited as a conceptual example of broad extensibility through extension hooks, not as a prescribed implementation or API.

Private architecture strategy clarification, 2026-09-29; transcript not included. Shared cross-platform components, custom components, responsive previews and agent-driven UI testing were confirmed. At that clarification, test data was normally synthetic and real-account verification was permitted without a mandatory test sandbox; the automated-test and agent-trial distinction was refined below.

Private plugin architecture clarification, 2026-09-29; not publicly available. Movable and resizable tiled panes, maximized views, plugin-chosen defaults, responsive presentation and agent view control were confirmed.

Private UI and recovery requirements clarification; date not recorded, not publicly available. Vue for host and plugin interfaces, shared implementations, container-responsive defaults, local JavaScript/template authoring and explicit component exports were confirmed. Long-term compatibility remains unproven.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. Plugin-owned settings pages follow normal view contracts. Automated tests require synthetic data, while separate agent-led trials may read real data under the development-copy rules.

Private UI architecture clarification; date not recorded, not publicly available. One active view per pane, per-pane back/forward history and pane layouts within named topic tabs were confirmed.

Private plugin execution clarification, 2026-10-16; not publicly available. Host-executed Vue views were accepted with application-hang and restart risk, conditional on plugin-free recovery and repair.

Private application-update and compatibility clarification; date not recorded, transcript not publicly available. The public plugin interface compatibility policy was extended to shared component contracts; support for arbitrary third-party library versions was not promised.

## Acceptance criteria

- A plugin can define and provide a visual view that is not built into Situate.
- Users can open and use that view within Situate on a platform supported by the plugin.
- Providing the view uses plugin extension points and does not require changes to Situate's core application code.

- Host and plugin views use Vue and can render the same Situate component implementation; matching styling alone does not satisfy this requirement.
- A host-executed view is not presented as independently stoppable or isolated from the application's UI; unmounting and disabling do not claim to interrupt synchronous JavaScript.
- After a faulty view forces application termination, recovery startup can restore access to built-in management and source repair without importing that view, its preview or its executable checks.
- A shared component adapts when its pane or other container is resized, including when the overall window size stays unchanged.
- A central change to a shared default is reflected in host and plugin uses of that implementation without separately rewriting each plugin.
- A plugin view can be authored in plain JavaScript with locally compiled Vue templates, without TypeScript, JSX or an external build pipeline, including without a Node.js build pipeline on mobile.
- A plugin can use documented component props, events and slots, or supply its own component, without a restricted UI vocabulary.
- Users and the local agent can inspect a plugin view at phone and desktop sizes without modifying plugin source for each preview.
- The agent can generate and run UI tests, interact with controls and capture the application's rendered plugin views.
- Automated UI tests use synthetic data and temporary test configurations; agent-led real-data investigation follows ordinary workspace access and the external-write instructions in REQ-0033.
- An enabled plugin can supply its own settings page using the shared view components; disabling it makes that page unavailable without deleting its configuration.
- On a sufficiently large display, users can tile views, move and resize their panes, and maximize a selected view.
- Opening a plugin view fills the focused pane and adds to its history without creating tabs, splitting panes or automatically maximizing. Explicit layout actions remain available to the user.
- Each pane displays exactly one active view instance, and multiple panes can be arranged within a tab.
- After opening view A and then view B in one pane, back shows A and forward shows B in that pane; other panes retain their current targets.
- After going back from B to A and opening C, forward no longer returns to B; B's underlying content or conversation is not deleted.
- Moving a pane preserves its navigation history; resizing and maximizing add no navigation entries.
- A phone presentation normally shows one pane and offers switching between the active tab's panes; returning to a wider presentation restores the pane arrangement.
- Leaving maximized presentation restores the tab's pane arrangement.
- Closing a pane releases view-scoped resources without stopping workspace-owned agent or plugin work.
- The agent can open a plugin view and select or reveal a requested entry in it.
- Opening a different file, revision or conversation adds a history entry; changing scroll position, selection or reading/source mode does not.
- An unavailable history target remains identifiable, with back navigation and applicable recovery actions; no unrelated content is substituted.
- Empty panes offer a new conversation, pinned views in main-menu order and access to all available views. Pinning does not navigate.

## Open questions

- Which content interactions beyond opening views and selecting or showing entries are required?
- Which accessibility rules and component coverage are required?
- What are the public component and SDK contracts, and how will their evolution and compatibility be verified?
- How are app-local UI automation and screenshots implemented on each platform, separately from developer-host test tools?
- Which operating-system and store restrictions apply to custom rendering and execution?
