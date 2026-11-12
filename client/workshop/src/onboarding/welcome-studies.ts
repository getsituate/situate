import type { Component } from "vue";
import type { WelcomeStudy } from "../workspaces/first-entry";

const components = import.meta.glob<{ default: Component }>(
  "./welcome-variants/*/WelcomeVariant.vue",
  { eager: true },
);
const scores = import.meta.glob<{ durationMs: number }>(
  "./welcome-variants/*/timeline.ts",
  { eager: true },
);

export function welcomeStudy(study: WelcomeStudy) {
  if (study === "original") return null;
  const path = `./welcome-variants/${study}/`;
  const component = components[`${path}WelcomeVariant.vue`]?.default;
  const durationMs = scores[`${path}timeline.ts`]?.durationMs;
  return component && durationMs ? { component, durationMs } : null;
}
