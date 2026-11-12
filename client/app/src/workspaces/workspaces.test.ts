import "../ui/popover-test-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { chooseParent, preflight, nameError, type Snapshot } from "./api";
import WorkspaceCreateForm from "./WorkspaceCreateForm.vue";
import WorkspaceEntry from "./WorkspaceEntry.vue";
import WorkspaceRow from "./WorkspaceRow.vue";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  chooseParent: vi.fn(),
  preflight: vi.fn(),
}));
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 44, 44),
  );
});
enableAutoUnmount(afterEach);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const parent = { id: "parent", name: "Documents", display: "/Documents" };
const garden = { id: "garden", name: "Garden", display: "/Documents/Garden" };
const state = (): Snapshot => ({
  ready: true,
  mobile: true,
  known: [garden],
  open: [garden],
  current: garden,
  failures: [],
  error: null,
});
const button = (wrapper: ReturnType<typeof mount>, text: string) =>
  wrapper
    .findAll("button")
    .reverse()
    .find((b) => b.text() === text)!;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.mocked(chooseParent).mockReset().mockResolvedValue(parent);
  vi.mocked(preflight).mockReset().mockResolvedValue("/Documents/Garden");
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

describe("creation", () => {
  it("validates on blur and submission, corrects in place and focuses the invalid name", async () => {
    const run = vi.fn().mockResolvedValue(true);
    const wrapper = mount(WorkspaceCreateForm, {
      attachTo: document.body,
      props: { run, busy: false },
    });
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>("#workspace-name");
    const feedback = () => wrapper.find("#workspace-name-error");
    expect(feedback().exists()).toBe(false);
    expect(input.attributes("aria-describedby")).toBe("workspace-name-help");
    await input.setValue("bad/name");
    expect(feedback().exists()).toBe(false);
    await input.trigger("blur");
    expect(feedback().text()).toContain(
      "⟦workspace.useANameOfAtMost240BytesWithout⟧",
    );
    expect(input.attributes("aria-invalid")).toBe("true");
    expect(wrapper.get('[aria-live="polite"]').attributes("aria-atomic")).toBe(
      "true",
    );
    input.element.focus();
    await input.setValue("Garden");
    await flushPromises();
    expect(feedback().exists()).toBe(false);
    expect(input.attributes("aria-describedby")).toBe("workspace-name-help");
    expect(input.attributes("aria-invalid")).toBeUndefined();
    expect(document.activeElement).toBe(input.element);
    await input.setValue("CON");
    expect(feedback().text()).toContain(
      "⟦workspace.thisNameIsReservedByTheOperatingSystem⟧",
    );
    await input.setValue("");
    expect(feedback().text()).toContain("⟦workspace.enterAWorkspaceName⟧");
    button(wrapper, "⟦workspace.createWorkspace⟧").element.focus();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(document.activeElement).toBe(input.element);
    expect(wrapper.find("[aria-live]").exists()).toBe(false);
    expect(wrapper.find(".entry-error").exists()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(preflight).toHaveBeenCalledTimes(1);
    await wrapper.get("form").trigger("submit");
    expect(run).not.toHaveBeenCalled();
  });
  it("allows a first empty-name attempt without requiring blur", async () => {
    const wrapper = mount(WorkspaceCreateForm, {
      attachTo: document.body,
      props: { run: vi.fn(), busy: false },
    });
    await flushPromises();
    expect(wrapper.find("#workspace-name-error").exists()).toBe(false);
    const create = button(wrapper, "⟦workspace.createWorkspace⟧");
    expect(create.element.disabled).toBe(false);
    await create.trigger("click");
    await flushPromises();
    expect(wrapper.get("#workspace-name-error").text()).toContain(
      "⟦workspace.enterAWorkspaceName⟧",
    );
    expect(document.activeElement).toBe(wrapper.get("#workspace-name").element);
  });

  it("updates the full destination before preflight finishes and keeps parent-only creation", async () => {
    vi.mocked(preflight).mockImplementation(() => new Promise(() => {}));
    const run = vi.fn().mockResolvedValue(true);
    const wrapper = mount(WorkspaceCreateForm, { props: { run, busy: false } });
    await flushPromises();
    await wrapper.get("#workspace-name").setValue("Travel notes");
    expect(
      wrapper.get<HTMLInputElement>("#workspace-parent").element.value,
    ).toBe("/Documents/Travel notes");
    vi.mocked(chooseParent).mockResolvedValueOnce({
      id: "archive",
      name: "Archive",
      display: "/Example/Archive/",
    });
    vi.mocked(preflight).mockResolvedValueOnce("/Example/Archive/Travel notes");
    await button(wrapper, "⟦workspace.choose⟧").trigger("click");
    await flushPromises();
    expect(chooseParent).toHaveBeenLastCalledWith(true);
    expect(preflight).toHaveBeenLastCalledWith("archive", "Travel notes");
    expect(
      wrapper.get<HTMLInputElement>("#workspace-parent").element.value,
    ).toBe("/Example/Archive/Travel notes");
    await wrapper.get("form").trigger("submit");
    expect(run).toHaveBeenCalledWith(
      "create",
      "archive",
      "Travel notes",
      "violet",
    );
  });
  it("places destination errors above colors and clears stale operation errors on edits", async () => {
    const wrapper = mount(WorkspaceCreateForm, {
      props: { run: vi.fn(), busy: false },
    });
    await flushPromises();
    await wrapper.get("#workspace-name").setValue("Garden");
    await flushPromises();
    await wrapper.setProps({
      operationError: "native.workspace.folder.exists",
    });
    const destination = wrapper.get("#workspace-parent");
    expect(destination.attributes("aria-describedby")).toBe("folder-error");
    expect(destination.attributes("aria-invalid")).toBe("true");
    expect(
      wrapper
        .get("#folder-error")
        .element.compareDocumentPosition(wrapper.get("fieldset").element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await wrapper.get("#workspace-name").setValue("New garden");
    await flushPromises();
    expect(wrapper.find("#folder-error").exists()).toBe(false);
    expect(destination.attributes("aria-describedby")).toBeUndefined();
    expect(destination.attributes("aria-invalid")).toBe("false");
    await wrapper.setProps({
      operationError: "native.workspace.create.partial",
    });
    await wrapper.get("#workspace-name").setValue("Other garden");
    await flushPromises();
    expect(wrapper.text()).toContain("⟦native.workspace.create.partial⟧");
    expect(destination.attributes("aria-invalid")).toBe("false");
  });
  it("checks collisions again on edits and submits only a checked destination", async () => {
    const run = vi.fn().mockResolvedValue(true);
    const wrapper = mount(WorkspaceCreateForm, { props: { run, busy: false } });
    await flushPromises();
    expect(
      button(wrapper, "⟦workspace.createWorkspace⟧").element.disabled,
    ).toBe(false);
    vi.mocked(preflight).mockRejectedValueOnce(
      "native.workspace.folder.exists",
    );
    await wrapper.get("input").setValue("Existing");
    await flushPromises();
    expect(wrapper.text()).toContain("⟦workspace.thisFolderAlreadyExists⟧");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
    });
    expect(
      button(wrapper, "⟦workspace.createWorkspace⟧").element.disabled,
    ).toBe(true);
    await wrapper.get("input").setValue("Garden");
    await flushPromises();
    expect(
      button(wrapper, "⟦workspace.createWorkspace⟧").element.disabled,
    ).toBe(false);
    expect(run).not.toHaveBeenCalled();
    await wrapper.get("form").trigger("submit");
    expect(run).toHaveBeenCalledWith("create", "parent", "Garden", "violet");
    expect(wrapper.emitted("opened")).toHaveLength(1);
  });
  it("offers the separate opening route for a collision without creating or clearing the form", async () => {
    vi.mocked(preflight).mockRejectedValue("native.workspace.folder.exists");
    const run = vi.fn();
    const wrapper = mount(WorkspaceCreateForm, { props: { run, busy: false } });
    await flushPromises();
    await wrapper.get("#workspace-name").setValue("Existing");
    await flushPromises();
    await button(wrapper, "⟦workspace.openAnExistingWorkspace⟧").trigger(
      "click",
    );
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    expect(wrapper.get<HTMLInputElement>("#workspace-name").element.value).toBe(
      "Existing",
    );
    expect(
      wrapper.get("#workspace-name").attributes("aria-describedby"),
    ).toContain(" folder-error");
  });
  it("discards stale success and failure responses", async () => {
    const requests: {
      resolve: (value: string) => void;
      reject: (value: string) => void;
    }[] = [];
    vi.mocked(preflight).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          requests.push({ resolve, reject });
        }),
    );
    const wrapper = mount(WorkspaceCreateForm, {
      props: { run: vi.fn(), busy: false },
    });
    await flushPromises();
    await wrapper.get("input").setValue("First");
    await wrapper.get("input").setValue("Second");
    requests[0]!.resolve("/Documents/First");
    await flushPromises();
    expect(
      button(wrapper, "⟦workspace.createWorkspace⟧").element.disabled,
    ).toBe(true);
    requests[1]!.reject("native.workspace.folder.exists");
    await flushPromises();
    expect(wrapper.text()).toContain("⟦workspace.thisFolderAlreadyExists⟧");
    await wrapper.get("input").setValue("Third");
    await wrapper.get("input").setValue("Fourth");
    requests[3]!.resolve("/Documents/Fourth");
    requests[2]!.reject("Old failure");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Old failure");
    expect(
      wrapper.get<HTMLInputElement>("#workspace-parent").element.value,
    ).toBe("/Documents/Fourth");
    expect(
      button(wrapper, "⟦workspace.createWorkspace⟧").element.disabled,
    ).toBe(false);
  });
  it("retains fields on cancellation and creation failure, and restores picker focus", async () => {
    const wrapper = mount(WorkspaceCreateForm, {
      attachTo: document.body,
      props: { run: vi.fn().mockResolvedValue(false), busy: false },
    });
    await flushPromises();
    await wrapper.get("input").setValue("Garden");
    await flushPromises();
    vi.mocked(chooseParent).mockResolvedValueOnce(null);
    await button(wrapper, "⟦workspace.choose⟧").trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(
      button(wrapper, "⟦workspace.choose⟧").element,
    );
    expect(
      wrapper.get<HTMLInputElement>("#workspace-parent").element.value,
    ).toBe("/Documents/Garden");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get("input").element.value).toBe("Garden");
    expect(wrapper.emitted("opened")).toBeUndefined();
  });
  it("requires selection when Documents is unavailable and does not autofocus the name", async () => {
    vi.mocked(chooseParent).mockResolvedValue(null);
    const wrapper = mount(WorkspaceCreateForm, {
      props: { run: vi.fn(), busy: false },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("⟦workspace.chooseAFolderToContinue⟧");
    expect(wrapper.get("input").attributes("autofocus")).toBeUndefined();
    expect(
      button(wrapper, "⟦workspace.createWorkspace⟧").element.disabled,
    ).toBe(true);
  });
});

