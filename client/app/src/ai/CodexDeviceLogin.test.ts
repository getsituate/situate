import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CodexDeviceLogin from "./CodexDeviceLogin.vue";
import {
  cancelCodexLogin,
  openCodexLogin,
  startCodexLogin,
  waitCodexLogin,
  type Status,
} from "./api";
vi.mock("./api", () => ({
  cancelCodexLogin: vi.fn(),
  openCodexLogin: vi.fn(),
  startCodexLogin: vi.fn(),
  waitCodexLogin: vi.fn(),
}));
enableAutoUnmount(afterEach);
let resolveWait: (status: Status) => void;
let rejectWait: (reason: string) => void;
const status: Status = {
  available: true,
  config: {
    provider: "openai-codex",
    connectionId: "work",
    label: "Work",
    endpoint: null,
    auth: "oauth",
  },
  selectedModel: "gpt-5.4",
  reason: null,
  modelError: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startCodexLogin).mockResolvedValue({
    id: "attempt",
    userCode: "FAKE-CODE",
    verificationUri: "https://example.invalid/device",
    expiresAt: 12345,
  });
  vi.mocked(waitCodexLogin).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
      }),
  );
  vi.mocked(cancelCodexLogin).mockImplementation(async () => {
    rejectWait?.("native.ai.login.cancelled");
  });
  vi.mocked(openCodexLogin).mockResolvedValue();
});
test("device challenge never asks for pasted code and opens only the trusted attempt", async () => {
  const wrapper = mount(CodexDeviceLogin, {
    props: { scope: "garden", connectionId: "work", label: "Work" },
  });
  expect(wrapper.text()).toContain("⟦ai.device.instructions⟧");
  expect(wrapper.find("h2").exists()).toBe(false);
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("⟦ai.device.codeInstructions⟧");
  expect(wrapper.get('[role="status"]').text()).toBe("⟦ai.device.waiting⟧");
  expect(startCodexLogin).toHaveBeenCalledWith("garden", "work", "Work");
  expect(wrapper.get("output").text()).toBe("FAKE-CODE");
  expect(wrapper.find("input").exists()).toBe(false);
  await wrapper.get("button").trigger("click");
  expect(openCodexLogin).toHaveBeenCalledWith("garden", "attempt");
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(waitCodexLogin).toHaveBeenCalledTimes(1);
  expect(wrapper.emitted("connected")).toBeUndefined();
  resolveWait(status);
  await flushPromises();
  expect(wrapper.emitted("connected")).toEqual([[status]]);
});
test.each(["native.ai.login.timeout", "native.ai.login.denied"])(
  "native %s stays distinct from success",
  async (reason) => {
    const wrapper = mount(CodexDeviceLogin, { props: { scope: "garden" } });
    await wrapper.get("button").trigger("click");
    await flushPromises();
    rejectWait(reason);
    await flushPromises();
    expect(wrapper.get("[role=alert]").text()).toBe(`⟦${reason}⟧`);
    expect(wrapper.find("output").exists()).toBe(false);
    expect(wrapper.emitted("connected")).toBeUndefined();
  },
);
test("cancellation waits for native cleanup and ignores late success", async () => {
  const wrapper = mount(CodexDeviceLogin, { props: { scope: "garden" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  await wrapper.vm.cancelAndWait();
  expect(cancelCodexLogin).toHaveBeenCalledWith("garden", "attempt");
  resolveWait(status);
  await flushPromises();
  expect(wrapper.emitted("connected")).toBeUndefined();
  expect(wrapper.text()).toContain("⟦ai.device.cancelled⟧");
});
test("failed opener keeps the challenge for retry without arbitrary URL arguments", async () => {
  vi.mocked(openCodexLogin).mockRejectedValue("native.ai.browser.openFailed");
  const wrapper = mount(CodexDeviceLogin, { props: { scope: "garden" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦native.ai.browser.openFailed⟧",
  );
  expect(wrapper.get("output").text()).toBe("FAKE-CODE");
});
