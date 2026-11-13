# Situate client

The active MVP target is **macOS only**. iOS, Windows, Linux desktop and Android are deferred and are not currently supported. Their source, build commands and diagnostic instructions below are retained for optional future work, not as current compatibility or release guarantees. Routine development does not require their SDKs or verification. See the [platform scope](../requirements/data/foundations.md#mvp-platform-scope).

The client opens the last-open workspaces, or shows **Workspaces** when none can be reopened. Each macOS workspace has its own 1280 × 800 px window. The retained, deferred mobile implementation keeps multiple open sessions and displays one at a time. The main screen uses the [production app shell](app/src/components/AppShell.vue) and canonical brand assets. Below 1184 CSS px, the sidebar opens as a modal drawer with keyboard focus handling, Escape and backdrop dismissal.

Desktop windows retain separate native titlebars; workspace entry fills the content area beneath them. Creation fields scroll independently of Cancel/Create. On Android, the native WebView container consumes system-bar, cutout and keyboard insets; on iOS, CSS safe areas and the visual viewport constrain content.

The **Files** view provides file navigation, text source editing, rendered Markdown reading, automatic saving, conflict review and history. Chat supports editable drafts and text/image attachments; connecting workspace AI access on macOS enables streaming conversations. On macOS, Settings and the sidebar provide plugin management.

Chat dictation requires macOS 14 or later on Apple Silicon. It uses Parakeet v3 locally and inserts recognized speech into the editable draft without sending it. Release builds download model files automatically over Wi-Fi or Ethernet; desktop development uses a [local model source](../docs/development/README.md#local-dictation-models). **Settings → Dictation** shows progress and offers a retry after failures. Cellular routes reported by macOS are excluded, but tethered connections can hide their upstream transport. Dictation on Intel Macs and iOS is deferred.

During recording, the waveform follows microphone loudness. Situate also attempts to pause the system’s current media session and resume it when recording stops, including on cancellation or failure. Media that was already paused is left alone, and a different current player is not resumed. This macOS integration uses the private MediaRemote framework through a bundled helper loaded by `/usr/bin/perl`; it is best-effort and may stop working after system updates. It is not an App Store-compatible API. Unsupported or unavailable media control does not prevent dictation.

## Web research in chat

Chat includes `web_search` and `web_fetch` without additional setup. Searches go directly from the device to Keenable, Exa or DuckDuckGo in a shuffled order, trying another service after a failure. The first successful response returns up to five results; an empty result does not trigger another service. Search terms are sent to the selected services, not a Situate search server. Public access limits and service availability still apply.

The assistant can read public HTML, plain-text and Markdown pages, with bounded downloads and extracted content. Returned pages include their source URL and indicate truncation. Private network addresses, login flows, browser rendering and PDF extraction are not supported. Search and page requests stop when the conversation is stopped or its workspace closes.

## Workspaces

- **Create a workspace** first makes a new named child of the selected parent folder with a `.situate` metadata directory. The Files view subsequently initializes local history for supported writable locations. Creation does not initialize plugins or synchronization. An already occupied target is rejected. If creation partially succeeds, the error identifies what remains; use the separate opening route rather than trying to create that folder again.
- **Open a workspace** uses the operating system's folder chooser. A readable `.situate` directory is required; an ordinary folder or a `.situate` file does not qualify. Recognition is not a trust or integrity check. AI settings and conversation history are restored. The Files view reads workspace content, but does not execute stored code.
- The workspace menu in the sidebar opens **Workspaces…** and offers **Close workspace**. Selecting an open workspace focuses its desktop window or switches the active mobile session without closing the previous one.
- **Remove from list** only removes a remembered location. It neither deletes files nor closes an open session. Switching and startup restoration do not re-list a removed workspace; explicitly opening it through the chooser does.
- Closing a workspace removes it from startup restoration but leaves it listed. Quitting preserves the restore set. Closing all workspaces returns to Workspaces. An inaccessible restored location stays available for Retry or Grant access; other accessible workspaces can still open.
- **Bring a workspace from sync** is disabled. No synchronization service is contacted.

Creation proposes the OS Documents folder when available. In the retained, deferred Android and iOS implementations, **Documents — Situate** means application-owned Documents, not a shared provider folder. Application-owned data can be removed when the app is uninstalled. Choose another location through the native folder chooser when appropriate; no cache or temporary directory is substituted if Documents is unavailable. iOS application Documents is also exposed through Files.

Deferred mobile reference: Android provider access uses Storage Access Framework tree URIs and persistent grants. iOS provider access uses security-scoped bookmarks and coordinated directory operations. These handles are not ordinary paths. Providers must allow readable, writable directories and the literal `.situate` name. Unavailable, read-only or unsupported locations produce errors, not replacement workspaces. Android providers can rename colliding requests; such a result is rejected and any leftover directory is identified rather than silently accepted.

Path-backed creation holds the parent and new child directory open, rejects child symlinks and nonempty children, and writes `.situate` relative to the held child. Identity checks before initialization and after location/bookmark creation reject detected replacements. These checks are not a filesystem sandbox: `mkdir` and opening the new directory are separate operations, so an empty directory substituted before the first child handle is acquired cannot reliably be distinguished from the newly created directory. Locations can also change after the final check. Do not move or replace the target during creation. Errors preserve partial directories rather than deleting paths whose ownership may have changed.

Device-local names, access handles and startup locations are stored in the versioned `workspaces-v1.json` registry in application data, outside workspace directories. Updates are serialized and atomically replace that file. Unsupported or damaged registry data is not silently reset. Do not publish that registry: names, locations and access handles are private navigation metadata.

The native host retains a `save_text` IPC command and Rust filesystem operation, covered independently by tests. The interface does not invoke it. Writes replace `text.txt` in the application's local data directory, preserving UTF-8 text including whitespace and empty input; they are not atomic or versioned storage. Use test content rather than valuable notes.

## Conversation history

Conversations use `.situate/conversations/<id>/metadata.json` and append-only `history.jsonl`. Older messages load on demand. Compaction changes the model context without deleting original messages or copying shared history into another file.

Opening a legacy workspace converts its conversations through the workspace migration runner. The conversion requires app version **0.1.6 or newer** and has no reverse conversion or older writer. Do not reopen the migrated workspace in an older app; versions predating the compatibility gate may not refuse it safely. Migration failure keeps the workspace closed with recoverable managed data rather than opening an empty replacement.

Before upgrading, close the workspace in every app installation and back up the closed directory. Update every installation that will reopen it to 0.1.6 or newer.

Submitted inputs are saved, including inputs waiting while another response runs. Unsaved drafts stay with the live conversation owner and may be lost after a crash. Reopening never automatically resumes a model request or repeats a tool call; a call without a saved result has an unknown outcome.

## Plugin-free startup on macOS

Quit Situate first. If its interface is frozen, force-quit it using macOS; unsaved work may be lost. Then start an installed application in recovery from Terminal:

```sh
open -n -a Situate --args --recovery
```

For an unpackaged build, pass `--recovery` to the application executable. Do not leave another Situate process running against the same workspaces: `open -n` starts a new process, rather than changing the existing process's mode.

Recovery temporarily pauses installed plugins across all workspace windows without changing saved enabled/disabled preferences. Before mounting the interface, each window reads the native mode and resumption state; a failed lookup shows a startup error instead of proceeding normally. Installed code stays unloaded, including in workspaces opened later, while built-in files, chat and Settings remain available. Restored plugin panes offer built-in resume, management and source-inspection actions.

Use **Resume plugin** in Settings → Plugins or **Resume all plugins** in the application notice without restarting. Resume-all preserves permanently disabled plugins. Recovery ends when no known enabled plugins remain paused; unreadable workspace inventories keep it active until an explicit resume-all. Additional workspaces opened while recovery is active start paused. Closing and reopening a workspace clears its individual resumption choices. `--without-plugins` is also accepted as a startup flag.

Requested development retains ordinary workspace access, synthetic checks, previews and checked activation in recovery. Successful activation resumes only its selected targets; unrelated plugins remain paused. No action replays an interrupted conversation. Testing or resuming faulty code can freeze Situate again. Recovery is not a sandbox, rollback or repair of earlier damage, and does not delete plugin code or data.

## Plugin source inspection

On macOS, chat can inspect workspace-local plugin packages through the built-in `inspect_plugin` tool, including during recovery. Source inspection never enables a plugin, imports JavaScript, or adopts its skills as conversation instructions. Inspection does not install or activate a plugin.

Package source lives at `.situate/plugins/<pluginId>/code/`. The code folder contains `plugin.json`, for example:

```json
{
  "schemaVersion": 1,
  "id": "weekly-review",
  "name": "Weekly review",
  "description": "Review unfinished work and choose next steps.",
  "skills": ["skills/review.md"],
  "entry": "index.js"
}
```

`skills` is optional and defaults to an empty list. `entry` is an optional JavaScript source path for executable contributions; at least one skill or an entry is required. Declaring an entry does not make it executable. Skills must reference UTF-8 `.md` or `.markdown` files; the entry must reference a UTF-8 `.js` file. The manifest ID must match its package directory. Optional `kind` is `connection` or `tool`; `dependencies` lists required local plugin IDs, `exports` lists explicit exported function names, and `platforms` can restrict availability to `macos` or `ios`. Required dependency availability also constrains consumers; these declarations do not establish native platform qualification. Unknown fields, unsupported schema versions, duplicate source declarations and invalid paths are rejected.

The tool supports four operations:

- `list`: no additional arguments; returns packages and attributable validation errors.
- `files`: requires `pluginId`; returns code-relative files and directories, including ordinary dotfiles but not Git internals.
- `read`: requires `pluginId` and `path`; reads UTF-8 source, including an invalid manifest for diagnosis.
- `validate`: requires `pluginId`; checks the manifest and declared source files, not JavaScript syntax, successful loading or functional behavior.

Plugin IDs use up to 64 lowercase ASCII letters, digits and interior hyphens. Source path components use ASCII letters, digits, dots, underscores and hyphens; traversal, reserved names, symlinks and special files are rejected. Inspection is limited to 128 packages, 1,024 entries per package, 16 path components, 512 path bytes, 64 KiB per manifest, 1 MiB per text read and 8 MiB of declared source per validation. Exceeding a limit fails rather than returning truncated content. Observations are not atomic snapshots of external edits.

Source inspection creates no storage or history and exposes no configuration or user-data directories. The native command authorizes the open workspace and the recorded tool intent for the active conversation run. Other platforms do not advertise this tool. Checked activation uses the development workflow below.

### Plugin runtime

On macOS, each workspace owns a separate plugin runtime. Retained enabled status and pinned revisions live in `.situate/plugins/<pluginId>/.runtime/runtime-state.json`, with a separate installation identity in `.runtime/identity`. Missing status means disabled, so placing source in a package directory does not execute it. Invalid status fails closed without replacing the file. The native `plugin_runtime({ scope, request })` command supports `list`, `load`, `check`, `setEnabled` and `uninstall`; enabling/disabling requires `pluginId`, `enabled` and the `expectedRevision` from `list` (`null` for absent state). Source loading and invocation checks require enabled status and a plugin that is not temporarily paused. Listing and disabling remain available in recovery. Before execution, enabled unversioned legacy packages are pinned without enabling or resuming other packages. Disabling shows affected consumers, waits for affected running work and persistently disables direct and indirect consumers together. Re-enabling the dependency alone leaves those consumers disabled. Explicit enabling also resumes its target. Settings → Plugins lists installed packages, their status and applicable actions. It provides read-only source inspection, enable/disable, plugin settings, and new or further development. Recovery retains source inspection and ordinary development; installed code remains paused until resumption or checked activation.

Uninstallation removes the complete plugin directory, including configuration, data, drafts and plugin-specific histories. Installed dependents, including disabled ones, and running actions block removal. The client also reconciles external directory deletion while a workspace remains open: tools and views are withdrawn and obsolete plugin navigation is cleared. Ordinary notes, tasks, documents and conversations outside the directory remain intact. A new installation with the same ID does not reuse the removed installation’s execution handles or settings. An uncertain removal is inspected before any further attempt.

Existing global plugin state is transferred only into already-existing plugin directories with attributable retained source history; an unproven record never enables a replacement installation. Legacy drafts belonging to existing directories move with their owners; orphan legacy drafts remain inert in `.situate/plugin-drafts-legacy` and cannot recreate or attach themselves to a later installation. Unattributable legacy metadata artifacts remain in `.situate/plugin-metadata-legacy`; unprovable device credential orphans are not adopted by a later same-ID installation. Legacy host layout is preserved as an inert recovery snapshot before replacement when its plugin presentation lacks installation provenance. These recovery records are not installation indexes or automatically restored plugin state.

An executable entry is a JavaScript ES module whose default export is a factory receiving `{ vue, ui, navigation, signal, files, config, data, credentials, network, process, dependencies }`. Return an object with optional `tools`, `views`, `settings`, `exports` and `dispose`. Skills-only packages need no entry. The host imports a fresh module instance per workspace, validates contributions before registration, and retains attributable errors without exposing raw exceptions. Plugins can split implementation into local `.js` modules using static imports and re-exports, for example `import { parseTasks } from "./tasks/parser.js"`. Paths resolve relative to the importing file; `../` may reach another directory inside the same package, but not escape it. Use explicit file extensions. The host links the captured module graph without reading editable files during execution. npm resolution, absolute paths, URL imports, directory imports, dynamic imports, `import.meta`, import attributes, circular imports and external authoring builds are unsupported. Missing modules and unsupported imports fail checks and loading without activating new code.

Keep the entry focused on wiring contributions, and separate parsing, workflow logic, views and copy where useful. Local module exports are private implementation details, not manifest `exports`. Create separate plugins for independent integrations or deliberately reusable capabilities, not merely to split files. Checks and runtime loading capture all package `.js` files and declared skills from the same code revision, limited to 8 MiB combined and 1 MiB per file. A new runtime load creates a fresh module graph; shared imports within that graph evaluate once.

- `vue` provides shared `defineComponent`, `h`, `ref`, `shallowRef`, `reactive`, `computed`, `readonly`, `watch`, `watchEffect`, `onMounted`, `onUnmounted`, `onBeforeUnmount`, `nextTick` and `compile`. Vue component templates compile locally; the compiler uses the same Vue runtime as the application.
- `ui` provides the canonical `Situate*` components. Application code can import individual components through `@situate/ui/components/<ComponentName>`; plugin entries use the supplied object instead of importing application packages.
- `navigation.open` and `navigation.reveal` use the [workspace view contract](../docs/development/workspace-views.md). View IDs must start with `<pluginId>:`. A settings view uses the same definition as any other view, with its own ID. Titles are functions; components can use render functions or templates.
- `signal` belongs to the plugin instance. Closing a view does not abort workspace work. Disabling removes registrations and blocks new tool calls; captured running chats keep their instance until they release it. Once an instance is retired and its last chat ends, or the workspace closes, the host aborts its signal and calls `dispose()` exactly once. Cleanup may be asynchronous; failures while the workspace remains open appear in plugin management. A cancellation signal cannot forcibly stop JavaScript that ignores it.

Tools supply `name`, `label`, `description`, an object JSON schema in `parameters`, and an `execute(toolCallId, arguments, signal, onUpdate)` function returning the agent's content/details result. Optional `executionMode` is `sequential` or `parallel`; argument-preparation callbacks are not supported. Local tool names use 1–40 ASCII letters, digits, underscores or hyphens. Provider-facing names are `plugin_<16 hexadecimal SHA-256 characters of the plugin ID>_<local name>`, with collisions rejected. The supplied services use captured workspace authorization; they cannot be rebound to a reopened workspace session. Return or await multi-step work from its tool/export promise. Those action roots and separately admitted native host requests are tracked; a view, chat or lifecycle signal is not an implicit action boundary.

- `files`, `config` and `data` expose `read(path)` returning `{ text, revision }` and `write(path, text, expectedRevision)`. Use `null` only to create a new file. Writes return the existing versioned storage outcome; inspect it rather than assuming every response means success.
- `files` operates on workspace content. `config` and `data` use separate versioned stores at `.situate/plugins/<pluginId>/{config,data}/`, each with its own `.situate/history.git`. They are not part of code activation. Missing or damaged existing histories are not reset.
- `dependencies.invoke(pluginId, exportName, args, signal?)` calls a declared dependency’s explicit exported function `(args, signal)`. Forward the calling tool/export signal through nested calls and HTTP requests so cancellation and lifecycle remain with the originating action. Standalone invocations get independent action lifetimes even when they share a lifecycle signal. Connections own account configuration and credentials; each consumer must keep its own explicit account selection rather than automatically selecting new accounts.
- `credentials.get(name)`, `.set(name, value)` and `.remove(name)` keep an encrypted envelope inside the owning plugin’s `.runtime/` directory, outside its versioned stores. A shared device-local wrapping key protects these envelopes; copying a plugin folder does not grant another device access to its credentials. Removing the plugin folder removes its envelope without changing other plugins’ credentials. These APIs do not expose AI-provider credentials.
- `network.request({ url, method?, headers?, body? }, signal?)` returns `{ status, body }`. Requests use HTTP(S), no ambient proxy or redirects, a 30-second timeout and bounded text bodies. Forward the originating tool/export signal as the second argument. Reads and writes execute within the requested task and configured access without per-action approval; a current chat is not required for a manual export. Do not pass an `approved` flag. Native scope/capability checks, validation, cancellation, operation draining and intent/result persistence remain required. Do not disguise external changes as reads. This is not a sandbox against trusted code bypassing the API. An interrupted request may already have caused external effects and is never retried automatically.

- `process.capability()` reports local execution availability, interpreter details and limits. On macOS, `process.run({ executable, args?, timeoutMs? }, signal?)` runs an absolute executable with literal arguments in the admitted workspace directory. For a script, select its interpreter explicitly, for example `{ executable: "/bin/sh", args: ["-c", "printf '%s' hello"] }`. Commands execute directly without a command confirmation or preceding user gesture, including development, initialization, standalone views and exports. Forward the originating tool/export signal so cancellation stays with the initiating action.
- Process execution is unrestricted by the working directory: commands can access other readable files, the network and other applications. External effects execute within the requested task and configured access without per-action approval. OS permissions, account access and installed programs are still required. The host does not install dependencies, load shell startup files or inject AI-provider credentials. It supplies a minimal fixed environment, without inherited secrets or arbitrary environment overrides. Executable paths must be absolute; child programs launched by a script see only the fixed system `PATH`. Standard input is closed; interactive terminals and detached background services are not supported. Do not put credentials into arguments or output.
- The process reply retains the shell tool's shape: `{ isError, commandResult: { Ok: result } | { Err: error }, beforeHistoryRevision, afterHistoryRevision, reconciliationError, attribution }`. A result includes `outcome` (`exited`, `cancelled`, `timedOut`), `exitCode`, `signal` and bounded `stdout`/`stderr` records (`text`, `capturedBytes`, `totalBytes`, `truncated`, `incomplete`). Default timeout is 30 seconds, maximum five minutes, with at most 32 KiB retained per stream. Nonzero exit, timeout, cancellation or reconciliation failure is not success. Commands hold the content mutation window and refuse unresolved editor drafts. Managed workspace changes are observed before and after execution, without claiming certain authorship, rollback or recovery of outside-workspace effects. Ordinary process-group descendants are stopped; detached daemons are not contained. Unrestricted commands can damage the workspace history store itself, in which case reconciliation may fail.
- Keep script text inside the pinned JavaScript entry where practical. Checking package source does not freeze system executables, separately managed scripts, CLI configuration, remote services or account access. Process-backed connections declare their actual platform requirements rather than implying iOS support. Service-specific convenience APIs may supplement this general host without replacing it.

Each tool action keeps its captured code and dependency revisions; skill context identifies its plugin and source path. After a runtime refresh, conversations update offered tools and skills before their next model turn, rather than rebinding an executing function. Every new invocation rechecks captured revisions, enabled status, recovery and workspace lifetime. Disabling invalidates those old offerings even after re-enabling. Failed plugin initialization does not remove built-in chat tools; Stop can end a chat's wait without claiming to terminate the plugin initializer.

Plugins are trusted code in the host UI, not sandboxed extensions. The native content security policy permits local blob modules and dynamic function construction for template compilation, while retaining its existing network and framing restrictions. A synchronous initializer or view can freeze the application; recovery startup remains the escape path.

### Legacy draft storage API

The macOS host command `plugin_drafts({ scope, request })` provides workspace/window-authorized draft storage. Retained legacy conversations use the bound authoring API below; new assignments use shared editable source. Settings → Plugins uses window-authorized source inspection. Source operations remain available in recovery and never execute or activate plugin code.

Each draft lives at `.situate/plugins/<pluginId>/drafts/<id>/`, with source in `code/`, independent Git history in `.situate/history.git`, and identity metadata in `.situate/plugin-draft.json`. Creation requires a new canonical UUID and a plugin ID. It copies only the existing plugin's code, including binary assets but excluding technical internals; configuration, data and other workspace files are not copied. A genuinely new plugin starts with empty code. Multiple drafts of the same plugin are independent, and draft writes never replace active code.

| `request.operation` | Additional fields                        | Reply field |
| ------------------- | ---------------------------------------- | ----------- |
| `create`            | `id`, `pluginId`                         | `draft`     |
| `list`              | None                                     | `drafts`    |
| `files`             | `id`                                     | `files`     |
| `read`              | `id`, `path`                             | `version`   |
| `write`             | `id`, `path`, `text`, `expectedRevision` | `outcome`   |
| `mkdir`             | `id`, `path`                             | `outcome`   |
| `validate`          | `id`                                     | `manifest`  |

Paths are relative to draft code. `expectedRevision` is mandatory: `null` creates without replacing an existing file; an edit requires the revision returned by `read`. Parent folders must already exist. Writes and folder creation use the existing versioned [storage API](#storage-api) and preserve its save, conflict, partial-failure and durability outcomes. Callers must not interpret every returned outcome as success. The workspace session is captured before queuing work; closure and reopening cannot authorize an old request against a new session.

Draft storage allows at most 128 drafts, 1,024 source entries per draft, 1 MiB per file and 64 MiB of source in aggregate. Source paths and manifest validation retain the inspection limits above. Listing, source reads and validation do not open or initialize Git history. Listing checks identity metadata and directory structure, not full repository health. Missing or damaged history is never reset by a draft write. Failed creation can leave an attributable incomplete draft; inspect its listing error rather than retrying the same identity. Copying and subsequent writes inherit the storage API's sequential-observation and external-writer limitations.

### Workspace-wide development

On macOS, `start_plugin_development` accepts an assignment, relevant context and an optional starting `pluginId`. A separate conversation retains the assignment and its origin; the selected package is context, not an access boundary. A successful handoff focuses that conversation and submits the prepared assignment once. Reopening interrupted work waits for user input. Starting from Settings creates an empty conversation without submitting it or copying plugin code.

Development uses ordinary workspace capabilities, enabled plugin tools and the same direct action execution and task-scope rules as ordinary chat. History and drafts load independently of AI status, without a development-only readiness preflight; execution and tool failures use ordinary chat errors. Related connections, consumers and ordinary files can be changed in one conversation. Workspace edits are durable as they happen, independently of code activation. The development header/background differ, but messages, Activity and content-change presentation use the normal chat components.

Where plugin source inspection is available, `read_plugin_design({ resource })` reads offline references without workspace access, network requests or mutation. Choose resources as needed: `overview` maps the references; `visual-direction` and `voice` describe the brand; `components` describes production `host.ui` exports, props, events and slots; `accessibility` and `platform-context` cover accessibility, Vue authoring and preview capabilities. Development instructions leave composition and interaction to the assignment, with functional checks and rendered review before activation. The macOS preview uses a separate hidden 1024×768 renderer with no resize or keyboard command; image review does not establish native-platform or accessibility qualification.

The read-only **Changes** panel lists recorded workspace-relative paths, including `.situate/`, and compares captured source contents. It does not browse the workspace or generate explanations of the code. Use Files for workspace browsing and plugin management for standalone source inspection. Historical content is never replaced with the current file when unavailable. Shell revision pairs are read as observations without attributing every discovered edit to that conversation; external renames can appear as a deletion and addition. Large or unsupported comparisons report their limitation rather than inventing a diff.

Use ordinary `read`, `write`, `edit`, `ls`, `find`, `grep`, `history` and `read_revision` with explicit paths under `.situate/plugins/<pluginId>/code/`. Workspace-root searches do not traverse plugin sources. Writes retain plugin-specific history and limits; `write` requires the exact `expectedRevision` from `read`, with `null` for creation only. `edit` applies exact replacements at the current revision. `prepareCopy` and `create_batch` are not supported for plugin sources.

Use `inspect_plugin` to discover packages (`list`, `files`, `read`) and check source structure (`validate`), not functional correctness. In development conversations it also accepts these operations, each with `pluginId`:

- `create` creates a new package code directory without enabling it. Create parent directories before writing files.
- `mkdir`, `rename` and `remove` use versioned structural operations with code-relative `path`; rename also takes `destination`.
- `capture` records editable source in Git and reports differences from its prior recorded state as uncertain observations. Use it after shell edits to plugin source; checks also capture current source.

Other internal plugin paths remain unavailable to ordinary file tools. Historical `edit_plugin_sources` results remain readable in retained conversations. Editable code stays at `.situate/plugins/<pluginId>/code/`; its stable history is `.situate/plugins/<pluginId>/.situate/history.git`. Running code is loaded from pinned Git revisions, not those mutable files. Existing enabled legacy packages are pinned before runtime exposure. Overlapping assignments remain allowed; stale writes fail rather than silently overwriting, but noncooperating external writers are not locked out.

**Development data** in the conversation header shows the files retained for checks and older plugin drafts. **Stop work and remove** stops the conversation, waits for pending saves and removes only those files after confirmation. Workspace edits, prepared shared source, installed code, configuration, data and recovery history remain. Pending or uncertain activation blocks removal until its outcome is inspected. Removing an older draft explicitly switches that same conversation to workspace-wide development; its assignment, messages and origin remain.

New conversation metadata uses `development.version: 2`, an optional starting `pluginId` and optional origin, without a `draftId`. Retained older records keep their original draft and bound legacy tools; opening them does not convert, recopy or activate anything. The legacy draft storage API above remains available for that retained code.

### Plugin workspace file queries

Use `host.files` for workspace content discovery rather than starting a shell:

| Method                                            | Result                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `await files.list(query?, signal?)`               | Sorted `[{ path, changeToken }]` for visible regular files                     |
| `await files.search({ ...query, text }, signal?)` | The same entries, filtered by a case-sensitive literal substring in UTF-8 text |
| `await files.readMany(paths, signal?)`            | `[{ path, text, revision }]` in input order                                    |
| `await files.watch(query, listener, signal?)`     | A function that stops the subscription                                         |

`query` accepts `roots` (workspace-relative directories, default the whole workspace) and `extensions` (for example `[".md"]`, case-insensitive). Explicit roots must exist. Hidden paths, technical paths and symlinks are excluded; explicit unsafe paths fail. Search skips binary/non-UTF-8 files. The native host enforces workspace authorization, plugin status and the captured code revisions for every request, including subscription polls. Queries do not start programs, normalize files or record history. `config` and `data` retain their plugin-scoped `read`/`write` API.

`readMany` accepts at most 256 paths, 1 MiB per file and 16 MiB total, and fails as a whole if a file cannot be read. Each content revision describes the returned bytes, but the batch is not an atomic workspace snapshot. Queries accept at most 32 roots and 16 extensions. Listing and search inspect at most 10,000 directory entries with a maximum depth of 64; search reads at most 16 MiB total and accepts a nonempty substring of at most 4,096 UTF-8 bytes. An exceeded limit is an error, not a truncated successful result. Split large workloads into explicit smaller queries or batches.

`changeToken` is an opaque metadata invalidation token, not a content revision or durable identity. A watch listener receives:

- `{ type: "reset", files }` after the initial scan;
- `{ type: "changed", paths, deleted }` when files are added, changed or removed; a rename appears as removal and addition;
- `{ type: "error", message }` if a later scan fails, after which the subscription stops. Restart with a new watch to obtain a fresh initial set.

Initial scan or listener failure rejects `watch`. Later listener failure stops the subscription. Scans run one second after the preceding scan and asynchronous listener finish, without overlap. This is current-state metadata polling, not a filesystem event log: edits may be coalesced and transient states may be missed. Delivery can also be delayed by operating-system suspension. Caller cancellation, host disposal and the returned stop function cancel polling and suppress late results.

Subscribe before reading initial content, process the reset and subsequent invalidations in order, and re-read changed files using `readMany`. Keep derived domain state in the plugin and stop subscriptions when that state is no longer needed. These methods use the shared temporary workspace during plugin checks; they never read the live workspace through the check host. iOS is deferred; these checks do not establish iOS support.

### Checks and grouped activation

`check_plugin_changes({ changes, checks })` captures immutable code for explicit publication targets. Each change is `{ pluginId, revision? }`; omit `revision` for current prepared source. An older revision is for an explicit restoration request, not an automatic fallback. Checks also capture required active dependencies and affected active consumers. A `needsChecks` response identifies missing checks without publishing anything.

Each check is `{ pluginId, script, fixtures?, responses?, processes?, timeoutMs? }`. Scripts run in a supervised Worker with `plugin`, `host`, `preview` and `assert` locals. Use `plugin.invokeTool(name,args)`, `plugin.invokeExport(name,args)`, `plugin.skill(path)`, `host.signal`, `assert.ok(value)` and `assert.equal(actual,expected)`. There is no `check` wrapper. Select assertions that verify the requested behavior. `assert.ok(value)` accepts any truthy value. Each script requires at least one successful assertion; any failed assertion fails the check even if caught. Checks cover current consumer revisions without silently publishing their unactivated source.

Fixtures map `files`, `config`, `data` and `credentials` paths/names to synthetic strings. Files share one temporary workspace across the group; seed a shared path once. Configuration, data and credentials remain plugin-scoped. Exact `METHOD URL` entries in `responses` provide `{ status, body }`; unmatched host requests fail without real network access. Optional `processes` entries are `{ executable, args?, exitCode, stdout, stderr }`; an omitted argument list means `[]`. Matching uses the exact executable and argument list for that plugin. In grouped checks, put process fixtures on the `checks` item for the plugin executing `host.process.run`, including when another plugin calls it through a dependency; caller fixtures are not inherited. No local program is started during checks, including for unmatched commands. Ambiguous duplicates and oversized fixtures are rejected. These responses exercise callers, not the real script, executable or OS permission flow. Fixtures are never adopted. Cleanup failures cannot certify a successful check.

Views can be exercised with `preview.open({viewId})`, `preview.step({action:"read"})`, `preview.step({action:"click",selector})`, `preview.step({action:"fill",selector,value})`, `preview.step({action:"capture"})` and `preview.close()`. `read` returns text, while `capture` returns a receipt and attaches the PNG separately to the tool result. Opening and interacting wait for the Vue update, not for asynchronous service calls started by lifecycle hooks or event handlers; poll the expected state through `preview.step({action:"read"})` before asserting or capturing. Do not repeat a potentially writing action while waiting. On macOS, previews use a dedicated hidden renderer with production Vue/UI implementations at 1024×768 CSS pixels. They do not change workspace navigation or focus. Service/script timeout terminates the Worker; ordinary Vue rendering retains its hang/restart limitation. These services are not a sandbox against trusted code bypassing them.

Check results are retained in the development conversation. Failed script results preserve the successful `assertions` count. Assertion failures include `failure: {assertion, operator, actual, expected}`: a one-based assertion index, `ok` or `equal`, and value previews limited to 1024 characters each. Unserializable values use `[unserializable]`. The first failed assertion remains decisive even if caught. Unknown exceptions return `plugins.checkFailed`, with distinct codes for JavaScript type, reference and syntax errors; raw exception messages and stacks are not returned. Infrastructure failures without an available counter set `assertionsKnown:false`; their zero count is not evidence that no assertions ran. Results retain the last 32 host-operation `observations`, omitting credential values, file contents, HTTP bodies and process streams; `observationsTruncated` indicates omitted earlier entries. Screenshots captured before a script assertion fails remain attached. Use only synthetic data in checks, including compared values. Test reports are not copied into general diagnostic logs.

For macOS operational diagnostics, an available shell can read `~/Library/Logs/com.getsituate.app/diagnostics/segment-*.jsonl` with standard JSONL tools such as Python or `jq`. Filter by `workspace_id`, `context.trace_id` and timestamp. Development installations may use a different directory; see [diagnostic locations](../docs/development/client-diagnostics-plan.md#implementation-reference). These rotated logs contain operational metadata, not full assertion reports. Additional `SITUATE_PLUGIN_CHECK_STAGE` stderr output is available only in `native-smoke` builds.

`activate_plugin_changes({ checkId })` requires successful checks of the exact source and dependency set. New edits or relevant dependency changes return `needsRecheck`; prepare compatible changes and check again, rather than downgrading dependencies silently. Existing active versions remain usable during preparation. Activation closes admission to affected root actions, lets them finish, drains separately tracked host requests, then replaces the active revision map once. The runtime stages and swaps related tool/view registrations together before releasing admission. Running actions and requests keep their original execution; activation does not abort or repeat them.

An `activated: true` result with `followUpError` means code is already active but refresh or notification failed. Do not repeat publication to retry that follow-up. `inspect_plugin_changes` reads a receipt, a durable publication attempt or the last mapped publication without resolving uncertainty. An unknown outcome is not evidence that nothing happened. Code and conversation history remain retained; transient check receipts require fresh checks after restart.

Checked activation can enable selected targets and selectively resume them in recovery; unrelated suspended plugins stay paused. It never resumes an interrupted originating request. Installed code does not establish account access: connection settings and real operations must expose missing access or implementation. The general process host can invoke OS automation tools when available, but no Apple Notes connection or macOS Automation permission flow has been qualified. The presence of `osascript` alone is not evidence of usable Notes access.

Retained legacy conversations can still use `check_plugin_draft` and `activate_plugin_draft`. Their fixed candidate checks and activation use the same native action drain and runtime refresh boundary. They do not support dependency-group publication; shared connection changes use the grouped workflow.

## Files and history

Use disposable workspaces for evaluation. An external writer can still race replacement and lose an unobserved change; platform durability is not fully verified.

Current supported editing targets macOS filesystem workspaces. The retained mobile implementation supports application-owned Documents folders, but mobile product support and qualification are deferred. External mobile provider workspaces are read-only: browsing does not initialize history or normalize their content. Text files open internally, including code, structured text and files without an extension. Markdown opens rendered with a source mode; other text opens as source with syntax highlighting where supported. Classification uses file content rather than the extension alone. Binary files open in the default external application; iOS hands a temporary read-only copy to the activity interface. Unreadable files, oversized text and unsupported text encodings produce errors rather than an external handoff. Plugin management uses the same explorer and reading behavior, scoped to the selected plugin’s code and without editing or activation. The document chat button is visible but disabled.

Use the document’s **File actions** (`…`) menu to switch between **Read** and **Edit source**. Clicking a rendered text block also opens its source position. Read-only documents and historical versions offer **View source**; switching representation keeps the selected version. File-row menus provide creation, rename, move, duplicate and delete actions. The browser’s **+** menu creates at the workspace root and opens **Deleted files**; contextual creation places new items beside a file or inside a folder. New files without an extension receive `.md`.

The source editor queues automatic saving after 650 ms without input, or after three seconds of continuous typing. Storage work and conflicts can delay completion. It stages recovery text separately from saving the file and polls for external changes every 2.5 seconds while the view is visible. A successful automatic merge updates the live document silently; historical inspection stays on its selected version. Unresolved conflicts require an explicit choice between complete versions.

History provides per-file commits, text comparison, historical copies with separate file lineage and fresh task identities, deleted-file restoration and compensating reversal of text changes. Folder history includes structural changes. Safe inverses of creation, deletion and recorded moves are supported; changes to folder membership or edited binary move targets can prevent reversal. Binary content changes are not merged as text; copy an old version to a new file instead.

Workspace closure flushes retained edits, not only the visible file. Failed saves offer retry, cancellation or explicit discard; desktop also offers a new, synced copy outside open workspaces. Mobile external export is unavailable rather than treating an opened share sheet as proof of a saved copy.

If saving or checking drafts fails, **Close anyway…** offers a separate warning and confirmation to close without saving. It does not delete saved files, history or persisted recovery drafts, but unsaved in-memory edits may be lost. Cancellation retains pending writes and sessions. This choice bypasses only file-save validation, not workspace ownership, running-action decisions, dictation, registry persistence or lifecycle controls. Successful workspace closure removes it from the remembered startup-open set but retains its known-workspace entry. A failed registry update leaves the workspace usable.

Desktop application quit waits for acknowledgments from every participating window and cancels the attempt if one fails. Neither application quit nor update preparation offers **Close anyway…**.

### Storage API

The window-authorized `files_request` host command uses one `content::ContentStore` per writable workspace and executes storage work off the UI thread. Opening a store requires an existing `.situate` directory and creates a bare Git repository at `.situate/history.git` when no history exists. One advisory-locked store owns a workspace at a time. The API includes listing, reads, draft staging, no-clobber creation, merge/save and reviewed resolution, folder operations, history, historical copying and restoration.

Drafts are secured before file replacement in versioned records under `.situate/drafts`. `content::read_recovery_drafts` reads them without opening or repairing Git history. Unsupported or damaged records remain intact and prevent their replacement by another save. Callers retain editor text on any failure, distinguish a written file from a completed history commit, and obtain explicit consent before discarding recovery data. A save that cannot persist its draft does not write the target file.

File bytes and identity are rechecked before replacement, and read-only targets are refused, but that check and replacement are not an atomic compare-and-swap against unrelated programs. Noncooperating writers can still race the final replacement; their intervening version may be overwritten without being captured. Polling may also observe an external write before it is complete. Workspace snapshots are sequential, not multi-file transactions; history internals and ancestor directories must remain stable during operations. Binary snapshot input is streamed; text reads, historical blob reads and recovery records are currently loaded into memory. The Vue session layer supplies scheduling and polling; the core has no filesystem watcher.

Structural selections are limited to 64 MiB in aggregate and 10,000 entries, including directories. Regenerated copies have the same byte limit. Move-reference patches have a 64 MiB combined old/new-byte budget and a 10,000-patch limit. These are preflight safety limits, not a limit on raw Git snapshots. Capturing a file reference accepts up to 64 MiB without requiring text decoding; resolving reference content as text retains its separate 8 MiB limit. Restoring a deleted item requires an existing destination parent. Partial operations identify changed paths and a pre-operation recovery revision; failed private stages and deleted entries can remain retained.

Live file references retain their original relative path and a Git commit anchor. Markdown uses the same continuity rules as other files, with or without frontmatter. Confirmed managed moves preserve continuity; copies and restoration create a separate lineage. A known deletion terminates old live references, even if the path is later reused. Historical references retain their exact revision and path. Unsupported selectors fail closed without conversion or cleanup.

The `metadata` module generates UUID v4 task identifiers and inspects source without rewriting it. Task identity uses a YAML mapping inside an HTML comment on a Markdown checkbox item, such as `<!-- situate-task-id: <UUID> -->`; additional fields can use a flow mapping. Unmarked checkboxes remain ordinary checkboxes. Task identity comparison ignores formatting and UUID letter case but detects removal, replacement and duplicate-count changes. Malformed frontmatter and task metadata produce source-correction warnings rather than automatic repair. Generic frontmatter warnings do not block ordinary editing or copying. Inspection does not expand YAML aliases and limits individual metadata blocks to 1 MiB and 64 nesting levels. Task ID overrides require confirmation; file frontmatter, including `situate-id`, is ordinary user metadata. Discovery records external bytes without enriching them. Copies regenerate task IDs with scalar edits, preserving other source bytes. Recognized inline `situate:<UUID>` task links and relative Markdown links/images, including percent-encoded paths and fragments, are retargeted. Reference-style links, HTML, backslash-escaped or angle-enclosed destinations, query URLs and absolute paths are not rewritten. Ambiguous task identity links are rejected; interactive selection and versioned duplicate-ID repair are not implemented.

Agent `write` and `edit` use versioned publication. New-file writes and bounded `create_batch` publication can opt into native task-copy preparation with `prepareCopy: true`; ordinary writes preserve metadata and existing task IDs. A task checkbox comment with `situate-task-id: null` requests a fresh native task UUID during preparation. Pass batch input directly as an `entries` array containing `{path, text}` or `{path, sourcePath}` objects. Use an absolute `sourcePath` for byte-for-byte publication from an authorized source, including binary attachments, for example `{"path":"assets/photo.png","sourcePath":"/authorized/export/assets/photo.png"}`. Source reads use the application's existing OS access; passing a path does not grant access. Sources must be regular files with no symlink components and remain unchanged. Run conversion code without saving helpers and keep mappings in memory rather than staging source copies, manifests, scripts or audit files in the workspace. Summarize results in chat unless a report is requested. Keep relative attachment paths intact or update the prepared Markdown links to match the destinations. Destinations must be new files under existing parents. Batches are limited to 256 files, 1 MiB per inline text entry, 64 MiB of total prepared content, 32 MiB of encoded entries and 4,096 prepared task identities; smaller batches may be necessary to fit model and tool transport limits. Sources are checked again before publication; changed or replaced sources fail rather than silently publishing an outdated copy. Native task-copy preparation applies only to Markdown destinations. A partial or uncertain result is not an instruction to replay the batch. Import is available in ordinary chats; prepared copies preserve supplied content and metadata while native preparation assigns fresh task identities.

Existing manifest-based calls remain accepted: `manifestPath` selects a `.situate/batch-<name>.jsonl` file instead of `entries`, and its `sourcePath` entries remain restricted to `.situate/import-<name>/`. These legacy inputs remain unchanged; they are not automatically deleted.

Deferred mobile adapters expose bounded reads and directory listing through the host for Android document-provider handles and scoped iOS URLs. Native reads are capped at 16 MiB and never silently truncated. Only native-validated application-owned mobile folders become filesystem roots for Git-backed writes; provider handles never become paths. Provider-backed versioned writing still needs a publication protocol. iOS access retains scope and coordination through filesystem work and releases it before external UI handoff. Cross-compilation does not establish real provider grant, interruption or revocation behavior.

On macOS, exercise the native directory and content helpers with:

```sh
node scripts/test-workspace-access-swift.mjs
```

This runs real Foundation coordination and temporary-file checks, with an injected boundary for security-scope grants. It does not test an actual Files picker grant or Android provider lifecycle. The repository runner includes these checks on macOS outside the fast profile.

## Tasks

On macOS, add **Tasks** through the view chooser to list identified tasks, filter by status and open their source notes. Completion changes the source checkbox through the same versioned operation used by chat. Unmarked checkboxes remain ordinary checkboxes; see [Markdown metadata](#files-and-history). Duplicate or malformed task identities require review. Notes with unsaved drafts are not changed by task completion.

## Workspace AI access and chat

New macOS workspaces require connected AI and a successful **Check connection** before working-method guidance. Discuss sources and working preferences in the setup conversation, then confirm the explained method before import starts. The host saves it at `.situate/working-method.md`, which remains editable in Files. Root `AGENTS.md`, `.pi/skills` and visible `Situate/` files are user content, not automatic instructions. Source chats explain partial results and let you retry or continue without the missing scope; they do not require another import approval screen. Explicit optional plugin commissions start separate development chats, including during setup.

**Pause setup** retains answers, reviewed instructions, choices, files and drafts with the workspace. Reopening never sends interrupted requests automatically. On another device, connect local AI access where missing and continue from the retained step. Selected developments that were not started remain available for explicit continuation in the normal workspace; preparation or start failure does not reopen onboarding. Established workspaces remain readable and manually editable without AI. iOS onboarding is deferred.

Manage provider access in **Settings → AI access**. Saving access does not choose a model; setup also requires a workspace model. Sign-in failures and failures before file replacement leave the previous connection intact. If replacement occurred but durable storage cannot be confirmed, setup reports an uncertain save rather than success; keep the workspace open and check its connection before retrying.

- **macOS only:** encrypted connection storage uses XChaCha20-Poly1305 in `.situate/ai-connection.json`, with a separate key in macOS Keychain. If Keychain access fails, no plaintext or application-global fallback is used. Copies and moved workspaces may require reauthentication; key provisioning between devices is not implemented. Old keys are retired after durable replacement where possible; interrupted operations or unavailable Keychain cleanup can leave unused key entries.
- **Windows, Linux, iOS and Android:** connection setup is visibly unavailable. Their secure-key/storage integration has not been implemented. Mobile folder grants and security-scoped access are not bypassed with ordinary filesystem paths.
- **Providers and models:** the catalog is generated from the pinned Pi 1.1.0 packages by `node scripts/ai-catalog.mjs` and regenerated before frontend builds. Available models use the integrated Chat Completions, Responses or Anthropic Messages transports. Models requiring unsupported endpoint configuration, transports or provider headers are not selectable. GitHub Copilot is unavailable because its additional request-header integration is missing. NVIDIA's fixed polling header is taken from the pinned model metadata; requests identify the Pi browser runtime.
- **Authentication:** explicitly entered API keys and suitable bearer tokens are supported for the available transports. OpenAI also supports **Sign in with ChatGPT** through the system browser on macOS. Other providers' browser/device flows, ambient credentials, profiles, commands and credential files are unavailable. No global Pi credentials or environment keys are read. Situate managed AI is unavailable.
- **OpenAI browser sign-in:** choose **Open sign-in in browser**, complete the provider's steps, then return to Situate. Choose the model separately in chat. Model availability depends on the OpenAI account; the catalog is not an entitlement check. The native flow follows Pi 1.0.2's dynamic public-client registration, PKCE and direct-token grant for `https://api.openai.com/v1/responses`, not the legacy Codex provider. It requires free loopback port **1455** and times out after five minutes. If the port is occupied, close the other pending sign-in yourself and retry; Situate neither opens the provider nor stops other processes in that case. Pasting a return URL is not supported. Cancelling setup or closing the workspace cancels pending sign-in and waits for native work to settle. If saving has already begun, cancellation waits for that save's actual result.
- **OpenAI credential renewal:** access and refresh tokens, issued client ID, granted scopes and expiry are encrypted with the workspace connection. Before a chat request, tokens within three minutes of provider expiry are refreshed and saved. `.situate/ai-connection.lock` serializes credential changes across local processes; a competing session receives a retryable error rather than using the same rotating token. Once refresh has been sent, Stop waits for its bounded response and persistence, then prevents the chat request. Network loss, storage failure or forced termination during provider-side rotation can still require signing in again. A non-secret installation UUID is retained as `openai-agent-host-id` in application data; it is not an account or credential.
- **Chat models:** use **Model** below the message field to choose or switch a model of the configured provider. The chooser supports name/ID search; switching applies to the next message, preserves the draft and conversation, and sends no provider request or reauthentication. Selection is blocked while a response, unsaved turn or sign-in is pending. The workspace-local `.situate/chat-model.json` stores the model with its provider/authentication/endpoint association, independently of the encrypted connection and chat history. A legacy model in an older encrypted connection remains usable until a separate preference is saved. A missing, invalid or unavailable selection requires an explicit choice rather than a default or fallback. Admission rejects stale provider/model expectations instead of silently sending to another choice.
- **Custom endpoints:** choose **Compatible endpoint**, enter its API base URL, and optionally supply a bearer token. Enter the exact model ID separately in the chat model chooser; Situate does not query the endpoint to discover models. The endpoint must implement streaming OpenAI Chat Completions. Hosted endpoints require HTTPS; HTTP is permitted only on localhost/loopback. URL credentials, query parameters and fragments are rejected. Custom models use text input, a 32,768-token context assumption and a 4,096-token output ceiling; protocol compatibility is not a guarantee of model capabilities.
- **Connection checks:** saving an API key sends no provider request. Browser sign-in exchanges an authorization code and reports connected only after a durable encrypted save. Saving access alone does not send a test chat or guarantee model access. During new macOS setup, **Check connection** exercises the chosen model; otherwise the first chat message does. Either may incur provider charges or consume subscription limits. Rejected access blocks subsequent requests in the open session until access is replaced. Choose another model in chat or reconnect in AI access settings; raw provider error bodies are not displayed.
- **Conversations:** each conversation and its draft are retained in `.situate/conversation-<id>.json`, without automatic sending on reopen. These records are ordinary local data, not encrypted conversation storage. Each serialized record is capped at 16 MiB.
- **Stopping and closing:** Stop cancels the native chat request after any already-dispatched credential refresh finishes. Closing an active workspace offers Cancel or Abort now and close. A completed response must be saved before closure; a failed save leaves a retry action. Graceful application quit is blocked while any turn is active or unsaved: finish or stop and save each response, then choose Quit again. Quit also cancels pending browser sign-in and remains blocked until its listener, exchange and storage work settle; choose Quit again afterward. Quitting preserves the remembered open-workspace set. Provider-side work already received may still be charged, and forced OS termination cannot guarantee graceful saving.

Rig runs in the native conversation owner with application-owned provider/tool adapters; the web layer projects state and no Node sidecar is shipped. Rust performs authenticated HTTP requests, so provider CORS is not required. The native transport accepts only an admitted turn from the originating workspace/window, the configured model's exact endpoint route, and allowlisted protocol headers. Redirects and ambient HTTP proxy settings are disabled, and saved keys, OAuth tokens and authorization URLs are not returned to JavaScript. Callback acceptance requires the exact loopback origin/path, matching random state, and a single authorization code plus issued client ID. Duplicate query fields, stale state and denied callbacks cannot replace access. Automatic provider retries are disabled.

## Structure

Paths below are relative to `client/`:

- `app/src/`: Vue interface and typed Tauri invocation.
- `app/src-tauri/`: native host and operating-system data-directory selection.
- `crates/situate-core/`: workspace registry, Git-backed content storage and metadata inspection, independent of Tauri.
- `crates/tauri-plugin-workspace-access/`: durable Kotlin/Swift folder-access adapter and native build integration. Its generated `.tauri/`, Gradle and Swift build directories are disposable.
- `packages/ui/`: shared Vue buttons and icons, using the canonical [brand tokens](../design/brand/tokens.css).

The requirements viewer remains a separate npm project.

## Prerequisites

Use [Volta](../docs/development/README.md#install-volta) for the Node.js and npm versions pinned in the root `package.json`, and Rust installed through rustup. [`rust-toolchain.toml`](rust-toolchain.toml) selects the compiler, formatter, Clippy and LLVM tools. LLVM tools support the Swift bridge's symbol handling with Xcode 27. Keep the rustup-managed executables ahead of any separately installed Rust compiler on `PATH`.

Native builds also need the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Only the macOS row is required for MVP development; iOS runtimes, mobile SDKs and the other rows below are deferred reference material:

| Build host   | Additional tools                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| macOS        | Xcode with Swift 6.2 or later, first-launch setup complete and current Command Line Tools                              |
| Windows      | Visual Studio C++ build tools, Windows SDK, WebView2                                                                   |
| Ubuntu 24.04 | `build-essential libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`; `xvfb` for headless native tests   |
| Android      | JDK 21, Android command-line tools, platform `android-37.0`, build tools `36.0.0`, NDK `28.2.13676358`, CMake `3.22.1` |
| iOS          | macOS, Xcode, an iOS Simulator runtime, XcodeGen and CocoaPods                                                         |

For Windows ARM64, also install **C++ Clang Compiler for Windows** (`Microsoft.VisualStudio.Component.VC.Llvm.Clang`) through Visual Studio Installer. The `aws-lc-sys` dependency requires `clang-cl` for ARM64 assembly; the MSVC compiler alone is insufficient.

For Android, set `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME` in the local shell. Review SDK licenses interactively with `sdkmanager --licenses`. Do not commit machine paths or signing credentials.

## Run and check

For the complete repository suite, including this client's browser, native, and Docker context tests, use `node tools/test.mjs` from the repository root. Its `--unit` and `--changed` options are described in the [test suite guide](../docs/development/testing.md). The commands below target the client only.

Enter the client directory from the repository root:

```sh
cd client
npm ci
npm run dev:client
```

Run the remaining commands in this guide from `client/`.

`npm run dev:client` starts Vite on an available loopback port and passes its URL to Tauri. `npm run dev` starts only Vite, also on an available port; use the URL printed in the terminal. Separate worktrees can run these commands concurrently without reserving ports. Without a native host, the interface explains that folder management requires the installed app; it does not substitute browser storage or a simulated picker. Browser tests supply explicit workspace fixtures for entry and main-screen layout checks. Rust core filesystem tests do not require a WebView.

For UI design with synthetic data, run `npm run design`. The [design workshop](../docs/development/design-workshop.md) opens a clean app preview and a separate window for scenarios, action outcomes, platform profiles, and content-size presets. It does not access real workspaces. Its independent Vue application in `workshop/` owns its components, styles and brand snapshot; experiments do not change the product UI. Approved designs are copied and integrated explicitly.

```sh
npm run build
npm run check
npm test
npx playwright install chromium webkit
npm run test:browser
npm run test:native
npm run build:client -- -- --locked
```

On a headless Linux host, use `xvfb-run -a npm run test:native`. The regular desktop build creates an executable under `target/release/`, without an installer or store upload.

| Check                  | Boundary exercised                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`        | Strict Vue/TypeScript checking, Rust formatting and Clippy                                                                                                                                                                   |
| `npm test`             | Release-script tests, Vue entry/forms/menu and shared button contracts, unavailable actions, IPC argument mapping, Rust filesystem and registry tests with temporary directories                                             |
| `npm run test:scripts` | Release target selection, packaging plans, output collection, Xcode session logic, real Vite connections, and subprocess cleanup without native builds                                                                       |
| `npm run test:core`    | Rust core only; no WebView required                                                                                                                                                                                          |
| `npm run test:browser` | Chromium/WebKit entry, creation and main-screen layouts at 320–1440 px; enlarged text, collision responses, menus, removal, switching and drawer focus with explicit IPC fixtures, not native persistence                    |
| `npm run test:native`  | Two real desktop process launches; exclusive creation, multiple windows, switching, removal, closure, partial restoration, registry/window failures, shell and compact drawer rendering, and UTF-8 storage IPC without mocks |

Desktop smoke workspace windows use 768 × 800 px to exercise the compact drawer. Wide layouts are covered by browser tests. The test checks the rendered shell, canonical images and disabled actions, and separately invokes the retained storage command with Unicode text, replacement text and an empty string. It builds into `target/native-smoke/` and uses the isolated identifier `dev.situate.client.smoke`. Test commands and injected drivers are compiled only with the `native-smoke` Cargo feature; normal builds contain neither.

The smoke test creates disposable workspace directories and leaves them for inspection. Desktop fixtures and reports live in the smoke application's data directory; mobile fixtures use that application's Documents by default. The first launch leaves a restart checkpoint; the second checks actual restoration and closes the remaining sessions. Success on each launch is `{"error":null,"passed":true}` in `smoke-result.json`. The desktop runner launches twice, checks reports and exit codes, and fails on timeout. A build or app launch alone is not a passing smoke test.

## Visual review and screenshots

Capture scenes from the [design workshop](../docs/development/design-workshop.md):

```sh
npm run screenshots:workspaces
# Include navigation, dashboard, file editor, history and chat scenes:
npm run screenshots:design
# Optional output directory, relative to the current directory:
npm run screenshots:design -- test-results/design-review
```

This starts an owned Vite server on port **1431**, runs the installed Playwright Chromium, and closes both afterward. It captures synthetic scenes at desktop, iOS-profile and Android-profile sizes and writes an `index.md` image gallery. These are Vue content captures, not native window or device screenshots. No browser or dependency download is performed. Re-running into the same directory replaces its gallery and images.

Product and workshop browser suites run independently, without requiring their layouts to stay identical. Use `npm run test:browser:design` for workshop navigation, file operations, history, chat references, contextual controls and environmental changes in Chromium and WebKit. `npm run build:design` and `npm run test:design` build and unit-test only the workshop. Reduced and mocked viewports test layout and draft retention, not native mobile keyboards or system control geometry.

On macOS, capture a real Tauri window, including its system titlebar:

```sh
npm run screenshot:native -- --launch --output test-results/native-entry.png
# Capture an already running app without starting or stopping it:
npm run screenshot:native -- --pid <process-id> --output test-results/native-current.png
```

`--launch` builds and briefly runs a separate **Situate Visual** application (`dev.situate.client.visual`) using `app/src-tauri/tests/visual.conf.json`, then stops only that process. It uses real native commands, no IPC fixtures, and retains its own application data between launches; it does not use the regular or smoke app's registry. Build output lives in `target/native-visual/`. To inspect additional states interactively, run the built executable there and capture its PID.

Native capture requires Swift, the normal desktop build prerequisites, and macOS screen-recording permission for the terminal if requested by the OS. It captures only one visible window belonging to the specified process and refuses ambiguous multiple-window selections or an existing output file. Native capture on other operating systems is not provided by this command. Screenshots can expose workspace names and locations; keep them in ignored `test-results/` and review them before sharing.

## Mobile builds

**Deferred reference:** iOS and Android are not currently supported. These retained commands and device instructions are not macOS prerequisites or release gates.

Install the Rust target for each build:

```sh
rustup target add aarch64-linux-android
npm run tauri -- android init --ci --skip-targets-install
npm run tauri -- android build --ci --debug --target aarch64 --apk
```

```sh
rustup target add aarch64-apple-ios-sim
npm run tauri -- ios init --ci --skip-targets-install
npm run tauri -- ios build --ci --debug --target aarch64-sim --no-sign
```

Android produces a development APK beneath `app/src-tauri/gen/android/app/build/outputs/apk/`. iOS produces `app/src-tauri/gen/apple/build/arm64-sim/Situate.app`. These are not signed store releases.

Native projects under `app/src-tauri/gen/android/` and `app/src-tauri/gen/apple/` are generated and ignored. Recreate them with the pinned Tauri CLI; do not keep durable changes only in those directories.

### Develop in Xcode

From `client/` in the checkout you want to run:

```sh
npm ci
npm run ios:xcode -- --check
npm run ios:xcode
```

Install the Simulator Rust target first if the check requests it: `aarch64-apple-ios-sim` on Apple Silicon or `x86_64-apple-ios` on Intel. Xcode must have an installed iOS Simulator runtime. The launcher checks prerequisites but does not install SDKs, dependencies, or accept licenses.

In the opened Xcode project, select **situate-client_iOS**, choose an **iPhone Simulator**, then use **Run (Cmd-R)**. Use the generated `debug` configuration. Simulator builds do not require a development team or a paid Apple Developer membership; Tauri may still print its generic signing warning for physical devices.

Keep the terminal running while building and using the app. Vue changes update through Vite; rebuild with Cmd-R for Rust changes. Stop any active Xcode build before pressing **Ctrl-C** in the terminal. Xcode and the Simulator remain open, but another build or frontend reload requires restarting the session.

Each checkout gets its own loopback HTTP/WebSocket port and stable development bundle identifier. Its Simulator installation and saved text are separate from other checkouts and the regular app. On `main`, the app uses the configured product name, Situate, without a suffix. On other branches and detached checkouts, its name includes the checkout directory name. Rust and Vite caches live under `target/ios-xcode/`; Xcode manages its usual project-specific DerivedData. Avoid configuring a shared Xcode build directory across checkouts.

The launcher creates `gen/apple/project.ios-xcode.yml` from Tauri's generated `project.yml` and regenerates the Xcode project before opening it. Its build phase uses the current Node executable directly, so Xcode does not need to inherit a terminal's Node setup. These generated files remain disposable; durable integration lives in `scripts/ios-xcode*.mjs`.

Only one development session or local iOS release can own a checkout's native project at a time. Do not run other native iOS commands concurrently in that checkout. Before switching from this session to ordinary Tauri iOS commands, stop the build and session, then restore the standard generated project:

```sh
npm run tauri -- ios init --ci --skip-targets-install
```

The local release command already performs this initialization. After an interrupted session or cancelled build, a lock may remain under `target/ios-xcode/session.lock` or `target/ios-xcode/build.lock`. Check the recorded owner and confirm that Xcode and its build processes have stopped before removing either lock. Locks are not automatically reclaimed.

### Native directory and Android dispatch tests

On macOS, the Swift directory checks compile the same POSIX helper used on iOS, without UIKit or a provider:

```sh
mkdir -p target
swiftc crates/tauri-plugin-workspace-access/ios/Sources/NewWorkspaceDirectory.swift \
  crates/tauri-plugin-workspace-access/ios/Tests/main.swift -o target/swift-directory-tests
target/swift-directory-tests
```

With Android initialized and an isolated emulator selected through `ANDROID_SERIAL`, run the plugin instrumentation tests from `app/src-tauri/gen/android/`:

```sh
./gradlew :tauri-plugin-workspace-access:connectedDebugAndroidTest
```

These use disposable test-application directories and the SDK's instrumentation runner. They cover directory replacement, symlinks, collisions, and blocking access/provider operations without blocking the main thread. The provider is a test double; grant persistence and real provider behavior require the separate smoke tests below. These platform-specific commands are not part of the host repository runner.

### Install on an iPhone

Use the bundled-frontend mode to install an app that runs without a development server:

```sh
rustup target add aarch64-apple-ios
npm run ios:xcode -- --device --check
npm run ios:xcode -- --device
```

Stop any Xcode build and the previous launcher session before switching modes. In Xcode, select **situate-client_iOS**, use the **debug** configuration, and choose your connected iPhone. Under **Signing & Capabilities**, enable **Automatically manage signing** and select your development team. Add your Apple Account in Xcode settings if needed. The iPhone must trust the Mac and have Developer Mode enabled. Then use **Run (Cmd-R)** to build, install, and launch.

The launcher uses Tauri's build mode, not its development server. It builds the frontend on startup and again before each Xcode Rust build, so subsequent builds embed current assets. Frontend build errors stop installation rather than silently using stale assets. Keep the terminal open during Xcode builds; after installation, stop the session and disconnect the iPhone. The installed app can be closed and reopened without the Mac or a shared network.

The generated project retains the development team selected in Xcode when restarting or switching modes and uses automatic signing. Use the same team for all configurations. Team selection stays in ignored generated files, not tracked configuration; deleting or reinitializing the generated project can require selecting it again. Other manual project edits are not preserved. Development signatures remain subject to Apple's validity limits, particularly with a free Personal Team, and can require rebuilding and reinstalling.

Device and Simulator modes use the same checkout-specific app identifier. Other checkouts and the regular app remain separate. Run `npm run ios:xcode` without `--device` to return to Simulator hot reload. No IPA export, TestFlight upload, or App Store submission is performed.

### Mobile smoke tests

Use a separate checkout for smoke builds: the application identifier differs, and Android's generated package paths cannot be reused across identifiers. After `npm ci` and target installation, initialize and build with the same smoke configuration:

```sh
npm run tauri -- android init --ci --skip-targets-install --config src-tauri/tests/smoke.conf.json
npm run tauri -- android build --ci --debug --target aarch64 --apk --features native-smoke --config src-tauri/tests/smoke.conf.json
```

For iOS, use `ios init` with that configuration, then:

```sh
npm run tauri -- ios build --ci --debug --target aarch64-sim --no-sign --features native-smoke --config src-tauri/tests/smoke.conf.json
```

Install the **Situate Smoke** bundle/APK, not the regular Situate artifact, and launch `dev.situate.client.smoke` on the selected emulator or simulator. Require `passed: true` in that application's `smoke-result.json`, terminate the process, launch again, and require a fresh passing report. The first launch exercises creation, multiple mobile sessions, switching, collisions, removal and persistence failure. The second checks restoration from durable access metadata, an independently unavailable location, and closure. The report is deleted at startup to avoid stale results. Mobile smoke apps remain open after completion.

For an interactive provider test, finish both ordinary smoke launches first, then create an empty `smoke-use-picker` file in the smoke application's data directory. The next first-phase launch opens the real native folder chooser instead of using application Documents. Select a disposable, writable test folder; the test creates new named children there. It allows five minutes for native selection. Require a passing report before terminating and relaunching to test the persisted grant/bookmark. Remove `smoke-use-picker` to return to application-Documents tests. Cancellation is intentionally a test failure, not evidence of provider access. These tests do not verify every provider, revoked grants, assistive technology, tablet orientation or minimum OS version; exercise those separately.

## Local release packages

For current macOS work, run the release script on macOS after installing dependencies and running the checks above. Other targets in the reference table are deferred:

```sh
npm run release
npm run release -- --platform macos
npm run release -- --help
```

The default builds only the current desktop platform. `--platform all` builds all targets supported by the current host: its desktop platform, Android, and additionally iOS Simulator on macOS. It does **not** cross-build the other desktop platforms. An explicit incompatible target fails before building unless the Linux-to-Windows cross-build mode is explicitly enabled. For containerised Linux builds and opt-in Windows NSIS cross-builds, use the separate [Docker build commands](docker/README.md).

| Target    | Local artifact                                                     | Build host                                            |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `macos`   | `.app` and `.dmg`                                                  | macOS; native Rust host architecture                  |
| `windows` | NSIS installer (`.exe`)                                            | Windows with C++ build tools and WebView2             |
| `linux`   | `.deb` and `.AppImage`                                             | Linux with the native dependencies above              |
| `android` | Installable APK for ARM64 and x86_64, signed with a local test key | Any supported desktop host with the Android toolchain |
| `ios`     | Unsigned Simulator `.app`, not a device IPA                        | macOS with Xcode, XcodeGen and CocoaPods              |

Rust and Swift builds use release optimization. macOS bundles use ad-hoc signing so their local code signatures are valid without a developer certificate. No packages are distribution-signed or notarized. The script performs no uploads or publication. Tauri's `--ci` flag only selects non-interactive command-line operation; it does not invoke a hosted CI service.

Before including Android, install both Rust targets and set `JAVA_HOME`, `ANDROID_HOME` and `NDK_HOME` as described above:

```sh
rustup target add aarch64-linux-android x86_64-linux-android
```

For iOS Simulator, install `aarch64-apple-ios-sim` on Apple Silicon or `x86_64-apple-ios` on Intel. The script initializes generated native projects but does not install SDKs or accept their licenses. Do not run other native builds concurrently with a release build in the same checkout. A lock at `target/local-release/build.lock` prevents overlapping release runs and records the owning process ID. After an interrupted run, confirm that this process and any child native builds have stopped before manually deleting that lock. The script never removes an existing lock automatically.

Each invocation creates a new `artifacts/release-*/` directory with platform subdirectories and a `manifest.json`. The manifest records version, host and target Rust triples, target architecture, selected platforms, completed builds and artifact paths. Require `status: "complete"` before using a set of packages; failed runs retain a `failed` manifest and any already completed artifacts. Nothing is collected from an earlier build. Build caches, artifacts and local signing material are ignored by Git.

Android release APKs must be signed to install. The script creates and reuses `target/local-release/android-test.keystore`, using the standard Android debug-key password. It aligns the APK for 16 KB pages, signs it, and verifies the signature. This key is **only for local testing**, not production signing. Removing it changes the signing identity; uninstall an older test installation if Android rejects the replacement signature. Only the signed APK is copied to the artifact directory, never the keystore. App data can be lost when uninstalling, so use test content.

Install the packages inside the matching VM, emulator or simulator and inspect the shell, resizing and compact navigation drawer there. Use the native smoke configuration to verify storage. On macOS, launch the `.app` directly from the artifact directory rather than replacing an existing Situate installation. A successful package build alone does not establish runtime compatibility. Unsigned desktop packages may require local operating-system approval; do not disable system-wide security protections to test them.

The current configuration permits Android API 24+ and iOS 16+. These are deployment settings, not evidence of successful testing on every supported version. Physical-device behavior, minimum-version compatibility, distribution, signing and store approval require separate verification.

## Apple distribution

Use `release:apple` on macOS for Developer-ID-signed, notarized DMGs. The iOS export and upload options described below are retained deferred reference paths, not part of current delivery. The existing `release` command continues to produce local test packages. Neither command uploads to App Store Connect by default; macOS `release:apple` does submit packages to Apple's notarization service. Add `--upload-testflight` to `release:apple` to upload the new iOS package after a successful build. iOS signing uses Xcode automatic provisioning, which can register identifiers and create or update signing assets in the selected Apple developer team.

### One-time account setup

1. Use the paid Apple Developer team intended to own the app. In **Xcode → Settings → Accounts**, sign in and select that team. Complete Xcode's first-launch setup. Install Python 3.12 or newer and the [macOS client prerequisites](#prerequisites). XcodeGen and CocoaPods are needed only for deferred iOS work.
2. Install a **Developer ID Application** certificate and its private key in your login Keychain for macOS. List valid identities with `security find-identity -v -p codesigning`. Do not use Apple Development, Apple Distribution or ad-hoc signing for the DMG. Deferred iOS work additionally requires an Apple signing identity and access to automatic App Store provisioning; Xcode can manage the distribution certificate.
3. Use `com.getsituate.app` as the permanent bundle identifier. An iOS App Store Connect app record is not needed for current macOS delivery. Distribution must not use the development launcher's checkout-specific identifier. Accept any pending Apple agreements. Keep the identifier unchanged across updates.
4. Create an App Store Connect **team API key** authorized for notarization and build uploads under **Users and Access → Integrations → App Store Connect API**. Download its `.p8` private key, and record its Key ID and Issuer ID. Use the least role that permits the required operations; Apple's Developer role supports build uploads. The key's Apple permissions are determined by its role, not by a local vault or bundle identifier. App Store upload permission and iOS provisioning are not macOS release requirements.
5. Set `APPLE_TEAM_ID` and `APPLE_MACOS_SIGNING_IDENTITY` in the repository-root `.env` or environment, using the intended team and an installed Developer ID Application identity. See [Credentials](#credentials) below. No `.apple-release.local.json` is required. The iOS bundle identifier defaults to the tracked `app/src-tauri/tauri.conf.json` identifier, `com.getsituate.app`.

6. Install the Rust targets from `client/`. Universal macOS packages contain both Apple Silicon and Intel executables:

   ```sh
   rustup target add aarch64-apple-darwin x86_64-apple-darwin
   ```

### Credentials

Store Apple signing settings and credentials in the Git-ignored `.env` at the **repository root**, alongside any existing test credentials. Preserve unrelated entries and restrict the file with `chmod 600 .env`. `.env.example` lists the supported variables. Populate them yourself using your preferred credential storage; no secret manager or secret-manager CLI is required or contacted by the scripts.

```dotenv
APPLE_TEAM_ID=TEAM123456
APPLE_MACOS_SIGNING_IDENTITY="Developer ID Application: Example (TEAM123456)"
APPLE_API_KEY=EXAMPLE1234
APPLE_API_ISSUER=11111111-2222-3333-4444-555555555555
APPLE_API_PRIVATE_KEY="<paste the complete .p8 PEM here, including header, body and footer>"
```

The example values are not usable credentials. `APPLE_APP_ID` is the numeric iOS app-record ID from App Store Connect, not an email address or bundle identifier; it is needed only for upload. Use literal newlines within the quoted private-key value. Do not `source` the file: the scripts parse it as data and consume only the Apple variables needed by the operation. Environment variables take precedence even when explicitly empty. With `CI=true`, no `.env` is read. Incomplete credentials fail rather than falling back to another account.

Signing settings use this precedence: explicit environment values, root `.env`, then the optional legacy `client/.apple-release.local.json`. Explicit empty values do not fall back. Existing JSON settings such as `notaryProfile`, `appStoreConnect` and an explicitly configured `iosBundleIdentifier` remain available locally; the scripts do not create or rewrite that file. Without a legacy iOS override, the tracked app identifier is used. In CI, both local configuration files are ignored; supply settings and credentials through the environment. A Developer ID certificate and its private key must still be installed in the Keychain; these environment values select an identity, not create or import one.

Apple tools require a key file. The scripts create a private temporary `.p8` outside the checkout, pass only its path and the key identifiers to Apple's tools, and delete it after completion or handled failure/cancellation. Raw credential values are not forwarded to frontend or Rust builds. Forced process termination can leave a `situate-apple-key-*` directory in the system temporary directory; inspect ownership and active processes before removing an abandoned directory. Do not share `.env`, the key, or private diagnostics with installers.

Existing local configurations can explicitly select a Keychain `notaryProfile` or an `appStoreConnect` key-file configuration instead when no Apple credential variables are defined. There is no automatic credential discovery or fallback to them after invalid `.env` values.

Deferred iOS reference: `app/src-tauri/PrivacyInfo.xcprivacy` declares file-timestamp access for application-container files and user-selected files/directories (`C617.1`, `3B52.1`), used by workspace metadata and change checks. The builder includes it through the standard generated Xcode target and verifies it in the exported IPA. Review additional required-reason APIs when dependencies change; this is not an exhaustive binary audit. Before the first TestFlight upload, review encryption export compliance and current Apple SDK submission requirements. Do not declare encryption exempt without reviewing the app's cryptography. Missing compliance answers can prevent TestFlight availability.

### Build and verify

Complete [release-note preparation](../docs/development/release-preparation.md) first: choose the product version, approve the English source, translate every supported language, finalize and commit the release files. Distribution builds require consistent npm/Cargo/Tauri versions and a clean source revision throughout the macOS build. Retained deferred-platform exports use the same validation. They validate and embed the finalized history without invoking an agent. Ordinary development and local test builds do not require finalized release notes.

Run from `client/`, with no other native build or development session using that checkout:

```sh
npm run release:apple -- --check
npm run release:apple
```

The default is a universal macOS DMG with external update authority. Use `--macos-arch arm64` or `--macos-arch x64` for a single architecture. For iOS, choose an integer build number from 1 to 9999 that is higher than every previous upload of the current marketing version, including uploads from other machines. The marketing version comes from `app/src-tauri/tauri.conf.json`; the build number is applied without modifying tracked files. The development console can [update and commit the app version before building](../docs/development/README.md#development-terminal). Its `--expected-version X.Y.Z` argument binds the build to the selected configured version and refuses a mismatch. App Store Connect remains authoritative for previously uploaded numbers.

`--check` reads tool availability, installed Rust targets and signing identities, and authenticates to the notary service for macOS. It does not build, upload packages or modify provisioning. A successful check does not establish iOS provisioning, app-record existence, store eligibility or device compatibility.

Each build writes a new `artifacts/apple-*/` directory containing `manifest.json`, `SHA256SUMS`, the selected DMG/IPA and, for iOS, `Situate.xcarchive` with its archived symbols. The manifest records the source revision, clean-checkout state and `releaseContent` identity (version, catalog digest and locales). The catalog is also a signed app resource. Require `status: "complete"` before distributing packages. Share the DMG, not the entire build directory or archive. The DMG contains a stapled app and an Applications shortcut; the outer disk image is separately signed, notarized and stapled. Signature, ticket and Gatekeeper checks must all pass. The iOS export is checked for the requested identifier, version, device platform, signing team and a nonexpired App Store provisioning profile. Rust and Swift use release optimization with SwiftPM's default build system.

The scripts do not install or launch the app, overwrite an existing installation, or access personal workspaces. Test installation, restart and updates using disposable workspaces before relying on data preservation. A complete package set is not a runtime acceptance result; iOS product support remains deferred.

Native builds share `target/local-release/build.lock`; iOS also uses the existing Xcode session lock. Check recorded owners and descendant build processes before removing stale locks. Failed builds retain an incomplete manifest and recovery files in `target/apple-release/staging-*/`. Never distribute a failed run. `target/apple-release/notary-pending.json` records each attempt before submission and blocks subsequent macOS builds until the attempt is accepted or manually reconciled. Submission IDs are saved before waiting. A timeout does not cancel Apple's processing; inspect `notarytool info`/`log` for the recorded ID (using the same Apple credential source), or `notarytool history` if submission failed without an ID. Remove the journal only after resolving the attempt and deciding whether a new submission is appropriate. There are no automatic retries.

### Direct macOS releases

Select direct distribution explicitly; existing invocations default to external update authority. iOS always embeds `SITUATE_DISTRIBUTION=external`, including combined builds.

```sh
npm run release:apple -- --distribution direct --check
npm run release:apple -- --distribution direct
```

Direct builds require `SITUATE_UPDATER_PUBLIC_KEY` (Tauri public-key content) and `TAURI_SIGNING_PRIVATE_KEY` (the dedicated updater private-key content), with optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, in the root private `.env` or environment. These are separate from Apple credentials. Explicit environment values, including empty ones, take precedence; CI uses only environment values. The builder does not generate keys or invoke a secret manager. An absent signing configuration fails even with `--check`.

The builder supplies `SITUATE_DISTRIBUTION=direct`, the public key and `SITUATE_UPDATER_ENDPOINT` explicitly before signing. The endpoint defaults to `https://getsituate.com/releases/current/update.json`; an override must be HTTPS without credentials, query or fragment. Production publication requires that exact default endpoint. Public build configuration and clean source revision are also included as a signed bundle resource. Direct builds require a clean committed checkout and reject source changes detected before completion. Only the signer subprocess receives updater private inputs; signer output and errors are not printed.

The `-direct.dmg` and `-direct.app.tar.gz` contain the same final signed, notarized, stapled app. The archive preserves symbolic links and is signed afterward with the pinned Tauri CLI's `signer sign --app-version`. The manifest records both artifact hashes/sizes, the signature sidecar, version, architectures, bundle digest, identity and public configuration. Before completion, the builder verifies the version-bound signature, extracts the archive, mounts the DMG read-only and compares both bundles, signing identity, architecture, tickets and Gatekeeper assessment. Python 3.12 or newer is required for safe archive extraction.

Update installation binds confirmation to the selected verified artifact and prepares every application window, including windows without an open workspace. Cancellation before bundle replacement resumes prepared sessions and retains the verified package without replaying aborted actions. After an installation failure, preparation is released only when the bundle is independently established to be unchanged. In-progress or uncertain replacement is not a safe cancellation point; uncertain replacement or relaunch retains recovery state and requires recovery guidance and explicit revalidation, not automatic retry or restart. Recovery uses a trusted same/newer installer without resetting workspaces.

Use the separate [release publisher](../infrastructure/releases/README.md) for local staging and approved publication. It requires verified universal macOS artifacts built from a clean reviewed commit available in the local Git history. The publication checkout may be on a different revision or contain local edits; it does not rebuild the app. Building never publishes. Local test packages and external variants are not accepted by that publisher. Signed two-version native update qualification of the final intended release configuration remains necessary before production delivery.

### Observe an exact-artifact macOS update

Use a dedicated disposable macOS account or VM with no personal workspaces or credentials. Keep both complete production-configured direct release directories, their reviewed revisions, and the same updater public key. A must have a lower version than B. Do not rebuild or re-sign either app for this test. Existing smoke journeys rebuild instrumented applications and cannot substitute for these artifacts.

`fixture` creates a new legacy workspace with an empty readable `.situate` directory, an ownership marker and two synthetic content files. Open it as an existing workspace; production admission initializes the workspace identity. Do not use **Create workspace** for this already populated folder.

The local observer reads only the explicitly selected bundles, release files, fixture ownership marker and two fixed synthetic workspace files, and checks that `.situate` remains a readable directory. It never reads `.env`, signs, installs, launches, publishes or changes routing. Set `SITUATE_UPDATER_PUBLIC_KEY` in the environment. Run from the repository root, using canonical absolute paths for directories; keep receipts outside the app and workspace under a private, Git-ignored artifact directory.

```sh
node client/scripts/qualify-direct-update.mjs fixture --workspace /ABSOLUTE/NEW_WORKSPACE
# Install A from its verified DMG at the app path below; leave the app stopped.
node tools/run-coordinated.mjs -- node client/scripts/qualify-direct-update.mjs begin --from /ABSOLUTE/RELEASE_A --to /ABSOLUTE/RELEASE_B --from-revision FULL_SHA_A --to-revision FULL_SHA_B --team-id TEAM123456 --app /ABSOLUTE/Situate.app --workspace /ABSOLUTE/NEW_WORKSPACE --receipt /ABSOLUTE/ARTIFACTS/before.json
# Launch that A, choose Open workspace and select NEW_WORKSPACE, then update through the product UI,
# verify B relaunches and reopens the workspace, then quit B normally.
node tools/run-coordinated.mjs -- node client/scripts/qualify-direct-update.mjs finish --receipt /ABSOLUTE/ARTIFACTS/before.json
```

Replace the example team with the unchanged release team. Both observations revalidate both manifests, artifact hashes, updater signatures, production configuration, DMG/archive equality and Apple assessments. `begin` requires the installed A bundle digest; `finish` requires the exact B digest and unchanged fixture ownership/content. Receipts are exclusive mode-0600 files; completion writes `before.json.after.json` without replacing the original. Any mismatch blocks the observation. Preserve evidence rather than automatically retrying an uncertain installation.

These receipts prove on-disk bundle identity and preservation of the two synthetic files, not that the updater performed the replacement, that relaunch succeeded, or that all application state survived. Record those native observations separately, including update cancellation, unsaved edits, multiwindow preparation and restart behavior. Do not manually replace A with B and call that an updater test. Access to B through A's embedded production HTTPS endpoint requires separately approved hosting or an isolated test-network arrangement that preserves the URL and TLS validation. An endpoint override, preview feed, synthetic signature or fixture-only check does not qualify the final production configuration. The observer does not establish download quarantine or first-launch Gatekeeper behavior; test those on the actual downloaded DMG separately.

### Upload to TestFlight

**Deferred reference:** iOS build/upload tooling is retained, but no iOS submission or deployment is part of current scope. This section does not add prerequisites to macOS delivery.

For the scripted upload, use **Xcode 27 or newer** and the [Apple credentials](#credentials) above. Set `APPLE_APP_ID` to the app record matching `iosBundleIdentifier`. The uploader uses the configured key directly and does not search other credential directories.

To build and upload in one command:

```sh
npm run release:apple -- --platform ios --build-number 1 --upload-testflight
npm run release:apple -- --platform all --build-number 2 --upload-testflight
```

The combined command checks local upload credentials and tool availability before building. It uploads only the iOS package returned by that invocation, after all selected platforms finish successfully. `--check --upload-testflight` checks prerequisites without building or uploading. If upload fails, the completed packages remain available; inspect `upload.json` and App Store Connect before retrying. Do not start another upload while the previous outcome is uncertain.

To upload an already completed build separately:

```sh
npm run release:apple:upload -- --release artifacts/apple-<run>
```

The uploader verifies the IPA checksum and configured identifier, validates with Apple, then uploads once. It creates `upload.json` before contacting the validation/upload service. An existing receipt blocks another submission, including after an interrupted or uncertain upload. Check App Store Connect before manually removing a receipt to retry. `processing` means `altool --wait` finished transferring the build, not that Apple finished processing, approved a beta, or made it available to testers. The captured command output is retained in the `stdout` field of the private `upload-response.json`, including multiple JSON documents or status messages; do not share account diagnostics with installers. No public App Store submission, tester invitation or automatic tester distribution is performed.

Alternatively, open `Situate.xcarchive` in Xcode Organizer and use its App Store Connect distribution flow. After processing, resolve compliance questions in App Store Connect and add the build to the intended internal testing group. Internal testers need appropriate App Store Connect access; external testing may require beta review. Both routes require installing Apple's TestFlight app on the test devices.

References: [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [iOS signing](https://v2.tauri.app/distribute/sign/ios/), [App Store distribution](https://v2.tauri.app/distribute/app-store/).

## Docker builds

A Docker-capable host can produce Linux packages without installing the native Linux toolchain locally:

```sh
npm run release:docker
npm run release:docker -- --arch x64
npm run release:docker -- --check
```

The default follows the Docker engine's architecture. The images pin their base digests and use a dated Debian 12 package snapshot. Build caches stay in Docker volumes, separate from native builds. Output is exported beneath `artifacts/docker-*/`.

Windows x64 NSIS cross-builds use a separate image target and require explicit acknowledgement of Microsoft component terms. See [container setup, licensing, checks and cache recovery](docker/README.md). macOS builds require macOS and Xcode. Retained iOS and Android commands are deferred reference paths.

## Local data

If the retained storage command is invoked, the regular application's file is typically located at:

- macOS: `~/Library/Application Support/com.getsituate.app/text.txt`
- Windows: `%APPDATA%/com.getsituate.app/text.txt`
- Linux: `$XDG_DATA_HOME/com.getsituate.app/text.txt`, or `~/.local/share/com.getsituate.app/text.txt`
- Mobile: inside the application's private data directory.

The regular app uses `com.getsituate.app`. Earlier development installations using `dev.situate.client` retain their separate application data; no automatic migration or deletion occurs. Open existing workspace folders explicitly in the new app. Smoke and visual test identities remain separate.

## Icons and dependencies

The icons in `app/src-tauri/icons/` are generated from the [app-icon artwork](../design/brand/assets/app-icon.svg): the original [Mini Bend](../design/brand/bend/mini/README.md) in surface white on violet-deep. To regenerate from `client/`:

```sh
npx tauri icon ../design/brand/assets/app-icon.svg -o app/src-tauri/icons --ios-color '#6232bc'
```

The source is square and unmasked; platform masks are applied separately. The iOS and Android backgrounds use the same violet-deep color. Preserve the [repository licensing status](../README.md#license) and [asset provenance](../design/brand/docs/provenance.md).

The native [OpenAI OAuth implementation](app/src-tauri/src/openai_oauth.rs) adapts the public-client protocol from Pi AI 1.0.2 and retains Mario Zechner's MIT copyright and permission notice in that source file. Include that notice in applicable distributions. SHA-2, Base64, Rand and UUID dependencies retain their MIT/Apache-2.0 terms.

Rig (`rig-core` and `rig-agent`) is MIT licensed; its [copyright and permission notice](app/public/licenses/rig.txt) is included in the app assets. The [model catalog notice](app/public/licenses/ai-catalog.txt) covers the retained Pi AI catalog snapshot. Native HTTP (`reqwest`), authenticated encryption (`chacha20poly1305`), keychain access (`security-framework`), zeroization and capability filesystem extensions retain their MIT/Apache-2.0 terms. Distributions must include the notices required by the licenses of the components they contain. Tauri and its plugin build tooling are MIT/Apache-2.0 licensed; Vue, its compiler and the local module lexer (`es-module-lexer`) are MIT licensed. The desktop folder picker uses MIT-licensed `rfd`. Capability-relative directory operations use `cap-std` and `cap-primitives`, offered under MIT or Apache-2.0 (also Apache-2.0 with the LLVM exception). Atomic registry replacement uses MIT/Apache-2.0 `tempfile`. AndroidX Activity and AppCompat are Apache-2.0 licensed. The `git2` Rust wrapper is MIT/Apache-2.0 licensed; its bundled libgit2 is GPLv2 with an explicit linking exception. `rustix` and `yaml-rust2` are MIT/Apache-2.0 licensed; `pulldown-cmark` and `pulldown-cmark-escape` are MIT licensed. Dependency versions are recorded in the npm and Cargo lockfiles; dependencies retain their own licenses and notices. Review and include applicable notices before distributing binaries. Original Situate software and documentation are MIT-licensed; original artwork is licensed under CC BY 4.0. See [Licensing and reuse](../LICENSING.md) for scope and third-party exceptions.

### License material in Apple packages

Apple distribution builds collect notices for bundled JavaScript, target-specific Rust packages, the selected Rust standard library and runtime, and pinned Swift dependencies. JavaScript notices cover the main app, workers and both native renderer scripts. The packages retain Situate's software and artwork notices, third-party notices, and checksum-verified source archives and public source URLs for MPL components.

Open **Settings → About Situate → View licenses and notices** to read the notices and copy source URLs. The notice text is bundled with the app.

The collector requires the locked Cargo archives. When a crate omits its license text, it retrieves notices from the exact upstream revision recorded in that archive. Missing or changed license material blocks the distribution build. Swift notices are version-, revision- and hash-bound; they do not include the dependency's complete source repository or unused data files.

Before notarization or upload, packaging verifies the copied license resources and rejects unexpected FluidAudio resource bundles or TTS dictionaries. Dictation model weights remain separate downloads. These checks verify the collected material and package contents; they do not replace review of new dependency terms.
