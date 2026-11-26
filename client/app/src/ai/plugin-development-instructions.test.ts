import { expect, test } from "vitest";
import { pluginDevelopmentInstructions } from "./plugin-development-instructions";
import template from "./plugin-development-instructions.md?raw";

test("the shared prompt has one starting-context substitution", () => {
  expect(template.match(/\{\{starting_context\}\}/g)).toHaveLength(1);
  const unselected = pluginDevelopmentInstructions({ version: 2 });
  const selected = pluginDevelopmentInstructions({
    version: 2,
    pluginId: "sample",
  });
  expect(unselected).toContain("No starting plugin is selected.");
  expect(unselected).not.toContain("Starting context:");
  expect(selected).toContain("Starting context: sample.");
  expect(selected).not.toContain("No starting plugin is selected.");
  expect(selected).not.toContain("{{starting_context}}");
});

test("authoring defers technical contracts to the matching task", () => {
  const prompt = pluginDevelopmentInstructions({ version: 2 });
  expect(prompt).toContain(
    'Before writing or changing plugin code, read `read_plugin_development` with `resource: "package"`',
  );
  expect(prompt).toContain(
    "Load `service-host` when using host APIs and `document-sources` when building or consuming a document source",
  );
  expect(prompt).toContain(
    "When changing a view or its text, read `read_plugin_design`",
  );
  expect(prompt).toContain(
    'Read `read_plugin_development` with `resource: "checks"` before checking or activating',
  );
  expect(prompt).toContain(
    'When asked to create a theme or change Situate\'s own appearance, read `read_plugin_design` with `resource: "themes"`',
  );
  expect(prompt).toContain(
    "Settings → Appearance → Theme. Leave selection to the user.",
  );
  expect(prompt).not.toContain("--situate-");
  expect(prompt).not.toContain("schemaVersion");
  expect(prompt).not.toContain("context.process.run");
});
