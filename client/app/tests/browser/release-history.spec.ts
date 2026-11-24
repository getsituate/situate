import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import type {
  ReleaseCatalog,
  ReleaseText,
} from "../../src/updates/release-history";
import { initialFormats } from "@situate/localization";

test.use({ localizationMode: "real" });
const notes = (title: string, paragraph: string): ReleaseText => ({
  title,
  entries: [
    {
      id: "search",
      type: "fixed",
      platforms: ["macos", "ios"],
      title,
      paragraphs: [paragraph],
    },
  ],
});
const catalog: ReleaseCatalog = {
  schemaVersion: 1,
  installedVersion: "0.10.0",
  releases: [
    {
      version: "0.10.0",
      locales: { en: notes("Future-only change", "Not installed yet") },
    },
    {
      version: "0.9.1",
      locales: { en: { title: "Changes", entries: [] } },
    },
    {
      version: "0.9.0",
      date: "2026-10-20",
      locales: {
        en: notes("Search improvements", "Search keeps your filters."),
        de: notes("Verbesserte Suche", "Die Suche behält deine Filter bei."),
      },
    },
    {
      version: "0.8.0",
      locales: { en: notes("Draft fixes", "Drafts remain available.") },
    },
    {
      version: "0.7.0",
      locales: { en: notes("Earlier search", "Search notes by title.") },
    },
  ],
};

