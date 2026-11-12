import { invoke } from "@tauri-apps/api/core";
import type { LayoutState, TopicTab } from "./model";
import type { LayoutNode } from "./tree";
import type { PresentationValue, ViewTarget } from "./navigation";

export interface LayoutDocument {
  readonly version: 1;
  readonly layout: LayoutState;
  readonly pinnedViews: readonly string[];
}
export interface LayoutRecord {
  readonly revision: string | null;
  readonly data: LayoutDocument | null;
  readonly pluginIncarnations?: Readonly<Record<string, string>>;
}
export interface LayoutStorage {
  load(workspaceId: string): Promise<LayoutRecord>;
  save(
    workspaceId: string,
    revision: string | null,
    data: LayoutDocument,
    pluginIncarnations?: Readonly<Record<string, string>>,
  ): Promise<LayoutRecord>;
}

function invalid(): never {
  throw new Error("layoutHost.invalidStoredLayout");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(value).some((key) => !names.includes(key))) invalid();
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalid();
  return value;
}
function text(value: unknown, empty = false): string {
  if (typeof value !== "string" || (!empty && !value) || value.includes("\0"))
    return invalid();
  return value;
}
function uniqueStrings(value: unknown): string[] {
  const strings = array(value).map((item) => text(item));
  if (new Set(strings).size !== strings.length) invalid();
  return strings;
}
export function isWorkspacePath(path: string): boolean {
  return (
    !!path &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    path.split("/").every((part) => !!part && part !== "." && part !== "..")
  );
}
export function decodeTarget(
  value: unknown,
  allowTemporary = true,
): ViewTarget {
  const target = object(value);
  if (target.kind === "empty") {
    keys(target, ["kind"]);
    return { kind: "empty" };
  }
  if (
    target.kind === "conversation" ||
    (allowTemporary && target.kind === "new-conversation")
  ) {
    keys(target, ["kind", "conversationId"]);
    return {
      kind: target.kind as "conversation" | "new-conversation",
      conversationId: text(target.conversationId),
    };
  }
  if (target.kind !== "view") return invalid();
  keys(target, ["kind", "viewId", "contentId", "revision"]);
  const viewId = text(target.viewId);
  const contentId =
    target.contentId === undefined ? undefined : text(target.contentId);
  const revision =
    target.revision === undefined ? undefined : text(target.revision);
  if (
    viewId === "files" &&
    contentId !== undefined &&
    !isWorkspacePath(contentId)
  )
    return invalid();
  if (revision !== undefined && contentId === undefined) return invalid();
  return {
    kind: "view",
    viewId,
    ...(contentId === undefined ? {} : { contentId }),
    ...(revision === undefined ? {} : { revision }),
  };
}
function presentation(value: unknown, depth = 0): PresentationValue {
  if (depth > 64) return invalid();
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : invalid();
  if (Array.isArray(value))
    return value.map((item) => presentation(item, depth + 1));
  return Object.fromEntries(
    Object.entries(object(value)).map(([key, item]) => [
      key,
      presentation(item, depth + 1),
    ]),
  );
}
export function decodeLayoutDocument(value: unknown): LayoutDocument {
  const document = object(value);
  if (document.version !== 1)
    throw new Error("layoutHost.unsupportedStoredLayout");
  keys(document, ["version", "layout", "pinnedViews"]);
  const ids = new Set<string>();
  const id = (value: unknown) => {
    const result = text(value);
    if (ids.has(result)) return invalid();
    ids.add(result);
    return result;
  };
  function tab(value: unknown): TopicTab {
    const item = object(value);
    keys(item, [
      "id",
      "name",
      "layout",
      "panes",
      "activePaneId",
      "maximizedPaneId",
      "conversationIds",
    ]);
    const tabId = id(item.id);
    const panes = array(item.panes).map((value) => {
      const pane = object(value);
      keys(pane, ["id", "navigation"]);
      const paneId = id(pane.id);
      const navigation = object(pane.navigation);
      keys(navigation, ["entries", "cursor"]);
      const entries = array(navigation.entries).map((value) => {
        const entry = object(value);
        keys(entry, ["id", "target", "presentation"]);
        return {
          id: id(entry.id),
          target: decodeTarget(entry.target, false),
          presentation: presentation(entry.presentation),
        };
      });
      const cursor = navigation.cursor;
      if (
        !Number.isInteger(cursor) ||
        (cursor as number) < 0 ||
        (cursor as number) >= entries.length
      )
        return invalid();
      return { id: paneId, navigation: { entries, cursor: cursor as number } };
    });
    const remaining = new Set(panes.map((pane) => pane.id));
    function node(value: unknown, depth = 0): LayoutNode {
      if (depth > 64) return invalid();
      const branch = object(value);
      if (branch.kind === "pane") {
        keys(branch, ["kind", "id"]);
        const paneId = text(branch.id);
        if (!remaining.delete(paneId)) return invalid();
        return { kind: "pane", id: paneId };
      }
      keys(branch, ["kind", "id", "axis", "ratio", "first", "second"]);
      if (
        branch.kind !== "split" ||
        !["row", "column"].includes(branch.axis as string) ||
        typeof branch.ratio !== "number" ||
        !Number.isFinite(branch.ratio) ||
        branch.ratio <= 0 ||
        branch.ratio >= 1
      )
        return invalid();
      return {
        kind: "split",
        id: id(branch.id),
        axis: branch.axis as "row" | "column",
        ratio: branch.ratio,
        first: node(branch.first, depth + 1),
        second: node(branch.second, depth + 1),
      };
    }
    const layout = node(item.layout);
    const activePaneId = text(item.activePaneId);
    const maximizedPaneId =
      item.maximizedPaneId === null ? null : text(item.maximizedPaneId);
    if (
      remaining.size ||
      !panes.some((pane) => pane.id === activePaneId) ||
      (maximizedPaneId !== null && maximizedPaneId !== activePaneId)
    )
      return invalid();
    return {
      id: tabId,
      name: text(item.name, true),
      layout,
      panes,
      activePaneId,
      maximizedPaneId,
      conversationIds: uniqueStrings(item.conversationIds),
    };
  }
  const layout = object(document.layout);
  keys(layout, ["tabs", "activeTabId", "closedTabs"]);
  const tabs = array(layout.tabs).map(tab);
  const activeTabId =
    layout.activeTabId === null ? null : text(layout.activeTabId);
  if (
    tabs.length
      ? !tabs.some((tab) => tab.id === activeTabId)
      : activeTabId !== null
  )
    return invalid();
  const closedTabs = array(layout.closedTabs).map((value) => {
    const closed = object(value);
    keys(closed, ["tab", "index"]);
    if (!Number.isSafeInteger(closed.index) || (closed.index as number) < 0)
      return invalid();
    return { tab: tab(closed.tab), index: closed.index as number };
  });
  return {
    version: 1,
    layout: { tabs, activeTabId, closedTabs },
    pinnedViews: uniqueStrings(document.pinnedViews),
  };
}
export function persistedLayoutDocument(
  document: LayoutDocument,
): LayoutDocument {
  const project = (tab: TopicTab): TopicTab => ({
    ...tab,
    panes: tab.panes.map((pane) => ({
      ...pane,
      navigation: {
        ...pane.navigation,
        entries: pane.navigation.entries.map((entry) =>
          entry.target.kind === "new-conversation"
            ? { ...entry, target: { kind: "empty" }, presentation: null }
            : entry,
        ),
      },
    })),
  });
  return {
    ...document,
    layout: {
      ...document.layout,
      tabs: document.layout.tabs.map(project),
      closedTabs: document.layout.closedTabs.map((closed) => ({
        ...closed,
        tab: project(closed.tab),
      })),
    },
  };
}

export function sameDocument(
  a: LayoutDocument | null,
  b: LayoutDocument | undefined,
): boolean {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  }
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function decodeRecord(value: unknown): LayoutRecord {
  const record = object(value);
  if (record.revision !== null && typeof record.revision !== "string")
    return invalid();
  if ((record.data === null) !== (record.revision === null)) return invalid();
  return {
    revision: record.revision as string | null,
    data: record.data === null ? null : decodeLayoutDocument(record.data),
    ...(record.pluginIncarnations === undefined
      ? {}
      : {
          pluginIncarnations: Object.fromEntries(
            Object.entries(object(record.pluginIncarnations)).map(
              ([id, value]) => [id, text(value)],
            ),
          ),
        }),
  };
}
export const nativeLayoutStorage: LayoutStorage = {
  async load(workspaceId) {
    return decodeRecord(await invoke("layout_load", { workspaceId }));
  },
  async save(workspaceId, expectedRevision, data, pluginIncarnations) {
    return decodeRecord(
      await invoke("layout_save", {
        workspaceId,
        expectedRevision,
        ...(pluginIncarnations === undefined ? {} : { pluginIncarnations }),
        data: decodeLayoutDocument(persistedLayoutDocument(data)),
      }),
    );
  },
};
