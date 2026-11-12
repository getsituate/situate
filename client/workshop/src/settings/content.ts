import { accessProblems, securityCopy } from "../ai/content";

export const attentionCopy: Record<
  string,
  { status: string; detail: string; action?: string }
> = {
  reconnect: {
    status: "Sign in again to use this connection",
    detail: accessProblems.reconnect[1],
    action: "Reconnect",
  },
  missing: {
    status: accessProblems.missing[0],
    detail: accessProblems.missing[1],
    action: "Connect again",
  },
  locked: {
    status: accessProblems.locked[0],
    detail: accessProblems.locked[1],
    action: "Try again",
  },
  "store-denied": {
    status: accessProblems["store-denied"][0],
    detail: accessProblems["store-denied"][1],
    action: "Try again",
  },
  "store-unavailable": {
    status: accessProblems["store-unavailable"][0],
    detail: accessProblems["store-unavailable"][1],
    action: "Try again",
  },
  source: {
    status: accessProblems.source[0],
    detail: accessProblems.source[1],
    action: "Reconnect",
  },
  "access-denied": {
    status: accessProblems["access-denied"][0],
    detail: accessProblems["access-denied"][1],
    action: "Reconnect",
  },
  restriction: {
    status: "Provider rules have changed",
    detail: securityCopy.guard,
    action: securityCopy.review,
  },
  capability: {
    status: "No chat models available",
    detail:
      "This provider has no chat models. Choose another connected provider.",
  },
};
export const deviceAiCopy = {
  scope: "This device",
  scopeDetail:
    "Provider connections and model choices apply only to this workspace on this device. Your notes and chats can still sync.",
  emptyTitle: "Set up AI on this device",
  emptyDetail:
    "Choose a provider to start chatting here. Your notes, tasks and conversations are ready to use without AI.",
  managedTitle: "Situate AI",
  managedAvailable: "Available with your Situate account",
  managedDetail:
    "No provider setup needed on this device. Situate chooses a suitable model for your requests.",
  managedUse: "Use Situate AI",
  managedSelected: "Selected on this device",
  selected: (provider: string) =>
    `${provider} selected for this workspace on this device.`,
  disconnected: (provider: string) =>
    `${provider} disconnected on this device.`,
  managedUnavailable:
    "Situate AI is unavailable. Choose a connected provider or wait until access is available again. Your selection has not changed.",
  managedModel:
    "Situate chooses the model. Your own provider and model preferences are kept for when you switch back.",
  providerHelp:
    "Used for the next replies on this device. Choosing a connection does not change other devices.",
  modelHelp:
    "Changes apply to the next message on this device, not to earlier replies or other devices.",
  disconnect: (provider: string, workspace: string) =>
    `This disconnects ${provider} from “${workspace}” on this device only. Other devices and workspaces are unchanged. Permissions at the provider stay in place.`,
} as const;
export const connectionCopy = {
  heading: "Connections",
  add: "+ Add connection",
  selection: "Chat connection",
  choose: "Choose a connection",
  selectBeforeChat: "Choose a connection before sending a message.",
  selected: "Selected for chat",
  disconnect: "Disconnect connection",
  rename: "Rename",
  renameTitle: "Name this connection",
  name: "Connection name",
  nameHelp: "Use a name that helps you tell your accounts and servers apart.",
  nameRequired: "Enter a name between 1 and 80 characters.",
  nameDuplicate:
    "Another connection already uses this name. Choose a different name.",
  saveName: "Save name",
  connected: (name: string) => `${name} connected.`,
  renamed: (name: string) => `Connection renamed to ${name}.`,
  manage: "Manage",
  manageProvider: (provider: string) => `Manage ${provider}`,
  back: "Back to AI & models",
  retrying: "Trying…",
  retryPending: securityCopy.storePending,
  reconnectProvider: (provider: string) =>
    `Reconnect ${provider} before sending a message.`,
};
export const catalogCopy = {
  heading: "Available models",
  refresh: "Refresh models",
  retry: "Try again",
  loading: "Loading models…",
  error: "Models couldn’t be refreshed. Your saved choices are unchanged.",
  unknown:
    "This connection’s available models could not be established. Your saved choices are unchanged.",
  empty: "No suitable chat models were found. Your connection is saved.",
  loaded: (count: number) => `${count} chat models listed`,
  source: {
    account: "Account model list",
    provider: "Provider model list",
    compatibility: "Built-in compatibility list",
  },
  listingDetail:
    "A listed model does not confirm permission to use it or available credit. No chat request is sent to refresh this list.",
  unavailable: (name: string) => `${name} · Not in the current list`,
  unavailableDetail:
    "Your saved model is not in the current list. Choose an available model or refresh the list. It has not been replaced.",
  manual: "Model ID",
  manualHelp:
    "Use the exact model ID supplied by your server. Compatibility and access are checked when you send a request.",
  manualSave: "Use model ID",
};
