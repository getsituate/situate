import { expect, test } from "./test";
import { workspaceFixture, shellState } from "./workspace-fixture";

for (const locale of ["en-US", "de-DE"] as const) {
  test.describe(locale, () => {
    test.use({ locale, localizationMode: "real" });
    for (const width of [1280, 320]) {
      test(
        `workspace name feedback at ${width}px`,
        {
          tag: width === 320 ? "@visual-mobile" : "@visual-desktop",
        },
        async ({ page, visual }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ reducedMotion: "reduce" });
          await workspaceFixture(
            page,
            {
              ...shellState,
              mobile: width === 320,
              current: null,
              known: [],
              open: [],
            },
            {
              localization: {
                language: locale === "de-DE" ? "de" : "en",
                formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
                writable: true,
              },
            },
          );
          await page.goto("/");
          await page
            .getByRole("button", {
              name:
                locale === "de-DE"
                  ? "Arbeitsbereich erstellen"
                  : "Create a workspace",
            })
            .click();
          const name = page.locator("#workspace-name");
          const error = page.locator("#workspace-name-error");
          const create = page.locator(".form-actions .entry-primary");
          await name.fill("");
          await expect(error).toHaveCount(0);
          await expect(name).toHaveAttribute(
            "aria-describedby",
            "workspace-name-help",
          );
          await expect(create).toBeEnabled();
          expect(
            await create.evaluate(
              (button, word) => {
                const text = [...button.childNodes].find(
                  (node) =>
                    node.nodeType === Node.TEXT_NODE &&
                    node.textContent?.includes(word),
                )!;
                const start = text.textContent!.indexOf(word);
                const range = document.createRange();
                range.setStart(text, start);
                range.setEnd(text, start + word.length);
                return range.getClientRects().length;
              },
              locale === "de-DE" ? "Arbeitsbereich" : "workspace",
            ),
          ).toBe(1);
          await visual.capture("workspaces.name.unvisited");
          const folderTop = () =>
            page
              .locator("#workspace-parent")
              .evaluate((e) => e.getBoundingClientRect().top);
          const before = await folderTop();
          await name.press("Enter");
          await expect(name).toBeFocused();
          await expect(name).toHaveAttribute("aria-invalid", "true");
          await expect(error).toHaveText(
            locale === "de-DE"
              ? "Fehler: Gib einen Namen für den Arbeitsbereich ein."
              : "Error: Enter a workspace name.",
          );
          expect(await folderTop()).toBe(before);
          await expect(page.locator(".creation .entry-error")).toHaveCount(0);
          await expect(
            page.locator(".situate-field-feedback[aria-live]"),
          ).toHaveCount(0);
          await visual.capture("workspaces.name.required");
          await name.fill("bad/name");
          await expect(error).toContainText("240");
          await expect(name).toBeFocused();
          await name.press("Tab");
          await expect(page.locator(".situate-field-feedback")).toHaveAttribute(
            "aria-live",
            "polite",
          );
          const bounds = await error.boundingBox();
          const folder = await page.locator("#workspace-parent").boundingBox();
          expect(bounds!.y + bounds!.height).toBeLessThan(folder!.y);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          await visual.capture("workspaces.name.long-error");
          await name.focus();
          await name.fill("Field notes");
          await expect(error).toHaveCount(0);
          await expect(name).not.toHaveAttribute("aria-invalid");
          await expect(name).not.toHaveAttribute("data-field-tone");
          await expect(name).toHaveAttribute(
            "aria-describedby",
            "workspace-name-help",
          );
          await expect(create).toBeEnabled();
          await expect(name).toBeFocused();
          await visual.capture("workspaces.name.corrected");
          expect(
            await page.evaluate(() =>
              Reflect.get(window, "__ipcCalls").filter(
                (c: { args: { action?: string } }) =>
                  c.args.action === "create",
              ),
            ),
          ).toEqual([]);
          await name.press("Enter");
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  Reflect.get(window, "__ipcCalls").filter(
                    (c: { args: { action?: string } }) =>
                      c.args.action === "create",
                  ).length,
              ),
            )
            .toBe(1);
        },
      );
    }
  });
}
