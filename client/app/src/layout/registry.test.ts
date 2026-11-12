import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeRecovery } from "../recovery";
import { flushPromises, mount } from "@vue/test-utils";
import {
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
  onUnmounted,
  type Component,
  watch,
} from "vue";
import { createLayoutSession } from "./session";
import {
  createUiCoordinator,
  createViewRegistry,
  type ViewDefinition,
} from "./registry";
import { emptyLayout, selectedTab } from "./model";
import { currentEntry } from "./navigation";
import ViewHost from "./ViewHost.vue";

beforeAll(initializeRecovery);

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose());
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function definition(
  id: string,
  reveal?: ViewDefinition["reveal"],
): ViewDefinition {
  return {
    id,
    title: () => id,
    icon: "folder",
    component: defineComponent(() => () => h("p", id)),
    reveal,
  };
}
async function setup() {
  let id = 0;
  const session = createLayoutSession(
    "workspace",
    {
      load: async () => ({
        revision: "1",
        data: { version: 1, layout: emptyLayout(), pinnedViews: [] },
      }),
      save: async (_workspace, _revision, data) => ({ revision: "2", data }),
    },
    () => `id-${++id}`,
  );
  cleanup.push(() => session.dispose());
  const registry = createViewRegistry();
  registry.register(definition("files"));
  registry.register(definition("conversation"));
  const coordinator = createUiCoordinator(session, registry);
  await session.load();
  return {
    session,
    registry,
    coordinator,
    titleFor: () => "Test",
    plugins: undefined,
    dispose: () => {},
  };
}
function entry(ui: Awaited<ReturnType<typeof setup>>) {
  const tab = selectedTab(ui.session.state.document!.layout)!;
  return currentEntry(
    tab.panes.find((pane) => pane.id === tab.activePaneId)!.navigation,
  );
}

