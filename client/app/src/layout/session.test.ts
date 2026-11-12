import { afterEach, describe, expect, it, vi } from "vitest";
import { createLayoutSession, type LayoutSession } from "./session";
import type { LayoutDocument, LayoutRecord, LayoutStorage } from "./storage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function storage() {
  let record: LayoutRecord = { revision: null, data: null };
  let revision = 0;
  return {
    load: vi.fn(async () => structuredClone(record)),
    save: vi.fn(
      async (_scope: string, expected: string | null, data: LayoutDocument) => {
        if (record.revision !== expected) throw new Error("conflict");
        record = { revision: String(++revision), data: structuredClone(data) };
        return structuredClone(record);
      },
    ),
    external(data: LayoutDocument) {
      record = { revision: String(++revision), data };
    },
    get record() {
      return record;
    },
  };
}
const owned: LayoutSession[] = [];
function create(store: LayoutStorage, scope = "workspace") {
  let id = 0;
  const owner = createLayoutSession(scope, store, () => `${scope}-${++id}`);
  owned.push(owner);
  return owner;
}
afterEach(() => {
  owned.splice(0).forEach((owner) => owner.dispose());
  vi.useRealTimers();
});

describe("workspace layout session", () => {
  it("captures the installation owning a save before a replacement inventory arrives", async () => {
    const store = storage();
    const pending = deferred<LayoutRecord>();
    const saved: {
      owners?: Readonly<Record<string, string>>;
      data?: LayoutDocument;
    } = {};
    const save = vi.fn(
      async (
        _scope: string,
        _revision: string | null,
        data: LayoutDocument,
        owners?: Readonly<Record<string, string>>,
      ): Promise<LayoutRecord> => {
        saved.owners = owners;
        saved.data = data;
        return pending.promise;
      },
    );
    const native = { load: store.load, save };
    const writer = create(native);
    await writer.load();
    writer.synchronizePluginIncarnations({ demo: "original" });
    writer.open({ kind: "view", viewId: "demo:board" });
    writer.pin("demo:board");
    const flushing = writer.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    writer.synchronizePluginIncarnations({ demo: "replacement" });
    expect(saved.owners).toEqual({ demo: "original" });
    expect(writer.state.document!.pinnedViews).toEqual(["files"]);
    expect(
      writer.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
        -1,
      )!.target,
    ).toEqual({ kind: "empty" });
    save.mockImplementationOnce(async (_scope, _revision, data, owners) => ({
      revision: "2",
      data,
      pluginIncarnations: owners,
    }));
    pending.resolve({
      revision: "1",
      data: saved.data!,
      pluginIncarnations: { demo: "original" },
    });
    await flushing;
    expect(save.mock.calls[1]![3]).toEqual({ demo: "replacement" });
    expect(save.mock.calls[1]![2].pinnedViews).toEqual(["files"]);
  });

  it.each([false, true])(
    "compares restored installation provenance when inventory arrives before load: %s",
    async (inventoryFirst) => {
      const store = storage();
      const original = create(store);
      await original.load();
      original.open({ kind: "view", viewId: "demo:board" });
      original.pin("demo:board");
      await original.flush();
      const load = deferred<LayoutRecord>();
      const restored = create({ load: () => load.promise, save: store.save });
      const loading = restored.load();
      if (inventoryFirst)
        restored.synchronizePluginIncarnations({ demo: "replacement" });
      load.resolve({
        ...store.record,
        pluginIncarnations: { demo: "original" },
      });
      await loading;
      if (!inventoryFirst)
        restored.synchronizePluginIncarnations({ demo: "replacement" });
      expect(restored.state.document!.pinnedViews).toEqual(["files"]);
      expect(
        restored.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
          -1,
        )!.target,
      ).toEqual({ kind: "empty" });
    },
  );

  it.each([true, false])(
    "restores only plugin references with matching installation provenance: %s",
    async (proven) => {
      const store = storage();
      const original = create(store);
      await original.load();
      original.open({ kind: "view", viewId: "demo:board" });
      original.pin("demo:board");
      await original.flush();
      const restored = create({
        load: async () => ({
          ...store.record,
          ...(proven ? { pluginIncarnations: { demo: "original" } } : {}),
        }),
        save: store.save,
      });
      await restored.load();
      restored.synchronizePluginIncarnations({ demo: "original" });
      expect(restored.state.document!.pinnedViews).toEqual(
        proven ? ["files", "demo:board"] : ["files"],
      );
      expect(
        restored.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
          -1,
        )!.target,
      ).toEqual(
        proven ? { kind: "view", viewId: "demo:board" } : { kind: "empty" },
      );
    },
  );

  it("forgets missing plugin views and their presentation in open and closed navigation without losing user content", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    owner.open({ kind: "view", viewId: "gone:settings" });
    const address = owner.capture().address!;
    const pane = owner.state.document!.layout.tabs[0]!.panes[0]!;
    owner.dispatch({
      type: "retain-presentation",
      ...address,
      entryId: pane.navigation.entries.at(-1)!.id,
      presentation: { draft: "plugin state" },
    });
    owner.open({ kind: "conversation", conversationId: "retained-chat" });
    owner.open({ kind: "view", viewId: "kept:main" });
    owner.pin("gone:settings");
    owner.pin("kept:main");
    owner.dispatch({ type: "close-tab", tabId: address.tabId });
    owner.open({ kind: "view", viewId: "gone:main" });
    owner.retainPluginViews(["kept"]);
    expect(owner.state.document!.pinnedViews).toEqual(["files", "kept:main"]);
    const open =
      owner.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries;
    expect(open.at(-1)!.target).toEqual({ kind: "empty" });
    const closed =
      owner.state.document!.layout.closedTabs[0]!.tab.panes[0]!.navigation
        .entries;
    expect(closed[1]!.target).toEqual({ kind: "empty" });
    expect(closed[1]!.presentation).toBeNull();
    expect(closed[2]!.target).toEqual({
      kind: "conversation",
      conversationId: "retained-chat",
    });
    expect(closed[3]!.target).toEqual({ kind: "view", viewId: "kept:main" });
    await owner.flush();
    const restored = create(store);
    await restored.load();
    expect(restored.state.document).toEqual(owner.state.document);
  });

  it("initializes missing state once and restores its saved layout rather than regenerating IDs", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    await owner.flush();
    const original = owner.state.document;
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(
      original!.layout.tabs[0]!.panes[0]!.navigation.entries[0]!.target,
    ).toEqual({ kind: "empty" });
    const restored = create(store);
    await restored.load();
    expect(restored.state.document).toEqual(original);
    expect(restored.state.dirty).toBe(false);
  });
  it("restores older zero-tab layouts as an empty tab without discarding pins or closed histories", async () => {
    const store = storage();
    const original = create(store, "original");
    await original.load();
    await original.flush();
    const document = original.state.document!;
    store.external({
      ...document,
      layout: {
        tabs: [],
        activeTabId: null,
        closedTabs: [{ tab: document.layout.tabs[0]!, index: 0 }],
      },
    });
    const owner = create(store);
    await owner.load();
    expect(owner.state.document!.layout.tabs).toHaveLength(1);
    expect(
      owner.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries[0]!
        .target,
    ).toEqual({ kind: "empty" });
    expect(owner.state.document!.pinnedViews).toEqual(["files"]);
    expect(owner.state.document!.layout.closedTabs[0]!.tab).toEqual(
      document.layout.tabs[0],
    );
    await owner.flush();
    const restored = create(store);
    await restored.load();
    expect(restored.state.document).toEqual(owner.state.document);
    expect(restored.state.dirty).toBe(false);
  });
  it("retains invalid read data without attempting any write and permits closure without discarding it", async () => {
    const store = storage();
    store.load.mockRejectedValue(new Error("layoutHost.invalidStoredLayout"));
    const owner = create(store);
    await owner.load();
    expect(owner.state.document).toBeNull();
    expect(owner.state.error).toBeTruthy();
    expect(owner.dispatch({ type: "new-tab" })).toBe(false);
    await owner.flush();
    expect(store.save).not.toHaveBeenCalled();
  });
  it("serializes saves and flushes edits that arrive during a write", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    await owner.flush();
    const pending = deferred<LayoutRecord>();
    store.save.mockImplementationOnce(() => pending.promise);
    owner.dispatch({ type: "new-tab" });
    const first = owner.state.document!;
    const flush = owner.flush();
    await Promise.resolve();
    owner.pin("plugin:calendar");
    store.external(first);
    pending.resolve(store.record);
    await flush;
    expect(store.record.data?.pinnedViews).toEqual([
      "files",
      "plugin:calendar",
    ]);
    expect(owner.state.dirty).toBe(false);
  });
  it("keeps failed writes in memory and never automatically retries them", async () => {
    vi.useFakeTimers();
    const store = storage();
    const owner = create(store);
    await owner.load();
    await owner.flush();
    store.save.mockRejectedValueOnce(new Error("failed"));
    owner.dispatch({ type: "new-tab" });
    await expect(owner.flush()).rejects.toThrow("failed");
    const calls = store.save.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.save).toHaveBeenCalledTimes(calls);
    expect(owner.state.dirty).toBe(true);
    await owner.retry();
    expect(owner.state.error).toBe("");
    expect(owner.state.dirty).toBe(false);
  });
  it("recognizes a committed uncertain save despite native presentation-key ordering", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    await owner.flush();
    const tab = owner.state.document!.layout.tabs[0]!;
    const pane = tab.panes[0]!;
    owner.dispatch({
      type: "retain-presentation",
      tabId: tab.id,
      paneId: pane.id,
      entryId: pane.navigation.entries[0]!.id,
      presentation: { z: 1, a: 2 },
    });
    store.save.mockImplementationOnce(async (_scope, _rev, data) => {
      const copy = structuredClone(data);
      const entry = copy.layout.tabs[0]!.panes[0]!.navigation.entries[0]!;
      Object.assign(entry, { presentation: { a: 2, z: 1 } });
      store.external(copy);
      throw new Error("uncertain");
    });
    await expect(owner.flush()).rejects.toThrow("uncertain");
    await owner.retry();
    expect(owner.state.error).toBe("");
    expect(owner.state.dirty).toBe(false);
  });
  it("does not overwrite conflicting disk changes on retry", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    await owner.flush();
    const local = owner.state.document!;
    store.external({ ...local, pinnedViews: ["external:view"] });
    owner.pin("files");
    await expect(owner.flush()).rejects.toThrow("conflict");
    await owner.retry();
    expect(owner.state.error).toEqual(new Error("layoutHost.changedOnDisk"));
    expect(store.record.data?.pinnedViews).toEqual(["external:view"]);
    expect(owner.state.document?.pinnedViews).toEqual([]);
    await owner.reload();
    expect(owner.state.document?.pinnedViews).toEqual(["external:view"]);
  });
  it("invalidates only closed lifetimes during bulk closure and persists recoverable tabs", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    const closed = owner.capture();
    owner.dispatch({ type: "new-tab" });
    const retained = owner.capture();
    owner.dispatch({
      type: "close-other-tabs",
      tabId: retained.address!.tabId,
    });
    expect(owner.current(closed)).toBe(false);
    expect(owner.current(retained)).toBe(true);
    await owner.flush();
    const restored = create(store);
    await restored.load();
    expect(restored.state.document!.layout.closedTabs).toHaveLength(1);
    restored.dispatch({ type: "reopen-tab" });
    expect(restored.state.document!.layout.tabs.map((tab) => tab.id)).toEqual([
      closed.address!.tabId,
      retained.address!.tabId,
    ]);
    owner.dispatch({ type: "reopen-tab" });
    expect(owner.current(closed)).toBe(false);
    owner.dispatch({ type: "close-all-tabs" });
    expect(owner.current(retained)).toBe(false);
    await owner.flush();
    expect(store.record.data!.layout.tabs).toHaveLength(1);
    expect(
      store.record.data!.layout.tabs[0]!.panes[0]!.navigation.entries[0]!
        .target,
    ).toEqual({ kind: "empty" });
    expect(store.record.data!.layout.closedTabs).toHaveLength(2);
  });

  it("rejects late completion after close and reopen even though persistent pane IDs match", async () => {
    const owner = create(storage());
    await owner.load();
    const ticket = owner.capture();
    owner.dispatch({ type: "close-tab", tabId: ticket.address!.tabId });
    owner.dispatch({ type: "reopen-tab" });
    expect(owner.capture().address).toEqual(ticket.address);
    expect(owner.open({ kind: "view", viewId: "files" }, ticket)).toBe(false);
  });
  it("rejects stale loads and captured effects after workspace disposal", async () => {
    const pending = deferred<LayoutRecord>();
    const store = storage();
    store.load.mockImplementationOnce(() => pending.promise);
    const owner = create(store);
    const loading = owner.load();
    owner.dispose();
    pending.resolve({ revision: null, data: null });
    await loading;
    expect(owner.state.document).toBeNull();
    expect(store.save).not.toHaveBeenCalled();
    expect(owner.open({ kind: "empty" }, owner.capture())).toBe(false);
  });
  it("saves temporary targets as empty in every history without changing live state", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    owner.open({ kind: "new-conversation", conversationId: "temporary-open" });
    const address = owner.capture().address!;
    const entry =
      owner.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(
        -1,
      )!;
    owner.dispatch({
      type: "retain-presentation",
      ...address,
      entryId: entry.id,
      presentation: { draft: "private draft" },
    });
    owner.open({ kind: "empty" });
    owner.dispatch({ type: "new-tab" });
    owner.open({
      kind: "new-conversation",
      conversationId: "temporary-closed",
    });
    owner.dispatch({
      type: "close-tab",
      tabId: owner.capture().address!.tabId,
    });
    owner.open({
      kind: "new-conversation",
      conversationId: "temporary-current",
    });
    const before = owner.state.document;
    await owner.flush();
    expect(owner.state.document).toBe(before);
    expect(owner.state.dirty).toBe(false);
    const serialized = JSON.stringify(store.record.data);
    expect(serialized).not.toContain("temporary-");
    expect(serialized).not.toContain("private draft");
    const layout = store.record.data!.layout;
    const projected = layout.tabs[0]!.panes[0]!.navigation.entries.find(
      (item) => item.id === entry.id,
    )!;
    expect(projected).toEqual({
      id: entry.id,
      target: { kind: "empty" },
      presentation: null,
    });
    expect(owner.state.document!.layout.tabs[0]!.conversationIds).toEqual([]);
    const restored = create(store);
    await restored.load();
    expect(restored.state.error).toBe("");
    expect(restored.state.document).toEqual(store.record.data);
  });
  it("recognizes an uncertain save of a projected temporary layout", async () => {
    const store = storage();
    const owner = create(store);
    await owner.load();
    owner.open({ kind: "new-conversation", conversationId: "temporary" });
    const save = store.save.getMockImplementation()!;
    store.save.mockImplementationOnce(async (...args) => {
      await save(...args);
      throw new Error("uncertain");
    });
    await expect(owner.flush()).rejects.toThrow("uncertain");
    await owner.retry();
    expect(owner.state.error).toBe("");
    expect(
      owner.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.at(-1)!
        .target,
    ).toEqual({ kind: "new-conversation", conversationId: "temporary" });
  });
  it("rewrites live file paths across open and closed histories but not historical targets", async () => {
    const owner = create(storage());
    await owner.load();
    owner.open({ kind: "view", viewId: "files", contentId: "folder/plan.md" });
    owner.open({
      kind: "view",
      viewId: "files",
      contentId: "folder/plan.md",
      revision: "older",
    });
    owner.dispatch({
      type: "close-tab",
      tabId: owner.capture().address!.tabId,
    });
    owner.mapTargets((target) =>
      target.kind === "view" && target.contentId && !target.revision
        ? {
            ...target,
            contentId: target.contentId.replace("folder/", "renamed/"),
          }
        : target,
    );
    owner.dispatch({ type: "reopen-tab" });
    const targets =
      owner.state.document!.layout.tabs[0]!.panes[0]!.navigation.entries.map(
        (entry) => entry.target,
      );
    expect(targets.slice(1)).toEqual([
      { kind: "view", viewId: "files", contentId: "renamed/plan.md" },
      {
        kind: "view",
        viewId: "files",
        contentId: "folder/plan.md",
        revision: "older",
      },
    ]);
  });
});
