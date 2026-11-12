import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { acceptRecoveryState, initializeRecovery } from "../recovery";
import { invoke } from "@tauri-apps/api/core";
import { workspaceUi, retainWorkspaceUi } from "./runtime";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "plugin_executor")
      return (args?.request as { operation: string }).operation === "snapshot"
        ? {
            plugins: [
              {
                pluginId: "demo",
                revision: null,
                incarnation: "initial-installation",
                generation: 1,
                tools: [],
                exports: [],
                source: {
                  manifest: {
                    schemaVersion: 2,
                    id: "demo",
                    name: "Demo",
                    description: "Synthetic navigation views.",
                    skills: [],
                  },
                  serviceEntry: null,
                  uiEntry: null,
                  skills: [],
                },
              },
            ],
            unavailable: [],
          }
        : [];
    if (command === "plugin_recovery_mode") return true;
    if (command === "plugin_recovery_state")
      return { revision: 0, recovery: true, resumed: [] };
    if (command === "layout_load") return { revision: null, data: null };
    if (command === "plugin_runtime")
      return {
        plugins: [
          {
            id: "demo",
            incarnation: "initial-installation",
            enabled: true,
            manifest: {
              schemaVersion: 2,
              id: "demo",
              name: "Demo",
              description: "Synthetic navigation views.",
              skills: [],
            },
            error: null,
          },
        ],
        revision: "state",
      };
    throw new Error(`Unexpected command: ${command}`);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../ai/chat", () => ({
  workspaceConversations: () => ({ state: { conversations: [] } }),
}));

let recoveryRevision = 0;
beforeEach(async () => {
  await initializeRecovery();
  acceptRecoveryState({
    revision: ++recoveryRevision,
    recovery: true,
    resumed: [],
  });
  vi.mocked(invoke).mockClear();
});
afterEach(() => {
  retainWorkspaceUi([]);
  vi.useRealTimers();
});

it("detects an externally deleted plugin and removes its pinned and open views while the workspace stays open", async () => {
  vi.useFakeTimers();
  const ui = workspaceUi("external-delete");
  const runtime = (await ui.plugins)!;
  await runtime.ready;
  await ui.session.load();
  ui.session.pin("demo:settings");
  ui.session.open({ kind: "view", viewId: "demo:settings" });
  await nextTick();
  expect(ui.session.state.document!.pinnedViews).toContain("demo:settings");
  expect(
    ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
      -1,
    )!.target,
  ).toEqual({ kind: "view", viewId: "demo:settings" });
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args, options) => {
    if (command === "plugin_runtime")
      return { plugins: [], revision: "deleted" };
    return original(command, args, options);
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.state.plugins).toEqual([]);
  expect(ui.session.state.document!.pinnedViews).toEqual(["files"]);
  expect(
    ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
      -1,
    )!.target,
  ).toEqual({ kind: "empty" });
  vi.mocked(invoke).mockImplementation(original);
});

it("discards old presentation and pins when an installation is replaced between inventory polls", async () => {
  vi.useFakeTimers();
  const original = vi.mocked(invoke).getMockImplementation()!;
  let incarnation = "old-installation";
  vi.mocked(invoke).mockImplementation(async (command, args, options) => {
    if (command === "plugin_runtime")
      return {
        plugins: [
          {
            id: "demo",
            incarnation,
            enabled: true,
            manifest: {
              schemaVersion: 2,
              id: "demo",
              name: "Demo",
              description: "Synthetic navigation views.",
              skills: [],
            },
            error: null,
          },
        ],
        revision: incarnation,
      };
    return original(command, args, options);
  });
  const ui = workspaceUi("replace-between-polls");
  const runtime = (await ui.plugins)!;
  await runtime.ready;
  await ui.session.load();
  ui.session.open({ kind: "view", viewId: "demo:settings" });
  ui.session.pin("demo:settings");
  const address = ui.session.capture().address!;
  const entryId =
    ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
      -1,
    )!.id;
  ui.session.dispatch({
    type: "retain-presentation",
    ...address,
    entryId,
    presentation: { oldDraft: "retained" },
  });
  await nextTick();
  expect(ui.session.state.document!.pinnedViews).toContain("demo:settings");
  expect(
    ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
      -1,
    )!.presentation,
  ).toEqual({ oldDraft: "retained" });
  incarnation = "replacement-installation";
  await vi.advanceTimersByTimeAsync(2000);
  const entry =
    ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
      -1,
    )!;
  expect(runtime.state.plugins).toHaveLength(1);
  expect(entry.target).toEqual({ kind: "empty" });
  expect(entry.presentation).toBeNull();
  expect(ui.session.state.document!.pinnedViews).toEqual(["files"]);
  vi.mocked(invoke).mockImplementation(original);
});

it("starts a workspace with only file and conversation views when plugins may execute", async () => {
  acceptRecoveryState({
    revision: ++recoveryRevision,
    recovery: false,
    resumed: [],
  });
  const ui = workspaceUi("new-workspace");
  const runtime = (await ui.plugins)!;
  await runtime.ready;
  expect(runtime.state.plugins[0]?.status).toBe("loaded");
  expect([...ui.registry.definitions.keys()]).toEqual([
    "files",
    "conversation",
  ]);
});

it("does not initialize a plugin runtime after its workspace closes during lazy loading", async () => {
  const ui = workspaceUi("closed-before-import");
  retainWorkspaceUi([]);
  expect(await ui.plugins).toBeUndefined();
});

it("keeps built-in navigation available and suppresses plugins in every workspace lifetime", async () => {
  const first = workspaceUi("first");
  const firstPlugins = (await first.plugins)!;
  await firstPlugins.ready;
  await initializeRecovery();
  const second = workspaceUi("second");
  retainWorkspaceUi(["second"]);
  const reopened = workspaceUi("first");
  expect(reopened).not.toBe(first);
  expect(workspaceUi("second")).toBe(second);
  const secondPlugins = (await second.plugins)!;
  const reopenedPlugins = (await reopened.plugins)!;
  await Promise.all([secondPlugins.ready, reopenedPlugins.ready]);
  expect(firstPlugins.state.status).toBe("disposed");
  expect(secondPlugins.state.plugins[0]?.status).toBe("suppressed");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "plugin_runtime")
      .every(
        ([, args]) =>
          (args as { request: { operation: string } }).request.operation ===
          "list",
      ),
  ).toBe(true);
  for (const ui of [first, second, reopened]) {
    ui.registry.setRecovery(false);
    expect(() =>
      ui.registry.registerPlugin({
        pluginId: "demo",
        enabled: true,
        views: [],
      }),
    ).toThrow("layoutHost.pluginUnavailable");
    expect([...ui.registry.definitions.keys()]).toEqual([
      "files",
      "conversation",
    ]);
  }
  for (const ui of [second, reopened]) {
    await expect(
      ui.coordinator.open({
        kind: "view",
        viewId: "files",
        contentId: "note.md",
      }),
    ).resolves.toBe(true);
    await expect(
      ui.coordinator.open({ kind: "conversation", conversationId: "repair" }),
    ).resolves.toBe(true);
    await expect(
      ui.coordinator.open({ kind: "view", viewId: "demo:notes" }),
    ).rejects.toThrow("layoutHost.viewUnavailable");
  }
});
