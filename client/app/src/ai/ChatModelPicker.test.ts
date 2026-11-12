import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  DOMWrapper,
} from "@vue/test-utils";
import ChatModelPicker from "./ChatModelPicker.vue";
import { getStatus, loadModelCatalog, refreshModels, type Status } from "./api";
import { invoke } from "@tauri-apps/api/core";
import { defaultAiSettings, workspaceAiSettings } from "./settings";
import * as catalog from "./model-catalog";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getStatus: vi.fn(),
  loadModelCatalog: vi.fn(),
  refreshModels: vi.fn(),
}));
enableAutoUnmount(afterEach);
const status: Status = {
  config: {
    provider: "openai",
    endpoint: null,
    connectionId: "personal",
    label: "Personal",
  },
  available: true,
  reason: null,
  selectedModel: "gpt-4o-mini",
  modelError: null,
  modelInherited: true,
};
const selectModel = vi.fn(),
  selectThinking = vi.fn();
const props = () => ({
  status,
  saving: false,
  running: false,
  unsaved: false,
  selectModel,
  selectThinking,
});
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(defaultAiSettings());
  vi.mocked(getStatus).mockReset().mockResolvedValue(status);
  vi.mocked(refreshModels).mockReset();
  vi.mocked(loadModelCatalog).mockReset().mockResolvedValue(catalog);
  selectModel.mockReset().mockResolvedValue(true);
  selectThinking.mockReset().mockResolvedValue(true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => document.body.replaceChildren());
