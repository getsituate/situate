import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, expect, test, vi } from "vitest";
import AiSetup from "./AiSetup.vue";
import * as modelCatalog from "./model-catalog";
import { de, preferences, setPreferences } from "@situate/localization";
import ChatComposer from "../components/ChatComposer.vue";
const api = vi.hoisted(() => ({
  loadModelCatalog: vi.fn(),
  getStatus: vi.fn(),
  saveConnection: vi.fn(),
  removeConnection: vi.fn(),
  startOpenAiLogin: vi.fn(),
  waitOpenAiLogin: vi.fn(),
  cancelOpenAiLogin: vi.fn(),
}));
const signedIn = {
  available: true,
  reason: null,
  selectedModel: null,
  modelError: null,
  config: { provider: "openai", endpoint: null, auth: "oauth" as const },
};
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  ...api,
}));
beforeEach(() => {
  api.loadModelCatalog.mockReset().mockResolvedValue(modelCatalog);
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  api.getStatus.mockReset().mockResolvedValue({
    available: false,
    config: null,
    reason: null,
    selectedModel: null,
    modelError: null,
  });
  api.saveConnection.mockReset().mockImplementation(async (_scope, config) => ({
    config,
    available: true,
    reason: null,
    selectedModel: null,
    modelError: null,
  }));
  api.removeConnection.mockReset().mockResolvedValue(undefined);
  api.startOpenAiLogin.mockReset().mockResolvedValue("openai-attempt");
  api.waitOpenAiLogin.mockReset().mockResolvedValue(signedIn);
  api.cancelOpenAiLogin.mockReset().mockResolvedValue(undefined);
});
test("waits for complete provider metadata and retains the active language when it arrives", async () => {
  let finish!: (value: typeof modelCatalog) => void;
  api.loadModelCatalog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: true },
  });
  await flushPromises();
  expect(api.loadModelCatalog).not.toHaveBeenCalled();
  await wrapper.get(".ai-primary-choice").trigger("click");
  expect(wrapper.find(".ai-provider-grid").exists()).toBe(false);
  Reflect.deleteProperty(globalThis, "__SITUATE_LOCALIZATION_KEYS__");
  setPreferences({ language: "de", formats: preferences.value.formats });
  await flushPromises();
  expect(wrapper.text()).toContain(de["ai.loadingModels"]);
  finish(modelCatalog);
  await flushPromises();
  expect(wrapper.findAll(".ai-provider-grid button")).toHaveLength(5);
  expect(wrapper.get("h1").text()).toBe(de["ai.chooseAProvider"]);
  expect(document.documentElement.lang).toBe("de");
  wrapper.unmount();
});

test("failed provider metadata loading stays unavailable until an explicit retry", async () => {
  api.loadModelCatalog.mockRejectedValueOnce(
    new Error("Private chunk details"),
  );
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: true },
  });
  await flushPromises();
  await wrapper.get(".ai-primary-choice").trigger("click");
  await flushPromises();
  expect(wrapper.find(".ai-provider-grid").exists()).toBe(false);
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦ai.modelChoicesCouldNotBeRead⟧",
  );
  expect(wrapper.text()).not.toContain("Private chunk details");
  expect(api.loadModelCatalog).toHaveBeenCalledOnce();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦ai.retryLoadingModels⟧")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.findAll(".ai-provider-grid button")).toHaveLength(5);
  expect(api.saveConnection).not.toHaveBeenCalled();
  wrapper.unmount();
});

test.each([
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
])(
  "settings retain the %s provider ID until its catalog name loads",
  async (provider, name) => {
    let finish!: (value: typeof modelCatalog) => void;
    api.loadModelCatalog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    api.getStatus.mockResolvedValue({
      ...signedIn,
      config: { provider, endpoint: null },
    });
    const wrapper = mount(AiSetup, {
      props: { scope: "one", workspaceName: "Garden", created: false },
    });
    try {
      await flushPromises();
      expect(
        wrapper.get('p[data-localization-content="identity"]').text(),
      ).toBe(provider);
      expect(wrapper.text()).not.toContain("⟦ai.compatibleEndpoint⟧");
      expect(wrapper.text()).toContain("⟦ai.loadingModels⟧");
      finish(modelCatalog);
      await flushPromises();
      expect(
        wrapper.get('p[data-localization-content="identity"]').text(),
      ).toBe(name);
    } finally {
      wrapper.unmount();
      finish(modelCatalog);
    }
  },
);

