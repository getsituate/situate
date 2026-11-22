import { compileStyle, parse } from "@vue/compiler-sfc";
import { describe, expect, it } from "vitest";
import { list, parse as parseCss } from "postcss";
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
      const styles = descriptor.styles.filter((style) => style.scoped);
      expect(styles.length).toBeGreaterThan(0);
      for (const style of styles) {
        const result = compileStyle({
          source: style.content,
          filename: `${name}.vue`,
          id: "data-v-probe",
          scoped: true,
        });
        expect(result.errors).toEqual([]);
        parseCss(result.code).walkRules((rule) => {
          if (
            rule.parent?.type === "atrule" &&
            rule.parent.name.endsWith("keyframes")
          )
            return;
          for (const branch of list.comma(rule.selector)) {
            expect(branch).toMatch(/^\.situate-/);
            expect(branch).toMatch(/\[data-v-probe(?:-s)?\]/);
          }
        });
      }
    },
  );
  it("keeps the unscoped native text-control class outside zero-specificity state selectors", () => {
    expect(textControl).toContain(".situate-text-control {");
    expect(textControl).toContain(".situate-text-control:where(:disabled)");
    expect(textControl).not.toContain(":where(.situate-");
  });
});
