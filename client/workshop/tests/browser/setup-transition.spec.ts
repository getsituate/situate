import { selectOption } from "./select";
import { expect, test, type Page } from "./test";
import {
  transitionDuration,
  panelHandoff,
} from "../../src/workspaces/setup-transition";

async function open(page: Page) {
  await page.goto("/?workshop=controls&scenario=first-entry-create");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await opened;
  await preview.setViewportSize({ width: 1280, height: 900 });
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  return preview;
}
async function seek(controls: Page, preview: Page, time: number) {
  await controls
    .getByLabel("Transition frame", { exact: true })
    .evaluate((input, time) => {
      (input as HTMLInputElement).value = String(time);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transition-time",
    String(time),
  );
}

test("creation transitions in place, with a drawn check and a held destination pose", async ({
  page,
}, info) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  const actor = (await preview.locator(".actor svg").elementHandle())!;
  const art = (await preview.locator(".setup-illustration").boundingBox())!;
  const stepXs = await preview
    .locator(".setup-steps .number")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    );
  await selectOption(page.getByLabel("Action result"), "wait");
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Fail action", exact: true }),
  ).toBeEnabled();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "false",
  );
  await page.getByRole("button", { name: "Fail action", exact: true }).click();
  await expect(preview.getByRole("alert")).toBeVisible();
  await expect(preview.locator(".setup-steps .check")).toHaveCount(0);
  await selectOption(page.getByLabel("Action result"), "success");
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "false",
  );
  expect(await actor.evaluate((element) => element.isConnected)).toBe(true);
  const after = (await preview.locator(".setup-illustration").boundingBox())!;
  expect(after.x).toBeCloseTo(art.x, 1);
  expect(after.y).toBeCloseTo(art.y, 1);
  const nextXs = await preview
    .locator(".setup-steps .number")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    );
  nextXs.forEach((x, index) => expect(x).toBeCloseTo(stepXs[index]!, 1));
  await expect(preview.locator(".celebration")).toHaveCount(0);

  for (const time of [
    0,
    250,
    500,
    750,
    900,
    1150,
    1400,
    1800,
    panelHandoff,
    2500,
    transitionDuration,
  ]) {
    await seek(page, preview, time);
    await preview.screenshot({
      path: info.outputPath(`transition-${time}.png`),
    });
  }
  await seek(page, preview, 500);
  await expect(preview.locator(".sparkles")).toHaveCount(0);
  await expect(preview.locator(".transition-panel")).toHaveAttribute(
    "inert",
    "",
  );
  const check = await preview
    .locator(".setup-steps .check path")
    .evaluate((element) =>
      Number((element as SVGElement).style.strokeDashoffset),
    );
  expect(check).toBeGreaterThan(0);
  expect(check).toBeLessThan(1);
  await seek(page, preview, 900);
  await expect(preview.locator(".transition-panel")).toHaveCSS("opacity", "0");
  await expect(preview.locator(".sparkles")).toHaveCount(1);
  await expect(
    preview.locator('.setup-steps [aria-current="step"]'),
  ).toContainText("Create a workspace");
  const pose = await actor.evaluate((element) => element.outerHTML);
  await seek(page, preview, transitionDuration);
  await seek(page, preview, 900);
  expect(await actor.evaluate((element) => element.outerHTML)).toBe(pose);
  await preview.setViewportSize({ width: 390, height: 844 });
  expect(await actor.evaluate((element) => element.outerHTML)).toBe(pose);
  await seek(page, preview, 2500);
  await expect(
    preview.locator('.setup-steps [aria-current="step"]'),
  ).toContainText("Connect AI");
  await preview.screenshot({
    path: info.outputPath("transition-mobile-2500.png"),
  });
  const playback = preview.evaluate(
    (duration) =>
      new Promise<{ time: number; opacity: number }[]>((resolve) => {
        const frames: { time: number; opacity: number }[] = [];
        let started = false;
        const sample = () => {
          const root = document.querySelector<HTMLElement>(".workspace-setup")!;
          const time = Number(root.dataset.transitionTime);
          if (time < 100) started = true;
          if (started) {
            const opacity =
              document.querySelector<HTMLElement>(".transition-panel")!.style
                .opacity;
            frames.push({
              time,
              opacity: opacity === "" ? 1 : Number(opacity),
            });
          }
          if (started && time === duration) resolve(frames);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    transitionDuration,
  );
  await page
    .getByRole("button", { name: "Replay transition", exact: true })
    .click();
  const frames = await playback;
  expect(frames.some((frame) => frame.opacity > 0 && frame.opacity < 1)).toBe(
    true,
  );
  expect(frames.at(-1)).toEqual({ time: transitionDuration, opacity: 1 });
  expect(
    frames.some(
      (frame) => frame.time >= 750 && frame.time <= 1150 && frame.opacity === 0,
    ),
  ).toBe(true);
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "false",
  );
  const final = await actor.evaluate((element) => element.outerHTML);
  await preview.reload();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "false",
  );
  expect(final).toContain('data-bend-pose="rest"');
  expect(errors).toEqual([]);
});

test("starting provider setup releases an inspected creation transition", async ({
  page,
}) => {
  const preview = await open(page);
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider", exact: true }),
  ).toBeVisible();
  await seek(page, preview, 2500);
  await preview
    .getByRole("button", {
      name: "OpenAI Provider sign-in available",
      exact: true,
    })
    .click();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "false",
  );
  await expect(preview.locator("#create-title")).toHaveCount(0);
  await expect(
    page.getByLabel("Transition frame", { exact: true }),
  ).toHaveCount(0);
});

test("reduced motion reaches the same next task without a decorative wait", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transition-time",
    String(transitionDuration),
  );
  await expect(preview.locator(".sparkles")).toHaveCount(0);
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await seek(page, preview, 900);
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(preview.locator(".workspace-setup")).toHaveAttribute(
    "data-transitioning",
    "false",
  );
  await expect(preview.locator(".transition-panel")).not.toHaveAttribute(
    "inert",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Make room for what matters." }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Transition frame", { exact: true }),
  ).toHaveCount(0);
});
