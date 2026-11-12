import { expect, test, vi } from "vitest";
import type { Config } from "./api";
import inventory from "./catalog.generated.json";
import policy from "./provider-policy.json";
import {
  availableChatModels,
  connectionModel,
  modelAvailable,
  providers,
} from "./model-catalog";

test("setup exposes only supported providers and authentication methods", () => {
  expect(providers.map(({ id }) => id).sort()).toEqual([
    "anthropic",
    "openai",
    "openai-codex",
    "openrouter",
  ]);
  expect(
    providers.find(({ id }) => id === "openai")?.methods.map(({ id }) => id),
  ).toEqual(["api_key", "oauth"]);
  for (const id of ["anthropic", "openrouter"])
    expect(
      providers
        .find((provider) => provider.id === id)
        ?.methods.map(({ id }) => id),
    ).toEqual(["api_key"]);
  expect(
    providers
      .find(({ id }) => id === "openai-codex")
      ?.methods.map(({ id }) => id),
  ).toEqual(["oauth"]);
  expect(policy.providers["openai-codex"].methods.oauth).toEqual({
    status: "implemented",
    flow: "device",
  });
});

test.each([
  ["openai", "gpt-5.4"],
  ["anthropic", "claude-sonnet-4-6"],
  ["openrouter", "openai/gpt-4o"],
])(
  "%s API-key models resolve with explicit and legacy authentication",
  (provider, modelId) => {
    for (const auth of [undefined, "api_key"] as const) {
      const config = { provider, endpoint: null, auth };
      expect(availableChatModels(config).map(({ id }) => id)).toContain(
        modelId,
      );
      expect(connectionModel(config, modelId)).toMatchObject({
        id: modelId,
        provider,
      });
    }
  },
);

test.each(["account", "provider"] as const)(
  "%s discovery intersects IDs with compatible metadata without inventing models",
  (source) => {
    const config: Config = {
      provider: "openai",
      endpoint: null,
      auth: "oauth",
    };
    expect(
      availableChatModels(config, {
        source,
        models: [
          "gpt-4o-mini",
          "unknown-model",
          "claude-sonnet-5-5",
          "gpt-4o-mini",
        ],
      }).map((model) => model.id),
    ).toEqual(["gpt-4o-mini"]);
    expect(availableChatModels(config, { source, models: [] })).toEqual([]);
    expect(connectionModel(config, "gpt-6.1-sol").id).toBe("gpt-6.1-sol");
  },
);
test.each(["static", "unknown"] as const)(
  "%s retains statically compatible manual choices",
  (source) => {
    const config: Config = { provider: "openai", endpoint: null };
    expect(availableChatModels(config, { source, models: [] })).toEqual(
      availableChatModels(config),
    );
  },
);
test("connection-specific catalogs do not reuse another connection's same-provider candidates", () => {
  const config: Config = { provider: "openai", endpoint: null };
  expect(
    availableChatModels(
      { ...config, connectionId: "one" },
      { source: "account", models: ["gpt-4o-mini"] },
    ).map((model) => model.id),
  ).toEqual(["gpt-4o-mini"]);
  expect(
    availableChatModels(
      { ...config, connectionId: "two" },
      { source: "account", models: ["gpt-6.1-sol"] },
    ).map((model) => model.id),
  ).toEqual(["gpt-6.1-sol"]);
});

test("Codex eligibility requires its own authentication, protocol and destination", async () => {
  const catalog = await import("./model-catalog");
  const models = catalog.availableChatModels({
    provider: "openai-codex",
    endpoint: null,
    auth: "oauth",
  });
  expect(models.length).toBeGreaterThan(0);
  for (const model of models)
    expect(model).toMatchObject({
      provider: "openai-codex",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
    });
  for (const auth of [undefined, "api_key"] as const)
    expect(
      catalog.availableChatModels({
        provider: "openai-codex",
        endpoint: null,
        auth,
      }),
    ).toEqual([]);
  expect(
    catalog.availableChatModels({
      provider: "openai-codex",
      endpoint: "https://other.invalid",
      auth: "oauth",
    }),
  ).toEqual([]);
});