for (const mobile of [false, true]) {
  test(
    `What's new shows installed changes inline on ${mobile ? "mobile store" : "direct desktop"}`,
    { tag: mobile ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => {
        Reflect.set(window, "__releaseHistoryFixture", value);
      }, catalog);
      await workspaceFixture(
        page,
        { ...shellState, mobile },
        {
          updates: {
            supported: !mobile,
            installedVersion: "0.9.1",
            phase: "ready",
            artifactId: "next",
            availableVersion: "0.10.0",
          },
        },
      );
      await page.goto("/");
      await expect(page.locator(".topic-window")).toBeVisible();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      if (mobile)
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page.locator(".settings-action").click();
      if (!mobile) {
        await page
          .getByRole("button", { name: "Updates", exact: false })
          .click();
        await page
          .getByRole("button", { name: "What’s new", exact: true })
          .click();
        const firstHistory = page.getByRole("dialog", {
          name: "What’s new",
          exact: true,
        });
        await expect(firstHistory.locator("[data-version]")).toHaveCount(3);
        await expect(firstHistory).not.toContainText("Future-only");
        await firstHistory
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      await page
        .getByRole("button", { name: "About Situate", exact: true })
        .click();
      await expect(page.locator(".about-situate")).toContainText(
        "Version 0.9.1",
      );
      const entry = page.getByRole("button", {
        name: "What’s new",
        exact: true,
      });
      await entry.click();
      const dialog = page.getByRole("dialog", {
        name: "What’s new",
        exact: true,
      });
      const releases = dialog.locator("[data-version]");
      await expect(releases).toHaveCount(3);
      await expect(releases.first()).toHaveAttribute("data-version", "0.9.0");
      await expect(dialog).not.toContainText("0.10.0");
      await expect(dialog).not.toContainText("0.9.1");
      await expect(dialog.getByRole("searchbox")).toHaveCount(0);
      await expect(
        dialog.getByText("Search keeps your filters."),
      ).toBeInViewport();
      await expect(
        dialog.getByText("Drafts remain available."),
      ).toBeInViewport();
      await visual.capture("release-history.list");
      await dialog.press("Escape");
      await expect(entry).toBeFocused();
      if (!mobile) {
        await page
          .getByRole("button", { name: "Updates", exact: false })
          .click();
        await entry.click();
        await expect(dialog.locator("[data-version]")).toHaveCount(3);
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect(entry).toBeFocused();
      } else {
        await expect(
          page.getByRole("button", { name: "Updates", exact: false }),
        ).toHaveCount(0);
      }
      const commands = await page.evaluate(() =>
        (Reflect.get(window, "__ipcCalls") as { command: string }[]).map(
          (call) => call.command,
        ),
      );
      expect(
        commands.filter(
          (command) =>
            command === "updates_check" || command === "updates_install",
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.reload();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
    },
  );
}

test("German controls and notes use English fallback for unavailable release translations", async ({
  page,
}) => {
  await page.addInitScript((value) => {
    Reflect.set(window, "__releaseHistoryFixture", value);
  }, catalog);
  await workspaceFixture(page, shellState, {
    updates: { installedVersion: "0.9.1" },
    localization: {
      language: "de",
      formats: initialFormats("de"),
      writable: true,
    },
  });
  await page.goto("/");
  await page.locator(".settings-action").click();
  await page.getByRole("button", { name: "Über Situate", exact: true }).click();
  await page.getByRole("button", { name: "Was ist neu?", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Was ist neu?",
    exact: true,
  });
  await expect(dialog).toContainText("Verbesserte Suche");
  await expect(dialog).toContainText("Drafts remain available.");
});

for (const [name, fixture] of Object.entries({
  malformed: { schemaVersion: 99, releases: "invalid" },
  "empty releases only": { ...catalog, releases: [catalog.releases[1]] },
})) {
  const emptyCatalog = name === "empty releases only";
  test(
    `What's new handles ${name} without blocking the workspace`,
    { tag: emptyCatalog ? "@visual-desktop" : [] },
    async ({ page, visual }) => {
      await page.addInitScript((value) => {
        Reflect.set(window, "__releaseHistoryFixture", value);
      }, fixture);
      await workspaceFixture(page, shellState);
      await page.goto("/");
      await page.locator(".settings-action").click();
      await page
        .getByRole("button", { name: "About Situate", exact: true })
        .click();
      await page
        .getByRole("button", { name: "What’s new", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "What’s new",
        exact: true,
      });
      await expect(dialog.getByRole("status")).toHaveText(
        "There are no release notes for this installation yet.",
      );
      await expect(dialog.locator("[data-version]")).toHaveCount(0);
      if (emptyCatalog) await visual.capture("release-history.empty");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Files", exact: true }).click();
      await expect(page.locator(".settings-view")).toHaveCount(0);
    },
  );
}

const licenseText = `Situate licenses and notices

Example software — MIT
Copyright Example contributors.

Example artwork — CC BY 4.0
Credit: Example artists.

Example parser 1.2.3 — MIT
Copyright Example parser contributors.

Example runtime 2.0.0 — Apache-2.0
Copyright Example runtime contributors.

Corresponding source for Example 1.2.3 (MPL-2.0):
https://static.crates.io/crates/example/example-1.2.3.crate
SHA-256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
`;
for (const mobile of [false, true]) {
  for (const language of ["en", "de"] as const) {
    test.describe(`licenses and source access ${mobile ? "mobile" : "desktop"} ${language}`, () => {
      test.use({ locale: language === "de" ? "de-DE" : "en-US" });
      test(
        "reads, selects and retries licenses from About",
        { tag: mobile ? "@visual-mobile" : "@visual-desktop" },
        async ({ page, visual }) => {
          if (mobile) await page.setViewportSize({ width: 390, height: 844 });
          const labels =
            language === "de"
              ? {
                  navigation: "Navigation öffnen",
                  about: "Über Situate",
                  open: "Lizenzen und Hinweise ansehen",
                  title: "Lizenzen und Hinweise",
                  failed:
                    "Die Lizenzen konnten nicht geladen werden. Versuche es erneut.",
                  loading: "Lizenzen werden geladen…",
                  retry: "Erneut versuchen",
                }
              : {
                  navigation: "Open navigation",
                  about: "About Situate",
                  open: "View licenses and notices",
                  title: "Licenses and notices",
                  failed: "Licenses could not be loaded. Try again.",
                  loading: "Loading licenses…",
                  retry: "Retry",
                };
          await workspaceFixture(
            page,
            { ...shellState, mobile },
            {
              localization: {
                language,
                formats: initialFormats(language),
                writable: true,
              },
            },
          );
          let requests = 0;
          let release!: () => void;
          const ready = new Promise<void>((resolve) => {
            release = resolve;
          });
          await page.route("**/situate-licenses.txt", async (route) => {
            requests++;
            if (requests === 1)
              return route.fulfill({ status: 503, body: "Unavailable" });
            await ready;
            await route.fulfill({
              contentType: "text/plain; charset=utf-8",
              body: licenseText,
            });
          });
          await page.goto("/");
          await expect(page.locator(".topic-window")).toBeVisible();
          if (mobile)
            await page
              .getByRole("button", { name: labels.navigation, exact: true })
              .click();
          await page.locator(".settings-action").click();
          await page
            .getByRole("button", { name: labels.about, exact: true })
            .click();
          const entry = page.getByRole("button", {
            name: labels.open,
            exact: true,
          });
          await expect(entry).toBeVisible();
          expect(requests).toBe(0);
          await visual.capture("about.settings");
          await entry.click();
          const dialog = page.getByRole("dialog", {
            name: labels.title,
            exact: true,
          });
          await expect(dialog.getByRole("alert")).toContainText(labels.failed);
          await visual.capture("about.licenses.error");
          await dialog
            .getByRole("button", { name: labels.retry, exact: true })
            .click();
          await expect(dialog.getByRole("status")).toHaveText(labels.loading);
          await visual.capture("about.licenses.loading");
          release();
          const document = dialog.getByRole("textbox", {
            name: labels.title,
            exact: true,
          });
          await expect(document).toHaveValue(licenseText);
          await expect(document).toHaveAttribute("readonly", "");
          await visual.capture("about.licenses.open");
          await document.focus();
          await document.press("ControlOrMeta+A");
          expect(
            await document.evaluate(
              (element: HTMLTextAreaElement) =>
                element.selectionEnd - element.selectionStart,
            ),
          ).toBe(licenseText.length);
          await dialog.press("Escape");
          await expect(entry).toBeFocused();
          await entry.click();
          await expect(document).toHaveValue(licenseText);
          expect(requests).toBe(2);
          expect(
            await page.evaluate(
              () => window.document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        },
      );
    });
  }
}
