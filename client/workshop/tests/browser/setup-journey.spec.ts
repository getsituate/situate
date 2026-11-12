import { selectOption } from "./select";
import { expect, test, type Page } from "./test";
import copy from "../../src/localization/en.setup-conversation.json" with { type: "json" };
import { finaleDuration } from "../../src/workspaces/setup-journey/finale/score";

async function seek(controls: Page, preview: Page, time: number) {
  await controls
    .getByLabel("Celebration frame", { exact: true })
    .evaluate((input, value) => {
      (input as HTMLInputElement).value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-finale-time",
    String(time),
  );
}

test("verified access leads into the shared setup conversation without replacing Bend", async ({
  page,
}, info) => {
  await page.goto("/?workshop=controls&scenario=first-entry-model");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await opened;
  await preview.setViewportSize({ width: 1280, height: 900 });
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  const actor = (await preview.locator(".actor svg").elementHandle())!;
  const body = preview.locator('.workspace-setup [data-bend-part="body"]');
  const originalBody = await body.evaluate((node) => node.outerHTML);
  await selectOption(
    preview.getByLabel("Model for setup", { exact: true }),
    "example-chat",
  );
  await preview
    .getByRole("button", { name: "Check model and begin", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Model check succeeded", exact: true })
    .click();
  async function settled(step: number) {
    await expect(preview.locator(".workspace-setup")).toHaveAttribute(
      "data-transitioning",
      "false",
    );
    await expect(preview.locator(".setup-illustration")).toHaveAttribute(
      "data-position",
      String(step),
    );
    expect(await actor.evaluate((node) => node.isConnected)).toBe(true);
    expect(await body.evaluate((node) => node.outerHTML)).toBe(originalBody);
    await preview.screenshot({
      path: info.outputPath(`journey-station-${step}.png`),
    });
  }
  await settled(2);
  await expect(
    preview.getByRole("heading", { name: copy.briefTitle }),
  ).toBeVisible();
  await preview
    .getByRole("textbox", { name: copy.sourceLabel })
    .fill("Project notes in Apple Notes and tasks in Reminders.");
  await preview.getByRole("radio", { name: copy.keep, exact: true }).check();
  await preview.getByRole("button", { name: copy.start, exact: true }).click();
  await expect(
    preview.getByRole("button", { name: copy.confirm, exact: true }),
  ).toBeEnabled();
  await expect(
    preview.getByText("Edit starting details", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: copy.controls.manual }).check();
  await preview
    .getByRole("button", { name: copy.confirm, exact: true })
    .click();
  await settled(3);
  await page
    .getByRole("button", { name: copy.controls.complete, exact: true })
    .click();
  await settled(4);
  await preview.getByRole("button", { name: copy.finish, exact: true }).click();
  const destination = (await preview
    .locator(".workspace-destination")
    .elementHandle())!;
  for (const time of [0, 1000, 1750, 3000, 4420, finaleDuration]) {
    await seek(page, preview, time);
    expect(await actor.evaluate((node) => node.isConnected)).toBe(true);
    expect(await body.evaluate((node) => node.outerHTML)).toBe(originalBody);
    await preview.screenshot({ path: info.outputPath(`finale-${time}.png`) });
  }
  await preview
    .getByRole("button", { name: "Go to workspace", exact: false })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveCount(0);
  expect(await destination.evaluate((node) => node.isConnected)).toBe(true);
  await expect(
    preview.getByRole("heading", { name: copy.title, exact: true }),
  ).toBeFocused();
  await expect(preview.locator(".workspace-destination")).not.toHaveAttribute(
    "inert",
  );
  await preview.reload();
  await expect(
    preview.getByRole("heading", { name: copy.title, exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".workspace-setup")).toHaveCount(0);
});