function menu() {
  const opened = [...document.querySelectorAll('[role="menu"]')].filter(
    (element) => element.matches(":popover-open"),
  );
  expect(opened).toHaveLength(1);
  return new DOMWrapper(opened[0]!);
}
async function openMenu(
  wrapper: ReturnType<typeof mount>,
  index = 0,
  key?: string,
) {
  const trigger = wrapper.findAll<HTMLButtonElement>('[aria-haspopup="menu"]')[
    index
  ]!;
  vi.spyOn(trigger.element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 20, 180, 44),
  );
  if (key) await trigger.trigger("keydown", { key });
  else await trigger.trigger("click");
  await flushPromises();
  expect(trigger.attributes("aria-expanded")).toBe("true");
  return trigger;
}
async function choose(
  wrapper: ReturnType<typeof mount>,
  value: string,
  index = 0,
) {
  await openMenu(wrapper, index);
  await menu().get(`[data-choice="${value}"]`).trigger("click");
  await flushPromises();
}
test("field presentation uses the standard select with the same model choices and disabled state", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      allowInheritance: false,
      appearance: "field",
      label: "Setup model",
    },
  });
  await flushPromises();
  const control = wrapper.get('[role="combobox"]');
  expect(control.classes()).toContain("situate-select-trigger");
  expect(control.attributes("aria-label")).toBe("Setup model");
  const select = wrapper.get("select");
  expect(select.find('option[value=""]').exists()).toBe(false);
  expect(select.find('option[value="recommended"]').exists()).toBe(true);
  await select.setValue("gpt-4o-mini");
  await flushPromises();
  expect(selectModel).toHaveBeenCalledWith("gpt-4o-mini");
  await wrapper.setProps({ saving: true });
  expect(control.attributes("disabled")).toBeDefined();
});
test("workspace model selection omits conversation inheritance", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: { ...props(), allowInheritance: false },
  });
  await flushPromises();
  await openMenu(wrapper);
  expect(menu().find('[data-choice=""]').exists()).toBe(false);
  await menu().get('[data-choice="gpt-4o-mini"]').trigger("click");
  await flushPromises();
  expect(selectModel).toHaveBeenCalledExactlyOnceWith("gpt-4o-mini");
});
test.each([375, 1280])(
  "at %ipx the anchored menu supports keyboard navigation, Escape and inherited reset",
  async (width) => {
    vi.stubGlobal("innerWidth", width);
    const wrapper = mount(ChatModelPicker, {
      attachTo: document.body,
      props: props(),
    });
    await flushPromises();
    const trigger = wrapper.get<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(trigger.attributes("aria-description")).toContain("gpt-4o-mini");
    await openMenu(wrapper, 0, "ArrowDown");
    expect(menu().get('[data-choice=""]').attributes("aria-checked")).toBe(
      "true",
    );
    expect(menu().get('[data-choice=""] small').text()).toBe(
      "Personal · openai · gpt-4o-mini",
    );
    expect(menu().find(".choice-description").exists()).toBe(false);
    expect(menu().attributes("aria-label")).toBe("⟦ai.model⟧");
    await menu().trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(
      menu().findAll("button").at(-1)!.element,
    );
    await menu().trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(menu().findAll("button")[0].element);
    await menu().trigger("keydown", { key: "Escape" });
    expect(
      [...document.querySelectorAll('[role="menu"]')].some((element) =>
        element.matches(":popover-open"),
      ),
    ).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    expect(selectModel).not.toHaveBeenCalled();
    await choose(wrapper, "");
    expect(selectModel).toHaveBeenCalledWith(null);
    expect(wrapper.emitted("focus-draft")).toHaveLength(1);
    vi.unstubAllGlobals();
  },
);
test.each(["gpt-4.1", "recommended"])(
  "workspace default details ignore the conversation's %s override and connection",
  async (preference) => {
    vi.mocked(getStatus).mockResolvedValue({
      ...status,
      config: {
        provider: "anthropic",
        endpoint: null,
        label: "Work",
        connectionId: "work",
      },
      selectedModel: "claude-sonnet-4-6",
      modelPreference: "recommended",
    });
    const wrapper = mount(ChatModelPicker, {
      attachTo: document.body,
      props: {
        ...props(),
        workspaceScope: `default-details-${preference}`,
        status: {
          ...status,
          modelInherited: false,
          modelPreference: preference,
          selectedModel: "gpt-4.1",
        },
      },
    });
    await flushPromises();
    await openMenu(wrapper);
    expect(getStatus).toHaveBeenCalledWith(`default-details-${preference}`);
    expect(menu().get('[data-choice=""] small').text()).toBe(
      "Work · anthropic · claude-sonnet-4-6",
    );
    expect(menu().get('[data-choice=""]').attributes("aria-checked")).toBe(
      "false",
    );
    expect(
      menu().get(`[data-choice="${preference}"]`).attributes("aria-checked"),
    ).toBe("true");
    expect(
      menu().get('[data-choice="recommended"] small').text(),
    ).not.toContain("claude");
    await menu().get('[data-choice=""]').trigger("click");
    await flushPromises();
    expect(selectModel).toHaveBeenCalledWith(null);
  },
);
test.each([
  null,
  { ...status, available: false },
  { ...status, selectedModel: null },
  { ...status, modelError: "native.ai.model.unavailable" },
])(
  "an unresolved workspace default never displays the explicit model (%j)",
  async (resolved) => {
    if (resolved) vi.mocked(getStatus).mockResolvedValue(resolved);
    else vi.mocked(getStatus).mockRejectedValue(new Error("Unavailable"));
    const wrapper = mount(ChatModelPicker, {
      attachTo: document.body,
      props: {
        ...props(),
        workspaceScope: `unresolved-default-${JSON.stringify(resolved)}`,
        status: { ...status, modelInherited: false, selectedModel: "gpt-4.1" },
      },
    });
    await flushPromises();
    await openMenu(wrapper);
    expect(menu().get('[data-choice=""] small').text()).toBe(
      "⟦ai.workspaceDefaultUnavailable⟧",
    );
    await menu().get('[data-choice=""]').trigger("click");
    await flushPromises();
    expect(selectModel).toHaveBeenCalledWith(null);
  },
);
test("a stale workspace-default lookup cannot replace an inherited selection", async () => {
  let resolve!: (value: Status) => void;
  vi.mocked(getStatus).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      workspaceScope: "stale-default",
      status: { ...status, modelInherited: false, selectedModel: "gpt-4.1" },
    },
  });
  await flushPromises();
  await wrapper.setProps({ status: { ...status, selectedModel: "gpt-5.4" } });
  resolve({ ...status, selectedModel: "gpt-4.1" });
  await flushPromises();
  await openMenu(wrapper);
  expect(menu().get('[data-choice=""] small').text()).toBe(
    "Personal · openai · gpt-5.4",
  );
});
test("Recommended persists a symbolic override, not the resolved model or workspace setting", async () => {
  const save = vi.spyOn(workspaceAiSettings("symbolic-picker"), "save");
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: { ...props(), workspaceScope: "symbolic-picker" },
  });
  await flushPromises();
  await choose(wrapper, "recommended");
  expect(selectModel).toHaveBeenCalledWith("recommended");
  expect(save).not.toHaveBeenCalled();
});
test("model and thinking remain editable during running and unsaved responses but not persistence", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      status: {
        ...status,
        selectedModel: "gpt-6.1-sol",
        thinkingInherited: true,
      },
    },
  });
  await flushPromises();
  for (const key of ["running", "unsaved"] as const) {
    await wrapper.setProps({ [key]: true });
    expect(wrapper.findAll('[aria-haspopup="menu"]')).toHaveLength(2);
    for (const control of wrapper.findAll('[aria-haspopup="menu"]'))
      expect(control.attributes("disabled")).toBeUndefined();
  }
  await choose(wrapper, "high", 1);
  expect(selectThinking).toHaveBeenCalledWith("high");
  await choose(wrapper, "", 1);
  expect(selectThinking).toHaveBeenLastCalledWith(null);
  await choose(wrapper, "recommended", 1);
  expect(selectThinking).toHaveBeenLastCalledWith("recommended");
  await wrapper.setProps({ saving: true });
  for (const control of wrapper.findAll('[aria-haspopup="menu"]'))
    expect(control.attributes("disabled")).toBeDefined();
});
test("unsupported thinking is omitted without mutating preferences", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: { ...props(), status: { ...status, thinkingPreference: "high" } },
  });
  await flushPromises();
  expect(wrapper.findAll('[aria-haspopup="menu"]')).toHaveLength(1);
  expect(selectThinking).not.toHaveBeenCalled();
});
test.each(["toolbar", "field"] as const)(
  "custom IDs in %s presentation retain dialog editing and cancel focus",
  async (appearance) => {
    const wrapper = mount(ChatModelPicker, {
      attachTo: document.body,
      props: {
        ...props(),
        appearance,
        status: {
          ...status,
          config: {
            provider: "custom",
            endpoint: "https://example.invalid/v1",
          },
          selectedModel: "saved-alias",
          modelInherited: false,
        },
      },
    });
    await flushPromises();
    expect(loadModelCatalog).not.toHaveBeenCalled();
    await wrapper.get(".manual-trigger").trigger("click");
    expect(wrapper.get<HTMLDialogElement>("dialog").element.open).toBe(true);
    expect(wrapper.get<HTMLInputElement>("input").element.value).toBe(
      "saved-alias",
    );
    await wrapper.get("dialog").trigger("cancel");
    expect(document.activeElement).toBe(wrapper.get(".manual-trigger").element);
    expect(selectModel).not.toHaveBeenCalled();
    await wrapper.get(".manual-trigger").trigger("click");
    await wrapper.get("input").setValue("unlisted-alias");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(selectModel).toHaveBeenCalledWith("unlisted-alias");
  },
);
test("uncertain readback blocks selection and retry refreshes rather than claiming rollback", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      selectionUncertain: true,
      selectionError: new Error("private diagnostic"),
    },
  });
  await flushPromises();
  expect(
    wrapper.get('[aria-haspopup="menu"]').attributes("disabled"),
  ).toBeDefined();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦ai.selectionUncertain⟧",
  );
  expect(wrapper.text()).not.toContain("private diagnostic");
  await wrapper.get(".model-error button").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  expect(selectModel).not.toHaveBeenCalled();
  await wrapper.setProps({
    selectionUncertain: false,
    selectionError: undefined,
  });
  expect(
    wrapper.get('[aria-haspopup="menu"]').attributes("disabled"),
  ).toBeUndefined();
});
test.each([
  ["model", "gpt-4.1", 0],
  ["thinking", "high", 1],
] as const)(
  "a confirmed failed %s selection retries the requested value after dismissing recovery",
  async (kind, value, index) => {
    const select = kind === "model" ? selectModel : selectThinking;
    const wrapper = mount(ChatModelPicker, {
      attachTo: document.body,
      props: {
        ...props(),
        status: { ...status, selectedModel: "gpt-6.1-sol" },
      },
    });
    select.mockImplementationOnce(async () => {
      await wrapper.setProps({ selectionError: new Error("save failed") });
      return false;
    });
    await flushPromises();
    await choose(wrapper, value, index);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await wrapper.get(".error-trigger").trigger("click");
    expect(wrapper.get<HTMLDialogElement>(".model-error").element.open).toBe(
      false,
    );
    await wrapper.get(".error-trigger").trigger("click");
    await wrapper.get(".model-error button").trigger("click");
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith(value);
    expect(wrapper.emitted("retry")).toBeUndefined();
  },
);
test("an uncertain failed save requires readback before retrying the retained choice", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: props(),
  });
  selectModel.mockImplementationOnce(async () => {
    await wrapper.setProps({
      selectionUncertain: true,
      selectionError: new Error("readback failed"),
    });
    return false;
  });
  await flushPromises();
  await choose(wrapper, "gpt-5.4");
  await wrapper.get(".model-error button").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  expect(selectModel).toHaveBeenCalledTimes(1);
  await wrapper.setProps({
    selectionUncertain: false,
    selectionError: undefined,
  });
  await wrapper.get(".model-error button").trigger("click");
  expect(selectModel).toHaveBeenCalledTimes(2);
  expect(selectModel).toHaveBeenLastCalledWith("gpt-5.4");
});

