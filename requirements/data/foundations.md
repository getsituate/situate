# Foundations

## Constraints

The execution policy follows [GOAL-0004](goals/GOAL-0004-decision-authority.md): actions within user requests run directly, without per-action approval. Earlier source notes about external-action approval record historical decisions, not the current execution policy.

### Initial target audience

The initial target audience defined during goal elicitation consists of people who consciously consider how to organize their personal lives. The focus is on connecting previously separate systems and reducing the effort of maintaining them. Technical expertise or a willingness to develop software was not established as a prerequisite.

### Personal organizational core

Situate is a personal organizational system for one person. It uses AI to connect ongoing processes and perform routine and preparatory work using personal context and the user's working methods. AI is a means of supporting organization, not the product category.

Tasks, notes and knowledge, and document management belong to Situate's own core. Existing tasks and notes to be managed by Situate must be brought into that core. Managing this content together is intended to support efficient processing and availability across the user's devices through synchronization. This product boundary does not prescribe a centralized server or a storage implementation.

Document management provides a common view and search across user-configured sources; the core need not store their original files. Local folders and external services, including repositories shared with other people, can supply documents through reusable connectors. During integration development or setup, the user and Situate agree the included subsets, permitted processing and source-specific filing rules. Workflow plugins reuse connectors; shared external storage does not create a shared Situate workspace. See [document sources](requirements/REQ-0054-connect-document-sources.md). [Task workflows](requirements/REQ-0034-adapt-task-workflows.md) and [import conversion](requirements/REQ-0036-convert-imported-notes-and-tasks.md) define the task baseline. Import leaves source data unchanged and creates workspace-local copies, converting notes and tasks there while retaining PDF, image and other documents as ordinary files. [Document search](requirements/REQ-0055-search-document-content.md), [source refresh](requirements/REQ-0056-refresh-document-collection.md), [hierarchical tags](requirements/REQ-0057-organize-documents-with-hierarchical-tags.md) and the [common document view](requirements/REQ-0058-browse-document-collection.md) define connected document management. Reconciliation between separately imported copies and their sources remains unspecified.

Tags remain in Situate by default. Source metadata can map to tags; write-back requires explicit per-integration configuration and stays within the requested task and configured access. Search preparation includes OCR when necessary within the agreed processing and provider boundaries, without per-document approval. This is not permission to transmit an unrestricted workspace to a model provider.

Source: Private document-management elicitation and prioritization conversation; date not recorded, transcript not included. Cross-source document access, search and document workflows were confirmed without requiring migration of originals.

Source: Private product-scope clarification conversation; date not recorded, transcript not included. The personal organizational core, content takeover, supplementary integrations and single-person boundary were explicitly confirmed.

Import is a generic agent-assisted workflow: users explain where their content lives, and the agent clarifies structure and desired transfer and writes suitable importers as needed. There is no fixed catalog of prebuilt importers defining the scope. Available APIs, exports and permissions still constrain access; support for arbitrary inaccessible systems is not promised.

Source for import scope: Private import clarification; date not recorded, not publicly available.

### Personal working methods

Situate should support different approaches to personal organization rather than prescribe a single method. GTD, PARA, the Eisenhower Matrix and MoSCoW were cited as examples of methods and tools, not as an exhaustive list of supported approaches.

Situate should also offer ways to improve personal organization: identify perceived tensions, such as an unrealistically large workload, and suggest suitable established approaches. How such tensions are identified and changes jointly agreed remains undefined. This does not imply blanket permission to change priorities or organizational rules independently.

### Independent organization and decision authority

Situate performs internal and external actions independently within a user request, without per-action approval or allow/deny gates. This includes native tools, plugin tools, external HTTP writes and manual plugin exports. Internal changes remain reversible. Initial task intent, missing-data questions, account/provider authorization, read-only connectors, OS permissions, deliberate plugin installation/activation and destructive workspace or user-content protections remain in force. Durable intent and observed outcomes, cancellation/drain and persistence retry remain required; retrying persistence does not repeat an effect. [GOAL-0004](goals/GOAL-0004-decision-authority.md) describes the intended outcome.

The agent may independently read local files in the current workspace, including past chats and process histories, without user attachment, per-file permission or dedicated Situate restrictions on those reads. Situate adds no special incentive or prompt to inspect history and requires no proactive history retrieval mandate or separate history-memory pipeline. Automatic preparation of the agreed document collection for [content search](requirements/REQ-0055-search-document-content.md) is a distinct requirement. [Context use](requirements/REQ-0004-use-existing-context.md) retains workspace scope, task intent and model/privacy boundaries; permission to read locally is not permission to transmit the entire workspace to a provider.

This is the intended product boundary, not a claim about safeguards already present in the prototype.

Source for local agent access: Private agent lifecycle clarification; date not recorded, not publicly available.

### Monetizing the synchronization service

The [synchronization service](requirements/REQ-0013-synchronization-service.md) for tasks, notes, documents, plugins and chats is intended as a future source of revenue. Pricing, packages, billing and timing have not been determined. This does not restrict local availability or reuse of stored content without Situate.

Source: Private requirements elicitation conversation; date not recorded, transcript not included. The synchronization service was explicitly identified as a future paid offering.

### Paid managed AI access

In addition to freely choosing their own model access, users should be offered paid [managed AI capacity through a Situate-operated router](requirements/REQ-0016-managed-ai-access.md). This service selects suitable models. Pricing, packages, quotas and quality standards remain open. Using supported user-provided model access does not require purchasing this service.

Source: Private requirements elicitation conversation; date not recorded, transcript not included. User-provided model access and additional paid AI access through a dedicated router were both confirmed as must-have capabilities.

### Development, operation and technical baseline

One developer develops and operates Situate. Delivery and operational complexity must fit that capacity. Four-digit monthly operating costs before revenue are conceivable, but no exact budget ceiling or spending authorization has been established.

No implementation from the previous prototype is to be carried forward. Technologies are chosen anew within the approved product constraints.

### Local execution of CI and release workflows

Every operation executed by GitHub Actions must also be available through version-controlled scripts that can run and be tested locally on a host with the required tools and permissions. Workflow definitions remain minimal: they declare orchestration and invoke scripts, without implementing separate build, verification, release or recovery logic. A commit-pinned checkout action is the sole bootstrap exception; subsequent executable operations use repository scripts.

CLI, CI and the development terminal must use the same script-defined release-creation and host-publication workflows, with matching stages, prerequisites, mandatory gates, artifact contracts and recovery rules. The development terminal presents and invokes that workflow; it must fully replace its previous release flow rather than retain a parallel implementation. Local execution must not bypass failed or missing release qualification.

Authorized operators must be able to prepare, qualify and publish macOS releases without GitHub Actions, including during an Actions outage when reviewed source and required dependencies are available locally. Release reservations, locks, durable evidence, packages and recovery state must therefore be accessible independently of Actions. Local and CI operations share the same reservation and publication authority so they cannot allocate conflicting versions or publish out of order. Protected-merge authorization in CI and explicit operator authorization locally are distinct entry points, not different release gates.

This is independence from Actions execution and storage, not a promise of offline signing or publication or independence from all GitHub services. Git tag/release creation and uncached release-asset retrieval may require Git/GitHub access and explicit non-Actions credentials. Apple notarization, production HTTPS qualification and publication-host access remain required. Scripts accept explicit inputs and use supported credential configuration; local execution must not require fabricated GitHub event variables, an Actions token or an Actions run.

Source: Private CI and local-release workflow clarification; date not recorded, conversation not publicly available. Script-based execution, minimal Actions definitions, local release independence and replacement of the development terminal's release flow were required.

### Platform-specific verification

Test selection is organized by supported product platform, not by a generic MVP suite. macOS is the only active platform. Its verification plan consists of individually reported suites relevant to macOS, including shared code and delivery tooling on which it depends. Dedicated verification for deferred platforms is excluded. Repository maintenance checks remain identifiable rather than being presented as tests of another product platform.

Product target, execution host and test profile are separate inputs. A Linux runner may execute shared checks for macOS, but it cannot qualify macOS-native behavior or imply Linux product support. A complete macOS result requires every mandatory shared and native suite; unavailable native execution cannot silently reduce the plan to shared checks. PR, integrated-branch and local checks select the suites affected by the changed inputs; release qualification requires the complete macOS plan only when an application release candidate is being qualified. Pure developer-tool changes must not select client tests, client builds or native app journeys without an identified dependency on the changed input. Scope dependency/configuration rules to their actual consumers rather than treating every nested manifest or lockfile as repository-wide input. Optional design, coverage and live-provider diagnostics remain separate and cannot activate deferred platforms.

CLI output, CI reports and DevTUI must identify macOS and the selected suites rather than expose a generic MVP test mode. Adding another product platform requires an explicit scope decision and qualified suites; no placeholder platform matrix is required now.