test.each(["openai", "anthropic"])(
  "settings retain the %s provider ID when catalog loading fails",
  async (provider) => {
    api.loadModelCatalog.mockRejectedValueOnce(
      new Error("Catalog unavailable"),
    );
    api.getStatus.mockResolvedValue({
      ...signedIn,
      config: { provider, endpoint: null },
    });
    const wrapper = mount(AiSetup, {
      props: { scope: "one", workspaceName: "Garden", created: false },
    });
    try {
      await flushPromises();
      expect(
        wrapper.get('p[data-localization-content="identity"]').text(),
      ).toBe(provider);
      expect(wrapper.text()).not.toContain("⟦ai.compatibleEndpoint⟧");
      expect(wrapper.get("[role=alert]").text()).toContain(
        "⟦ai.modelChoicesCouldNotBeRead⟧",
      );
    } finally {
      wrapper.unmount();
    }
  },
);

test("settings keep the compatible endpoint label only for custom connections when the catalog is unavailable", async () => {
  api.loadModelCatalog.mockRejectedValueOnce(new Error("Catalog unavailable"));
  api.getStatus.mockResolvedValue({
    ...signedIn,
    config: { provider: "custom", endpoint: "http://localhost:8888/v1" },
  });
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: false },
  });
  try {
    await flushPromises();
    expect(wrapper.text()).toContain("⟦ai.compatibleEndpoint⟧");
    expect(wrapper.get('p[data-localization-content="user"]').text()).toBe(
      "http://localhost:8888/v1",
    );
    expect(
      wrapper.find('p[data-localization-content="identity"]').exists(),
    ).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

async function openCustom() {
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: true },
  });
  await flushPromises();
  await wrapper.get(".ai-primary-choice").trigger("click");
  await wrapper
    .findAll("button")
    .find((button) => button.text().includes("⟦ai.compatibleEndpoint⟧"))!
    .trigger("click");
  await wrapper.get("#ai-endpoint").setValue("http://localhost:8888/v1");
  expect(wrapper.find("#ai-model").exists()).toBe(false);
  await wrapper.get('.ai-note input[type="checkbox"]').setValue(true);
  await wrapper.get("#ai-key").setValue("synthetic-secret");
  return wrapper;
}
test("show-key switch changes visibility without saving or replacing the credential draft", async () => {
  const wrapper = await openCustom();
  const reveal = wrapper.get('input[role="switch"]');
  const consent = wrapper.get('.ai-note input[type="checkbox"]');
  expect(consent.attributes("role")).not.toBe("switch");
  expect(consent.attributes("required")).toBeDefined();
  expect(wrapper.get("#ai-key").attributes("type")).toBe("password");
  await reveal.setValue(true);
  expect(wrapper.get("#ai-key").attributes("type")).toBe("text");
  expect(wrapper.get<HTMLInputElement>("#ai-key").element.value).toBe(
    "synthetic-secret",
  );
  await reveal.setValue(false);
  expect(wrapper.get("#ai-key").attributes("type")).toBe("password");
  expect(wrapper.get<HTMLInputElement>("#ai-key").element.value).toBe(
    "synthetic-secret",
  );
  expect(api.saveConnection).not.toHaveBeenCalled();
  wrapper.unmount();
});

