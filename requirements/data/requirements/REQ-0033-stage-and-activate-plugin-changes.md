---
id: REQ-0033
type: requirement
title: Stage and activate related plugin changes without interrupting active work
status: approved
priority: must
area: Integrations
goals: [GOAL-0001, GOAL-0004]
acceptanceCriteria:
  - id: AC-01
    text: "Ordinary changes that preserve data compatibility can be checked and adopted without adding universal data schemas, exclusive note ownership or migration metadata."
    status: open
  - id: AC-02
    text: "Existing relevant tests are reused and focused checks cover changed behavior and known affected consumers; missing required coverage is not reported as passed."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-03
    text: "While a replacement is being developed and tested, another chat can continue using the existing active plugin version."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-04
    text: "A change to a shared interface and its affected consumers is staged and checked together, including checks of their established behavior."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-05
    text: "A failed required functional or compatibility check prevents activation of the plugin change set; existing versions remain active. A failed local security review instead follows the warning and explicit user-override rules in REQ-0021."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-06
    text: "After checks pass, activation waits for already-running affected actions to finish; those actions are neither aborted nor repeated for the update."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-07
    text: "The checked change set becomes active together rather than exposing a mixture of old and new affected versions."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-08
    text: "A long-running affected action can delay activation without being forcibly restarted."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-09
    text: "A requested change-set rollback preserves later independent changes and records compensating changes; conflicting reversals are shown for a user decision instead of silently overwriting newer work."
    status: open
  - id: AC-10
    text: "Starting development opens a separate, visibly distinct conversation with the prepared task and development instructions; the original chat remains accessible."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-11
    text: "A blocked development handoff preserves its assignment and context for explicit retry and explains the actual blocker; unavailable durable retention is disclosed without claiming work has started."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-12
    text: "Extended migration preparation and user clarification do not hold affected actions or writes paused throughout an agent conversation."
    status: open
  - id: AC-13
    text: "The agent has a tool for opening that development conversation with context, without a fixed trigger phrase or mandatory extra entry approval."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-14
    text: "Plugin files can be read alongside development, without requiring direct editing controls."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-15
    text: "Development operates in the same workspace as ordinary chat; a workspace copy or a single-plugin directory is not a mandatory access boundary. Prepared source changes do not replace active plugin versions until checked activation."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-16
    text: "A disabled or temporarily suspended plugin can execute in development without activating its installed version before adoption, including after recovery startup."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-17
    text: "After recovery startup, the ordinary development workflow permits source repair, previews, executable checks and checked activation. Activation resumes only the target plugin; unrelated suspended plugins remain suspended."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-18
    text: "A failed or interrupted host-view check leaves development retained and completion unresolved. Restart does not replay the check or automatically activate the candidate; staging is not UI-failure isolation."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-19
    text: "Automated tests use synthetic fixtures and separate temporary test configurations, including for dependencies; ordinary workspace access does not authorize mutating real content as incidental test data."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-20
    text: "Trial instructions prohibit incidental writes to real external services; account access is not presented as technically sandboxed and task scope and configured access remain applicable."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-21
    text: "Personal content and credentials are absent from generated code and automated test fixtures."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-22
    text: "Activation publishes the checked plugin code and deliberately adapted dependencies, not test fixtures or trial results. Ordinary workspace edits retain their normal durability independently of activation; successful activation can enable the developed plugin even if previously disabled."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-23
    text: "After activation, final read-only verification checks the attributable activated state before completion and cleanup. Later independent edits are neither overwritten nor mistaken for the checked output."
    status: open
  - id: AC-24
    text: "Failed, unavailable or interrupted final verification retains an unresolved development and its known adoption outcome; resumption does not repeat activation or migration. Checks before publication remain mandatory."
    status: open
  - id: AC-25
    text: "Closing a development view leaves its ongoing work running and visible in the conversation list; it neither discards nor pauses development."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-26
    text: "Incomplete assignments retain their context, affected packages and recorded changes for user-requested continuation without automatic expiry. The MVP has no development-storage display or manual cleanup capability; leftover development artifacts may accumulate without a retention limit."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-27
    text: "Internal check completion and release remove only disposable candidate/check state and retain the conversation. Stopping development does not reverse durable workspace edits or previously activated code."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-28
    text: "Cleanup preserves live workspace content, configurations, adopted revisions and their recovery histories; disposable trial-only histories may be removed with their temporary state."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-29
    text: "References to removed temporary trial content retain their identities and report unavailable content; they never resolve against live files or a later trial."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-30
    text: "Application quit leaves no development work running; after reopening, interrupted development waits for a new user instruction."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-31
    text: "Incompatible data changes provide migration paths and dependencies within the six-month app-version compatibility policy, without indefinite retention. Delayed changes from supported older formats are converted without reconverting already-migrated data; unavailable conversion support is explained without incompatible execution or deletion of received data."
    status: open
  - id: AC-32
    text: "Migration is checked against a separate state of current original data, with affected actions drained and affected new writes paused; code and compatible data are published together recoverably."
    status: open
  - id: AC-33
    text: "A device lacking compatible plugin or data-format support retains data, blocks affected execution and writes, and explains the missing support without disabling unrelated compatible functions."
    status: open
  - id: AC-34
    text: "Divergent source revisions under the same declared version require user selection; the other revision remains recoverable in history and any later adoption is checked."
    status: open
  - id: AC-35
    text: "Missing account credentials leave source editing and otherwise available synthetic tests usable; account-dependent trials explain the need for renewed authentication."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-36
    text: "Plugin development uses a plugin draft separate from the active installation, without creating or managing a complete development workspace copy."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-37
    text: "The agent checks the draft before activation. Mutating tests use temporary test data rather than writing trial results into the original workspace."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-38
    text: "The checked plugin draft can be activated within the requested development scope without an additional activation confirmation or a mandatory post-activation agent verification phase; trial data is not adopted."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-39
    text: "Multiple development conversations may run concurrently in one workspace, including against the same plugin. Starting or activating one is not blocked, queued or rejected because another development exists or has changed that plugin."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-40
    text: "Concurrent same-plugin development has no edit lock, base-version conflict gate, mandatory reconciliation or automatic merge. Overwritten changes and interference are accepted outcomes rather than a promised conflict-free workflow."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-41
    text: "A developed plugin can supply skills that guide the agent during conversation."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-42
    text: "A developed plugin can register chat tools that the agent invokes to perform the plugin's functions."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-43
    text: "A developed plugin can provide its own Vue view that users open and use within Situate."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-44
    text: "A developed plugin can provide settings that users inspect and change through its settings view."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-45
    text: "Plugins can use existing host functionality for workspace files, network access, credentials and navigation without a separate plugin permission layer."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-46
    text: "Plugin writes to Situate-owned content use the existing versioned write interfaces, and actions with external effects execute within the requested task without per-action approval."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-47
    text: "Before activation, the manifest is validated and the plugin is checked for successful loading."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-48
    text: "Before activation, the agent tests the requested function using checks selected for that plugin and fixes detected errors. No uniform test suite or coverage threshold is required for every plugin."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-49
    text: "For plugin views, the agent can use previews, interaction and screenshots to check the requested behavior."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-50
    text: "Local plugin development does not require a separate security review or a general compatibility matrix before activation."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-51
    text: "After successful checks, the agent activates the plugin without another user confirmation or an application restart."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-52
    text: "Existing chats use the newly activated plugin version from their next agent run; activation does not interrupt a running response."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-53
    text: "Already open views of an updated plugin reload on activation. Unsaved view state may be lost; state transfer between old and new view instances is not required."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-54
    text: "After failed development, the development conversation and plugin draft remain available so the user can request further work in that conversation. No separate development-state dashboard is required."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-55
    text: "Users can request plugin repairs through chat using the ordinary development workflow, without a dedicated repair process or automatic repair."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-56
    text: "The Plugin Launchpad workflow works in the macOS application, including plugin development, checks, activation, chat use, views, settings, management and plugin-free recovery. Other desktop and mobile platforms are not required for this milestone."
    milestone: Plugin Launchpad
    status: implemented
  - id: AC-57
    text: "Within identical workspace, device and recovery conditions, both conversation types use the same capabilities, shared source/check facilities and task-scope rules; an assignment's affected-package list is not an access allowlist."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-58
    text: "Checks identify the code and required dependency revisions they cover. Editing checked code requires fresh applicable checks before activation; grouped activation must not claim coverage for different revisions."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-59
    text: "An interrupted or failed activation remains distinguishable from a confirmed activation. Missing acknowledgement or a failed originating-chat notification is not proof that nothing activated and does not authorize blind repetition."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-60
    text: "Ordinary workspace writes remain durable and recoverable when code checks or activation fail; completion, failure and cleanup feedback distinguishes those edits from unactivated candidates."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-61
    text: "Workspace closure stops development like ordinary chat; reopening retained work waits for user interaction rather than replaying checks, activation or external actions."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-62
    text: "Existing single-plugin development records and pending drafts remain recoverable with their conversations and origins; opening retained work neither silently drops it nor automatically activates it."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-63
    text: "Process-backed connection checks use plugin-specific, exact executable/argument fixtures without starting local programs; missing or ambiguous fixtures fail closed. Synthetic success does not establish that a real executable, script or OS permission works."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-64
    text: "Connection process commands execute directly without a per-command confirmation or preceding user gesture, including development, initialization, standalone views and export requests. Cancellation, stale context or workspace closure blocks execution; running work remains covered by the existing activation drain. External effects execute within the requested task without per-action approval."
    milestone: Workspace-wide development with reusable connections
    status: implemented
  - id: AC-65
    text: "Connection processes have bounded output and duration, share workspace draft and mutation coordination, and retain native execution ownership until process cleanup finishes. Nonzero exit, cancellation, timeout and failed history reconciliation are not reported as success or as proof that external effects were undone."
    milestone: Workspace-wide development with reusable connections
    status: implemented
