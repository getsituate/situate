import { readonly, shallowRef } from "vue";
import baseEn from "./catalogs/en.json" with { type: "json" };
import baseDe from "./catalogs/de.json" with { type: "json" };
import uiEn from "./catalogs/en.ui.json" with { type: "json" };
import uiDe from "./catalogs/de.ui.json" with { type: "json" };
import nativeEn from "./catalogs/en.native.json" with { type: "json" };
import nativeDe from "./catalogs/de.native.json" with { type: "json" };
import questionEn from "./catalogs/en.chat-question.json" with { type: "json" };
import questionDe from "./catalogs/de.chat-question.json" with { type: "json" };
import conversationEn from "./catalogs/en.onboarding-conversation.json" with { type: "json" };
import conversationDe from "./catalogs/de.onboarding-conversation.json" with { type: "json" };
import chatEn from "./catalogs/en.chat.json" with { type: "json" };
import chatDe from "./catalogs/de.chat.json" with { type: "json" };

import layoutHostEn from "./catalogs/en.layout-host.json" with { type: "json" };
import layoutHostDe from "./catalogs/de.layout-host.json" with { type: "json" };

import layoutUiEn from "./catalogs/en.layout-ui.json" with { type: "json" };
import layoutUiDe from "./catalogs/de.layout-ui.json" with { type: "json" };
import layoutNativeEn from "./catalogs/en.layout-native.json" with { type: "json" };
import layoutNativeDe from "./catalogs/de.layout-native.json" with { type: "json" };

import referencesEn from "./catalogs/en.references.json" with { type: "json" };
import referencesDe from "./catalogs/de.references.json" with { type: "json" };
import type assignmentChangesEn from "./catalogs/en.assignment-changes.json";
import type pluginManagementEn from "./catalogs/en.plugin-management.json";
import dictationEn from "./catalogs/en.dictation.json" with { type: "json" };
import dictationDe from "./catalogs/de.dictation.json" with { type: "json" };
import updatesEn from "./catalogs/en.updates.json" with { type: "json" };
import updatesDe from "./catalogs/de.updates.json" with { type: "json" };
import errorRepairEn from "./catalogs/en.error-repair.json" with { type: "json" };
import errorRepairDe from "./catalogs/de.error-repair.json" with { type: "json" };
import recoveryEn from "./catalogs/en.error-recovery.json" with { type: "json" };
import recoveryDe from "./catalogs/de.error-recovery.json" with { type: "json" };
import releaseHistoryEn from "./catalogs/en.release-history.json" with { type: "json" };
import releaseHistoryDe from "./catalogs/de.release-history.json" with { type: "json" };
export const en = {
  ...errorRepairEn,
  ...recoveryEn,
  ...releaseHistoryEn,
  ...updatesEn,
  ...dictationEn,
  ...baseEn,
  ...uiEn,
  ...nativeEn,
  ...chatEn,
  ...questionEn,
  ...conversationEn,
  ...layoutHostEn,
  ...layoutUiEn,
  ...layoutNativeEn,
  ...referencesEn,
};
export const de = {
  ...errorRepairDe,
  ...recoveryDe,
  ...releaseHistoryDe,
  ...updatesDe,
  ...dictationDe,
  ...baseDe,
  ...uiDe,
  ...nativeDe,
  ...chatDe,
  ...questionDe,
  ...conversationDe,
  ...layoutHostDe,
  ...layoutUiDe,
  ...layoutNativeDe,
  ...referencesDe,
};
export const catalogs = { en, de };
export type MessageKey =
  | keyof typeof en
  | keyof typeof assignmentChangesEn
  | keyof typeof pluginManagementEn
  | keyof typeof import("./catalogs/en.onboarding.json")
  | keyof typeof import("./catalogs/en.onboarding-conversation.json")
  | keyof typeof import("./catalogs/en.onboarding-agent.json");

