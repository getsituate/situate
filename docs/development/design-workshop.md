# Design workshop

The design workshop is an independent Vue application under `client/workshop/`, with synthetic workspace, navigation, chat and file data. It uses the product's technology and conventions without importing its UI source. A separate controls window selects scenarios, changes action outcomes, and resizes the preview. The preview contains only the application UI.

## Start

With the [client prerequisites](../../client/README.md#prerequisites) installed:

```sh
cd client
npm ci
npm run design
```

This opens two desktop windows and starts Vite on port 1421. Close both windows, or stop the command, to exit. The workshop has its own npm package, entry point, build configuration and debug-only desktop Tauri crate, with the application identifier `dev.situate.design-workshop`. Its native host does not initialize workspace storage or register workspace/file-operation commands. Normal app builds do not load the workshop frontend.

For browser-only work:

```sh
cd client
npm run dev --workspace @situate/workshop
```

Open `http://localhost:1421/?workshop=controls`, then select **Open preview**. Allow pop-ups for this origin. Browsers may refuse to resize windows; the controls always show the measured viewport, not an assumed result. Use the native desktop workshop for window sizing.

## Review a scenario

A **scenario** is a separately selectable screen or workflow. A **state** is a condition within it, such as an empty collection or a failed search. **Screen** refers to the app surface currently visible in the preview; navigating can change it without changing the selected starting state.

For detailed review paths, see [AI access and model choice](design-workshop-ai.md), [provider warnings and device credentials](../../client/workshop/src/workshop/provider-access-design-notes.md), and [file conflict resolution](design-workshop-conflicts.md).

Scenario selection, window size, and platform are always available. Other controls follow the screen currently visible in the preview, including navigation and dialogs opened by clicking. Workspace examples appear in the selection and open-workspace screens; folder collision appears only during creation. File and navigation screens expose their own controls instead of workspace settings. Removal confirmation shows its error setting without unrelated list or creation options. **Complete** and **Fail action** appear only while a workspace action is pending. Hiding a setting preserves its value until it is changed or the scenario is reset.

- **Scenario** lists screens and workflows rather than separate entries for every loading, empty or error state. **Find a scenario** expands optional search and topic filters; search also matches state names and existing scenario IDs. Filtering leaves the preview unchanged. The selected screen stays visible above the filters, and **Clear filters** restores the complete list.
- **Starting state** loads an example for the selected screen: for example, an empty document collection, a failed search or plugin development with failed checks. This replaces example data and clears pending work and drafts while preserving platform and window size. Screens with one example omit this selector. These are starting presets, not a claim about the current preview after interaction; the live controls below continue to follow navigation and dialogs.
- **Reset scenario** restores that starting point and cancels pending actions. Platform selection is preserved; example data, errors, form drafts, and action outcomes are reset.
- **Arrange tabs and panes** groups empty tabs, conversations, split arrangements, maximized panes, the Move pane dialog, and loading or unavailable panes as starting states. Platform and viewport remain independent controls. Existing `tabs-*` links open the corresponding state.
- **Workspace examples** switches between empty, short, long-name, and many-item data. Changing the example set resets local view interactions and pending actions.
- **Action result** applies to subsequent workspace actions until changed. Select **Wait for manual completion**, interact with the preview, then use **Complete** or **Fail action** to advance it.
- **New workspace folder already exists** changes creation validation without replacing the form or its selected example parent folder.

Interactions in the preview update the controls. The preview can be reloaded or closed and reopened while the controls remain open. Reloading the controls starts the scenario again. Nothing is persisted as a real workspace. Native folder pickers are replaced by example locations, and Quit/Background actions keep the preview available.

In browser mode, the controls URL records the starting-state ID and platform, for example:

```text
http://localhost:1421/?workshop=controls&scenario=collision&platform=mobile
```

Add `profile=mac|windows|kde|ios|android` and `keyboard=open|closed` for environmental assumptions, for example `?workshop=controls&scenario=files-source&profile=ios&keyboard=open`.

This is a starting-state link, not a saved snapshot of every later interaction. Independent browser workshop sessions receive separate communication channels.

## Component library

Select **Component library** to inspect the workshop's public UI components together. Its starting states cover ready, disabled, validation error, pending action, empty collection and success. The separate controls window changes the current example state, label length and available component width without discarding text. Use **Complete example action** or **Fail example action** while an example is pending; reset restores deterministic fixtures and closes dialogs.

The preview uses the actual exports from `client/workshop/src/ui/`, not a second set of catalog-only controls. Keyboard choices, dialog cancellation and focus restoration, scrolling and divider resizing are interactive. Window size, platform profile and keyboard occlusion remain independent environment settings.

The [component inventory](../../client/workshop/src/component-library/inventory.md) separates general UI primitives from feature compositions and records coverage gaps. The [workshop UI API](../../client/workshop/src/ui/README.md) describes props, slots, events and native-element access.

## Size and platform

Presets and custom sizes specify the preview's **content area in CSS pixels**, excluding native title bars. The controls display the actual size after resizing, including manual window resizing. Window-manager and screen limits can prevent a requested size from being reached.

Platform selection is independent of size. A narrow desktop window remains a desktop workspace view until **Mobile** is selected. **Platform profile** selects named desktop or phone reference geometry, updates the platform behavior and requests its size. Mobile profiles reserve synthetic safe-area space. During text entry, **Keyboard occlusion** reduces the available content area without discarding the draft. The native titlebar remains the current host's titlebar; no illustrated OS chrome is embedded in the app.

Profiles do not emulate another OS, mobile WebView, input method, font rendering or device pixel density. Check actual inset delivery, keyboards, touch behavior and assistive technology on a simulator or physical device. [Platform guidance](../../design/platform-context/platform-guidance.md) records assumptions and verification boundaries.

## Source boundaries

| Area                | Production app                               | Design workshop                                         |
| ------------------- | -------------------------------------------- | ------------------------------------------------------- |
| Views and app shell | `client/app/src/`                            | `client/workshop/src/`                                  |
| UI components       | `client/packages/ui/src/`                    | `client/workshop/src/ui/`                               |
| Styles and tokens   | Product styles and canonical `design/brand/` | Local styles and `client/workshop/src/brand/` snapshot  |
| Native host         | `client/app/src-tauri/`                      | `client/workshop/src-tauri/`                            |
| State and services  | Native workspace integration                 | Local synthetic models and injected simulation services |

The workshop owns copies of the initial UI and brand assets, not aliases or symlinks. Changing a workshop component, token or illustration does not change the product. Neither application imports the other's UI, fixtures or service interfaces. Shared infrastructure is limited to the development toolchain, npm dependency installation, test runner and build-boundary tooling.

Vite and Vitest reject resolved module paths outside each application's allowed source roots. The workshop does not allow `client/app/`, `client/packages/ui/` or canonical brand sources. Production does not allow workshop sources. CSS dependencies and emitted asset origins are checked during builds. These checks prevent accidental source coupling; they are not a security sandbox against arbitrary repository edits.

## Extend the workshop

- [`AppSurface.vue`](../../client/workshop/src/components/AppSurface.vue) and the local shell compose the preview. Reuse workshop-local components before introducing another variation.
- [`simulation.ts`](../../client/workshop/src/workshop/simulation.ts) defines example states and transitions. Register each state in [`scenario-catalog.ts`](../../client/workshop/src/workshop/scenario-catalog.ts) under its screen or workflow; add a top-level entry only for a distinct screen or workflow. Existing state IDs remain valid in URLs. Test new reachable states and keep real filesystem and business operations out of the simulation.
- [`screen-controls.ts`](../../client/workshop/src/workshop/screen-controls.ts) assigns controls to the currently visible screen, not merely the starting scenario.
- [`form-services.ts`](../../client/workshop/src/workspaces/form-services.ts) requires injected simulation services; it has no native-workspace fallback.
- [`Controls.vue`](../../client/workshop/src/workshop/Controls.vue) owns state. Preview messages carry controller identity, scenario epoch and sequence so stale messages cannot modify a reset scenario.
- Local navigation, editor and AI views live under `client/workshop/src/navigation/`, `client/workshop/src/editor/` and `client/workshop/src/ai/`. Their serializable state interfaces separate UI composition from simulated data. AI setup renders without the workspace shell; its authentication and model outcomes remain in the controls window.

Use the [brand handbook](../../design/brand/README.md) as design guidance. Experiment with local tokens and assets, not their canonical sources. The [snapshot notes](../../client/workshop/src/brand/README.md) identify origins and update rules.

## Adopt an approved design

Workshop and product UI may intentionally differ. There is no automatic synchronization and no test requiring their screens to remain identical.

1. Obtain explicit approval to implement the selected design and states.
2. Copy the relevant Vue components and styles into the product. Reconcile them with its current UI components rather than importing from the workshop.
3. Replace synthetic models and services with production integration. Review loading, failure, accessibility and lifecycle behavior.
4. Run product unit, browser and relevant native tests. Review the implemented screen against the approved design, not every ongoing experiment.

Refreshing a workshop baseline from production is also an explicit, scoped copy. Preserve unrelated experiments. Do not add build-time copy scripts or shared UI imports to keep the two applications in step.

General components use matching `Situate*.vue` names in `client/workshop/src/ui/` and `client/packages/ui/src/`. Their relative imports, caller-supplied text and `--situate-*` token names keep transfers small. Copy a selected component with its local dependency files and relevant tests, then export it from the destination's `index.ts`. Text controls, for example, also need `text-control.ts` and `text-control.css`. Review the destination token values and public prop/event/slot contract before replacing an existing component. Select, Scrollbars and ResizeHandle behavior has additional dependencies; copying a single Vue file is not sufficient for every component. Feature views still require production state and service integration.

### Design basis and scope

- Workspace selection separates remembered locations from open sessions. Removing a listing does not delete files or close the session. Creation makes a new child folder, not a workspace out of the parent's existing contents. Optional sync remains outside this local flow. See [REQ-0037](../../requirements/data/requirements/REQ-0037-keep-workspaces-independent.md), [REQ-0038](../../requirements/data/requirements/REQ-0038-copy-portable-workspaces.md), and the [workspace architecture](../architecture/04-solution-strategy/workspaces.adoc). The list/actions arrangement was informed by the user-selected Obsidian launcher structure; no third-party screenshot or code is included.
- Navigation studies a new chat and My day alongside chat, with responsive tabs, conversations and archived items. Task completion, draft entry and pane changes operate on examples, not real tasks or AI processing.
- The file browser belongs to Files, not the global sidebar. Existing files open rendered; source editing, protected IDs, automatic-save outcomes and read-only historical versions are separate states. File and folder operations update an in-memory model. Chat references follow file identity across simulated moves and renames; historical references retain their selected revision. No real filesystem, Git, sync or AI backend is connected. See [REQ-0042](../../requirements/data/requirements/REQ-0042-edit-markdown-source-and-read-rendered-content.md), [REQ-0022](../../requirements/data/requirements/REQ-0022-explain-note-changes.md), and [REQ-0035](../../requirements/data/requirements/REQ-0035-preserve-file-and-task-identity.md). Earlier layout guidance included UI Skills on [simplification](https://www.ui-skills.com/skills/pbakaus/distill) and [grouping and adaptive layout](https://www.ui-skills.com/skills/jakubkrehel/better-layout).

These are design scenarios, not user-research evidence, product support commitments or storage/security guarantees. Canonical brand references and Bend artwork remain in `design/brand/`; app-screen exploration belongs in the Vue workshop, not standalone HTML.

## Verification

```sh
node tools/test.mjs --unit --changed
cd client
npm run build
npm run build:design
npm run test:browser
npm run test:browser:design
cargo test --manifest-path workshop/src-tauri/Cargo.toml --locked
```

Separate browser suites exercise the normal app and workshop in Chromium and WebKit. They cover cross-window state, action completion, resets, reconnects, form focus, scenario isolation, viewport reporting, file conflicts, and AI access/model-choice states. These checks do not replace native window-control checks.

Browser test servers bind OS-assigned loopback ports and do not reuse or stop existing development servers. Interactive development ports are unchanged.
