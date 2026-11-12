# Workspace-wide development and reusable connections

## Scope and decision status

The next milestone is **Workspace-wide development with reusable connections**, delivered and qualified on macOS. A development conversation serves a user assignment, not one plugin. It can create or modify multiple connections, consumer plugins and other workspace files when the assignment requires them.

The selected direction is the same workspace access and tool capabilities as ordinary chat, with development-specific system instructions and presentation. A selected plugin is entry context, not an access boundary. Connections remain independently maintainable plugins; they do not require a separate conversation type or a child conversation per package.

This document defines the development contract, source boundaries and verification needed for macOS adoption. The requirements catalog remains authoritative. The Changes-only panel, shared chat presentation and Git-backed grouped publication are selected mechanisms; concrete native connections and their access/setup flows require separate qualification.

### Governing references

- [REQ-0001: integration creation, reuse and development conversations](../../requirements/data/requirements/REQ-0001-create-integrations.md)
- [REQ-0014: platform compatibility](../../requirements/data/requirements/REQ-0014-plugin-platform-compatibility.md)
- [REQ-0017: source inspection](../../requirements/data/requirements/REQ-0017-inspect-plugin-instructions.md)
- [REQ-0032: plugin management and dependency disabling](../../requirements/data/requirements/REQ-0032-manage-plugin-status-and-disabling.md)
- [REQ-0033: development, checks and activation](../../requirements/data/requirements/REQ-0033-stage-and-activate-plugin-changes.md)
- [REQ-0040: tool details and content changes](../../requirements/data/requirements/REQ-0040-reveal-tool-details-and-content-changes.md)
- [Foundations](../../requirements/data/foundations.md) and [plugin strategy](../architecture/04-solution-strategy/plugin-model.adoc)
- [Workshop workflow](design-workshop.md), [current plugin exploration](../../client/workshop/src/plugins/README.md), [brand handbook](../../design/brand/README.md) and [test selection](testing.md)

## User outcome

A request such as “Show my Apple Notes in a view” starts one development conversation carrying the assignment and context. The agent discovers relevant existing connections, their exports and consumers. It reuses a suitable connection, extends an incomplete one, or creates a missing one, together with the requested view plugin. Required access and technical limitations are explained rather than replaced with a fictional working connection.

A later request can introduce a system-wide convention across several plugins. The same conversation model handles that assignment without selecting a single owner plugin, creating a new orchestration product, or asking the user to coordinate agents. Independent requests may still run in independent conversations.

A second consumer must be able to reuse the first connection and its configured access. Each consumer retains its own explicit account selection where accounts apply; adding an account does not silently extend existing selections. A connection may expose chat tools without any view plugin.