test("connection save is workspace-scoped and completion does not claim a verified provider login", async () => {
  const wrapper = await openCustom();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(api.saveConnection).toHaveBeenCalledWith(
    "one",
    {
      provider: "custom",
      endpoint: "http://localhost:8888/v1",
      httpAcknowledgement: "http://localhost:8888/v1",
    },
    "synthetic-secret",
  );
  expect(wrapper.text()).toContain("⟦ai.aiAccessSaved⟧");
  expect(wrapper.text()).toContain(
    "⟦ai.noTestMessageWasSentAccessWillBeChecked⟧",
  );
  expect(wrapper.text()).toContain(
    "⟦ai.chooseAModelInChatBeforeSendingAMessage⟧",
  );
  expect(wrapper.html()).not.toContain("synthetic-secret");
  expect(wrapper.find("input[type=password]").exists()).toBe(false);
  wrapper.unmount();
});
test.each([
  ["http://EXAMPLE.invalid:80/v1/", "http://example.invalid/v1/"],
  ["http://EXAMPLE.invalid:80", "http://example.invalid/"],
])(
  "HTTP consent for %s is bound to the canonical destination and resets on every edit",
  async (input, canonical) => {
    const wrapper = await openCustom();
    await wrapper.get("#ai-endpoint").setValue(input);
    expect(
      (
        wrapper.get('.ai-note input[type="checkbox"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
    await wrapper.get("form").trigger("submit");
    expect(api.saveConnection).not.toHaveBeenCalled();
    await wrapper.get("#ai-key").setValue("");
    await wrapper.get('.ai-note input[type="checkbox"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.saveConnection).toHaveBeenCalledWith(
      "one",
      {
        provider: "custom",
        endpoint: canonical,
        httpAcknowledgement: canonical,
      },
      "",
    );
    wrapper.unmount();
  },
);
test("reconnect offers only the saved authentication method and Back returns to the connection list", async () => {
  const wrapper = mount(AiSetup, {
    props: {
      scope: "one",
      workspaceName: "Garden",
      embedded: true,
      connection: {
        connectionId: "work",
        label: "Work",
        provider: "openai",
        endpoint: null,
        auth: "oauth",
      },
    },
  });
  await flushPromises();
  expect(wrapper.findAll(".ai-choices button")).toHaveLength(1);
  expect(wrapper.get(".ai-choices button").text()).toContain(
    "⟦ai.signInWithChatGPT⟧",
  );
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦workspace.back⟧")!
    .trigger("click");
  expect(wrapper.emitted("done")).toHaveLength(1);
  expect(wrapper.find(".ai-provider-grid").exists()).toBe(false);
  wrapper.unmount();
});
test("embedded reconnect retains connection identity, label and draft when native save fails", async () => {
  api.saveConnection.mockRejectedValue("native.ai.secureStore.locked");
  const wrapper = mount(AiSetup, {
    props: {
      scope: "one",
      workspaceName: "Garden",
      embedded: true,
      connection: {
        connectionId: "work",
        label: "Work",
        provider: "custom",
        endpoint: "https://example.invalid/v1",
      },
    },
  });
  await flushPromises();
  await wrapper.get("#ai-key").setValue("synthetic-key");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(api.saveConnection).toHaveBeenCalledWith(
    "one",
    {
      connectionId: "work",
      label: "Work",
      provider: "custom",
      endpoint: "https://example.invalid/v1",
    },
    "synthetic-key",
  );
  expect(wrapper.find("header").exists()).toBe(false);
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦native.ai.secureStore.locked⟧",
  );
  expect((wrapper.get("#ai-key").element as HTMLInputElement).value).toBe(
    "synthetic-key",
  );
  expect(wrapper.emitted("connected")).toBeUndefined();
  wrapper.unmount();
});
test("failed replacement keeps the form and never reports saved access or leaks an error body", async () => {
  api.saveConnection.mockRejectedValue(
    new Error("provider echoed synthetic-secret"),
  );
  const wrapper = await openCustom();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦ai.aiAccessCouldNotBeConfirmedCheckTheEndpoint⟧",
  );
  expect(wrapper.get("[role=alert]").text()).not.toContain("synthetic-secret");
  expect(wrapper.text()).not.toContain("⟦ai.aiAccessSaved⟧");
  wrapper.unmount();
});
test("a post-write durability error does not claim unchanged credentials or saved access", async () => {
  api.saveConnection.mockRejectedValue("native.ai.access.durability");
  const wrapper = await openCustom();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦native.ai.access.durability⟧",
  );
  expect(wrapper.text()).not.toContain(
    "previous connection has not been replaced",
  );
  expect(wrapper.find("form").exists()).toBe(true);
  expect(wrapper.text()).not.toContain("⟦ai.aiAccessSaved⟧");
  expect(api.getStatus).toHaveBeenCalledTimes(2);
  wrapper.unmount();
});
test("unsupported platforms cannot start a connection but can continue without AI", async () => {
  api.getStatus.mockResolvedValue({
    config: null,
    available: false,
    reason: "native.ai.access.platform",
  });
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: true },
  });
  await flushPromises();
  expect(
    wrapper.get(".ai-primary-choice").attributes("disabled"),
  ).toBeDefined();
  expect(wrapper.text()).toContain("⟦native.ai.access.platform⟧");
  expect(
    wrapper
      .findAll("button")
      .find((button) => button.text() === "⟦ai.skipForNow⟧")
      ?.attributes("disabled"),
  ).toBeUndefined();
  expect(api.saveConnection).not.toHaveBeenCalled();
  wrapper.unmount();
});
test("cancel discards a credential without replacing access", async () => {
  const wrapper = await openCustom();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦navigation.cancel⟧")!
    .trigger("click");
  expect(api.saveConnection).not.toHaveBeenCalled();
  expect(wrapper.find("#ai-key").exists()).toBe(false);
  await wrapper.get(".ai-primary-choice").trigger("click");
  await wrapper
    .findAll("button")
    .find((button) => button.text().includes("⟦ai.compatibleEndpoint⟧"))!
    .trigger("click");
  expect((wrapper.get("#ai-key").element as HTMLInputElement).value).toBe("");
  wrapper.unmount();
});
test("provider selection shows five named choices without search or helper copy and Back preserves the origin", async () => {
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: false },
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦ai.connectAIAccess⟧")!
    .trigger("click");
  expect(wrapper.get("h1").text()).toBe("⟦ai.chooseAProvider⟧");
  const choices = wrapper.findAll(".ai-provider-grid button");
  expect(choices.map((choice) => choice.get("strong").text())).toEqual([
    "Anthropic",
    "OpenAI",
    "⟦ai.providers.codex⟧",
    "OpenRouter",
    "⟦ai.compatibleEndpoint⟧",
  ]);
  expect(wrapper.find('input[type="search"]').exists()).toBe(false);
  expect(wrapper.find(".ai-subtitle").exists()).toBe(false);
  expect(wrapper.find(".ai-result-count").exists()).toBe(false);
  expect(wrapper.find(".ai-provider-grid small").exists()).toBe(false);
  expect(wrapper.findAll(".ai-provider-grid .provider-icon")).toHaveLength(5);
  expect(wrapper.get(".ai-provider-grid").attributes("aria-label")).toBe(
    "⟦ai.chooseAProvider⟧",
  );
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦workspace.back⟧")!
    .trigger("click");
  expect(wrapper.get("h1").text()).toBe("⟦ai.aiAccess⟧");
  expect(wrapper.emitted("done")).toBeUndefined();
  wrapper.unmount();
});
test.each([
  ["OpenAI", "ai.connections.openaiKeyHelp"],
  ["Anthropic", "ai.connections.anthropicKeyHelp"],
  ["OpenRouter", "ai.connections.openrouterKeyHelp"],
])(
  "%s explains API access and retains optional naming across the credential form",
  async (name, help) => {
    const wrapper = mount(AiSetup, {
      props: {
        scope: "one",
        workspaceName: "Garden",
        embedded: true,
        required: true,
      },
    });
    await flushPromises();
    await wrapper
      .findAll(".ai-provider-grid button")
      .find((button) => button.get("strong").text() === name)!
      .trigger("click");
    expect(wrapper.find(".ai-subtitle").exists()).toBe(false);
    expect(wrapper.text()).not.toContain(
      "⟦ai.yourProvidersTermsAndChargesApplyEnvironmentVariablesCommands⟧",
    );
    expect(wrapper.get('label[for="ai-connection-label"]').text()).toBe(
      "⟦ai.connections.label⟧",
    );
    expect(
      wrapper.get("#ai-connection-label").attributes("required"),
    ).toBeUndefined();
    await wrapper.get("#ai-connection-label").setValue("Personal");
    const apiKey = wrapper
      .findAll(".ai-choices button")
      .find((button) => button.text().includes("⟦ai.apiKeyMethod⟧"))!;
    expect(apiKey.get("small").text()).toBe(`⟦${help}⟧`);
    expect(apiKey.attributes("aria-describedby")).toBe(
      apiKey.get("small").attributes("id"),
    );
    await apiKey.trigger("click");
    expect(
      (wrapper.get("#ai-connection-label").element as HTMLInputElement).value,
    ).toBe("Personal");
    expect(wrapper.get("#ai-key").attributes("aria-describedby")).toBe(
      "ai-key-help",
    );
    expect(wrapper.get("#ai-key-help").text()).toBe(`⟦${help}⟧`);
    expect(api.saveConnection).not.toHaveBeenCalled();
    wrapper.unmount();
  },
);

