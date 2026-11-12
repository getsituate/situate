import { expect, test, keyLabel } from "./test";
import { garden, reading, workspaceFixture } from "./workspace-fixture";
import type { Snapshot } from "../../src/workspaces/api";

const initial = (): Snapshot => ({
  ready: true,
  mobile: true,
  known: [garden, reading],
  open: [garden],
  current: null,
  failures: [],
  error: null,
});

for (const mobile of [false, true]) {
  test(`failed workspace opening keeps modal focus and can be retried (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    browserName,
  }) => {
    await workspaceFixture(page, { ...initial(), mobile, open: [] });
    if (mobile) await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.evaluate(() => {
      const host = Reflect.get(window, "__TAURI_INTERNALS__");
      const invoke = host.invoke.bind(host);
      let attempts = 0;
      host.invoke = (command: string, args: Record<string, unknown>) => {
        if (
          command === "workspace_action" &&
          args.action === "open" &&
          ++attempts <= 2
        ) {
          return Promise.reject("native.workspace.migration.cleanupFailed");
        }
        return invoke(command, args);
      };
    });
    const trigger = page.getByRole("button", {
      name: "Garden notes /Documents/Garden notes",
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: keyLabel("workspace.couldntOpenTheWorkspace"),
    });
    const close = dialog.getByRole("button", {
      name: keyLabel("workspace.close"),
      exact: true,
    });
    const retry = dialog.getByRole("button", {
      name: keyLabel("navigation.retry"),
    });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(dialog).toContainText(
      keyLabel("native.workspace.migration.cleanupFailed"),
    );
    await expect(page.locator(".entry-error")).toHaveCount(0);
    await page.keyboard.press(
      process.platform === "darwin" && browserName === "webkit"
        ? "Alt+Tab"
        : "Tab",
    );
    await expect(retry).toBeFocused();
    await trigger.evaluate((element) => element.focus());
    await expect(retry).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page
      .getByRole("button", { name: keyLabel("workspace.reviewError") })
      .click();
    await expect(dialog).toBeVisible();
    await retry.click();
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await retry.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".app-shell")).toBeVisible();
  });
}

test("removal has modal focus, preserves the open row and distinguishes close", async ({
  page,
  browserName,
}) => {
  await workspaceFixture(page, initial());
  await page.goto("/");
  const actions = page.getByRole("button", {
    name: keyLabel("workspace.actionsFor", { name: "Garden notes" }),
  });
  await actions.focus();
  await actions.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: keyLabel("workspace.closeWorkspace") }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: keyLabel("workspace.removeFromYourList"),
  });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: keyLabel("workspace.keepInList") }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(actions).toBeFocused();
  await actions.press("ArrowDown");
  await page.keyboard.press(
    process.platform === "darwin" && browserName === "webkit"
      ? "Alt+Tab"
      : "Tab",
  );
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reading room /Documents/Reading room" }),
  ).toBeFocused();
  await actions.click();
  await page
    .getByRole("menuitem", { name: keyLabel("workspace.removeFromList") })
    .click();
  await page
    .getByRole("button", {
      name: keyLabel("workspace.removeFromList"),
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("region", { name: keyLabel("workspace.openWorkspaces") })
      .getByText("Garden notes", { exact: true }),
  ).toBeVisible();
  await actions.click();
  await expect(
    page.getByRole("menuitem", { name: keyLabel("workspace.removeFromList") }),
  ).toHaveCount(0);
  await page
    .getByRole("menuitem", { name: keyLabel("workspace.closeWorkspace") })
    .click();
  await expect(
    page.getByRole("region", { name: keyLabel("workspace.openWorkspaces") }),
  ).toHaveCount(0);
});
test("mobile switching keeps sessions and Back does not close the workspace", async ({
  page,
}) => {
  await workspaceFixture(page, { ...initial(), current: garden });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page
    .getByRole("button", { name: keyLabel("navigation.openNavigation") })
    .click();
  await page
    .getByRole("button", {
      name: keyLabel("navigation.workspaceMenu"),
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: keyLabel("navigation.openWorkspace"),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Reading room /Documents/Reading room" })
    .click();
  await page
    .getByRole("button", { name: keyLabel("navigation.openNavigation") })
    .click();
  await page
    .getByRole("button", {
      name: keyLabel("navigation.workspaceMenu"),
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: keyLabel("navigation.openWorkspace"),
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("region", { name: keyLabel("workspace.openWorkspaces") })
      .locator(".workspace-row"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: keyLabel("workspace.back"), exact: true })
    .click();
  await expect(
    page.getByRole("tab", {
      name: keyLabel("layoutHost.newTab"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: keyLabel("layoutHost.chooseView"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".view-chooser")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter(
        (call: { command: string }) =>
          call.command === "ai_create_conversation",
      ),
    ),
  ).toEqual([]);
  await expect(
    page.getByRole("button", { name: keyLabel("navigation.openNavigation") }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: keyLabel("navigation.openNavigation") }),
  ).toBeFocused();
  await expect(
    page.getByRole("dialog", {
      name: keyLabel("navigation.workspaceNavigation"),
    }),
  ).toBeHidden();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter(
        (c: { args: { action?: string } }) => c.args.action === "close",
      ),
    ),
  ).toEqual([]);
});
test("removing a closed listing focuses its next neighbor", async ({
  page,
}) => {
  const third = {
    id: "third",
    name: "Sketchbook",
    display: "/Documents/Sketchbook",
  };
  await workspaceFixture(page, {
    ...initial(),
    open: [],
    known: [garden, reading, third],
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: keyLabel("workspace.actionsFor", { name: "Reading room" }),
    })
    .click();
  await page
    .getByRole("menuitem", { name: keyLabel("workspace.removeFromList") })
    .click();
  await page
    .getByRole("button", {
      name: keyLabel("workspace.removeFromList"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: keyLabel("workspace.actionsFor", { name: "Sketchbook" }),
    }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", {
      name: keyLabel("workspace.actionsFor", { name: "Reading room" }),
    }),
  ).toHaveCount(0);
});

test("empty welcome and disabled sync produce no actions", async ({ page }) => {
  await workspaceFixture(page, { ...initial(), known: [], open: [] });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: keyLabel("workspace.welcomeToSituate") }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: keyLabel("workspace.yourWorkspaces") }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: keyLabel("workspace.bringAWorkspaceFromSync"),
    })
    .evaluate((e) => (e as HTMLButtonElement).click());
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter(
        (c: { command: string }) => c.command === "workspace_action",
      ),
    ),
  ).toEqual([]);
});
