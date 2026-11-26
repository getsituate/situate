import tokens from "../../../../design/brand/tokens.json";
import contract from "../ai/plugin-design/theme-variables.json";
import type { IconName } from "@situate/ui/icons";
import { accentStyle, type Accent } from "./accents";

const { groups, prefix } = contract;
const publicVariables = new Set(
  Object.values(groups).flatMap(({ names }) =>
    names.map((name) => prefix + name),
  ),
);
const brandDefaults: Readonly<Record<string, string>> = Object.assign(
  {},
  ...Object.values(tokens).filter((group) => typeof group === "object"),
);

export type ThemeVariables = Readonly<Record<string, string>>;
export type BrandAssets = "on-light" | "on-dark";
export interface ThemePreview {
  color?: string;
  icon?: IconName | { path: string };
}
export interface ThemeDefinition {
  id: string;
  title: string;
  variables: ThemeVariables;
  preview?: ThemePreview;
  brandAssets?: BrandAssets;
}
export interface WorkspaceTheme extends ThemeDefinition {
  provider: string;
  key: string;
}

export function parseThemeVariables(input: unknown): ThemeVariables | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (!entries.length) return null;
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!publicVariables.has(key) || typeof value !== "string" || !value.trim())
      return null;
    result[key] = value;
  }
  return Object.freeze(result);
}

export function themeDefaults(accent: Accent): ThemeVariables {
  const accentDefaults: ThemeVariables = accentStyle(accent);
  return Object.fromEntries(
    [...publicVariables].map((key) => [
      key,
      accentDefaults[key] ?? brandDefaults[key.slice(prefix.length)]!,
    ]),
  );
}