test("provider choices exclude deferred integrations and offer Codex device sign-in", async () => {
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: true },
  });
  await flushPromises();
  await wrapper.get(".ai-primary-choice").trigger("click");
  await flushPromises();
  expect(wrapper.findAll(".ai-provider-grid button")).toHaveLength(5);
  await wrapper
    .findAll(".ai-provider-grid button")
    .find((button) => button.get("strong").text() === "⟦ai.providers.codex⟧")!
    .trigger("click");
  expect(wrapper.findAll(".ai-choices button")).toHaveLength(1);
  expect(
    wrapper.get(".ai-choices button").attributes("disabled"),
  ).toBeUndefined();
  expect(wrapper.find("#ai-key").exists()).toBe(false);
  expect(api.startOpenAiLogin).not.toHaveBeenCalled();
  expect(api.saveConnection).not.toHaveBeenCalled();
  wrapper.unmount();
});

test.each(["anthropic", "openrouter"])(
  "%s setup offers only API-key access",
  async (provider) => {
    const wrapper = mount(AiSetup, {
      props: { scope: "one", workspaceName: "Garden", created: true },
    });
    await flushPromises();
    await wrapper.get(".ai-primary-choice").trigger("click");
    await wrapper
      .findAll(".ai-provider-grid button")
      .find((button) => button.get("strong").text().toLowerCase() === provider)!
      .trigger("click");
    expect(wrapper.findAll(".ai-choices button")).toHaveLength(1);
    expect(wrapper.get(".ai-choices button").text()).toContain(
      "⟦ai.apiKeyMethod⟧",
    );
    await wrapper.get(".ai-choices button").trigger("click");
    expect(wrapper.find("#ai-key").exists()).toBe(true);
    expect(api.startOpenAiLogin).not.toHaveBeenCalled();
    wrapper.unmount();
  },
);

