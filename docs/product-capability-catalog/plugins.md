# Plugins

Documentation date: **9 November 2026**.

This section assesses P01–P06 for the main application at the revision defined in the [Product Capability Catalog](README.md#product-revision-and-scope). It describes extensibility, not a catalog of ready-made integrations or a promise that every requested plugin can be developed successfully.

## Shared prerequisites and platform scope

- Agent-led development requires working model access and an open, writable workspace. Plugins belong to that workspace; different workspaces can contain different extensions and working methods. Development proceeds through source changes, checks of specific revisions and activation. Installed plugins must be enabled and compatible with their platform and required dependencies.
- **macOS:** the report traces native plugin execution, HTTP access and local program execution. Programs, OS permissions and external account setup are not installed or granted automatically.
- **iOS:** shared JavaScript/Vue and native executor mechanisms exist, with limited inherited simulator evidence. macOS system-program access is unavailable. Shared source and simulator observations do not establish physical-device or distribution qualification for a particular plugin.
- Plugins are trusted code, not adversarially sandboxed programs. Work stays within the user's request and configured access; external actions can execute without per-action confirmation. Closing a view does not stop already-running work, but workspace closure or application quit does.

The [shared status legend](README.md#status-and-evidence-legend) applies. Support below concerns whether the described result can be achieved under these conditions. Model quality, access to a particular account and platform qualification retain their own evidence boundaries. The older macOS prototype and workshop scenarios are not evidence of main-application capabilities.

## Capabilities

### P01 — Connect new data sources

Benefit: Develop connections to additional services so their contents can be used in Situate instead of remaining isolated in another system.

Support: **Supported**.

Prerequisites and limits: The service needs an accessible API that the plugin can call through Situate's available interfaces. Develop the required requests and expose the returned content through callable plugin functions. Account authorization, permissions and any credential renewal must be supplied or implemented for that service; a source check is not proof of successful account access. Text-based HTTP responses and device-local credentials are supported. Connections needing unavailable native interfaces or other response formats require additional capabilities, not just plugin configuration. Unlike Email and Calendar, this entry does not assume an already-working Google connector.

Evidence: **Code analysis** establishes service requests, credential access and callable connection functions; Q1 records native calls against an owned loopback service. This supports connection development under the stated API conditions, not a guarantee for every service or a verified login to a particular account. [Connection evidence](#connection-and-view-evidence).

### P02 — Develop custom tools and workflows

Benefit: Turn recurring steps into callable functions and combine existing functions into reusable workflows for the assistant or other plugins.

Support: **Supported**.

Prerequisites and limits: A workflow runs when called by the assistant, a user interaction or another plugin within a requested task. It can combine available functions, provided the required plugins are enabled and their data and actions are accessible. Inputs, errors and external prerequisites are handled by the particular workflow.

Evidence: **Code analysis** establishes callable functions and their composition; Q1 records native tool and service calls. [Execution details](#workflow-and-update-evidence).

### P03 — Create individual views

Benefit: Select information from accessible sources, combine it into a view suited to the user's work and provide controls for relevant actions.

Support: **Supported**.

Prerequisites and limits: The view needs accessible data and callable operations for its controls. Its source selection, refresh, editing and error handling are part of the plugin. It adds a view within Situate rather than replacing the application shell, navigation or chat. Accessibility and small-screen suitability depend on that view's design; faulty view code can freeze the shared application UI.

Evidence: **Code analysis** establishes custom views and their connection to data and actions. It does not establish the usability of a particular generated view. [View interfaces and source locations](#connection-and-view-evidence).

### P04 — Evolve extensions

Benefit: Change an existing plugin as needs develop, add behavior and make the revised extension available for continued use.

Support: **Supported**.

Prerequisites and limits: The existing version remains usable while a revision is prepared and checked. Switching to the revised version waits for affected running actions. A refreshed view may lose unsaved inputs; changes already saved to workspace files remain saved. Updates that change stored data need an appropriate conversion strategy in the plugin.

Evidence: **Code analysis** establishes source editing, checks and switching to a checked version; Q1 records native activation and reopening. [Update mechanics and evidence](#workflow-and-update-evidence).

### P05 — Store personal working methods

Benefit: Bundle guidance for working with the assistant in one workspace-specific plugin, such as preferred procedures, calendar practices and email style. Separate workspaces can retain different guidance.

Support: **Supported**.

Prerequisites and limits: A skills-only plugin can contain a single declared Markdown document without executable service or UI code. The package must be available and enabled in the relevant workspace: merely saving an arbitrary Markdown file does not automatically make it assistant guidance. Captured plugin skills are passed into the model's instructions for relevant work; they neither grant access nor create missing tools. Availability of the guidance does not guarantee that the model follows every rule correctly.

Evidence: **Code analysis** — R1, section 2 and B02–B03, plus focused inspection of [manifest validation](../../client/crates/situate-core/src/plugins.rs), `validate_sources`; [workspace skill capture](../../client/app/src-tauri/src/ai_executor.rs), `capture` and `CapturedTools::skills`; and [model instruction construction](../../client/app/src-tauri/src/ai_conversations.rs), `NativeHost::capture_instructions` and `run_instructions`. This establishes that the guidance reaches model instructions, not that the model follows every rule.

### P06 — Create custom information structures

Benefit: Develop collections with personally chosen fields, categories and relationships, then capture and maintain their contents where existing organization is unsuitable.

Support: **Supported**.

Prerequisites and limits: Develop and enable a plugin that defines the collection's fields, categories, forms and relationship rules in a writable workspace. Its functions can save records, read them for display, and change their values and relationships. Field validation and relationship consistency are the plugin's own logic. Larger collections and simultaneous edits must be handled within the [storage limits](#custom-collection-workflow-evidence).

Evidence: **Product specification** defines the intended collection benefit. **Code analysis** connects development and activation, view/service calls, record processing and persistent reads/writes into an executable workflow. [The step-by-step evidence](#custom-collection-workflow-evidence) distinguishes that path from practical qualification of a particular collection plugin.

## Evidence and open questions

### Source and report provenance

- **Product/source:** branch `use-case-validation`, commit `27b6831c3e55b2de4a59d6cd32cf1935d373338d` of 5 November 2026. No release version is asserted.
- **R1:** supplied report `Situate_Plugin-Entwicklung_Analyse.md`, titled “Situate: Plugin-Entwicklung durch den integrierten Coding-Agenten”, dated 6 November 2026, at the same main-application commit. It is an external, non-public source, not reproduced here. Its numbered sections and B-references identify the supporting passages. It records code analysis, inspected test sources and inherited execution records. Its separate prototype findings do not establish main-application support.
- **Q1:** [Provider qualification — Native application evidence](../development/provider-qualification.md#native-application-evidence), as stored at the baseline; last source change `cdad8ed2`, 4 November 2026. This is an inherited execution record, not a new run. macOS local/VM journeys use synthetic model responses and owned loopback services; the iOS observations concern a debug simulator app. Historical live-model records predating Rig do not qualify current free-form plugin development.

### Connection and view evidence

For P01, R1 sections 3.1 and B09–B10 and the [plugin host](../../client/app/src-tauri/src/plugin_host.rs), `http`, `credentials` and `dispatch`, establish callable requests and credential storage. At the source revision, `http` accepts a URL, method, headers and optional text body, and returns a status and UTF-8 response body. `credentials` supports reading, storing and removing named device-local values. After a connection plugin is developed and activated through the [source/check/activation path](#workflow-and-update-evidence), a view, chat tool or consuming plugin can invoke its declared functions. Those functions read supplied authorization values, construct requests, parse the returned text and expose usable source content as serializable export results or tool-result content. Request construction, response interpretation and service-specific authorization logic are ordinary adapter code. This connects access to the result described by P01, rather than just providing an isolated network primitive. HTTP requests and responses are bounded to 1 MiB, have a 30-second timeout and do not automatically retry or follow redirects. A service-specific authorization and renewal flow is connector code, not a generic login supplied by this host.

Q1's native Worker-tool and manual service-export calls against an owned loopback fixture demonstrate real HTTP effects, not real-account authorization. The [connection/platform boundaries](../development/workspace-development-plan.md#connections-and-platform-support) distinguish the connection's public functions from platform-specific access. A plugin's portability does not establish access to every source on iOS. The supported benefit is developing connections through usable interfaces, not completing every possible provider integration without service-specific work.

For P03, R1 sections 3.2–3.3 and B11–B13, [UI contribution validation](../../client/app/src/plugins/contributions.ts), `validateUiContributions`, and [plugin runtime](../../client/app/src/plugins/runtime.ts), `createPluginRuntime`, establish Vue views, settings and reusable components. The [development instructions](../../client/app/src/ai/plugin-development-instructions.md), `defineUI` and service-backed interaction, connect those views to callable functions and shared UI components. No practically verified custom-view usability is inferred from these interfaces.

### Workflow and update evidence

For P02, R1 section 2 and B03/B14, the [service and invocation contracts](../../client/app/src/plugins/types.ts), `PluginServiceContributions`, `PluginInvocationContext` and `PluginHostServices`, and the [development instructions](../../client/app/src/ai/plugin-development-instructions.md) define chat tools, explicit service exports and declared dependency calls. Each admitted call receives its own execution context and cancellation signal. Nested calls pass that context and signal rather than retaining them for unrelated work. The [Worker executor](../../client/app/src/plugins/executor-worker.ts), `invoke`, executes the selected tool or export with that context and returns its result. Q1 records native Worker-tool and manual service-export calls.

For P04, R1 section 2 and B05–B08/B17, [source operations](../../client/app/src-tauri/src/plugin_sources.rs), `dispatch`, [change checks and activation](../../client/app/src-tauri/src/plugin_changes.rs), `prepare`, `request` and `request_inner`, and [publication](../../client/crates/situate-core/src/plugins/publication.rs), `publish`, establish editing, checking selected revisions with dependencies and affected consumers, and activating the checked versions. Relevant source changes require fresh checks; activation waits for affected running actions. Source edits may be durable before activation. Code activation is not a universal data migration or rollback, and technical checks do not establish business correctness or security. Q1 records native activation, revision separation and reopening, not arbitrary free-form model development quality.

### Custom collection workflow evidence

**Product specification:** the supplied P06 definition, dated 7 November 2026, describes a collection with individually chosen fields, categories and relationships. R1 section 3.3 and B12/B17 identify views and persistence. The following code path at the recorded source revision connects the necessary steps; it is code analysis, not an executed collection trial.

| Necessary step                            | Executable path and responsibility                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Develop and make the collection available | The source/check/activation path above accepts a plugin's JavaScript service and Vue view. The plugin declares callable exports; no prebuilt collection component is required.                                                                                                                                        |
| Define and create the collection          | Plugin code can represent its field definitions, records, categories and relationship references as JSON text at a known path. `context.data.write(path, text, null)` creates a new file; native storage initializes its data area and parent folders. Field definitions and serialization are ordinary plugin logic. |
| Capture records                           | A form submits values through `service.invoke`; a chat tool can invoke record logic as well. The service validates values, assigns record identifiers, adds the record to the stored document and writes the changed text.                                                                                            |
| Read and display records                  | `context.data.read(path)` returns text and its revision. Service code parses the text and returns serializable records; the view uses them to display the collection and populate edit controls.                                                                                                                      |
| Change values or relationships            | The service reads the current document, applies field changes or updates references between record identifiers, validates its chosen relationship rules and writes using the read revision. Records and relationships can reside in the same document, so this path does not require a cross-file transaction.        |
| Reopen and continue editing               | The native content store persists the text independently of the view. A later invocation reads the same known path. A stale write is rejected, allowing the plugin to read the current state and resolve the conflicting edit.                                                                                        |

This is one construction using the available interfaces, not a required collection architecture or a finished collection plugin. A known document path suffices for reading and listing its records; the plugin-scoped data store does not need a directory-listing API for this construction. A missing or damaged store must be handled as an error, not silently treated as an empty collection.

The connected sources are [UI service invocation](../../client/app/src/plugins/runtime.ts), `invokeExport` and `service.invoke`; [native export dispatch](../../client/app/src-tauri/src/ai_executor.rs), `plugin_executor`, `Request::Invoke`; [Worker invocation](../../client/app/src/plugins/executor-worker.ts), `invoke`; [host services](../../client/app/src/plugins/host.ts), `createInvocationContext`; [native storage dispatch](../../client/app/src-tauri/src/plugin_host.rs), `Request::Read` and `Request::Write`; [plugin storage](../../client/crates/situate-core/src/plugins/storage.rs), `open`, `read` and `write`; and [content writes](../../client/crates/situate-core/src/content/agent_tools.rs), `agent_write`. The [authoring contract](../../client/app/src/ai/plugin-development-instructions.md) specifies service exports, forms through Vue views and invocation-bound data access.

Plugin storage accepts UTF-8 text up to 1 MiB per file and uses revision-checked writes. Field rules, record identifiers, reference validation, conflict handling and schema conversion belong to the plugin. Cross-file transactions and built-in relational constraints are not supplied by this read/write interface. The bounded single-document workflow above can achieve P06's result without those additional mechanisms. Collection scale, usability and the correctness of a particular plugin's rules remain matters for that plugin's qualification.

### Material open questions

Whether a particular service's authorization and requested operations work remains service-specific. For custom collections, practical usability, appropriate storage layout for the intended volume, and the correctness of field and relationship rules depend on the particular plugin. Free-form model development quality and native iOS suitability also require plugin-specific evidence. These evidence questions concern the particular plugin's implementation and use.
