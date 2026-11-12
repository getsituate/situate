export const connectionStartingStates = [
  "settings",
  "restored",
  "reconnect",
  "locked",
  "capability",
  "missing",
  "store-denied",
  "store-unavailable",
  "source",
  "access-denied",
  "warning-changed",
  "session-replacement",
] as const;
export const aiFixtures = [
  {
    id: "ai-warning",
    label: "Permitted sign-in with restriction warning",
    state: "warning",
  },
  {
    id: "ai-warning-device",
    label: "Device sign-in with restriction warning",
    state: "warning-device",
  },
  {
    id: "ai-warning-changed",
    label: "Changed restriction before existing access",
    state: "warning-changed",
  },
  {
    id: "ai-blocked-subscription",
    label: "Blocked Anthropic subscription",
    state: "blocked-subscription",
  },
  {
    id: "ai-session-replacement",
    label: "Sign-in would affect another device",
    state: "session-replacement",
  },
  {
    id: "ai-missing",
    label: "New device · AI not configured",
    state: "missing",
  },
  {
    id: "ai-store-denied",
    label: "Secure storage denied",
    state: "store-denied",
  },
  {
    id: "ai-store-unavailable",
    label: "Secure storage unavailable",
    state: "store-unavailable",
  },
  {
    id: "ai-source",
    label: "External credential source unavailable",
    state: "source",
  },
  {
    id: "ai-access-denied",
    label: "Existing provider access denied",
    state: "access-denied",
  },
  {
    id: "ai-offer",
    label: "After workspace creation",
    state: "offer",
  },
  {
    id: "ai-providers",
    label: "Choose provider",
    state: "providers",
  },
  {
    id: "ai-methods",
    label: "Choose sign-in method",
    state: "methods",
  },
  {
    id: "ai-key",
    label: "API key",
    state: "key",
  },
  {
    id: "ai-browser",
    label: "Browser handoff / return",
    state: "browser",
  },
  {
    id: "ai-copy-code",
    label: "Copy-code sign-in",
    state: "copy-code",
  },
  {
    id: "ai-device",
    label: "Device authorization",
    state: "device",
  },
  {
    id: "ai-cloud",
    label: "Cloud credentials",
    state: "cloud",
  },
  {
    id: "ai-endpoint",
    label: "Compatible endpoint",
    state: "endpoint",
  },
  {
    id: "ai-advanced",
    label: "Environment / command",
    state: "advanced",
  },
  {
    id: "ai-connecting",
    label: "Connecting",
    state: "connecting",
  },
  {
    id: "ai-success",
    label: "Connected",
    state: "success",
  },
  {
    id: "ai-cancelled",
    label: "Cancelled",
    state: "cancelled",
  },
  {
    id: "ai-denied",
    label: "Authorization denied",
    state: "denied",
  },
  {
    id: "ai-expired",
    label: "Authorization expired",
    state: "expired",
  },
  {
    id: "ai-offline",
    label: "Provider unreachable",
    state: "offline",
  },
  {
    id: "ai-save-error",
    label: "Local connection save failed",
    state: "save-error",
  },
  {
    id: "ai-settings",
    label: "Workspace settings",
    state: "settings",
  },
  {
    id: "ai-reconnect",
    label: "Reconnect expired access",
    state: "reconnect",
  },
  {
    id: "ai-restored",
    label: "Reopened workspace",
    state: "restored",
  },
  {
    id: "ai-locked",
    label: "Device secure storage locked",
    state: "locked",
  },
  {
    id: "ai-capability",
    label: "No chat model",
    state: "capability",
  },
  {
    id: "ai-unsupported",
    label: "Unavailable on this device",
    state: "unsupported",
  },
] as const;

export const connectionFixtures = aiFixtures.filter(({ state }) =>
  (connectionStartingStates as readonly string[]).includes(state),
);
export const aiScenarios = aiFixtures.filter(
  (fixture) => !connectionFixtures.includes(fixture),
);
