import { expect, test, type Page } from "./test";
import { t } from "@situate/localization";
import { onboardingFixture } from "./onboarding-fixture";
import { newOnboardingRecord } from "../../src/onboarding/types";

test.use({ localizationMode: "real" });

async function readyToFinish(page: Page, observeWorkspaceClose = false) {
  await onboardingFixture(page, {
    noIdeas: true,
    record: { ...newOnboardingRecord(), step: "method", fresh: true },
  });
  if (observeWorkspaceClose)
    await page.addInitScript(() => {
      const host = Reflect.get(window, "__TAURI_INTERNALS__");
      const callbacks = new Map<number, (event: unknown) => void>();
      const transform = host.transformCallback.bind(host);
      host.transformCallback = (callback: (event: unknown) => void) => {
        const id = transform(callback);
        callbacks.set(id, callback);
        return id;
      };
      const invoke = host.invoke.bind(host);
      let changed: number;
      host.invoke = async (command: string, args: Record<string, unknown>) => {
        if (
          command === "plugin:event|listen" &&
          args.event === "workspaces-changed"
        )
          changed = Number(args.handler);
        return invoke(command, args);
      };
      Reflect.set(window, "closeFinaleWorkspace", async () => {
        await invoke("workspace_action", { action: "close", id: "garden" });
        callbacks.get(changed)?.({ payload: null });
      });
    });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: t("onboarding.conversation.start"),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: t("onboardingAgent.choice.confirmFresh"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: t("onboardingAgent.choice.finish"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(finish(page)).toBeEnabled();
}
const finish = (page: Page) =>
  page.getByRole("button", {
    name: t("onboardingAgent.choice.finish"),
    exact: true,
  });
const skip = (page: Page) =>
  page.getByRole("button", { name: "Go to workspace", exact: true });

async function noOutgoingDom(page: Page) {
  await expect(
    page.locator(
      ".conversation-setup, .frame-header, .setup-steps, .setup-panel, .question-dock",
    ),
  ).toHaveCount(0);
}

test("final completion removes outgoing layers and reveals the prepared app only through the paper", async ({
  page,
}, info) => {
  const clockStart = Date.UTC(2025, 0, 1);
  await page.clock.install({ time: clockStart });
  await readyToFinish(page);
  await page.clock.pauseAt(clockStart + 60_000);
  await finish(page).click();
  await expect(skip(page)).toBeFocused();
  await expect
    .poll(async () =>
      page.evaluate(
        () => Reflect.get(window, "__onboardingFixture").progress().entered,
      ),
    )
    .toBe(true);
  // Allow async workspace preparation without advancing the animation clock.
  await expect(page.locator(".app-shell")).toHaveCount(1);
  await noOutgoingDom(page);
  await expect(page.locator(".app-shell")).toBeHidden();
  for (const elapsed of [400, 1000, 1750, 3000, 3800, 4400, 5000]) {
    const previous = [0, 400, 1000, 1750, 3000, 3800, 4400][
      [400, 1000, 1750, 3000, 3800, 4400, 5000].indexOf(elapsed)
    ]!;
    await page.clock.runFor(elapsed - previous);
    await noOutgoingDom(page);
    await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
    if (elapsed < 4420) await expect(page.locator(".app-shell")).toBeHidden();
    else await expect(page.locator(".app-shell")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`finale-${elapsed}.png`) });
  }
  await page.clock.runFor(1000);
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert");
  await expect(page.locator(".desktop-sidebar .conversations li")).toHaveCount(
    1,
  );
  await expect(
    page.locator(".desktop-sidebar .conversations li"),
  ).toContainText(t("onboardingAgent.title"));
  await expect(
    page.locator(".desktop-sidebar .workspace-menu, .open-navigation").first(),
  ).toBeFocused();
});

test("Skip during a pending handoff waits for the operation, without replay or duplicate completion", async ({
  page,
}) => {
  await readyToFinish(page);
  await page.evaluate(() => {
    const host = Reflect.get(window, "__TAURI_INTERNALS__");
    const original = host.invoke.bind(host);
    host.invoke = async (command: string, args: { action?: string }) => {
      if (command === "workspace_action" && args.action === "ai-setup-done")
        await new Promise<void>((resolve) => {
          Reflect.set(window, "releaseHandoff", resolve);
        });
      return original(command, args);
    };
  });
  await finish(page).click();
  await expect(skip(page)).toBeFocused();
  await noOutgoingDom(page);
  await skip(page).dblclick();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.locator(".setup-finale-overlay")).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "releaseHandoff")());
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls").filter(
          (call: { command: string; args: { action?: string } }) =>
            call.command === "workspace_action" &&
            call.args.action === "ai-setup-done",
        ).length,
    ),
  ).toBe(1);
});