test("back from an API-key form returns to authentication choices and clears the secret", async () => {
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: true },
  });
  await flushPromises();
  await wrapper.get(".ai-primary-choice").trigger("click");
  await wrapper
    .findAll(".ai-provider-grid button")
    .find((button) => button.get("strong").text() === "Anthropic")!
    .trigger("click");
  await wrapper
    .findAll(".ai-choices button")
    .find((button) => button.attributes("disabled") === undefined)!
    .trigger("click");
  await wrapper.get("#ai-key").setValue("synthetic-secret");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦workspace.back⟧")!
    .trigger("click");
  expect(wrapper.get("h1").text()).toBe(
    '⟦ai.connectProvider:{"name":"Anthropic"}⟧',
  );
  expect(wrapper.find("#ai-key").exists()).toBe(false);
  await wrapper
    .findAll(".ai-choices button")
    .find((button) => button.attributes("disabled") === undefined)!
    .trigger("click");
  expect((wrapper.get("#ai-key").element as HTMLInputElement).value).toBe("");
  expect(api.saveConnection).not.toHaveBeenCalled();
  wrapper.unmount();
});
async function openBrowserLogin() {
  const wrapper = mount(AiSetup, {
    props: { scope: "one", workspaceName: "Garden", created: true },
  });
  await flushPromises();
  await wrapper.get(".ai-primary-choice").trigger("click");
  await wrapper
    .findAll(".ai-provider-grid button")
    .find((button) => button.get("strong").text() === "OpenAI")!
    .trigger("click");
  await wrapper
    .findAll(".ai-choices button")
    .find((button) => button.text().includes("⟦ai.signInWithChatGPT⟧"))!
    .trigger("click");
  await vi.waitFor(() =>
    expect(wrapper.text()).toContain("⟦ai.openSignInInBrowser⟧"),
  );
  return wrapper;
}
test("OpenAI browser sign-in completes setup only after saved access is returned", async () => {
  let finish!: (status: typeof signedIn) => void;
  api.waitOpenAiLogin.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = await openBrowserLogin();
  expect(wrapper.get("h1").text()).toBe("⟦ai.signInToOpenAI⟧");
  expect(api.startOpenAiLogin).not.toHaveBeenCalled();
  expect(wrapper.find("#ai-key").exists()).toBe(false);
  expect(wrapper.find("#openai-browser-model").exists()).toBe(false);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦ai.openSignInInBrowser⟧")!
    .trigger("click");
  await flushPromises();
  expect(api.startOpenAiLogin).toHaveBeenCalledExactlyOnceWith(
    "one",
    undefined,
    undefined,
  );
  expect(api.waitOpenAiLogin).toHaveBeenCalledExactlyOnceWith(
    "one",
    "openai-attempt",
  );
  expect(wrapper.get("h1").text()).toBe("⟦ai.signInToOpenAI⟧");
  expect(wrapper.emitted("done")).toBeUndefined();
  finish(signedIn);
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("⟦ai.aiAccessConnected⟧");
  expect(wrapper.text()).toContain(
    "⟦ai.signedInToOpenAIModelAvailabilityDependsOnYour⟧",
  );
  expect(wrapper.get(".ai-receipt").text()).toContain("OpenAI");
  expect(api.saveConnection).not.toHaveBeenCalled();
  wrapper.unmount();
});
test.each(["unknown", "account"] as const)(
  "saved access explains %s discovery without claiming a default or rejected sign-in",
  async (source) => {
    api.waitOpenAiLogin.mockResolvedValue({
      ...signedIn,
      catalog: { source, models: [] },
    });
    const wrapper = await openBrowserLogin();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "⟦ai.openSignInInBrowser⟧")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("⟦ai.aiAccessConnected⟧");
    expect(wrapper.text()).toContain(
      source === "unknown" ? "⟦ai.models.lookupFailed⟧" : "⟦ai.models.empty⟧",
    );
    if (source === "account")
      expect(wrapper.text()).not.toContain(
        "⟦ai.chooseAModelInChatBeforeSendingAMessage⟧",
      );
    expect(wrapper.emitted("connected")?.[0]?.[0]).toMatchObject({
      available: true,
      catalog: { source, models: [] },
    });
    wrapper.unmount();
  },
);
test("cancel waits for native cleanup and restores the current connection even if a save already finished", async () => {
  const original = {
    available: true,
    reason: null,
    selectedModel: "claude-sonnet-4-6",
    modelError: null,
    config: { provider: "anthropic", endpoint: null },
  };
  api.getStatus.mockResolvedValueOnce(original).mockResolvedValue(signedIn);
  let finishSignIn!: (status: typeof signedIn) => void;
  let finishCancel!: () => void;
  api.waitOpenAiLogin.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSignIn = resolve;
      }),
  );
  api.cancelOpenAiLogin.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finishCancel = resolve;
    });
    finishSignIn(signedIn);
  });
  const wrapper = await openBrowserLogin();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦ai.openSignInInBrowser⟧")!
    .trigger("click");
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦ai.cancelSignIn⟧")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("⟦ai.signInToOpenAI⟧");
  expect(api.cancelOpenAiLogin).toHaveBeenCalledExactlyOnceWith(
    "one",
    "openai-attempt",
  );
  expect(wrapper.text()).toContain("⟦ai.cancellingSignIn⟧");
  finishCancel();
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe(
    '⟦ai.connectProvider:{"name":"OpenAI"}⟧',
  );
  expect(wrapper.text()).toContain("⟦ai.currentAccessRetained:");
  expect(wrapper.text()).not.toContain("⟦ai.aiAccessConnected⟧");
  expect(wrapper.emitted("done")).toBeUndefined();
  wrapper.unmount();
});
test("changing the interface language updates retained errors without clearing credentials", async () => {
  const previous = preferences.value;
  const keyMode = Reflect.get(globalThis, "__SITUATE_LOCALIZATION_KEYS__");
  const wrapper = await openCustom();
  try {
    api.saveConnection.mockRejectedValue("native.ai.access.durability");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
    setPreferences({ ...previous, language: "de" });
    await flushPromises();
    expect(wrapper.get("h1").text()).toBe(de["ai.connectAnEndpoint"]);
    expect(wrapper.get("[role=alert]").text()).not.toContain(
      "native.ai.access.durability",
    );
    expect(wrapper.get("[role=alert]").text()).not.toContain(
      "The AI connection",
    );
    expect((wrapper.get("#ai-key").element as HTMLInputElement).value).toBe(
      "synthetic-secret",
    );
    expect(
      (wrapper.get("#ai-endpoint").element as HTMLInputElement).value,
    ).toBe("http://localhost:8888/v1");
    setPreferences({ ...previous, language: "en" });
    await flushPromises();
    expect(wrapper.get("[role=alert]").text()).toContain(
      "was written, but durable storage could not be confirmed",
    );
    expect((wrapper.get("#ai-key").element as HTMLInputElement).value).toBe(
      "synthetic-secret",
    );
  } finally {
    wrapper.unmount();
    Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", keyMode);
    setPreferences(previous);
  }
});

