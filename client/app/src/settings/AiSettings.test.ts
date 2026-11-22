import { chooseSelect } from "../ui/select-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { invoke } from "@tauri-apps/api/core";
import {
  getStatus,
  loadModelCatalog,
  refreshModels,
  type Status,
} from "../ai/api";
import * as modelCatalog from "../ai/model-catalog";
import { refreshWorkspaceChats, workspaceChatActivity } from "../ai/chat";
import AiConnections from "../ai/AiConnections.vue";
import { defaultAiSettings, workspaceAiSettings } from "../ai/settings";
import AiSettings from "./AiSettings.vue";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const refreshChat = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../ai/chat", () => ({
  refreshWorkspaceChats: refreshChat,
  workspaceChatActivity: vi.fn(() => ({
    running: false,
    selectingModel: false,
  })),
}));
vi.mock("../ai/api", async (original) => ({
  ...(await original<typeof import("../ai/api")>()),
  getStatus: vi.fn(),
  refreshModels: vi.fn(),
  loadModelCatalog: vi.fn(),
  listConnections: vi.fn().mockResolvedValue([]),
}));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.mocked(refreshModels).mockReset();
  vi.mocked(workspaceChatActivity)
    .mockReset()
    .mockReturnValue({ running: false, selectingModel: false });
  refreshChat.mockReset().mockResolvedValue();
  vi.mocked(refreshWorkspaceChats).mockClear();
  vi.mocked(loadModelCatalog).mockReset().mockResolvedValue(modelCatalog);
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  vi.mocked(invoke).mockReset().mockResolvedValue(defaultAiSettings());
  vi.mocked(getStatus)
    .mockReset()
    .mockResolvedValue({
      config: { provider: "openai", endpoint: null },
      available: true,
      reason: null,
      selectedModel: null,
      modelError: null,
    });
});
test("without an open workspace settings stay disabled and do not read storage", async () => {
  const wrapper = mount(AiSettings);
  await flushPromises();
  expect(wrapper.get("#settings-inline").attributes("disabled")).toBeDefined();
  expect(invoke).not.toHaveBeenCalled();
  expect(getStatus).not.toHaveBeenCalled();
});
test("inline selection defaults hidden while comments stay enabled", async () => {
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "ui-defaults" },
  });
  await flushPromises();
  expect(
    wrapper.get<HTMLInputElement>("#settings-inline").element.checked,
  ).toBe(false);
  expect(
    wrapper.get<HTMLInputElement>("#settings-generated").element.checked,
  ).toBe(true);
});
test.each(["showInlineModel", "generatedComments"] as const)(
  "%s switch keeps the saved value when persistence fails",
  async (setting) => {
    const wrapper = mount(AiSettings, {
      props: { workspaceScope: `switch-failure-${setting}` },
    });
    await flushPromises();
    const selector =
      setting === "showInlineModel"
        ? "#settings-inline"
        : "#settings-generated";
    const control = wrapper.get<HTMLInputElement>(selector);
    expect(control.attributes("role")).toBe("switch");
    const saved = control.element.checked;
    vi.mocked(invoke).mockRejectedValueOnce("native.ai.storage.busy");
    await control.setValue(!saved);
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith(
      "ai_settings_save",
      expect.objectContaining({
        settings: expect.objectContaining({ [setting]: !saved }),
      }),
    );
    expect(control.element.checked).toBe(saved);
    expect(wrapper.find(".settings-error[role=alert]").exists()).toBe(true);
    expect(wrapper.emitted("saved")).toBeUndefined();
  },
);

