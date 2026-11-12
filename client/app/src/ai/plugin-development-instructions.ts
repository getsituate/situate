import type { PluginDevelopment } from "./conversation-record";
import template from "./plugin-development-instructions.md?raw";

export function pluginDevelopmentInstructions(
  development: PluginDevelopment,
): string {
  const context = development.pluginId
    ? `Starting context: ${development.pluginId}.`
    : "No starting plugin is selected.";
  return template.replace("{{starting_context}}", () => context);
}
