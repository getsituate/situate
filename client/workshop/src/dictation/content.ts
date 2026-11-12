import en from "../localization/en.dictation.json" with { type: "json" };
import de from "../localization/de.dictation.json" with { type: "json" };
export const copy = (language: "en" | "de") => (language === "de" ? de : en);
export const c = en;