test("custom chat and comment model hints localize their selected identities", async () => {
  vi.mocked(getStatus).mockResolvedValue({
    config: { provider: "custom", endpoint: "https://example.com/v1" },
    catalog: { source: "manual", models: [] },
    available: true,
    reason: null,
    selectedModel: null,
    modelError: null,
  });
  vi.mocked(invoke).mockResolvedValue({
    ...defaultAiSettings(),
    chat: { model: "chat-model", thinking: "off", catalogRevision: null },
    comment: { model: "comment-model", thinking: "off", catalogRevision: null },
  });
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "ui-custom-models" },
  });
  await flushPromises();
  expect(wrapper.get("#settings-chat-model").attributes("placeholder")).toBe(
    '⟦model.selectedLabel:{"name":"chat-model"}⟧',
  );
  expect(wrapper.get("#settings-comment-model").attributes("placeholder")).toBe(
    '⟦model.selectedLabel:{"name":"comment-model"}⟧',
  );
  vi.mocked(invoke).mockResolvedValue(defaultAiSettings());
  await wrapper.setProps({ workspaceScope: "ui-custom-empty" });
  await flushPromises();
  expect(wrapper.get("#settings-chat-model").attributes("placeholder")).toBe(
    "⟦ai.modelID⟧",
  );
  expect(wrapper.get("#settings-comment-model").attributes("placeholder")).toBe(
    "⟦ai.modelID⟧",
  );
});
test("an unresolved recommendation remains the saved preference instead of an empty selection", async () => {
  vi.mocked(getStatus).mockResolvedValue({
    config: {
      provider: "openai",
      endpoint: null,
      connectionId: "empty-catalog",
    },
    available: true,
    reason: null,
    selectedModel: null,
    modelError: "native.ai.model.required",
    catalog: { source: "account", models: [] },
  });
  vi.mocked(invoke).mockResolvedValue({
    ...defaultAiSettings(),
    chat: {
      model: "recommended",
      thinking: "recommended",
      catalogRevision: null,
    },
    comment: {
      model: "recommended",
      thinking: "recommended",
      catalogRevision: null,
    },
  });
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "unresolved-default" },
  });
  await flushPromises();
  for (const id of ["settings-chat-model", "settings-comment-model"]) {
    expect(
      wrapper.get<HTMLButtonElement>(`#${id}`).attributes("data-value"),
    ).toBe("recommended");
    expect(
      wrapper
        .get(`#${id} + select option[value="recommended"]`)
        .attributes("disabled"),
    ).toBeDefined();
  }
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "ai_settings_save"),
  ).toBe(false);
});

test("a custom connection does not present Recommended as a server model ID", async () => {
  vi.mocked(getStatus).mockResolvedValue({
    config: { provider: "custom", endpoint: "http://localhost:8888/v1" },
    catalog: { source: "manual", models: [] },
    available: true,
    reason: null,
    selectedModel: null,
    modelError: "native.ai.model.required",
  });
  vi.mocked(invoke).mockResolvedValue({
    ...defaultAiSettings(),
    chat: {
      model: "recommended",
      thinking: "recommended",
      catalogRevision: null,
    },
    comment: {
      model: "recommended",
      thinking: "recommended",
      catalogRevision: null,
    },
  });
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "custom-recommended" },
  });
  await flushPromises();
  expect(wrapper.get("#settings-chat-model").attributes("placeholder")).toBe(
    "⟦ai.modelID⟧",
  );
  expect(wrapper.get("#settings-comment-model").attributes("placeholder")).toBe(
    "⟦ai.modelID⟧",
  );
});

test.each(["provider", "unknown", "manual"] as const)(
  "a custom connection uses its reported models and permits manual IDs only without discovery (%s)",
  async (source) => {
    vi.mocked(getStatus).mockResolvedValue({
      config: { provider: "custom", endpoint: "https://example.com/v1" },
      available: true,
      reason: null,
      selectedModel: null,
      modelError: null,
      catalog: { source, models: source === "provider" ? ["server/chat"] : [] },
    });
    vi.mocked(invoke).mockResolvedValue(defaultAiSettings());
    const wrapper = mount(AiSettings, {
      props: { workspaceScope: "custom-models" },
    });
    await flushPromises();
    expect(wrapper.find("input#settings-chat-model").exists()).toBe(
      source === "manual",
    );
    expect(
      wrapper
        .find('#settings-chat-model + select option[value="server/chat"]')
        .exists(),
    ).toBe(source === "provider");
    expect(
      wrapper
        .find('#settings-chat-model + select option[value="recommended"]')
        .exists(),
    ).toBe(false);
  },
);