test("unknown discovery explains manual access rather than reporting unreadable choices", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      status: { ...status, catalog: { source: "unknown", models: [] } },
    },
  });
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦ai.models.lookupFailed⟧",
  );
  expect(wrapper.get('[role="alert"]').text()).not.toContain(
    "⟦ai.modelChoicesCouldNotBeRead⟧",
  );
  expect(
    wrapper.get('[aria-haspopup="menu"]').attributes("disabled"),
  ).toBeUndefined();
  await wrapper.setProps({ loadError: true });
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦ai.modelChoicesCouldNotBeRead⟧",
  );
});

test.each(["account", "provider"] as const)(
  "%s discovery constrains recommendations without selecting",
  async (source) => {
    const wrapper = mount(ChatModelPicker, {
      attachTo: document.body,
      props: {
        ...props(),
        status: { ...status, catalog: { source, models: ["gpt-4o-mini"] } },
      },
    });
    await flushPromises();
    await openMenu(wrapper);
    expect(menu().find('[data-choice="gpt-6.1-sol"]').exists()).toBe(false);
    expect(menu().find('[data-choice="recommended"]').exists()).toBe(true);
    expect(selectModel).not.toHaveBeenCalled();
  },
);
test("changing same-provider connection replaces names and choices without selecting", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      status: {
        ...status,
        catalog: { source: "account", models: ["gpt-4o-mini"] },
      },
    },
  });
  await flushPromises();
  await wrapper.setProps({
    status: {
      ...status,
      config: { ...status.config!, connectionId: "work", label: "Work" },
      selectedModel: "gpt-6.1-sol",
      catalog: { source: "account", models: ["gpt-6.1-sol"] },
    },
  });
  await openMenu(wrapper);
  expect(menu().text()).toContain("Work");
  expect(menu().text()).not.toContain("Personal");
  expect(menu().find('[data-choice="gpt-4o-mini"]').exists()).toBe(false);
  expect(selectModel).not.toHaveBeenCalled();
});
test("a late model refresh cannot update another connection", async () => {
  let finish!: (value: Status) => void;
  vi.mocked(refreshModels).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      workspaceScope: "late-catalog",
      status: { ...status, catalog: { source: "unknown", models: [] } },
    },
  });
  await flushPromises();
  await wrapper.get(".model-error button").trigger("click");
  await wrapper.setProps({
    status: { ...status, config: { ...status.config!, connectionId: "work" } },
  });
  expect(refreshModels).toHaveBeenCalledWith("late-catalog", "personal");
  finish(status);
  await flushPromises();
  expect(wrapper.emitted("retry")).toBeUndefined();
});

