import { expect, test, vi } from "vitest";
import {
  connectionModel,
  modelAvailable,
  providers,
  type Provider,
  openAiBrowserModels,
  availableChatModels,
} from "./model-catalog";
import { saveConnection, startOpenAiLogin, type Config } from "./api";
import contracts from "./transport-contract.json";
import inventory from "./catalog.generated.json";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
test("browser models and connection routing keep direct ChatGPT and Codex access distinct", () => {
  expect(openAiBrowserModels.length).toBeGreaterThan(0);
  for (const model of openAiBrowserModels) {
    expect(model.provider).toBe("openai");
    expect(model.api).toBe("openai-responses");
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
    expect(model.input).toContain("text");
  }
  expect(() =>
    connectionModel(
      { provider: "openai-codex", endpoint: null, auth: "oauth" },
      "gpt-5.4",
    ),
  ).toThrow();
  expect(() =>
    connectionModel(
      { provider: "openai", endpoint: "https://other.invalid", auth: "oauth" },
      "gpt-5.4",
    ),
  ).toThrow();
});

test("provider setup sends no model choice, and selection is constrained to the configured auth and transport", async () => {
  native.invoke.mockReset();
  native.invoke.mockResolvedValue(undefined);
  const config: Config = { provider: "openai", endpoint: null };
  await saveConnection("one", config, "synthetic-key");
  await startOpenAiLogin("one");
  expect(native.invoke).toHaveBeenCalledWith("ai_save", {
    scope: "one",
    config,
    key: "synthetic-key",
  });
  expect(native.invoke).toHaveBeenCalledWith("ai_openai_start", {
    scope: "one",
  });
  expect(config).not.toHaveProperty("model");
  expect(availableChatModels(config).length).toBeGreaterThan(0);
  expect(
    availableChatModels({
      provider: "anthropic",
      endpoint: null,
      auth: "oauth",
    }),
  ).toEqual([]);
  expect(
    availableChatModels({ provider: "github-copilot", endpoint: null }),
  ).toEqual([]);
  expect(
    availableChatModels({
      provider: "custom",
      endpoint: "http://localhost:8888/v1",
    }),
  ).toEqual([]);
  expect(() => connectionModel(config, "claude-sonnet-4-5")).toThrow();
  expect(() => connectionModel(config, "")).toThrow();
  expect(() =>
    connectionModel(
      { provider: "custom", endpoint: "http://localhost:8888/v1" },
      "",
    ),
  ).toThrow();
  expect(
    connectionModel(
      { provider: "custom", endpoint: "http://localhost:8888/v1" },
      "manual-model",
    ).id,
  ).toBe("manual-model");
});

test("models needing unintegrated provider headers are unavailable; safe fixed metadata is retained", () => {
  const researchProviders = inventory.providers as Provider[];
  const copilot = researchProviders.find(
    (provider) => provider.id === "github-copilot",
  )!;
  expect(copilot.models.length).toBeGreaterThan(0);
  expect(copilot.models.every((model) => !modelAvailable(model))).toBe(true);
  const nvidia = researchProviders
    .find((provider) => provider.id === "nvidia")!
    .models.filter(modelAvailable);
  expect(nvidia.length).toBeGreaterThan(0);
  for (const model of nvidia)
    expect(model.headers?.["NVCF-POLL-SECONDS"]).toBe("3600");
  for (const provider of providers)
    for (const model of provider.models.filter(modelAvailable)) {
      expect(
        Object.keys(model.headers ?? {}).every((name) =>
          contracts.modelHeaders.includes(name.toLowerCase()),
        ),
      ).toBe(true);
    }
});
