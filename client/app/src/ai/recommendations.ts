import {
  revision,
  rankedCandidates,
  staticModels,
  verifiedThinking,
} from "./model-recommendations.json";
import type { Config, ModelCatalog } from "./api";
import type { ModelChoice, ThinkingLevel } from "./settings";
import transports from "./transport-contract.json";
import policy from "./provider-policy.json";

type EligibleModel = {
  id: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevels?: readonly ThinkingLevel[];
  reasoningNone?: boolean;
  input: readonly string[];
  type?: string;
  headers?: Record<string, string>;
};
const methods: Record<string, { methods: Record<string, { status: string }> }> =
  policy.providers;
function modelEligible(config: Config, model: EligibleModel): boolean {
  return (
    methods[config.provider]?.methods[config.auth ?? "api_key"]?.status ===
      "implemented" &&
    (model.type === undefined || model.type === "chat") &&
    model.input.includes("text") &&
    Object.hasOwn(transports.apis, model.api) &&
    model.baseUrl.startsWith("https://") &&
    !/[{}]/u.test(model.baseUrl) &&
    Object.keys(model.headers ?? {}).every((name) =>
      transports.modelHeaders.includes(name.toLowerCase()),
    ) &&
    (config.auth !== "oauth" ||
      config.provider !== "openai" ||
      (model.api === "openai-responses" &&
        model.baseUrl === "https://api.openai.com/v1"))
  );
}

export interface RankedCandidate {
  provider: string;
  access: string;
  modelId: string;
  api: string;
  thinking: string;
  priority: { chat?: number; comment?: number };
  discoveryOnly?: boolean;
  eligibility: string;
}
export type ModelAvailability =
  | {
      source: "static" | "account" | "provider";
      models: readonly EligibleModel[];
    }
  | { source: "unknown" };

export function modelAvailability(
  catalog: ModelCatalog | undefined,
  models?: readonly EligibleModel[],
): ModelAvailability {
  if (!models || catalog?.source === "unknown" || catalog?.source === "manual")
    return { source: "unknown" };
  return { source: catalog?.source ?? "static", models };
}

export const recommendationRevision = revision;
export function supportedThinkingLevels(
  config: Config,
  modelId: string,
  catalog?: ModelCatalog,
): ThinkingLevel[] {
  const discovered = catalog?.selectable?.find(({ id }) => id === modelId);
  if (discovered) {
    const levels = discovered.thinkingLevels ?? [];
    return discovered.reasoningNone ||
      config.provider === "anthropic" ||
      !levels.length
      ? ["off", ...levels]
      : levels;
  }
  const verified =
    config.endpoint === null &&
    verifiedThinking.find(
      (entry) =>
        entry.provider === config.provider && entry.modelId === modelId,
    );
  return verified ? (verified.levels as ThinkingLevel[]) : ["off"];
}
export function commentThinking(
  config: Config,
  modelId: string,
  model?: { reasoning: boolean },
  catalog?: ModelCatalog,
): ThinkingLevel {
  const levels = supportedThinkingLevels(config, modelId, catalog);
  if (model?.reasoning && levels.length === 1 && levels[0] === "off")
    throw new Error("ai.noEligibleChatModelsAreAvailableForThisConnection");
  return levels[0]!;
}
export function modelChoice(
  config: Config,
  model: string,
  previous?: ModelChoice | null,
  catalog?: ModelCatalog,
): ModelChoice {
  const levels = supportedThinkingLevels(config, model, catalog);
  const verified =
    config.endpoint === null &&
    verifiedThinking.find(
      (entry) => entry.provider === config.provider && entry.modelId === model,
    );
  return {
    model,
    thinking:
      previous?.model === model &&
      (previous.thinking === "recommended" ||
        levels.includes(previous.thinking))
        ? previous.thinking
        : ((verified && levels.includes(verified.default as ThinkingLevel)
            ? (verified.default as ThinkingLevel)
            : undefined) ??
          (catalog?.selectable?.some(({ id }) => id === model)
            ? "recommended"
            : levels[0]!)),
    catalogRevision: null,
  };
}
export function rankModelChoices(
  config: Config,
  kind: "chat" | "comment",
  availability: ModelAvailability,
  candidates: readonly RankedCandidate[] = rankedCandidates,
): ModelChoice[] {
  if (config.endpoint !== null || availability.source === "unknown") return [];
  return candidates
    .filter(
      (entry) =>
        entry.eligibility === "supported" &&
        entry.provider === config.provider &&
        entry.access === (config.auth ?? "api_key") &&
        (!entry.discoveryOnly || availability.source !== "static"),
    )
    .flatMap((entry) => {
      const priority = entry.priority[kind];
      return priority === undefined ? [] : [{ entry, priority }];
    })
    .sort((a, b) => a.priority - b.priority)
    .flatMap(({ entry }) => {
      const model = availability.models.find(
        (model) =>
          model.provider === config.provider &&
          model.id === entry.modelId &&
          model.api === entry.api &&
          modelEligible(config, model),
      );
      if (!model) return [];
      const levels = model.thinkingLevels
        ? (["off", ...model.thinkingLevels] as const)
        : supportedThinkingLevels(config, model.id);
      if (
        !levels.includes(entry.thinking as ThinkingLevel) ||
        (model.reasoning && levels.length === 1 && levels[0] === "off")
      )
        return [];
      const minimum =
        model.thinkingLevels?.length &&
        !model.reasoningNone &&
        config.provider !== "anthropic"
          ? model.thinkingLevels[0]!
          : levels[0]!;
      return [
        {
          model: model.id,
          thinking:
            kind === "comment" ||
            (model.thinkingLevels && entry.thinking === "off")
              ? minimum
              : (entry.thinking as ThinkingLevel),
          catalogRevision: recommendationRevision,
        },
      ];
    });
}
const staticAvailability: ModelAvailability = {
  source: "static",
  models: staticModels,
};

export function recommendedChoice(
  config: Config,
  kind: "chat" | "comment" = "chat",
  availability: ModelAvailability = staticAvailability,
): ModelChoice | null {
  return rankModelChoices(config, kind, availability)[0] ?? null;
}
