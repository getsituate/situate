import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setPreferences, initialFormats } from "@situate/localization";
import RecoveryHost from "./RecoveryHost.vue";
import {
  captureIncident,
  recoveryState,
  resetIncidents,
  resolveIncident,
} from "./runtime";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  email: vi.fn(),
  repair: vi.fn(),
}));
vi.mock("./native", () => ({
  requestRecovery: mocks.request,
  openRecoveryEmail: mocks.email,
}));
vi.mock("./repair", () => ({ startErrorRepair: mocks.repair }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.4" }));
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  setPreferences({ language: "en", formats: initialFormats("en") });
  resetIncidents();
  mocks.request.mockReset().mockResolvedValue(undefined);
  mocks.email.mockReset().mockResolvedValue(false);
  mocks.repair.mockReset().mockResolvedValue({
    blocked: "errorRepair.modelRequired",
    durable: false,
    assignment: "Bounded assignment",
  });
});
afterEach(() => {
  wrapper?.unmount();
  resetIncidents();
  vi.unstubAllGlobals();
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", true);
});
const button = (name: string) =>
  wrapper.findAll("button").find((item) => item.text() === name)!;
test("dismisses without erasing the incident and retains report description through mail fallback", async () => {
  captureIncident("view", undefined, "scope");
  wrapper = mount(RecoveryHost, { attachTo: document.body });
  await flushPromises();
  expect(wrapper.get("h2").text()).toBe("Oops. Something went wrong.");
  await button("Report a problem").trigger("click");
  await flushPromises();
  await wrapper.get("#incident-description-input").setValue("Opening notes");
  await button("Open email draft").trigger("click");
  await flushPromises();
  expect(
    wrapper.get<HTMLTextAreaElement>("#incident-report-text").element.value,
  ).toContain("Opening notes");
  expect(mocks.email.mock.calls[0][0]).not.toContain("scope");
  await button("Back").trigger("click");
  await flushPromises();
  expect(
    wrapper.get<HTMLTextAreaElement>("#incident-description-input").element
      .value,
  ).toBe("Opening notes");
  await button("Keep working").trigger("click");
  await flushPromises();
  expect(recoveryState.page).toBeNull();
  captureIncident("view", undefined, "scope");
  await flushPromises();
  expect(recoveryState.page).toBeNull();
  await button("Review error").trigger("click");
  await flushPromises();
  expect(recoveryState.page).toBe("unexpected");
});
test("failed workspace recovery remains visible and never restarts the app", async () => {
  captureIncident("view", undefined, "scope");
  mocks.request.mockRejectedValueOnce(new Error("PRIVATE_SECRET"));
  wrapper = mount(RecoveryHost, { attachTo: document.body });
  await flushPromises();
  await button("Reload workspace").trigger("click");
  await flushPromises();
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith("workspace", "scope");
  expect(wrapper.get('[role="alert"]').text()).not.toContain("PRIVATE_SECRET");
  expect(recoveryState.page).toBe("unexpected");
  await button("Reload workspace").trigger("click");
  await flushPromises();
  expect(recoveryState.incidents).toHaveLength(0);
});
test("late email completion does not replace another incident", async () => {
  const first = captureIncident("view", undefined, "scope");
  let complete!: (opened: boolean) => void;
  mocks.email.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  );
  wrapper = mount(RecoveryHost, { attachTo: document.body });
  await flushPromises();
  await button("Report a problem").trigger("click");
  await flushPromises();
  await button("Open email draft").trigger("click");
  await flushPromises();
  resolveIncident(first);
  const next = captureIncident("files", undefined, "other");
  complete(false);
  await flushPromises();
  expect(recoveryState.active?.id).toBe(next.id);
  expect(recoveryState.page).toBe("unexpected");
});
test("iOS offers reopening guidance without invoking app restart", async () => {
  captureIncident("view", undefined, "scope");
  wrapper = mount(RecoveryHost, {
    props: { mobile: true },
    attachTo: document.body,
  });
  await flushPromises();
  await button("Reopen guidance").trigger("click");
  await flushPromises();
  expect(recoveryState.page).toBe("reopen");
  expect(mocks.request).not.toHaveBeenCalled();
});
