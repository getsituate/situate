import { expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import { highlightSource, highlightLines } from "./source-highlighting";
import SourceText from "./SourceText.vue";

test("highlights JavaScript tokens across multiline comments and templates without changing source bytes", () => {
  const text =
    "export const value = 42;\n/* return\nfalse */\nconst text = `first\nsecond ${value}`;\n";
  const tokens = highlightSource(text, "entry.js");
  expect(tokens.map((token) => token.text).join("")).toBe(text);
  expect(
    tokens
      .filter((token) => token.kind === "keyword")
      .map((token) => token.text),
  ).toEqual(["export", "const", "const"]);
  expect(tokens.find((token) => token.kind === "number")?.text).toBe("42");
  const lines = highlightLines(text, "entry.js");
  expect(lines[2]).toEqual([{ text: "false */", kind: "comment" }]);
  expect(lines[4]?.[0]).toEqual({ text: "second ${", kind: "string" });
  expect(
    lines.map((line) => line.map((token) => token.text).join("")).join("\n"),
  ).toBe(text);
});
test("shows JSON and untrusted markup as inert text, never executable HTML", () => {
  const text = '{"html":"<script>throw 1</script>","enabled":true,"count":3}';
  const tokens = highlightSource(text, "plugin.json");
  const wrapper = mount(SourceText, { props: { tokens } });
  expect(wrapper.element.textContent).toBe(text);
  expect(wrapper.findAll(".syntax-string").length).toBeGreaterThan(0);
  expect(wrapper.find(".syntax-keyword").text()).toBe("true");
  expect(wrapper.find(".syntax-number").text()).toBe("3");
  expect(wrapper.find("script,iframe,img").exists()).toBe(false);
  wrapper.unmount();
});
test("keeps unknown formats plain and bounds minified highlighting without truncating bytes", () => {
  expect(highlightSource("# return 42\n", "SKILL.md")).toEqual([
    { text: "# return 42\n" },
  ]);
  const text = "const a=1;".repeat(20000);
  const tokens = highlightSource(text, "entry.js");
  expect(tokens.length).toBeLessThanOrEqual(12001);
  expect(tokens.map((token) => token.text).join("")).toBe(text);
  expect(tokens.at(-1)?.kind).toBeUndefined();
});