The concrete macOS qualification uses public GitHub repository metadata through the existing network host, together with a workspace-file connection. Its consumers retain different explicit repository selections; the public-read connection needs no account credentials. The opt-in command and its boundary are described in [testing](testing.md#public-repository-connection-qualification). Authenticated account setup remains integration-specific and is not implied by a public GET.

Apple Notes is a candidate native integration, not an assumed available API. Validate supported macOS access, permissions and packaging constraints before making it the delivery example. If the necessary access is unavailable, report that blocker and select another real integration explicitly; synthetic workshop behavior is not evidence of native access.

## Source and protocol map

| Boundary             | Owner                                                                        | Contract                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation         | `conversation-record.ts`, `conversation_store.rs`                            | Version 2 stores assignment/context and optional starting plugin/origin without a mandatory draft. Compatibility readers retain older bound drafts.                         |
| Capabilities         | `ai/tools.ts`, native `ai.rs`                                                | Both conversation types use workspace/device/recovery capabilities and exact persisted tool-intent authorization.                                                           |
| Editable source      | `plugins/sources.rs`, native `plugin_sources.rs`                             | Shared code has stable Git history; prepared edits do not replace immutable running revisions.                                                                              |
| Checks               | `plugins/change-checks.ts`, native `plugin_changes.rs`                       | Capture selected revisions, required dependencies and affected consumers; synthetic hosts share workspace files but keep plugin-specific state isolated.                    |
| Publication          | `plugins/publication.rs`, `plugin_actions.rs`, `plugins/runtime.ts`          | Drain actual actions/requests, commit one revision map, stage related registrations, then release admission. Durable attempts distinguish confirmed and uncertain outcomes. |
| Changes              | `AssignmentChanges.vue`, `assignment-history.ts`, native `change_history.rs` | Recorded contents and lazy historical reads, flat workspace-relative paths, bounded comparisons and explicit unavailable/uncertain states.                                  |
| Reuse and management | `plugins/types.ts`, `plugins/runtime.ts`, `PluginManagement.vue`             | Required dependencies, explicit exports and declared consumers; dependent disabling is durable and provider re-enabling is not consumer resumption.                         |
| Workshop             | `client/workshop/src/plugins/`                                               | Synthetic assignment/transcript/Changes scenarios remain independent of product integration and native qualification.                                                       |

## Behavioral boundaries

### Same access, different instructions

- Development uses the original workspace, not a mandatory copied workspace or a single-plugin directory as its working scope.
- Workspace writing, navigation, available shell access and enabled plugin tools follow the same capability and task-scope rules as ordinary chat. Connections may also execute local programs through the general process host on supported platforms, without a command confirmation, retaining bounded output and duration, cancellation and the existing activation drain. Capability absence, OS restrictions and recovery still apply equally. Process checks use exact synthetic command results, never local execution.
- Development instructions guide discovery, reuse, testing and restrained changes. They do not grant unrelated edits, another workspace's access or authority for unrelated external effects.
- The default is to finish a connected assignment in its existing development conversation. Avoid automatic child-chat fan-out; this is workflow guidance, not an access denial based on conversation type.
- Automated checks use synthetic fixtures and temporary test state. Equal workspace access does not make real external writes acceptable as incidental tests.
- Closing a pane does not stop work. Workspace closure and application quit retain their existing execution boundaries. Reopening interrupted work waits for user input.

### Selected interface decisions

- The development file panel is **Changes only**. Workspace browsing remains in the existing Files feature; there is no second Files tab or development-specific workspace browser.
- Changes is an advanced inspection feature: a flat list of changed files with paths relative to the Situate workspace root, including `.situate/` plugin source paths. It is not grouped by connection, plugin or inferred purpose.
- Selecting a file opens a Git-like source diff derived directly from recorded before/after contents. Do not add AI explanations, semantic change summaries, inferred effects or required explanatory metadata. Markdown uses source diffs too.
- The list and comparison must remain usable for many changed files and long files. Search, keyboard navigation, progressive rendering and an expanded list/detail layout may support that goal without introducing a package dashboard.
- Development conversation content reuses ordinary chat's messages, Activity, tool calls and content-change rendering. Only the development background and header label differ visually; retain the same chat interaction conventions.
- Connection discovery, reuse, checks and activation remain real operations with ordinary tool results and messages. They do not require a separate package/outcome component or interpretation layer in Changes. Inspecting unchanged dependencies does not add them to the changed-file list.

The diff-only decision applies to the inspection panel, not to withholding actionable errors or setup instructions from ordinary chat and connection settings. The Changes panel has no separate plain-language interpretation layer.

### Workspace scope is not activation scope

Plugin source preparation and publication remain separate from executing code. Shared plugin infrastructure, available under the same rules to both conversation types, should capture and check explicit code revisions before making them active. Ordinary workspace writes retain their normal history and durability semantics; they are not silently held until plugin activation.

A package list associated with an assignment or activation is bookkeeping, not an allowlist defining what the conversation may access. The agent can discover another affected package during work.

Checked activation contract:

1. Identify the related package revisions and unchanged dependency revisions used by checks.
2. Check connection exports and affected consumers together, including existing behavior relevant to the change.
3. Keep active versions available during preparation. Wait for affected in-flight actions rather than aborting or repeating them.
4. Publish the checked package revisions together, without exposing incompatible intermediate versions. Editing a checked candidate invalidates its evidence.
5. Preserve enough durable state to distinguish not activated, activated and interrupted/uncertain publication after restart. Do not retry activation blindly after a post-activation notification failure.

Editable code and immutable execution revisions share Git-owned package history. Group publication records an attempt and atomically replaces the active map; inspection must not finish or roll back an uncertain attempt automatically. This is not a full workspace transaction or a universal data migration engine. Ordinary workspace edits may already be durable when plugin activation fails; the UI must make that distinction. Shared source/check services must not become an alternative development-only sandbox.

Concurrent conversations remain permitted, including overlapping packages. Do not introduce edit locks, a development queue, automatic merging or a conflict-free guarantee. Exact checked publication and honest change attribution are separate concerns from preventing competing assignments from overwriting one another. Reconcile dependency changes during the check-to-activation interval explicitly; do not quietly add a new base-version rejection policy contrary to the existing concurrency decision.

### Connections and platform support

- Keep connections within the plugin package/runtime model rather than creating a second extension engine.
- Use declared required dependencies and explicit exports. Begin with concrete local plugin dependencies; interchangeable provider discovery and optional dependencies are later work.
- Account setup and credentials belong to the connection. Consumers invoke its functionality without copying credentials into code, fixtures or UI metadata. Runtime availability distinguishes installed code from usable access.
- The host supplies generic discovery, invocation, lifecycle and availability mechanisms, not a built-in Apple Notes or mail domain model.
- A connection owns its public interface and platform implementations. Consumers depend on functions, not on AppleScript, native bridge calls or another implementation detail.
- Implement and qualify macOS only. Preserve a route to function/view-level platform declarations and effective availability derived from required dependencies. A portable view is not usable when its required connection function is unavailable.
- Distinguish unsupported platform, not implemented, missing permission/account access and failed operation. Do not infer iOS support from JavaScript portability or source synchronization.
- Add native host functionality only for a concrete integration. No general native SDK or assumed iOS equivalent is required.

## Implementation sequence

### 1. Align requirements and settle the shared publication contract

Update the catalog before changing enforcement. Preserve requirement IDs and existing acceptance-criterion IDs; add or split criteria where necessary rather than rewriting historical delivery evidence as if it covered the new behavior.

| Source                                           | Alignment needed                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-0001                                         | Assignment-based handoff, connection discovery/reuse, multi-package work and ordinary workspace access. Keep an existing-plugin entry as context only.                                                                                                                                                                             |
| REQ-0033                                         | Replace development-only read-only-original/copy assumptions for this milestone. Separate conversation access, optional code staging, synthetic checks, grouped publication and ordinary workspace edits. Specify retained work and cleanup without deleting live workspace content. Preserve concurrency and lifecycle decisions. |
| REQ-0017                                         | Keep standalone package inspection; add assignment-wide source diffs without a second workspace browser, semantic summaries or inferred authorship.                                                                                                                                                                                |
| REQ-0032                                         | Connection status, consumer relationships, affected dependents on disable and independent development entry points.                                                                                                                                                                                                                |
| REQ-0014                                         | Assign macOS availability work explicitly; retain later function/view-level portability without claiming iOS delivery.                                                                                                                                                                                                             |
| Foundations and plugin strategy/runtime chapters | Remove conflicting mandatory development-copy boundaries, distinguish normal writes from checked publication, and align lifecycle/cleanup descriptions.                                                                                                                                                                            |

Align REQ-0040 with shared normal/development transcript rendering: implementation writes remain in Activity, while note and working-instruction changes keep their normal visible presentation. No development-only package dashboard or semantic diff summary is required.

Keep editable package source in its code directory and load active revisions from the same stable Git history. Preserve interrupted publication evidence rather than automatically repairing it. Relevant source/dependency drift invalidates checks; an explicit restoration is per package and never authorizes dependency rollback.

**Exit:** consistent requirements and an explicit publication contract, with deferred migrations and portability still visible.

### 2. Generalize conversations and remove mode-only access restrictions

- Change TypeScript and Rust conversation serialization together, including validation, summaries, handoff persistence and origin notices.
- Make assignment/context sufficient to start development. A selected package may be included as initial context, not as a required target.
- Move normal/development capability composition onto shared rules; update frontend and native enforcement together. Preserve selective recovery suspension in both modes: requested previews, executable checks and checked activation remain available, while unrelated installed plugins stay suspended until resumed.
- Replace fixed-plugin prompt instructions with discovery, impact analysis, shared interface reuse and appropriate verification guidance.
- Read existing development records and retain their conversation, origin and pending draft. Define a versioned conversion or compatibility reader; never silently drop old drafts or auto-activate them on opening.
- Keep handoff start-once behavior and explicit continuation after interrupted/failed handoffs.

Primary areas: `client/app/src/ai/`, `client/app/src-tauri/src/ai.rs`, `client/app/src-tauri/src/plugin_development.rs`, and conversation storage in `client/crates/situate-core/src/`.

**Exit:** one conversation can legitimately work across several packages and ordinary files with normal-chat capabilities, while an old one-package conversation remains readable and resumable.

### 3. Add reusable connections and coordinated package changes

- Extend manifest validation, plugin inspection and runtime services with explicit required dependencies, exports and availability metadata. Reject missing or cyclic required dependencies with useful explanations.
- Expose existing connections, available functions and declared consumers to the agent before creation or interface changes. Include disabled or unavailable installations as inspectable context, not executable tools.
- Implement shared invocation, connection-owned access and consumer-specific account choices where applicable.
- Generalize candidate/check/publication operations to explicit related package revisions. Include deliberately changed consumers and use unchanged dependencies in checks without treating them as modified.
- Coordinate publication, restart recovery, availability refresh and origin notification. A failed check must not publish only the successful half of a coupled change.
- Apply dependency availability to views/tools and existing disable/re-enable behavior. Missing access blocks dependent operations, not source editing or independent synthetic checks.

Primary areas: `client/app/src/plugins/`, plugin tools in `client/app/src/ai/`, `client/app/src-tauri/src/plugin_{development,drafts,checks,runtime,host}.rs`, and `client/crates/situate-core/src/plugins/`.

**Exit:** a connection and consumer can be developed together, then a second consumer can reuse that connection without duplicated setup.

### 4. Add trustworthy change inspection and adopt the approved UI

- Record affected file identity, before/after revisions and operation outcomes through existing write/history paths, associated with conversation/run where supported. A workspace-wide before/after diff alone cannot attribute parallel work to one conversation.
- Shell and independently observed changes must retain the uncertainty of their attribution. Label them separately rather than claiming the conversation authored every observed change.
- Keep recorded revision pairs independent of current workspace contents. Preserve historical comparisons when another conversation later edits the same file; disclose unavailable history rather than comparing unrelated versions.
- Adopt the Changes-only panel: flat workspace-relative file paths and Git-like source diffs, without package grouping or semantic explanations. Compute comparisons from captured contents rather than requiring generated prose or domain knowledge.
- Support large change lists and long diffs with bounded comparison/rendering work, path search, keyboard navigation and narrow/expanded layouts. Retain access to unchanged diff context; a separate full-file viewer is not required in this panel.
- Leave workspace browsing in the existing Files feature. Keep installed-plugin inspection scoped to its selected package; neither becomes an additional mode in Changes.
- Reuse ordinary chat's transcript components for messages, Activity, tool calls and content changes. Keep only the development background/header distinction; do not introduce a custom package/outcome dashboard.
- Distinguish pending code, active code and already-written workspace content through ordinary operation results, messages and applicable management surfaces. Define cleanup of unactivated candidates without erasing ordinary edits, active packages or retained history.
- Keep conversation type fixed, use assignment-oriented titles, and report related outcomes without automatically resuming the originating request.
- Update central English/German product catalogs, help and accessibility labels. Do not import workshop components or styles into production.

**Exit:** the user can inspect file diffs across a multi-package assignment, review actionable operation results through normal chat presentation, and return from inspection without losing navigation or draft state.

### 5. Qualify the end-to-end milestone

Use synthetic fixtures for automated checks and a disposable native workspace for qualification. Demonstrate one real supported macOS integration after its access feasibility is established.

The milestone requires connection creation plus a first consumer, reuse by a second consumer, and a shared-interface change affecting existing consumers. Also demonstrate an assignment spanning multiple connections/plugins and an ordinary workspace edit. A single successful generated view is insufficient.

## Product Designer handoff

### Surfaces and deliverables

Use the existing assignment scenarios and the selected diff-only direction. The workshop already contains a multi-package simulation, shared normal/development transcript rendering and a flat Changes panel. Their presence does not settle production storage or prove every scenario's acceptance behavior.

Preserve these interface boundaries during further design work:

- **Changes** lists recorded added, modified, deleted and renamed files using flat workspace-relative paths, including `.situate/plugins/…/code/`. It shows file operations, not package roles, dependency inventories or semantic interpretations.
- Clicking a file opens a Git-like source diff with added/removed lines, useful context and rename paths. Missing historical contents must not be replaced with current contents. No AI summary, required explanation field, rendered Markdown comparison or separate full-file viewing mode is needed.
- Keep large reviews usable with path search, keyboard navigation, bounded rendering and a layout that can show file list and diff together. Preserve selection, search and independent scroll positions when returning from detail or closing/reopening the panel.
- At narrow desktop widths, switch between chat and inspection without losing the message draft. Workspace browsing stays in the main Files feature, not a second panel mode.
- Distinguish loading, failed retrieval, no recorded changes, unavailable historical revisions, unsupported previews and uncertain authorship using factual feedback rather than inferred explanations.
- Use the same normal/development message, Activity, tool-call and content-change components. Do not restore a custom package overview to make the development transcript structurally different.

Complete assignment-oriented titles/help, connection readiness/platform reasons, grouped check/activation outcomes and cleanup language through normal chat/tool presentation and relevant management surfaces. Reuse/discovery can be demonstrated with actual tool inputs/results and ordinary messages; it does not require a fixed explanatory narrative or an unchanged-package section in Changes.

Remaining scenario work to validate separately from the selected layout:

- Reuse and discovery should be observable through ordinary tool details or messages, even though unchanged dependencies do not appear as changed files.
- A failed consumer check should identify the affected plugin and a concrete failure in its normal result, without a new dashboard.
- A local connection that needs OS permission rather than account login needs an appropriate synthetic setup path if the first integration uses that access model. The selected diff/chat design does not decide this flow or establish a real native API.

### Existing entry points and state behavior

IDs below are current starting-state IDs, not new top-level screens. Preserve existing URLs and validate their fixtures against these behaviors.

| Existing IDs or flow                                                                           | Required adaptation                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins-create`                                                                               | Start from an assignment without a required package/type choice. An optional selected package is context only.                                                                                           |
| `plugins-development`                                                                          | Replace the one-package fixture with a related connection and consumer; allow another affected package to appear during the conversation. Show assignment-wide inspection.                               |
| `plugins-interrupted`                                                                          | Retain assignment, affected packages and recorded changes. Reopening does not resume work automatically.                                                                                                 |
| `plugins-error`                                                                                | Identify the failing package/check in an ordinary tool result or message and retain the whole assignment; distinguish code checks from access setup failures.                                            |
| `plugins-success`                                                                              | Report activation/access outcomes through normal chat presentation, separate active code from saved workspace edits, retain the conversation and keep recorded diffs inspectable.                        |
| `plugins-general-error`                                                                        | Keep the unexpected storage/load error path, but remove assumptions that failure belongs to one plugin draft.                                                                                            |
| `plugins-source-create`, `plugins-source-error`, `plugins-source-success`, `documents-connect` | Use the same assignment-based development flow for document-source entry points. A source request may require a connection and multiple consumers. Preserve prepared context and return navigation.      |
| `plugins-list`, `plugins-connections`, `plugins-empty`                                         | Creation/adaptation enters the shared development flow. Connection cards expose consumers and actual readiness; separate connection development does not require another chat type.                      |
| `plugins-connection-empty`, `plugins-connection-error`                                         | Preserve account setup/reconnect behavior; distinguish usable code from missing access. Do not present successful code generation as successful authentication.                                          |
| `plugins-disabled` and dependency-disable dialogs                                              | Show all affected consumers, including indirect dependencies. Preserve explicit dependent re-enabling rather than silently restarting everything.                                                        |
| Development file panel and help                                                                | Use Changes-only file diffs and ordinary access semantics. Help describes Changes and directs workspace browsing to the existing Files feature.                                                          |
| Retained-work list and discard dialog reachable from development                               | Retain only meaningful pending code/check storage. Separate stopping work, removing unactivated candidates and reversing durable edits; ordinary workspace content must not be deleted as draft cleanup. |

### Existing states to preserve

- `plugins-files`, `plugins-files-loading`, `plugins-files-error` and `plugins-files-empty` currently exercise **standalone installed-plugin inspection**. Keep that single-package use case and its independent navigation state. Keep assignment-wide diff inspection separate rather than repurposing these URLs.
- Preserve connection account-selection behavior, source settings/status, illustrated-card alternatives and unrelated document-source experiments. Apply changed development entry behavior where they link to it without redesigning the rest.
- Keep a single-package development fixture as a valid subset of the generalized model, not as its structural limit.

### Assignment starting states

The following IDs are registered in the workshop. Their acceptance behavior below follows the selected interface decisions; registration alone does not establish complete coverage. Keep them under existing development, plugin-management or settings screens and use live controls for outcomes rather than adding a top-level scenario for every status.

| Starting-state ID                        | State and interaction to demonstrate                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugins-development-connection-only`    | Create a reusable connection with chat tools and no consumer view. Later open its independent adaptation entry.                                                                                                                                  |
| `plugins-development-reuse`              | Discover an existing connection and add a second consumer without duplicate setup or edits to the connection.                                                                                                                                    |
| `plugins-development-missing-connection` | One assignment discovers missing access code, creates a connection and a view, and exposes both in inspection.                                                                                                                                   |
| `plugins-development-shared-change`      | Extend a connection interface. Ordinary discovery/check results identify relevant dependencies and consumers; Changes contains actual edits only. A control fails one named consumer check.                                                      |
| `plugins-development-system-change`      | Several connections/plugins and an ordinary workspace file change within one assignment. The affected set grows during work.                                                                                                                     |
| `plugins-development-parallel`           | Two independent development conversations remain usable. Shared-file changes retain attributable revisions; uncertain observations are not labeled as certain authorship. No locking/merge guarantee is implied.                                 |
| `plugins-development-changes`            | Flat workspace-relative A/M/D/R file list and Git-like source diffs, including Markdown and `.situate/` paths. Exercise large lists, long files, expanded/narrow layouts and empty/loading/error/unavailable history without semantic summaries. |
| `plugins-development-workspace-files`    | Retained legacy entry URL for Changes, not a Files-tab scenario or a requirement for development-specific workspace browsing. Include unsupported comparison feedback among the Changes outcomes.                                                |
| `plugins-development-activation`         | Checks ready, waiting for affected actions, publication failure, interrupted publication and activated-with-notification-failure. Ordinary workspace edits remain visible independently.                                                         |
| `plugins-development-access-needed`      | Checked connection code exists but real use requires permission/account setup. Canceling setup preserves work and does not claim readiness.                                                                                                      |
| `plugins-connection-platform`            | macOS availability and an explicitly hypothetical unsupported-iOS comparison. Missing implementation, missing permission and unsupported API are distinct outcomes, not equivalent errors.                                                       |

### Remove or retire

No existing top-level scenario or starting-state ID needs deletion solely because of this change. Remove the obsolete **behavior** from current fixtures and controls:

- A mandatory single package/type at development start.
- Development title, progress, file tree and outcome derived exclusively from one plugin.
- Claims that ordinary workspace content is always read-only or that every development runs in a complete workspace copy.
- Mandatory per-package child chats or a confirmation step merely to expand the affected package list.
- Discard/cleanup language implying all assignment effects are temporary or automatically reversible.
- Single-target adoption controls as the only possible success path.
- A second Files tab or development-wide workspace browser in the Changes panel.
- Grouping the change list by connection/plugin, inferred purpose or generated explanation.
- Semantic summaries, explanation metadata and rendered before/after prose as prerequisites for source diffs.
- Custom package/outcome components replacing ordinary messages, Activity and tool-call rendering.

If duplicate presets are consolidated, preserve old IDs as aliases to the relevant state and update links/tests. Remove obsolete screenshot references only after reviewing the replaced checkpoints. Do not delete standalone package inspection or unrelated artwork comparisons.

### Workshop implementation map and review gate

Use `client/workshop/src/plugins/model.ts`, `assignment-model.ts`, `assignment-files.ts`, `assignment-diff.ts`, `AssignmentFiles.vue`, `PluginDevelopment.vue`, `PluginView.vue` and `PluginsControls.vue` for the assignment simulation and diff inspection. Shared conversation presentation lives in `client/workshop/src/chat/ChatTranscript.vue`, `development-transcript.ts` under `plugins/`, and their styles/tests. Preserve `PluginCodeBrowser.vue` and its model for standalone installed-package inspection. Update `src/workshop/scenario-catalog.ts`, `simulation.ts` and `screen-controls.ts` for state registration and controls. Keep workshop copy in its localization catalogs; revise `src/localization/en.plugin-development.json` and the plugin README when their described behavior changes.

Extend model/component tests and existing browser flows in `client/workshop/tests/browser/workshop-plugin-chat.spec.ts`, `workshop-plugins.spec.ts`, `workshop-plugin-files.spec.ts`, `workshop-plugin-collection.spec.ts` and `plugin-sources.spec.ts` rather than cloning a separate test application.

Review at wide and narrow macOS window sizes. An iOS profile is only a forward-looking availability/layout study, not native qualification. Verify shared transcript behavior/styles, keyboard-only operation, focus return, long paths/titles, hundreds of changed files, distant edits in long files, error states and preserved drafts.

**Design approval gate:** a reviewer can locate changed files by workspace-relative path, inspect the recorded source diff and return without losing state. The panel works without generated explanations or a package inventory. Development chat content uses the normal transcript presentation, while ordinary results/settings communicate actionable failures, access requirements and activation outcomes. Review unresolved state behavior before product adoption.

## Verification plan

| Boundary                      | Essential evidence                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability parity             | With identical workspace/device/recovery conditions, development and ordinary chat receive the same operational access and task-scope requirements. Test frontend composition and native enforcement, not prompt text alone.                                                                               |
| Persistence and compatibility | Legacy single-plugin records/drafts remain recoverable; new assignments retain multiple targets across restart; failed handoff does not duplicate development.                                                                                                                                             |
| Dependency reuse              | One connection serves two consumers; account choices remain independent; missing/disabled/cyclic dependencies report accurate blockers.                                                                                                                                                                    |
| Shared changes                | A failed consumer check prevents incompatible partial publication. Successful publication uses the checked revisions and does not repeat in-flight actions. Inject interruption at publication boundaries.                                                                                                 |
| Change inspection             | Use independently specified revisions for multi-package and normal-file edits, rename/delete, later edits by another chat and uncertain shell observations. No unrelated work is falsely attributed.                                                                                                       |
| Lifecycle and cleanup         | Pane closure keeps work running; workspace closure/quit stops it; restart waits for input. Cleanup preserves live files, activated code and history. Recovery suspends installed plugins at startup; requested checks/previews and checked activation remain available without resuming unrelated plugins. |
| Access and platforms          | Missing permission differs from missing implementation. macOS-only dependencies make dependent operations unavailable on unsupported platforms without losing source or claiming iOS support.                                                                                                              |
| Product UI/native integration | Exercise assignment handoff, shared normal/development transcript rendering, Changes-only source diffs at large/narrow sizes, failure, reuse and activation in product browser tests, then the real macOS host in a disposable workspace. Workshop passes are not product integration evidence.            |

Use `node tools/test.mjs --unit --changed` for initial feedback and the relevant focused suites as implementation progresses, with Volta shims first on `PATH`. Workshop changes require their affected model/browser checks even though broad workshop sweeps are opt-in. Run app/workshop type checks and builds for their respective changes. Product visual changes follow the locked-container update/check and PNG-review workflow in [testing.md](testing.md#visual-regression-tests), reusing product browser flows and meaningful checkpoints.

Before a pull request, run `node tools/test.mjs` without profile/change filters and report unavailable prerequisites, failures and relevant checks not run. macOS plugin qualification does not imply iOS plugin support or exhaustive extended-scope coverage.

## Explicitly deferred and unresolved

Deferred: iOS connection implementations/native qualification, marketplace, optional dependencies, interchangeable provider resolution, automatic agent fan-out, conflict-free concurrent development, full-workspace transactions and a universal data migration framework. Incompatible data changes are not silently treated as ordinary code activation; they need their existing migration requirements resolved before use.

Boundaries beyond this delivery:

1. Connections can use the general local process host instead of requiring a service-specific core API. Native-app automation, including Apple Notes through OS scripting tools, still needs verified access, OS permission handling and distribution review. Neither public GitHub GET qualification nor the presence of a shell establishes usable Notes access.
2. Authenticated services need their own access/setup UI and real account qualification. The generic host does not prescribe an account schema or claim that enabled code has usable access; synthetic credential fixtures do not establish a real login.
3. Cleanup does not reverse shared source or ordinary workspace edits. Those are durable content, not temporary candidates; reversals use explicit history recovery. Legacy drafts remain readable until confirmed removal, which preserves their conversation for workspace-wide continuation.
4. Concurrent external writers and unsupported historical formats retain their existing limits. Recorded references and uncertain observations do not establish conflict-free author attribution; absent history is not reconstructed from current files.
5. Native iOS availability wiring and qualification remain deferred. macOS checks do not establish iOS plugin/native connection support.
