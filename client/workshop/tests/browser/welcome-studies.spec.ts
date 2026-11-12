import { selectOption } from "./select";
import { expect, test, type Page } from "./test";
import { selectScenario } from "./scenarios";

async function openStudy(controls: Page) {
  await controls.goto("/?workshop=controls&scenario=first-entry");
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  return opened;
}
async function seek(controls: Page, time: number) {
  await controls
    .getByRole("slider", { name: "Animation frame" })
    .evaluate((element, value) => {
      const slider = element as HTMLInputElement;
      slider.value = String(value);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
  await expect(
    controls.getByRole("slider", { name: "Animation frame" }),
  ).toHaveValue(String(time));
}

test("first visit uses Astra and resets its welcome", async ({ page }) => {
  const preview = await openStudy(page);
  await expect(preview.locator(".unfolding-place")).toBeVisible();
  await preview.getByRole("button", { name: /Skip/i }).click();
  await expect(
    preview.getByRole("heading", { name: "Make room for what matters." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator(".unfolding-place")).toBeVisible();
});

test("guided setup resumes and requires model verification before the working method", async ({
  page,
}) => {
  const preview = await openStudy(page);
  await selectScenario(page, "first-entry-model");
  const check = preview.getByRole("button", {
    name: "Check model and begin",
    exact: true,
  });
  await expect(check).toBeDisabled();
  await selectOption(
    preview.getByLabel("Model for setup", { exact: true }),
    "example-chat",
  );
  await preview
    .getByRole("button", { name: "Finish later", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Pick up where you left off." }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Resume setup", exact: true })
    .click();
  await expect(
    preview.getByLabel("Model for setup", { exact: true }),
  ).toHaveAttribute("data-value", "example-chat");
  await check.click();
  await expect(preview.getByRole("status")).toContainText(
    "Checking model access",
  );
  await page
    .getByRole("button", { name: "Model check succeeded", exact: true })
    .click();
  await expect(
    preview.locator('.setup-steps [aria-current="step"]'),
  ).toContainText("Shape your working method");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(check).toBeDisabled();
  await expect(
    preview.getByLabel("Model for setup", { exact: true }),
  ).toHaveAttribute("data-value", "");
});

for (const study of ["astra"]) {
  test(`${study} welcome fills the viewport and supports frame inspection, pause, skip and reset`, async ({
    page,
  }) => {
    const preview = await openStudy(page);
    const errors: string[] = [];
    preview.on("pageerror", (error) => errors.push(error.message));
    await preview.setViewportSize({ width: 1280, height: 900 });
    await expect(preview.locator(".fullscreen-welcome")).toBeVisible();
    await expect(preview.getByRole("button", { name: /Skip/i })).toBeVisible();
    const bounds = await preview.locator(".fullscreen-welcome").boundingBox();
    expect(bounds?.width).toBe(1280);
    expect(bounds?.height).toBe(900);
    const end = Number(
      await page
        .getByRole("slider", { name: "Animation frame" })
        .getAttribute("max"),
    );
    await seek(page, end);
    await expect(
      preview.getByRole("button", { name: /Skip/i }),
    ).toBeInViewport();
    expect(
      await preview
        .getByRole("button", { name: /Skip/i })
        .evaluate((element) => {
          let opacity = 1;
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          )
            opacity *= Number(getComputedStyle(node).opacity);
          return opacity;
        }),
    ).toBe(1);
    await seek(page, 3000);
    await preview.waitForTimeout(100);
    const drawing = await preview.locator(".fullscreen-welcome").innerHTML();
    await seek(page, 5000);
    await preview.waitForTimeout(100);
    await seek(page, 3000);
    await preview.waitForTimeout(100);
    expect(await preview.locator(".fullscreen-welcome").innerHTML()).toBe(
      drawing,
    );
    await page
      .getByRole("button", { name: "Replay animation", exact: true })
      .click();
    await preview.getByRole("button", { name: /Pause/i }).click();
    await preview.waitForTimeout(100);
    const paused = await preview.locator(".fullscreen-welcome").innerHTML();
    await preview.waitForTimeout(250);
    expect(await preview.locator(".fullscreen-welcome").innerHTML()).toBe(
      paused,
    );
    await preview.setViewportSize({ width: 320, height: 568 });
    await expect(
      preview.getByRole("button", { name: /Skip/i }),
    ).toBeInViewport();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.getByRole("button", { name: /Skip/i }).click();
    await expect(
      preview.getByRole("heading", { name: "Make room for what matters." }),
    ).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "Animation frame" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(preview.locator(".fullscreen-welcome")).toBeVisible();
    await preview.emulateMedia({ reducedMotion: "reduce" });
    await expect(
      preview.getByRole("heading", { name: "Make room for what matters." }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${study} welcome completes its full score and enters creation once`, async ({
    page,
  }) => {
    test.setTimeout(45000);
    const preview = await openStudy(page);
    await expect(preview.locator(".fullscreen-welcome")).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "Make room for what matters." }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      preview.getByLabel("Workspace name", { exact: true }),
    ).toBeVisible();
    await preview.waitForTimeout(300);
    await expect(
      preview.getByLabel("Workspace name", { exact: true }),
    ).toBeVisible();
  });
}
