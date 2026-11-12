import {
  mount,
  flushPromises,
  enableAutoUnmount,
  type DOMWrapper,
} from "@vue/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AiConnections from "./AiConnections.vue";
import {
  forgetConnection,
  getStatus,
  listConnections,
  removeConnection,
  renameConnection,
  selectConnection,
  type Status,
} from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  forgetConnection: vi.fn(),
  getStatus: vi.fn(),
  listConnections: vi.fn(),
  removeConnection: vi.fn(),
  renameConnection: vi.fn(),
  selectConnection: vi.fn(),
}));
enableAutoUnmount(afterEach);
const first: Status = {
  config: {
    connectionId: "personal",
    label: "Personal",
    provider: "openai",
    endpoint: null,
  },
  available: true,
  reason: null,
  selectedModel: "gpt-4.1",
  modelError: null,
};
const second: Status = {
  ...first,
  config: {
    ...first.config!,
    connectionId: "work",
    label: "Work",
    auth: "oauth",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listConnections).mockResolvedValue([first, second]);
  vi.mocked(getStatus).mockResolvedValue(first);
  vi.mocked(selectConnection).mockResolvedValue(second);
  vi.mocked(forgetConnection).mockResolvedValue({
    ...second,
    available: false,
  });
  vi.mocked(renameConnection).mockResolvedValue(second);
  vi.mocked(removeConnection).mockResolvedValue();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
function button(wrapper: Pick<DOMWrapper<Element>, "findAll">, key: string) {
  return wrapper
    .findAll("button")
    .find((button) => button.text() === `⟦${key}⟧`)!;
}
test("same-provider connections have distinct rows and a separate chat connection selector", async () => {
  const wrapper = mount(AiConnections, { props: { scope: "garden" } });
  await flushPromises();
  expect(wrapper.findAll("li strong").map((item) => item.text())).toEqual([
    "Personal",
    "Work",
  ]);
  expect(wrapper.findAll("li select")).toHaveLength(0);
  expect(wrapper.text()).toContain("⟦ai.connections.deviceScope⟧");
  await wrapper.get("select").setValue("work");
  await flushPromises();
  expect(selectConnection).toHaveBeenCalledWith("garden", "work");
  expect(wrapper.emitted("changed")).toHaveLength(1);
});
test("manage shows authentication and destination and separates reconnect from forget", async () => {
  vi.mocked(listConnections).mockResolvedValue([
    {
      ...second,
      config: {
        ...second.config!,
        provider: "custom",
        endpoint: "https://work.example.invalid/v1",
        auth: "api_key",
      },
    },
  ]);
  const wrapper = mount(AiConnections, { props: { scope: "garden" } });
  await flushPromises();
  await button(wrapper.findAll("li")[0], "ai.connections.manage").trigger(
    "click",
  );
  expect(wrapper.get("dialog").text()).toContain(
    "https://work.example.invalid/v1",
  );
  expect(wrapper.get("dialog").text()).toContain("⟦ai.apiKeyMethod⟧");
  expect(
    button(wrapper.get("dialog"), "ai.connections.reconnect"),
  ).toBeDefined();
  expect(button(wrapper.get("dialog"), "ai.connections.forget")).toBeDefined();
  expect(forgetConnection).not.toHaveBeenCalled();
});
test.each(["forget", "remove"] as const)(
  "%s confirms only the addressed connection",
  async (action) => {
    const wrapper = mount(AiConnections, { props: { scope: "garden" } });
    await flushPromises();
    await button(
      wrapper.findAll("li")[1],
      action === "forget"
        ? "ai.connections.manage"
        : "ai.connections.disconnect",
    ).trigger("click");
    if (action === "forget")
      await button(wrapper.get("dialog"), "ai.connections.forget").trigger(
        "click",
      );
    expect(wrapper.get<HTMLDialogElement>("dialog").element.open).toBe(true);
    expect(wrapper.get("dialog").text()).toContain(
      `⟦ai.connections.${action}Effect⟧`,
    );
    expect(forgetConnection).not.toHaveBeenCalled();
    expect(removeConnection).not.toHaveBeenCalled();
    await wrapper.get("dialog form").trigger("submit");
    await flushPromises();
    expect(
      action === "forget" ? forgetConnection : removeConnection,
    ).toHaveBeenCalledWith("garden", "work");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  },
);
test("rename rejects empty and duplicate names, submits the stable identity and restores focus on Escape", async () => {
  const wrapper = mount(AiConnections, {
    props: { scope: "garden" },
    attachTo: document.body,
  });
  await flushPromises();
  const trigger = button(wrapper.findAll("li")[1], "ai.connections.rename");
  await trigger.trigger("click");
  for (const invalid of ["", " personal "]) {
    await wrapper.get("dialog input").setValue(invalid);
    await wrapper.get("dialog form").trigger("submit");
    expect(wrapper.get("dialog input").attributes("aria-invalid")).toBe("true");
    expect(renameConnection).not.toHaveBeenCalled();
  }
  await wrapper.get("dialog input").setValue("Studio");
  await wrapper.get("dialog form").trigger("submit");
  await flushPromises();
  expect(renameConnection).toHaveBeenCalledWith("garden", "work", "Studio");
  await trigger.trigger("click");
  await wrapper.get("dialog").trigger("cancel");
  expect(document.activeElement).toBe(trigger.element);
});
test("a fresh device offers ordinary setup without move, copy or association actions", async () => {
  vi.mocked(listConnections).mockResolvedValue([]);
  vi.mocked(getStatus).mockResolvedValue({
    ...first,
    config: null,
    available: false,
    selectedModel: null,
  });
  const wrapper = mount(AiConnections, { props: { scope: "fresh-device" } });
  await flushPromises();
  expect(wrapper.text()).toContain("⟦ai.connections.empty⟧");
  expect(wrapper.text()).not.toContain("⟦ai.connections.move⟧");
  expect(wrapper.text()).not.toContain("⟦ai.connections.fork⟧");
  expect(
    button(wrapper, "ai.connections.add").attributes("disabled"),
  ).toBeUndefined();
});
test("failed selection retains current identity and list without emitting success", async () => {
  vi.mocked(selectConnection).mockRejectedValue("native.ai.storage.busy");
  const wrapper = mount(AiConnections, { props: { scope: "garden" } });
  await flushPromises();
  await wrapper.get("select").setValue("work");
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦native.ai.storage.busy⟧",
  );
  expect(wrapper.get<HTMLSelectElement>("select").element.value).toBe(
    "personal",
  );
  expect(wrapper.findAll("li")).toHaveLength(2);
  expect(wrapper.emitted("changed")).toBeUndefined();
});
