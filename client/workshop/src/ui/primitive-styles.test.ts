import { compileStyle, parse } from "@vue/compiler-sfc";
import { describe, expect, it } from "vitest";
import button from "./SituateButton.vue?raw";
import field from "./SituateField.vue?raw";
import badge from "./SituateBadge.vue?raw";
import notice from "./SituateNotice.vue?raw";
import panel from "./SituatePanel.vue?raw";
import emptyState from "./SituateEmptyState.vue?raw";
import dialog from "./SituateDialog.vue?raw";
import dialogActions from "./SituateDialogActions.vue?raw";
import checkbox from "./SituateCheckbox.vue?raw";
import radio from "./SituateRadio.vue?raw";
import { readFileSync } from "node:fs";
import { list, parse as parseCss } from "postcss";
const textControl = readFileSync("src/ui/text-control.css", "utf8");

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
      const sourceStyles = descriptor.styles.filter(({ scoped }) => scoped);
      const compiled = compileStyle({
        filename: `${name}.vue`,
        source: sourceStyles.map(({ content }) => content).join("\n"),
        scoped: true,
        id: "data-v-probe",
      });
      expect(compiled.errors).toEqual([]);
      const defaults = parseCss(compiled.code).nodes.flatMap((node) =>
        node.type === "rule" ? list.comma(node.selector) : [],
      );
      expect(defaults.length).toBeGreaterThan(0);
      for (const selector of defaults) {
        expect(selector).toMatch(/^\.situate-.*\[data-v-probe(?:-s)?\]/);
      }
    },
  );
  it("keeps the unscoped native text-control class outside zero-specificity state selectors", () => {
    expect(textControl).toContain(".situate-text-control {");
    expect(textControl).toContain(".situate-text-control:where(:disabled)");
    expect(textControl).not.toContain(":where(.situate-");
  });
});
