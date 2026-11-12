import "../ui/popover-test-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import NavigationView from "./NavigationView.vue";
import NavigationSidebar from "./NavigationSidebar.vue";
import NavigationControls from "./NavigationControls.vue";
import NavigationGreeting from "./NavigationGreeting.vue";
import {
  addChat,
  closeTab,
  createNavigationState,
  navigationIsEditing,
  openView,
  selectTab,
  toggleTask,
  updateDraft,
  type NavigationState,
} from "./model";

enableAutoUnmount(afterEach);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
const originalAnimate = Element.prototype.animate;
afterEach(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
  Element.prototype.animate = originalAnimate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("navigation state", () => {
  it("creates independent serializable scenes without changing fixtures", () => {
    for (const scene of ["chat", "dashboard", "empty", "draft"] as const) {
      const state = createNavigationState(scene);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
    const state = createNavigationState("dashboard");
    state.completedTasks[0] = true;
    state.conversations[0]!.archived = true;
    expect(createNavigationState("dashboard").completedTasks).toEqual([
      false,
      false,
      false,
    ]);
    expect(createNavigationState().conversations[0]!.archived).toBe(false);
    expect(navigationIsEditing(createNavigationState("draft"))).toBe(true);
    expect(navigationIsEditing(createNavigationState())).toBe(true);
    expect(navigationIsEditing(createNavigationState("empty"))).toBe(false);
    expect(navigationIsEditing(createNavigationState("dashboard"))).toBe(false);
    expect(
      navigationIsEditing(
        selectTab(createNavigationState("dashboard"), "chat"),
      ),
    ).toBe(true);
    expect(
      navigationIsEditing(closeTab(createNavigationState("draft"), "chat")),
    ).toBe(false);
  });
  it("keeps independent drafts, selects the next neighbor, and never reuses chat IDs", () => {
    let state = updateDraft(createNavigationState(), "chat", "First draft");
    state = addChat(state);
    state = updateDraft(state, "chat-2", "Second draft");
    state = addChat(state);
    state = selectTab(state, "chat-2");
    state = closeTab(state, "chat-2");
    expect(state.pendingClose).toBe("chat-2");
    expect(state.tabs).toHaveLength(3);
    state = closeTab(state, "chat-2", true);
    expect(state.activeTab).toBe("chat-3");
    expect(state.tabs[0]!.draft).toBe("First draft");
    state = closeTab(state, "chat", true);
    expect(state.activeTab).toBe("chat-3");
    state = closeTab(state, "chat-3");
    expect(state.tabs).toEqual([]);
    expect(state.activeChat).toBeNull();
    expect(addChat(state).activeTab).toBe("chat-4");
  });
  it("retains completed tasks when closing and reopening My day", () => {
    let state = toggleTask(createNavigationState("dashboard"), 0);
    state = closeTab(state, "day");
    state = openView(state, "day");
    expect(state.completedTasks).toEqual([true, false, false]);
    expect(state.feedback).toBe("My day closed.");
  });
});

function view(state = createNavigationState()) {
  return mount(NavigationView, {
    attachTo: document.body,
    props: { state, navigationId: "navigation", navigationOpen: false },
  });
}
function latest(wrapper: ReturnType<typeof view>): NavigationState {
  return wrapper.emitted("update:state")!.at(-1)![0] as NavigationState;
}

describe("navigation content", () => {
  it("exposes a controlled content-only navigation trigger", async () => {
    const wrapper = view();
    expect(wrapper.find("aside").exists()).toBe(false);
    const trigger = wrapper.get('[aria-label="Open navigation"]');
    expect(trigger.attributes("aria-controls")).toBe("navigation");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    expect(wrapper.emitted("openNavigation")![0]![0]).toBeInstanceOf(
      MouseEvent,
    );
    await wrapper.setProps({ showNavigation: false });
    expect(wrapper.find('[aria-label="Open navigation"]').exists()).toBe(false);
  });
  it("emits drafts synchronously and preserves rapid edits before a prop round trip", async () => {
    const wrapper = view();
    const field = wrapper.get("textarea").element;
    field.value = "First";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(latest(wrapper).tabs[0]!.draft).toBe("First");
    wrapper
      .get('[aria-label="New tab"]')
      .element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(latest(wrapper).tabs[0]!.draft).toBe("First");
    expect(latest(wrapper).tabs).toHaveLength(2);
    await nextTick();
    expect(
      wrapper.findAll("textarea").map((item) => item.element.value),
    ).toEqual(["First", ""]);
  });
  it("implements roving tabs, Home/End/arrows, Delete and accessible panels", async () => {
    const wrapper = view(createNavigationState("dashboard"));
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs[0]!.attributes("tabindex")).toBe("0");
    await tabs[0]!.trigger("keydown", { key: "ArrowRight" });
    expect(latest(wrapper).activeTab).toBe("chat");
    expect(document.activeElement).toBe(tabs[1]!.element);
    await tabs[1]!.trigger("keydown", { key: "Home" });
    expect(latest(wrapper).activeTab).toBe("day");
    await tabs[0]!.trigger("keydown", { key: "End" });
    expect(latest(wrapper).activeTab).toBe("chat");
    const panel = wrapper.get(`#${tabs[1]!.attributes("aria-controls")}`);
    expect(panel.attributes("aria-labelledby")).toBe(tabs[1]!.attributes("id"));
    await tabs[1]!.trigger("keydown", { key: "Delete" });
    expect(latest(wrapper).tabs.map((tab) => tab.id)).toEqual(["day"]);
  });
  it("keeps or discards drafts through the modal and supports empty tabs", async () => {
    const wrapper = view(createNavigationState("draft"));
    await wrapper.get('[aria-label="Close tab — New chat"]').trigger("click");
    await nextTick();
    expect(wrapper.get("dialog").element.open).toBe(true);
    expect(document.activeElement).toBe(wrapper.get(".keep-tab").element);
    await wrapper.get("dialog").trigger("cancel");
    await nextTick();
    expect(latest(wrapper).tabs[0]!.draft).toBe(
      "Help me prepare for the workshop.",
    );
    expect(wrapper.get("dialog").element.open).toBe(false);
    await wrapper.get('[aria-label="Close tab — New chat"]').trigger("click");
    await nextTick();
    await wrapper.get("dialog").findAll("button")[1]!.trigger("click");
    expect(latest(wrapper).tabs).toEqual([]);
    expect(wrapper.get(".empty-tabs").text()).toContain("No open tabs");
    await wrapper.get(".empty-tabs button").trigger("click");
    expect(wrapper.get("textarea").element.value).toBe("");
  });
  it("updates task summaries and announcements without losing them on tab switches", async () => {
    const wrapper = view(createNavigationState("dashboard"));
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.get(".dashboard-sub").text()).toBe(
      "2 events · 2 planned tasks",
    );
    expect(wrapper.get('[role="status"]').text()).toBe(
      "2 planned tasks remaining.",
    );
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    await wrapper.findAll('[role="tab"]')[0]!.trigger("click");
    expect(wrapper.get<HTMLInputElement>("input").element.checked).toBe(true);
  });
  it("accepts external state replacements including draft confirmation", async () => {
    const wrapper = view();
    await wrapper.setProps({
      state: closeTab(createNavigationState("draft"), "chat"),
    });
    await nextTick();
    expect(wrapper.get("dialog").element.open).toBe(true);
    await wrapper.setProps({ state: createNavigationState("empty") });
    await nextTick();
    expect(wrapper.get("dialog").element.open).toBe(false);
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
  });
});

