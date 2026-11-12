import { modelChoiceCopy as copy } from "./content";
import {
  aiConnected,
  catalog,
  currentWorkspace,
  eligibleModels,
  resolvedModelId,
  type AiState,
} from "../ai/model";

export type ModelRecovery =
  "reload" | "retry" | "discard" | "check" | "choose" | "inherit";
export interface ModelIssue {
  kind: string;
  title: string;
  detail?: string;
  actions: { id: ModelRecovery; label: string }[];
}
export const modelChoiceBusy = (state: AiState) =>
  ["loading", "saving", "reconciling"].includes(
    currentWorkspace(state).model.phase,
  );
export function modelIssue(state: AiState): ModelIssue | null {
  if (modelChoiceBusy(state)) return null;
  const { model, connection } = currentWorkspace(state);
  const inheritance: ModelIssue["actions"] =
    model.selected && currentWorkspace(state).defaultConnection !== undefined
      ? [{ id: "inherit", label: copy.manualDefault }]
      : [];
  if (model.phase === "save-error") {
    const pending =
      catalog.find(
        (item) =>
          item.provider === connection?.provider && item.id === model.pending,
      )?.name ??
      model.pending ??
      copy.recommended;
    return {
      kind: "save",
      title: "Model choice not saved",
      detail: `${pending ?? "The new choice"} wasn’t saved. Previous choice unchanged.`,
      actions: [
        { id: "retry", label: "Retry save" },
        {
          id: "discard",
          label: copy.keepPrevious,
        },
      ],
    };
  }
  if (model.phase === "uncertain")
    return {
      kind: "uncertain",
      title: "Model choice unconfirmed",
      detail: "The save result is unknown.",
      actions: [
        { id: "check", label: "Check saved choice" },
        { id: "retry", label: "Retry save" },
      ],
    };
  if (!aiConnected(state))
    return {
      kind: "access",
      title: "AI access unavailable",
      detail: "The workspace connection needs attention in Settings.",
      actions: inheritance,
    };
  if (model.phase === "load-error")
    return {
      kind: "catalog",
      title: "Models couldn’t be loaded",
      actions: [{ id: "reload", label: "Retry loading" }, ...inheritance],
    };
  if (currentWorkspace(state).response === "unsaved")
    return {
      kind: "unsaved",
      title: "Response not saved",
      detail: "Save the response before sending another message.",
      actions: [],
    };
  if (model.manual && !resolvedModelId(state))
    return {
      kind: "default",
      title: copy.noDefault,
      detail: copy.configureDefault,
      actions: [{ id: "choose", label: copy.useModelId }],
    };
  const eligible = eligibleModels(state);
  if (!model.manual && !eligible.length)
    return {
      kind: "empty",
      title: "No chat models available",
      actions: inheritance,
    };
  if (
    model.phase === "unavailable" ||
    (resolvedModelId(state) &&
      !model.manual &&
      !eligible.some((item) => item.id === resolvedModelId(state)))
  )
    return {
      kind: "unavailable",
      title: "Model unavailable",
      detail: resolvedModelId(state) ?? undefined,
      actions: [{ id: "choose", label: "Choose model" }, ...inheritance],
    };
  return null;
}
