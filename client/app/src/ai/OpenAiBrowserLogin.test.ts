import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, expect, test, vi } from "vitest";
import OpenAiBrowserLogin from "./OpenAiBrowserLogin.vue";
import type { Status } from "./api";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class {},
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const connected: Status = {
  config: { provider: "openai", endpoint: null, auth: "oauth" },
  available: true,
  reason: null,
  selectedModel: null,
  modelError: null,
};
beforeEach(() => {
  native.invoke.mockReset();
});
test("opens a native scoped sign-in and emits connected only after the durable result", async () => {
  const saved = deferred<Status>();
  native.invoke.mockImplementation((command) =>
    command === "ai_openai_start"
      ? Promise.resolve("attempt-one")
      : saved.promise,
  );
  const wrapper = mount(OpenAiBrowserLogin, {
    props: { scope: "workspace-one" },
  });
  expect(wrapper.findAll("button")).toHaveLength(1);
  expect(wrapper.text()).toContain(
    "⟦ai.yourProviderHandlesSignInNoPasswordIsEntered⟧",
  );
  expect(wrapper.text()).not.toContain(
    "⟦ai.cancelStopsThisSignInAttemptInSituateIt⟧",
  );
  expect(wrapper.text()).not.toContain("⟦ai.continueAtTheProvider⟧");
  expect(wrapper.find("select").exists()).toBe(false);
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(native.invoke).toHaveBeenNthCalledWith(1, "ai_openai_start", {
    scope: "workspace-one",
  });
  expect(native.invoke).toHaveBeenNthCalledWith(2, "ai_openai_wait", {
    scope: "workspace-one",
    id: "attempt-one",
  });
  expect(wrapper.get('[role="status"]').text()).toBe("⟦ai.waitingForSignIn⟧");
  expect(wrapper.text()).toContain(
    "⟦ai.keepThisWorkspaceOpenReturningToSituateDoesNot⟧",
  );
  expect(wrapper.text()).toContain(
    "⟦ai.completeTheBrowserStepsWithinFiveMinutesYouCan⟧",
  );
  expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  expect(wrapper.emitted("connected")).toBeUndefined();
  saved.resolve(connected);
  await flushPromises();
  expect(wrapper.emitted("connected")).toEqual([[connected]]);
  wrapper.unmount();
});
test("reconnect passes the original connection identity and edited label to native", async () => {
  native.invoke.mockImplementation(async (command) =>
    command === "ai_openai_start" ? "attempt" : connected,
  );
  const wrapper = mount(OpenAiBrowserLogin, {
    props: { scope: "one", connectionId: "work", label: "Studio" },
  });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(native.invoke).toHaveBeenCalledWith("ai_openai_start", {
    scope: "one",
    connectionId: "work",
    label: "Studio",
  });
  wrapper.unmount();
});
test.each([
  "native.ai.secureStore.locked",
  "native.ai.browser.openFailed",
  "native.ai.storage.associationRequired",
])("preserves native recovery message %s", async (reason) => {
  native.invoke.mockRejectedValue(reason);
  const wrapper = mount(OpenAiBrowserLogin, { props: { scope: "one" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(`⟦${reason}⟧`);
  expect(wrapper.emitted("connected")).toBeUndefined();
  wrapper.unmount();
});
test("an unavailable native result reports its reason without claiming connection", async () => {
  native.invoke.mockImplementation(async (command) =>
    command === "ai_openai_start"
      ? "attempt"
      : {
          ...connected,
          available: false,
          reason: "native.ai.secureStore.missing",
        },
  );
  const wrapper = mount(OpenAiBrowserLogin, { props: { scope: "one" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "⟦native.ai.secureStore.missing⟧",
  );
  expect(wrapper.emitted("connected")).toBeUndefined();
  wrapper.unmount();
});
test("cancelAndWait remembers cancellation during admission and awaits native cleanup", async () => {
  const started = deferred<string>();
  const cancelled = deferred<void>();
  native.invoke.mockImplementation((command) =>
    command === "ai_openai_start" ? started.promise : cancelled.promise,
  );
  const wrapper = mount(OpenAiBrowserLogin, {
    props: { scope: "workspace-one" },
  });
  await wrapper.get("button").trigger("click");
  let finished = false;
  const cancellation = wrapper.vm.cancelAndWait().then(() => {
    finished = true;
  });
  started.resolve("pending-id");
  await flushPromises();
  expect(native.invoke).toHaveBeenCalledWith("ai_openai_cancel", {
    scope: "workspace-one",
    id: "pending-id",
  });
  expect(
    native.invoke.mock.calls.some(([command]) => command === "ai_openai_wait"),
  ).toBe(false);
  expect(finished).toBe(false);
  cancelled.resolve();
  await cancellation;
  expect(finished).toBe(true);
  expect(wrapper.emitted("connected")).toBeUndefined();
  wrapper.unmount();
});
test("unmount cancels a waiting attempt and suppresses a late successful completion", async () => {
  const saved = deferred<Status>();
  native.invoke.mockImplementation((command) =>
    command === "ai_openai_start"
      ? Promise.resolve("attempt")
      : command === "ai_openai_cancel"
        ? Promise.resolve()
        : saved.promise,
  );
  const wrapper = mount(OpenAiBrowserLogin, { props: { scope: "one" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  wrapper.unmount();
  await flushPromises();
  expect(native.invoke).toHaveBeenCalledWith("ai_openai_cancel", {
    scope: "one",
    id: "attempt",
  });
  saved.resolve(connected);
  await flushPromises();
  expect(wrapper.emitted("connected")).toBeUndefined();
});
test("changing scope cancels only the original scope and suppresses its result", async () => {
  const saved = deferred<Status>();
  native.invoke.mockImplementation((command) =>
    command === "ai_openai_start"
      ? Promise.resolve("attempt")
      : command === "ai_openai_cancel"
        ? Promise.resolve()
        : saved.promise,
  );
  const wrapper = mount(OpenAiBrowserLogin, { props: { scope: "one" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  await wrapper.setProps({ scope: "two" });
  await flushPromises();
  expect(native.invoke).toHaveBeenCalledWith("ai_openai_cancel", {
    scope: "one",
    id: "attempt",
  });
  saved.resolve(connected);
  await flushPromises();
  expect(wrapper.emitted("connected")).toBeUndefined();
  wrapper.unmount();
});
test("provider or storage failure never emits connected or renders raw errors; retry gets a new attempt", async () => {
  let starts = 0;
  native.invoke.mockImplementation((command) =>
    command === "ai_openai_start"
      ? Promise.resolve(`attempt-${++starts}`)
      : Promise.reject("secret-token https://auth.invalid/?state=private"),
  );
  const wrapper = mount(OpenAiBrowserLogin, { props: { scope: "one" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦ai.openaiSignInCouldNotFinishCheckYourConnection⟧",
  );
  expect(wrapper.text()).not.toContain("secret-token");
  expect(wrapper.text()).not.toContain("auth.invalid");
  expect(wrapper.emitted("connected")).toBeUndefined();
  expect(wrapper.get("button").text()).toBe("⟦ai.trySignInAgain⟧");
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(native.invoke).toHaveBeenCalledWith("ai_openai_wait", {
    scope: "one",
    id: "attempt-2",
  });
  wrapper.unmount();
});
test("an occupied callback port is explained without claiming connection or success", async () => {
  const message = "native.ai.login.portBusy";
  native.invoke.mockImplementation((command) =>
    command === "ai_openai_start"
      ? Promise.resolve("attempt")
      : Promise.reject(message),
  );
  const wrapper = mount(OpenAiBrowserLogin, { props: { scope: "one" } });
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "⟦native.ai.login.portBusy⟧",
  );
  expect(wrapper.emitted("connected")).toBeUndefined();
  wrapper.unmount();
});