export function registerCatalogs(
  english: Record<string, string>,
  german: Record<string, string>,
): void {
  Object.assign(en, english);
  Object.assign(de, german);
}
export type Language = "en" | "de";
export type Parameters = Record<string, string | number>;
export interface Formats {
  time: "12" | "24";
  date: "dmy-dot" | "dmy-slash" | "mdy" | "ymd";
  number:
    "dot-comma" | "comma-dot" | "dot-space" | "comma-space" | "dot-apostrophe";
}
export interface Preferences {
  language: Language;
  formats: Formats;
}
export interface LocalizationSnapshot extends Preferences {
  writable: boolean;
}
export function isLocalizationSnapshot(
  value: unknown,
): value is LocalizationSnapshot {
  if (
    !value ||
    typeof value !== "object" ||
    !("language" in value) ||
    !("formats" in value) ||
    !("writable" in value)
  )
    return false;
  const formats = value.formats;
  return (
    (value.language === "en" || value.language === "de") &&
    typeof value.writable === "boolean" &&
    !!formats &&
    typeof formats === "object" &&
    "time" in formats &&
    typeof formats.time === "string" &&
    ["12", "24"].includes(formats.time) &&
    "date" in formats &&
    typeof formats.date === "string" &&
    ["dmy-dot", "dmy-slash", "mdy", "ymd"].includes(formats.date) &&
    "number" in formats &&
    typeof formats.number === "string" &&
    [
      "dot-comma",
      "comma-dot",
      "dot-space",
      "comma-space",
      "dot-apostrophe",
    ].includes(formats.number)
  );
}

export function deviceLanguage(value: string): Language {
  return /^de(?:-|_|$)/iu.test(value) ? "de" : "en";
}
export function initialFormats(
  language: Language,
  system: Partial<Formats> = {},
): Formats {
  const fallback: Formats =
    language === "de"
      ? { time: "24", date: "dmy-dot", number: "comma-dot" }
      : { time: "12", date: "mdy", number: "dot-comma" };
  return {
    time: system.time ?? fallback.time,
    date: system.date ?? fallback.date,
    number: system.number ?? fallback.number,
  };
}
const initialLanguage = deviceLanguage(
  typeof navigator === "undefined" ? "en" : navigator.language,
);
const current = shallowRef<Preferences>({
  language: initialLanguage,
  formats: initialFormats(initialLanguage),
});
export const preferences = readonly(current);
export function setPreferences(value: Preferences): void {
  current.value = { language: value.language, formats: { ...value.formats } };
  if (typeof document !== "undefined")
    document.documentElement.lang = value.language;
}

export function keyLabel(key: MessageKey, params: Parameters = {}): string {
  const sorted = Object.fromEntries(
    Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
  );
  const encoded = JSON.stringify(sorted)
    .replaceAll("⟦", "\\u27e6")
    .replaceAll("⟧", "\\u27e7");
  return `⟦${key}${Object.keys(sorted).length ? `:${encoded}` : ""}⟧`;
}
export function resolveMessage(
  key: string,
  selected: Readonly<Record<string, string>>,
  fallback: Readonly<Record<string, string>>,
  params: Parameters = {},
): string {
  const source =
    selected[key] || fallback[key] || baseEn["localization.unavailableText"];
  return source.replace(
    /\{([a-zA-Z][a-zA-Z0-9_]*)\}/gu,
    (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
export function t(key: MessageKey, params: Parameters = {}): string {
  const language = current.value.language;
  // Production bundles never enable key-only rendering through a page global.
  if (
    import.meta.env?.DEV &&
    Reflect.get(globalThis, "__SITUATE_LOCALIZATION_KEYS__") === true
  )
    return keyLabel(key, params);
  const displayParams = Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      typeof value === "number" ? formatNumber(value) : value,
    ]),
  );
  return resolveMessage(key, catalogs[language], en, displayParams);
}
export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(en, value);
}

