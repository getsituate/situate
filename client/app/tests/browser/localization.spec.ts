import { expect, test, keyLabel } from "./test";
import {
  installLocalizationAudit,
  type LocalizationViolation,
} from "./localization-audit.mjs";

test.use({ localizationMode: "real" });

test.describe("automatic key-mode fixture", () => {
  test.use({ localizationMode: "keys" });

  test("localized controls pass without invoking an audit helper", async ({
    page,
  }) => {
    const label = keyLabel("navigation.newChat");
    await page.goto(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<button aria-label="${label}">${label}</button>`)}`,
    );
    await expect(page.getByRole("button", { name: label })).toBeVisible();
    expect(
      await page.evaluate(() => globalThis.__SITUATE_LOCALIZATION_KEYS__),
    ).toBe(true);
  });

  test("untranslated controls fail automatically at teardown", async ({
    page,
  }) => {
    await page.goto(
      "data:text/html;charset=utf-8,<button>Untranslated control</button>",
    );
    await expect(
      page.getByRole("button", { name: "Untranslated control" }),
    ).toBeVisible();
    test.fail(
      true,
      "The automatic fixture must reject untranslated UI even without an explicit audit call.",
    );
  });
});

test("the localization auditor retains frame and popup violations after navigation and removal", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const violations: LocalizationViolation[] = [];
  try {
    await context.exposeBinding(
      "__situateReportLocalization",
      (_source, violation: LocalizationViolation) => {
        violations.push(violation);
      },
    );
    await context.addInitScript(installLocalizationAudit, {
      catalog: { "audit.title": "Title" },
    });
    await context.route("https://audit.invalid/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><html><head><meta charset="utf-8"></head><body><p>⟦audit.title⟧</p><script>window.keysBeforeBoot = globalThis.__SITUATE_LOCALIZATION_KEYS__;</script></body></html>',
      }),
    );
    const page = await context.newPage();
    await page.goto("https://audit.invalid/");
    expect(
      await page.evaluate(() => Reflect.get(window, "keysBeforeBoot")),
    ).toBe(true);
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = "https://audit.invalid/frame";
      document.body.append(frame);
    });
    const frame = page.frameLocator("iframe");
    await expect(frame.getByText("⟦audit.title⟧")).toBeVisible();
    await frame.locator("body").evaluate((element) => {
      element.innerHTML =
        '<button aria-label="Frame label">⟦audit.title⟧</button>';
    });
    await expect
      .poll(() =>
        violations.some((violation) => violation.value === "Frame label"),
      )
      .toBe(true);
    await page.locator("iframe").evaluate((element) => element.remove());
    const opened = context.waitForEvent("page");
    await page.evaluate(() => {
      window.open("https://audit.invalid/popup");
    });
    const popup = await opened;
    await popup.waitForLoadState();
    await popup.evaluate(() => {
      const dialog = document.createElement("dialog");
      dialog.textContent = "Popup dialog";
      document.body.append(dialog);
      dialog.remove();
    });
    await expect
      .poll(() =>
        violations.some((violation) => violation.value === "Popup dialog"),
      )
      .toBe(true);
    await popup.close();
    await page.goto("https://audit.invalid/next");
    expect(violations.map((violation) => violation.value).sort()).toEqual([
      "Frame label",
      "Popup dialog",
    ]);
  } finally {
    await context.close();
  }
});
