import copy from "../localization/en.conversation-presets.json" with { type: "json" };

export const conversationScenarios = [
  { id: "chat-work-history", label: copy.ready },
  { id: "chat-empty", label: copy.empty },
  { id: "chat-work-history-working", label: copy.working },
  { id: "chat-question", label: copy.question },
  { id: "chat-work-history-approval", label: copy.approval },
  { id: "chat-work-history-changes", label: copy.changes },
  { id: "chat-plugin-available", label: copy.notice },
  { id: "chat-work-history-cancelled", label: copy.stopped },
  { id: "chat-work-history-error", label: copy.error },
  { id: "ai-chat-unconfigured", label: copy.unavailable },
] as const;

export const conversationAliases = {
  "chat-complete": "chat-work-history",
  "chat-working": "chat-work-history-working",
  "chat-error": "chat-work-history-error",
  "chat-work-time": "chat-work-history",
  "chat-work-time-working": "chat-work-history-working",
  "chat-work-history-fragments": "chat-work-history",
  "chat-work-history-long": "chat-work-history",
  "chat-work-history-no-reasoning": "chat-work-history",
  "chat-work-history-unclassified": "chat-work-history",
  "chat-work-history-text-only": "chat-work-history",
  "chat-work-history-plugin": "chat-work-history",
  "chat-work-history-question": "chat-question",
  "chat-question-six": "chat-question",
  "chat-question-ten": "chat-question",
  "chat-question-six-long": "chat-question",
  "chat-question-prompt-long": "chat-question",
  "chat-question-ten-long": "chat-question",
  "chat-question-open": "chat-question",
  "chat-question-answered": "chat-question",
  "ai-chat-zero": "ai-chat-unconfigured",
  "ai-chat-load-error": "ai-chat-unconfigured",
  "ai-chat-unavailable": "ai-chat-unconfigured",
  "ai-chat-save-error": "ai-chat-unconfigured",
  "ai-chat-uncertain": "ai-chat-unconfigured",
  "chat-reasoning": "chat-work-history",
  "chat-reasoning-long": "chat-work-history",
  "chat-reasoning-working": "chat-work-history-working",
  "chat-reasoning-error": "chat-work-history-error",
  "chat-reasoning-cancelled": "chat-work-history-cancelled",
} as const satisfies Record<
  string,
  (typeof conversationScenarios)[number]["id"]
>;

export function conversationSeed(requested: string, canonical: string): string {
  if (requested === "chat-reasoning-long") return "chat-work-history-long";
  if (requested.startsWith("chat-reasoning")) return canonical;
  if (requested === "chat-work-history-question") return "chat-question";
  return Object.hasOwn(conversationAliases, requested) ? requested : canonical;
}
