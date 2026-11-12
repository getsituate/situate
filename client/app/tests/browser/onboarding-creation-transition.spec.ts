import { expect, test, type Page } from "./test";
import { onboardingFixture } from "./onboarding-fixture";

test.use({ localizationMode: "real" });

async function prepare(page: Page) {
  await onboardingFixture(page, { startAtEntry: true, connected: false });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /^Create a workspace/ }).click();
  await page
    .getByRole("textbox", { name: "Workspace name", exact: true })
    .fill("Field notes");
  await expect(page.locator(".setup-entry-enter-active")).toHaveCount(0);
}

async function controlFrames(page: Page) {
  await page.evaluate(() => {
    let id = 0;
    const frames = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      frames.set(++id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
    Reflect.set(window, "creationTick", (time: number) => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(time);
      }
    });
  });
}

async function tick(page: Page, time: number) {
  await page.evaluate(
    (time) => Reflect.get(window, "creationTick")(time),
    time,
  );
}

async function expectCreatedOnce(page: Page) {
  expect(
    await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls").filter(
          (call: { args: { action?: string } }) =>
            call.args.action === "create",
        ).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toMatchObject({ step: "access", entered: false });
}

for (const stalled of [false, true]) {
  test(`creation retains the outgoing form until transparent and reveals the provider only after travel${stalled ? " with delayed frames" : ""}`, async ({
    page,
  }) => {
    await prepare(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await controlFrames(page);
    await page.evaluate(() => {
      const observations: { phase: string | null; opacity: number }[] = [];
      Reflect.set(window, "creationObservations", observations);
      new MutationObserver(() => {
        const panel = document.querySelector<HTMLElement>(".setup-panel");
        if (panel?.querySelector("#ai-heading")) {
          observations.push({
            phase: panel.getAttribute("data-transition-phase"),
            opacity: Number(getComputedStyle(panel).opacity),
          });
        }
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    });
    const submit = page.getByRole("button", {
      name: "Create workspace",
      exact: true,
    });
    await submit.focus();
    await submit.press("Enter");
    const panel = page.locator(".setup-panel");
    const provider = page.getByRole("heading", {
      name: "Choose a provider",
      exact: true,
      includeHidden: true,
    });
    await expect(panel).toHaveAttribute("data-transition-phase", "leaving");
    await expect(provider).toHaveCount(0);
    await expect(panel).toHaveAttribute("inert", "");
    await tick(page, 0);
    await tick(page, 125);
    await expect(
      page.getByRole("textbox", {
        name: "Workspace name",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveValue("Field notes");
    const opacity = await panel.evaluate((el) =>
      Number(getComputedStyle(el).opacity),
    );
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    await expect(provider).toHaveCount(0);
    const exitTime = stalled ? 9000 : 250;
    await tick(page, exitTime);
    await expect(panel).toHaveCSS("opacity", "0");
    await expect(page.locator(".conversation-setup")).toHaveCount(1);
    await expect(provider).toHaveCount(0);
    await tick(page, exitTime + 1500);
    await expect(panel).toHaveAttribute("data-transition-phase", "travel");
    await expect(provider).toHaveCount(0);
    const handoffTime = stalled ? 20000 : 2350;
    await tick(page, handoffTime);
    await expect(provider).toHaveCount(1);
    await expect(panel).toHaveCSS("opacity", "0");
    await tick(page, handoffTime + 150);
    await expect(provider).toBeVisible();
    await expect(panel).toHaveAttribute("inert", "");
    await tick(page, handoffTime + 350);
    await expect(panel).not.toHaveAttribute("inert");
    await expect(provider).toBeFocused();
    const observations = (await page.evaluate(() =>
      Reflect.get(window, "creationObservations"),
    )) as { phase: string; opacity: number }[];
    expect(observations.length).toBeGreaterThan(0);
    expect(
      observations.every(
        ({ phase, opacity }) =>
          opacity === 0 || phase === "entering" || phase === "idle",
      ),
    ).toBe(true);
    await expectCreatedOnce(page);
  });
}

test("a rejected creation keeps the form usable without starting the handoff", async ({
  page,
}) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    const host = Reflect.get(window, "__TAURI_INTERNALS__");
    const original = host.invoke.bind(host);
    let rejected = false;
    host.invoke = (command: string, args: Record<string, unknown>) => {
      if (args?.action === "create" && !rejected) {
        rejected = true;
        return Promise.reject("native.workspace.storage");
      }
      return original(command, args);
    };
  });
  const submit = page.getByRole("button", {
    name: "Create workspace",
    exact: true,
  });
  await submit.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Workspace name", exact: true }),
  ).toHaveValue("Field notes");
  await expect(page.locator(".setup-panel")).toHaveAttribute(
    "data-transition-phase",
    "idle",
  );
  await expect(page.locator(".setup-panel")).not.toHaveAttribute("inert");
  await expect(submit).toBeEnabled();
  await expect(page.locator(".ai-provider-grid")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await submit.click();
  await expect(
    page.getByRole("heading", { name: "Choose a provider", exact: true }),
  ).toBeVisible();
  await expectCreatedOnce(page);
});

for (const live of [false, true]) {
  test(`creation completes with ${live ? "live" : "initial"} reduced motion without replaying creation`, async ({
    page,
  }) => {
    await prepare(page);
    if (live) {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      // Keep the preference change inside the leaving phase on busy browsers.
      await controlFrames(page);
    }
    const submit = page.getByRole("button", {
      name: "Create workspace",
      exact: true,
    });
    await submit.focus();
    await submit.press("Enter");
    if (live) {
      await expect(page.locator(".setup-panel")).toHaveAttribute(
        "data-transition-phase",
        "leaving",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
    }
    const provider = page.getByRole("heading", {
      name: "Choose a provider",
      exact: true,
    });
    await expect(provider).toBeVisible();
    await expect(page.locator(".setup-panel")).not.toHaveAttribute("inert");
    await expect(provider).toBeFocused();
    await expectCreatedOnce(page);
  });
}