Source: Private test-selection clarification; date not recorded, conversation not publicly available. Platform-specific suites and removal of the generic MVP test grouping were required, with macOS as the only active target.

### Verification relevance and concurrency

Determine affected suites and application-release impact before scheduling expensive work. Changes that do not affect the application complete their relevant repository/tooling checks without starting client qualification or reserving an app version. App-impact classification remains independent of public changelog relevance. Conservative fallback for genuinely unknown dependencies must be visible; known tool-only paths must not become an accidental full-client fallback.

Independent check groups may execute in parallel on isolated runners or with explicitly safe local resources. Preserve prerequisite, shared-output, native-desktop and external-operation locks. Use an initial dependency-based job partition without requiring comparative performance experiments; runtime improvements are assumptions until measured. Source-check parallelism does not permit concurrent conflicting release reservations, notarization or publication.

Source: Private CI concurrency and relevance clarification; date not recorded, conversation not publicly available. An initial parallel job layout and affected-only checks were required; benchmarking alternative layouts is outside this implementation increment.

### Dependency monitoring and initial macOS runner

Externally changing vulnerability monitoring is independent of PR verification and app-release prerequisites. Newly reported upstream advisories are addressed through separate dependency-fix PRs, not by blocking unrelated changes. Secret scanning and source-bound license, dependency-ban and allowed-source policy remain required. Dependabot continues monitoring and fix-PR support; scheduled npm auditing against main is a proposed additional monitor, not a required PR check.

The initial CI implementation uses `macos-latest` and records its actual image, architecture and toolchain identity. Additional OS/architecture qualification matrices and dedicated native-host provisioning are outside this increment. Packaging remains universal; passing checks on one runner does not establish native behavior on other architectures or operating-system versions.

Source: Private release-distribution and CI implementation clarification; date not recorded, conversation not publicly available. Independent dependency monitoring, the initial latest macOS runner and separation of release creation from publication were selected.

### Shared Vue interfaces and local plugin authoring

Host and plugin UI use Vue and the same Situate component implementations, not merely common styling. Shared defaults evolve centrally and respond to their available container size. Plugins can also define custom components and views; there is no restricted UI vocabulary. Small, stable public component and SDK contracts, including props, events and slots, are preferred over dependence on implementation details. Public plugin interfaces follow the [minimum six-month compatibility policy](requirements/REQ-0070-preserve-plugin-api-compatibility.md), with a long-term objective of never breaking them. This does not promise support for every third-party library version, and prototype behavior does not establish long-term compatibility. See [REQ-0026](requirements/REQ-0026-provide-plugin-defined-views.md).

Plugins support plain JavaScript and locally compiled Vue templates without mandatory TypeScript, JSX or an external build pipeline, including no required Node.js build pipeline on mobile. TypeScript may remain host tooling rather than a plugin-authoring requirement. Plugin component names are local by default. Reuse across plugins requires explicit exports and declared dependencies, not an automatic global component pool or a core-defined domain contract; see [REQ-0001](requirements/REQ-0001-create-integrations.md).

Source: Private UI and recovery requirements clarification; date not recorded, not publicly available. Shared Vue implementations, local authoring and explicit component reuse were confirmed; contract details and compatibility verification remain open.

### MVP platform scope

The current MVP targets macOS only. iOS, Windows, Linux desktop and Android are deferred and are not currently supported, with no committed activation or resumption date. Their platform-specific implementation, compatibility, SDK setup, packaging and qualification are not required for current development or delivery. The broader platform goal in [REQ-0012](requirements/REQ-0012-platform-availability.md) remains a later ambition, not an MVP acceptance gate.

Data preservation, security and workspace/plugin compatibility remain required for macOS. Equivalent desktop/mobile functionality remains a longer-term goal, not a current acceptance gate. Linux-hosted development infrastructure does not imply Linux desktop support. Shared browser checks and historical simulator results do not establish support for a deferred platform. Activating another product platform requires an explicit scope decision and native verification; deferral does not waive protections for published data or interfaces.

Source: MVP platform prioritization, 2026-11-13: macOS is the sole active delivery target; iOS joins Windows, Linux desktop and Android in deferred scope.

### Distribution

Current delivery covers macOS through a website-provided DMG and the direct-install updater. The selected successor release process first publishes packages as GitHub Releases, then a separate workflow downloads the exact GitHub Release assets for host publication. Creating a GitHub Release does not itself activate the website download/update pointer; host publication outcomes remain recorded on the existing host. Public GitHub Release packages nevertheless count as published app versions for workspace/plugin compatibility, even if never promoted to the host. iOS App Store delivery is deferred, not the next scheduled release stage. The longer-term mobile goal requires app-store distribution; desktop app-store distribution remains optional. A website-provided Windows installer and direct Linux installation remain part of the deferred platform scope under [REQ-0012](requirements/REQ-0012-platform-availability.md), not MVP acceptance criteria. iOS, Windows, Linux and Android have no committed delivery dates or relative order. [Package-manager support](requirements/REQ-0071-support-desktop-package-managers.md) is a should-have, with Linux package managers and Homebrew as candidates rather than a settled channel list. Supported operating-system versions and remaining channels are open.

Stores, package managers and direct installations have independent release availability and update timing. The [direct-install updater](requirements/REQ-0068-update-direct-desktop-installations.md) prepares updates in the background but requires confirmation before installation and restart. It must not overwrite store- or package-managed installations.

Homebrew and other package-manager channels are deferred and are not prerequisites for macOS releases. Cross-platform design must still accommodate the different update authorities and asynchronous release availability; selecting concrete package managers is not required for initial delivery.

Source for current delivery scope: MVP platform prioritization, 2026-11-13. macOS DMG and direct updates are selected; iOS, other platforms and package-manager channels are deferred without a delivery sequence or date.

### App version numbers and release communication

The selected app-release policy uses Calendar Versioning in the three-part form `YYYY.M.N`: the full UTC year and unpadded month of version reservation, followed by a positive release sequence within that month. The sequence starts at 1; it is not a day or an indication of change scope. Allocate versions centrally after merge, preserve reservations across retries and never reuse one for different source or content. Public app versions, platform build identifiers and source revisions are distinct. The version identifies a release without claiming API compatibility, feature size or simultaneous availability across channels. Compatibility remains governed by the workspace and public plugin-interface rules below; a calendar change does not waive them. Automatic version allocation and build integration are not yet implemented.

The [optional version history](requirements/REQ-0068-update-direct-desktop-installations.md) provides user-oriented changelogs without automatic display after updates. Automatic feature announcements and promotional presentations of major new capabilities are deferred; they are not part of the current release communication scope.

Every pull request must add an independent, versionless changelog declaration containing zero or more user-facing entries. An empty list requires a short internal reason that is not shown in the app. The obligation also applies to documentation, tooling and automated dependency changes; a required CI check validates the declaration rather than treating a missing entry as empty. Changelog relevance does not determine whether an app release is needed. A maintainer explicitly approves English source before translation into every supported interface language, then reviews the translations before merge. English edits invalidate approval and translation bindings. Release preparation mechanically assembles approved fragments; builds do not generate new public prose. Fragment validation and automatic assembly are not yet implemented, so the current release-level preparation remains operational during transition.

Source approval is separate from authorization to build, upload or publish. The selected delivery design creates qualified macOS GitHub Releases automatically after a protected merge and promotes their exact assets through a separate host-publication workflow. Version and bundled localized history are generated release inputs bound to the reviewed source, not changes committed by the release process. Prefer Git-derived source/fragment membership and immutable release tags for release identity; a reserved tag alone does not prove completed packages or host availability. Failed/incomplete release creation does not consume fragments. Completed GitHub Release history and actual host publication history remain distinct, so a later bundle retains finalized notes even when the host skipped an intermediate release. It does not build, submit or deploy iOS releases. Native qualification, repository protections and recovery remain prerequisites for enabling that automation. The installed app bundles finalized history at or below its installed version; reading history requires no release-note service or separate publication record. History starts with the existing changelog workflow. Retroactive changelogs and historical imports remain excluded; published catalogs are preserved.

Source: Accepted release-versioning and changelog policy, recorded on 2026-11-13 in `docs/architecture/09-architecture-decisions/ADR-0017-calendar-versioned-app-releases.adoc` and `ADR-0018-pull-request-changelog-fragments.adoc`. These decisions replace scope-based product version numbering and release-time content preparation; optional offline history and the exclusion of automatic feature promotion remain unchanged.

### Released-version compatibility

Situate is publicly available. Published workspace formats, retained conversations and plugin state, and device-local settings and provider connections must be treated as existing user data. Pre-release exceptions apply only to formats verified never to have shipped publicly; they do not authorize incompatible changes to published formats.

