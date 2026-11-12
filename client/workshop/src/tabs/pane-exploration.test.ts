import { describe, expect, it } from "vitest";
import {
  activeTab,
  createTabsState,
  leaves,
  paneTitle,
  reduceTabs,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";

describe("pane navigation exploration", () => {
  it("switches maximized panes without changing identities, arrangement, histories or drafts", () => {
    const initial = createTabsState("tabs-maximized");
    const tab = activeTab(initial)!;
    const original = structuredClone(tab);
    const drafted = reduceTabs(initial, {
      type: "draft",
      id: "garden",
      value: "Saturday is free",
    });
    const selected = reduceTabs(drafted, {
      type: "select-pane",
      id: leaves(tab.layout)[1]!,
    });
    expect(activeTab(selected)!.maximized).toBe(activeTab(selected)!.active);
    const restored = reduceTabs(selected, {
      type: "maximize",
      id: activeTab(selected)!.active,
    });
    expect(activeTab(restored)!.maximized).toBeNull();
    expect(activeTab(restored)!.layout).toEqual(original.layout);
    expect(activeTab(restored)!.panes).toEqual(original.panes);
    expect(restored.conversations.garden!.draft).toBe("Saturday is free");
  });
  it("provides twelve panes with full conversation labels and independent histories", () => {
    const state = createTabsState("tabs-maximized-many");
    const tab = activeTab(state)!;
    expect(leaves(tab.layout)).toHaveLength(12);
    const pane = tab.panes[tab.active]!;
    expect(paneTitle(pane, state)).toContain("seasonal planting observations");
    const back = reduceTabs(state, { type: "history", id: pane.id, delta: -1 });
    expect(paneTitle(activeTab(back)!.panes[pane.id]!, back)).toBe(
      "Weekend plan",
    );
    expect(activeTab(back)!.maximized).toBe(pane.id);
  });
  it("routes controls by current maximization rather than initial scenario", () => {
    const initial = createSimulation("tabs-maximized");
    expect(screenControls(initial).label).toBe(
      "Tabs and panes · maximized pane",
    );
    const restored = reduceSimulation(initial, {
      type: "tabs",
      action: { type: "maximize", id: activeTab(initial.tabs)!.active },
    });
    expect(screenControls(restored).label).toBe("Tabs and panes");
    expect(screenControls(restored).controls).toContain("tabs");
    expect(createSimulation("tabs-move-pane").feature).toBe("tabs");
  });
});
