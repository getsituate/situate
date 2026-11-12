import {
  currentWorkspace,
  eligibleModels,
  resolvedModelId,
  type AiState,
  type WorkspaceName,
} from "../ai/model";

export type ThinkingLevel = "low" | "medium" | "high";
export type ThinkingPreference = ThinkingLevel | "recommended";
export type ThinkingSelection = ThinkingPreference | null;
export type ThinkingChoices = Record<
  WorkspaceName,
  Record<string, ThinkingPreference>
>;
export interface ThinkingCapability {
  levels: ThinkingLevel[];
  default: ThinkingLevel;
}
const capabilities: Record<string, ThinkingCapability> = {
  "openai/example-reasoning-long": {
    levels: ["low", "medium", "high"],
    default: "medium",
  },
  "openai/example-desktop": { levels: ["low", "high"], default: "low" },
};
export const thinkingLabels: Record<ThinkingLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
export function modelThinkingCapability(provider: string, model: string) {
  return capabilities[`${provider}/${model}`];
}
export function resolveThinking(
  capability: ThinkingCapability,
  preference?: ThinkingPreference,
): ThinkingLevel {
  return preference &&
    preference !== "recommended" &&
    capability.levels.includes(preference)
    ? preference
    : capability.default;
}
export function thinkingKey(ai: AiState): string {
  const { connection } = currentWorkspace(ai);
  return `${connection?.provider}/${resolvedModelId(ai)}`;
}
export function thinkingCapability(ai: AiState) {
  const { model, connection } = currentWorkspace(ai);
  if (
    model.manual ||
    !eligibleModels(ai).some((item) => item.id === resolvedModelId(ai))
  )
    return undefined;
  return modelThinkingCapability(connection!.provider, resolvedModelId(ai)!);
}
export function validThinkingSelection(
  ai: AiState,
  value: ThinkingSelection,
): boolean {
  const capability = thinkingCapability(ai);
  return (
    !!capability &&
    (value === null ||
      value === "recommended" ||
      capability.levels.includes(value))
  );
}
export function workspaceThinking(ai: AiState): ThinkingPreference {
  return (
    currentWorkspace(ai).thinkingDefaults[thinkingKey(ai)] ?? "recommended"
  );
}
export function selectedThinking(
  ai: AiState,
  choices: ThinkingChoices,
): ThinkingLevel | null {
  const capability = thinkingCapability(ai);
  if (!capability) return null;
  return resolveThinking(
    capability,
    choices[ai.workspace][thinkingKey(ai)] ?? workspaceThinking(ai),
  );
}