The internal minimum is six months of [workspace compatibility](requirements/REQ-0069-preserve-workspace-version-compatibility.md) from publication of each app version. Mixed-version reading and writing must preserve data. After that window, deliberate compatibility breaks are permitted, not required; version age alone is never a reason to block use. Actual incompatibility blocks only the affected workspace, with an explanation and update request, while other compatible workspaces remain usable.

[Public plugin interfaces](requirements/REQ-0070-preserve-plugin-api-compatibility.md) have the same internal minimum window and the long-term objective of never breaking compatibility. Plugins using newer capabilities need not provide older-version fallbacks; an unsupported plugin is disabled only on the affected device with its required app version shown. This does not require every plugin change to support older apps or establish an indefinite service API or operating-system support commitment. Migration paths and their dependencies need not remain available indefinitely; the six-month policy is internal release guidance, with avoiding later incompatibilities as a design objective. [Assisted repair](requirements/REQ-0063-start-assisted-repair-from-errors.md) may restore a blocked workspace without opening it for normal use. The block is removed only after the repaired state passes compatibility verification; unavailable safe repair leaves the block and an explanation of required next steps.

Changes to published storage formats require compatible evolution or a tested, data-preserving migration with recoverable failure and interruption behavior. Migration must not defeat the required mixed-version workspace policy. Unsupported or damaged records retain overwrite protection; an upgrade must not replace them with empty state or reset a workspace. Verification includes synthetic data matching supported published formats, upgrade and reopen paths, skipped releases and preservation of newer information by older supported writers. Fresh-workspace checks alone do not establish upgrade safety.

Source for distribution and released-version compatibility: Private application-update and compatibility clarification; date not recorded, transcript not publicly available. Direct installation, user-confirmed update restarts and compatibility were selected as must-have; package-manager support as should-have. The six-month minimum is measured from each app version's publication. A subsequent update, migration and repair clarification retained this internal policy without indefinite migration availability and allowed repair of blocked workspaces without bypassing compatibility checks.

### Hosting and data processing

Situate-operated services must be hosted in the EU. Germany is preferred, not mandatory. Applicable EU data-protection requirements govern processing; specific legal obligations and safeguards require assessment for the actual services and data flows.

The managed AI service may use providers that process outside the EU when the legal prerequisites are met. Content supplied through the managed service must not be used for model training. Users are responsible for choosing providers connected through their own model access; Situate remains responsible for its own data transmission and credential handling.

The Situate AI router may process content authorized for the relevant AI request in plaintext. This does not grant access to the entire stored collection. The official Situate synchronization service must use end-to-end encryption so that neither the service nor Situate as its operator can decrypt synchronized user content. Users may choose alternative synchronization plugins with different content-encryption policies. For every synchronization mode, user-provided AI credentials remain in device-local OS secure storage scoped to workspace and device. Provider configuration, selected access and future model choices are also device-local and excluded from workspace transfer, including when a key is technically shareable. Situate-operated services do not store or broker these user-provided credentials. Official synchronization uses one account recovery key for all officially synchronized workspaces, with mandatory saved-material confirmation; it does not provision or recover device-local AI settings or credentials. Authorized AI processing must not bypass that boundary. See [REQ-0013](requirements/REQ-0013-synchronization-service.md) and [REQ-0016](requirements/REQ-0016-managed-ai-access.md).

### Manual offline use

Locally stored content must remain readable and manually editable without internet access or AI functionality. Local edits must be retained for later synchronization. This does not require offline access to external services or offline AI processing; see [REQ-0008](requirements/REQ-0008-local-content-availability.md).

Source for development, operation, distribution, hosting, data processing and offline constraints: Private architecture-constraints clarification conversation; date not recorded, transcript not included. These boundaries were explicitly confirmed. The budget ceiling and provider retention periods remain unresolved. Official-service recovery uses an existing authorized device or a user-held recovery key; the cryptographic protocols remain to be designed.

### Plugin trust and synchronization ownership

