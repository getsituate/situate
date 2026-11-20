import { expect, test } from "vitest";
import { pluginDevelopmentInstructions } from "./plugin-development-instructions";

test("finishing development does not authorize navigation", () => {
  const prompt = pluginDevelopmentInstructions({ version: 2 });
  expect(prompt).toContain(
    "Leave the current conversation and navigation unchanged unless the user explicitly asks to navigate.",
  );
  expect(prompt).toContain(
    "Generated code may navigate only in response to an explicit user request or interaction, never on initialization, activation, background updates or presentation restoration.",
  );
});
