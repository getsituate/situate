import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import AssignmentFiles from "./AssignmentFiles.vue";
import {
  createAssignmentInspection,
  makeSelectedHistoryUnavailable,
  addInspectionStressChanges,
  addInspectionLongDiff,
  type AssignmentInspectionState,
} from "./assignment-files";

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});
function panel(preset = "plugins-development-changes") {
  const wrapper = mount(AssignmentFiles, {
    attachTo: document.body,
    props: {
      state: createAssignmentInspection(preset),
      "onUpdate:state": (state: AssignmentInspectionState) => {
        void wrapper.setProps({ state });
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}
async function click(wrapper: ReturnType<typeof panel>, label: string) {
  const button = wrapper
    .findAll("button")
    .find(
      (entry) =>
        entry.text() === label || entry.attributes("aria-label") === label,
    );
  expect(button, label).toBeDefined();
  await button!.trigger("click");
  await nextTick();
}
async function select(wrapper: ReturnType<typeof panel>, path: string) {
  await wrapper
    .findAll(".file-row")
    .find((entry) => entry.attributes("aria-label")?.includes(path))!
    .trigger("click");
  await nextTick();
}
describe("assignment file diffs", () => {
  it("lists workspace-relative paths without package grouping or explanations and opens a unified diff", async () => {
    const wrapper = panel();
    expect(wrapper.find(".change-group").exists()).toBe(false);
    expect(
      wrapper.findAll("button").some((button) => button.text() === "Files"),
    ).toBe(false);
    await select(wrapper, ".situate/plugins/notes/code/src/index.ts");
    expect(document.activeElement).toBe(wrapper.get("h4").element);
    expect(wrapper.get("h4").text()).toBe(
      ".situate/plugins/notes/code/src/index.ts",
    );
    expect(wrapper.get(".diff-line.removed .line-content").text()).toBe(
      "export const listNotes = () => [];",
    );
    expect(wrapper.get(".diff-line.added .line-content").text()).toContain(
      "limit = 20",
    );
    expect(wrapper.get(".added-count").text()).toBe("+1");
    expect(wrapper.find(".technical-details").exists()).toBe(false);
    expect(wrapper.find(".change-summary").exists()).toBe(false);
  });
  it("compares raw Markdown, additions and deletions, and displays rename paths without fabricated edits", async () => {
    const wrapper = panel();
    await select(wrapper, "Notes/Weekly review.md");
    expect(wrapper.get(".diff-line.same .line-content").text()).toBe(
      "# Weekly review",
    );
    expect(wrapper.get(".diff-line.removed .line-content").text()).toBe(
      "Review tasks.",
    );
    expect(wrapper.get(".diff-line.added .line-content").text()).toBe(
      "Review tasks and notes.",
    );
    await click(wrapper, "All changes");
    await select(wrapper, "legacy.ts");
    expect(wrapper.findAll(".diff-line.added")).toHaveLength(0);
    expect(wrapper.get(".diff-line.removed .line-content").text()).toBe(
      "export const legacy = true;",
    );
    await click(wrapper, "All changes");
    expect(document.activeElement).toBe(
      wrapper.get('[aria-current="true"]').element,
    );
    await select(wrapper, "manifest.json");
    expect(wrapper.get(".renamed-path").text()).toContain("plugin.json");
    expect(wrapper.text()).toContain("No content changes.");
    expect(wrapper.find(".diff-line").exists()).toBe(false);
  });
  it("retains search and independent list and diff scrolling", async () => {
    const wrapper = panel();
    await wrapper.get("input").setValue("index.ts");
    const list = wrapper.get(".inspection-scroll");
    list.element.scrollTop = 137;
    await list.trigger("scroll");
    await select(wrapper, ".situate/plugins/notes/code/src/index.ts");
    const diff = wrapper.get(".diff-scroll");
    diff.element.scrollTop = 71;
    await diff.trigger("scroll");
    await click(wrapper, "All changes");
    expect(wrapper.get("input").element.value).toBe("index.ts");
    expect(list.element.scrollTop).toBe(137);
    await select(wrapper, ".situate/plugins/notes/code/src/index.ts");
    expect(wrapper.get(".diff-scroll").element.scrollTop).toBe(71);
  });
  it("paginates 500 changes, filters across pages, and navigates using the keyboard", async () => {
    const wrapper = panel("plugins-create");
    const state = createAssignmentInspection("plugins-create");
    addInspectionStressChanges(state);
    await wrapper.setProps({ state });
    expect(wrapper.findAll(".file-row")).toHaveLength(100);
    await click(wrapper, "Next page");
    expect(wrapper.get(".list-pagination").text()).toContain("101–200 of 500");
    await wrapper.findAll(".file-row")[0].trigger("keydown", { key: "End" });
    expect(wrapper.props("state").changes.selected).toBe("review-500");
    expect(wrapper.props("state").changes.page).toBe(4);
    await click(wrapper, "All changes");
    await wrapper.get("input").setValue("Review 450.md");
    expect(wrapper.findAll(".file-row")).toHaveLength(1);
    expect(wrapper.get(".file-row").text()).toContain("Review 450.md");
  });
  it("keeps long diffs bounded with expandable context", async () => {
    const wrapper = panel();
    const state = createAssignmentInspection();
    addInspectionLongDiff(state);
    await wrapper.setProps({ state });
    expect(wrapper.findAll(".diff-line.added")).toHaveLength(2);
    expect(wrapper.findAll(".diff-line.removed")).toHaveLength(2);
    expect(wrapper.findAll(".diff-gap")).toHaveLength(3);
    expect(wrapper.findAll(".diff-line").length).toBeLessThan(25);
    await wrapper.findAll(".diff-gap button")[1].trigger("click");
    expect(wrapper.findAll(".diff-line").length).toBeGreaterThan(200);
    expect(wrapper.findAll(".diff-line").length).toBeLessThan(400);
  });
  it("keeps unavailable and unsupported comparisons distinct without substituting current contents", async () => {
    const wrapper = panel();
    const state = createAssignmentInspection("plugins-development-parallel");
    makeSelectedHistoryUnavailable(state);
    await wrapper.setProps({ state });
    expect(wrapper.get('[role="status"]').text()).toContain(
      "current file is not shown",
    );
    expect(wrapper.find(".diff-line").exists()).toBe(false);
    const next = createAssignmentInspection();
    next.changes.selected = next.recordedChanges[0].id;
    next.changes.pane = "file";
    next.recordedChanges[0].after!.status = "unsupported";
    await wrapper.setProps({ state: next });
    expect(wrapper.get('[role="status"]').text()).toContain(
      "Preview is not available",
    );
  });
  it("keeps unattributed observations separate from recorded comparisons", async () => {
    const wrapper = panel("plugins-development-parallel");
    await wrapper
      .findAll(".file-row")
      .find((row) => row.attributes("data-change-id") === "notes")!
      .trigger("click");
    expect(wrapper.get(".diff-lines").text()).not.toContain("archived = false");
    await click(wrapper, "All changes");
    await wrapper
      .findAll(".file-row")
      .find((row) => row.attributes("data-change-id") === "observed-notes")!
      .trigger("click");
    expect(wrapper.get('[role="note"]').text()).toContain(
      "not known who made it",
    );
    expect(wrapper.get(".diff-lines").text()).toContain("archived = false");
  });
  it("handles empty changes and retry without losing selection", async () => {
    const wrapper = panel("plugins-create");
    expect(wrapper.text()).toContain("No changes to show yet.");
    const state = createAssignmentInspection();
    state.changes.status = "error";
    await wrapper.setProps({ state });
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "could not be loaded",
    );
    await click(wrapper, "Try again");
    expect(wrapper.get('[role="status"]').text()).toBe("Loading changes…");
  });
});
