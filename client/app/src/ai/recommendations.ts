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
  priority: { chat: number; comment: number };
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
  if (!models || catalog?.source === "unknown") return { source: "unknown" };
  return { source: catalog?.source ?? "static", models };
}

export const recommendationRevision = revision;
export function supportedThinkingLevels(
  config: Config,
  modelId: string,
): ThinkingLevel[] {
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
): ThinkingLevel {
  const levels = supportedThinkingLevels(config, modelId);
  if (model?.reasoning && levels.length === 1 && levels[0] === "off")
    throw new Error("ai.noEligibleChatModelsAreAvailableForThisConnection");
  return levels[0]!;
}
export function modelChoice(
  config: Config,
  model: string,
  previous?: ModelChoice | null,
): ModelChoice {
  const levels = supportedThinkingLevels(config, model);
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
        : ((verified ? (verified.default as ThinkingLevel) : undefined) ??
          levels[0]!),
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
        entry.access === (config.auth ?? "api_key"),
    )
    .sort((a, b) => a.priority[kind] - b.priority[kind])
    .flatMap((entry) => {
      const model = availability.models.find(
        (model) =>
          model.provider === config.provider &&
          model.id === entry.modelId &&
          model.api === entry.api &&
          modelEligible(config, model),
      );
      if (!model) return [];
      const levels = supportedThinkingLevels(config, model.id);
      if (
        !levels.includes(entry.thinking as ThinkingLevel) ||
        (model.reasoning && levels.length === 1 && levels[0] === "off")
      )
        return [];
      return [
        {
          model: model.id,
          thinking:
            kind === "comment" ? levels[0]! : (entry.thinking as ThinkingLevel),
          catalogRevision: recommendationRevision,
        },
      ];
    });
}
export function recommendedChoice(
  config: Config,
  kind: "chat" | "comment" = "chat",
  availability: ModelAvailability = {
    source: "static",
    models: staticModels,
  },
): ModelChoice | null {
  return rankModelChoices(config, kind, availability)[0] ?? null;
}