describe("responsive layout and motion", () => {
  it("tiles wide content, switches to narrow tabs, and disconnects its observer", async () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const wrapper = view(createNavigationState("dashboard"));
    Object.defineProperty(wrapper.element, "clientWidth", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(wrapper.element, "clientHeight", {
      configurable: true,
      value: 700,
    });
    resize();
    await nextTick();
    expect(wrapper.attributes("data-layout")).toBe("tiled");
    expect(wrapper.findAll(".workarea:not([hidden])")).toHaveLength(2);
    Object.defineProperty(wrapper.element, "clientWidth", {
      configurable: true,
      value: 390,
    });
    resize();
    await nextTick();
    expect(wrapper.attributes("data-layout")).toBe("single");
    expect(wrapper.findAll(".workarea:not([hidden])")).toHaveLength(1);
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalled();
  });
  it("preserves composer focus and selection across layout and keyboard-height changes", async () => {
    let resize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const wrapper = view(createNavigationState("draft"));
    const input = wrapper.get("textarea").element;
    input.focus();
    input.setSelectionRange(5, 12, "backward");
    Object.defineProperty(wrapper.element, "clientWidth", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(wrapper.element, "clientHeight", {
      configurable: true,
      value: 700,
    });
    resize();
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(input);
    expect([
      input.selectionStart,
      input.selectionEnd,
      input.selectionDirection,
    ]).toEqual([5, 12, "backward"]);
    Object.defineProperty(wrapper.element, "clientHeight", {
      configurable: true,
      value: 350,
    });
    resize();
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(input);
    expect([
      input.selectionStart,
      input.selectionEnd,
      input.selectionDirection,
    ]).toEqual([5, 12, "backward"]);
  });
  it("stops both finite greeting tracks under a modal and never replays them", async () => {
    let intersect: (
      entries: { isIntersecting: boolean; intersectionRatio: number }[],
    ) => void = () => {};
    const cancel = vi.fn();
    const animate = vi.fn(() => ({
      cancel,
      finished: new Promise<void>(() => {}),
    }));
    Element.prototype.animate =
      animate as unknown as typeof Element.prototype.animate;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof intersect) {
          intersect = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const wrapper = mount(NavigationGreeting, {
      props: { active: true, covered: false },
    });
    intersect([{ isIntersecting: true, intersectionRatio: 1 }]);
    await nextTick();
    expect(animate).toHaveBeenCalledTimes(2);
    expect(wrapper.attributes("data-state")).toBe("playing");
    await wrapper.setProps({ covered: true });
    expect(wrapper.attributes("data-state")).toBe("done");
    expect(cancel).toHaveBeenCalledTimes(2);
    await wrapper.setProps({ covered: false });
    intersect([{ isIntersecting: true, intersectionRatio: 1 }]);
    expect(animate).toHaveBeenCalledTimes(2);
  });
  it("renders all greeting text without starting tracks with reduced motion", async () => {
    const animate = vi.fn();
    Element.prototype.animate = animate;
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const wrapper = mount(NavigationGreeting, {
      props: { active: true, covered: false },
    });
    await nextTick();
    expect(wrapper.attributes("data-state")).toBe("done");
    expect(animate).not.toHaveBeenCalled();
    expect(wrapper.findAll(".unrevealed")).toHaveLength(0);
  });
});

describe("sidebar and controls", () => {
  it("offers views and conversation states, with archive and restore actions", async () => {
    const wrapper = mount(NavigationSidebar, {
      props: { state: createNavigationState("dashboard") },
    });
    expect(wrapper.text()).toContain("Working · Reading notes");
    expect(wrapper.text()).toContain("Needs approval");
    expect(wrapper.find("nav").exists()).toBe(false);
    await wrapper
      .get(".conversation-row .action-list button:nth-child(2)")
      .trigger("click");
    expect(
      wrapper.find('[aria-label="Restore Prepare the workshop"]').exists(),
    ).toBe(true);
    await wrapper
      .get('[aria-label="Restore Prepare the workshop"]')
      .trigger("click");
    expect(
      wrapper.find('[aria-label="Options for Prepare the workshop"]').exists(),
    ).toBe(true);
    await wrapper
      .findAll(".destination")
      .find((button) => button.text() === "Calendar")!
      .trigger("click");
    const state = wrapper
      .emitted("update:state")!
      .at(-1)![0] as NavigationState;
    expect(state.activeTab).toBe("calendar");
    expect(state.tabs.map((tab) => tab.title)).toEqual([
      "Calendar",
      "New chat",
    ]);
  });
  it("limits task and draft controls to the relevant active scene", async () => {
    const wrapper = mount(NavigationControls, {
      props: { state: createNavigationState("empty") },
    });
    expect(wrapper.find("textarea").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Reset tasks");
    await wrapper.setProps({ state: createNavigationState("dashboard") });
    expect(wrapper.text()).toContain("Reset tasks");
    expect(wrapper.find("textarea").exists()).toBe(false);
    await wrapper.setProps({ state: createNavigationState("draft") });
    expect(wrapper.get("textarea").element.value).toBe(
      "Help me prepare for the workshop.",
    );
  });
  it("shows a complete static greeting when motion APIs are unavailable", async () => {
    const wrapper = mount(NavigationGreeting, {
      props: { active: true, covered: false },
    });
    await nextTick();
    expect(wrapper.attributes("data-state")).toBe("done");
    expect(wrapper.get("h2 .sr-only").text()).toBe("Good to see you.");
    expect(wrapper.get(".welcome-bend").attributes("aria-hidden")).toBe("true");
  });
});
