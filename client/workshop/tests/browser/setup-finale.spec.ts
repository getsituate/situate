import { expect, test, type Page } from "./test";
import { selectScenario } from "./scenarios";

async function open(controls: Page, scenario = "setup-conversation-support") {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await opened;
  await preview.setViewportSize({ width: 1280, height: 900 });
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await expect(preview.locator(".actor svg")).toBeVisible();
  return preview;
}
async function seek(controls: Page, preview: Page, time: number) {
  await controls
    .getByLabel("Celebration frame", { exact: true })
    .evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-finale-time",
    String(time),
  );
}

test("confirmed setup expands the same Bend and paper into the workspace", async ({
  page,
}, info) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  preview.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("Vue warn"))
      errors.push(message.text());
  });
  const actor = (await preview.locator(".actor svg").elementHandle())!;
  const shape = () =>
    preview
      .locator('.actor [data-bend-part="body"]')
      .evaluate((el) => el.outerHTML);
  const body = await shape();
  const before = (await preview.locator(".actor svg").boundingBox())!;
  await expect(
    page.getByLabel("Celebration frame", { exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Go to workspace" }),
  ).toBeFocused();
  const workspace = (await preview
    .locator(".workspace-destination")
    .elementHandle())!;
  const chat = (await preview
    .locator(".workspace-destination .chat-screen")
    .elementHandle())!;
  for (const time of [0, 600, 1000, 1750, 2350, 3000, 3800, 4420, 5000, 5800]) {
    await seek(page, preview, time);
    expect(await actor.evaluate((el) => el.isConnected)).toBe(true);
    expect(await shape()).toBe(body);
    await expect(preview.locator(".workspace-destination")).toHaveAttribute(
      "inert",
      "",
    );
    await expect(preview.locator(".setup-panel")).toHaveAttribute("inert", "");
    if (time === 0) {
      const now = (await preview.locator(".actor svg").boundingBox())!;
      for (const key of ["x", "y", "width", "height"] as const)
        expect(
          Math.abs(now[key] - before[key]),
          `${key}: ${before[key]} → ${now[key]}`,
        ).toBeLessThan(1);
    }
    if ([1750, 3800, 4420, 5800].includes(time))
      await preview.screenshot({
        path: info.outputPath(`celebration-${time}.png`),
      });
  }
  await seek(page, preview, 1750);
  const pose = await actor.evaluate((el) => el.outerHTML);
  await seek(page, preview, 0);
  await seek(page, preview, 1750);
  expect(await actor.evaluate((el) => el.outerHTML)).toBe(pose);
  await page
    .getByRole("button", { name: "Replay celebration", exact: true })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveCount(0, {
    timeout: 9000,
  });
  expect(await workspace.evaluate((el) => el.isConnected)).toBe(true);
  expect(await chat.evaluate((el) => el.isConnected)).toBe(true);
  await expect(preview.locator(".workspace-destination")).not.toHaveAttribute(
    "inert",
  );
  await expect(
    preview.getByRole("heading", {
      name: "Your start with Situate",
      exact: true,
    }),
  ).toBeFocused();
  await expect(preview.locator(".arrival-welcome")).toBeHidden();
  await expect(
    page.getByLabel("Celebration frame", { exact: true }),
  ).toHaveCount(0);
  await expect(preview.locator(".chat-screen")).toBeVisible();
  await expect(preview.locator('.onboarding[data-step="home"]')).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Your workspace", exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("textbox", { name: "Message" })
    .fill("What can we do next?");
  await expect(preview.getByRole("textbox", { name: "Message" })).toHaveValue(
    "What can we do next?",
  );
  expect(errors).toEqual([]);
});

test("celebration remains seekable and usable in narrow and short windows", async ({
  page,
}, info) => {
  const preview = await open(page, "setup-conversation-finale");
  const actor = (await preview.locator(".actor svg").elementHandle())!;
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [320, 350],
  ]) {
    await preview.setViewportSize({ width: width!, height: height! });
    for (const time of [1750, 3000, 4420, 5800]) {
      await seek(page, preview, time);
      const skip = preview.getByRole("button", { name: "Go to workspace" });
      await expect(skip).toBeInViewport();
      await expect(
        preview.getByRole("button", { name: "Pause", exact: true }),
      ).toBeInViewport();
      expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await preview.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await actor.evaluate((el) => el.isConnected)).toBe(true);
      if (time === 1750) {
        const heading = (await preview
          .locator(".finale-announcement h1")
          .boundingBox())!;
        const canopyTop = await preview
          .locator(".ribbon-canopy path")
          .nth(1)
          .evaluate((element) => {
            const path = element as SVGGraphicsElement;
            return (
              path.getBoundingClientRect().top - 21.5 * path.getScreenCTM()!.a
            );
          });
        expect(heading.y + heading.height + 8).toBeLessThan(canopyTop);
      }
      await preview.screenshot({
        path: info.outputPath(`celebration-${width}-${height}-${time}.png`),
      });
    }
  }
  await selectScenario(page, "setup-conversation-support");
  await expect(preview.locator(".frame-art")).toBeHidden();
  await preview
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  await seek(page, preview, 0);
  await expect(preview.locator(".setup-illustration > g")).toHaveAttribute(
    "opacity",
    "0",
  );
  await seek(page, preview, 1750);
  await expect(preview.locator(".actor svg")).toBeInViewport();
  await preview.getByRole("button", { name: "Go to workspace" }).click();
  await expect(
    preview.getByRole("heading", {
      name: "Your start with Situate",
      exact: true,
    }),
  ).toBeFocused();
});

test("pause and keyboard skip do not require watching the finale", async ({
  page,
  browserName,
}) => {
  const preview = await open(page);
  await preview
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  const pause = preview.getByRole("button", { name: "Pause", exact: true });
  await pause.focus();
  await pause.press("Enter");
  const root = preview.locator(".workspace-setup");
  const time = await root.getAttribute("data-finale-time");
  await preview.waitForTimeout(180);
  await expect(root).toHaveAttribute("data-finale-time", time!);
  await expect(
    preview.getByRole("button", { name: "Resume", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const skip = preview.getByRole("button", { name: "Go to workspace" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(root).toHaveCount(0);
  await expect(
    preview.getByRole("heading", {
      name: "Your start with Situate",
      exact: true,
    }),
  ).toBeFocused();
});

test("reduced motion opens the normal chat without zoom or delay", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await preview
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveCount(0);
  await expect(
    preview.getByRole("heading", {
      name: "Your start with Situate",
      exact: true,
    }),
  ).toBeFocused();
  await expect(preview.locator(".chat-screen")).toBeVisible();
  await expect(preview.locator(".arrival-welcome")).toHaveCount(0);
  await expect(preview.locator(".workspace-destination")).not.toHaveAttribute(
    "inert",
  );
  expect(
    await preview
      .locator(".workspace-destination")
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await preview.screenshot({
    path: info.outputPath("normal-chat-reduced-motion.png"),
  });
});

test("reset cancels playback and the finale starting state restores its inspection frame", async ({
  page,
}) => {
  const preview = await open(page);
  await preview
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  const actor = (await preview.locator(".actor svg").elementHandle())!;
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Finish setup", exact: true }),
  ).toBeVisible();
  expect(await actor.evaluate((el) => el.isConnected)).toBe(false);
  await preview.waitForTimeout(6000);
  await expect(
    preview.getByRole("button", { name: "Finish setup", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".finale-announcement")).toHaveCount(0);
  await selectScenario(page, "setup-conversation-finale");
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-finale-time",
    "1750",
  );
  await seek(page, preview, 4000);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-finale-time",
    "1750",
  );
});
