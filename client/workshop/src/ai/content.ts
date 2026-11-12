import { methods, providers } from "./providers";
import type { AiState } from "./model";
export const transportCopy = {
  title: "Connect without encryption?",
  warning:
    "This HTTP connection is not encrypted. Prompts, chat contents, responses and any API keys sent to this address may be exposed to others on the network.",
  destination: "Destination",
  continue: "Connect to this address",
  cancel: "Back to address",
  invalid:
    "Enter a valid HTTP or HTTPS URL without embedded credentials or a fragment.",
};
export const inventoryCopy = {
  addAnother: "Add another connection",
  exploration: "Explore deferred providers and methods",
  chatgpt: "Sign in with ChatGPT",
  chatgptDetail: "Use your ChatGPT account through direct browser sign-in.",
  key: "API key",
};
export const securityCopy = {
  title: "Before you connect",
  changedTitle: "Before you continue",
  scope: (workspace: string) => `${workspace} · This device`,
  blockedTitle: "This subscription can’t connect",
  anthropic:
    "Anthropic does not allow Claude subscriptions to connect through apps like Situate. You can use a separate API key instead.",
  orbit:
    "Orbit Example allows this sign-in for personal use only. Sending requests in bulk may get your access suspended.",
  orbitChanged:
    "Orbit Example now also bans requests sent while you’re away. Breaking this rule may get your account suspended.",
  acknowledgement: "I understand these limits and continue at my own risk.",
  responsibility: "Continuing does not change the provider’s rules.",
  source: (provider: string) => `Read ${provider}’s terms`,
  cancel: "Cancel",
  continue: "Continue",
  review: "Review changes",
  guard:
    "Your provider’s rules have changed. Review them before using this connection.",
  sourceHandoff: (url: string) => `Provider guidance requested: ${url}`,
  connectionTitle: "Connection details",
  details: "About this connection",
  localModelDefault:
    "Recommended uses a suitable model when this server supports model discovery. You can also set a default model in Settings.",
  readyConversation:
    "Continue to your workspace to start a conversation about a note, a plan or whatever is on your mind.",
  manage: "Manage connection",
  remove: "Remove connection",
  signIn: "Sign-in",
  setupTitle: "Set up AI on this device",
  notConnected:
    "Choose how to use AI here. Your notes and chats are ready, even without AI.",
  restored: "Saved connection restored on this device.",
  configuration: "Connection settings",
  credentials: "Sign-in details",
  localStore: "Protected by this device",
  externalStore: "Read from the file, profile or command set up on this device",
  noCredentials: "Not needed for this connection",
  configurationLocation: (workspace: string) =>
    `${workspace} · This device only`,
  storage:
    "Your connection settings and sign-in details stay on this device, separate from your workspace files.",
  transfer:
    "Your notes and chats can sync. Provider connections, server addresses and model choices stay on this device. Set up AI separately on other devices.",
  forget: "Forget sign-in",
  forgetTitle: "Forget sign-in on this device?",
  forgetDetail:
    "You’ll need to connect again to use AI in this workspace on this device. Your notes, chats and connection settings stay. Other devices and workspaces are not affected. Permissions at the provider stay too.",
  forgotten: "Sign-in forgotten on this device. Connection settings kept.",
  keep: "Keep sign-in",
  removeDetail:
    "This removes the connection and its saved sign-in from this workspace on this device only. Other devices and workspaces keep their connections. Your conversations and drafts are kept.",
  revocationTitle: "Stop access at the provider",
  revocation:
    "To withdraw permission at the provider, use its account settings. Forgetting sign-in or removing a connection here does not do that. Situate cannot check whether the provider has stopped access.",
  sessionTitle: "Choose another sign-in method",
  sessionDetail:
    "This Orbit Example sign-in would end the session on your other device. Use a separate API key or choose another provider. No sign-in has been started.",
  retained: (provider: string) =>
    `Your saved ${provider} connection stays until the new one is saved.`,
  retryStore: "Try again",
  storePending: "Waiting for access to your saved sign-in…",
  storeReady: "Your saved sign-in is available again.",
  local: "Back to workspace",
  saveLocked: "Your sign-in couldn’t be saved",
  saveDenied: "Allow Situate to save your sign-in",
  saveUnavailable: "Your sign-in couldn’t be saved",
  saveLockedDetail:
    "Unlock your device’s password storage, then try again. You can keep working with your notes.",
  saveDeniedDetail:
    "Allow access when your device asks, then try again. You can keep working with your notes.",
  saveUnavailableDetail:
    "Your device’s protected storage isn’t available right now. Try again later, or keep working with your notes.",
  version: "Warning version",
  warningControl: "Change Orbit Example restriction",
  storeControl: "Secure storage available",
};
export const accessProblems: Record<string, [string, string]> = {
  restriction: [securityCopy.review, securityCopy.guard],
  capability: [
    "No chat model available",
    "This provider is connected, but currently offers no chat model for this workspace. Classifier or image access alone cannot handle a conversation.",
  ],
  locked: [
    "Your sign-in details are locked",
    "Unlock your device’s password storage, then try again. You can keep working with your notes.",
  ],
  "store-denied": [
    "Allow access to your saved sign-in",
    "Your device hasn’t allowed Situate to read your sign-in details. Allow access when it asks, then try again.",
  ],
  "store-unavailable": [
    "Your saved sign-in isn’t available",
    "Your device’s protected storage isn’t available right now. Try again later. You can keep working with your notes.",
  ],
  missing: [
    "Connect on this device",
    "Your saved sign-in is missing on this device. Connect again to use this connection. Your notes, chats and other devices are unchanged.",
  ],
  source: [
    "Your sign-in source wasn’t found",
    "The file, profile or command used to sign in isn’t available here. Set it up on this device, or choose another way to connect.",
  ],
  reconnect: [
    "Sign in again",
    "Your sign-in has expired. Connect again to continue chatting.",
  ],
  "access-denied": [
    "The provider didn’t allow access",
    "Check permissions in your provider’s account settings, or connect with different sign-in details.",
  ],
};
export const errors: Record<string, [string, string]> = {
  "store-save-locked": [securityCopy.saveLocked, securityCopy.saveLockedDetail],
  "store-save-denied": [securityCopy.saveDenied, securityCopy.saveDeniedDetail],
  "store-save-unavailable": [
    securityCopy.saveUnavailable,
    securityCopy.saveUnavailableDetail,
  ],
  cancelled: [
    "Connection cancelled",
    "Sign-in has stopped. This does not remove any permission you already granted at the provider.",
  ],
  denied: [
    "Sign-in was not approved",
    "The provider did not grant access. You can try again or choose another sign-in method.",
  ],
  expired: [
    "This sign-in attempt expired",
    "Start again to get a new code or sign-in link. Do not reuse the previous one.",
  ],
  offline: [
    "Could not reach the provider",
    "Check your connection and endpoint, then try again. Your local notes and tasks are still available.",
  ],
  "save-error": [
    "Connection was not saved",
    "Access was received, but the connection could not be saved on this device. Try saving again. Your previous connection is unchanged.",
  ],
  unsupported: [
    "This sign-in method is unavailable on this device",
    "Try another sign-in method or connect on a device that supports this one.",
  ],
};
export const providerName = (id: string) =>
  providers.find((provider) => provider.id === id)?.name || id;
