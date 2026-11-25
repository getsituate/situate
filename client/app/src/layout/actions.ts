import { selectedTab, type LayoutIntent, type LayoutState } from "./model";
import type { NavigationTicket } from "./session";
import type { LayoutNode, PaneEdge } from "./tree";

export type LayoutAction =
  | { readonly type: "create-tab"; readonly conversationId?: string }
  | { readonly type: "select-tab"; readonly tabId: string }
  | { readonly type: "cycle-tab"; readonly delta: -1 | 1 }
  | { readonly type: "close-tab"; readonly tabId?: string }
  | { readonly type: "close-pane"; readonly paneId?: string }
  | { readonly type: "close-active-view" }
  | {
      readonly type: "split-pane";
      readonly edge: PaneEdge;
      readonly paneId?: string;
    }
  | { readonly type: "focus-pane"; readonly direction: PaneEdge };

export type LayoutActionResult =
  | { readonly status: "applied"; readonly destination: NavigationTicket }
  | { readonly status: "limit"; readonly limit: "tabs" | "panes" }
  | { readonly status: "unchanged" | "cancelled" | "unavailable" };

type Bounds = readonly [
  left: number,
  top: number,
  right: number,
  bottom: number,
];

function paneBounds(
  node: LayoutNode,
  bounds: Bounds,
): { id: string; bounds: Bounds }[] {
  if (node.kind === "pane") return [{ id: node.id, bounds }];
  const [left, top, right, bottom] = bounds;
  if (node.axis === "row") {
    const x = left + (right - left) * node.ratio;
    return [
      ...paneBounds(node.first, [left, top, x, bottom]),
      ...paneBounds(node.second, [x, top, right, bottom]),
    ];
  }
  const y = top + (bottom - top) * node.ratio;
  return [
    ...paneBounds(node.first, [left, top, right, y]),
    ...paneBounds(node.second, [left, y, right, bottom]),
  ];
}

function neighbor(node: LayoutNode, paneId: string, direction: PaneEdge) {
  const panes = paneBounds(node, [0, 0, 1, 1]);
  const from = panes.find((pane) => pane.id === paneId)?.bounds;
  if (!from) return;
  const [edge, opposite, crossStart, crossEnd] = (
    {
      left: [0, 2, 1, 3],
      right: [2, 0, 1, 3],
      top: [1, 3, 0, 2],
      bottom: [3, 1, 0, 2],
    } as const
  )[direction];
  let best: { id: string; overlap: number } | undefined;
  for (const { id, bounds } of panes) {
    if (id === paneId) continue;
    if (bounds[opposite] !== from[edge]) continue;
    const overlap =
      Math.min(bounds[crossEnd], from[crossEnd]) -
      Math.max(bounds[crossStart], from[crossStart]);
    if (overlap > 0 && (!best || overlap > best.overlap))
      best = { id, overlap };
  }
  return best?.id;
}

export function resolveLayoutAction(
  state: LayoutState,
  action: LayoutAction,
): LayoutIntent | undefined {
  if (action.type === "create-tab")
    return { type: "new-tab", conversationId: action.conversationId };
  const tab = selectedTab(state);
  if (!tab) return;
  switch (action.type) {
    case "select-tab":
      return { type: "select-tab", tabId: action.tabId };
    case "cycle-tab": {
      const index = state.tabs.indexOf(tab);
      const next =
        state.tabs[
          (index + action.delta + state.tabs.length) % state.tabs.length
        ];
      if (next) return { type: "select-tab", tabId: next.id };
      return;
    }
    case "close-tab":
      return { type: "close-tab", tabId: action.tabId ?? tab.id };
    case "close-active-view":
      return tab.panes.length === 1
        ? { type: "close-tab", tabId: tab.id }
        : { type: "close-pane", tabId: tab.id, paneId: tab.activePaneId };
    case "close-pane":
      return {
        type: "close-pane",
        tabId: tab.id,
        paneId: action.paneId ?? tab.activePaneId,
      };
    case "split-pane":
      return {
        type: "split",
        tabId: tab.id,
        paneId: action.paneId ?? tab.activePaneId,
        edge: action.edge,
      };
    case "focus-pane": {
      const paneId = neighbor(tab.layout, tab.activePaneId, action.direction);
      if (paneId) return { type: "select-pane", tabId: tab.id, paneId };
    }
  }
}
