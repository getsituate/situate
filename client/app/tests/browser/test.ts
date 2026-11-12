import "@situate/localization/onboarding";
import { test as base, expect } from "@playwright/test";
import { en } from "@situate/localization";
import { checkpointName, claimCheckpoint } from "./visual-checkpoints.mjs";
import {
  installLocalizationAudit,
  type LocalizationViolation,
} from "./localization-audit.mjs";

export * from "@playwright/test";
export { keyLabel } from "@situate/localization";
export interface VisualOptions {
  visualEnabled: boolean;
}
export const test = base.extend<
  VisualOptions & {
    localizationMode: "keys" | "real";
    localizationAudit: void;
    visual: {
      capture(name: string, options?: { threshold: number }): Promise<void>;
    };
  }
>({
  localizationMode: ["keys", { option: true }],
  visualEnabled: [false, { option: true }],
  visual: [
    async (
      { page, baseURL, locale, localizationMode, visualEnabled },
      use,
      info,
    ) => {
      if (!visualEnabled) {
        await use({ capture: async () => {} });
        return;
      }
      if (!locale)
        throw new Error("Visual checkpoints require an explicit locale.");
      if (localizationMode !== "real")
        throw new Error("Visual checkpoints require localizationMode: 'real'.");
      if (!info.tags.includes(`@visual-${info.project.name}`))
        throw new Error(
          "Visual tests need a matching @visual-desktop or @visual-mobile tag.",
        );
      await page.addInitScript(() => {
        Math.random = () => 0;
      });
      // Vue's event guards require timestamps to advance between interactions.
      await page.clock.install({ time: new Date("2026-01-15T12:00:00Z") });
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin === baseURL)
          return route.continue();
        return route.abort("blockedbyclient");
      });
      const captures: string[] = [];
      try {
        await use({
          capture: async (name, options) => {
            const filename = checkpointName(name, page.viewportSize(), locale);
            if (info.config.updateSnapshots !== "none")
              claimCheckpoint(
                info.project.outputDir,
                info.project.name,
                filename,
                info.titlePath.join(" > "),
              );
            await page.evaluate(() => document.fonts.ready);
            // String names are sanitized by Playwright and can collapse distinct state IDs.
            await expect(page).toHaveScreenshot([filename], {
              ...options,
              mask: [page.getByRole("timer")],
            });
            captures.push(filename);
          },
        });
        if (info.status === info.expectedStatus)
          expect(
            captures.length,
            "A visual test must reach at least one checkpoint",
          ).toBeGreaterThan(0);
      } finally {
        await info.attach("visual-checkpoints", {
          body: JSON.stringify(captures),
          contentType: "application/json",
        });
      }
    },
    { auto: true },
  ],
  localizationAudit: [
    async ({ context, localizationMode }, use) => {
      const violations: LocalizationViolation[] = [];
      await context.exposeBinding(
        "__situateReportLocalization",
        (_source, violation: LocalizationViolation) => {
          violations.push(violation);
        },
      );
      await context.addInitScript(installLocalizationAudit, {
        catalog: en,
        mode: localizationMode,
      });
      await use();
      for (const page of context.pages()) {
        for (const frame of page.frames()) {
          try {
            await frame.evaluate(async () => {
              await globalThis.__situateFlushLocalization?.();
            });
          } catch (error) {
            if (!page.isClosed() && !frame.isDetached()) throw error;
          }
        }
      }
      expect(
        violations,
        "Untranslated UI encountered during this test",
      ).toEqual([]);
    },
    { auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture parameter even without dependencies.
  baseURL: async ({}, use) => {
    const url = process.env.SITUATE_BROWSER_URL;
    if (!url)
      throw new Error("The browser test server did not provide its endpoint.");
    await use(url);
  },
});