---

## Description

### First iteration: Plugin Launchpad

Plugin Launchpad delivers a separate development conversation with the prepared assignment and context. The agent creates or edits a plugin draft separately from the active installation, checks it and activates the checked result. The originating chat remains usable and receives the availability notice defined in REQ-0001. Mutating tests use temporary test data; a complete workspace copy and its independent lifecycle are not required. A mandatory read-only agent verification after activation is not part of this iteration.

Plugin Launchpad supports plugin-owned skills, chat tools, custom Vue views and plugin settings. These capabilities follow the existing contribution descriptions in [REQ-0001](REQ-0001-create-integrations.md), [REQ-0029](REQ-0029-use-integration-tools-in-chat.md), [REQ-0026](REQ-0026-provide-plugin-defined-views.md) and [REQ-0032](REQ-0032-manage-plugin-status-and-disabling.md). Dependencies between plugins, automation and extensions to arbitrary host interface regions are outside this iteration. This milestone targets macOS only, including development, checks, activation, plugin use, management and plugin-free recovery. Windows, Linux, iOS and Android delivery and qualification are deferred. This is a delivery boundary, not a rejection of the longer-term cross-platform requirements in [REQ-0014](REQ-0014-plugin-platform-compatibility.md).

Plugins reuse existing host functionality for workspace files, network access, credentials and navigation. No additional plugin permission layer is required. Existing versioned-write interfaces, task scope and configured access remain applicable. Specialized host functionality is added only for a concrete use case; this iteration does not require a general-purpose SDK covering anticipated future capabilities. Exact API signatures are implementation decisions within this scope.