describe("registered workspace navigation", () => {
  it("publishes complete plugin view batches and preserves the old batch on validation failure", () => {
    const registry = createViewRegistry();
    registry.register(definition("files"));
    registry.registerPlugin({
      pluginId: "a",
      enabled: true,
      views: [definition("a:old")],
    });
    registry.registerPlugin({
      pluginId: "b",
      enabled: true,
      views: [definition("b:old")],
    });
    const observed: string[][] = [];
    const stop = watch(
      () => [...registry.definitions.keys()],
      (ids) => observed.push(ids),
      { flush: "sync" },
    );
    cleanup.push(stop);
    registry.replacePlugins(new Set(["a", "b"]), [
      { pluginId: "a", enabled: true, views: [definition("a:new")] },
      { pluginId: "b", enabled: true, views: [definition("b:new")] },
    ]);
    expect(observed).toEqual([["files", "a:new", "b:new"]]);
    expect(() =>
      registry.replacePlugins(new Set(["a", "b"]), [
        { pluginId: "a", enabled: true, views: [definition("a:replacement")] },
        { pluginId: "b", enabled: true, views: [definition("files")] },
      ]),
    ).toThrow("layoutHost.duplicateView");
    expect([...registry.definitions.keys()]).toEqual([
      "files",
      "a:new",
      "b:new",
    ]);
    expect(observed).toHaveLength(1);
  });

  it("retains initial view state before mounting a newly opened target", async () => {
    const ui = await setup();
    await ui.coordinator.open(
      { kind: "view", viewId: "files", contentId: "new.md" },
      undefined,
      undefined,
      { mode: "source" },
    );
    expect(entry(ui).presentation).toEqual({ mode: "source" });
    expect(entry(ui).target).toEqual({
      kind: "view",
      viewId: "files",
      contentId: "new.md",
    });
  });
  it("shows loading until a registered asynchronous view is ready", async () => {
    const ui = await setup();
    const ready = deferred<Component>();
    ui.registry.register({
      ...definition("slow"),
      component: defineAsyncComponent(() => ready.promise),
    });
    await ui.coordinator.open({ kind: "view", viewId: "slow" });
    const tab = selectedTab(ui.session.state.document!.layout)!;
    const host = mount(ViewHost, {
      props: { ui, tab, pane: tab.panes[0]!, workspaceName: "Workspace" },
    });
    cleanup.push(() => host.unmount());
    expect(host.get('[role="status"]').text()).toContain("layoutHost.loading");
    ready.resolve(defineComponent(() => () => h("p", "Loaded content")));
    await flushPromises();
    expect(host.text()).toBe("Loaded content");
  });
  it("keeps a failed view target in history and offers a retry", async () => {
    const ui = await setup();
    ui.registry.register({
      ...definition("broken"),
      component: defineComponent({
        setup() {
          throw new Error("load failed");
        },
      }),
    });
    await ui.coordinator.open({ kind: "view", viewId: "broken" });
    const tab = selectedTab(ui.session.state.document!.layout)!;
    const host = mount(ViewHost, {
      props: { ui, tab, pane: tab.panes[0]!, workspaceName: "Workspace" },
    });
    cleanup.push(() => host.unmount());
    await nextTick();
    expect(host.text()).toContain("layoutHost.viewFailed");
    expect(host.text()).toContain("layoutHost.retry");
    expect(entry(ui).target).toEqual({ kind: "view", viewId: "broken" });
  });
  it("uses one focused-pane history for built-in and plugin views without extra tabs or splits", async () => {
    const ui = await setup();
    ui.registry.registerPlugin({
      pluginId: "demo",
      enabled: true,
      views: [definition("demo:notes")],
    });
    const destination = ui.session.capture().address!;
    await ui.coordinator.open({
      kind: "view",
      viewId: "files",
      contentId: "notes.md",
    });
    await ui.coordinator.open({
      kind: "view",
      viewId: "demo:notes",
      contentId: "note-1",
    });
    const tab = selectedTab(ui.session.state.document!.layout)!;
    expect(ui.session.state.document!.layout.tabs).toHaveLength(1);
    expect(tab.panes).toHaveLength(1);
    expect(tab.activePaneId).toBe(destination.paneId);
    expect(
      tab.panes[0]!.navigation.entries.map((entry) => entry.target),
    ).toEqual([
      { kind: "empty" },
      { kind: "view", viewId: "files", contentId: "notes.md" },
      { kind: "view", viewId: "demo:notes", contentId: "note-1" },
    ]);
    ui.coordinator.dispatch({ type: "history", ...destination, delta: -1 });
    expect(entry(ui).target).toEqual({
      kind: "view",
      viewId: "files",
      contentId: "notes.md",
    });
  });

  it("reveals an already open conversation rather than creating a second instance", async () => {
    const ui = await setup();
    await ui.coordinator.open({
      kind: "conversation",
      conversationId: "first",
    });
    const first = ui.session.capture().address!;
    ui.session.dispatch({ type: "new-tab" });
    await ui.coordinator.open({
      kind: "conversation",
      conversationId: "first",
    });
    expect(ui.session.capture().address).toEqual(first);
    expect(ui.session.state.document!.layout.tabs).toHaveLength(2);
    expect(
      selectedTab(ui.session.state.document!.layout)!.panes[0]!.navigation
        .entries,
    ).toHaveLength(2);
  });

  it("honors explicit pane destinations after focus changes", async () => {
    const ui = await setup();
    const ticket = ui.session.capture();
    ui.session.dispatch({ type: "split", ...ticket.address!, edge: "right" });
    const second = ui.session.capture().address!;
    expect(second).not.toEqual(ticket.address);
    await ui.coordinator.open(
      { kind: "view", viewId: "files", contentId: "one.md" },
      ticket,
    );
    const tab = selectedTab(ui.session.state.document!.layout)!;
    expect(
      currentEntry(
        tab.panes.find((pane) => pane.id === ticket.address!.paneId)!
          .navigation,
      ).target,
    ).toEqual({ kind: "view", viewId: "files", contentId: "one.md" });
    expect(
      currentEntry(
        tab.panes.find((pane) => pane.id === second.paneId)!.navigation,
      ).target,
    ).toEqual({ kind: "empty" });
  });

  it("retains reveal presentation when opening in the restored empty tab", async () => {
    const ui = await setup();
    ui.registry.registerPlugin({
      pluginId: "demo",
      enabled: true,
      views: [definition("demo:notes", () => ({ selection: "item" }))],
    });
    await ui.coordinator.reveal("demo:notes", "item");
    expect(entry(ui).presentation).toEqual({ selection: "item" });
    expect(ui.session.state.document!.layout.tabs).toHaveLength(1);
  });

  it("keeps asynchronous reveal addressed to its original pane when focus changes", async () => {
    const ui = await setup();
    const pending = deferred<{ scroll: number }>();
    const started = deferred<void>();
    ui.registry.registerPlugin({
      pluginId: "demo",
      enabled: true,
      views: [
        definition("demo:notes", () => {
          started.resolve();
          return pending.promise;
        }),
      ],
    });
    const original = ui.session.capture().address!;
    const reveal = ui.coordinator.reveal("demo:notes", "item");
    await started.promise;
    ui.session.dispatch({ type: "new-tab" });
    const other = ui.session.capture().address!;
    pending.resolve({ scroll: 12 });
    expect(await reveal).toBe(true);
    const tabs = ui.session.state.document!.layout.tabs;
    expect(
      currentEntry(
        tabs.find((tab) => tab.id === original.tabId)!.panes[0]!.navigation,
      ).presentation,
    ).toEqual({ scroll: 12 });
    expect(
      currentEntry(
        tabs.find((tab) => tab.id === other.tabId)!.panes[0]!.navigation,
      ).target,
    ).toEqual({ kind: "empty" });
  });

  it.each(["close-reopen", "unregister", "recovery", "replace", "dispose"])(
    "rejects late reveal after %s without replacing retained history",
    async (change) => {
      const ui = await setup();
      const pending = deferred<null>();
      const started = deferred<void>();
      const release = ui.registry.registerPlugin({
        pluginId: "demo",
        enabled: true,
        views: [
          definition("demo:notes", () => {
            started.resolve();
            return pending.promise;
          }),
        ],
      });
      const reveal = ui.coordinator.reveal("demo:notes", "late");
      await started.promise;
      if (change === "close-reopen") {
        ui.session.dispatch({
          type: "close-tab",
          tabId: ui.session.capture().address!.tabId,
        });
        ui.session.dispatch({ type: "reopen-tab" });
      } else if (change === "recovery") ui.registry.setRecovery(true);
      else if (change === "dispose") ui.session.dispose();
      else {
        release();
        if (change === "replace")
          ui.registry.registerPlugin({
            pluginId: "demo",
            enabled: true,
            views: [definition("demo:notes")],
          });
      }
      const before = ui.session.state.document;
      pending.resolve(null);
      expect(await reveal).toBe(false);
      expect(ui.session.state.document).toBe(before);
    },
  );

  it("rejects disabled registrations and recovery registrations without altering built-ins", async () => {
    const ui = await setup();
    const plugin = {
      pluginId: "demo",
      enabled: false,
      views: [definition("demo:notes")],
    };
    expect(() => ui.registry.registerPlugin(plugin)).toThrow(
      "layoutHost.pluginUnavailable",
    );
    ui.registry.registerPlugin({ ...plugin, enabled: true });
    ui.registry.setRecovery(true);
    expect([...ui.registry.definitions.keys()]).toEqual([
      "files",
      "conversation",
    ]);
    expect(() =>
      ui.registry.registerPlugin({ ...plugin, enabled: true }),
    ).toThrow("layoutHost.pluginUnavailable");
    await expect(
      ui.coordinator.open({ kind: "view", viewId: "demo:notes" }),
    ).rejects.toThrow("layoutHost.viewUnavailable");
  });

  it("rejects unsafe file targets before reveal providers or navigation run", async () => {
    const ui = await setup();
    const before = ui.session.state.document;
    await expect(
      ui.coordinator.reveal("files", "../outside.md"),
    ).rejects.toThrow();
    await expect(
      ui.coordinator.open({
        kind: "view",
        viewId: "files",
        contentId: "/outside.md",
      }),
    ).rejects.toThrow();
    expect(ui.session.state.document).toBe(before);
  });

  it("captures/restores plugin presentation and releases mounted resources when unavailable", async () => {
    const ui = await setup();
    const disposed = vi.fn();
    const component = defineComponent({
      props: ["presentation"],
      emits: ["presentation"],
      setup(props, { emit }) {
        onUnmounted(disposed);
        return () =>
          h(
            "button",
            { onClick: () => emit("presentation", { scroll: 42 }) },
            JSON.stringify(props.presentation),
          );
      },
    });
    const view = { ...definition("demo:notes"), component };
    const release = ui.registry.registerPlugin({
      pluginId: "demo",
      enabled: true,
      views: [view],
    });
    await ui.coordinator.open({
      kind: "view",
      viewId: "demo:notes",
      contentId: "missing-item",
    });
    const host = mount(
      defineComponent(() => () => {
        const tab = selectedTab(ui.session.state.document!.layout)!;
        return h(ViewHost, {
          ui,
          tab,
          pane: tab.panes[0]!,
          workspaceName: "Test",
        });
      }),
    );
    cleanup.push(() => host.unmount());
    await host.get("button").trigger("click");
    expect(entry(ui).presentation).toEqual({ scroll: 42 });
    const before = ui.session.state.document;
    release();
    await nextTick();
    expect(host.find('[role="status"]').exists()).toBe(true);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(ui.session.state.document).toBe(before);
    ui.registry.registerPlugin({
      pluginId: "demo",
      enabled: true,
      views: [view],
    });
    await nextTick();
    expect(host.get("button").text()).toBe('{"scroll":42}');
    const destination = ui.session.capture().address!;
    ui.session.dispatch({ type: "history", ...destination, delta: -1 });
    await nextTick();
    expect(entry(ui).target).toEqual({ kind: "empty" });
    expect(disposed).toHaveBeenCalledTimes(2);
    ui.session.dispatch({ type: "history", ...destination, delta: 1 });
    await nextTick();
    expect(entry(ui).target).toEqual({
      kind: "view",
      viewId: "demo:notes",
      contentId: "missing-item",
    });
    expect(host.get("button").text()).toBe('{"scroll":42}');
  });
});