Installed plugins are initially treated as trusted code with broad access, not as sandboxed adversaries. They must honor tool read/write declarations, task scope and declared reversal support. Situate does not attempt to infer arbitrary plugin side effects. This is a plugin contract, not a security boundary against malicious code. Plugins use defined host extension APIs. Services and chat tools retain supervised execution contexts. Plugin views may execute as ordinary Vue components in the host UI, using its Vue runtime and shared Situate components without an independently stoppable rendering context. A synchronous loop or other view failure can freeze the application, affect other open workspaces and require a forced restart, with possible loss of unsaved state. In-app abort and view removal cannot guarantee stopping such code. This accepted availability trade-off requires plugin-free startup and repair under [recovery startup](#recovery-startup); it does not relax task-scope, versioned-write or service-supervision contracts.

Plugins must use the core's versioned write interfaces for Situate-owned content. External write tools provide an idempotent, precondition-checked reversal or explicitly declare that reversal is unavailable. Synchronization plugins provide storage and transport; versioning, Git merge-conflict handling and file/history recovery remain core responsibilities for every transport. Users may develop whole-directory transport, including `.git` and internal files, or Git-server-based transfer. This does not select an official provider or guarantee directory-transfer consistency. External modifications must be detectable and incorporated within supported file and transport boundaries, without promising arbitrary writes to encrypted official storage or universal remote-edit interoperability. See [content recovery](requirements/REQ-0022-explain-note-changes.md) and [synchronization](requirements/REQ-0013-synchronization-service.md).

Source: Private architecture strategy clarification, 2026-09-29; transcript not included. Trusted plugin execution, core-managed content history and replaceable synchronization transport were confirmed. Mobile plugin execution and store compatibility remain unresolved.

Source for host-executed views: Private plugin execution clarification, 2026-10-16; not publicly available. Ordinary host Vue views and the resulting hang/restart risk were accepted, conditional on plugin-free recovery and repair. Service supervision remains unchanged.

Synchronization adds no semantic conflict checking. Ordinary Git merge conflicts pause synchronization for the whole affected workspace until user resolution, while other local edits and other workspaces remain unaffected. Manual resolution does not depend on AI; chat-assisted combined results and binary choices require the user's decision before application. External-copy identity ambiguity still follows [REQ-0035](requirements/REQ-0035-preserve-file-and-task-identity.md); rare UUID-generation collisions may surface as errors without special recovery.

Source: Private synchronization clarification, 2026-09-30; not publicly available.

### Reusable integrations and plugin-owned domain interfaces

Reusable integrations own external connections and accounts; individual workflow plugins consume explicitly exported interfaces. Each consumer selects its relevant accounts. The core does not impose inbox-entry or mail domain contracts, and workflow internals are not automatically public. The agent can develop reusable interfaces and update declared consumers within the requested development scope; see [REQ-0001](requirements/REQ-0001-create-integrations.md).

Marketplace templates are independently adapted development starting points, without automatic upstream updates. Adaptation is required under [REQ-0019](requirements/REQ-0019-share-plugins-through-marketplace.md); [local security checks](requirements/REQ-0021-adapt-local-plugin-copies.md) are mandatory before use, including adaptations. The initial marketplace uses manual operator approval of every submitted version; automated publication security review remains deferred. Chat tool-list omissions curate discovery, not access control. Neither tool curation nor grouped development staging introduces an adversarial sandbox.

### Plugin development copies and publication

The first plugin-development milestone, **Plugin Launchpad**, used a separate development conversation and a plugin draft rather than a complete workspace copy. Its recorded evidence remains in [REQ-0033](requirements/REQ-0033-stage-and-activate-plugin-changes.md#first-iteration-plugin-launchpad); it does not establish workspace-wide development or reusable-dependency delivery.

**Workspace-wide development with reusable connections** uses the same workspace and tools as ordinary chat, with the same workspace writes, navigation, available shell access, enabled plugin tools and task-scope rules under identical device and recovery conditions. Neither a mandatory workspace copy nor a single-plugin directory restricts development access. An assignment may create or adapt several connections, consumers, views and ordinary workspace files. Selecting an existing plugin provides context only. Development instructions guide discovery, reuse, focused checks and restrained changes rather than unrelated edits or automatic child-conversation fan-out.

Source preparation and checked plugin activation remain distinct. Ordinary workspace writes use normal history and durability semantics; they are not held pending activation or erased when development fails or is discarded. Required related plugin revisions and consumers are checked together before coordinated activation, while existing active versions remain available and affected in-flight actions finish. Source/candidate storage, interrupted publication recovery and dependency revision changes during preparation remain unresolved; no full-workspace transaction or universal migration framework is selected.

Concurrent development remains unrestricted, including multiple chats working on the same plugin or files. There is no development lock, competing-work queue, base-version conflict gate, mandatory reconciliation or automatic merge. Such work may interfere with or overwrite other changes; conflict-free development is not promised. This does not expand task scope or replace synchronization-conflict and explicit rollback rules.

Source: Private plugin iteration and concurrency clarification; date not recorded, not publicly available. Draft-based development and unrestricted concurrent work were selected, accepting interference between overlapping developments.

Automated checks use synthetic fixtures and separate temporary test state, including for dependencies. Agent-led investigation can read real workspace content and connected accounts, but incidental real external writes are prohibited during trials. Account access is not technically sandboxed; ordinary task scope and configured access remain applicable. Personal content and credentials must not be embedded in generated code or automated fixtures. Incompatible data changes retain the separate migration requirements in REQ-0033 rather than becoming ordinary code activation.

Incomplete assignments remain resumable without automatic expiry. The MVP has no development-storage display or manual cleanup capability, and no additional age-based cleanup policy. Leftover development artifacts may accumulate without a retention limit. Only legacy plugin-draft formats verified never to have shipped publicly are exempt from compatibility requirements; published drafts remain subject to released-version compatibility. Internal check completion, release and resource disposal remove only disposable test state, not live workspace files, activated code, configurations or recovery history. Known activation outcomes and later independent edits remain protected; interruption does not authorize blind activation retries. Final read-only agent verification after activation remains a longer-term requirement in REQ-0033, not a prerequisite for Workspace-wide development with reusable connections. Required checks before publication remain mandatory. Removed trial-only references remain attributable but unavailable, never redirected to live content or a later trial. Conversations remain retained. Closing a pane does not stop work; workspace closure and application quit do, and interrupted work waits for user interaction on reopening.

Development uses ordinary chat's messages, Activity, tool and content-change rendering; only its background and header label distinguish it visually. The read-only Changes panel shows a flat workspace-relative list and recorded source diffs, including Markdown and `.situate/` paths, without semantic summaries or a second Files tab. Ordinary workspace browsing remains in Files; standalone complete-plugin inspection remains available.

Recovery temporarily suspends installed plugins, not the ordinary development workflow. Source repair, previews, executable checks and checked activation remain available on request. Activation resumes only the developed targets, not unrelated suspended plugins; individual resume and resume-all remain available under [recovery startup](#recovery-startup). Editing or inspection alone does not resume a plugin, and no interrupted request is replayed.

Source: Private workspace-development and interface clarification; date not recorded, not publicly available. Same-workspace assignment access, reusable connections, Changes-only inspection and shared chat presentation supersede earlier mandatory-copy and code-only-return boundaries. Earlier Plugin Launchpad evidence and unrestricted concurrency remain applicable.

The marketplace initially distributes only free templates under uniform general publication terms granting use, copying, modification, combination and redistribution. This does not select a license text, establish rights in third-party material or assess legal sufficiency. No separate license-selection workflow or marketplace monetization is included initially. Publication uses a separate English copy without personal content; optional agent-generated screenshots use example data, and users explicitly submit after reviewing the complete store page. Manual review, reporting and blocking are defined in [REQ-0019](requirements/REQ-0019-share-plugins-through-marketplace.md). Existing adopters receive no subsequent security warnings; initial local checks cannot guarantee detection of later-discovered vulnerabilities.

Source: Private plugin management and marketplace clarification, 2026-10-06; not publicly available.

### Workspace-bound plugin execution

Configured plugins can run independently of their views while their workspace is open, subject to explicit platform limits. Closing the last window of a workspace stops its work, plugins, automation and synchronization; other open workspaces remain unaffected. The core supports coordination, but plugin policies determine missed-run handling, offline behavior and once-across-devices versus per-device execution. This is not an exactly-once guarantee and does not require an always-running server. [REQ-0031](requirements/REQ-0031-run-plugins-independently-of-views.md) defines plugin behavior; interrupted conversations retain the interaction boundary in [REQ-0011](requirements/REQ-0011-work-on-topics-in-parallel.md). [REQ-0037](requirements/REQ-0037-keep-workspaces-independent.md) defines workspace independence and lifecycle.

Outside recovery, after confirmed [plugin disabling](requirements/REQ-0032-manage-plugin-status-and-disabling.md), new actions are blocked immediately and already-running actions normally finish. Users can choose “Abort now”; external effects already triggered are not undone. Affected dependents remain blocked after their dependency is re-enabled and require explicit user re-enabling.

Explicit workspace closure with active actions offers “Cancel” or “Abort now and close.” New starts are blocked while the closure decision is pending. Cancellation discards the closure request, leaves running work uninterrupted and restores normal operation, including new starts and configured synchronization; it does not schedule closure after work finishes. Aborting stops running work without undoing already-triggered external effects. If closure proceeds, separate pending-synchronization choices still apply, including to retained local changes. Other workspaces remain unaffected, and reopened interrupted conversations wait for user interaction. Mobile operating-system suspension or forced termination does not guarantee graceful closure.

On mobile, switching the active workspace leaves the previous workspace open. Its work and configured synchronization may continue until explicit closure, subject to operating-system limits; switching is not closure and does not guarantee background execution. Startup automatically reopens the last-open workspaces. Individual workspace closure removes that workspace from the remembered open set; application quit stops execution without clearing that set. Outside recovery, automatic reopening follows existing synchronization and trigger policies, while interrupted conversations still await user interaction. The concrete mobile interface for active and other open workspaces and explicit closure remains undecided.

Source for mobile switching and startup: Private mobile lifecycle and startup clarification; date not recorded, not publicly available.

Uncertain external outcomes after interruptions are delegated to the native agent runtime and model judgment, without an additional Situate-specific recovery or automatic checking protocol. Resolution depends on agent and model judgment and is not guaranteed. Normal history and task-scope obligations remain; this boundary does not remove the core's separate file and history recovery responsibilities.

Source for action lifecycle and uncertain outcomes: Private agent lifecycle clarification; date not recorded, not publicly available.

Source for reusable integrations and application-bound execution: Private plugin architecture clarification, 2026-09-29; not publicly available. These product boundaries were confirmed; coordination and activation protocols remain undecided.

### Recovery startup

Users can start Situate with all plugin execution disabled across all restored workspaces. Temporary suspension takes effect before plugin loading or execution, including initializers, views, tools and triggers. Additional workspaces opened while recovery remains active also start with suspended plugins; persisted enabled/disabled preferences are unchanged. Entry must be reachable even if the previous application run froze, not solely through running-app settings. Code, configuration and data are retained. Built-in plugin management and the agent remain usable. Users can resume individual plugins or resume all previously enabled plugins without restarting; permanently disabled plugins remain disabled on resume-all. Requested development retains ordinary previews, executable checks and checked activation. Activation resumes its target without resuming unrelated plugins. See [REQ-0032](requirements/REQ-0032-manage-plugin-status-and-disabling.md) and [workspace lifecycle](requirements/REQ-0037-keep-workspaces-independent.md).

Restored plugin panes show built-in placeholders until their plugin is resumed. A global notice distinguishes temporary suspension from persistent disabling and reflects the remaining suspended plugins. Recovery ends when no temporary suspensions remain. Inspection or editing alone does not resume an installation; successful checked development activation may do so. Interrupted conversations still wait for a new instruction, and neither resumption nor activation replays failed requests. Testing or resuming faulty code can freeze the application again. Recovery is not a sandbox, rollback or guarantee against prior damage. Evidence of an unclean run must offer a built-in startup choice before plugin execution without claiming which plugin caused the interruption. Platform-specific entry interactions and synchronization behavior in recovery still require verification; catalog approval does not establish implementation coverage.

Source: Private UI and recovery requirements clarification; date not recorded, not publicly available. User-initiated startup recovery and its limits were confirmed.

### Markdown and identity

Notes and tasks use Markdown. Markdown and other files use one Git-anchored reference model without embedded file IDs. Existing user metadata remains content; an existing `situate-id` field has no identity semantics. Import preserves supplied note titles, body content, metadata, links and actual attachments. Format conversion preserves their meaning, and copies receive fresh task identities. A default task checkbox carries an HTML comment containing `situate-task-id` and a UUID; that same comment holds extensible task metadata. The ID both recognizes and identifies the task, without requiring a separate `#task` tag. Ordinary unmarked checkboxes remain ordinary checkboxes. Task metadata remains extensible; support for short markers or empty task IDs is not required. [REQ-0035](requirements/REQ-0035-preserve-file-and-task-identity.md) defines identity behavior, and [REQ-0036](requirements/REQ-0036-convert-imported-notes-and-tasks.md) defines source-preserving conversion, available during setup and in later ordinary conversations.

File references follow confirmed Situate-managed moves and renames through Git history. External moves and renames may leave references unresolved. Known deletion ends a file lineage; restoration or path reuse does not revive its old live references. Equal bytes, similar filenames and Git rename heuristics do not justify choosing an uncertain target. Task UUIDs remain independent of file references, and binary content remains versioned.

The original unified-reference replacement excluded migration and compatibility readers for unpublished development formats only. That exception does not apply to any format shipped in a public release. Later reference-format changes follow [released-version compatibility](#released-version-compatibility), including data-preserving migration where needed. Unsupported records fail explicitly without being overwritten, recaptured or replaced with empty state; format mismatch does not authorize metadata cleanup, history rewriting, reset or deletion.

Source for unified file references and retained task identity: Private file-reference and import decision, 2026-11-03; not publicly available.

### Workspace storage and history

Each workspace has one Git history for organizational content. Plugin code, configuration, data, runtime metadata, development drafts and plugin-specific histories belong inside that plugin’s directory. An absent plugin directory is not an installation; retained records elsewhere must not recreate it or transfer its state to a later installation with the same ID. Explicit uninstallation removes the complete plugin directory, while ordinary user content, conversations and general workspace history remain intact. See [plugin management and removal](requirements/REQ-0032-manage-plugin-status-and-disabling.md#uninstallation-and-directory-ownership). The complete workspace, including chats, internal state, plugins and all histories, is contained in one portable directory under [REQ-0038](requirements/REQ-0038-copy-portable-workspaces.md).

Workspace-local Situate metadata and operational state belong exclusively under `.situate/`; this includes working rules, agent memory, skills, plugin configuration and data, conversations, indexes, drafts, histories and temporary import helpers. Files elsewhere in the workspace are user-owned content, not implicit application configuration. Situate must not depend on a reserved filename or directory outside `.situate` for its operating rules. Task identities (`situate-task-id`) are the only Situate-owned identity metadata embedded in user content; files have no embedded system identity. Task properties and existing user metadata remain user content and must be preserved. Temporary sibling files used to publish user-content writes atomically contain pending content, not authoritative application state; they must never be used as configuration or recovery authority.

A closed-workspace copy can be a consistent backup; safe live snapshots remain a design question. Operational AI settings and credentials are an explicit exception to directory completeness. Connections, endpoint addresses, selected access, default models and conversation-specific selections for future requests stay outside the portable directory and its histories, scoped to workspace and device. Copying, synchronizing or restoring a workspace does not transfer those settings or replace the destination's existing choices. Conversation content remains portable. Per-message provider/model attribution is not retained; future requests use the receiving device's local access and model settings.

Internal Git history is managed exclusively by Situate. External applications may edit ordinary content files; detected changes are incorporated into history under [REQ-0022](requirements/REQ-0022-explain-note-changes.md). Direct history modification by external Git clients is not a supported editing interface.

Uncontrolled synchronization or modification of internal files can corrupt a repository; this risk must be visible. Corruption is distinct from a merge conflict in a valid repository. The core reports unusable history and possible causes without asserting an unverified cause. [Recovery](requirements/REQ-0022-explain-note-changes.md) requires explicit confirmation of history loss and a preserved damaged-repository backup before reinitialization, while retaining content files as the new baseline. History preservation does not guarantee survival of physical damage, and a damaged backup does not guarantee recoverability. Local reinitialization does not itself synchronize or delete other histories. The recovery procedure and protocol boundaries remain open.

Source: Private synchronization clarification, 2026-09-30; not publicly available.

### Device-local diagnostic logging

Diagnostic logs are installation-local technical records, not workspace content. They are excluded from workspace synchronization, portable workspace state and content version history. This exclusion applies to application and plugin logs and does not remove the separate process-history or content-recovery obligations. A single storage budget covers logs from all workspaces and plugins; the actual location remains undecided. See [local diagnostic storage](requirements/REQ-0066-bound-local-diagnostic-storage.md).

[Diagnostic correlation](requirements/REQ-0064-record-client-diagnostic-events.md) uses workspace, device and session identifiers, not a user identifier. The random workspace identifier is portable metadata created with the workspace and preserved by synchronization, full copies and restoration. Deliberately independent workspaces require distinct identifiers. Device and session identities remain local; synchronizing the workspace identifier does not synchronize logs.

Source for identity scope: Private diagnostic workspace-identity clarification; date not recorded, transcript not publicly available.

Application components and plugins use one [shared logging API](requirements/REQ-0065-provide-shared-logging-api.md) with replaceable implementations. [Diagnostic data limits](requirements/REQ-0067-limit-diagnostic-data.md) apply to all levels and destinations: standard logs exclude personal content, and credentials are never logged. Detailed local recording is not authorization for external transmission.

Source: Private client-logging requirements clarification; date not recorded, transcript not publicly available. Device-local logging, exclusion from synchronization and history, a shared API and an installation-wide storage budget were confirmed.

### Independent workspace configuration

Tutorial completion is a narrow exception to workspace-local configuration: it belongs to the user, is shared across workspaces on the same device without synchronization, and also follows the user across devices when synchronization is available. This does not authorize sharing workspace content, credentials or model settings. The synchronization mechanism for user-wide tutorial metadata remains to be specified. See [onboarding and contextual learning](#onboarding-and-contextual-learning).

Content, chats, plugins, configuration and account connections belong to individual workspaces. Operational AI settings are additionally device-local: each workspace on each device has its own connections, selected access and model choices. No automatic cross-workspace search, dependencies or context use is required or permitted. This is not a sandbox against malicious plugins: explicitly developed cross-workspace access remains possible under operating-system permissions. [REQ-0037](requirements/REQ-0037-keep-workspaces-independent.md) defines that boundary.

Each workspace independently selects no synchronization, the official encrypted service or a custom synchronization plugin. With connectivity and configured synchronization, synchronization operates automatically while the workspace is open, without a save, commit or manual synchronization action. Existing local content is immediately usable on opening while visible state indicates potentially pending remote changes; initial synchronization still governs content not yet local. Before closing the last window with unsynchronized changes, the user chooses synchronization while the workspace remains open or immediate closure preserving local changes for reopening. Offline operation, conflicts and failures are not completion. Synchronization stops on closure; local-only workspaces have no synchronization prerequisite. Users choose model endpoints and credentials per workspace and device, including suitable OpenAI-compatible self-hosted or local endpoints. A workspace can use a desktop-local model on one device and a cloud provider on another; synchronization preserves both choices. A new device without local AI access offers setup when needed without treating the workspace as broken. Conversation synchronization does not select the provider or model for a subsequent request. Missing or unavailable access must not trigger silent provider switching or paid managed-service fallback. Protocol compatibility alone does not promise model-feature compatibility. Local-only operation is a configuration choice, not a blanket networking prohibition; see [REQ-0013](requirements/REQ-0013-synchronization-service.md) and [REQ-0015](requirements/REQ-0015-connect-user-provided-models.md).

Source for Markdown, identity, workspace storage, independent configuration and workspace-bound execution: Private content and workspace architecture clarification, 2026-09-29; not publicly available.

Source for automatic synchronization, local access and close decisions: Private synchronization clarification, 2026-09-30; not publicly available. Batching cadence, performance limits and detailed presentation remain open.

[Managed Situate AI](requirements/REQ-0016-managed-ai-access.md) is available through account entitlement without repeated external-provider setup. Devices use separate Situate sessions. Availability is distinct from the workspace's device-local access selection: signing in or selecting managed AI on one device must not replace another device's local model or provider. Account entitlement does not grant access to workspace content or bypass processing authorization. Independent provider sessions require provider support; device-local storage does not itself prevent provider-imposed session replacement or revocation.

Source for device-local AI configuration and account-based managed availability: Private multi-device AI configuration clarification; date not recorded, not publicly available. Per-device setup was selected instead of provider-dependent credential synchronization, while workspace independence and conversation-history portability remain required.

### Initial language scope

The supplied Situate interface initially supports German and English. Interface language and three independently selectable time, date and number formats belong to the workspace and synchronize with its settings when synchronization is configured. There is no region selector. Creation initializes each format from its supported device value, with an initial-language fallback for each unavailable field; subsequent device-setting or interface-language changes do not overwrite the stored formats. Local and received synchronized changes take effect immediately without restarting or resetting ongoing input and content. Without an active workspace, the interface follows the device language with English fallback, without an extra device-specific preference.

Interface language, conversation language, and personal plugin language are distinct; see [interface language](requirements/REQ-0047-choose-interface-language.md), [chat language](requirements/REQ-0048-follow-conversation-language.md), and [plugin language](requirements/REQ-0049-adapt-plugin-language.md). Changing the interface language does not translate existing personal content or plugins. [Regional formats](requirements/REQ-0052-choose-workspace-regional-formats.md) change presentation, not stored values, currency, or time-zone semantics. [Translation completeness](requirements/REQ-0053-enforce-interface-translation-completeness.md) is enforced in CI, with English as a runtime fallback for missing German text.

Marketplace templates use English user-visible plugin text as the publication baseline. Adoption adapts that text to the user's language rather than requiring publishers to supply every supported interface language. Publication preparation leaves the personal original unchanged and excludes personal content; see [marketplace templates](requirements/REQ-0019-share-plugins-through-marketplace.md).

Source: Private localization clarification conversation; date not recorded, transcript not included. Initial German and English support, independent language choices, English templates, and local language adaptation were explicitly confirmed. A subsequent detail interview confirmed workspace ownership and synchronization, immediate updates, independent regional formats, and mandatory translation completeness checks.

### Onboarding and contextual learning

Guided onboarding uses a reduced interface to understand the person's working method and prepare their personal system. The person can adopt and adapt an established organizational approach, retain their existing approach, or describe a custom one. Guidance explains applicability, trade-offs and effort and presents unresolved preferences alongside a concrete proposal; generic productivity tips alone are not the intended experience. GTD, PARA and the Eisenhower Matrix are examples for further investigation, not an exhaustive or mutually exclusive selection. Documentation of a method does not establish scientific evidence of its effectiveness or superiority.

Workspace creation and provider connection follow [REQ-0045](requirements/REQ-0045-create-local-workspaces.md). Connecting usable AI access is required before entering guided onboarding; there is no skip-to-manual-use route through initial setup. A local workspace can be created before access is connected, but setup remains incomplete. This initial requirement does not introduce a permanent AI-availability gate for established workspaces: later loss of AI access prevents AI work, not reading or manually editing stored content.

On macOS, normal startup remains the workspace overview with its workspace list and creation/opening actions. Choosing **Create a workspace** begins the fullscreen Astra welcome; finishing or skipping it opens the creation form directly, without an intermediate workspace-choice screen. Reduced motion goes directly to creation without delay. Creation and subsequent setup retain the shared setup frame, five-step progress, paper-garden/Bend illustration and task-card layout. Cancellation before creation returns to the normal overview. Opening existing workspaces does not start a new onboarding flow: established workspaces open normally, while already-created incomplete workspaces restore their saved setup state without replaying the welcome or creation.

Initial onboarding delivery targets macOS. iOS onboarding delivery and qualification are deferred with the platform; the Plugin Launchpad milestone also remains macOS-only.

After usable AI access is verified, one initial form captures existing sources and working preferences. Starting without imported content is independent of retaining, changing or jointly establishing a working method. No named-method catalogue is mandatory. Submitting the form starts one retained setup conversation for source exploration, working-method review, import and optional support. Known source details and earlier answers remain context rather than being requested again. The agent first explains the proposed working method in plain language in the conversation and discusses corrections and unresolved preferences there. Uncertain preferences are not silently adopted as rules. Confirmation explicitly adopts the current explained proposal, not an interpretation of written feedback. Only then is the agreed working method saved to `.situate/working-method.md`, a fixed, non-localized workspace-relative path. Users do not have to inspect a file before confirmation or review it again afterward; the saved file remains readable and editable through the normal file view. Root `AGENTS.md`, `.pi/skills` and visible `Situate/` files remain user content; they are neither automatically loaded as instructions nor overwritten by onboarding.

Source discussion and inspection can inform the working-method proposal before agreement. Inspection does not authorize importing or changing source originals. Actual import follows explicit confirmation of the working method and workspace instructions; it does not run concurrently with their discovery. The person may import notes and tasks, omit individual sources, defer unavailable sources, or start without imported content. There is no fixed source count required for completion. Later addition remains possible under [agent-assisted import](requirements/REQ-0036-convert-imported-notes-and-tasks.md) and [integration development](requirements/REQ-0001-create-integrations.md).

Questions, suggested answers and the existing full chat composer share one answer area. Suggestions send directly; free text remains possible independently of those suggestions, including for a question without choices. Answered and superseded questions stay readable without accepting stale or repeated responses. Written questions and feedback do not constitute working-method confirmation. Plugin development requires an explicit commission for the described work; interest in an idea or a question about it is not authorization. The conversation retains its draft, attachments, questions and execution state rather than creating a separate answer form.

The onboarding context establishes that the source conversation requests an import. No additional import approval, confirmation dialog or mandatory approval summary is required. The agent asks questions only where scope, access or interpretation is unclear, including the convention identifying source tasks. Existing source-preservation, conversion, credential-consent and task-scope rules remain applicable.

A partial or failed import is explained in the same conversation: what was transferred and what remains missing or blocked. Successfully imported content remains usable. The person can ask questions, request another attempt or continue onboarding without completing the remaining import. There is no separate partial-import approval step; continuing does not label missing content as imported.

Once the working method is confirmed, choosing **Open app** ends guided onboarding, with the same completed guidance state as the final setup confirmation. There is no resumable guided view or setup-continuation banner after entry. The same conversation, draft, pending substantive questions and active work remain available in ordinary chat. Ending guidance does not claim that imports, AI access configuration or plugin development have succeeded, and does not cancel or replay their work. The existing finale accompanies the first app entry once; reopening an entered workspace does not replay it. Previously entered workspaces with unfinished guidance also open without a guided continuation state. After entry, unavailable AI prevents AI work but does not block reading or manually editing existing content.

Optional support is discussed in ordinary chat after the actual import outcome is explained. Suggestions describe the benefit and fit without requiring the person to inspect technical activities or complete a separate selection form. The person can commission individual ideas, revise them, ask to save them as ordinary notes or decline them; no plugin is compulsory. Recommendations and general feedback are not development authorization. Setup completion and app entry alone do not authorize development, and neither depends on development starting successfully or finishing. Document import and the development of planned connections, workflow plugins and custom views remain outside the initial notes/tasks import.

An explicit commission starts the ordinary [development conversation](requirements/REQ-0033-stage-and-activate-plugin-changes.md) immediately through the same tool used outside onboarding, with its prepared assignment and context, including before app entry. The guided setup conversation remains visible while the development conversation starts separately. Users interact with those chats normally. Development progress, start failures, questions, retries and completion belong to that workflow, not to an additional onboarding stage. Failed starts retain the prepared conversation for explicit continuation; finishing setup and reopening do not replay the commission. Retained tool intent and child-conversation identities do not promise exactly-once external effects. Already imported notes and tasks remain usable through normal chat and manual interactions; the [default task workflow](requirements/REQ-0034-adapt-task-workflows.md) does not depend on custom development. Workspace closure and platform execution limits still apply.

An AI-provider problem during guided setup is explained with recovery options. Quota exhaustion is not asserted without evidence, and estimated remaining capacity must not be invented. Setup progress must remain available for continuation. Supported user-provided access remains an alternative to the Situate managed AI service. Offering that service does not establish pricing or a guarantee that any amount of development can be completed within a given allowance. Pending improvements may be retained in personal notes for later development. AI unavailability after the transition does not remove manual local use, but still prevents AI work.

Onboarding retains answers, conversation history and drafts, the reviewed instruction draft, decisions, and the current step across application exit, crashes and reopening. Already saved files remain intact. Before app entry, reopening returns to the retained step and explains the known status of interrupted work. After app entry, retained work remains in ordinary conversations without reopening guidance. Interrupted AI requests do not restart automatically; continuation waits for user interaction and does not repeat completed actions. A newly commissioned plugin can start during guided setup, but reopening its interrupted development still waits for user interaction.

Onboarding progress belongs to the workspace and follows workspace copying or configured synchronization. Opening that workspace on another device continues from the saved progress, not from a new interview. Provider credentials, selected access, model choices and live requests do not transfer. If local AI access is missing, the destination device requires connection setup before guided onboarding can continue. This is stored-state continuation, not a handoff of an in-flight request.

Source: Private onboarding scope and continuation clarification; date not recorded, transcript not publicly available. Initial macOS delivery, required AI access, method-before-import ordering, contextual import authorization, conversational partial results, durable workspace-owned continuation and post-entry development starts were confirmed.

Source: Private optional-support clarification; date not recorded, transcript not publicly available. Conversational suggestions, ordinary development-tool reuse and immediate start after an explicit commission were confirmed; app entry remains independent.

#### Learning after setup

The everyday introduction, fictional examples and contextual tutorials are separate post-setup functionality, outside onboarding implementation and acceptance. Their remaining design questions do not block delivery of onboarding.

After the transition, a short introduction explains everyday collaboration with Situate. An optional AI-generated fictional everyday scenario uses the available context and capabilities to suggest something to try, preferably demonstrating their interplay when available. Users need not supply a current real task and can instead begin any normal work. There is no separate tutorial chat, mandatory exercise sequence or required cleanup ceremony. Fictional additions are intended to be cleaned up; the exact interaction and responsibility for manual cleanup remain open. Reversible external actions may be tried within the requested scenario, but fictional scenarios must not affect real external participants, including through invitations or messages. Direct execution does not waive that scenario boundary.

Contextual tutorials are independent, one-time explanations attached to relevant visible interface states across conversations. Background actions do not trigger an overlay while their result is out of view. When the person first encounters an applicable element, including by returning to a conversation or scrolling to it, scrolling stops, the element is highlighted, the rest of the interface is dimmed and adjacent text explains it. Dismissing the explanation completes the step; merely producing the underlying result does not. An example is explaining how to inspect a note edit and open the complete file when its result first becomes visible. A global option allows users to complete all remaining tutorials.

Tutorial completion is user-wide: without synchronization it is shared across workspaces on the same device; with synchronization it is also shared across devices. A completed tutorial does not repeat on switching workspaces or devices with that shared state. Platform-specific tutorials remain possible. Exact eligibility rules, synchronization conflict handling and replay controls remain open. Ideas for file, marketplace, pane and shortcut explanations do not establish a complete tutorial inventory or time-based triggers.

Source: Private onboarding clarification conversation, 2026-10-07; not publicly available. The reduced guided experience, user-selected scope, deferred document import and plugin development, plan-confirmation transition, contextual explanations and user-wide completion were selected. Individual prototype observations included difficulty starting from an empty chat and an interrupted setup after AI usage limits were reached; these are not measured prevalence or duration estimates. Whether the staged experience demonstrates sufficient value, which methods to offer and how much AI capacity setup requires remain questions for evaluation.

## Deliberate exclusions

### Initial dictation delivery

The first delivery milestone, `Dictation MVP`, includes offline chat dictation and its draft, navigation, interruption, privacy and error behavior on macOS with Apple Silicon. iOS and Intel Macs are deferred. It includes automatic non-mobile-data model provisioning, resumption, readiness and progress display, retry, and per-installation storage. The explicit mobile-data download action and the model-replacement workflow are deferred beyond this milestone. Initial provisioning therefore requires a non-mobile-data connection. The first delivery uses one fixed model version; replacement download, continued use of a compatible old model and automatic cleanup must be delivered before introducing a model-version change. The full requirements below remain approved beyond that first increment.

The MVP provides [offline chat dictation](requirements/REQ-0024-dictate-text-input.md) on macOS with Apple Silicon using one fixed NVIDIA Parakeet v3 model variant. Automatic spoken-language recognition is independent of system and interface language. German and English are included; additional language coverage is bounded by the selected variant rather than a promise to recognize every language. The initial runtime is FluidAudio with a pinned Parakeet v3 Core ML artifact. Quantitative performance and recognition-quality benchmarks are deferred; local processing, functional behavior and cleanup still require verification.

The model is not bundled with the application. [Model provisioning](requirements/REQ-0041-download-dictation-models-after-installation.md) runs automatically in the background on all non-mobile-data connections, including metered Wi-Fi and Ethernet. Settings show download status and progress and allow explicit mobile-data authorization for the current download only. Model files are shared across workspaces in one application installation and excluded from workspace synchronization and export. Audio processing remains entirely local, with no cloud fallback or retained recordings after processing, interruption or failure.

User-facing model selection, model import, language-specific model packages, selectable quality, speed or storage profiles, and a download-cancel control are outside the MVP. Independent automatic model updates are excluded; a model version change accompanies an application version and follows the same download rules. A compatible old model remains usable until its replacement is downloaded and verified, then is removed automatically. Support for languages outside the fixed variant is also outside this delivery. These options are deferred, not committed to a later release. Selecting a device-qualified package internally does not require exposing model configuration to users.

Source: Private dictation scope clarification; date not recorded, transcript not publicly available. A fixed Parakeet v3 model and the deferred configuration scope were explicitly selected for the MVP. This does not establish implemented behavior or native platform qualification.

Source: Private dictation interaction and provisioning clarification; date not recorded, transcript not publicly available. Per-installation model storage, non-mobile-data automatic downloads, download-scoped mobile-data permission, application-version-bound model replacement and omission of download cancellation were confirmed.

Source: Private dictation milestone clarification; date not recorded, transcript not publicly available. The first delivery includes the agreed dictation behavior and non-mobile-data provisioning; explicit mobile-data download and the model-replacement workflow were deferred beyond that milestone.

### Initial diagnostic logging delivery

Initial delivery includes detailed structured local logs for developer diagnosis through ordinary tools, with no in-application log viewer or user-facing log-level switching during operation. [Client event recording](requirements/REQ-0064-record-client-diagnostic-events.md), the shared API, bounded local retention and diagnostic data limits are must-have requirements.

In-application bugreport submission, external diagnostic delivery, continuous forwarding and analytics functionality are outside this delivery. The API must allow later destinations and independent filtering of local and forwarded events without changes throughout event-producing code. This extensibility is not a commitment to deliver those services or a requirement to transmit logs now.

External providers, analysis questions, transmitted data, remote retention and default-enabled versus opt-in participation remain undecided. Datadog and PostHog are examples of possible destinations, not selected integrations. Any future transmission remains subject to the hosting and data-processing constraints and requires a separate decision about its actual data flow.

Source: Private client-logging requirements clarification; date not recorded, transcript not publicly available. The current logging scope was assigned must-have priority; remote reporting and analysis remain future possibilities without a delivery commitment.

### Conversation purpose and development boundaries

Normal and development conversations have fixed purposes rather than switching modes within a running conversation. Explicit plugin, function or reusable-workflow development starts a separate conversation with the assignment and necessary context; remembering or correcting personal working instructions stays in the normal conversation. The distinction follows user intent, not file type or change size. Development leaves the originating chat usable, and successful activation only notifies it rather than automatically continuing an earlier task. See [development conversations](requirements/REQ-0001-create-integrations.md).

Plugin authors freely choose main-chat or activity-only presentation for their tools, including tools that change notes. This is a presentation choice, not an exemption from traceability, recovery, plugin-use visibility or task scope. Supplied tools directly expose note and working-instruction writes and edits, not implementation-code changes. Both conversation types share these [presentation rules](requirements/REQ-0040-reveal-tool-details-and-content-changes.md).

Source: Private chat-design clarification conversation; date not recorded, transcript not included. Separate development conversations and freely chosen plugin-tool presentation were confirmed to keep normal organizational work understandable and uninterrupted.

### Initial plugin management delivery

Local plugin management in Settings and its development workflow precede the shared marketplace. The initial local scope includes workspace plugin status, enabling and disabling, plugin-owned settings pages and entry points for new or existing plugin development. It is not a local-only marketplace. Publication and the shared catalog remain approved for later delivery; no nonfunctional publication control is required in the local iteration. See [REQ-0032](requirements/REQ-0032-manage-plugin-status-and-disabling.md) and [REQ-0033](requirements/REQ-0033-stage-and-activate-plugin-changes.md).

The first marketplace uses a simple template catalog with descriptions and optional previews. Alternative inspiration-led layouts and download-count sorting are not committed initial features. User inspiration and reduced development token use are intended benefits whose magnitude has not been established.

Source: Private plugin management and marketplace clarification, 2026-10-06; not publicly available.

### No mandatory parallel plugin translations

Personal plugins need not maintain multiple language versions. The agent creates or adapts their visible text for the user rather than automatically translating them when the interface language changes. Explicitly requested additional languages remain possible. Avoiding unused variants is intended to reduce generation and maintenance effort; no measured token savings are established.

Source: Private localization clarification conversation; date not recorded, transcript not included.

### Initial file-editor delivery

The first file-editor delivery covers local file and folder operations, Markdown source editing and rendered reading, automatic saving, external-change detection, file history, version comparison and the initial recovery actions on desktop and mobile. [REQ-0042](requirements/REQ-0042-edit-markdown-source-and-read-rendered-content.md) defines editing, merge conflicts, failed-write recovery and rendered-content handling; [REQ-0022](requirements/REQ-0022-explain-note-changes.md) defines history and recovery.

The MVP delivery targets writing in macOS filesystem workspaces. Retained writing support for application-owned iOS document folders, other desktop platforms and Android is deferred with those platforms. Mobile workspaces reached through external document providers remain read-only until versioned provider writes are implemented and verified. Read-only access must not initialize history, normalize metadata or otherwise modify those workspaces.

The file-to-chat button remains visible but unavailable, with no click action, reference creation or chat opening. This delivery does not implement pane layout or pane switching. [REQ-0030](requirements/REQ-0030-open-chats-with-content-references.md) and [REQ-0026](requirements/REQ-0026-provide-plugin-defined-views.md) remain approved for later delivery rather than being removed or replaced by a separate file-specific chat.

[Formatted editing](requirements/REQ-0043-edit-formatted-markdown.md) is deferred. Text files open internally in both workspace browsing and read-only plugin inspection; Markdown supports rendered reading, while other text is displayed as source. Only binary files open in their default external application; [internal PDF and image previews](requirements/REQ-0059-preview-pdf-and-image-documents.md) are a should-have extension rather than a prerequisite for the first file-editor delivery. Technical workspace internals are excluded from the normal file view under [REQ-0023](requirements/REQ-0023-browse-human-readable-note-structure.md). Dedicated math, Mermaid and wiki-link rendering is deferred; their source remains intact. A wholesale replacement of the current file by an old snapshot is not an initial recovery action.

Source: Private file-editor specification and mobile-storage scope clarification, 2026-10-04; transcript not included. These are delivery boundaries, not evidence of implemented or verified behavior.

### Initial document access and data ownership

The first iteration provides direct source access through chat: a plugin-defined source export convention with authoring/conformance helpers, unchanged generic plugin registration, LLM-assisted source authoring and tools for the source's implemented list/search/metadata/content capabilities. Local-folder and Paperless sources must be created and used through the real development/chat path before merge, not shipped as prepared connectors. Results retain provenance and make unsupported capabilities, partial results and unavailable access explicit.

This iteration does not create a document collection, local index, extraction/OCR pipeline, automatic categorization, Situate tags, saved searches, preview cache, Library UI or synchronization of prepared information. Source-native search and existing OCR/text may be reused. A folder source without extraction is not rejected merely for lacking OCR; it exposes only its supported direct-access capabilities. Existing plugin management and development interfaces suffice. Actual device permissions and plugin lifecycle remain applicable.

Source: Private direct-source-access delivery clarification; transcript not included. The narrower iteration defers collection delivery without rejecting its approved requirements.

### Planned document collection and data ownership

The later collection delivery provides a Library view over connected sources, local text extraction/OCR, full-text search, hierarchical tags, PDF/image previews and saved searches. Originals remain in their sources. Semantic search, embeddings and specialized classifier models are deferred. Source categorization may use the user's configured, authorized external LLM; this is distinct from local-only extraction and OCR. Source setup authorizes automatic categorization and its possible charges within the agreed scope. See [source access](requirements/REQ-0054-connect-document-sources.md), [search](requirements/REQ-0055-search-document-content.md) and [categorization](requirements/REQ-0057-organize-documents-with-hierarchical-tags.md).

Sources are implemented in situ by the LLM through plugin development, not supplied as prepared local-folder or Paperless connectors. Direct access establishes the source contract and uses existing plugin development and chat. The collection increment later adds persistent preparation and the Library UI. Synthetic sources support contract tests but do not replace end-to-end authoring and use.

Document metadata, source references, tags and saved-search definitions have an openly readable and editable file representation in a separate area of the workspace, rather than a database-only authority. Prepared text may persist and synchronize across devices. Search indexes are reconstructible from authoritative records and prepared content. External edits by users, agents or other programs are incorporated; invalid changes are reported and preserved rather than silently overwritten. Access stays within the user's request and configured access without per-action approval. Account/provider authorization, OS permissions and destructive content protections remain distinct.

Document data is separate from note content and plugin code. No user-facing metadata history or recovery feature is required initially. Whether authoritative document metadata uses a dedicated Git repository for synchronization remains a technical decision. Older technical versions, if retained, are acceptable; removal from active use does not promise purging history or existing conversations. Reconstructible indexes and preview caches are not versioned. A broader split of note and plugin/connector/source-code histories into separate repositories requires an architecture compatibility review; it is not established implementation behavior.

Source lifecycle removal and temporary-outage behavior follow [REQ-0056](requirements/REQ-0056-refresh-document-collection.md). Preview copies are a bounded device-local cache, not managed document storage. [REQ-0062](requirements/REQ-0062-synchronize-managed-document-storage.md) remains deferred. Reference qualification uses a local folder and Paperless with synthetic collections representing tens of thousands of documents; quantitative performance limits remain to be measured and agreed.

Source: Private document-access scope and data-ownership clarification; transcript not included. These are product decisions, not implementation or performance evidence.

### Initial document tag filtering

[Document tag filtering](requirements/REQ-0057-organize-documents-with-hierarchical-tags.md) uses one flat tag selection directly in the document view, with any-of as the default and a visible all-of option. Parent tags still include descendants. Grouped expressions, per-tag exclusions and a filter query language are outside the initial scope; there is no separate filter dialog or apply step. [Saved searches](requirements/REQ-0060-save-document-searches.md) retain the selected tags and matching choice. Any-of is a product default, not a validated claim about user preferences.

Source: Private document-filter scope clarification; date not recorded, transcript not included.

### Initial tag deletion and derived tags

[Tag deletion](requirements/REQ-0057-organize-documents-with-hierarchical-tags.md) preserves subtags by default, moving direct children up one level. Deleting a whole branch requires an explicit choice. Document files and source metadata remain unchanged. The deletion confirmation shows affected assignments and subtags, not a list or count of affected saved searches. Deleted tag conditions are automatically removed from [saved searches](requirements/REQ-0060-save-document-searches.md), without a repair dialog. Other criteria, names and pinning remain unchanged. Removing the final tag condition leaves no tag restriction; without other criteria, the saved search includes the agreed document collection.

Derived tags have no special deletion protection or automatic recreation suppression in the initial scope. Deletion does not reconfigure the responsible plugins or connections; users adjust those when needed. Other source-mapping and reconciliation questions remain open.

Source: Private tag-deletion clarification and saved-search simplification clarification; dates not recorded, transcripts not included. These are product decisions, not evidence of usability or implemented behavior.

### Deferred document source navigation

The initial [document view](requirements/REQ-0058-browse-document-collection.md) uses the common collection, search, tags and saved searches. Individual connections are not navigation entries, including flat per-source document lists. Source and folder filters and [source-provided structures](requirements/REQ-0061-browse-document-source-structures.md) are deferred until a concrete user need is established.

Connection setup, agreed included and excluded subsets, processing, refresh and error handling remain in scope. Documents retain their source and available original path as metadata; this exclusion does not broaden collection access or change source organization. REQ-0061 remains approved with should-have priority, but is outside initial delivery rather than rejected.

Source: Private document-navigation scope clarification; date not recorded, transcript not included. This is a scope decision made without validated demand for source-specific browsing.

### Deferred managed document storage

The [managed document storage service](requirements/REQ-0062-synchronize-managed-document-storage.md), with a dedicated synchronized area, operating-system file access and on-demand original downloads, is a could-have for a later delivery. It is not a prerequisite for connecting existing document sources. The must-have priority and existing full-replication scope of [workspace synchronization](requirements/REQ-0013-synchronization-service.md) remain unchanged. Searching prepared external document information without downloading every original is distinct from selectively replicating workspace content. Detailed conflict handling and file-provider behavior for the managed document area remain open.

Source: Private document-management prioritization conversation; date not recorded, transcript not included. Managed file storage was explicitly deferred as a could-have, separately from workspace synchronization.

### No replacement email or calendar service

Situate connects to existing email and calendar services rather than implementing its own. Users can continue to review and send prepared drafts in their existing email application. This does not exclude working with connected email or calendar content through Situate.

### No mandatory migration of all external content

Tasks and notes managed by Situate are brought into its own core, which also provides document management. Email and calendars remain external. Additional integrations can provide access to external documents, including repositories shared with other people, without requiring their complete migration. Import copies content into the workspace without changing the source; note and task conversion takes place in the workspace, while document files need not become Markdown. Later reconciliation between imported copies and their external sources remains unspecified under [REQ-0036](requirements/REQ-0036-convert-imported-notes-and-tasks.md).

### No mandatory retention of every referenced external source

Content references normally point to live sources and may become unresolved after source deletion. Plugins may also reference available historical revisions of versioned content. [Content-reference navigation](requirements/REQ-0030-open-chats-with-content-references.md) does not require snapshots or universal source-deletion rules. Stored-content version history and traceable process history remain required independently of external reference resolution.

Source: Private plugin architecture clarification, 2026-09-29; not publicly available. Live references and optional historical references were confirmed without mandatory external-source retention.

### No shared organizational workspace

Situate's built-in product is the personal system of a single person. First-class shared workspaces, collaboration roles and collaborative merging guarantees are outside its scope. Built-in synchronization connects that person's devices. This does not prohibit explicitly developed plugins for other synchronization or collaboration workflows, nor does it promise built-in support or guarantees for them. Collaboration can remain in connected external services. Changes to shared external content remain within the requested task and configured account access, without per-action approval.

Source of the extensibility boundary: Private content and workspace architecture clarification, 2026-09-29; not publicly available.

Source for these boundaries: Private product-scope clarification conversation; date not recorded, transcript not included. Email and calendar services were excluded from the core; individual external integrations and the exclusion of jointly managed content within Situate were confirmed.

### No mandatory organizational method

GTD was an individual use case, not a mandatory model for all users. Supporting and improving a preferred working method remains in scope; requiring a change of method does not.

### Initial target audience is not the same as general onboarding

People who want to spend as little time as possible designing their personal organization are not the initial target audience. This does not permanently exclude them from the product.

## Source

Private goal elicitation conversation; date not recorded, transcript not included. Topics: initial target audience; emphasis on connecting systems and reducing maintenance; different organizational methods and desired improvement suggestions; the boundary between reversible internal work and external effects; confirmation that existing systems should be connected rather than necessarily replaced.
