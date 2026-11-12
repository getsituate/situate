import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, onMounted, onUnmounted } from "vue";
import WorkspaceLayout from "./WorkspaceLayout.vue";
import { chooseSelect } from "../../ui/select-test";
import PanePager from "./PanePager.vue";
import {
  reduceLayout,
  type LayoutState,
  type Pane,
  type LayoutIntent,
} from "../model";
import type { ViewTarget } from "../navigation";

enableAutoUnmount(afterEach);
const observations = new Map<Element, Set<ResizeObserverCallback>>();
function measure(element: Element, width: number, height: number) {
  for (const callback of observations.get(element) ?? [])
    callback(
      [
        {
          target: element,
          contentRect: { width, height },
        } as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
}
async function pointer(
  element: Element,
  type: string,
  properties: Record<string, number | boolean>,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  element.dispatchEvent(event);
  await flushPromises();
}
const titleFor = (target: ViewTarget) =>
  target.kind === "view" ? target.contentId! : "New tab";
const pane = (id: string): Pane => ({
  id,
  navigation: {
    cursor: 0,
    entries: [
      {
        id: `${id}-entry`,
        target: { kind: "view", viewId: "file", contentId: id },
        presentation: null,
      },
    ],
  },
});
function fixture(multiple = true): LayoutState {
  return {
    activeTabId: "topic",
    closedTabs: [],
    tabs: [
      {
        id: "topic",
        name: "",
        activePaneId: "A",
        maximizedPaneId: null,
        conversationIds: [],
        panes: multiple ? [pane("A"), pane("B"), pane("C")] : [pane("A")],
        layout: multiple
          ? {
              kind: "split",
              id: "row",
              axis: "row",
              ratio: 0.5,
              first: { kind: "pane", id: "A" },
              second: {
                kind: "split",
                id: "column",
                axis: "column",
                ratio: 0.5,
                first: { kind: "pane", id: "B" },
                second: { kind: "pane", id: "C" },
              },
            }
          : { kind: "pane", id: "A" },
      },
    ],
  };
}
function render(state = fixture(), mobile = false) {
  let next = 0;
  const wrapper = mount(WorkspaceLayout, {
    attachTo: document.body,
    props: {
      state,
      mobile,
      titleFor,
      showNavigation: true,
      onIntent: (intent: LayoutIntent) => {
        state = reduceLayout(state, intent, () => `generated-${++next}`);
        void wrapper.setProps({ state });
      },
    },
    slots: {
      pane: ({ pane: item, active }: { pane: Pane; active: boolean }) =>
        h("input", { "aria-label": `Body ${item.id}`, "data-active": active }),
    },
  });
  return wrapper;
}
function button(wrapper: ReturnType<typeof render>, key: string) {
  return wrapper
    .findAll("button")
    .find(
      (item) =>
        (!item.element.closest("[popover]") ||
          item.element.closest("[popover]")!.matches(":popover-open")) &&
        (item.attributes("aria-label") === `⟦layoutUi.${key}⟧` ||
          item.text() === `⟦layoutUi.${key}⟧`),
    )!;
}
function lastIntent(wrapper: ReturnType<typeof render>) {
  return wrapper.emitted("intent")?.at(-1)?.[0];
}
const browserMethods = [
  { prototype: HTMLElement.prototype, name: "scrollIntoView" },
  { prototype: HTMLDialogElement.prototype, name: "showModal" },
  { prototype: HTMLDialogElement.prototype, name: "close" },
].map((item) => ({
  ...item,
  descriptor: Object.getOwnPropertyDescriptor(item.prototype, item.name),
}));
beforeAll(() => {
  for (const { prototype, name } of browserMethods)
    Object.defineProperty(prototype, name, {
      configurable: true,
      writable: true,
      value: () => {},
    });
});
afterAll(() => {
  for (const { prototype, name, descriptor } of browserMethods) {
    if (descriptor) Object.defineProperty(prototype, name, descriptor);
    else Reflect.deleteProperty(prototype, name);
  }
});
beforeEach(() => {
  const rectangle = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLButtonElement
        ? new DOMRect(32, 32, 44, 44)
        : rectangle.call(this);
    },
  );
  observations.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        const callbacks = observations.get(element) ?? new Set();
        callbacks.add(this.callback);
        observations.set(element, callbacks);
      }
      unobserve(element: Element) {
        observations.get(element)?.delete(this.callback);
      }
      disconnect() {
        for (const callbacks of observations.values())
          callbacks.delete(this.callback);
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("CSS", {
    escape: (value: string) => value.replaceAll('"', '\\"'),
  });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace layout rendering", () => {
  it("forwards real pane slots through recursive splits and selects only the focused pane", async () => {
    const wrapper = render();
    expect(
      wrapper.findAll("input").map((input) => input.attributes("aria-label")),
    ).toEqual(["Body A", "Body B", "Body C"]);
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(2);
    expect(wrapper.find(".topic-panel > footer").exists()).toBe(false);
    expect(
      wrapper.findAll('[role="group"][aria-label="⟦layoutUi.paneHistory⟧"]'),
    ).toHaveLength(3);
    await wrapper.get('[aria-label="Body C"]').trigger("focusin");
    expect(lastIntent(wrapper)).toEqual({
      type: "select-pane",
      tabId: "topic",
      paneId: "C",
    });
    expect(wrapper.get('[aria-label="Body C"]').attributes("data-active")).toBe(
      "true",
    );
    expect(wrapper.get('[aria-label="Body A"]').attributes("data-active")).toBe(
      "false",
    );
  });
  it("shows the tab overview only when the strip overflows, not when a title is clipped", async () => {
    const wrapper = render();
    await flushPromises();
    const navigation = wrapper.get(".tab-navigation").element;
    const strip = wrapper.get(".topic-tabs").element;
    const label = wrapper.get(".topic-tab-select > span").element;
    const available = vi
      .spyOn(navigation, "clientWidth", "get")
      .mockReturnValue(800);
    const content = vi.spyOn(strip, "scrollWidth", "get").mockReturnValue(800);
    vi.spyOn(label, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(label, "scrollWidth", "get").mockReturnValue(300);
    measure(navigation, 800, 56);
    await flushPromises();
    expect(wrapper.find(".all-tabs").exists()).toBe(false);

    content.mockReturnValue(900);
    measure(navigation, 800, 56);
    await flushPromises();
    const overview = wrapper.get(".all-tabs");
    (overview.element as HTMLElement).focus();
    available.mockReturnValue(1000);
    content.mockReturnValue(1000);
    measure(navigation, 1000, 56);
    await flushPromises();
    expect(wrapper.find(".all-tabs").exists()).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('[aria-selected="true"]').element,
    );
  });
  it("shows split-tab activity in the tab header without a footer", async () => {
    const wrapper = render();
    await wrapper.setProps({ hasActivity: () => true });
    expect(wrapper.find(".topic-panel > footer").exists()).toBe(false);
    expect(wrapper.find(".topic-tab .working-indicator").exists()).toBe(true);
  });
  it("keeps single-pane history in the tab header with disabled directions", async () => {
    const wrapper = render(fixture(false));
    expect(wrapper.find(".pane-toolbar").exists()).toBe(false);
    expect(wrapper.find(".layout-footer").exists()).toBe(false);
    expect(button(wrapper, "back").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "forward").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".tab-header .pane-history").exists()).toBe(true);
    const state = fixture(false);
    const first = state.tabs[0]!;
    await wrapper.setProps({
      state: {
        ...state,
        tabs: [
          {
            ...first,
            panes: [
              {
                ...pane("A"),
                navigation: {
                  cursor: 1,
                  entries: [
                    ...pane("A").navigation.entries,
                    {
                      id: "next-entry",
                      target: {
                        kind: "view",
                        viewId: "file",
                        contentId: "Next",
                      },
                      presentation: null,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    await button(wrapper, "back").trigger("click");
    expect(lastIntent(wrapper)).toEqual({
      type: "history",
      tabId: "topic",
      paneId: "A",
      delta: -1,
    });
  });
  it("keys the supplied view by navigation entry, not merely the pane", async () => {
    const mounted: string[] = [],
      unmounted: string[] = [];
    const Body = defineComponent({
      props: { entry: { type: String, required: true } },
      setup(props) {
        const identity = props.entry;
        onMounted(() => mounted.push(identity));
        onUnmounted(() => unmounted.push(identity));
        return () => h("div", props.entry);
      },
    });
    const state = fixture(false);
    const wrapper = mount(WorkspaceLayout, {
      props: { state, titleFor },
      slots: {
        pane: ({ pane: item }: { pane: Pane }) =>
          h(Body, {
            entry: item.navigation.entries[item.navigation.cursor]!.id,
          }),
      },
    });
    await wrapper.setProps({
      state: {
        ...state,
        tabs: [
          {
            ...state.tabs[0]!,
            panes: [
              {
                ...pane("A"),
                navigation: {
                  cursor: 0,
                  entries: [
                    {
                      id: "different-entry",
                      target: { kind: "empty" },
                      presentation: null,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    expect(mounted).toEqual(["A-entry", "different-entry"]);
    expect(unmounted).toEqual(["A-entry"]);
  });
  it("projects only the active pane below 660px and restores the untouched tree", async () => {
    const wrapper = render();
    const original = wrapper.props("state");
    measure(wrapper.element, 659, 540);
    await flushPromises();
    expect(wrapper.findAll("input")).toHaveLength(1);
    expect(wrapper.find(".pane-pager").exists()).toBe(true);
    expect(wrapper.find(".pane-toolbar").exists()).toBe(false);
    await wrapper
      .get('.pane-pager [aria-current="true"]')
      .trigger("keydown", { key: "ArrowRight" });
    expect(lastIntent(wrapper)).toEqual({
      type: "select-pane",
      tabId: "topic",
      paneId: "B",
    });
    expect(wrapper.get("input").attributes("aria-label")).toBe("Body B");
    measure(wrapper.element, 660, 540);
    await flushPromises();
    expect(wrapper.findAll("input")).toHaveLength(3);
    expect(wrapper.props("state").tabs[0]!.layout).toEqual(
      original.tabs[0]!.layout,
    );
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(2);
  });
  it("exposes navigation only when requested and does not consume plain Android Back", async () => {
    const wrapper = render(fixture(false));
    await wrapper
      .get('[aria-label="⟦navigation.openNavigation⟧"]')
      .trigger("click");
    expect(wrapper.emitted("navigation")?.[0]?.[0]).toBeInstanceOf(MouseEvent);
    expect(wrapper.vm.back()).toBe(false);
    await wrapper.setProps({ showNavigation: false, mobile: true });
    expect(
      wrapper.find('[aria-label="⟦navigation.openNavigation⟧"]').exists(),
    ).toBe(false);
  });
  it("renames without changing automatic names when the title is unchanged, and returns focus", async () => {
    const wrapper = render(fixture(false));
    const tab = wrapper.get('[role="tab"]');
    await tab.trigger("dblclick");
    expect((wrapper.get("dialog").element as HTMLDialogElement).open).toBe(
      true,
    );
    expect(document.activeElement).toBe(wrapper.get("dialog input").element);
    await wrapper.get("form").trigger("submit");
    expect(lastIntent(wrapper)).toEqual({
      type: "rename-tab",
      tabId: "topic",
      name: "",
    });
    await flushPromises();
    expect(document.activeElement).toBe(tab.element);
    await tab.trigger("dblclick");
    await wrapper.get("dialog input").setValue("Research");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="tab"]').text()).toBe("Research");
    await tab.trigger("dblclick");
    await wrapper.get("dialog input").setValue("");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="tab"]').text()).toBe("A");
  });
  it("supports keyboard tab selection and close/reopen without deleting pane histories", async () => {
    let state = fixture(false);
    state = {
      ...state,
      tabs: [...state.tabs, { ...state.tabs[0]!, id: "other", name: "Other" }],
    };
    const wrapper = render(state);
    await wrapper.get('[role="tab"]').trigger("keydown", { key: "End" });
    expect(lastIntent(wrapper)).toEqual({ type: "select-tab", tabId: "other" });
    await wrapper.get(".topic-tab.selected .tab-close").trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
    expect(document.activeElement).toBe(wrapper.get('[role="tab"]').element);
    await button(wrapper, "tabOptions").trigger("click");
    await flushPromises();
    await flushPromises();
    await button(wrapper, "reopenTab").trigger("click");
    expect(lastIntent(wrapper)).toEqual({ type: "reopen-tab" });
    expect(wrapper.props("state").tabs[1]!.panes).toEqual(state.tabs[1]!.panes);
  });
  it("closes an inactive tab directly without selecting it", async () => {
    const state = fixture(false);
    const wrapper = render({
      ...state,
      tabs: [...state.tabs, { ...state.tabs[0]!, id: "other", name: "Other" }],
    });
    await wrapper.get(".topic-tab:not(.selected) .tab-close").trigger("click");
    expect(lastIntent(wrapper)).toEqual({ type: "close-tab", tabId: "other" });
    expect(wrapper.props("state").activeTabId).toBe("topic");
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[role="tab"]').element);
  });
  it("offers bulk closing and skips unavailable actions in menu keyboard navigation", async () => {
    const state = fixture(false);
    const wrapper = render({
      ...state,
      tabs: [...state.tabs, { ...state.tabs[0]!, id: "other", name: "Other" }],
    });
    await button(wrapper, "tabOptions").trigger("click");
    await flushPromises();
    await button(wrapper, "closeOtherTabs").trigger("click");
    expect(lastIntent(wrapper)).toEqual({
      type: "close-other-tabs",
      tabId: "topic",
    });
    expect(wrapper.props("state").tabs).toHaveLength(1);
    await button(wrapper, "tabOptions").trigger("click");
    await flushPromises();
    await flushPromises();
    expect(
      button(wrapper, "closeOtherTabs").attributes("disabled"),
    ).toBeDefined();
    expect(button(wrapper, "closeTab")).toBeUndefined();
    await button(wrapper, "renameAction").trigger("keydown", {
      key: "ArrowDown",
    });
    expect(document.activeElement).toBe(
      button(wrapper, "closeAllTabs").element,
    );
    await button(wrapper, "closeAllTabs").trigger("click");
    expect(wrapper.props("state").tabs).toHaveLength(1);
    expect(wrapper.get('[role="tab"]').text()).toBe("New tab");
  });
  it("keeps the overview open while renaming or closing an inactive tab", async () => {
    const state = fixture(false);
    const wrapper = render(
      {
        ...state,
        tabs: [
          ...state.tabs,
          { ...state.tabs[0]!, id: "other", name: "Other" },
        ],
      },
      true,
    );
    await wrapper.get(".mobile-tab-trigger").trigger("click");
    await wrapper.get('[data-tab-actions="other"] > button').trigger("click");
    await flushPromises();
    await button(wrapper, "renameAction").trigger("click");
    await wrapper.get("dialog input").setValue("Notes");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.props("state").activeTabId).toBe("topic");
    expect(wrapper.findAll(".tab-sheet-row")).toHaveLength(2);
    expect(document.activeElement).toBe(
      wrapper.get('[data-tab-actions="other"] > button').element,
    );
    await wrapper.get('[data-tab-actions="other"] > button').trigger("click");
    await flushPromises();
    await button(wrapper, "closeTab").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".tab-sheet-row")).toHaveLength(1);
    expect((wrapper.get("dialog").element as HTMLDialogElement).open).toBe(
      true,
    );
    expect(document.activeElement).toBe(
      wrapper.get('[data-tab-actions="topic"] > button').element,
    );
    expect(wrapper.vm.back()).toBe(true);
    expect(wrapper.vm.back()).toBe(false);
  });
  it("dismisses a tab menu before the overview on Android Back", async () => {
    const state = fixture(false);
    const wrapper = render(
      { ...state, tabs: [...state.tabs, { ...state.tabs[0]!, id: "other" }] },
      true,
    );
    await wrapper.get(".mobile-tab-trigger").trigger("click");
    await wrapper.get('[data-tab-actions="topic"] > button').trigger("click");
    await flushPromises();
    expect(wrapper.vm.back()).toBe(true);
    await flushPromises();
    expect(
      wrapper
        .findAll('[role="menu"]')
        .filter((menu) => menu.element.matches(":popover-open")),
    ).toHaveLength(0);
    expect((wrapper.get("dialog").element as HTMLDialogElement).open).toBe(
      true,
    );
    expect(wrapper.vm.back()).toBe(true);
    expect((wrapper.get("dialog").element as HTMLDialogElement).open).toBe(
      false,
    );
  });
  it("provides a keyboard move alternative and non-destructive maximize", async () => {
    const wrapper = render();
    await wrapper.get('[data-pane="A"] .pane-title').trigger("click");
    await button(wrapper, "movePane").trigger("click");
    expect(wrapper.findAll(".move-pane-form .situate-select")).toHaveLength(2);
    await chooseSelect(wrapper, '[role="combobox"][id$="-move-target"]', "C");
    await chooseSelect(
      wrapper,
      '[role="combobox"][id$="-move-position"]',
      "top",
    );
    await wrapper.get("dialog form").trigger("submit");
    expect(lastIntent(wrapper)).toEqual({
      type: "move",
      tabId: "topic",
      paneId: "A",
      targetPaneId: "C",
      edge: "top",
    });
    const arrangement = wrapper.props("state").tabs[0]!.layout;
    await wrapper.get('[data-pane="A"] .pane-title').trigger("click");
    await button(wrapper, "maximize").trigger("click");
    expect(wrapper.findAll(".pane-tile")).toHaveLength(1);
    expect(wrapper.find(".maximized-pane-header").exists()).toBe(true);
    expect(wrapper.find(".pane-toolbar, .layout-footer").exists()).toBe(false);
    expect(wrapper.props("state").tabs[0]!.layout).toEqual(arrangement);
    await button(wrapper, "restore").trigger("click");
    expect(wrapper.findAll(".pane-tile")).toHaveLength(3);
  });
  it("switches maximized panes and handles system Back before leaving the layout", async () => {
    const state = reduceLayout(
      fixture(),
      { type: "maximize", tabId: "topic", paneId: "A" },
      () => "unused",
    );
    const arrangement = structuredClone(state.tabs[0]!.layout);
    const wrapper = render(state, true);
    await wrapper.get(".switch-pane").trigger("click");
    await flushPromises();
    const dialog = wrapper.get(".maximized-pane-dialog")
      .element as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(
      wrapper.get('.maximized-pane-list [aria-current="true"]').element,
    );
    expect(wrapper.vm.back()).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(wrapper.get(".switch-pane").element);
    expect(wrapper.vm.back()).toBe(false);
    await wrapper.get(".switch-pane").trigger("click");
    await wrapper.findAll(".maximized-pane-list button")[2]!.trigger("click");
    await flushPromises();
    expect(wrapper.props("state").tabs[0]).toMatchObject({
      activePaneId: "C",
      maximizedPaneId: "C",
      layout: arrangement,
    });
    expect(wrapper.get(".switch-pane").text()).toBe("C");
    expect(document.activeElement).toBe(wrapper.get(".switch-pane").element);
    expect(dialog.open).toBe(false);
    await button(wrapper, "restore").trigger("click");
    await flushPromises();
    expect(wrapper.find(".maximized-pane-header").exists()).toBe(false);
    expect(wrapper.find(".pane-pager").exists()).toBe(true);
    expect(wrapper.props("state").tabs[0]!.layout).toEqual(arrangement);
    expect(document.activeElement).toBe(
      wrapper.get('.pane-pager [aria-current="true"]').element,
    );
  });
  it.each(["new-tab", "close-pane"] as const)(
    "dismisses Move pane when %s changes its source",
    async (type) => {
      const wrapper = render();
      await wrapper.get('[data-pane="A"] .pane-title').trigger("click");
      await button(wrapper, "movePane").trigger("click");
      const dialog = wrapper.get(".topic-dialog").element as HTMLDialogElement;
      expect(dialog.open).toBe(true);
      let next = 0;
      await wrapper.setProps({
        state: reduceLayout(
          wrapper.props("state"),
          type === "new-tab" ? { type } : { type, tabId: "topic", paneId: "A" },
          () => `replacement-${++next}`,
        ),
      });
      expect(dialog.open).toBe(false);
      expect(wrapper.find(".move-pane-form").exists()).toBe(false);
    },
  );
  it("closes the pane selector when its tab is replaced", async () => {
    const state = reduceLayout(
      fixture(),
      { type: "maximize", tabId: "topic", paneId: "A" },
      () => "unused",
    );
    const wrapper = render(state);
    await wrapper.get(".switch-pane").trigger("click");
    const dialog = wrapper.get(".maximized-pane-dialog")
      .element as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    await wrapper.setProps({
      state: {
        ...state,
        activeTabId: "other",
        tabs: [{ ...state.tabs[0]!, id: "other" }],
      },
    });
    expect(dialog.open).toBe(false);
    expect(wrapper.vm.back()).toBe(false);
  });
  it("moves a dragged pane to a spatial drop edge using IDs from props", async () => {
    const wrapper = render();
    await wrapper
      .get('[data-pane="A"] .pane-grip')
      .trigger("dragstart", { dataTransfer: { setData: vi.fn() } });
    await wrapper.get('[data-pane="C"] .drop-bottom').trigger("drop");
    expect(lastIntent(wrapper)).toEqual({
      type: "move",
      tabId: "topic",
      paneId: "A",
      targetPaneId: "C",
      edge: "bottom",
    });
    expect(wrapper.find(".drop-targets").exists()).toBe(false);
  });
  it("limits divider keyboard resizing to nested geometry rather than fixed percentages", async () => {
    const wrapper = render();
    await flushPromises();
    measure(wrapper.get(".split-layout.row").element, 1010, 800);
    await flushPromises();
    const handle = wrapper.findAll('[role="separator"]')[0]!;
    expect(handle.attributes("aria-valuemin")).toBe("280");
    expect(handle.attributes("aria-valuemax")).toBe("720");
    expect(handle.attributes("aria-controls")).toBe(
      wrapper.get(".split-layout.row").attributes("id"),
    );
    await handle.trigger("keydown", { key: "Home" });
    expect(lastIntent(wrapper)).toEqual({
      type: "resize",
      tabId: "topic",
      splitId: "row",
      ratio: 0.28,
    });
    await handle.trigger("keydown", { key: "End" });
    expect(lastIntent(wrapper)).toEqual({
      type: "resize",
      tabId: "topic",
      splitId: "row",
      ratio: 0.72,
    });
    await handle.trigger("dblclick");
    expect(lastIntent(wrapper)).toEqual({
      type: "resize",
      tabId: "topic",
      splitId: "row",
      ratio: 0.5,
    });
  });
  it("commits pointer resizing only on release and cancels interrupted drags", async () => {
    const wrapper = render();
    await flushPromises();
    const layout = wrapper.get(".split-layout.row");
    measure(layout.element, 1010, 800);
    vi.spyOn(layout.element, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 20,
      width: 1010,
      height: 800,
    } as DOMRect);
    const handle = wrapper.findAll('[role="separator"]')[0]!;
    let captured = false;
    Object.assign(handle.element, {
      setPointerCapture: () => {
        captured = true;
      },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => {
        captured = false;
      },
    });
    await flushPromises();
    await pointer(handle.element, "pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 605,
      clientY: 20,
    });
    await pointer(handle.element, "pointermove", {
      pointerId: 1,
      clientX: 705,
      clientY: 20,
    });
    expect(wrapper.emitted("intent")).toBeUndefined();
    expect(handle.attributes("aria-valuenow")).toBe("600");
    await pointer(handle.element, "pointerup", {
      pointerId: 1,
      clientX: 705,
      clientY: 20,
    });
    expect(lastIntent(wrapper)).toEqual({
      type: "resize",
      tabId: "topic",
      splitId: "row",
      ratio: 0.6,
    });
    await pointer(handle.element, "pointerdown", {
      button: 0,
      pointerId: 2,
      clientX: 705,
      clientY: 20,
    });
    await pointer(handle.element, "pointermove", {
      pointerId: 2,
      clientX: 450,
      clientY: 20,
    });
    await pointer(handle.element, "pointercancel", { pointerId: 2 });
    expect(wrapper.emitted("intent")).toHaveLength(1);
    expect(handle.attributes("aria-valuenow")).toBe("600");
    expect(captured).toBe(false);
    await pointer(handle.element, "pointerdown", {
      button: 0,
      pointerId: 3,
      clientX: 705,
      clientY: 20,
    });
    await pointer(handle.element, "pointermove", {
      pointerId: 3,
      clientX: 650,
      clientY: 20,
    });
    await handle.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("intent")).toHaveLength(1);
    expect(handle.attributes("aria-valuenow")).toBe("600");
    expect(captured).toBe(false);
  });
  it("splits a pane into an empty host destination and resets the last closed pane", async () => {
    const wrapper = render(fixture(false));
    await wrapper.get(".surface-pane-options").trigger("click");
    await button(wrapper, "splitBelow").trigger("click");
    expect(lastIntent(wrapper)).toEqual({
      type: "split",
      tabId: "topic",
      paneId: "A",
      edge: "bottom",
    });
    expect(wrapper.findAll(".pane-tile")).toHaveLength(2);
    const added = wrapper.props("state").tabs[0]!.panes[1]!;
    expect(added.navigation.entries[0]!.target).toEqual({ kind: "empty" });
    await wrapper.findAll(".pane-title")[1]!.trigger("click");
    await button(wrapper, "closePane").trigger("click");
    expect(wrapper.findAll(".pane-tile")).toHaveLength(1);
    await wrapper.get(".surface-pane-options").trigger("click");
    await button(wrapper, "closePane").trigger("click");
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(1);
    expect(
      wrapper.props("state").tabs[0]!.panes[0]!.navigation.entries[0]!.target,
    ).toEqual({ kind: "empty" });
  });
  it("offers reopening when the final tab is closed", async () => {
    const wrapper = render(fixture(false));
    await wrapper.get(".tab-close").trigger("click");
    expect(wrapper.get('[role="tab"]').text()).toBe("New tab");
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[role="tab"]').element);
    await button(wrapper, "tabOptions").trigger("click");
    await flushPromises();
    await button(wrapper, "reopenTab").trigger("click");
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe("A");
    expect(wrapper.findAll("input")).toHaveLength(1);
  });
  it("uses distinct accessible IDs across renderer instances", () => {
    const host = mount(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(WorkspaceLayout, { state: fixture(false), titleFor }),
            h(WorkspaceLayout, { state: fixture(false), titleFor }),
          ]),
      }),
    );
    const [first, second] = host.findAllComponents(WorkspaceLayout) as [
      ReturnType<typeof render>,
      ReturnType<typeof render>,
    ];
    const ids = [...first.findAll("[id]"), ...second.findAll("[id]")].map(
      (node) => node.attributes("id"),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const wrapper of [first, second]) {
      expect(wrapper.get('[role="tab"]').attributes("aria-controls")).toBe(
        wrapper.get('[role="tabpanel"]').attributes("id"),
      );
    }
  });
});

describe("narrow pane title gestures", () => {
  it("advances at most one pane, never wraps, and ignores vertical or cancelled gestures", async () => {
    const wrapper = mount(PanePager, {
      props: {
        panes: [
          { id: "A", title: "A" },
          { id: "B", title: "B" },
          { id: "C", title: "C" },
        ],
        active: "A",
      },
    });
    const strip = wrapper.get(".pager-viewport");
    Object.assign(strip.element, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
      releasePointerCapture: vi.fn(),
    });
    measure(strip.element, 390, 44);
    const gesture = async (x: number, y = 0, cancel = false) => {
      await pointer(strip.element, "pointerdown", {
        isPrimary: true,
        button: 0,
        pointerId: 1,
        clientX: 200,
        clientY: 20,
      });
      await pointer(strip.element, "pointermove", {
        pointerId: 1,
        clientX: 200 + x,
        clientY: 20 + y,
      });
      await pointer(strip.element, cancel ? "pointercancel" : "pointerup", {
        pointerId: 1,
      });
    };
    await gesture(180);
    expect(wrapper.emitted("select")).toBeUndefined();
    await gesture(-10);
    await gesture(-100, 150);
    await gesture(-100, 0, true);
    expect(wrapper.emitted("select")).toBeUndefined();
    await gesture(-900);
    expect(wrapper.emitted("select")).toEqual([["B"]]);
    await wrapper.setProps({ active: "C" });
    await gesture(-180);
    await strip.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("select")).toHaveLength(1);
    await strip.trigger("keydown", { key: "Home" });
    expect(wrapper.emitted("select")?.at(-1)).toEqual(["A"]);
  });
});
