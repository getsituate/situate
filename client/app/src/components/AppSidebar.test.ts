import "../ui/popover-test-environment";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import AppSidebar from "./AppSidebar.vue";
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 44, 44),
  );
});
enableAutoUnmount(afterEach);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("opens workspace actions from the keyboard and emits the selected workspace", async () => {
  const wrapper = mount(AppSidebar, {
    attachTo: document.body,
    props: {
      openWorkspaces: [
        { id: "garden", name: "Garden", display: "/Documents/Garden" },
      ],
    },
  });
  await wrapper.get(".workspace-menu").trigger("keydown", { key: "ArrowDown" });
  await flushPromises();
  expect(document.activeElement?.textContent).toBe(
    "⟦navigation.openWorkspace⟧",
  );
  const workspace = wrapper
    .findAll('[role="menuitem"]')
    .find((item) => item.text().includes("Garden"))!;
  await workspace.trigger("click");
  await flushPromises();
  expect(wrapper.emitted("openWorkspace")).toEqual([["garden"]]);
  expect(wrapper.get(".workspace-menu").attributes("aria-expanded")).toBe(
    "false",
  );
  expect(document.activeElement).toBe(wrapper.get(".workspace-menu").element);
});

const availableViews = [
  { id: "files", title: "Files", icon: "folder" as const },
  { id: "garden:notes", title: "Garden notes", icon: "notes" as const },
];

it.each([
  { availableViews: [], pinnedViews: [] },
  { availableViews, pinnedViews: ["files", "garden:notes"] },
  { availableViews, pinnedViews: [] },
  { availableViews, pinnedViews: ["unavailable:view"] },
])(
  "shows available views directly without an empty disclosure (%j)",
  (props) => {
    const wrapper = mount(AppSidebar, { props });
    expect(wrapper.find(".more-views").exists()).toBe(false);
    expect(
      wrapper.findAll(".nav-destination").map((item) => item.text()),
    ).toEqual(props.availableViews.map((view) => view.title));
  },
);

it("keeps pinning separate from navigation and retains focus across list changes", async () => {
  const wrapper = mount(AppSidebar, {
    attachTo: document.body,
    props: { availableViews, pinnedViews: ["files"] },
  });
  await wrapper.setProps({
    onPin(id: string) {
      const pins = wrapper.props("pinnedViews") ?? [];
      void wrapper.setProps({
        pinnedViews: pins.includes(id)
          ? pins.filter((pin) => pin !== id)
          : [...pins, id],
      });
    },
  });
  expect(wrapper.get(".more-views").attributes("aria-expanded")).toBe("false");
  expect(wrapper.get(".additional-views").isVisible()).toBe(false);
  expect(wrapper.get(".additional-views").attributes("id")).toBe(
    wrapper.get(".more-views").attributes("aria-controls"),
  );
  await wrapper.get('[data-view-pin="files"]').trigger("click");
  await flushPromises();
  expect(wrapper.emitted("pin")).toEqual([["files"]]);
  expect(wrapper.emitted("view")).toBeUndefined();
  expect(wrapper.find(".more-views").exists()).toBe(false);
  expect(document.activeElement).toBe(
    wrapper.get('[data-view-pin="files"]').element,
  );
  expect(
    wrapper.get('[data-view-pin="files"]').attributes("aria-pressed"),
  ).toBe("false");

  await wrapper.get('[data-view-pin="garden:notes"]').trigger("click");
  await flushPromises();
  expect(wrapper.get(".more-views").attributes("aria-expanded")).toBe("true");
  expect(wrapper.get(".additional-views").isVisible()).toBe(true);
  expect(document.activeElement).toBe(
    wrapper.get('[data-view-pin="garden:notes"]').element,
  );
  expect(
    wrapper.get('[data-view-pin="garden:notes"]').attributes("aria-pressed"),
  ).toBe("true");
  expect(wrapper.findAll(".nav-list").at(0)!.text()).toContain("Garden notes");
  expect(wrapper.get(".additional-views .nav-destination").text()).toBe(
    "Files",
  );

  await wrapper.get('[data-view-pin="files"]').trigger("click");
  await flushPromises();
  expect(wrapper.find(".more-views").exists()).toBe(false);
  expect(document.activeElement).toBe(
    wrapper.get('[data-view-pin="files"]').element,
  );
  await wrapper.get(".nav-destination").trigger("click");
  expect(wrapper.emitted("view")).toEqual([["garden:notes"]]);
});

it("closes additional views when switching workspaces or removing their last view", async () => {
  const wrapper = mount(AppSidebar, {
    props: {
      availableViews,
      pinnedViews: ["files"],
      currentWorkspaceId: "garden",
    },
  });
  await wrapper.get(".more-views").trigger("click");
  await wrapper.setProps({ currentWorkspaceId: "reading" });
  expect(wrapper.get(".more-views").attributes("aria-expanded")).toBe("false");
  await wrapper.get(".more-views").trigger("click");
  await wrapper.setProps({ availableViews: availableViews.slice(0, 1) });
  expect(wrapper.find(".more-views").exists()).toBe(false);
  await wrapper.setProps({ availableViews });
  expect(wrapper.get(".more-views").attributes("aria-expanded")).toBe("false");
});

it("discards title editing when switching workspaces with the same conversation ID", async () => {
  const wrapper = mount(AppSidebar, {
    attachTo: document.body,
    props: {
      currentWorkspaceId: "first-workspace",
      conversations: [{ id: "legacy", title: "Reading list", revision: 1 }],
    },
  });
  await wrapper.get(".conversation-actions").trigger("click");
  await flushPromises();
  document.body
    .querySelector<HTMLButtonElement>('.conversation-row [role="menuitem"]')!
    .click();
  await flushPromises();
  await wrapper.get("input").setValue("Unfinished title");
  await wrapper.setProps({
    currentWorkspaceId: "second-workspace",
    conversations: [{ id: "legacy", title: "Garden plan", revision: 1 }],
  });
  expect(wrapper.find("input").exists()).toBe(false);
  expect(wrapper.get(".conversation-title").text()).toBe("Garden plan");
});
