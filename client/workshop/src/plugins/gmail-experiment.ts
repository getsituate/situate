import type { PluginState } from "./model";

export const gmailCopy = {
  category: "Experimental features",
  enable: "Enable Gmail",
  badge: "Experimental",
  connect: "Connect account",
  edit: "Edit permissions",
  reconnect: "Reconnect",
  disconnect: "Disconnect account",
  back: "Back to Gmail accounts",
  continue: "Continue to Google",
  restricted:
    "Google did not grant every permission you selected. You can use the permissions shown for this account.",
  errors: {
    notListed:
      "This Google account isn’t on the Gmail test list. Try an account that has been added to the test.",
    wrongAccount:
      "Choose the Google account shown on this page. Its existing permissions haven’t changed.",
  },
} as const;

export const gmailPermissions = [
  {
    label: "Reading",
    items: [
      {
        id: "metadata",
        label: "Read message details",
        detail: "See subjects, senders, and labels without opening messages.",
      },
      {
        id: "read",
        label: "Read and search email",
        detail: "Open messages and attachments.",
      },
    ],
  },
  {
    label: "Drafts and sending",
    items: [
      { id: "draft", label: "Manage drafts" },
      { id: "send", label: "Send email" },
    ],
  },
  {
    label: "Mailbox organization",
    items: [
      { id: "labels", label: "Manage labels" },
      {
        id: "modify",
        label: "Organize messages",
        detail:
          "Change message labels or read status, move to Trash, and restore.",
      },
      { id: "insert", label: "Add existing messages to Gmail" },
    ],
  },
  {
    label: "Mailbox filters",
    items: [
      { id: "filtersRead", label: "Read filters" },
      { id: "filtersWrite", label: "Change filters" },
    ],
  },
  {
    label: "Permanent deletion",
    items: [
      {
        id: "delete",
        label: "Permanently delete email",
        detail: "Deleted messages bypass Trash and can’t be restored.",
      },
    ],
  },
] as const;

export type GmailPermission =
  (typeof gmailPermissions)[number]["items"][number]["id"];
export type GmailOutcome =
  "connected" | "partial" | keyof typeof gmailCopy.errors;
export interface GmailExperiment {
  enabled: boolean;
  grants: Record<string, GmailPermission[]>;
  selection: {
    accountId: string | null;
    permissions: GmailPermission[];
    pending: boolean;
  } | null;
  error: keyof typeof gmailCopy.errors | null;
  partialAccount: string | null;
}

export function openGmailAccount(s: PluginState, accountId: string | null) {
  const gmail = s.gmailExperiment;
  if (!gmail?.enabled) return;
  gmail.error = null;
  gmail.selection = {
    accountId,
    permissions: [...(accountId ? (gmail.grants[accountId] ?? []) : [])],
    pending: false,
  };
}

export function finishGmailAuthorization(
  s: PluginState,
  outcome: GmailOutcome,
) {
  const gmail = s.gmailExperiment;
  const selection = gmail?.selection;
  if (!gmail?.enabled || !selection?.pending) return;
  selection.pending = false;
  if (outcome === "notListed" || outcome === "wrongAccount") {
    gmail.error = outcome;
    return;
  }
  const permissions =
    outcome === "partial"
      ? selection.permissions.slice(0, -1)
      : selection.permissions;
  if (!permissions.length) return;
  const sequence = s.nextId;
  const id = selection.accountId ?? `gmail-account-${s.nextId++}`;
  const existing = s.accounts.gmail.find((account) => account.id === id);
  if (existing) existing.status = "connected";
  else
    s.accounts.gmail.push({
      id,
      name: !s.accounts.gmail.length
        ? "alex@example.com"
        : `alex+${sequence}@example.com`,
      status: "connected",
    });
  gmail.grants[id] = [...permissions];
  gmail.partialAccount = outcome === "partial" ? id : null;
  gmail.selection = null;
}

export function disconnectGmail(s: PluginState, id: string) {
  const gmail = s.gmailExperiment!;
  s.accounts.gmail = s.accounts.gmail.filter((account) => account.id !== id);
  for (const [plugin, accounts] of Object.entries(s.accountSelections))
    s.accountSelections[plugin] = accounts.filter((account) => account !== id);
  delete gmail.grants[id];
  if (gmail.partialAccount === id) gmail.partialAccount = null;
}

export function gmailPermissionSummary(
  permissions: readonly GmailPermission[],
) {
  return gmailPermissions
    .flatMap<(typeof gmailPermissions)[number]["items"][number]>(
      (group) => group.items,
    )
    .filter((item) => permissions.includes(item.id))
    .map((item) => item.label)
    .join(" · ");
}
