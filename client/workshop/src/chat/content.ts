import en from "./en.composer-controls.json";
import de from "./de.composer-controls.json";

export const compactControlCopy = { en, de };

export const modelChoiceCopy = {
  recommended: "Recommended",
  thinking: "Thinking level",
  thinkingFixed: "Not adjustable",
  thinkingFixedDetail: "Thinking is not adjustable for this model.",
  thinkingUnknown: "Unknown",
  thinkingUnknownDetail: "Thinking controls are not known for this model.",
  thinkingUnconfigured: "No model available",
  thinkingUnconfiguredDetail: "Connect a provider to configure thinking.",
  recommendedLevel: (level: string) => `Recommended · ${level}`,
  workspaceDefault: "Workspace default",
  overrideDetail:
    "Applies to the next message in this conversation on this device.",
  unavailable: "No suitable model available",
  noAccess: "AI is not configured on this device",
  noDefault: "No suitable default model",
  configureDefault: "Set a default model for this endpoint in Settings.",
  useModelId: "Use a model ID",
  loading: "Loading models…",
  saving: "Saving…",
  checking: "Checking…",
  keepPrevious: "Keep previous choice",
  manualDefault: "Use workspace default",
};