test("stale account choices allow unrelated toggles and one-model-at-a-time repair", async () => {
  const saved = {
    ...defaultAiSettings(),
    chat: {
      model: "openai/gpt-5.4",
      thinking: "off" as const,
      catalogRevision: null,
    },
    comment: {
      model: "openai/gpt-4o-mini",
      thinking: "off" as const,
      catalogRevision: null,
    },
  };
  vi.mocked(getStatus).mockResolvedValue({
    config: { provider: "openrouter", endpoint: null },
    available: true,
    reason: null,
    selectedModel: saved.chat.model,
    modelError: "native.ai.model.savedUnavailable",
    catalog: { source: "account", models: ["openai/gpt-6.1-sol"] },
  });
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "ai_settings_save"
      ? (args as { settings: unknown }).settings
      : saved,
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "stale-choice-repair" },
  });
  await flushPromises();
  await wrapper.get("#settings-inline").setValue(true);
  await flushPromises();
  expect(invoke).toHaveBeenLastCalledWith("ai_settings_save", {
    scope: "stale-choice-repair",
    settings: { ...saved, showInlineModel: true },
  });
  await chooseSelect(wrapper, "#settings-chat-model", "openai/gpt-6.1-sol");
  await flushPromises();
  expect(
    workspaceAiSettings("stale-choice-repair").state.settings,
  ).toMatchObject({
    showInlineModel: true,
    chat: { model: "openai/gpt-6.1-sol" },
    comment: saved.comment,
  });
  await chooseSelect(wrapper, "#settings-comment-model", "openai/gpt-6.1-sol");
  await flushPromises();
  expect(
    workspaceAiSettings("stale-choice-repair").state.settings,
  ).toMatchObject({
    showInlineModel: true,
    chat: { model: "openai/gpt-6.1-sol" },
    comment: { model: "openai/gpt-6.1-sol" },
  });
});
test("comment selection persists separately with lowest verified effort", async () => {
  const saved = {
    ...defaultAiSettings(),
    chat: {
      model: "gpt-6.1-sol",
      thinking: "high" as const,
      catalogRevision: null,
    },
  };
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "ai_settings_save"
      ? (args as { settings: unknown }).settings
      : saved,
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "ui-comments" },
  });
  await flushPromises();
  await vi.waitFor(() =>
    expect(
      wrapper
        .findAll("#settings-comment-model + select option")
        .some((option) => option.attributes("value") === "gpt-6.1-sol"),
    ).toBe(true),
  );
  await chooseSelect(wrapper, "#settings-comment-model", "gpt-6.1-sol");
  await flushPromises();
  expect(workspaceAiSettings("ui-comments").state.settings).toMatchObject({
    chat: { model: "gpt-6.1-sol", thinking: "high" },
    comment: { model: "gpt-6.1-sol", thinking: "low" },
  });
});
test("recommendation options wait for the loaded catalog and selection uses only its models", async () => {
  let finish!: (value: typeof modelCatalog) => void;
  vi.mocked(loadModelCatalog).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saved = {
    ...defaultAiSettings(),
    chat: {
      model: "gpt-6.1-sol",
      thinking: "high" as const,
      catalogRevision: null,
    },
  };
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "ai_settings_save"
      ? (args as { settings: unknown }).settings
      : saved,
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "ui-ranked-static" },
  });
  await flushPromises();
  expect(
    wrapper.findAll(
      '#settings-chat-model + select option[value="recommended"], #settings-comment-model + select option[value="recommended"]',
    ),
  ).toHaveLength(0);
  const mini = modelCatalog
    .availableChatModels({ provider: "openai", endpoint: null })
    .filter((model) => model.id === "gpt-4o-mini");
  expect(mini).toHaveLength(1);
  finish({ ...modelCatalog, availableChatModels: () => mini });
  await flushPromises();
  expect(
    wrapper.findAll(
      '#settings-chat-model + select option[value="recommended"], #settings-comment-model + select option[value="recommended"]',
    ),
  ).toHaveLength(2);
  expect(wrapper.get("#settings-chat-model").attributes("data-value")).toBe(
    "gpt-6.1-sol",
  );
  await chooseSelect(wrapper, "#settings-comment-model", "recommended");
  await flushPromises();
  expect(workspaceAiSettings("ui-ranked-static").state.settings).toMatchObject({
    chat: { model: "gpt-6.1-sol", thinking: "high" },
    comment: { model: "recommended", thinking: "recommended" },
  });
  await chooseSelect(wrapper, "#settings-chat-model", "recommended");
  await flushPromises();
  expect(
    workspaceAiSettings("ui-ranked-static").state.settings?.chat,
  ).toMatchObject({ model: "recommended", thinking: "recommended" });
});
test.each(["failed", "empty"])(
  "a %s model catalog offers no recommendation",
  async (state) => {
    if (state === "failed")
      vi.mocked(loadModelCatalog).mockRejectedValue(
        new Error("Catalog unavailable"),
      );
    else
      vi.mocked(loadModelCatalog).mockResolvedValue({
        ...modelCatalog,
        availableChatModels: () => [],
      });
    const wrapper = mount(AiSettings, {
      props: { workspaceScope: `ui-ranked-${state}` },
    });
    await flushPromises();
    expect(
      wrapper.findAll(
        '#settings-chat-model + select option[value="recommended"], #settings-comment-model + select option[value="recommended"]',
      ),
    ).toHaveLength(0);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "ai_settings_save"),
    ).toHaveLength(0);
  },
);
test("an unmounted workspace settings view cannot emit completion from a pending save", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "ai_settings_save"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : defaultAiSettings(),
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "ui-unmounted-save" },
  });
  await flushPromises();
  await wrapper.get("#settings-inline").setValue(true);
  wrapper.unmount();
  finish({ ...defaultAiSettings(), showInlineModel: true });
  await flushPromises();
  expect(wrapper.emitted("saved")).toBeUndefined();
});
test.each(["unmount", "switch"])(
  "connection refresh cannot emit stale settings after %s during chat refresh",
  async (action) => {
    let finish!: () => void;
    refreshChat.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(AiSettings, {
      props: { workspaceScope: `ui-chat-refresh-${action}` },
    });
    await vi.waitFor(() =>
      expect(wrapper.findComponent(AiConnections).exists()).toBe(true),
    );
    await flushPromises();
    wrapper.getComponent(AiConnections).vm.$emit("changed");
    await flushPromises();
    expect(refreshWorkspaceChats).toHaveBeenCalledWith(
      `ui-chat-refresh-${action}`,
    );
    if (action === "unmount") wrapper.unmount();
    else await wrapper.setProps({ workspaceScope: "ui-chat-refresh-new" });
    finish();
    await flushPromises();
    expect(wrapper.emitted("saved")).toBeUndefined();
  },
);
test.each(["account", "provider"] as const)(
  "%s catalog filters recommendations without overwriting a saved model",
  async (source) => {
    const state: Status = {
      config: { provider: "openai", endpoint: null, connectionId: "work" },
      available: true,
      selectedModel: "gpt-6.1-sol",
      modelError: null,
      reason: null,
      catalog: { source, models: ["gpt-4o-mini"] },
    };
    vi.mocked(getStatus).mockResolvedValue(state);
    const saved = {
      ...defaultAiSettings(),
      chat: {
        model: "gpt-6.1-sol",
        thinking: "high" as const,
        catalogRevision: null,
      },
    };
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === "ai_settings_save"
        ? (args as { settings: unknown }).settings
        : saved,
    );
    const wrapper = mount(AiSettings, {
      props: { workspaceScope: `discovery-${source}` },
    });
    await flushPromises();
    expect(
      wrapper
        .get<HTMLButtonElement>("#settings-chat-model")
        .attributes("data-value"),
    ).toBe("gpt-6.1-sol");
    expect(
      wrapper.get("#settings-chat-model").attributes("disabled"),
    ).toBeUndefined();
    expect(
      wrapper.findAll('#settings-chat-model + select option[value="gpt-5.4"]'),
    ).toHaveLength(0);
    expect(wrapper.get(".model-discovery").text()).toBe(
      "⟦settings.ai.modelList⟧⟦ai.models.refresh⟧",
    );
    await chooseSelect(wrapper, "#settings-comment-model", "recommended");
    await flushPromises();
    expect(
      workspaceAiSettings(`discovery-${source}`, "work").state.settings,
    ).toMatchObject({
      chat: { model: "gpt-6.1-sol", thinking: "high" },
      comment: { model: "recommended", thinking: "recommended" },
    });
  },
);
test("explicit refresh failure keeps the saved model but offers no unobserved models", async () => {
  const initial: Status = {
    config: { provider: "openai", endpoint: null, connectionId: "work" },
    available: true,
    selectedModel: "gpt-6.1-sol",
    modelError: null,
    reason: null,
    catalog: { source: "account", models: ["gpt-6.1-sol"] },
  };
  vi.mocked(getStatus).mockResolvedValue(initial);
  const saved = {
    ...defaultAiSettings(),
    chat: {
      model: "gpt-6.1-sol",
      thinking: "high" as const,
      catalogRevision: null,
    },
  };
  vi.mocked(invoke).mockResolvedValue(saved);
  vi.mocked(refreshModels)
    .mockResolvedValueOnce({
      ...initial,
      catalog: { source: "unknown", models: [] },
    })
    .mockResolvedValueOnce({
      ...initial,
      catalog: { source: "provider", models: ["gpt-4o-mini"] },
    });
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "discovery-refresh" },
  });
  await flushPromises();
  await wrapper.get(".model-discovery button").trigger("click");
  await flushPromises();
  expect(refreshModels).toHaveBeenCalledWith("discovery-refresh", "work");
  expect(wrapper.get(".model-discovery [role=alert]").text()).toBe(
    "⟦ai.models.lookupFailed⟧",
  );
  expect(
    wrapper.findAll(
      '#settings-chat-model + select option[value="recommended"], #settings-comment-model + select option[value="recommended"]',
    ),
  ).toHaveLength(0);
  expect(
    wrapper.get("#settings-chat-model").attributes("disabled"),
  ).toBeUndefined();
  expect(
    wrapper
      .find('#settings-chat-model + select option[value="gpt-5.4"]')
      .exists(),
  ).toBe(false);
  await wrapper.get(".model-discovery button").trigger("click");
  await flushPromises();
  expect(wrapper.find(".model-discovery [role=alert]").exists()).toBe(false);
  expect(
    wrapper
      .find('#settings-chat-model + select option[value="gpt-5.4"]')
      .exists(),
  ).toBe(false);
  expect(
    wrapper
      .get<HTMLButtonElement>("#settings-chat-model")
      .attributes("data-value"),
  ).toBe("gpt-6.1-sol");
  expect(refreshChat).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([command]) => command === "ai_settings_save"),
  ).toBe(false);
});
test.each(["native.ai.storage.busy", "native.ai.catalog.connectionChanged"])(
  "empty discovery has no recommendation and %s retains the previous selection",
  async (reason) => {
    vi.mocked(getStatus).mockResolvedValue({
      config: { provider: "openai", endpoint: null },
      available: true,
      selectedModel: "gpt-5.4",
      reason: null,
      modelError: null,
      catalog: { source: "provider", models: [] },
    });
    vi.mocked(refreshModels).mockRejectedValue(reason);
    vi.mocked(invoke).mockResolvedValue({
      ...defaultAiSettings(),
      chat: { model: "gpt-5.4", thinking: "off", catalogRevision: null },
      comment: { model: "gpt-4o-mini", thinking: "off", catalogRevision: null },
    });
    const wrapper = mount(AiSettings, {
      props: { workspaceScope: "discovery-empty" },
    });
    await flushPromises();
    expect(
      wrapper.findAll(
        '#settings-chat-model + select option[value="recommended"], #settings-comment-model + select option[value="recommended"]',
      ),
    ).toHaveLength(0);
    expect(wrapper.text()).toContain("⟦ai.models.empty⟧");
    await wrapper.get(".model-discovery button").trigger("click");
    await flushPromises();
    expect(wrapper.get("dialog[open] [role=alert]").text()).toBe(`⟦${reason}⟧`);
    expect(
      wrapper
        .get<HTMLButtonElement>("#settings-chat-model")
        .attributes("data-value"),
    ).toBe("gpt-5.4");
    expect(
      wrapper
        .get<HTMLButtonElement>("#settings-comment-model")
        .attributes("data-value"),
    ).toBe("gpt-4o-mini");
    expect(refreshChat).not.toHaveBeenCalled();
  },
);
test("a late model refresh cannot replace another workspace's catalog", async () => {
  const initial: Status = {
    config: { provider: "openai", endpoint: null, connectionId: "one" },
    available: true,
    selectedModel: null,
    modelError: null,
    reason: null,
    catalog: { source: "unknown", models: [] },
  };
  vi.mocked(getStatus).mockResolvedValue(initial);
  let finish!: (value: Status) => void;
  vi.mocked(refreshModels).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "discovery-before-switch" },
  });
  await flushPromises();
  await wrapper.get(".model-discovery button").trigger("click");
  vi.mocked(getStatus).mockResolvedValue({
    ...initial,
    config: { ...initial.config!, connectionId: "two" },
    catalog: { source: "account", models: ["gpt-6.1-sol"] },
  });
  await wrapper.setProps({ workspaceScope: "discovery-after-switch" });
  await flushPromises();
  finish({
    ...initial,
    catalog: { source: "account", models: ["gpt-4o-mini"] },
  });
  await flushPromises();
  expect(
    wrapper
      .find('#settings-chat-model + select option[value="gpt-4o-mini"]')
      .exists(),
  ).toBe(false);
  expect(
    wrapper
      .find('#settings-chat-model + select option[value="gpt-6.1-sol"]')
      .exists(),
  ).toBe(true);
  expect(
    wrapper.get(".model-discovery button").attributes("disabled"),
  ).toBeUndefined();
  expect(refreshChat).not.toHaveBeenCalled();
});
test("model refresh can update the catalog while a response is running", async () => {
  vi.mocked(workspaceChatActivity).mockReturnValue({
    running: true,
    selectingModel: false,
  });
  const initial: Status = {
    config: { provider: "openai", endpoint: null, connectionId: "work" },
    available: true,
    selectedModel: null,
    modelError: null,
    reason: null,
    catalog: { source: "account", models: ["gpt-4o-mini"] },
  };
  vi.mocked(getStatus).mockResolvedValue(initial);
  vi.mocked(refreshModels).mockResolvedValue({
    ...initial,
    catalog: { source: "account", models: ["gpt-6.1-sol"] },
  });
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "discovery-running" },
  });
  await flushPromises();
  const button = wrapper.get<HTMLButtonElement>(".model-discovery button");
  expect(button.element.disabled).toBe(false);
  await button.trigger("click");
  await flushPromises();
  expect(refreshModels).toHaveBeenCalledWith("discovery-running", "work");
  expect(
    wrapper
      .find('#settings-chat-model + select option[value="gpt-6.1-sol"]')
      .exists(),
  ).toBe(true);
});
test("a stale save in the previous workspace never emits a saved event into the next", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "ai_settings_save"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : defaultAiSettings(),
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "ui-stale-a" },
  });
  await flushPromises();
  await wrapper.get("#settings-inline").setValue(true);
  await wrapper.setProps({ workspaceScope: "ui-stale-b" });
  await flushPromises();
  finish({ ...defaultAiSettings(), showInlineModel: true });
  await flushPromises();
  expect(wrapper.emitted("saved")).toBeUndefined();
  expect(
    wrapper.get<HTMLInputElement>("#settings-inline").element.checked,
  ).toBe(false);
});

