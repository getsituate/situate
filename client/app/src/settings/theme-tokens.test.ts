import { describe, expect, it } from "vitest";
import contract from "../ai/plugin-design/theme-variables.json";
import { parseThemeVariables, themeDefaults } from "./theme-tokens";

describe("plugin theme variables", () => {
  it("accepts every variable shipped in the offline theme catalog", () => {
    const defaults = themeDefaults("violet");
    const values: Record<string, string> = {};
    for (const group of Object.values(contract.groups)) {
      for (const name of group.names) {
        const key = contract.prefix + name;
        expect(values, key).not.toHaveProperty(key);
        expect(defaults[key], key).toBeTypeOf("string");
        values[key] = group.example;
      }
    }
    expect(parseThemeVariables(values)).toEqual(values);
    expect(Object.keys(defaults).sort()).toEqual(Object.keys(values).sort());
  });

  it("preserves CSS values without imposing visual ranges or syntax", () => {
    const values = {
      "--situate-paper": "transparent",
      "--situate-ink": "var(--situate-muted)",
      "--situate-font-body": `${Array.from({ length: 12 }, (_, n) => `'Display Typeface ${n}'`).join(", ")}, system-ui`,
      "--situate-text-body": "40px",
      "--situate-leading-body": "1.05",
      "--situate-space-3": "0px",
      "--situate-duration-feedback": "2s",
      "--situate-shadow-popover": "0 8px 24px #000000ff",
    };
    expect(parseThemeVariables(values)).toEqual(values);
  });

  it.each([
    ["--situate-target-min", "1px"],
    ["--situate-viewport-height", "1px"],
    ["--situate-ink", 42],
    ["--situate-ink", "  "],
  ])(
    "rejects unsupported names and values that are not CSS strings: %s",
    (name, value) => {
      expect(
        parseThemeVariables({ "--situate-paper": "white", [name]: value }),
      ).toBeNull();
    },
  );
});