export function localizeError(error: unknown): string {
  return resolveError(error, 0);
}
function resolveError(error: unknown, depth: number): string {
  if (depth > 8) return t("localization.unknownError");
  if (typeof error === "string") {
    if (isMessageKey(error)) return t(error);
    if (error.startsWith("{")) {
      try {
        return resolveError(JSON.parse(error), depth + 1);
      } catch {
        /* Invalid external error payloads use the generic message. */
      }
    }
  }
  if (error instanceof Error) return resolveError(error.message, depth + 1);
  if (
    error &&
    typeof error === "object" &&
    "key" in error &&
    typeof error.key === "string" &&
    isMessageKey(error.key)
  ) {
    const params: Record<string, unknown> =
      "params" in error &&
      error.params &&
      typeof error.params === "object" &&
      !Array.isArray(error.params)
        ? { ...error.params }
        : {};
    if ("error" in params) params.error = resolveError(params.error, depth + 1);
    for (const name of ["parent", "display"] as const) {
      if (typeof params[name] === "string")
        params[name] = resolveProvidedText(params[name], depth + 1);
    }
    if (
      Object.values(params).every(
        (value) => typeof value === "string" || typeof value === "number",
      )
    )
      return t(error.key, params as Parameters);
  }
  return t("localization.unknownError");
}
export function localizeProvidedText(value: string): string {
  return resolveProvidedText(value, 0);
}
function resolveProvidedText(value: string, depth: number): string {
  if (depth > 8) return t("localization.unknownError");
  const supplied = (key: string): boolean =>
    key.startsWith("native.provider.") ||
    key === "native.workspace.location.child";
  if (supplied(value) && isMessageKey(value)) return t(value);
  if (value.startsWith("{")) {
    try {
      const message: unknown = JSON.parse(value);
      if (
        message &&
        typeof message === "object" &&
        "key" in message &&
        typeof message.key === "string" &&
        supplied(message.key) &&
        isMessageKey(message.key)
      )
        return resolveError(message, depth + 1);
    } catch {
      /* Ordinary location names and paths are not message payloads. */
    }
  }
  return value;
}
export function localizeHistorySummary(message: string): string {
  const summary = message.split("\n\n", 1)[0] ?? "";
  if (/^Reverse change [0-9a-f]{40,64}$/iu.test(summary))
    return t("files.reversedEarlierVersion");
  if (isMessageKey(summary)) return t(summary);
  if (summary.startsWith("{")) {
    try {
      const value: unknown = JSON.parse(summary);
      if (
        value &&
        typeof value === "object" &&
        "key" in value &&
        typeof value.key === "string" &&
        isMessageKey(value.key)
      ) {
        if (value.key === "native.history.reverseChange")
          return t("files.reversedEarlierVersion");
        return localizeError(value);
      }
    } catch {
      /* Existing user-authored history remains readable verbatim. */
    }
  }
  return summary;
}

const pad = (value: number): string => String(value).padStart(2, "0");
export function formatDate(
  value: Date,
  format: Formats["date"] = current.value.formats.date,
): string {
  if (!Number.isFinite(value.getTime())) throw new RangeError("Invalid date");
  const day = pad(value.getDate());
  const month = pad(value.getMonth() + 1);
  const year = String(value.getFullYear()).padStart(4, "0");
  switch (format) {
    case "dmy-dot":
      return `${day}.${month}.${year}`;
    case "dmy-slash":
      return `${day}/${month}/${year}`;
    case "mdy":
      return `${month}/${day}/${year}`;
    case "ymd":
      return `${year}-${month}-${day}`;
  }
}
export function formatTime(
  value: Date,
  format: Formats["time"] = current.value.formats.time,
  seconds = false,
): string {
  if (!Number.isFinite(value.getTime())) throw new RangeError("Invalid date");
  const hour = value.getHours();
  const tail = `:${pad(value.getMinutes())}${seconds ? `:${pad(value.getSeconds())}` : ""}`;
  return format === "24"
    ? `${pad(hour)}${tail}`
    : `${hour % 12 || 12}${tail} ${hour < 12 ? "AM" : "PM"}`;
}
export function formatDateTime(value: Date): string {
  return `${formatDate(value)} ${formatTime(value, current.value.formats.time, true)}`;
}
export function formatNumber(
  value: number,
  format: Formats["number"] = current.value.formats.number,
  options: Pick<
    Intl.NumberFormatOptions,
    "minimumFractionDigits" | "maximumFractionDigits"
  > = {},
): string {
  const separators = {
    "dot-comma": [".", ","],
    "comma-dot": [",", "."],
    "dot-space": [".", " "],
    "comma-space": [",", " "],
    "dot-apostrophe": [".", "’"],
  } as const;
  const [decimal, group] = separators[format];
  return new Intl.NumberFormat("en-US", options)
    .formatToParts(value)
    .map((part) =>
      part.type === "decimal"
        ? decimal
        : part.type === "group"
          ? group
          : part.value,
    )
    .join("");
}