describe("entry and actions", () => {
  it("blocks workspace entry input until recovery preparation finishes", async () => {
    const wrapper = mount(WorkspaceEntry, {
      props: {
        state: state(),
        run: vi.fn(),
        busy: false,
        error: "",
        inert: true,
      },
    });
    expect(wrapper.get("main").attributes("inert")).toBeDefined();
    await wrapper.setProps({ inert: false });
    expect(wrapper.get("main").attributes("inert")).toBeUndefined();
  });
  it("dismisses application actions on back and runs quit only on selection", async () => {
    const run = vi.fn().mockResolvedValue(true);
    const wrapper = mount(WorkspaceEntry, {
      attachTo: document.body,
      props: {
        state: { ...state(), mobile: false },
        run,
        busy: false,
        error: "",
      },
    });
    const trigger = wrapper.get(
      '[aria-label="⟦workspace.applicationActions⟧"][aria-haspopup]',
    );
    await trigger.trigger("click");
    await flushPromises();
    expect(wrapper.vm.back()).toBe(true);
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger.element);
    expect(run).not.toHaveBeenCalled();
    await trigger.trigger("click");
    await button(wrapper, "⟦workspace.quitSituate⟧").trigger("click");
    expect(run).toHaveBeenCalledWith("quit");
  });
  it("retains the creation draft when opening an existing workspace fails", async () => {
    vi.mocked(preflight).mockRejectedValue("native.workspace.folder.exists");
    const run = vi.fn(async (): Promise<boolean> => {
      await wrapper.setProps({
        error: "native.workspace.migration.cleanupFailed",
      });
      return false;
    });
    const wrapper = mount(WorkspaceEntry, {
      attachTo: document.body,
      props: { state: state(), run, busy: false, error: "" },
    });
    await wrapper.get(".entry-action.primary-choice").trigger("click");
    await flushPromises();
    await wrapper.get("#workspace-name").setValue("Existing");
    await flushPromises();
    const trigger = button(wrapper, "⟦workspace.openAnExistingWorkspace⟧");
    await trigger.trigger("click");
    await flushPromises();
    expect(run).toHaveBeenCalledExactlyOnceWith("pick", undefined);
    const dialog = wrapper
      .findAll<HTMLDialogElement>("dialog")
      .find((item) => item.element.open)!;
    expect(dialog.text()).toContain("⟦workspace.couldntOpenTheWorkspace⟧");
    expect(wrapper.get(".creation-error").text()).toContain(
      "⟦workspace.thisFolderAlreadyExists⟧",
    );
    expect(wrapper.get(".creation-error").text()).not.toContain(
      "⟦native.workspace.migration.cleanupFailed⟧",
    );
    expect(wrapper.vm.back()).toBe(true);
    await flushPromises();
    expect(dialog.element.open).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    expect(wrapper.get<HTMLInputElement>("#workspace-name").element.value).toBe(
      "Existing",
    );
    await button(wrapper, "⟦workspace.reviewError⟧").trigger("click");
    expect(dialog.element.open).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not show an error when workspace selection is cancelled", async () => {
    const run = vi.fn().mockResolvedValue(false);
    const wrapper = mount(WorkspaceEntry, {
      props: { state: state(), run, busy: false, error: "" },
    });
    await wrapper.findAll(".entry-action")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find("dialog[open]").exists()).toBe(false);
    expect(wrapper.emitted("opened")).toBeUndefined();
  });
  it("retains failed workspace recovery actions inside the review disclosure", async () => {
    const run = vi.fn().mockResolvedValue(false);
    const wrapper = mount(WorkspaceEntry, {
      props: {
        state: {
          ...state(),
          failures: [
            { location: garden, message: "native.workspace.folder.exists" },
          ],
        },
        run,
        busy: false,
        error: "",
      },
    });
    expect(wrapper.get("summary").text()).toBe("⟦navigation.review⟧");
    await button(wrapper, "⟦navigation.retry⟧").trigger("click");
    expect(run).toHaveBeenCalledWith("open", "garden");
    expect(wrapper.emitted("opened")).toBeUndefined();
  });
  it("keeps open-but-unlisted workspaces reachable without duplicate rows", async () => {
    const run = vi.fn().mockResolvedValue(true);
    const snapshot = state();
    snapshot.known = [];
    const wrapper = mount(WorkspaceEntry, {
      props: { state: snapshot, run, busy: false, error: "" },
    });
    expect(wrapper.findAllComponents(WorkspaceRow)).toHaveLength(1);
    expect(wrapper.text()).toContain("⟦workspace.openWorkspaces⟧");
    expect(wrapper.text()).not.toContain("⟦workspace.yourWorkspaces⟧");
    await wrapper.get(".workspace-select").trigger("click");
    expect(run).toHaveBeenCalledWith("open", "garden");
  });
  it.each([false, true])(
    "explains unavailable sync without running an action (mobile: %s)",
    async (mobile) => {
      const run = vi.fn();
      const wrapper = mount(WorkspaceEntry, {
        attachTo: document.body,
        props: { state: { ...state(), mobile }, run, busy: false, error: "" },
      });
      const trigger = wrapper.get<HTMLButtonElement>(".sync-choice");
      expect(trigger.element.disabled).toBe(false);
      expect(trigger.attributes("aria-haspopup")).toBe("dialog");
      expect(trigger.attributes("aria-description")).toBe(
        "⟦workspace.syncIsUnavailable⟧",
      );
      expect(wrapper.find(".sync-help").exists()).toBe(false);
      expect(wrapper.find(".entry-titlebar-actions > span").exists()).toBe(
        false,
      );
      const dialog = wrapper.get<HTMLDialogElement>(
        `dialog[id="${trigger.attributes("aria-controls")}"]`,
      );
      expect(dialog.element.open).toBe(false);
      await trigger.trigger("click");
      expect(dialog.element.open).toBe(true);
      const titleId = dialog.attributes("aria-labelledby");
      expect(dialog.get(`[id="${titleId}"]`).text()).toBe(
        "⟦workspace.syncIsUnavailable⟧",
      );
      expect(dialog.get("button").attributes("autofocus")).toBeDefined();
      await button(wrapper, "⟦workspace.close⟧").trigger("click");
      expect(dialog.element.open).toBe(false);
      expect(document.activeElement).toBe(trigger.element);
      await trigger.trigger("click");
      await dialog.trigger("cancel");
      expect(dialog.element.open).toBe(false);
      expect(document.activeElement).toBe(trigger.element);
      await trigger.trigger("click");
      expect(wrapper.vm.back()).toBe(true);
      await flushPromises();
      expect(dialog.element.open).toBe(false);
      expect(document.activeElement).toBe(trigger.element);
      expect(wrapper.emitted("back")).toBeUndefined();
      expect(wrapper.emitted("opened")).toBeUndefined();
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("confirms list removal separately from closure", async () => {
    const run = vi.fn().mockResolvedValue(true);
    const wrapper = mount(WorkspaceEntry, {
      props: { state: state(), run, busy: false, error: "" },
    });
    await wrapper.get(".row-actions").trigger("click");
    await button(wrapper, "⟦workspace.removeFromList⟧").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("⟦workspace.thisWorkspaceWillRemainOpen⟧");
    await button(wrapper, "⟦workspace.removeFromList⟧").trigger("click");
    expect(run).toHaveBeenCalledWith("remove", "garden");
    expect(run).not.toHaveBeenCalledWith("close", expect.anything());
    await wrapper.get(".row-actions").trigger("click");
    await button(wrapper, "⟦workspace.closeWorkspace⟧").trigger("click");
    expect(run).toHaveBeenCalledWith("close", "garden");
  });
  it("opens actions with arrows and restores focus on Escape", async () => {
    const wrapper = mount(WorkspaceRow, {
      attachTo: document.body,
      props: {
        workspace: garden,
        open: true,
        listed: true,
        current: false,
        busy: false,
      },
    });
    await wrapper.get(".row-actions").trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    expect(document.activeElement?.textContent).toBe(
      "⟦workspace.closeWorkspace⟧",
    );
    await wrapper.get('[role="menu"]').trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe(
      "⟦workspace.removeFromList⟧",
    );
    await wrapper.get('[role="menu"]').trigger("keydown", { key: "Escape" });
    expect(document.activeElement).toBe(wrapper.get(".row-actions").element);
    expect(wrapper.get(".row-actions").attributes("aria-expanded")).toBe(
      "false",
    );
  });
});

it("mirrors portable name validation", () => {
  for (const value of [
    "",
    " ",
    ".",
    "..",
    "../a",
    "a/b",
    "a\\b",
    "CON.txt",
    "LPT9",
    "name.",
    "name ",
  ])
    expect(nameError(value)).not.toBe("");
  for (const value of ["Garden notes", "Café notes 🌻", "com10", ".notes"])
    expect(nameError(value)).toBe("");
});
