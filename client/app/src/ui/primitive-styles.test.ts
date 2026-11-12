import { compileStyle, parse } from "@vue/compiler-sfc";
import { describe, expect, it } from "vitest";
import { list } from "postcss";
import button from "../../../packages/ui/src/SituateButton.vue?raw";
import field from "../../../packages/ui/src/SituateField.vue?raw";
import badge from "../../../packages/ui/src/SituateBadge.vue?raw";
import notice from "../../../packages/ui/src/SituateNotice.vue?raw";
import panel from "../../../packages/ui/src/SituatePanel.vue?raw";
import emptyState from "../../../packages/ui/src/SituateEmptyState.vue?raw";
import dialog from "../../../packages/ui/src/SituateDialog.vue?raw";
import dialogActions from "../../../packages/ui/src/SituateDialogActions.vue?raw";
import checkbox from "../../../packages/ui/src/SituateCheckbox.vue?raw";
import radio from "../../../packages/ui/src/SituateRadio.vue?raw";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const textControl = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/ui/src/text-control.css",
  ),
  "utf8",
);

// A class inside :where has zero specificity, including Vue's injected scope attribute.
describe("primitive style specificity", () => {
  it.each(
    Object.entries({
      button,
      field,
      badge,
      notice,
      panel,
      emptyState,
      dialog,
      dialogActions,
      checkbox,
      radio,
    }),
  )(
    "%s defaults outrank native element resets without increasing state specificity",
    (name, source) => {
      const { descriptor } = parse(source);
      const result = compileStyle({
        source: descriptor.styles[0].content,
        filename: `${name}.vue`,
        id: "data-v-probe",
        scoped: true,
      });
      expect(result.errors).toEqual([]);
      const selectors = result.code.match(/[^{}]+(?=\{)/g) ?? [];
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) {
        for (const branch of list.comma(selector.trim())) {
          expect(branch).toMatch(/^\.situate-/);
          expect(branch).toMatch(/\[data-v-probe(?:-s)?\]/);
        }
      }
    },
  );
  it("keeps the unscoped native text-control class outside zero-specificity state selectors", () => {
    expect(textControl).toContain(".situate-text-control {");
    expect(textControl).toContain(".situate-text-control:where(:disabled)");
    expect(textControl).not.toContain(":where(.situate-");
  });
});
