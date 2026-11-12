import { chooseSelect } from "./select";
import { test, expect, keyLabel } from "./test";
import { workspaceFixture, shellState } from "./workspace-fixture";
import { filesFixture } from "./files-fixture";

test("language and each format save independently while the chat draft remains intact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await filesFixture(page);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: keyLabel("navigation.message"), exact: true })
    .fill("An unsent question");
  await page
    .getByRole("button", { name: keyLabel("navigation.settings"), exact: true })
    .click();
  await expect(page.locator(".settings-topbar")).toHaveText(
    keyLabel("settings.workspace"),
  );
  await expect(page.locator(".settings-topbar button")).toHaveCount(0);
  await chooseSelect(
    page.getByLabel(keyLabel("settings.language.label"), { exact: true }),
    "de",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("#settings-time")).toHaveAttribute(
    "data-value",
    "12",
  );
  await expect(page.locator("#settings-date")).toHaveAttribute(
    "data-value",
    "mdy",
  );
  await expect(page.locator("#settings-number")).toHaveAttribute(
    "data-value",
    "dot-comma",
  );
  await chooseSelect(page.locator("#settings-time"), "24");
  await chooseSelect(page.locator("#settings-date"), "ymd");
  await chooseSelect(page.locator("#settings-number"), "dot-apostrophe");
  await expect(page.locator("#settings-date")).toHaveAttribute(
    "data-value",
    "ymd",
  );
  await expect(page.locator("#settings-time")).toHaveAttribute(
    "data-value",
    "24",
  );
  await expect(page.locator("#settings-number")).toHaveAttribute(
    "data-value",
    "dot-apostrophe",
  );
  await expect(
    page.locator('[aria-labelledby="formats-heading"] p, .format-preview'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: keyLabel("navigation.files"), exact: true })
    .click();
  await page
    .getByRole("button", { name: keyLabel("layoutUi.back"), exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    }),
  ).toHaveValue("An unsent question");
  await page
    .getByRole("button", { name: keyLabel("navigation.settings"), exact: true })
    .click();
  await expect(page.locator("#settings-language")).toHaveAttribute(
    "data-value",
    "de",
  );
  await expect(page.locator("#settings-time")).toHaveAttribute(
    "data-value",
    "24",
  );
  await expect(page.locator("#settings-date")).toHaveAttribute(
    "data-value",
    "ymd",
  );
  await expect(page.locator("#settings-number")).toHaveAttribute(
    "data-value",
    "dot-apostrophe",
  );
});

test("read-only settings stay visible without issuing writes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState, {
    localization: {
      language: "en",
      formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
      writable: false,
    },
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: keyLabel("navigation.settings"), exact: true })
    .click();
  await expect(
    page.getByText(keyLabel("localization.readOnly"), { exact: true }),
  ).toBeVisible();
  for (const field of ["language", "time", "date", "number"])
    await expect(page.locator(`#settings-${field}`)).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, "__ipcCalls") as { command: string }[]).filter(
        (call) => call.command === "localization_update",
      ),
    ),
  ).toEqual([]);
});

test.describe("German settings layout", () => {
  test.use({ localizationMode: "real", locale: "de-DE" });
  for (const width of [320, 375, 768, 1440]) {
    test(
      `settings remain usable at ${width}px`,
      {
        tag:
          width === 320
            ? "@visual-mobile"
            : width === 1440
              ? "@visual-desktop"
              : [],
      },
      async ({ page, visual }) => {
        await page.setViewportSize({ width, height: 900 });
        await workspaceFixture(page, shellState, {
          localization: {
            language: "de",
            formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
            writable: true,
          },
        });
        await page.goto("/");
        const settings = page.getByRole("button", {
          name: "Einstellungen",
          exact: true,
        });
        const navigation = page.getByRole("button", {
          name: "Navigation öffnen",
          exact: true,
        });
        await expect
          .poll(
            async () =>
              (await settings.isVisible()) || (await navigation.isVisible()),
          )
          .toBe(true);
        if (!(await settings.isVisible())) await navigation.click();
        await settings.click();
        if (width < 600) {
          await expect(
            page.getByRole("heading", { name: "Einstellungen", exact: true }),
          ).toBeVisible();
          await visual.capture("settings.categories");
        }
        await page
          .getByRole("button", { name: "Sprache & Formate", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Sprache & Formate", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel("Sprache der Oberfläche", { exact: true }),
        ).toHaveAttribute("data-value", "de");
        await chooseSelect(
          page.getByLabel("Zahlenformat", { exact: true }),
          "dot-apostrophe",
        );
        await expect(
          page.locator("#settings-number + select option:checked"),
        ).toHaveText("1’234.56");
        expect(
          await page
            .locator(".settings-content")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await visual.capture("settings.language-formats");
        await page
          .getByLabel("Sprache der Oberfläche", { exact: true })
          .click();
        await expect(page.getByRole("listbox")).toBeFocused();
        await expect(
          page.getByRole("option", { name: "Deutsch", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        if (width < 480) {
          const sheet = page.locator(".situate-select-popup.select-sheet");
          await expect(sheet).toBeVisible();
          const box = await sheet.boundingBox();
          expect(box!.x).toBe(0);
          expect(box!.y + box!.height).toBeLessThanOrEqual(900);
        }
        await visual.capture("settings.language-choices");
        await page.keyboard.press("Escape");
        await expect(
          page.getByLabel("Sprache der Oberfläche", { exact: true }),
        ).toBeFocused();
        await page
          .getByLabel("Sprache der Oberfläche", { exact: true })
          .press("ArrowDown");
        await expect(page.getByRole("listbox")).toBeFocused();
        await page.keyboard.press("Home");
        await page.keyboard.press("Enter");
        await expect(
          page.getByLabel("Interface language", { exact: true }),
        ).toHaveAttribute("data-value", "en");
        await expect(
          page.getByLabel("Number format", { exact: true }),
        ).toHaveAttribute("data-value", "dot-apostrophe");
      },
    );
  }
});