test("an override whose connection was removed can restore the workspace default", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      status: {
        ...status,
        config: null,
        available: false,
        modelInherited: false,
      },
    },
  });
  await flushPromises();
  const trigger = wrapper.get('[aria-haspopup="menu"]');
  expect(trigger.attributes("disabled")).toBeUndefined();
  await openMenu(wrapper);
  expect(menu().findAll('[role="menuitemradio"]')).toHaveLength(1);
  await menu().get('[data-choice=""]').trigger("click");
  await flushPromises();
  expect(selectModel).toHaveBeenCalledWith(null);
});
test("an explicit Recommended choice shows its resolved model without losing the symbolic preference", async () => {
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      status: {
        ...status,
        modelInherited: false,
        modelPreference: "recommended",
      },
    },
  });
  await flushPromises();
  expect(wrapper.get('[aria-haspopup="menu"]').text()).toBe("☆GPT-4o mini");
  expect(
    wrapper.get('[aria-haspopup="menu"]').attributes("aria-description"),
  ).toContain("settings.ai.recommended");
  await openMenu(wrapper);
  expect(
    menu().get('[data-choice="recommended"]').attributes("aria-checked"),
  ).toBe("true");
});

test("an explicit connection stays editable when the workspace default account's settings are locked", async () => {
  const scope = "picker-independent-accounts";
  vi.mocked(invoke).mockRejectedValueOnce(new Error("locked"));
  await workspaceAiSettings(scope, "work").refresh();
  vi.mocked(invoke).mockResolvedValue(defaultAiSettings());
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      workspaceScope: scope,
      status: { ...status, modelInherited: false },
    },
  });
  await flushPromises();
  expect(invoke).toHaveBeenLastCalledWith("ai_settings_load", {
    scope,
    connectionId: "personal",
  });
  expect(
    wrapper.get('[aria-haspopup="menu"]').attributes("disabled"),
  ).toBeUndefined();
  await choose(wrapper, "gpt-5.4");
  expect(selectModel).toHaveBeenCalledWith("gpt-5.4");
  expect(workspaceAiSettings(scope, "work").state.error).toBe(true);
});