test("recommendations show the current models and thinking without replacing saved preferences", async () => {
  const saved = {
    ...defaultAiSettings(),
    chat: {
      model: "recommended",
      thinking: "recommended" as const,
      catalogRevision: null,
    },
  };
  vi.mocked(getStatus).mockResolvedValue({
    config: { provider: "openai", endpoint: null },
    available: true,
    reason: null,
    selectedModel: "gpt-6.1-sol",
    modelError: null,
    modelInherited: true,
    catalog: { source: "account", models: ["gpt-6.1-sol", "gpt-4o-mini"] },
  });
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "ai_settings_save"
      ? (args as { settings: unknown }).settings
      : saved,
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "recommended-thinking" },
  });
  await flushPromises();
  expect(
    wrapper.get("#settings-thinking").attributes("disabled"),
  ).toBeUndefined();
  expect(
    wrapper
      .get<HTMLButtonElement>("#settings-chat-model")
      .attributes("data-value"),
  ).toBe("recommended");
  expect(wrapper.get("#settings-chat-model").text()).toBe(
    '⟦settings.ai.recommendedWithValue:{"value":"GPT-6.1 Sol"}⟧',
  );
  expect(wrapper.get("#settings-thinking").text()).toBe(
    String.raw`⟦settings.ai.recommendedWithValue:{"value":"\u27e6settings.ai.thinking.medium\u27e7"}⟧`,
  );
  expect(
    wrapper
      .get('#settings-comment-model + select option[value="recommended"]')
      .text(),
  ).toBe('⟦settings.ai.recommendedWithValue:{"value":"GPT-4o mini"}⟧');
  await chooseSelect(wrapper, "#settings-thinking", "high");
  await flushPromises();
  expect(
    workspaceAiSettings("recommended-thinking").state.settings?.chat,
  ).toEqual({
    model: "recommended",
    thinking: "high",
    catalogRevision: null,
  });
  expect(refreshWorkspaceChats).toHaveBeenCalledWith("recommended-thinking");
});
test("a discovered GPT-6.2 Sol offers verified efforts and displays a legacy Off as Recommended", async () => {
  const model = "gpt-6.2-sol";
  const settings = {
    ...defaultAiSettings(),
    chat: { model, thinking: "off", catalogRevision: null },
  };
  vi.mocked(getStatus).mockResolvedValue({
    config: { provider: "openai", endpoint: null, auth: "oauth" },
    available: true,
    reason: null,
    selectedModel: model,
    modelError: null,
    catalog: {
      source: "account",
      models: [model],
      selectable: [
        {
          id: model,
          contextWindow: 1_050_000,
          maxTokens: 128_000,
          thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
        },
      ],
    },
  });
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "ai_settings_save"
      ? (args as { settings: unknown }).settings
      : settings,
  );
  const wrapper = mount(AiSettings, {
    props: { workspaceScope: "discovered-thinking" },
  });
  await flushPromises();
  const thinking = wrapper.get<HTMLButtonElement>("#settings-thinking");
  expect(thinking.element.disabled).toBe(false);
  expect(thinking.attributes("data-value")).toBe("recommended");
  expect(
    wrapper
      .findAll("#settings-thinking + select option")
      .map((option) => option.attributes("value")),
  ).toEqual(["recommended", "low", "medium", "high", "xhigh", "max"]);
  await chooseSelect(wrapper, "#settings-thinking", "max");
  await flushPromises();
  expect(
    workspaceAiSettings("discovered-thinking").state.settings?.chat?.thinking,
  ).toBe("max");
});

test.each(["unsupported", "unknown", "noAccess"] as const)(
  "thinking remains visible and explains %s controls",
  async (state) => {
    vi.mocked(getStatus).mockResolvedValue({
      config: {
        provider: state === "unknown" ? "custom" : "openai",
        endpoint:
          state === "unknown" ? "https://local.example.invalid/v1" : null,
      },
      available: state !== "noAccess",
      reason: null,
      selectedModel: "gpt-4o-mini",
      modelError: null,
    });
    vi.mocked(invoke).mockResolvedValue({
      ...defaultAiSettings(),
      chat: {
        model: "gpt-4o-mini",
        thinking: "recommended",
        catalogRevision: null,
      },
    });
    const wrapper = mount(AiSettings, {
      props: { workspaceScope: `thinking-${state}` },
    });
    await flushPromises();
    expect(
      wrapper.get("#settings-thinking").attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.get("#settings-thinking").attributes("aria-describedby"),
    ).toBe("thinking-unavailable");
    expect(wrapper.get("#thinking-unavailable").text()).toBe(
      `⟦settings.ai.thinking.${state}⟧`,
    );
  },
);
