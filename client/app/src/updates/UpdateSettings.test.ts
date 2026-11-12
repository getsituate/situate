import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { initialFormats, setPreferences } from "@situate/localization";
import { invoke } from "@tauri-apps/api/core";
import UpdateSettings from "./UpdateSettings.vue";
import { SituateButton } from "@situate/ui";
import { updates, updateRequestError, updateRequestPending } from "./runtime";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  setPreferences({ language: "en", formats: initialFormats("en") });
  Object.assign(updates, {
    supported: true,
    installedVersion: "1.0.0",
    phase: "ready",
    artifactId: "artifact-b",
    availableVersion: "1.1.0",
    downloadedBytes: 25,
    totalBytes: null,
    lastSuccessfulCheck: null,
    error: null,
    runningActions: false,
  });
  updateRequestError.value = null;
  updateRequestPending.value = false;
  vi.mocked(invoke).mockImplementation(async () => ({ ...updates }));
});
it("shows megabytes with an indeterminate bar until the total is known", async () => {
  updates.phase = "downloading";
  updates.downloadedBytes = 25_600_000;
  const wrapper = mount(UpdateSettings);
  expect(
    wrapper.get('[role="progressbar"]').attributes("aria-valuenow"),
  ).toBeUndefined();
  expect(wrapper.text()).toContain("25.6 MB downloaded");
  updates.totalBytes = 102_400_000;
  await flushPromises();
  expect(wrapper.get('[role="progressbar"]').attributes("aria-valuenow")).toBe(
    "25",
  );
  expect(wrapper.text()).toContain("25.6 of 102.4 MB");
  setPreferences({ language: "de", formats: initialFormats("de") });
  await flushPromises();
  expect(wrapper.text()).toContain("25,6 von 102,4 MB");
  updates.totalBytes = null;
  updates.downloadedBytes = 0;
  await flushPromises();
  expect(wrapper.text()).toContain("0,0 MB heruntergeladen");
  wrapper.unmount();
});
it("postpones running work without sending installation or abort commands", async () => {
  updates.runningActions = true;
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  expect(wrapper.get("dialog").text()).toContain("another message");
  await wrapper.get("dialog button").trigger("click");
  expect(invoke).not.toHaveBeenCalled();
  expect(updates.runningActions).toBe(true);
  wrapper.unmount();
});
it("requires explicit stop confirmation when work starts after the dialog opens", async () => {
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  updates.runningActions = true;
  await wrapper.get("dialog button:last-child").trigger("click");
  expect(invoke).not.toHaveBeenCalled();
  expect(wrapper.get("dialog button:last-child").text()).toBe(
    "Stop actions and restart",
  );
  await wrapper.get("dialog button:last-child").trigger("click");
  expect(invoke).toHaveBeenCalledWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: true,
  });
  wrapper.unmount();
});
it("keeps native errors inline and offers renewed confirmation after a failed installation", async () => {
  vi.mocked(invoke).mockRejectedValue("native.updates.installFailed");
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  await wrapper.get("dialog button:last-child").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "installed app is unchanged",
  );
  expect(wrapper.get("dialog").element.open).toBe(false);
  expect(invoke).toHaveBeenCalledOnce();
  wrapper.unmount();
});
it("requires renewed stop consent after native detects work racing the confirmation", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce("native.updates.runningActions")
    .mockResolvedValueOnce({ ...updates });
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  await wrapper.get("dialog button:last-child").trigger("click");
  await flushPromises();
  expect(invoke).toHaveBeenCalledWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: false,
  });
  expect(wrapper.get("dialog").element.open).toBe(true);
  expect(wrapper.get("dialog button:last-child").text()).toBe(
    "Stop actions and restart",
  );
  await wrapper.get("dialog button:last-child").trigger("click");
  expect(invoke).toHaveBeenLastCalledWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: true,
  });
  wrapper.unmount();
});
it("replaces installation confirmation with manual guidance when recovery becomes uncertain", async () => {
  updates.phase = "install-failed";
  const wrapper = mount(UpdateSettings);
  expect(wrapper.get(".status-actions button").text()).toBe(
    "Try installation again",
  );
  await wrapper.get(".status-actions button").trigger("click");
  const staleConfirm = wrapper.get("dialog button:last-child");
  updates.phase = "recovery-required";
  updates.error = "native.updates.recoveryRequired";
  await staleConfirm.trigger("click");
  await flushPromises();
  expect(wrapper.find(".status-actions button").exists()).toBe(false);
  expect(wrapper.get("dialog").element.open).toBe(false);
  expect(wrapper.text()).toContain("Do not delete or reset your workspaces.");
  expect(wrapper.text()).not.toContain("Updates download in the background.");
  expect(invoke).not.toHaveBeenCalled();
  wrapper.unmount();
});
it.each([
  ["1.2.0", "artifact-c"],
  ["1.1.0", "artifact-c"],
  ["1.1.0", null],
])(
  "invalidates confirmation when the target becomes %s / %s",
  async (version, artifactId) => {
    const wrapper = mount(UpdateSettings);
    await wrapper.get(".status-actions button").trigger("click");
    const staleInstall = wrapper.findAllComponents(SituateButton).at(-1)!.vm.$
      .vnode.props!.onClick as () => Promise<void>;
    Object.assign(updates, { availableVersion: version, artifactId });
    await staleInstall();
    await flushPromises();
    expect(wrapper.get("dialog").element.open).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    if (artifactId !== null) {
      await wrapper.get(".status-actions button").trigger("click");
      await staleInstall();
      expect(invoke).not.toHaveBeenCalled();
      await wrapper.get("dialog button:last-child").trigger("click");
      expect(invoke).toHaveBeenCalledWith("updates_install", {
        artifactId,
        abortRunning: false,
      });
    } else {
      expect(wrapper.find(".status-actions button").exists()).toBe(false);
    }
    wrapper.unmount();
  },
);
it("does not revive a stale callback when the original artifact returns", async () => {
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  const staleInstall = wrapper.findAllComponents(SituateButton).at(-1)!.vm.$
    .vnode.props!.onClick as () => Promise<void>;
  updates.artifactId = "artifact-c";
  updates.artifactId = "artifact-b";
  await flushPromises();
  await wrapper.get(".status-actions button").trigger("click");
  await staleInstall();
  expect(invoke).not.toHaveBeenCalled();
  await wrapper.get("dialog button:last-child").trigger("click");
  expect(invoke).toHaveBeenCalledWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: false,
  });
  wrapper.unmount();
});
it("requires renewed confirmation when native rejects a changed target", async () => {
  vi.mocked(invoke).mockRejectedValue("native.updates.changed");
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  await wrapper.get("dialog button:last-child").trigger("click");
  await flushPromises();
  expect(wrapper.get("dialog").element.open).toBe(false);
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "The available update changed. Review and confirm again.",
  );
  expect(invoke).toHaveBeenCalledOnce();
  wrapper.unmount();
});
it("requires a separate loss warning before forcing an idle update", async () => {
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  const ordinaryConfirm = wrapper.findAllComponents(SituateButton).at(-1)!.vm.$
    .vnode.props!.onClick as () => Promise<void>;
  const force = wrapper
    .findAll("dialog button")
    .find((button) => button.text() === "Force update…")!;
  await force.trigger("click");
  expect(wrapper.get("dialog").text()).toContain(
    "Unsaved changes in any window may be lost",
  );
  expect(invoke).not.toHaveBeenCalled();
  await ordinaryConfirm();
  expect(invoke).not.toHaveBeenCalled();
  await wrapper.get("dialog button:last-child").trigger("click");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: true,
    force: true,
  });
  wrapper.unmount();
});

