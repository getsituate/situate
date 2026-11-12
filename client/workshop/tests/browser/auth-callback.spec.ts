import { expect, test, type Page } from "./test";
import { selectOption } from "./select";
import { handoffDuration } from "../../src/auth-callback/score";

async function open(
  controls: Page,
  scenario = "auth-callback-received",
  reduced = false,
) {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await opened;
  await preview.setViewportSize({ width: 1280, height: 800 });
  await preview.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await expect(preview.locator(".auth-callback")).toBeVisible();
  return preview;
}
async function seek(controls: Page, preview: Page, time: number) {
  await controls
    .getByLabel("Animation frame", { exact: true })
    .evaluate((element, value) => {
      (element as HTMLInputElement).value = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
  await expect(preview.locator(".callback-handoff")).toHaveAttribute(
    "data-time",
    String(time),
  );
  await expect(preview.locator(".callback-celebration")).toHaveAttribute(
    "data-time",
    String(time),
  );
}

test("connected provider offers keyboard return guidance", async ({
  page,
  browserName,
}, info) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  preview.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("Vue warn"))
      errors.push(message.text());
  });
  await expect(
    preview.getByRole("heading", { name: "AI provider connected" }),
  ).toBeVisible();
  await expect(preview.getByRole("status")).toHaveCount(0);
  await expect(
    preview.getByText("Return to Situate to start using it."),
  ).toBeVisible();
  await expect(preview.getByRole("link")).toHaveCount(0);
  await expect(preview.getByRole("button")).toHaveCount(1);
  await expect(
    preview.getByRole("img", { name: "Situate", exact: true }),
  ).toHaveCount(1);
  await preview.keyboard.press(
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab",
  );
  const help = preview.getByRole("button", {
    name: "How do I return to Situate?",
  });
  await expect(help).toBeFocused();
  await expect(help).toBeEnabled();
  const contrasts = await preview.locator(".auth-callback").evaluate((root) => {
    const luminance = (color: string) => {
      const rgb = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const v = value / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    const background = getComputedStyle(root).backgroundColor;
    return ["h1", ".callback-body", ".callback-help"].map((selector) => {
      const foreground = getComputedStyle(root.querySelector(selector)!).color;
      const a = luminance(foreground),
        b = luminance(background);
      return {
        selector,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
  for (const { selector, ratio } of contrasts)
    expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
  const outline = await help.evaluate(
    (element) => getComputedStyle(element).outlineWidth,
  );
  expect(parseFloat(outline)).toBeGreaterThanOrEqual(3);
  await preview.keyboard.press("Enter");
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(
    preview.getByText(
      "Switch to the Situate app where you started signing in.",
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  await expect(help).toBeFocused();
  await expect(preview.getByText("On a Mac", { exact: false })).toHaveCount(0);
  await seek(page, preview, handoffDuration);
  await preview.screenshot({ path: info.outputPath("received-help.png") });
  await preview.keyboard.press("Space");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await selectOption(
    page.getByLabel("Connection result", { exact: true }),
    "rejected",
  );
  await expect(
    preview.getByRole("heading", { name: "Let’s return to Situate." }),
  ).toBeVisible();
  await expect(preview.getByRole("status")).toHaveText(
    "Connection not confirmed",
  );
  await expect(preview.locator(".callback-handoff")).toHaveCount(0);
  await expect(preview.locator(".callback-celebration")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Replay celebration" }),
  ).toHaveCount(0);
  await preview.screenshot({ path: info.outputPath("rejected.png") });
  expect(errors).toEqual([]);
});

test("finite handoff is deterministic, replayable, and reset cancels old playback", async ({
  page,
}, info) => {
  const preview = await open(page);
  const art = preview.locator(".callback-handoff");
  for (const time of [0, 450, 900, 1500, 2200, 3200, handoffDuration]) {
    await seek(page, preview, time);
    await expect(art).toHaveAttribute("data-playing", "false");
    await preview.screenshot({ path: info.outputPath(`handoff-${time}.png`) });
  }
  await seek(page, preview, 900);
  const pose = await art.innerHTML();
  const confetti = await preview.locator(".callback-celebration").innerHTML();
  await seek(page, preview, 2200);
  await seek(page, preview, 900);
  expect(await art.innerHTML()).toBe(pose);
  expect(await preview.locator(".callback-celebration").innerHTML()).toBe(
    confetti,
  );
  await page
    .getByRole("button", { name: "Resume animation", exact: true })
    .click();
  await expect(art).toHaveAttribute("data-playing", "true");
  await page
    .getByRole("button", { name: "Pause animation", exact: true })
    .click();
  await expect(art).toHaveAttribute("data-playing", "false");
  const pausedTime = await art.getAttribute("data-time");
  await preview.waitForTimeout(200);
  await expect(art).toHaveAttribute("data-time", pausedTime!);
  await expect(preview.locator(".callback-celebration")).toHaveAttribute(
    "data-time",
    pausedTime!,
  );
  await page
    .getByRole("button", { name: "Replay celebration", exact: true })
    .click();
  await expect(art).toHaveAttribute("data-playing", "true");
  await expect(art).toHaveAttribute("data-time", String(handoffDuration), {
    timeout: 8000,
  });
  await expect(art).toHaveAttribute("data-playing", "false");
  await expect(preview.locator(".celebration-piece")).toHaveCount(0);
  const end = await art.innerHTML();
  await preview.waitForTimeout(250);
  expect(await art.innerHTML()).toBe(end);
  await preview
    .getByRole("button", { name: "How do I return to Situate?" })
    .click();
  await page
    .getByRole("button", { name: "Replay celebration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "How do I return to Situate?" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(art).toHaveAttribute("data-time", String(handoffDuration), {
    timeout: 8000,
  });
  await expect(preview.getByRole("status")).toHaveCount(0);
});

test("confetti fills the viewport without covering the return guidance or intercepting input", async ({
  page,
}, info) => {
  const preview = await open(page);
  const effects = preview.locator(".callback-celebration");
  await seek(page, preview, 1500);
  await expect(preview.locator(".celebration-piece").first()).toBeVisible();
  expect(
    await preview.locator('[data-shape="sparkle"]').count(),
  ).toBeGreaterThan(0);
  await expect(effects).toHaveAttribute("aria-hidden", "true");
  expect(
    await effects.evaluate(
      (element) => getComputedStyle(element).pointerEvents,
    ),
  ).toBe("none");
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
    [320, 350],
  ]) {
    await preview.setViewportSize({ width: width!, height: height! });
    await expect(effects).toHaveAttribute("data-time", "1500");
    const viewport = (await preview
      .locator(".callback-surface")
      .boundingBox())!;
    const bounds = (await effects.boundingBox())!;
    for (const key of ["x", "y", "width", "height"] as const)
      expect(Math.abs(viewport[key] - bounds[key])).toBeLessThan(1);
    expect(
      await preview
        .locator(".auth-callback")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await preview.screenshot({
      path: info.outputPath(`celebration-${width}x${height}.png`),
    });
  }
  const help = preview.getByRole("button", {
    name: "How do I return to Situate?",
  });
  await help.click();
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(preview.getByRole("status")).toHaveCount(0);
  await preview.locator(".auth-callback").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByRole("button", { name: "Replay celebration" }).click();
  await expect
    .poll(async () =>
      Number(
        await preview.locator(".callback-handoff").getAttribute("data-time"),
      ),
    )
    .toBeGreaterThan(700);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(preview.locator(".callback-handoff")).toHaveAttribute(
    "data-time",
    String(handoffDuration),
  );
  await expect(preview.locator(".celebration-piece")).toHaveCount(0);
});

test("responsive browser content preserves help and does not overflow", async ({
  page,
}, info) => {
  const preview = await open(page);
  await seek(page, preview, handoffDuration);
  await preview
    .getByRole("button", { name: "How do I return to Situate?" })
    .click();
  for (const [width, height] of [
    [1440, 900],
    [768, 640],
    [390, 844],
    [320, 568],
    [320, 350],
    [640, 360],
  ]) {
    await preview.setViewportSize({ width: width!, height: height! });
    const help = preview.getByRole("button", {
      name: "How do I return to Situate?",
    });
    await help.scrollIntoViewIfNeeded();
    await expect(help).toBeInViewport();
    expect((await help.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await preview
        .locator(".auth-callback")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(preview.locator(".callback-handoff")).toHaveAttribute(
      "data-time",
      String(handoffDuration),
    );
    await preview.locator(".auth-callback").evaluate((element) => {
      element.scrollTop = 0;
    });
    await preview.screenshot({
      path: info.outputPath(`browser-${width}x${height}.png`),
    });
  }
  await preview.setViewportSize({ width: 1280, height: 800 });
  await preview.locator(".auth-callback").evaluate((element) => {
    (element as HTMLElement).style.zoom = "2";
  });
  await preview
    .getByRole("button", { name: "How do I return to Situate?" })
    .scrollIntoViewIfNeeded();
  expect(
    await preview
      .locator(".auth-callback")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await preview.screenshot({
    path: info.outputPath("browser-css-zoom-200.png"),
  });
});

test("OS reduced motion and the controls still keep the same message without autoplay", async ({
  page,
}) => {
  const preview = await open(page, "auth-callback-received", true);
  const art = preview.locator(".callback-handoff");
  await expect(art).toHaveAttribute("data-time", String(handoffDuration));
  await expect(art).toHaveAttribute("data-playing", "false");
  await page.getByRole("button", { name: "Replay celebration" }).click();
  await expect(art).toHaveAttribute("data-time", String(handoffDuration));
  await expect(art).toHaveAttribute("data-playing", "false");
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Replay celebration" }).click();
  await expect(art).toHaveAttribute("data-playing", "true");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(art).toHaveAttribute("data-playing", "false");
  await expect(art).toHaveAttribute("data-time", String(handoffDuration));
  await preview
    .getByRole("button", { name: "How do I return to Situate?" })
    .click();
  await expect(
    preview.getByRole("button", { name: "How do I return to Situate?" }),
  ).toHaveAttribute("aria-expanded", "true");
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByLabel("Show reduced-motion still", { exact: true }).check();
  await page.getByRole("button", { name: "Replay celebration" }).click();
  await expect(art).toHaveAttribute("data-playing", "false");
  await expect(preview.locator(".celebration-piece")).toHaveCount(0);
});
