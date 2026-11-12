import { chromium, webkit, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = process.env.ASTRA_ORIGIN ?? "http://127.0.0.1:1595";
const output = process.env.ASTRA_PROOFS ?? "/tmp/situate-astra";
await mkdir(output, { recursive: true });
const engines =
  process.env.ASTRA_ENGINE === "chromium" ? { chromium } : { chromium, webkit };
for (const [engine, browserType] of Object.entries(engines)) {
  const browser = await browserType.launch();
  const context = await browser.newContext();
  const errors = [];
  context.on("page", (page) =>
    page.on("pageerror", (e) => errors.push(e.message)),
  );
  const controls = await context.newPage();
  await controls.goto(`${origin}/?workshop=controls&scenario=first-entry`);
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await opened;
  await expect(preview.locator(".unfolding-place")).toBeVisible();
  for (const [width, height] of [
    [1280, 900],
    [1440, 900],
    [390, 844],
    [320, 568],
  ]) {
    await preview.setViewportSize({ width, height });
    for (const time of [0, 2000, 4800, 6900, 9000, 10600]) {
      await controls
        .getByRole("slider", { name: "Animation frame" })
        .evaluate((element, value) => {
          element.value = String(value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }, time);
      await expect(preview.locator(".unfolding-place")).toHaveAttribute(
        "data-time",
        String(time),
      );
      await preview.screenshot({
        path: `${output}/${engine}-${width}x${height}-${time}.png`,
      });
      const bounds = await preview.locator(".unfolding-place").boundingBox();
      expect(bounds).toEqual({ x: 0, y: 0, width, height });
      for (const button of await preview.locator(".playback button").all()) {
        const box = await button.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
      }
    }
  }
  await controls
    .getByRole("button", { name: "Replay animation", exact: true })
    .click();
  const stage = preview.locator(".unfolding-place");
  const reset = async () => {
    await controls
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(stage).toBeVisible();
  };
  const time = async () => Number(await stage.getAttribute("data-time"));
  const choice = preview.locator(".first-panel");
  for (const [width, height] of [
    [1280, 900],
    [1440, 900],
    [390, 844],
    [320, 568],
  ]) {
    await preview.setViewportSize({ width, height });
    await reset();
    await expect.poll(time).toBeLessThan(1000);
    await expect.poll(time, { timeout: 12_000 }).toBeGreaterThanOrEqual(9000);
    await preview.screenshot({
      path: `${output}/${engine}-${width}x${height}-live-hold.png`,
    });
    await expect(choice).toBeVisible({ timeout: 4000 });
    await expect(stage).toHaveCount(0);
    await expect
      .poll(() =>
        choice.evaluate(
          (el) => el.ownerDocument.defaultView.getComputedStyle(el).opacity,
        ),
      )
      .toBe("1");
    await preview.screenshot({
      path: `${output}/${engine}-${width}x${height}-handoff.png`,
    });
  }
  await reset();
  await expect.poll(time).toBeGreaterThan(500);
  const pause = preview.getByRole("button", {
    name: "Pause motion",
    exact: true,
  });
  await pause.focus();
  await preview.keyboard.press("Space");
  const resume = preview.getByRole("button", {
    name: "Resume motion",
    exact: true,
  });
  await expect(resume).toHaveAttribute("aria-pressed", "true");
  const frozen = await stage.innerHTML();
  const frozenTime = await time();
  await preview.waitForTimeout(350);
  expect(await stage.innerHTML()).toBe(frozen);
  await preview.setViewportSize({ width: 1440, height: 900 });
  expect(await time()).toBe(frozenTime);
  await resume.press("Space");
  await expect.poll(time).toBeGreaterThan(frozenTime + 200);
  await stage.evaluate((el) => {
    el.style.transform = "translateX(200vw)";
  });
  await preview.waitForTimeout(150);
  const suspended = await time();
  await preview.waitForTimeout(350);
  expect(await time()).toBe(suspended);
  await stage.evaluate((el) => {
    el.style.transform = "";
  });
  await preview.waitForTimeout(100);
  expect(await time()).toBeLessThan(suspended + 200);
  await preview
    .getByRole("button", { name: "Skip intro", exact: true })
    .focus();
  await preview.keyboard.press("Enter");
  await expect(choice).toBeVisible();
  await expect(preview.locator("#first-title")).toBeFocused();
  await reset();
  await expect.poll(time).toBeLessThan(1000);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(choice).toBeVisible();
  await controls
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(choice).toBeVisible();
  await expect(stage).toHaveCount(0);
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await expect(stage).toHaveCount(0);
  await reset();
  await preview
    .getByRole("button", { name: "Pause motion", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Resume motion", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Skip intro", exact: true })
    .click();
  await expect(choice).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    `${engine}: deterministic frames, full playback and handoffs at four sizes; keyboard pause/resume/skip, offscreen suspension, resize, reset and reduced-motion checks passed; ${output}`,
  );
  await browser.close();
}