test.each([
  {
    inherited: true,
    preference: "recommended",
    level: "medium",
    mark: "↳",
    source: "ai.workspaceDefault",
  },
  {
    inherited: false,
    preference: "recommended",
    level: "medium",
    mark: "☆",
    source: "settings.ai.recommended",
  },
  {
    inherited: false,
    preference: "high",
    level: "high",
    mark: "",
    source: "ai.conversationChoice",
  },
])(
  "resolved thinking preserves $source without repeating it in the trigger",
  async (example) => {
    const wrapper = mount(ChatModelPicker, {
      attachTo: document.body,
      props: {
        ...props(),
        status: {
          ...status,
          selectedModel: "gpt-6.1-sol",
          thinkingInherited: example.inherited,
          thinkingPreference: example.preference,
          thinkingLevel: example.level,
          inheritedThinkingLevel: "high",
          recommendedThinkingLevel: "medium",
        },
      },
    });
    await flushPromises();
    const trigger = wrapper.findAll('[aria-haspopup="menu"]')[1]!;
    expect(trigger.text()).toBe(
      example.mark + "⟦settings.ai.thinking." + example.level + "⟧",
    );
    expect(trigger.attributes("aria-description")).toContain(example.source);
    await openMenu(wrapper, 1);
    expect(menu().get('[data-choice=""]').text()).toContain(
      "⟦settings.ai.thinking.high⟧",
    );
    expect(menu().get('[data-choice="recommended"]').text()).toContain(
      "⟦settings.ai.thinking.medium⟧",
    );
    expect(menu().find("p").exists()).toBe(false);
    expect(selectThinking).not.toHaveBeenCalled();
  },
);

