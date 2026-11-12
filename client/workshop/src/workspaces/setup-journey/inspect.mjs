import { chromium, webkit, expect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arrivalFrame, journeyFrame } from "./journey.ts";

const output =
  process.env.JOURNEY_REVIEW_OUTPUT ??
  (await mkdtemp(join(tmpdir(), "situate-setup-journey-")));
const url = process.env.WORKSHOP_URL ?? "http://127.0.0.1:1421";
await mkdir(output, { recursive: true });
const report = [];

// Sample complete decorative frames inside the workshop preview without
// advancing later setup forms or executing their simulated operations.
async function setArtwork(page, fromStep, step, travel, reaction = 0) {
  await page.locator(".setup-illustration").evaluate(
    (element, values) => {
      element.__vueParentComponent.props.frame = values;
    },
    journeyFrame({ fromStep, step, travel, reaction, blocked: false }),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        );
      }),
  );
}

async function seek(controls, preview, time) {
  await controls
    .getByLabel("Transition frame", { exact: true })
    .evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transition-time",
    String(time),
  );
}

for (const [engine, launcher] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "no-preference",
    recordVideo: {
      dir: join(output, engine),
      size: { width: 1280, height: 900 },
    },
  });
  const controls = await context.newPage();
  await controls.goto(`${url}/?workshop=controls&scenario=first-entry-create`);
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await opened;
  await preview.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  const art = preview.locator(".setup-illustration");
  await expect(art).toBeVisible();
  const actor = await preview.locator(".actor svg").elementHandle();
  const face = await preview.locator('[data-bend-part="face"]').elementHandle();
  const body = preview.locator('[data-bend-part="body"]');
  const canonicalBody = await body.evaluate((element) => element.outerHTML);
  const markup = () => art.evaluate((node) => node.outerHTML);
  await preview.screenshot({
    path: join(output, `${engine}-desktop-create.png`),
  });
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transition-time",
    "2700",
  );
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  expect(await actor.evaluate((node) => node.isConnected)).toBe(true);
  const ended = await markup();
  await preview.waitForTimeout(300);
  expect(await markup()).toBe(ended);

  const boundaries = [
    0, 250, 500, 750, 900, 1150, 1250, 1390, 1550, 1750, 1950, 2170, 2290, 2350,
    2700,
  ];
  let checkStill;
  for (const time of boundaries) {
    await seek(controls, preview, time);
    await art.screenshot({
      path: join(output, `${engine}-creation-${time}.png`),
    });
    if (time === 0) checkStill = await markup();
    if ([250, 500, 750, 1150].includes(time))
      expect(await markup()).toBe(checkStill);
  }
  await seek(controls, preview, 1750);
  const mid = await markup();
  await seek(controls, preview, 2700);
  await seek(controls, preview, 1750);
  expect(await markup()).toBe(mid);
  await controls
    .getByRole("button", { name: "Replay transition", exact: true })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "true",
  );
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transition-time",
    "2700",
  );
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "false",
  );

  await preview
    .getByRole("searchbox", { name: "Find a provider", exact: true })
    .focus();
  await preview.keyboard.press("Tab");
  const focusedControl = await preview.evaluateHandle(
    () => globalThis.document.activeElement,
  );
  const framing = [];
  for (const [profile, width, height] of [
    ["desktop", 1280, 900],
    ["narrow", 390, 844],
    ["compact", 320, 568],
  ]) {
    await preview.setViewportSize({ width, height });
    for (let step = 0; step < 5; step++) {
      await setArtwork(preview, step, step, 1);
      await art.screenshot({
        path: join(output, `${engine}-${profile}-station-${step}.png`),
      });
      const a = await art.boundingBox();
      const f = await preview.locator('[data-bend-part="face"]').boundingBox();
      expect(f.x).toBeGreaterThan(a.x);
      expect(f.y).toBeGreaterThan(a.y);
      expect(f.x + f.width).toBeLessThan(a.x + a.width);
      expect(f.y + f.height).toBeLessThan(a.y + a.height);
      framing.push({ profile, step, artwork: a, face: f });
    }
    for (let step = 1; step < 5; step++) {
      const frames = new Map();
      for (const travel of [0, 0.1, 0.25, 0.45, 0.65, 0.85, 0.96, 1]) {
        await setArtwork(preview, step - 1, step, travel);
        frames.set(travel, await markup());
        expect(await body.evaluate((element) => element.outerHTML)).toBe(
          canonicalBody,
        );
        if (profile !== "compact")
          await art.screenshot({
            path: join(
              output,
              `${engine}-${profile}-segment-${step}-${travel}.png`,
            ),
          });
      }
      for (const travel of [0.85, 0.65, 0.45, 0.25, 0.1, 0]) {
        await setArtwork(preview, step - 1, step, travel);
        expect(await markup()).toBe(frames.get(travel));
      }
      await setArtwork(preview, step - 1, step, 1);
      const endpoint = await markup();
      if (step < 4) {
        await setArtwork(preview, step, step + 1, 0);
        expect(await markup()).toBe(endpoint);
      }
    }
    expect(
      await preview.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
  }

  await preview.setViewportSize({ width: 1280, height: 900 });
  // A continuous interface-level run supplies the same 1200ms travel interval
  // as the host, with a 500ms still between waypoints for film inspection.
  const travelFrames = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 121 }, (_, j) =>
      journeyFrame({ fromStep: i, step: i + 1, travel: j / 120, reaction: 0 }),
    ),
  );
  const playback = await art.evaluate(async (element, frames) => {
    const props = element.__vueParentComponent.props;
    const samples = [];
    for (let step = 1; step < 5; step++) {
      props.frame = frames[step - 1][0];
      await new Promise((resolve) => {
        const start = performance.now();
        function tick(now) {
          const travel = Math.max(0, Math.min(1, (now - start) / 1200));
          props.frame = frames[step - 1][Math.round(travel * 120)];
          samples.push({ step, time: now - start, travel });
          if (travel === 1) resolve();
          else globalThis.requestAnimationFrame(tick);
        }
        globalThis.requestAnimationFrame(tick);
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
    }
    return samples;
  }, travelFrames);
  expect(playback.filter((sample) => sample.travel === 1)).toHaveLength(4);
  expect(await actor.evaluate((node) => node.isConnected)).toBe(true);
  expect(await face.evaluate((node) => node.isConnected)).toBe(true);
  await preview.screenshot({
    path: join(output, `${engine}-desktop-held-ending.png`),
  });
  const held = await markup();
  await preview.waitForTimeout(350);
  expect(await markup()).toBe(held);

  const arrivalOrigin = await markup();
  const arrivalFrames = Array.from({ length: 133 }, (_, i) =>
    arrivalFrame(i / 132),
  );
  for (const [profile, width, height] of [
    ["desktop", 1280, 900],
    ["narrow", 390, 844],
  ]) {
    await preview.setViewportSize({ width, height });
    for (const t of [0, 0.2, 0.42, 0.54, 0.65, 0.8, 0.91, 1]) {
      await art.evaluate((element, frame) => {
        element.__vueParentComponent.props.frame = frame;
      }, arrivalFrame(t));
      await preview.evaluate(
        () =>
          new Promise((resolve) => {
            globalThis.requestAnimationFrame(resolve);
          }),
      );
      if (t === 0) expect(await markup()).toBe(arrivalOrigin);
      expect(await body.evaluate((element) => element.outerHTML)).toBe(
        canonicalBody,
      );
      await art.screenshot({
        path: join(output, `${engine}-${profile}-arrival-${t}.png`),
      });
    }
  }
  await preview.setViewportSize({ width: 1280, height: 900 });
  await art.evaluate(async (element, frames) => {
    await new Promise((resolve) => {
      const start = performance.now();
      function tick(now) {
        const p = Math.max(0, Math.min(1, (now - start) / 2200));
        element.__vueParentComponent.props.frame =
          frames[Math.round(p * (frames.length - 1))];
        if (p === 1) resolve();
        else globalThis.requestAnimationFrame(tick);
      }
      globalThis.requestAnimationFrame(tick);
    });
  }, arrivalFrames);
  const arrivalEnd = await markup();
  await preview.waitForTimeout(400);
  expect(await markup()).toBe(arrivalEnd);
  expect(await actor.evaluate((node) => node.isConnected)).toBe(true);

  expect(
    await focusedControl.evaluate(
      (node) => node === globalThis.document.activeElement,
    ),
  ).toBe(true);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await controls
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transition-time",
    "2700",
  );
  await expect(art).toHaveAttribute("data-position", "1");
  for (const [step, state] of [
    "first-entry-create",
    "first-entry-ai",
    "onboarding-method",
    "onboarding-sources",
    "onboarding-plan",
  ].entries()) {
    await controls
      .getByRole("combobox", { name: "Scenario", exact: true })
      .selectOption(state);
    const startingState = controls.getByLabel("Starting state", {
      exact: true,
    });
    if (await startingState.count()) await startingState.selectOption(state);
    await expect(art).toHaveAttribute("data-position", String(step));
    for (const [profile, width, height] of [
      ["desktop", 1280, 900],
      ["narrow", 390, 844],
    ]) {
      await preview.setViewportSize({ width, height });
      await preview.screenshot({
        path: join(output, `${engine}-${profile}-${state}.png`),
      });
    }
  }
  expect(errors).toEqual([]);
  const video = preview.video();
  await context.close();
  await video.saveAs(join(output, `${engine}-playback.webm`));
  await browser.close();
  report.push({ engine, boundaries, framing, playback, errors });
}
await writeFile(join(output, "review.json"), JSON.stringify(report, null, 2));
console.log(output);
