import type { Model } from "./contracts";
import type { Config, ModelCatalog } from "./api";
import catalog from "./catalog.generated.json";
import transports from "./transport-contract.json";
import policy from "./provider-policy.json";

export interface Provider {
  id: string;
  name: string;
  methods: { id: string; name: string }[];
  models: Model[];
}
interface ProviderPolicy {
  endpoint: string;
  methods: Record<string, { status: string }>;
}
const providerPolicies: Record<string, ProviderPolicy> = policy.providers;
export const providers: Provider[] = (catalog.providers as Provider[])
  .filter((provider) => Object.hasOwn(providerPolicies, provider.id))
  .map((provider) => {
    const methods = provider.methods.filter(
      (method) =>
        providerPolicies[provider.id]?.methods[method.id]?.status ===
        "implemented",
    );
    return {
      ...provider,
      methods,
      models: methods.length ? provider.models : [],
    };
  });
function connectionAllowed(config: Config): boolean {
  if (!Object.hasOwn(providerPolicies, config.provider)) return false;
  const entry = providerPolicies[config.provider]!;
  const method = config.auth === undefined ? "api_key" : config.auth;
  return (
    entry.methods[method]?.status === "implemented" &&
    (entry.endpoint === "none"
      ? config.endpoint === null
      : entry.endpoint === "required" &&
        typeof config.endpoint === "string" &&
        !!config.endpoint.trim())
  );
}
export const supportedApis = new Set(Object.keys(transports.apis));
export function modelAvailable(model: Model): boolean {
  return (
    (model.type === undefined || model.type === "chat") &&
    model.input.includes("text") &&
    supportedApis.has(model.api) &&
    /^https:\/\//u.test(model.baseUrl) &&
    !/[{}]/u.test(model.baseUrl) &&
    Object.keys(model.headers ?? {}).every((name) =>
      transports.modelHeaders.includes(name.toLowerCase()),
    )
  );
}
export const openAiBrowserModels = providers
  .find((provider) => provider.id === "openai")!
  .models.filter(
    (model) =>
      model.api === "openai-responses" &&
      model.baseUrl === "https://api.openai.com/v1" &&
      model.input.includes("text") &&
      modelAvailable(model),
  );
function compatibleChatModels(config: Config): Model[] {
  if (!connectionAllowed(config)) return [];
  if (config.auth === "oauth") {
    if (config.provider === "openai") return openAiBrowserModels;
    if (config.provider === "openai-codex")
      return providers
        .find(({ id }) => id === "openai-codex")!
        .models.filter(
          (model) =>
            model.api === "openai-codex-responses" &&
            model.baseUrl === "https://chatgpt.com/backend-api" &&
            modelAvailable(model),
        );
    return [];
  }
  if (config.endpoint !== null) return [];
  const provider = providers.find(
    (provider) => provider.id === config.provider,
  );
  return provider?.methods.some((method) => method.id === "api_key")
    ? provider.models.filter(modelAvailable)
    : [];
}
export function availableChatModels(
  config: Config,
  discovery?: ModelCatalog,
): Model[] {
  const models = compatibleChatModels(config);
  if (discovery?.source !== "account" && discovery?.source !== "provider")
    return models;
  const ids = new Set(discovery.models);
  return models.filter((model) => ids.has(model.id));
}
export function connectionModel(config: Config, modelId: string): Model {
  if (
    !modelId.trim() ||
    modelId.length > 256 ||
    // eslint-disable-next-line no-control-regex -- Model identifiers must reject protocol control characters.
    /[\u0000-\u001f\u007f]/u.test(modelId)
  )
    throw new Error("ai.chooseAChatModelBeforeSendingAMessage");
  if (
    config.provider === "custom" &&
    connectionAllowed(config) &&
    config.endpoint
  )
    return {
      id: modelId,
      name: modelId,
      provider: "custom",
      api: "openai-completions",
      baseUrl: config.endpoint,
      reasoning: false,
      input: ["text"],
      cost: null,
      contextWindow: 32768,
      maxTokens: 4096,
    };
  const model = availableChatModels(config).find(
    (model) => model.id === modelId,
  );
  if (!model)
    throw new Error("ai.thisChatModelIsUnavailableChooseAnotherModelIn");
  return model;
}
