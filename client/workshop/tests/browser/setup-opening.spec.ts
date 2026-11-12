import { expect, test, type Page } from "./test";
import { selectScenario } from "./scenarios";
import { openingDuration } from "../../src/workspaces/setup-journey/opening";

async function open(controls: Page) {
  await controls.goto("/?workshop=controls&scenario=first-entry");
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await opened;
  await preview.setViewportSize({ width: 1280, height: 900 });
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await expect(preview.locator(".fullscreen-welcome")).toBeVisible();
  return preview;
}
async function seek(controls: Page, preview: Page, time: number) {
  await controls
    .getByLabel("Opening frame", { exact: true })
    .evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-opening-time",
    String(time),
  );
}

test("opening reveals progress continuously and keeps the same rigid actor", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.getByRole("button", { name: /Skip/i }).click();
  await seek(page, preview, 0);
  const actor = (await preview.locator(".actor svg").elementHandle())!;
  const art = preview.locator(".setup-illustration");
  const before = (await art.boundingBox())!;
  const body = await preview
    .locator('[data-bend-part="body"]')
    .evaluate((el) => el.outerHTML);
  await expect(preview.locator(".setup-steps li")).toHaveCount(5);
  const playback = preview.evaluate(
    (duration) =>
      new Promise<{ time: number; height: number }[]>((resolve) => {
        const samples: { time: number; height: number }[] = [];
        const sample = () => {
          const root = document.querySelector<HTMLElement>(".workspace-setup")!;
          if (root.dataset.openingTime !== undefined)
            samples.push({
              time: Number(root.dataset.openingTime),
              height: document
                .querySelector(".progress-reveal")!
                .getBoundingClientRect().height,
            });
          if (samples.at(-1)?.time === duration) resolve(samples);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    openingDuration,
  );
  await page
    .getByRole("button", { name: "Replay opening", exact: true })
    .click();
  await expect(preview.locator("#create-title")).toBeFocused();
  const frames = await playback;
  const height = frames.at(-1)!.height;
  expect(
    frames.some((frame) => frame.height > 0 && frame.height < height),
  ).toBe(true);
  expect(
    frames.filter((frame) => frame.time > 0 && frame.time < 460).length,
  ).toBeGreaterThan(2);
  for (let i = 1; i < frames.length; i++)
    expect(frames[i]!.height).toBeGreaterThanOrEqual(frames[i - 1]!.height);
  expect(await actor.evaluate((el) => el.isConnected)).toBe(true);
  const steady = await art.evaluate((el) => el.outerHTML);
  await preview.waitForTimeout(150);
  expect(await art.evaluate((el) => el.outerHTML)).toBe(steady);

  for (const time of [0, 80, 170, 370, 570, 750, 1100]) {
    await seek(page, preview, time);
    if (time === 0) {
      const zero = (await art.boundingBox())!;
      expect(zero.x).toBeCloseTo(before.x, 1);
      expect(zero.y).toBeCloseTo(before.y, 1);
    }
    expect(
      await preview
        .locator('[data-bend-part="body"]')
        .evaluate((el) => el.outerHTML),
    ).toBe(body);
    await expect(preview.locator(".transition-panel")).not.toHaveAttribute(
      "inert",
    );
    await expect(preview.locator(".setup-steps .check")).toHaveCount(0);
    await preview.screenshot({ path: info.outputPath(`opening-${time}.png`) });
  }
  await seek(page, preview, 370);
  const middle = await art.evaluate((el) => el.outerHTML);
  await seek(page, preview, 0);
  await seek(page, preview, 370);
  expect(await art.evaluate((el) => el.outerHTML)).toBe(middle);
  await expect(preview.locator(".opening-paper path")).toHaveCount(7);
  await seek(page, preview, openingDuration);
  await expect(preview.locator(".opening-paper path")).toHaveCount(0);
});

test("the form stays usable during opening, preserves drafts on resize and returns on Cancel", async ({
  page,
  browserName,
}, info) => {
  const preview = await open(page);
  await preview.getByRole("button", { name: /Skip/i }).click();
  await seek(page, preview, 80);
  const name = preview.getByRole("textbox", {
    name: "Workspace name",
    exact: true,
  });
  await name.fill("Paper garden");
  await name.press("Tab");
  await expect(
    preview.getByRole("textbox", { name: "Create inside", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(
    preview.getByRole("button", { name: "Choose…", exact: true }),
  ).toBeFocused();
  await name.focus();
  for (const width of [390, 320, 1280]) {
    await preview.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await seek(page, preview, 370);
    await expect(name).toHaveValue("Paper garden");
    await expect(name).toBeFocused();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.screenshot({ path: info.outputPath(`opening-${width}.png`) });
  }
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: /^Create a workspace/ }),
  ).toBeFocused();
  await expect(page.getByLabel("Opening frame", { exact: true })).toHaveCount(
    0,
  );
  await expect(preview.locator(".opening-paper path")).toHaveCount(0);
  await expect(preview.locator(".workspace-setup")).toHaveCount(0);
  await expect(
    preview.getByRole("heading", { name: "Welcome to Situate." }),
  ).toBeVisible();
  await preview.getByRole("button", { name: /^Create a workspace/ }).click();
  await preview.getByRole("button", { name: /Skip/i }).click();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-opening-time",
    String(openingDuration),
  );
  await expect(name).toHaveValue("");
});

test("reduced motion skips the hop and progress expansion, including frame inspection", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-opening-time",
    String(openingDuration),
  );
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-opening",
    "false",
  );
  await expect(
    preview.getByRole("textbox", { name: "Workspace name", exact: true }),
  ).toBeEditable();
  await expect(preview.locator(".opening-paper path")).toHaveCount(0);
  await page.getByLabel("Opening frame", { exact: true }).fill("370");
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-opening-time",
    String(openingDuration),
  );
  await page
    .getByRole("button", { name: "Replay opening", exact: true })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-opening",
    "false",
  );
});

test("keyboard focus moves directly from welcome to creation", async ({
  page,
}) => {
  const preview = await open(page);
  const skip = preview.getByRole("button", { name: /Skip/i });
  await skip.focus();
  await skip.press("Enter");
  await expect(preview.locator("#create-title")).toBeFocused();
  await expect(
    preview.getByLabel("Workspace name", { exact: true }),
  ).toBeVisible();
});

test("reset cancels an inspected opening and direct create starts already settled", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.getByRole("button", { name: /Skip/i }).click();
  await seek(page, preview, 370);
  const actor = (await preview.locator(".actor svg").elementHandle())!;
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator(".fullscreen-welcome")).toBeVisible();
  expect(await actor.evaluate((el) => el.isConnected)).toBe(false);
  await expect(preview.locator(".opening-paper path")).toHaveCount(0);
  await selectScenario(page, "first-entry-create");
  await expect(
    preview.getByRole("textbox", { name: "Workspace name", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Opening frame", { exact: true })).toHaveCount(
    0,
  );
  await expect(preview.locator(".workspace-setup")).not.toHaveAttribute(
    "data-opening-time",
  );
  await expect(preview.locator(".opening-paper path")).toHaveCount(0);
  await expect(
    preview.getByRole("navigation", { name: "Workspace setup" }),
  ).toBeVisible();
});
