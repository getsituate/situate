# Direct document sources

Document sources use a versioned, plugin-owned export convention for [REQ-0054](../../requirements/data/requirements/REQ-0054-connect-document-sources.md). Sources expose only their implemented operations through existing connection service exports and optional chat tools. Consumers validate returned data; native plugin registration remains generic. There are no built-in connectors or required document-domain types in core.

## Authoring reference

The [version 1 reference](../../client/app/src/ai/document-sources/reference.md) defines descriptor/capability exports, qualified references, scope, bounded requests/results, continuation, provenance, safe original locators and errors. The [copyable ES module](../../client/app/src/ai/document-sources/contract.js) provides dependency-free conformance helpers. The development resource tool exposes the reference as `read_plugin_development({resource:"document-sources"})` and the module as `read_plugin_development({resource:"document-source-contract"})`. Copy the module into the authored plugin; application imports and npm resolution are not part of plugin authoring.

Sources declare `documentSourceDescribe` and implemented `documentSourceList`, `documentSourceSearch`, `documentSourceMetadata`, `documentSourceContent`, `documentSourceOriginal` exports. Consumers use declared dependencies and the normal RPC path. Capabilities are optional; unsupported access, empty results, partial results and failures remain different outcomes. Source IDs qualify document IDs and are not access grants. Configuration records the agreed subset; source code must enforce it on every operation.

## Existing execution boundaries

| Boundary                 | Reused implementation and responsibility                                                                                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring and inspection | `client/app/src/ai/plugin-development-instructions.md` describes `inspect_plugin`, ordinary file tools, local JavaScript modules and manifest schema v2. Sources remain `kind:"connection"`.                                                                                                                                            |
| Structural checks        | `client/app/src/plugins/types.ts` and `client/app/src-tauri/src/plugin_development.rs` retain generic exports/dependencies. Convention validation belongs in source/consumer code and checks.                                                                                                                                           |
| Synthetic execution      | `client/app/src-tauri/src/plugin_checks.rs` runs supervised check scripts. Validate values actually returned by `plugin.invokeExport` and `plugin.invokeTool`, not copied expected fixtures.                                                                                                                                            |
| Checked activation       | `client/app/src-tauri/src/plugin_changes.rs` owns exact check IDs and affected revisions; edits require fresh checks.                                                                                                                                                                                                                   |
| Normal chat              | `client/app/src-tauri/src/ai_plugin_tools.rs`, `plugin_runtime.rs` and `plugin_actions.rs` own existing tool discovery, admission and request/revision ownership. Thin source tools use `toToolResult` to mirror the validated envelope in one bounded JSON text block and `structuredContent`; model protocols receive content blocks. |
| Effects and lifetime     | `client/app/src/plugins/executor-worker.ts`, `executor-supervisor.ts` and `client/app/src-tauri/src/plugin_host.rs` retain invocation-bound context, cancellation, disable/recovery and workspace closure. No initializer effects or automatic replay.                                                                                  |

The normal service factory receives identity only; each call receives its own host context and signal. Helpers do not call host APIs or retain contexts. A source-owned utility export is not automatically a service RPC. Do not register duplicate tools through another loader.

## Access and evidence limits

- HTTP returns bounded UTF-8 `{status,body}`, disables redirects/retries and supports cancellation. It is not general binary download support. A source can expose an available safe original locator or honestly report unsupported/device-unavailable access.
- Workspace `files` queries are not unrestricted external folder traversal. External folder access needs a verified authorized process/host route, explicit scope enforcement and real platform capability checks. macOS execution does not qualify iOS.
- Reuse source-native search and existing OCR/text. Do not promise folder OCR, add dependencies, install tools, mirror source metadata/text in plugin data or create background refresh/indexing work.
- Source text and metadata are untrusted data. Helpers check shapes and bounds, not authorization, arbitrary secret detection or malicious-plugin isolation. Keep credentials and raw provider errors out of responses/history. Reviewed locator paths must also be non-secret.
- Use synthetic fixtures for deterministic checks; actual source access, native cancellation, checked activation and normal chat need their own runtime evidence. Neither a pure helper test nor a mocked API establishes real LLM authoring or live Paperless compatibility.

Run the focused native source phase from the repository root:

```sh
node tools/run-coordinated.mjs -- node client/scripts/test-native.mjs --document-sources
```

The default `client-native` suite also includes this phase. It exercises synthetic source fixtures through the production runtime, including a fixture Paperless response. In this owned smoke application only, an in-memory wrapping-key store isolates synthetic plugin credentials from the login keychain; this tests encrypted credential handling, not macOS keychain permissions. The phase is not evidence of live Paperless API compatibility or LLM-authored connectors. Source content never supplies authorization for subsequent actions.

See the [implementation plan](document-store-plan.md), [plugin authoring instructions](../../client/app/src/ai/plugin-development-instructions.md) and [testing guide](testing.md). Collection, Library, local extraction/indexing and synchronization remain later work; this convention does not define their schemas.