test("click and Enter require both provider and model, never open access settings, and preserve multiline input", async () => {
  const wrapper = mount(ChatComposer, {
    props: { draft: "Question", connected: false, modelSelected: false },
  });
  await wrapper
    .get('button[aria-label="⟦navigation.sendMessage⟧"]')
    .trigger("click");
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toBeUndefined();
  expect(wrapper.emitted("connect")).toBeUndefined();
  await wrapper.setProps({ connected: true });
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toBeUndefined();
  await wrapper.setProps({ modelSelected: true });
  await wrapper
    .get("textarea")
    .trigger("keydown", { key: "Enter", shiftKey: true });
  await wrapper
    .get("textarea")
    .trigger("keydown", { key: "Enter", isComposing: true });
  expect(wrapper.emitted("send")).toBeUndefined();
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toHaveLength(1);
  await wrapper.setProps({ busy: true });
  await wrapper.get("textarea").trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("send")).toHaveLength(1);
  wrapper.unmount();
});

test("saving another connection confirms the returned record without selecting or reading the existing default", async () => {
  const selected = {
    ...signedIn,
    config: {
      provider: "openai",
      endpoint: null,
      connectionId: "personal",
      label: "Personal",
    },
  };
  const added = {
    ...signedIn,
    config: {
      provider: "custom",
      endpoint: "https://studio.example.invalid/v1",
      connectionId: "studio",
      label: "Studio",
    },
  };
  api.getStatus.mockResolvedValue(selected);
  api.saveConnection.mockResolvedValue(added);
  const wrapper = mount(AiSetup, {
    props: {
      scope: "one",
      workspaceName: "Garden",
      embedded: true,
      connection: added.config,
    },
  });
  await flushPromises();
  await wrapper.get("#ai-form").trigger("submit");
  await flushPromises();
  expect(wrapper.emitted("connected")?.[0]).toEqual([added]);
  expect(api.getStatus).toHaveBeenCalledTimes(1);
});
