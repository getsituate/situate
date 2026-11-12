# Document sources: direct-access implementation plan

## Selected iteration

Deliver direct access to connected document sources through chat, under [REQ-0054](../../requirements/data/requirements/REQ-0054-connect-document-sources.md) and [initial document access](../../requirements/data/foundations.md#initial-document-access-and-data-ownership). The assistant invokes source-provided capabilities on demand. Situate does not first ingest the source into its own collection.

Sources are implemented in situ by the LLM through the existing plugin-development mode. Local-folder and Paperless sources are qualification cases, not built-in connectors or a mandatory provider catalog. A source can reuse its own search and prepared text: Paperless can supply its existing search/OCR, while a folder source exposes only capabilities actually implemented by its plugin. No automatic folder OCR or content search is promised.

The [collection concept](../architecture/08-cross-cutting-concepts/document-collection.adoc), REQ-0055–REQ-0060 and the selected Library design remain the later target. Their approved status does not make the entire Document Store a dependency of this increment.

### Included

- A documented, versioned source-connection contract covering identity, scope, supported capabilities, bounded results, provenance, failure and lifecycle behavior.
- Unchanged generic plugin registration/discovery; source behavior is a plugin-defined export convention with authoring and conformance helpers, not a mandatory core-owned document contract.
- LLM-assisted source creation, checks and activation using existing development tools.
- Chat tools for implemented source capabilities: listing, source-native search, metadata and content reading, and original access where supported.
- Clear distinctions between unsupported capability, empty results, partial results, inaccessible content and unavailable source.
- Existing device-local credential handling, workspace ownership, plugin disable/recovery and cancellation.
- End-to-end source authoring and normal-chat use for a local folder and Paperless.

### Not in this iteration

- A Situate-owned document collection, authoritative document-metadata store, full-text engine, extraction/OCR pipeline, categorization or background ingestion/refresh scheduler.
- Situate tags, saved searches, PDF/image reader, thumbnails, preview cache or Library UI. No new source-management screen or connector-specific wizard is required; use existing plugin management/development surfaces.
- Synchronization of prepared content, document-history repository decisions, deletion propagation across replicas or cross-device preparation coordination.
- Semantic search, embeddings, classifier models, or adoption of Xberg merely to implement source access.
- A universal original-write API, automatic source changes, migration of originals or expanded blanket device permissions. Existing legitimate agent/plugin operations remain governed by the user's request and current access rules.
- Rebuilding plugin development, grouped activation, the service executor, credentials or the general tool registry.

Existing conversation history and plugin configuration may retain their normal records. “No document store” does not promise erasing content already included in a conversation. This iteration must not add a durable full-source mirror or indexing cache disguised as connector state.

## Current implementation baseline

Source inspection baseline: local checkout at `0c226ffc`, also the locally available `origin/main` at review. The paths below establish implementation starting points, not fresh runtime or platform qualification. The older [plugin iteration proposal](plugin-iterations-proposal.md) describes an earlier proposal and is not the current SDK contract.

| Boundary                      | Existing paths and observed contract                                                                                                                     | Consequence for this increment                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin authoring instructions | `client/app/src/ai/plugin-development-instructions.md`, `.ts`; `client/app/src-tauri/src/plugin_development.rs`, `plugin_changes.rs`, `plugin_checks.rs` | Real authoring/check/activation paths exist. Extend discoverable source guidance and contract checks, not a parallel development mode.                                                                                              |
| Manifest and services         | `client/app/src/plugins/types.ts`, `contributions.ts`, `executor-worker.ts`; `client/crates/situate-core/src/plugins/`                                   | Schema v2 supports `kind: connection` or `tool`, explicit service exports, tools and required dependencies. There is no inspected document-source descriptor yet. Prefer a narrow convention over introducing another package type. |
| Invocation-bound SDK          | `client/app/src/plugins/host.ts`, `types.ts`; `client/app/src-tauri/src/plugin_host.rs`                                                                  | Reuse `config`, `data`, device-local `credentials`, `network.request`, `process.capability/run` and dependency invocation. Factories have no effect authority; calls receive their own cancellation context.                        |
| HTTP                          | `client/app/src-tauri/src/plugin_host.rs`                                                                                                                | Current HTTP returns bounded UTF-8 `{status, body}`, disables redirects and retries, and supports cancellation. It is not a generic binary download API. Do not assume a PDF body is readable through it.                           |
| Local files/processes         | `client/app/src-tauri/src/plugin_file_queries.rs`, `plugin_host.rs`; `client/app/src/plugins/process-lifecycle.ts`                                       | Workspace file queries are bounded UTF-8 operations; they are not arbitrary folder traversal or OCR. External folder access must use an actually available, authorized host/process route and report platform limits.               |
| Agent/plugin execution        | `client/app/src-tauri/src/ai_plugin_tools.rs`, `plugin_runtime.rs`, `plugin_actions.rs`; `client/app/src/plugins/executor-supervisor.ts`                 | Use native admission, tool descriptors, exports and existing cancellation/disable behavior. Do not restore the obsolete frontend `ai/tools.ts` integration assumed by earlier plans.                                                |
| Management and validation     | `client/app/src/plugins/PluginManagement.vue`, `management/`; `client/app/tests/browser/plugin-development.spec.ts`                                      | Existing management and development UI suffice for the first slice. Add only necessary contract/error presentation through current surfaces.                                                                                        |
| Native test infrastructure    | `client/app/src-tauri/tests/support/plugin_runtime_smoke.rs`, `client/scripts/agent-e2e-plugins.test.mjs`, `agent-e2e-plugin-reopen.test.mjs`            | Extend actual plugin/tool journeys and distinguish fixture execution from real LLM authoring. Existing test files alone do not prove either qualification case.                                                                     |

The authoring contract currently separates external access into a connection and a workflow/view consumer into a tool plugin when both are present. A source connection can supply direct chat tools when no separate workflow is needed; do not invent an empty consumer solely to split files. If a consumer is necessary, use declared dependencies and explicit exports rather than duplicating HTTP, credentials or process code.

The SDK currently names macOS/iOS platforms. Desktop process availability cannot be inferred for iOS, nor does a browser test qualify device access. Exercise the first native source journey on the available macOS runtime and report other platform coverage explicitly; this plan does not change product platform commitments.

## Contract to finalize

Retain the existing generic plugin registration and service export/tool transport unchanged. Source implementations own a versioned export convention: a descriptor and capability-specific exports, optionally called by thin chat-tool wrappers. Authoring guidance and reusable conformance helpers describe and test this convention; native registration does not enforce a new document-domain schema. Consumer plugins validate the source results they use. Exact export names and schemas remain to be specified. Any necessary core extension requires a separately justified decision, not an implicit source-registry change. Do not freeze a large ingestion SDK for future collection work.

| Concern                   | Required first-iteration semantics                                                                                                                                                                                                                                     | Deliberately not required                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Source identity and scope | Owning plugin and source/account instance, human-readable source label, agreed included/excluded subset and device/access constraints. IDs are not access grants.                                                                                                      | Collection-wide document IDs, replicated records or a central source database.                               |
| Capability declaration    | Explicitly identify implemented list, source-native search, metadata read, content read and original-access operations. Specify search coverage: filenames, metadata, text or another source-native behavior. Missing capabilities are unsupported, not empty success. | Every source implementing every operation, or uniform search ranking/query syntax.                           |
| Document references       | Source-qualified document identifier or locator, title/path where available, and source revision/change token when actually supplied. Explain unstable path identity; never silently retarget a stable reference from equal bytes or a reused path.                    | Guaranteed identity across arbitrary folder moves, universal historic references or Library deep links.      |
| Result bounds             | Bounded batches/text, continuation or explicit truncation, partial-result status and any source-reported total. Validate continuation against the source/query context; do not claim a complete source scan after one page.                                            | Full collection enumeration as a prerequisite for answering chat.                                            |
| Provenance                | Carry source, document reference and available revision/page/section with results. Distinguish source-native OCR/text from metadata only. Do not fabricate page numbers or freshness evidence.                                                                         | Mandatory PDF rendering or local extraction when the source provides no text.                                |
| Original access           | Identify whether content, an authorized handle or a safe external locator is available on this device. Keep secrets and credential-bearing URLs out of ordinary responses/history. Report unsupported binary retrieval honestly.                                       | New download/cache infrastructure or a universal write API.                                                  |
| Failures                  | Separate unsupported, permission/authentication failure, not found, source unavailable, partial result and cancellation. Preserve known outcome and do not imply an external action had no effects after interruption.                                                 | Interpreting a temporary outage as deletion or retaining stale source content as an active local collection. |
| Lifecycle                 | Use the invocation's workspace, plugin revision and cancellation context. No retained context, initialization effects or automatic redispatch after interruption. Existing disable/recovery gates remain authoritative.                                                | Polling jobs, watchers, ingestion checkpoints or cross-device execution leases.                              |
| Persistence               | Use existing plugin configuration and device-local credentials only as needed for access and scope. Ordinary chat retains its own results.                                                                                                                             | Mirroring originals or persisting all metadata/text in plugin data as a hidden index.                        |

Treat source-returned text as untrusted content, not development instructions, authorization or executable templates. Reading through chat uses the selected authorized chat model under existing provider rules; it is not a new background categorization consent or blanket local-only processing guarantee.

### Decisions that can block implementation

1. **Export discovery:** specify how authoring guidance and consumers discover the source convention through existing explicit exports and declared dependencies. Generic registration and manifest `connection` semantics remain unchanged; there is no separate source registry or required manifest domain discriminator.
2. **External-folder access:** verify the supported host/process route, scope enforcement, bounded output and platform limitations. Do not equate `context.files` with unrestricted filesystem access. Do not add automatic tool installation or permission setup.
3. **Original/binary access:** confirm the useful first capability with current host support. If binary retrieval is not supported, expose an honest locator/unsupported outcome rather than designing a preview stack. A required new host capability needs an explicit scoped decision.
4. **Source contract details:** settle descriptor/export names, schema versions, bounds, continuation and error shapes, with fixtures executable through the actual plugin check API.

Library layouts, OCR engines, tag storage, embeddings, Git metadata topology and synchronization protocols do not block this iteration.

## Implementation sequence

### 1. Trace one existing plugin tool end to end

**Work**

- Follow authoring → structural checks → synthetic service checks → activation → normal-chat tool selection → native admission → host request → tool result/history.
- Inventory current contribution and dependency validation, request/revision ownership, disable/recovery and reopening behavior. Confirm which pieces already satisfy the source contract before adding code.
- Probe external-folder and HTTP/text support with synthetic fixtures and installed local capabilities. Check limits and unsupported responses, not just happy-path access.
- Agree the contract decisions above and identify a small set of source-specific gaps. Keep runtime changes local to demonstrated gaps.

**Exit:** a concrete map of reused APIs, chosen source discovery convention and any actual host limitations; no assumption that plugin development is still missing.

### 2. Implement and expose the source contract

**Depends on:** stage 1.

- Define descriptor/result schemas and reusable conformance checks for the plugin-owned export convention. Apply domain validation in generated source/consumer code and development checks, not as an additional native registration gate. Keep credentials, runtime handles and plugin executable code outside serializable result metadata.
- Reuse service exports and existing chat-tool descriptors; preserve valid non-source plugins unchanged. Do not register duplicate tools through both a new source loader and the current plugin loader.
- Supply concise source-authoring guidance through the existing development resource/instruction path. Cover scope, supported operations, provenance, pagination, errors and actual host limits without copying the whole SDK into every prompt.
- Supply conformance helpers/fixtures that run through `check_plugin_changes` and actual captured service exports/tool invocations. Keep examples synthetic and distinguish optional capabilities from mandatory ones.
- Scope future extensibility to versioned contracts and explicit capability declarations. Do not add unused ingestion, categorization, tag or synchronization interfaces.

**Exit:** contract tests accept a minimal supported source and reject malformed/inconsistent declarations; the development agent can discover how to implement it without editing application source.

### 3. Connect source operations to normal chat

**Depends on:** stage 2.

- Expose source tools through unchanged enabled-plugin contributions and native invocation ownership. Ensure subsequent requests see checked active revisions while in-flight behavior follows existing lifecycle rules.
- Return bounded source-qualified results and readable explanations; preserve provenance in structured tool results and the ordinary transcript. Unsupported search/content access must not become a fabricated empty result.
- Use current configuration/credential services and declared dependencies. Do not expose credentials, raw confidential error bodies or signed authorization URLs in prompts, tool output or diagnostics.
- Exercise read/list/search operations without introducing source mutations. Existing user-authorized write capabilities are neither removed nor automatically invoked by this read-focused workflow.
- Preserve disable/re-enable, recovery, workspace closure, cancellation and restart behavior. No source initialization network calls or hidden background refresh.
- Reuse existing UI and central localization for host-visible errors. No Library view, custom document browser, preview pane or separate source setup screen.

**Exit:** normal chat can discover and use a generated source's supported operations; disabled/unavailable sources and incomplete results remain explicit. Non-source plugin tools continue working unchanged.

### 4. Qualify generated local-folder and Paperless sources

**Depends on:** stages 2–3 and the integrated existing development mode.

- Through a real development conversation, ask the LLM to implement a local-folder connection against the published contract. Use a disposable source directory containing synthetic text and unsupported binary examples. Verify listing, available metadata/text reading, declared search coverage and scope boundaries; no extraction/OCR promise is implied for PDFs/images.
- Through the same product path, ask it to implement a Paperless connection against an isolated synthetic Paperless instance for real API qualification. Use deterministic HTTP fixtures first for repeatable checks, but do not present a mock server as proof of live Paperless compatibility.
- Verify Paperless search, metadata and existing OCR/text use without creating a local index. Read original content only if the generated source has a supported route; otherwise explain its unavailable capability.
- Use actual checks and activation, then normal-chat tool invocation. Do not substitute hand-installed connector implementations or manually registered fixtures for the source-authoring acceptance journey.
- Verify consumer reuse where applicable, source edits/activation, changed credentials, no matches, multiple pages, source failure, permission loss, cancellation and reopening. Preserve original files and Paperless records.
- Keep the existing rule that actual model generation and real external-service access require authorized providers/accounts. A deterministic provider can verify the execution path but cannot establish that an LLM independently authored a correct integration. Report those evidence classes separately.

**Exit:** both sources are created and used through production plugin development/chat. Repeatable contract/runtime tests pass and real authoring/API evidence is recorded; unavailable prerequisites block the corresponding acceptance claim.

### 5. Regression and merge verification

**Depends on:** stages 1–4.

- Test existing plugin tools, dependency consumers, checks/activation, disable/recovery, normal-chat persistence and workspace isolation after integration.
- Measure bounded pagination and reading against large synthetic source listings without fetching all originals or constructing a mirror. Source latency and capabilities remain source-specific; the later collection's indexing benchmarks are not an acceptance gate here.
- Test malformed content and tool output, path/query escaping, out-of-scope access, output bounds and credential redaction. Trusted plugins are not a sandbox; do not claim this contract prevents arbitrary malicious plugin behavior.
- Document the implemented source contract and authoring usage, including capability limits. Keep later collection architecture explicitly deferred rather than describing it as implemented.
- If main advances, integrate or rebase as authorized and rerun affected checks on that exact tree. There is no longer a blanket wait for an absent plugin-development subsystem; any remaining integration gap must be demonstrated against current code.

**Exit:** the direct-access acceptance matrix passes, real source authoring is verified, and no Library/index/synchronization work is needed to call this increment complete. No remote merge, publication or paid testing is authorized by this plan alone.

## Acceptance matrix

| Scenario                                               | Required result                                                                                                                           | Primary evidence                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| LLM-generated local-folder source                      | Checked/adopted source is usable in ordinary chat; original files stay intact and agreed scope is honored.                                | Real authoring/native chat journey plus deterministic contract tests.                   |
| LLM-generated Paperless source                         | Chat uses source-native search, metadata and OCR/text with provenance, without a Situate index.                                           | Real authoring and isolated Paperless API journey; mocked checks separately identified. |
| Source lacks OCR/content search                        | Tools declare limits and explain unsupported requests, rather than inventing extracted text or no matches.                                | Contract/tool-result tests.                                                             |
| Empty versus partial results                           | No matches are distinct from truncation, next page, failure or unsearched content.                                                        | Bounded query/read tests and chat output checks.                                        |
| Missing permission, credentials or platform capability | Clear unavailable outcome; no provider switch, permission bypass, installation or copied-original fallback.                               | Host/adapter integration and native capability checks.                                  |
| Two sources use the same path or document ID           | Results remain source-qualified; references are not silently merged or redirected.                                                        | Reference/result schema tests.                                                          |
| Disabled source or workspace closure                   | New calls are prevented; running calls follow existing cancellation/disable semantics, with no automatic replay after restart.            | Runtime integration and reopen journey.                                                 |
| Changed source implementation                          | Only checked active versions are used under existing request consistency; unrelated plugins remain intact.                                | Activation/dependency regressions.                                                      |
| Document contains instructions or sensitive strings    | Content remains data; credentials/private payloads do not enter diagnostics or source code.                                               | Boundary/security tests with synthetic sentinels.                                       |
| Existing source write tools                            | Read-focused tests cause no writes; this feature does not remove independently authorized operations or introduce universal write access. | Side-effect assertions and existing authorization regressions.                          |

## Later Document Store roadmap

These remain accepted product directions, not completion criteria or implementation prerequisites for direct access. Revisit their sequencing and technical choices when that increment is selected.

| Later increment                        | Retained target                                                                                                                                                                   | Decisions/qualification still needed                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Collection data and identity           | Openly editable authoritative records, provenance, tags, saved searches and durable prepared text; reliable source identity, distinct copies and conservative ambiguity handling. | File schema, coherent writes/external-edit reconciliation, relation to note/plugin histories and optional dedicated Git repository. |
| Local preparation and full-text search | Reusable local extraction/OCR, current source-text reuse, incremental/resumable processing and full-text queries with identifiers, all-term matching and phrases.                 | Xberg/library/license/platform evaluation, index engine, multilingual fixtures, resource limits and tens-of-thousands benchmarks.   |
| Categorization                         | Configured authorized LLM, fixed tag format, one invalid-format retry, valid empty result, marked excerpts and race-safe one-time tag assignment.                                 | Schema, excerpt selection, provider-error policy and source-specific authorization for automated processing/cost.                   |
| Organization and Library               | Selected Library layout, any/all hierarchical tags, identity-preserving rename, collision-safe deletion, coherent saved-search updates and explicit saved-search editing.         | Real UI adoption, accessibility, large-list pagination and persistence integration.                                                 |
| Reading and removal                    | Real PDF/image preview, bounded local cache, outage versus confirmed-removal behavior and unresolved old references.                                                              | Renderer/platform support, cache limits, late-result invalidation and cleanup failure handling.                                     |
| Cross-device prepared content          | Portable prepared information without originals, device-specific availability and non-resurrection after removal.                                                                 | Actual transport, coherent snapshots, conflict/removal semantics and processing ownership; no credential/cache transfer.            |
| Further deferred capabilities          | Semantic search, classifiers, source/folder navigation and optional managed-original storage retain their existing separate delivery boundaries.                                  | Separate scope selection; direct access does not authorize them.                                                                    |

The initial source contract should preserve origin, capability and revision information useful to these increments. It need not implement all their operations or promise a final collection schema now. Later query/collection code can consume source exports without moving raw access into the core.

## Verification commands and evidence limits

Follow [repository testing](testing.md). Start with the relevant source contract, plugin runtime, host and authoring tests, then run:

```sh
node tools/test.mjs --quick --changed
node tools/test.mjs --feedback --changed
```

Quick checks are bounded, dependency-free source checks; they do not replace feedback's affected unit, lint/format and type checks. Do not increase the quick budget to accommodate longer checks.

Register new test files with the central runner and use existing supervised check fixtures, synthetic HTTP/process responses and native plugin journeys. Extend product browser flows only where actual management/chat behavior changes. If visible changes require new screenshots, use the repository's locked Linux visual workflow; a dedicated document screenshot suite is unnecessary.

For affected pre-merge verification, run `node tools/test.mjs --changed --base origin/main` against an up-to-date base, including committed branch changes. Follow the repository's required PR gates; `node tools/test.mjs` without filters remains the full MVP verification command. Neither quick nor feedback replaces pre-merge verification. Run relevant host/native journeys on the integrated source. Mocked provider responses, Chromium/WebKit results and macOS execution do not establish actual LLM authoring, real Paperless API compatibility or iOS filesystem/process capability.

For catalog/architecture changes, use the runner's affected documentation/catalog checks. When an explicit rendering or viewer build is needed, join the worktree queue and shared build lease rather than racing other artifact writers:

```sh
node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- npm --prefix requirements run build
node tools/run-coordinated.mjs -- node tools/run-coordinated.mjs --resource build -- asciidoctor --failure-level WARN -o docs/architecture/index.html docs/architecture/index.adoc
```

Other direct tests or artifact-writing commands must use the coordination described in [repository testing](testing.md). A documentation-only change does not require application/native builds merely because this plan describes their future acceptance.

Report source revision, platform, observed behavior and unexecuted prerequisites. Use disposable workspaces and synthetic source data; personal archives, credentials and paid-provider access require explicit authorization. Direct source access is complete only after authoring and chat use pass, but it does not wait for Library, OCR, local indexing or synchronization implementation.
