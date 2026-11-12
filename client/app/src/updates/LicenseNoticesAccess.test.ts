import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { loadLicenses } from "./licenses";
import LicenseNoticesAccess from "./LicenseNoticesAccess.vue";
vi.mock("./licenses", () => ({ loadLicenses: vi.fn() }));
beforeEach(() => {
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  vi.mocked(loadLicenses).mockReset();
});
afterEach(() => vi.restoreAllMocks());
it("loads on demand, exposes selectable legal text and retries a visible failure", async () => {
  const wrapper = mount(LicenseNoticesAccess);
  expect(loadLicenses).not.toHaveBeenCalled();
  vi.mocked(loadLicenses).mockRejectedValueOnce(new Error("Unavailable"));
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "Licenses could not be loaded. Try again.",
  );
  vi.mocked(loadLicenses).mockResolvedValueOnce(
    "Synthetic source https://example.org/source",
  );
  await wrapper.get('[role="alert"] button').trigger("click");
  await flushPromises();
  const document = wrapper.get<HTMLTextAreaElement>("textarea");
  expect(document.element.readOnly).toBe(true);
  expect(document.element.value).toContain("https://example.org/source");
  expect(document.attributes("aria-label")).toBe("Licenses and notices");
  wrapper.unmount();
});
it("cancels pending loads when closed and does not publish a late error", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(loadLicenses).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const wrapper = mount(LicenseNoticesAccess);
  await wrapper.get("button").trigger("click");
  expect(wrapper.get('[role="status"]').text()).toBe("Loading licenses…");
  const signal = vi.mocked(loadLicenses).mock.calls[0]![0]!;
  await wrapper.get("dialog").trigger("cancel");
  expect(signal.aborted).toBe(true);
  reject(new Error("Late failure"));
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find("textarea").exists()).toBe(false);
  wrapper.unmount();
});
