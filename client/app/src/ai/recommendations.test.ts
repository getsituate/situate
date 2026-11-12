import { expect, test } from "vitest";
import {
  commentThinking,
  modelChoice,
  modelAvailability,
  rankModelChoices,
  recommendedChoice,
  supportedThinkingLevels,
  type RankedCandidate,
} from "./recommendations";
import catalog from "./model-recommendations.json";
import { providers, availableChatModels } from "./model-catalog";
const openai = { provider: "openai", endpoint: null };
const models = availableChatModels(openai);
const sol = models.find((model) => model.id === "gpt-6.1-sol")!;
const mini = models.find((model) => model.id === "gpt-4o-mini")!;
const synthetic: RankedCandidate[] = [
  {
    provider: "openai",
    access: "api_key",
    modelId: mini.id,
    api: mini.api,
    thinking: "off",
    priority: { chat: 20, comment: 5 },
    eligibility: "supported",
  },
  {
    provider: "openai",
    access: "api_key",
    modelId: sol.id,
    api: sol.api,
    thinking: "medium",
    priority: { chat: 10, comment: 10 },
    eligibility: "supported",
  },
];
test.each(["account", "provider"] as const)(
  "%s observations constrain rankings without changing explicit choices",
  (source) => {
    const discovery = { source, models: ["gpt-4o-mini"] };
    const availability = modelAvailability(
      discovery,
      availableChatModels(openai, discovery),
    );
    expect(availability.source).toBe(source);
    expect(recommendedChoice(openai, "chat", availability)?.model).toBe(
      "gpt-4o-mini",
    );
    expect(recommendedChoice(openai, "comment", availability)?.thinking).toBe(
      "off",
    );
    expect(
      modelChoice(openai, "gpt-6.1-sol", {
        model: "gpt-6.1-sol",
        thinking: "high",
        catalogRevision: null,
      }),
    ).toMatchObject({ model: "gpt-6.1-sol", thinking: "high" });
    expect(
      recommendedChoice(
        openai,
        "chat",
        modelAvailability({ source, models: [] }, []),
      ),
    ).toBeNull();
  },
);
test("unknown discovery or unloaded metadata cannot recommend while legacy static statuses can", () => {
  expect(
    modelAvailability({ source: "unknown", models: [mini.id] }, models),
  ).toEqual({ source: "unknown" });
  expect(modelAvailability({ source: "account", models: [mini.id] })).toEqual({
    source: "unknown",
  });
  expect(
    recommendedChoice(openai, "chat", modelAvailability(undefined, models))
      ?.model,
  ).toBe("gpt-6.1-sol");
  expect(
    recommendedChoice(
      openai,
      "chat",
      modelAvailability({ source: "static", models: [] }, models),
    )?.model,
  ).toBe("gpt-6.1-sol");
});
test("every provider and advertised access method has explicit reviewed coverage", () => {
  for (const provider of providers) {
    const entry = catalog.providers.find(
      (entry) => entry.provider === provider.id,
    );
    expect(entry, provider.id).toBeDefined();
    for (const method of provider.methods)
      expect(
        Object.keys(entry!.access),
        `${provider.id}/${method.id}`,
      ).toContain(method.id);
  }
});
test("static recommendations identify compatibility, not confirmed account entitlement", () => {
  for (const auth of ["api_key", "oauth"] as const) {
    expect(recommendedChoice({ ...openai, auth })).toEqual({
      model: "gpt-6.1-sol",
      thinking: "medium",
      catalogRevision: "2026-10-08.1",
    });
    expect(recommendedChoice({ ...openai, auth }, "comment")?.thinking).toBe(
      auth === "api_key" ? "off" : "low",
    );
  }
  expect(recommendedChoice(openai, "chat", { source: "unknown" })).toBeNull();
  expect(
    recommendedChoice(openai, "chat", { source: "account", models: [] }),
  ).toBeNull();
  expect(
    recommendedChoice(openai, "chat", { source: "account", models: [mini] })
      ?.model,
  ).toBe("gpt-4o-mini");
  expect(
    recommendedChoice(openai, "chat", {
      source: "account",
      models: [{ ...mini, id: "unranked" }],
    }),
  ).toBeNull();
});
test("explicit priority skips unavailable candidates for distinct account catalogs", () => {
  const first = rankModelChoices(
    openai,
    "chat",
    { source: "account", models: [mini, sol] },
    synthetic,
  );
  const second = rankModelChoices(
    openai,
    "chat",
    { source: "account", models: [mini] },
    synthetic,
  );
  expect(first.map((choice) => choice.model)).toEqual([
    "gpt-6.1-sol",
    "gpt-4o-mini",
  ]);
  expect(second.map((choice) => choice.model)).toEqual(["gpt-4o-mini"]);
  expect(
    rankModelChoices(
      openai,
      "chat",
      { source: "account", models: [sol, mini] },
      [...synthetic].reverse(),
    ),
  ).toEqual(first);
  expect(
    rankModelChoices(
      openai,
      "comment",
      { source: "account", models: [mini, sol] },
      synthetic,
    )[0],
  ).toEqual({
    model: "gpt-4o-mini",
    thinking: "off",
    catalogRevision: "2026-10-08.1",
  });
});
test("unsuitable higher ranks do not hide the next suitable candidate", () => {
  for (const unsuitable of [
    { ...sol, input: [] },
    { ...sol, type: "classifier" },
    { ...sol, api: "unsupported" },
    { ...sol, baseUrl: "http://example.invalid" },
  ]) {
    const choices = rankModelChoices(
      openai,
      "chat",
      { source: "account", models: [unsuitable as typeof sol, mini] },
      synthetic,
    );
    expect(choices[0]?.model).toBe("gpt-4o-mini");
  }
  const unverified = synthetic.map((entry) =>
    entry.modelId === sol.id ? { ...entry, thinking: "xhigh" } : entry,
  );
  expect(
    rankModelChoices(
      openai,
      "chat",
      { source: "account", models: [sol, mini] },
      unverified,
    )[0]?.model,
  ).toBe("gpt-4o-mini");
});
test("qualified defaults use the real ranked data for each implemented method", () => {
  const anthropic = { provider: "anthropic", endpoint: null };
  const router = { provider: "openrouter", endpoint: null };
  expect(recommendedChoice(anthropic)?.model).toBe("claude-sonnet-5-5");
  expect(recommendedChoice(anthropic, "comment")?.thinking).toBe("low");
  expect(recommendedChoice(router)?.model).toBe("openai/gpt-6.1-sol");
  expect(recommendedChoice(router, "comment")?.model).toBe(
    "openai/gpt-4o-mini",
  );
  const restricted = availableChatModels(router).filter(
    (model) => model.id === "openai/gpt-4o-mini",
  );
  expect(
    recommendedChoice(router, "chat", { source: "account", models: restricted })
      ?.model,
  ).toBe("openai/gpt-4o-mini");
  const pending = catalog.rankedCandidates.map((entry) => ({
    ...entry,
    eligibility: "pending-validation",
  }));
  expect(
    rankModelChoices(openai, "chat", { source: "static", models }, pending),
  ).toEqual([]);
});
test("unavailable authentication and unknown custom catalogs have no default", () => {
  for (const config of [
    { provider: "anthropic", auth: "oauth", endpoint: null },
    { provider: "openrouter", auth: "oauth", endpoint: null },
    { provider: "custom", endpoint: "https://example.invalid/v1" },
  ] as const)
    expect(recommendedChoice(config)).toBeNull();
  expect(
    catalog.rankedCandidates.find((entry) => entry.provider === "openai-codex")
      ?.eligibility,
  ).toBe("supported");
  const codex = {
    provider: "openai-codex",
    auth: "oauth",
    endpoint: null,
  } as const;
  expect(recommendedChoice(codex)).toMatchObject({
    model: "gpt-6.1-sol",
    thinking: "medium",
  });
  expect(recommendedChoice(codex, "comment")).toMatchObject({
    model: "gpt-6.1-sol",
    thinking: "low",
  });
  expect(
    supportedThinkingLevels(
      { provider: "openai-codex", auth: "oauth", endpoint: null },
      "gpt-6.1-sol",
    ),
  ).toEqual(["low", "medium", "high"]);
});
test("thinking is model-specific and custom endpoints do not inherit defaults", () => {
  expect(supportedThinkingLevels(openai, sol.id)).toEqual([
    "low",
    "medium",
    "high",
  ]);
  expect(supportedThinkingLevels(openai, mini.id)).toEqual(["off"]);
  expect(commentThinking(openai, sol.id)).toBe("low");
  expect(
    modelChoice(openai, sol.id, {
      model: sol.id,
      thinking: "xhigh",
      catalogRevision: null,
    }).thinking,
  ).toBe("medium");
  expect(
    modelChoice(openai, sol.id, {
      model: sol.id,
      thinking: "high",
      catalogRevision: null,
    }).thinking,
  ).toBe("high");
  expect(
    modelChoice({ ...openai, endpoint: "https://example.invalid" }, sol.id)
      .thinking,
  ).toBe("off");
});
