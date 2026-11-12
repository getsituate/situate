import { catalog } from "../ai/model";
import {
  modelThinkingCapability,
  resolveThinking,
  type ThinkingPreference,
} from "../chat/thinking";
import type { SettingsState } from "./model";
import { modelChoiceCopy as copy } from "../chat/content";

function settingsModel(state: SettingsState) {
  if (state.useManaged) return undefined;
  const connection = state.connections[state.provider];
  if (!connection) return undefined;
  const eligible = catalog.filter(
    (model) =>
      model.provider === connection.provider &&
      model.chat &&
      model.platform &&
      model.methods.includes(connection.method),
  );
  return state.chatModel === "recommended"
    ? eligible[0]
    : eligible.find(
        (model) =>
          model.id === state.chatModel ||
          model.name === state.chatModel ||
          ("settingsLabel" in model && model.settingsLabel === state.chatModel),
      );
}
export function settingsThinkingUnavailable(state: SettingsState) {
  if (!state.provider || !state.connections[state.provider])
    return {
      label: copy.thinkingUnconfigured,
      detail: copy.thinkingUnconfiguredDetail,
    };
  if (!settingsModel(state))
    return { label: copy.thinkingUnknown, detail: copy.thinkingUnknownDetail };
  return { label: copy.thinkingFixed, detail: copy.thinkingFixedDetail };
}
export function settingsThinking(state: SettingsState) {
  const model = settingsModel(state);
  if (!model) return undefined;
  const capability = modelThinkingCapability(model.provider, model.id);
  if (!capability || capability.levels.length < 2) return undefined;
  const key = `${model.provider}/${model.id}`;
  const preference = state.thinkingDefaults[key] ?? "recommended";
  return {
    key,
    capability,
    preference,
    level: resolveThinking(capability, preference),
  };
}
export function setSettingsThinking(
  state: SettingsState,
  value: ThinkingPreference,
) {
  const model = settingsThinking(state);
  if (
    !model ||
    (value !== "recommended" && !model.capability.levels.includes(value))
  )
    return;
  state.thinkingDefaults[model.key] = value;
}
