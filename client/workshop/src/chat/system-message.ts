import en from "../localization/en.chat-system.json" with { type: "json" };
import de from "../localization/de.chat-system.json" with { type: "json" };
import type { Event } from "./model";

export type SystemMessageLocale = "en" | "de";
export const systemMessageCopy = { en, de };
export function pluginAvailableText(
  pluginName: string,
  locale: SystemMessageLocale,
) {
  return systemMessageCopy[locale].available.replace(
    "{pluginName}",
    () => pluginName,
  );
}
export function systemMessageFixture(locale: SystemMessageLocale): Event[] {
  const c = systemMessageCopy[locale];
  return [
    { kind: "message", id: "plugin-request", speaker: "user", text: c.request },
    { kind: "message", id: "handoff", speaker: "assistant", text: c.handoff },
    {
      kind: "message",
      id: "changed-topic",
      speaker: "user",
      text: c.changedTopic,
    },
    {
      kind: "message",
      id: "saturday-plan",
      speaker: "assistant",
      text: c.reply,
    },
    { kind: "system", id: "plugin-available", pluginName: "Reading list" },
    { kind: "message", id: "followup", speaker: "user", text: c.followup },
  ];
}