Before activation, the manifest must be valid and the plugin must load successfully. The agent chooses appropriate tests for the requested function and fixes detected errors before activation. For views, previews, interaction and screenshots are available as checking tools; using all of them for every plugin is not mandatory. There is no separate security-review gate, general compatibility matrix, uniform test suite or prescribed coverage threshold for local plugin development in this iteration. This scope does not change the later marketplace-adoption security checks in REQ-0021.

After successful checks, the agent activates the plugin without another user confirmation or an application restart. Existing chats use the new version from their next agent run; running responses are not interrupted for activation. Already open views of the updated plugin reload, accepting loss of unsaved view state. No state-transfer mechanism between old and new versions is required. This first-iteration activation behavior does not require the longer-term coordinated change-set transition described below.

Management uses the established Settings design and applicable criteria in [REQ-0032](REQ-0032-manage-plugin-status-and-disabling.md#first-iteration-plugin-launchpad), not a separate simplified plugin list. Failed development remains a development conversation with its draft, where users can ask the agent to continue. Repairs use ordinary chat requests and the same development workflow; a dedicated repair process, automatic repair and a separate development-state dashboard are not required. The general direct-from-error entry point in REQ-0063 remains outside this iteration. Plugin-free startup initially suspends installed plugins while retaining management and the ordinary development workflow. Users can resume plugins individually or all together without restarting; checked development activation resumes its target only.

Only criteria explicitly assigned to Plugin Launchpad define that milestone’s delivery evidence. Workspace-wide development with reusable connections adds the open criteria below without extending those implementation claims. Mandatory workspace copies are no longer the target; migration and unassigned portability criteria remain outside this milestone.

### Concurrent development

Users may run multiple development conversations, including for the same plugin. Situate does not serialize these conversations, lock a plugin for editing, queue competing developments, reject activation because its base version changed, or require reconciliation between them. Concurrent work may interfere with or overwrite other development changes; users accept this risk when starting overlapping work. No automatic merge or conflict-free concurrent-development guarantee is required. Draft separation from the active installation does not promise isolation between competing developments.

This boundary applies to overlapping local development, not to the separate rules for synchronized source divergence, explicit rollback or task scope.

### Workspace-wide development with reusable connections

Development uses the same workspace, tools, navigation, available shell access and enabled plugin functionality as ordinary chat under identical device, permission and recovery conditions. Specialized instructions guide discovery, reuse and testing without imposing a development-only access restriction. Assignment scope may grow to include related packages and ordinary files; it is neither a single-plugin allowlist nor a requirement for child conversations. Ordinary workspace edits use normal versioned writes and become durable independently of plugin publication. Source preparation, checks and active code revisions remain distinct; no full-workspace transaction is promised.

Editable package source and immutable checked/active revisions use the same Git-owned package histories. Grouped publication records an attempt and replaces one active revision map; an uncertain attempt is inspected rather than automatically completed or rolled back. Relevant source or dependency drift requires fresh checks. An explicit restoration applies to its selected package and does not authorize silently rolling back dependencies. This is not a second revision store or a competing-development base-version rejection policy.

### Staged plugin changes

During requested plugin development, existing active versions continue operating, including use by other chats. Versions temporarily suspended by [recovery startup](REQ-0032-manage-plugin-status-and-disabling.md) remain suspended until resumed or replaced through checked activation. Changes to affected integrations and consumer plugins must be staged and tested as a plugin change set, preserving established behavior. The plugin change set must activate together only after its required functional and compatibility checks pass and already-running affected actions finish. Development or activation must not abort or repeat those actions. Long-running actions may delay activation. This activation rule is distinct from the user's explicit choice to abort work for an [application update and restart](REQ-0068-update-direct-desktop-installations.md). An update interruption does not count as completed activation or migration. Native action admission and independent request leases remain closed through publication and the coordinated runtime refresh; chat snapshot lifetimes are not action lifetimes.

The agent may perform this work autonomously within the [requested development scope](REQ-0001-create-integrations.md). Checks include affected consumers and applicable UI behavior; passing tests does not guarantee that all defects are eliminated. The local security review of adopted templates follows [REQ-0021](REQ-0021-adapt-local-plugin-copies.md), including its explicit user choice to proceed after a security warning; that exception does not waive failed functional or compatibility checks. Staging is not an adversarial sandbox or UI-failure isolation. A preview or UI check may execute a Vue view in the host UI under [REQ-0026](REQ-0026-provide-plugin-defined-views.md); faulty code can freeze the application despite code staging or temporary test state. The continued-operation guarantees describe normal development and adoption, not survival of such a hang. Forced restart and plugin-free repair follow [REQ-0032](REQ-0032-manage-plugin-status-and-disabling.md).

Recovery temporarily suspends installed plugins at startup rather than changing the development workflow. Requested development may preview and test code and activate it after successful checks. Activation resumes its target without resuming unrelated plugins or replaying interrupted work. Users may also resume individual plugins or all previously enabled plugins without restarting. Permanently disabled plugins stay disabled on resume-all. Testing or resuming faulty code can freeze the application again.

Ordinary development does not require a universal data schema, versioned data/configuration declarations for every plugin, or exclusive ownership of the notes it uses. The agent inspects existing behavior and known dependencies, reuses applicable tests and adds focused checks for the requested change. Absence of a general format declaration is not itself an adoption blocker; failed or unavailable required checks and identified unresolved incompatibilities remain blocking. Passing checks establish their observed coverage, not compatibility with every possible note structure.

Development uses a separate native-owned conversation with specialized system instructions and a prominent visual distinction from ordinary chat. An agent tool opens that conversation with a prepared task and context, leaving the original conversation available. The agent decides when to offer or start this workflow; no fixed user-phrase trigger or additional entry-confirmation rule is prescribed. Users can start new development or further development of an existing plugin from [plugin management](REQ-0032-manage-plugin-status-and-disabling.md). A read-only Changes panel exposes [assignment-wide source diffs](REQ-0017-inspect-plugin-instructions.md), separate from standalone complete-plugin inspection; direct file editing there is not required. Messages, Activity, tools and content changes use the ordinary chat components; only the background and header label distinguish development.

Errors also provide a [direct repair entry point](REQ-0063-start-assisted-repair-from-errors.md) that opens development with the failure and relevant context. It uses the same staging, checking and activation rules; starting repair does not resolve a conflict or repeat the failed operation.

A blocked development handoff retains its assignment and context for explicit retry, whether from creation, adaptation or error repair. It explains the actual blocker without claiming an agent is running. When durable storage is unavailable, the retained assignment is visibly unsaved and survival across restart is not promised. Copy creation is not a prerequisite for development access.

Automated checks use synthetic fixtures and separate temporary test configurations, including for dependencies. Agent-led investigation can read workspace content and connected accounts under ordinary access rules. Trials must not incidentally write real external services; this instruction is not technical account isolation. Personal content and credentials must not be embedded in generated code or automated fixtures.

The checked code change set activates without an additional mandatory confirmation after affected running actions finish. Successful activation can enable a developed plugin that was disabled or temporarily suspended; unrelated suspended plugins remain suspended. Trial data and test configurations are not published as production data. Ordinary workspace changes may already be durable when checks or activation fail.

Final read-only agent verification after activation (AC-23 and AC-24) remains a longer-term lifecycle requirement, not a prerequisite for Workspace-wide development with reusable connections. In that longer-term workflow, it inspects attributable activated revisions before completion and cleanup; failed, interrupted or unavailable verification leaves completion unresolved while preserving known activation outcomes.

Required checks before publication remain mandatory. In every workflow, continuation must preserve known activation outcomes and later independent changes rather than blindly repeat activation or conversion. A notification failure does not prove activation failed.

Development conversations remain in the [conversation list](REQ-0011-work-on-topics-in-parallel.md). Closing a view or pane does not stop work or prompt for discard. Incomplete assignments retain their context, affected packages and recorded changes for user-requested continuation without automatic expiry. The MVP has no development-storage display or manual cleanup capability and no additional age-based cleanup policy. Leftover development artifacts may accumulate without a retention limit. Internal check completion, release and resource disposal remain responsible for disposable test state, not live content or recovery history. Only legacy plugin-draft formats verified never to have shipped publicly are exempt from compatibility requirements. Published draft formats follow [released-version compatibility](REQ-0069-preserve-workspace-version-compatibility.md).

Workspace closure and application quit stop development. Reopening interrupted conversations waits for user instruction. Cleanup may remove trial-only content and histories, leaving references attributable but unavailable; such references never resolve against live files or later trials. Live workspace history, activated code revisions and rollback information remain intact. Reversing durable edits is an explicit recovery operation, not draft cleanup.

Users must be able to request rollback of the plugin change set. Rollback follows [content recovery](REQ-0022-explain-note-changes.md): it preserves later independent code, configuration and data changes, records compensating changes, and exposes conflicts for user decision rather than naively restoring old files over newer work.

### Data formats and synchronized changes

Only an incompatible data/configuration change requires a migration; code changes that continue supporting existing data need no conversion or new format declaration. An incompatible plugin data change requires a supplied migration path. Code versions and data-format versions are separate. Migration support follows the internal six-month app-version compatibility policy in [REQ-0069](REQ-0069-preserve-workspace-version-compatibility.md); migration chains and their dependencies need not be retained indefinitely. Beyond that window, automatic migration is not guaranteed. Missing conversion support must be explained without running incompatible code or discarding the received data. Later-arriving changes from an older supported data format must pass through the applicable conversion; already-converted data must not be converted again merely because it was synchronized. Conversion does not resolve ambiguous content conflicts automatically.

Extended agent work and user clarification needed to prepare a migration take place before pausing affected writes. Migration runs and is checked on a separate state derived from the current original data, never on trial results substituted for current workspace data. Already-running affected actions finish before migration; new affected actions and writes pause during migration and activation. Unrelated work remains available. Code and its compatible data state become active together through recoverable publication. Rollback preserves changes made since activation rather than restoring an obsolete data snapshot.

When a migration cannot proceed automatically, Situate explains the blocker and can offer development-assisted repair. Displaying the problem does not start an agent; the user selects the repair action. Device-local compatibility blocking follows [REQ-0070](REQ-0070-preserve-plugin-api-compatibility.md): a receiving device retains unsupported plugin data but does not run incompatible plugin code or permit it to write that data. Platform restrictions remain governed by [REQ-0014](REQ-0014-plugin-platform-compatibility.md). Workspace-wide incompatibility and repair follow [REQ-0069](REQ-0069-preserve-workspace-version-compatibility.md); an individual unavailable plugin does not itself block the workspace.

Divergent plugin source revisions with the same declared version require the user to select a revision; no silent winner or automatic combination is chosen. The unselected revision remains in history. A later return to it is a new checked change, not a reset of newer data. Exact source identities and shared history distinguish divergence from an ordinary update or incomplete synchronization.

Missing, expired or device-bound account credentials block only operations depending on that access. They do not discard retained development, prevent source editing or block otherwise available synthetic checks.

## Rationale

Adapting a personal system should not interrupt work already in progress or expose consumers to an incompatible partial update. Recoverable change sets let users correct a faulty adaptation without losing unrelated later work.

## Source

Private first-iteration platform clarification; date not recorded, not publicly available. Plugin Launchpad was scoped to macOS only; other desktop and mobile platforms remain later delivery targets.

Private first-iteration management clarification; date not recorded, not publicly available. The established plugin-management design was selected without a separate simplified list. Failed work remains in its development conversation for user-requested continuation; repairs use the ordinary development workflow rather than a dedicated process or automatic repair.

Private first-iteration activation clarification; date not recorded, not publicly available. Checked plugins activate without further confirmation or application restart. Chats use the new version on their next agent run without interrupting running responses. Open plugin views reload, accepting unsaved view-state loss without version-to-version state transfer.

Private first-iteration verification clarification; date not recorded, not publicly available. Manifest and load checks plus agent-selected functional tests were selected, with preview, interaction and screenshot capabilities for views. Detected errors are fixed before activation; a separate security review, general compatibility matrix and uniform test scope are not required for local development.

Private first-iteration host-access clarification; date not recorded, not publicly available. Reuse of existing host functionality for files, network access, credentials and navigation was selected without an additional plugin permission layer. Existing versioned writes and external-action approval remain applicable; specialized APIs require a concrete use case rather than speculative SDK coverage.

Private first-iteration capability clarification; date not recorded, not publicly available. Skills, chat tools, custom Vue views and plugin settings were selected for Plugin Launchpad; inter-plugin dependencies, automation and arbitrary host interface extensions were deferred.

Private plugin iteration and concurrency clarification; date not recorded, not publicly available. Separate development conversations with plugin drafts were selected for the first iteration instead of complete workspace copies or mandatory post-activation verification. Concurrent development, including on the same plugin, is unrestricted; interference and overwritten changes are accepted without locking, queuing, base-version rejection or mandatory reconciliation.

Private plugin architecture clarification, 2026-09-29; not publicly available. Continued use of active versions during development, grouped staging and testing, activation after in-flight actions finish, and conflict-aware change-set rollback were confirmed. No activation protocol or additional sandbox was selected.

Private plugin management and marketplace clarification, 2026-10-06; not publicly available. Separate development conversations, temporary workspace copies, synthetic automated tests versus real-data agent trials, instruction-only external-write restrictions, code-only integration, agent activation of previously disabled plugins and explicit development cleanup were confirmed.

Private plugin-adoption scope clarification; not publicly available. Ordinary changes use focused behavioral checks without universal data-format declarations; actual data conversions use current originals and development completion includes read-only verification after adoption.

Private plugin execution clarification, 2026-10-16; not publicly available. Development views share the accepted host UI failure risk.

Private recovery interaction clarification; date not recorded, not publicly available. Recovery is temporary startup suspension with individual and collective resumption without restarting. Development keeps its ordinary checks and activation workflow, accepting renewed application-freeze risk.

Private workspace-development clarification; date not recorded, not publicly available. Same-workspace capability parity, assignment-wide reusable connections, separate checked publication and durable ordinary edits supersede the earlier mandatory-copy and code-only-return boundaries. Concurrency, external approval, lifecycle, recovery and history preservation remain applicable.

Private update, migration and repair scope clarification; date not recorded, transcript not publicly available. The internal six-month app compatibility policy replaces indefinite migration-path retention. User-confirmed app-update interruption remains distinct from plugin activation; repair does not bypass workspace incompatibility.

## Open questions

- How is a change set held ready while affected actions finish, and how are delays or stalled actions presented?
- Which attribution evidence remains available after concurrent edits or restart, including for longer-term final agent verification?
- How are the deferred migration and synchronized-format requirements implemented and verified before incompatible changes are used?
