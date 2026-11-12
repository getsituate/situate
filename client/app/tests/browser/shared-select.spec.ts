import { test, expect, type Locator } from "./test";
import { workspaceFixture, shellState } from "./workspace-fixture";
import { accents } from "../../src/settings/accents";

test.use({ localizationMode: "real" });

async function contrast(control: Locator) {
  return control.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((value) => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    }
    function background(node: Element | null): string {
      if (!node) throw new Error("No opaque background found");
      const color = getComputedStyle(node).backgroundColor;
      return color === "rgba(0, 0, 0, 0)" || color === "transparent"
        ? background(node.parentElement)
        : color;
    }
    function ratio(a: string, b: string) {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }
    const style = getComputedStyle(element);
    const ground = background(element);
    const chevron = element.querySelector(".select-chevron");
    return {
      text: ratio(style.color, ground),
      boundaryInside: ratio(style.borderTopColor, ground),
      boundaryOutside: ratio(
        style.borderTopColor,
        background(element.parentElement),
      ),
      focus: ratio(style.outlineColor, ground),
      outline: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineOffset: parseFloat(style.outlineOffset),
      chevron: chevron ? ratio(getComputedStyle(chevron).color, ground) : null,
      chevronBackground: chevron
        ? getComputedStyle(chevron).backgroundColor
        : null,
    };
  });
}

for (const accent of accents) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of accent === "lemon" && colorScheme === "light"
      ? [320, 1440]
      : [1440]) {
      test(
        `shared select ${accent} with ${colorScheme} system appearance at ${width}px`,
        {
          tag:
            accent === "lemon" && colorScheme === "light"
              ? width === 320
                ? "@visual-mobile"
                : "@visual-desktop"
              : [],
        },
        async ({ page, visual }, info) => {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await workspaceFixture(page, shellState, {
            appearance: { accent, writable: true, revision: "saved" },
          });
          await page.goto("/");
          const settings = page.getByRole("button", {
            name: "Settings",
            exact: true,
          });
          const navigation = page.getByRole("button", {
            name: "Open navigation",
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
          await page
            .getByRole("button", { name: "Language & formats", exact: true })
            .click();
          const control = page.locator("#settings-language");
          await expect(control).toHaveAttribute("data-value", "en");
          await expect(page.locator("html")).toHaveAttribute(
            "data-workspace-accent",
            accent,
          );
          expect(
            await page
              .locator("html")
              .evaluate((element) => getComputedStyle(element).colorScheme),
          ).toBe("light");
          const measurements: Record<
            string,
            Awaited<ReturnType<typeof contrast>>
          > = {};
          async function check(state: string, focus = false) {
            const values = await contrast(control);
            measurements[state] = values;
            expect(values.text, `${state} text`).toBeGreaterThanOrEqual(4.5);
            expect(values.chevron, `${state} chevron`).toBeGreaterThanOrEqual(
              3,
            );
            expect(values.chevronBackground).toBe("rgba(0, 0, 0, 0)");
            expect(
              values.boundaryInside,
              `${state} inner edge`,
            ).toBeGreaterThanOrEqual(3);
            expect(
              values.boundaryOutside,
              `${state} outer edge`,
            ).toBeGreaterThanOrEqual(3);
            if (focus) {
              expect(values.outline).toBe("solid");
              expect(values.outlineWidth).toBeGreaterThanOrEqual(3);
              expect(values.outlineOffset).toBe(-values.outlineWidth);
              expect(values.focus, `${state} focus`).toBeGreaterThanOrEqual(3);
            }
          }
          await page.mouse.move(0, 0);
          await check("default");
          const box = await control.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          await visual.capture(`select.${accent}.${colorScheme}.default`);
          await control.hover();
          await check("hover");
          await page.mouse.move(0, 0);
          await page.keyboard.press("Tab");
          await control.focus();
          await expect(control).toBeFocused();
          await check("focus", true);
          await visual.capture(`select.${accent}.${colorScheme}.focus`);
          await control.press("ArrowDown");
          const list = page.getByRole("listbox");
          await expect(list).toBeFocused();
          await expect(control).toHaveAttribute("aria-expanded", "true");
          await check("open");
          const selected = page.getByRole("option", {
            name: "English",
            exact: true,
          });
          const optionColors = await contrast(selected);
          expect(optionColors.text).toBeGreaterThanOrEqual(4.5);
          const listColors = await contrast(list);
          expect(listColors.outline).toBe("solid");
          expect(listColors.focus).toBeGreaterThanOrEqual(3);
          await visual.capture(`select.${accent}.${colorScheme}.open`);
          await page.keyboard.press("End");
          await page.keyboard.press("Escape");
          await expect(control).toBeFocused();
          await expect(control).toHaveAttribute("data-value", "en");
          await info.attach("select-contrast", {
            body: JSON.stringify(measurements),
            contentType: "application/json",
          });
        },
      );
    }
    test(`disabled shared select ${accent} with ${colorScheme} system appearance`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme });
      await workspaceFixture(page, shellState, {
        appearance: { accent, writable: true, revision: "saved" },
        localization: {
          language: "en",
          formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
          writable: false,
        },
      });
      await page.goto("/");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const control = page.locator("#settings-language");
      await expect(control).toBeDisabled();
      await expect(control.locator("+ select")).toBeDisabled();
      const values = await contrast(control);
      expect(values.text).toBeGreaterThanOrEqual(4.5);
      expect(values.chevron).toBeGreaterThanOrEqual(3);
      expect(values.chevronBackground).toBe("rgba(0, 0, 0, 0)");
      expect(
        await control.evaluate(
          (element) => getComputedStyle(element).borderTopStyle,
        ),
      ).toBe("dashed");
      await info.attach("select-contrast", {
        body: JSON.stringify(values),
        contentType: "application/json",
      });
    });
  }
}
