import { expect, test, type Page } from "./test";
import { selectScenario } from "./scenarios";

async function open(controls: Page, scenario: string) {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  return opened;
}

test("the overview starts welcome only for creation and existing workspaces open normally", async ({
  page,
}) => {
  const preview = await open(page, "workspaces");
  await expect(
    preview.getByRole("heading", { name: "Where would you like to begin?" }),
  ).toBeVisible();
  await expect(preview.locator(".setup-steps")).toHaveCount(0);
  await preview.getByRole("button", { name: /Create a workspace/ }).click();
  await expect(preview.locator(".fullscreen-welcome")).toBeVisible();
  await preview.getByRole("button", { name: /Skip/i }).click();
  await expect(
    preview.locator('.setup-steps [aria-current="step"]'),
  ).toContainText("Create a workspace");
  await expect(preview.locator(".setup-steps li")).toHaveCount(5);
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "Where would you like to begin?" }),
  ).toBeVisible();
  await expect(preview.locator(".setup-steps")).toHaveCount(0);
  await preview.locator(".workspace-select").first().click();
  await expect(preview.locator(".fullscreen-welcome")).toHaveCount(0);
  await expect(preview.locator(".setup-steps")).toHaveCount(0);
  await expect(
    preview.getByLabel("Workspace name", { exact: true }),
  ).toHaveCount(0);
});

test("setup preserves drafts through resizing and remains usable with reduced motion and a short viewport", async ({
  page,
}) => {
  const preview = await open(page, "first-entry-create");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  const name = preview.getByRole("textbox", {
    name: "Workspace name",
    exact: true,
  });
  const initial = await name.inputValue();
  await name.fill("Field journal");
  await preview.setViewportSize({ width: 320, height: 350 });
  await expect(name).toHaveValue("Field journal");
  await expect(preview.locator(".frame-art")).toBeHidden();
  await expect
    .poll(() =>
      preview
        .locator(".actor svg")
        .evaluate((element) => element.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  const cancel = preview.getByRole("button", { name: "Cancel", exact: true });
  await cancel.focus();
  await expect(cancel).toBeInViewport();
  await cancel.press("Enter");
  await expect(preview.locator(".setup-steps")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: /Create a workspace/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(name).toHaveValue(initial);
  await preview.setViewportSize({ width: 1280, height: 900 });
  await expect(preview.locator(".frame-art")).toBeVisible();
});

test("progress has regular spacing and creation shares the settings color picker", async ({
  page,
}, info) => {
  const preview = await open(page, "first-entry-create");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await preview.evaluate(() => document.fonts.ready);
  const progress = preview.locator(".setup-steps");
  await expect(progress).not.toContainText(/Current step|Coming up/);
  await expect(progress.locator("small")).toHaveCount(0);
  for (const width of [1280, 996, 700, 390]) {
    await preview.setViewportSize({ width, height: 900 });
    const row = width === 1280;
    const rects = await progress
      .locator(row ? "li" : ".number")
      .evaluateAll((items) =>
        items.map((item) => {
          const { x, y, width } = item.getBoundingClientRect();
          return { x, y, width };
        }),
      );
    const gaps = rects
      .slice(1)
      .map((rect, i) => rect.x - rects[i]!.x - rects[i]!.width);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    expect(
      Math.max(...rects.map((r) => r.y)) - Math.min(...rects.map((r) => r.y)),
    ).toBeLessThan(1);
    expect(
      await progress.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await progress.screenshot({
      path: info.outputPath(`progress-${width}.png`),
    });
  }
  await preview.setViewportSize({ width: 1280, height: 900 });
  const picker = preview.getByRole("group", {
    name: "Accent color",
    exact: true,
  });
  const names = await picker
    .locator(".appearance-color-name")
    .allTextContents();
  expect(names.map((name) => name.trim())).toEqual([
    "Violet Default",
    "Cobalt",
    "Sky",
    "Tangerine",
    "Peach",
    "Lemon",
  ]);
  const peach = picker.getByRole("radio", { name: "Peach", exact: true });
  await peach.check();
  await expect(peach).toBeChecked();
  await peach.focus();
  await peach.press("ArrowRight");
  await expect(
    picker.getByRole("radio", { name: "Lemon", exact: true }),
  ).toBeChecked();
  await peach.check();
  await picker.screenshot({ path: info.outputPath("creation-colors.png") });
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  expect(
    await preview
      .locator(".first-setup")
      .evaluate((element) =>
        (element as HTMLElement).style.getPropertyValue("--situate-accent"),
      ),
  ).toBe("var(--situate-peach)");
  await selectScenario(page, "settings-appearance");
  const settingsPicker = preview.getByRole("group", {
    name: "Accent color",
    exact: true,
  });
  await expect(settingsPicker).toBeVisible();
  expect(
    await settingsPicker.locator(".appearance-color-name").allTextContents(),
  ).toEqual(names);
});

for (const [width, height] of [
  [1280, 900],
  [390, 844],
  [320, 568],
]) {
  test(`setup uses one illustrated frame at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "first-entry-create");
    await preview.setViewportSize({ width, height });
    const errors: string[] = [];
    preview.on("pageerror", (error) => errors.push(error.message));
    for (const [scenario, current] of [
      ["first-entry-create", "Create a workspace"],
      ["first-entry-ai", "Connect AI"],
      ["first-entry-model", "Connect AI"],
      ["setup-conversation-brief", "Shape your working method"],
      ["setup-conversation-import", "Bring your content"],
      ["setup-conversation-support", "Set up support"],
    ]) {
      await selectScenario(page, scenario!);
      await expect(preview.locator(".setup-frame")).toHaveCount(1);
      await expect(preview.locator(".setup-panel")).toBeVisible();
      await expect(
        preview.locator('.setup-steps [aria-current="step"]'),
      ).toContainText(current!);
      await expect(preview.locator(".actor svg")).toHaveCount(1);
      const panel = (await preview.locator(".setup-panel").boundingBox())!;
      const art = (await preview.locator(".setup-illustration").boundingBox())!;
      expect(
        await preview
          .locator(".setup-panel")
          .evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
      ).toBe(true);
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      if (width > 700) expect(art.x + art.width).toBeLessThan(panel.x);
      else if (await preview.locator(".frame-art").isVisible())
        expect(art.y + art.height).toBeLessThanOrEqual(panel.y);
      if (scenario === "first-entry-ai") {
        expect(
          await preview
            .locator(".providers button")
            .evaluateAll((buttons) =>
              buttons.every(
                (button) => button.scrollHeight <= button.clientHeight + 1,
              ),
            ),
        ).toBe(true);
      }
      await preview.screenshot({
        path: info.outputPath(`${scenario}-${width}.png`),
        animations: "disabled",
      });
    }
    expect(errors).toEqual([]);
  });
}