it("offers force after preparation fails and postpones without stopping work", async () => {
  updates.phase = "install-failed";
  updates.error = "native.updates.preparationFailed";
  updates.runningActions = true;
  const wrapper = mount(UpdateSettings);
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "force the update without saving",
  );
  await wrapper.findAll(".status-actions button")[1]!.trigger("click");
  expect(wrapper.get("dialog").text()).toContain(
    "Unsaved changes in any window may be lost",
  );
  await wrapper.get("dialog button").trigger("click");
  expect(wrapper.get("dialog").element.open).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  expect(updates.runningActions).toBe(true);
  await wrapper.get(".status-actions button").trigger("click");
  expect(wrapper.get("dialog button:last-child").text()).toBe(
    "Stop actions and restart",
  );
  wrapper.unmount();
});

it("invalidates forced consent when the verified package changes", async () => {
  const wrapper = mount(UpdateSettings);
  await wrapper.get(".status-actions button").trigger("click");
  await wrapper
    .findAll("dialog button")
    .find((button) => button.text() === "Force update…")!
    .trigger("click");
  const staleForce = wrapper.findAllComponents(SituateButton).at(-1)!.vm.$.vnode
    .props!.onClick as () => Promise<void>;
  updates.artifactId = "artifact-c";
  await flushPromises();
  await staleForce();
  expect(invoke).not.toHaveBeenCalled();
  expect(wrapper.get("dialog").element.open).toBe(false);
  wrapper.unmount();
});

it("does not render an update area for an externally managed installation", () => {
  updates.supported = false;
  const wrapper = mount(UpdateSettings);
  expect(wrapper.find(".update-settings").exists()).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  wrapper.unmount();
});