test("expanded workspace default shows its resolved model, not an override on a different account", async () => {
  vi.mocked(getStatus).mockResolvedValue({
    ...status,
    config: {
      provider: "anthropic",
      endpoint: null,
      connectionId: "work",
      label: "Work",
    },
    selectedModel: "claude-sonnet-5-5",
  });
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      workspaceScope: "compact-default",
      status: { ...status, modelInherited: false },
    },
  });
  await flushPromises();
  expect(getStatus).toHaveBeenCalledWith("compact-default");
  expect(wrapper.get('[aria-haspopup="menu"]').text()).toBe("GPT-4o mini");
  await openMenu(wrapper);
  const option = menu().get('[data-choice=""]');
  expect(option.text()).toContain("Work · anthropic · claude-sonnet-5-5");
  expect(option.text()).not.toContain("gpt-4o-mini");
  expect(selectModel).not.toHaveBeenCalled();
});

test("an unconfigured restored conversation does not open a recovery modal", async () => {
  const wrapper = mount(ChatModelPicker, {
    props: {
      ...props(),
      status: {
        ...status,
        config: null,
        available: false,
        selectedModel: null,
        modelError: "native.ai.model.required",
      },
    },
  });
  await flushPromises();
  const recovery = wrapper.get<HTMLDialogElement>(".model-error");
  expect(recovery.element.open).toBe(false);
  await wrapper.get(".error-trigger").trigger("click");
  expect(recovery.element.open).toBe(true);
});

test("failed selection recovery stays open when status readback is unavailable", async () => {
  const wrapper = mount(ChatModelPicker, {
    props: {
      ...props(),
      selectionError: "native.ai.model.selectionChanged",
      selectionUncertain: true,
    },
  });
  await flushPromises();
  await wrapper.setProps({ status: null, loadError: true });
  await flushPromises();
  expect(wrapper.get<HTMLDialogElement>(".model-error").element.open).toBe(
    true,
  );
  await wrapper.get(".model-error button").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
});

test("confirmed model readback clears a pending choice without writing it twice", async () => {
  selectModel.mockResolvedValue(false);
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: props(),
  });
  await flushPromises();
  await choose(wrapper, "gpt-4.1");
  expect(wrapper.get<HTMLDialogElement>(".model-error").element.open).toBe(
    true,
  );
  await wrapper.setProps({
    status: {
      ...status,
      selectedModel: "gpt-4.1",
      modelPreference: "gpt-4.1",
      modelInherited: false,
    },
    selectionUncertain: false,
    selectionError: "",
  });
  await flushPromises();
  expect(wrapper.find(".model-error").exists()).toBe(false);
  expect(selectModel).toHaveBeenCalledExactlyOnceWith("gpt-4.1");
});
test("a late default preview cannot cross workspace boundaries", async () => {
  let finish!: (value: Status) => void;
  vi.mocked(getStatus).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = mount(ChatModelPicker, {
    attachTo: document.body,
    props: {
      ...props(),
      workspaceScope: "old-default",
      status: { ...status, modelInherited: false },
    },
  });
  await flushPromises();
  await wrapper.setProps({ workspaceScope: "new-default" });
  await flushPromises();
  finish({ ...status, selectedModel: "retired-model" });
  await flushPromises();
  await openMenu(wrapper);
  expect(menu().get('[data-choice=""]').text()).toContain("gpt-4o-mini");
  expect(menu().get('[data-choice=""]').text()).not.toContain("retired-model");
});