export function accessLabel(method: string): string {
  const labels: Record<string, string> = {
    browser: "Browser sign-in",
    copy: "Code sign-in",
    device: "Device sign-in",
  };
  return labels[method] ?? methods[method]?.[0] ?? method;
}
export function heading(
  state: AiState,
  workspaceLabel: string = state.workspace,
): [string, string, string?] {
  const name = providerName(state.provider);
  if (errors[state.screen]) return errors[state.screen];
  switch (state.screen) {
    case "http-warning":
      return [transportCopy.title, ""];
    case "restriction":
      return [
        state.warningIntent === "use"
          ? securityCopy.changedTitle
          : securityCopy.title,
        "",
      ];
    case "session-unavailable":
      return [securityCopy.sessionTitle, securityCopy.sessionDetail];
    case "forget":
      return [securityCopy.forgetTitle, securityCopy.forgetDetail];
    case "offer":
      return [
        "Make room for your next idea.",
        "Connect AI to turn your notes and plans into a conversation.",
        "Your workspace is ready",
      ];
    case "providers":
      return [
        "Choose a provider",
        "Connect a subscription, API key or local model server for this workspace on this device.",
      ];
    case "methods":
      return [`Connect ${name}`, "Choose how to connect."];
    case "browser":
      return [
        `Sign in to ${name}`,
        "Continue in your browser. Return here after signing in.",
      ];
    case "copy-code":
      return [
        `Sign in to ${name}`,
        `Complete sign-in in your browser, then paste the code shown by ${name}.`,
      ];
    case "device":
      return [
        `Sign in to ${name}`,
        "Enter this code at the provider, then return here.",
      ];
    case "endpoint":
      return state.provider === "llama.cpp"
        ? [
            "Connect a llama.cpp router",
            "Connect a running router. Model downloads and loading are separate from sign-in.",
          ]
        : [
            "Connect an endpoint",
            "Use a compatible hosted or local model server.",
          ];
    case "connecting":
      return [
        "Connecting…",
        `Checking ${name} access and saving the connection.`,
      ];
    case "success":
      return ["AI access connected", ""];
    case "local":
      return ["Reading corner", "A note in your workspace.", "Notes"];
    case "chat":
      return ["New conversation", ""];
    case "remove":
      return [
        "Remove this connection?",
        `Chat in ${workspaceLabel} on this device will need another connection before you can send a message.`,
      ];
    case "key":
    case "cloud":
    case "advanced":
      return [`Connect ${name}`, methods[state.method][0]];
    default:
      return [
        "AI access",
        `Connection settings for ${workspaceLabel}.`,
        "Workspace settings",
      ];
  }
}
export function requiredSetupActions(state: AiState) {
  const actions = footerActions(state).filter(
    (button) =>
      !["skip", "local", "chat", "settings"].includes(button.action) &&
      !(state.screen === "providers" && button.action === "return"),
  );
  return errors[state.screen]
    ? [
        { label: "Change connection", action: "providers", primary: false },
        ...actions,
      ]
    : actions;
}
export function footerActions(
  state: AiState,
): { label: string; action: string; primary?: boolean }[] {
  const button = (label: string, action: string, primary = false) => ({
    label,
    action,
    primary,
  });
  if (state.screen === "http-warning")
    return [
      button(transportCopy.cancel, "cancel-http"),
      button(transportCopy.continue, "accept-http", true),
    ];
  if (state.screen === "restriction")
    return [
      button(securityCopy.cancel, "cancel-warning"),
      button(securityCopy.continue, "acknowledge", true),
    ];
  if (state.screen === "session-unavailable")
    return [
      button("Back to settings", "settings"),
      button("Choose another method", "methods", true),
    ];
  if (state.screen === "forget")
    return [
      button(securityCopy.keep, "settings"),
      button(securityCopy.forget, "confirm-forget", true),
    ];
  if (state.screen.startsWith("store-save-"))
    return [
      button(securityCopy.local, "local"),
      button(securityCopy.retryStore, "retry-store", true),
    ];
  if (errors[state.screen])
    return [
      button("Back to workspace", "local"),
      button(
        state.screen === "save-error" ? "Retry saving" : "Try again",
        "retry",
        true,
      ),
    ];
  switch (state.screen) {
    case "offer":
      return [button("Skip for now", "skip")];
    case "providers":
      return [button("Back", "return")];
    case "methods":
      return [button("Back", "providers")];
    case "key":
    case "cloud":
    case "endpoint":
    case "advanced":
      return [
        button("Back", "methods"),
        button(
          state.screen === "cloud"
            ? "Check access and connect"
            : state.screen === "endpoint"
              ? "Connect endpoint"
              : state.method === "command"
                ? "Allow command and connect"
                : "Connect",
          "validate",
          true,
        ),
      ];
    case "browser":
    case "copy-code":
      return [
        button("Cancel sign-in", "cancel"),
        ...(state.provider === "radius" ||
        (!state.explorationMode && state.screen === "browser")
          ? []
          : [button("Continue with pasted value", "validate", true)]),
      ];
    case "device":
      return [button("Cancel sign-in", "cancel")];
    case "connecting":
      return [button("Cancel connection", "cancel")];
    case "success":
      return [
        button("Connection settings", "settings"),
        button("Continue to workspace", "chat", true),
      ];
    case "chat":
      return [];
    case "local":
      return [button("Open chat", "chat")];
    case "remove":
      return [
        button("Keep connection", "settings"),
        button("Remove connection", "confirm-remove", true),
      ];
    default:
      if (
        ["locked", "store-denied", "store-unavailable"].includes(
          state.workspaces[state.workspace].unavailable ?? "",
        )
      )
        return [
          button("Back to workspace", "local"),
          button(securityCopy.retryStore, "retry-store", true),
        ];
      return [
        button("Back to workspace", "chat"),
        button(
          state.workspaces[state.workspace].connection
            ? state.workspaces[state.workspace].unavailable
              ? "Connect again"
              : "Change connection"
            : "Connect provider",
          "connect",
          true,
        ),
      ];
  }
}
