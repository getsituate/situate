# Workspace views and navigation

The client host API lives in `client/app/src/layout/registry.ts`. `workspaceUi(workspaceId)` in `layout/runtime.ts` provides the workspace's registry, coordinator and presentation session. Native workspace authorization remains independent of these frontend objects.

## Registration

Register built-ins with `registry.register(definition)` and plugin views with `registry.registerPlugin({ pluginId, enabled, views })`. Definitions have `id`, `title()`, `icon`, a Vue `component`, and an optional `reveal(contentId, revision?)` callback returning JSON presentation state, synchronously or asynchronously. Plugin view IDs must begin with `${pluginId}:`; IDs cannot collide. Registration returns a disposer. Disabling a plugin must dispose its registration or call `removePlugin(pluginId)`.

Plugin registration requires successful application startup initialization through `initializeRecovery()` in `app/src/recovery.ts`. Before initialization and on initialization failure, every registry rejects plugin registration. During recovery, a workspace-bound registry admits only plugins individually resumed in that workspace; resume-all releases the temporary application-wide gate without changing saved enabled preferences. Use `createViewRegistry(workspaceId)` for workspace-owned registrations. Native resumption state is loaded before mounting the interface and updated through application events; see [plugin-free startup](../../client/README.md#plugin-free-startup-on-macos). Clearing a registry's local recovery flag cannot override application suspension.

A registry's local recovery mode removes registered plugin views and rejects further plugin registrations. Leaving local recovery does not automatically register them again. Removing a registration alone does not delete its saved navigation targets or histories; the host presents an unavailable view until registration returns or the user navigates elsewhere. Uninstallation and confirmed plugin-directory removal are different: the host clears obsolete plugin targets, pins and presentation from open and closed pane histories. A replacement installation with the same plugin ID does not inherit the removed installation's presentation.

For example, a synthetic plugin can register a counter view against a supplied workspace registry:

```ts
import { defineComponent, h } from "vue";
import type { ViewRegistry } from "./layout/registry";

export function registerDemo(registry: ViewRegistry) {
  return registry.registerPlugin({
    pluginId: "demo",
    enabled: true,
    views: [
      {
        id: "demo:counter",
        title: () => "Demo counter",
        icon: "folder",
        component: defineComponent({
          props: { presentation: Object },
          emits: ["presentation"],
          setup(props, { emit }) {
            return () =>
              h(
                "button",
                {
                  onClick: () =>
                    emit("presentation", {
                      count: (props.presentation?.count ?? 0) + 1,
                    }),
                },
                String(props.presentation?.count ?? 0),
              );
          },
        }),
      },
    ],
  });
}
```

The example assumes a module under `client/app/src/`. Production view titles and visible strings belong in localization catalogs. The [workspace plugin runtime](../../client/README.md#plugin-runtime) supplies authorized registrations, enabled status and recovery checks for package entries. An entry factory returns view definitions rather than accessing the registry directly. Registration alone neither discovers nor executes plugin packages.

## Navigation and lifecycle

- `coordinator.open(target, ticket?, guard?, presentation?)` opens a registered view or conversation. Optional initial presentation is applied before mounting the destination. Targets are `{ kind: "view", viewId, contentId?, revision? }`, `{ kind: "conversation", conversationId }`, or `{ kind: "empty" }`. File content IDs are portable workspace-relative paths, not absolute paths or traversal paths. A revision requires a content ID.
- Ordinary opening uses the focused pane. Conversation opening instead reveals an existing current display when present. Opening from an empty layout creates its first tab and pane; callers do not need to create tabs or split panes first.
- `session.capture({ tabId, paneId })` captures an explicit destination for deferred `open` calls. Focus changes do not retarget that ticket. Closing and reopening its pane or tab invalidates it, even when saved IDs are reused.
- `coordinator.reveal(viewId, contentId, revision?, guard?)` captures the focused pane before calling the view's optional resolver, then opens the target and retains the returned presentation. The resolver must not itself navigate or mutate workspace data. Removal or replacement of its definition, or closure of its destination, discards a late result.
- Optional guards contain `signal` and `isCurrent()`. The coordinator checks them before asynchronous work and before applying its result. Aborting prevents late navigation; it does not forcibly cancel a plugin resolver's own work.

Mounted view components receive `workspaceId`, `workspaceName`, `embedded`, `target: { contentId?, revision? }` and retained `presentation`. Emit `presentation` with JSON-compatible view state and `navigate` with a target and optional initial presentation as its second argument. Keep drafts and domain records in their owning stores, not presentation. Persisted plugin presentation belongs in the owning plugin's `.runtime/` directory; host layout retains only installation-bound references. Native layout storage resolves those references only against the same installation identity and never recreates a missing owner. Built-in file and conversation presentation remain part of host layout. Clean up subscriptions and other mounted resources with Vue lifecycle hooks. Unmounting a view must not stop workspace-owned execution. Restoring a presentation does not invoke its reveal resolver or start an agent.

Agent tools `open_view`, `reveal_content` and `open_conversation` use the coordinator bound when the tools are created. They cannot choose another workspace, create conversations, send messages or modify files. An unbound or replaced coordinator invalidates those tools; a new workspace lifetime needs newly created tools.

## File references

[ADR-0012](../architecture/09-architecture-decisions/ADR-0012-unify-git-anchored-file-references.adoc) selects Git-anchored live references for every file, extending [ADR-0010](../architecture/09-architecture-decisions/ADR-0010-git-authoritative-file-history.adoc). Markdown and other files use the same anchored selectors. Unsupported stored formats fail closed and retain overwrite protection. The original no-conversion exception applies only to formats verified never to have shipped publicly; later changes follow [released-version compatibility](../../requirements/data/requirements/REQ-0069-preserve-workspace-version-compatibility.md). Format mismatch never authorizes workspace cleanup, reset or deletion.

`captureReference(workspaceId, path, expectedRevision?)` in `ai/content-references.ts` captures a newly selected live source through native workspace authorization. When selection comes from an open document, pass its saved `version.revision` to reject replacement between display and capture. Capture selects a source explicitly: never call it automatically to rebind stored references. `workspaceChat(...).addReference(reference)` requires a captured live anchor or a historical revision.

A live file reference retains its original `path` and an `anchorRevision`: the canonical, lowercase, 40-character Git commit ID at capture. This applies to Markdown with or without frontmatter and to other files; `fileId` is not a supported selector. This is distinct from the saved content/blob revision passed as `expectedRevision`.

Do not rewrite a path reference's path or advance its anchor in frontend code. Native resolution follows validated, completed moves through retained Git history and returns the current document path separately. It works without opening or rewriting each conversation and does not change conversation CAS revisions. Copies do not take over the original reference; confirmed deletion and unresolved interruptions prevent path reuse from silently selecting another file. Missing, unsupported or inconsistent history fails closed.

`resolveReference(workspaceId, reference, render?)` returns a verified document at its current path. Use `render: true` only for document display; sending resolves source text without loading linked images. Navigation into the built-in file view also passes `{ reference }` as initial presentation so its loading and polling retain identity rather than reread an unguarded path. Historical references retain their exact path and commit revision.

`workspaceId` belongs to the runtime/IPC reference, not its persisted selector. Native conversation storage omits it in draft, queued-input and stored-run references; layout storage does the same for the built-in file view's `presentation.reference` in every navigation entry, including inactive entries and closed tabs. On load, native storage binds those local selectors to the authorized current workspace without changing anchors, stored bytes or storage revisions. A copied or moved closed workspace therefore resolves its own references, not the original location's files.

Callers continue sending bound references and must not change their scope or recapture them during restoration. Native writes reject foreign bindings. Malformed or unsupported scope-bearing stored references fail closed without recapture or overwrite. No conversion is supplied for unpublished development formats; supported published formats require compatibility handling or tested migration before their readers are changed. Opaque plugin presentation and user text are not searched or rewritten. Diagnostic workspace IDs are correlation data, never a way to locate or authorize another copy.

Path-only references, epoch/journal fields, mixed identities and malformed anchors are rejected. Unreadable stored conversations retain overwrite protection; loading does not convert their references, recapture paths or replace their records with empty state. Missing files and uncertain interrupted operations never fall back to the current occupant of the old path. Restoration after known deletion requires a new explicit selection; it does not reactivate the old reference. Task UUID resolution remains separate.