test("Skip opens a responsive app while conversation preparation continues", async ({
  page,
}) => {
  await readyToFinish(page);
  await page.evaluate(() => {
    const host = Reflect.get(window, "__TAURI_INTERNALS__");
    const invoke = host.invoke.bind(host);
    const pending = new Promise<void>((resolve) => {
      Reflect.set(window, "releasePreparation", resolve);
    });
    host.invoke = async (command: string, args: Record<string, unknown>) => {
      if (command === "ai_status" && args.conversation) {
        Reflect.set(window, "preparationBlocked", true);
        await pending;
        const result = await invoke(command, args);
        Reflect.set(window, "preparationFinished", true);
        return result;
      }
      return invoke(command, args);
    };
  });
  await finish(page).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "preparationBlocked")))
    .toBe(true);
  await expect(skip(page)).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(1);
  await expect(page.locator(".app-shell")).toBeHidden();
  await noOutgoingDom(page);
  const completed = await page.evaluate(() =>
    Reflect.get(window, "__onboardingFixture").progress(),
  );
  expect(completed).toMatchObject({ step: "complete", entered: true });
  const conversationActions = () =>
    page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter(
        (call: { command: string }) =>
          call.command === "ai_conversation_action" ||
          call.command === "onboarding_action",
      ),
    );
  const actionsBeforeSkip = await conversationActions();
  await skip(page).click();
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert");
  await page
    .locator(".desktop-sidebar")
    .getByRole("button", { name: t("navigation.files"), exact: true })
    .click();
  await expect(page.locator(".browser-header")).toContainText(
    t("navigation.files"),
  );
  expect(await conversationActions()).toEqual(actionsBeforeSkip);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toEqual(completed);
  await page.evaluate(() => Reflect.get(window, "releasePreparation")());
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "preparationFinished")))
    .toBe(true);
  await expect(page.locator(".browser-header")).toContainText(
    t("navigation.files"),
  );
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  expect(await conversationActions()).toEqual(actionsBeforeSkip);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toEqual(completed);
  expect(
    await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls").filter(
          (call: { command: string; args: { action?: string } }) =>
            call.command === "workspace_action" &&
            call.args.action === "ai-setup-done",
        ).length,
    ),
  ).toBe(1);
});

test("Skip waits for a cold app shell mount before removing the finale", async ({
  page,
}) => {
  await readyToFinish(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/src/components/AppShell.vue", async (route) => {
    await pending;
    await route.continue();
  });
  await finish(page).click();
  await expect(skip(page)).toBeFocused();
  await skip(page).click();
  await expect(page.locator(".setup-finale-overlay")).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  release();
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(
    page.locator(".desktop-sidebar .workspace-menu, .open-navigation").first(),
  ).toBeFocused();
});

test("initial reduced motion opens the app directly and transfers focus", async ({
  page,
}) => {
  await readyToFinish(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await finish(page).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  await expect(
    page.locator(".desktop-sidebar .workspace-menu, .open-navigation").first(),
  ).toBeFocused();
});

for (const activation of ["pointer", "Enter"] as const) {
  test(`initial reduced motion transfers focus with a preloaded shell after ${activation} activation`, async ({
    page,
  }) => {
    await readyToFinish(page);
    await page.evaluate(async () => {
      const source = "/src/components/AppShell.vue";
      await import(source);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (activation === "pointer") await finish(page).click();
    else await finish(page).press("Enter");
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
    await expect(
      page
        .locator(".desktop-sidebar .workspace-menu, .open-navigation")
        .first(),
    ).toBeFocused();
  });
}

test("live reduced motion completes the presentation without changing the saved result", async ({
  page,
}) => {
  await readyToFinish(page);
  await finish(page).click();
  await expect(skip(page)).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toMatchObject({ step: "complete", entered: true });
});

test("closing the workspace interrupts playback without revealing or restarting its shell", async ({
  page,
}) => {
  await readyToFinish(page, true);
  await finish(page).click();
  await expect(skip(page)).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "closeFinaleWorkspace")());
  await expect(page.locator(".setup-finale-overlay, .app-shell")).toHaveCount(
    0,
  );
  await expect(page.locator(".workspace-entry")).toBeVisible();
});

test("reloading during the finale preserves completion and does not replay it", async ({
  page,
}) => {
  await readyToFinish(page);
  await finish(page).click();
  await expect(skip(page)).toBeVisible();
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".setup-finale-overlay")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toMatchObject({ step: "complete", entered: true });
});

for (const failingCommand of ["workspace_action", "workspace_snapshot"]) {
  test(`handoff failure in ${failingCommand} returns to setup without rolling back completion`, async ({
    page,
  }) => {
    await readyToFinish(page);
    await page.evaluate((failingCommand) => {
      const host = Reflect.get(window, "__TAURI_INTERNALS__");
      const invoke = host.invoke.bind(host);
      host.invoke = (command: string, args: Record<string, unknown>) => {
        if (command === failingCommand)
          return Promise.reject("onboarding.saveFailed");
        return invoke(command, args);
      };
    }, failingCommand);
    await finish(page).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.locator(".setup-finale-overlay, .app-shell")).toHaveCount(
      0,
    );
    await expect(page.locator(".conversation-setup")).toBeVisible();
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__onboardingFixture").progress(),
      ),
    ).toMatchObject({ step: "complete", entered: true });
  });
}

test("a rejected completion save never celebrates or marks completion", async ({
  page,
}) => {
  await readyToFinish(page);
  await page.evaluate(() => {
    const host = Reflect.get(window, "__TAURI_INTERNALS__");
    const invoke = host.invoke.bind(host);
    host.invoke = (command: string, args: Record<string, unknown>) => {
      if (command === "onboarding_action" && args.action === "finish")
        return Promise.reject("native.onboarding.storage.failed");
      return invoke(command, args);
    };
  });
  await finish(page).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.locator(".setup-finale-overlay, .app-shell")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toMatchObject({ step: "support", entered: false });
});

test("uncertain completion durability remains in setup and never celebrates or marks entry", async ({
  page,
}) => {
  await readyToFinish(page);
  await page.evaluate(() =>
    Reflect.get(window, "__onboardingFixture").failNextProgressSave(),
  );
  await finish(page).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.locator(".setup-finale-overlay, .app-shell")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    ),
  ).toMatchObject({ step: "complete", entered: false });
});