test("planned authentication is ineligible even when a catalog and adapter exist", async () => {
  vi.resetModules();
  vi.doMock("./provider-policy.json", () => ({
    default: {
      ...policy,
      providers: {
        ...policy.providers,
        "openai-codex": {
          endpoint: "none",
          methods: { oauth: { status: "planned", flow: "device" } },
        },
      },
    },
  }));
  try {
    const catalog = await import("./model-catalog");
    expect(
      catalog.availableChatModels({
        provider: "openai-codex",
        endpoint: null,
        auth: "oauth",
      }),
    ).toEqual([]);
  } finally {
    vi.doUnmock("./provider-policy.json");
    vi.resetModules();
  }
});

test("direct OpenAI browser access survives independently of Codex", () => {
  const config: Config = { provider: "openai", endpoint: null, auth: "oauth" };
  expect(availableChatModels(config).map(({ id }) => id)).toContain("gpt-5.4");
  expect(connectionModel(config, "gpt-5.4")).toMatchObject({
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
  });
});

test("non-chat records are ineligible even when their transport supports text", () => {
  const model = connectionModel(
    { provider: "openai", endpoint: null },
    "gpt-5.4",
  );
  for (const type of ["classifier", "image"])
    expect(modelAvailable({ ...model, type } as typeof model)).toBe(false);
});

const deferred = inventory.providers.filter(
  ({ id }) =>
    !["openai", "openai-codex", "anthropic", "openrouter"].includes(id),
);
test.each(deferred)(
  "$id cannot resolve a catalog model through any authentication method",
  (provider) => {
    for (const auth of [undefined, "api_key", "oauth"] as const) {
      const config = { provider: provider.id, endpoint: null, auth };
      expect(availableChatModels(config)).toEqual([]);
      expect(() =>
        connectionModel(config, provider.models[0]?.id ?? "model"),
      ).toThrow("ai.thisChatModelIsUnavailableChooseAnotherModelIn");
    }
  },
);

test.each(["anthropic", "openrouter"])(
  "%s browser access cannot resolve key models",
  (provider) => {
    const config: Config = { provider, endpoint: null, auth: "oauth" };
    expect(availableChatModels(config)).toEqual([]);
    expect(() =>
      connectionModel(
        config,
        inventory.providers.find(({ id }) => id === provider)!.models[0]!.id,
      ),
    ).toThrow("ai.thisChatModelIsUnavailableChooseAnotherModelIn");
  },
);

test("unknown authentication and named endpoint overrides fail closed", () => {
  for (const provider of [
    "openai",
    "anthropic",
    "openrouter",
    "custom",
    "unknown",
    "toString",
    "__proto__",
  ]) {
    for (const auth of ["device", "none", "", null]) {
      const config = {
        provider,
        endpoint: provider === "custom" ? "http://localhost:8888/v1" : null,
        auth,
      } as Config;
      expect(availableChatModels(config)).toEqual([]);
      expect(() => connectionModel(config, "gpt-5.4")).toThrow();
    }
  }
  for (const provider of ["openai", "anthropic", "openrouter"])
    for (const auth of ["api_key", "oauth"] as const) {
      const config = { provider, endpoint: "http://localhost:8888/v1", auth };
      expect(availableChatModels(config)).toEqual([]);
      expect(() => connectionModel(config, "gpt-5.4")).toThrow();
    }
});

test("custom endpoints retain explicit model selection and optional key access, never OAuth", () => {
  expect(policy.providers.custom.methods.api_key.key).toBe("optional");
  for (const auth of [undefined, "api_key"] as const) {
    const config = {
      provider: "custom",
      endpoint: "http://localhost:8888/v1",
      auth,
    };
    expect(availableChatModels(config)).toEqual([]);
    expect(connectionModel(config, "local-model")).toMatchObject({
      id: "local-model",
      provider: "custom",
      api: "openai-completions",
      baseUrl: config.endpoint,
      cost: null,
    });
  }
  for (const endpoint of [null, "", " "])
    expect(() =>
      connectionModel({ provider: "custom", endpoint }, "local-model"),
    ).toThrow();
  expect(() =>
    connectionModel(
      {
        provider: "custom",
        endpoint: "http://localhost:8888/v1",
        auth: "oauth",
      },
      "local-model",
    ),
  ).toThrow();
});
