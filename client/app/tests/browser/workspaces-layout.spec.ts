import { expect, test } from "./test";
import { garden, reading, workspaceFixture } from "./workspace-fixture";
import type { Snapshot } from "../../src/workspaces/api";

test.use({ localizationMode: "real" });

const initial = (): Snapshot => ({
  ready: true,
  mobile: true,
  known: [garden, reading],
  open: [garden],
  current: null,
  failures: [],
  error: null,
});

for (const [scene, width] of [
  ["workspaces", 1280],
  ["workspaces", 390],
  ["create", 1280],
  ["create", 390],
  ["create", 320],
] as const) {
  test(
    `${width}px ${scene} keeps workspace controls within the content area`,
    {
      tag: width < 600 ? "@visual-mobile" : "@visual-desktop",
    },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(
        page,
        { ...initial(), mobile: width < 600, open: [] },
        {
          parent: {
            id: "example-parent",
            name: "Workspaces",
            display: "/Example/Workspaces",
          },
        },
      );
      await page.goto("/");
      if (scene === "create") {
        await page.getByRole("button", { name: "Create a workspace" }).click();
        await page
          .getByRole("textbox", { name: "Workspace name" })
          .fill("Garden journal");
        await expect(
          page.getByRole("button", { name: "Create workspace", exact: true }),
        ).toBeEnabled();
        await expect(
          page.getByLabel("Workspace folder", { exact: true }),
        ).toHaveAttribute("readonly", "");
        await expect(page.locator("#workspace-parent")).toHaveValue(
          "/Example/Workspaces/Garden journal",
        );
        await expect(page.locator("#parent-help")).toHaveCount(0);
        await expect(page.locator(".path-preview")).toHaveCount(0);
        const choices = await page
          .locator(".appearance-option")
          .evaluateAll((options) =>
            options.map((option) => option.getBoundingClientRect().top),
          );
        expect(new Set(choices).size).toBe(1);
        const colorRow = await page
          .locator(".appearance-options")
          .boundingBox();
        expect(colorRow!.height).toBeLessThanOrEqual(60);
        const cobalt = page.getByRole("radio", { name: "Cobalt", exact: true });
        await expect(cobalt).toHaveCSS("opacity", "0");
        await cobalt.check();
        await expect(cobalt).toBeChecked();
        await cobalt.focus();
        await page.keyboard.press("ArrowRight");
        await expect(
          page.getByRole("radio", { name: "Sky", exact: true }),
        ).toBeChecked();
        await expect(
          page.getByRole("radio", { name: "Sky", exact: true }),
        ).toBeFocused();
        await page
          .getByRole("radio", { name: "Violet Default", exact: true })
          .check();
        expect(
          await page.evaluate(
            () =>
              Reflect.get(window, "__ipcCalls").filter(
                (call: { command: string }) =>
                  call.command === "appearance_update",
              ).length,
          ),
        ).toBe(0);
        await page.getByRole("textbox", { name: "Workspace name" }).focus();
      } else {
        await expect(page.locator(".entry-action .action-icon")).toHaveText([
          "＋",
          "↗",
          "⇄",
        ]);
      }
      const selectors =
        scene === "workspaces"
          ? [
              ".workspace-window",
              ".entry-titlebar",
              ".workspace-lists",
              "#entry-title",
              ".primary-choice",
            ]
          : [
              ".workspace-window",
              ".entry-titlebar",
              ".creation",
              ".form-actions",
              "#create-title",
              "#workspace-parent",
              ".form-actions .entry-primary",
              ".form-actions button:first-child",
            ];
      for (const selector of selectors) {
        const element = page.locator(selector);
        await expect(element).toBeVisible();
        const box = await element.boundingBox();
        expect(box!.x, selector).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, selector).toBeLessThanOrEqual(width);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await visual.capture(
        scene === "create" ? "workspaces.create.ready" : "workspaces.list",
      );
      if (scene === "workspaces") {
        const sync = page.getByRole("button", {
          name: "Bring a workspace from sync",
        });
        const dialog = page.getByRole("dialog", {
          name: "Sync is unavailable.",
          exact: true,
        });
        const close = dialog.getByRole("button", {
          name: "Close",
          exact: true,
        });
        await expect(
          page.locator(".entry-titlebar-actions > span"),
        ).toHaveCount(0);
        await expect(page.locator(".sync-help")).toHaveCount(0);
        await sync.click();
        await expect(dialog).toBeVisible();
        await expect(close).toBeFocused();
        await visual.capture("workspaces.sync-unavailable");
        await page.keyboard.press("Tab");
        await expect(sync).not.toBeFocused();
        await expect(
          page.getByRole("button", { name: "Create a workspace" }),
        ).not.toBeFocused();
        await close.click();
        await expect(dialog).not.toBeVisible();
        await expect(sync).toBeFocused();
        for (const key of ["Enter", "Space"]) {
          await page.keyboard.press(key);
          await expect(dialog).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(sync).toBeFocused();
        }
        expect(
          await page.evaluate(
            () =>
              Reflect.get(window, "__ipcCalls").filter(
                (call: { command: string }) =>
                  call.command === "workspace_action",
              ).length,
          ),
        ).toBe(0);
      }
      if (scene === "create") {
        await page
          .getByRole("textbox", { name: "Workspace name" })
          .fill("Existing");
        await expect(
          page.getByText("This folder already exists.", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Create workspace", exact: true }),
        ).toBeDisabled();
        await expect(page.locator("#workspace-parent")).toHaveValue(
          "/Example/Workspaces/Existing",
        );
        await expect(page.locator("#workspace-parent")).toHaveAttribute(
          "aria-describedby",
          "folder-error",
        );
        const error = await page.locator("#folder-error").boundingBox();
        const colors = await page.locator(".appearance-colors").boundingBox();
        expect(error!.y + error!.height).toBeLessThanOrEqual(colors!.y);
        await visual.capture("workspaces.create.name-conflict");
      }
    },
  );
}

test.describe("sync information on touch devices", () => {
  test.use({ hasTouch: true });
  test("opens and dismisses the unavailable notice with taps", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await workspaceFixture(page, {
      ...initial(),
      known: [],
      open: [],
    });
    await page.goto("/");
    const sync = page.getByRole("button", {
      name: "Bring a workspace from sync",
    });
    const dialog = page.getByRole("dialog", { name: "Sync is unavailable." });
    await sync.tap();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(dialog).not.toBeVisible();
    await expect(sync).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "Welcome to Situate." }),
    ).toBeVisible();
  });
});

for (const width of [320, 375, 768, 1183, 1184, 1280, 1440]) {
  test(`entry and creation fit ${width}px, including enlarged text`, async ({
    page,
  }) => {
    const state = initial();
    state.known[1] = {
      ...reading,
      name: "A long workspace name ".repeat(5),
      display: "/Documents/" + "A-long-folder-name/".repeat(12),
    };
    await workspaceFixture(page, state);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Where would you like to begin?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Bring a workspace from sync" }),
    ).toBeEnabled();
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const fontSize of ["100%", "200%"]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, fontSize);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(
        0,
      );
    }
    await page.getByRole("button", { name: "Create a workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "Create a workspace" }),
    ).toBeFocused();
    await page
      .getByRole("textbox", { name: "Workspace name" })
      .fill("Existing");
    await expect(page.getByText("This folder already exists.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create workspace", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Workspace name" })
      .fill("New garden");
    await expect(page.locator("#workspace-parent")).toHaveValue(
      "/Documents/New garden",
    );
    await page.getByRole("textbox", { name: "Workspace name" }).press("Tab");
    await expect(
      page.getByRole("heading", { name: "Create a workspace" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Choose…" }).click();
    await expect(page.getByRole("button", { name: "Choose…" })).toBeFocused();
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Create workspace", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create a workspace" }),
    ).toBeFocused();
  });
}

test("workspace entry and creation remain usable at 200% CSS zoom", async ({
  page,
}) => {
  await workspaceFixture(page, { ...initial(), mobile: false, open: [] });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Create a workspace" }).click();
  await page
    .getByRole("textbox", { name: "Workspace name" })
    .fill("Garden journal");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

for (const width of [320, 390, 800]) {
  test(`creation keeps actions outside the scroll region at ${width}px in a short window`, async ({
    page,
  }) => {
    await workspaceFixture(page, { ...initial(), mobile: width < 600 });
    await page.setViewportSize({ width, height: 360 });
    await page.goto("/");
    await page.getByRole("button", { name: "Create a workspace" }).click();
    const actions = page.locator(".form-actions");
    const bounds = await actions.boundingBox();
    expect(bounds!.y + bounds!.height).toBe(360);
    await expect(page.locator(".entry-titlebar")).toHaveCSS(
      "height",
      width < 600 ? "58px" : "64px",
    );
    await expect(
      page.getByRole("heading", { name: "Create a workspace" }),
    ).toBeFocused();
    const name = page.getByRole("textbox", { name: "Workspace name" });
    await name.fill("Existing");
    await expect(page.locator("#folder-error")).toBeVisible();
    await page.locator("#folder-error").scrollIntoViewIfNeeded();
    await expect(page.locator("#folder-error")).toBeInViewport();
    await expect(name).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "Create workspace", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await name.scrollIntoViewIfNeeded();
    await expect(name).toBeInViewport({ ratio: 1 });
    expect(await actions.boundingBox()).toEqual(bounds);
    await name.fill("Draft remains");
    await page.getByRole("button", { name: "Choose…" }).click();
    await expect(name).toHaveValue("Draft remains");
    await expect(page.getByRole("button", { name: "Choose…" })).toBeFocused();
    expect(await actions.boundingBox()).toEqual(bounds);
  });
}

for (const bottomInset of [0, 28]) {
  test(`keyboard resize and pan preserve draft, focus and actions with a ${bottomInset}px bottom inset`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: 800,
        offsetTop: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: viewport,
      });
    });
    await workspaceFixture(page, initial());
    await page.goto("/");
    await page.getByRole("button", { name: "Create a workspace" }).click();
    await page.addStyleTag({
      content: `:root { --app-safe-area-bottom: ${bottomInset}px; }`,
    });
    const field = page.getByRole("textbox", { name: "Workspace name" });
    await field.fill("Keyboard draft");
    await expect(page.locator(".workspace-entry")).toHaveCSS(
      "padding-bottom",
      `${bottomInset}px`,
    );
    const closedActions = await page.locator(".form-actions").boundingBox();
    expect(closedActions!.y + closedActions!.height).toBe(800 - bottomInset);
    for (const [height, offsetTop] of [
      [430, 0],
      [400, 24],
      [800, 0],
    ]) {
      await page.evaluate(
        ([height, offsetTop]) => {
          Object.assign(window.visualViewport!, { height, offsetTop });
          window.visualViewport!.dispatchEvent(new Event("resize"));
          window.visualViewport!.dispatchEvent(new Event("scroll"));
        },
        [height, offsetTop],
      );
      const actions = await page.locator(".form-actions").boundingBox();
      const inset = height === 800 ? bottomInset : 0;
      expect(actions!.y + actions!.height).toBe(height! + offsetTop! - inset);
      await expect(page.locator(".workspace-entry")).toHaveCSS(
        "padding-bottom",
        `${inset}px`,
      );
      expect(
        await page
          .locator(".entry-titlebar")
          .evaluate((e) => e.getBoundingClientRect().top),
      ).toBe(offsetTop);
      await expect(field).toHaveValue("Keyboard draft");
      await expect(field).toBeFocused();
      await field.scrollIntoViewIfNeeded();
      await expect(field).toBeInViewport({ ratio: 1 });
    }
    await page.evaluate(() => {
      Object.assign(window.visualViewport!, {
        height: 400,
        offsetTop: 0,
        scale: 2,
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    expect(
      await page
        .locator("#app")
        .evaluate((e) => e.getBoundingClientRect().height),
    ).toBe(800);
    await expect(page.locator(".workspace-entry")).toHaveCSS(
      "padding-bottom",
      `${bottomInset}px`,
    );
    await field.press("Tab");
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__ipcCalls").filter(
          (c: { args: { action?: string } }) => c.args.action === "create",
        ),
      ),
    ).toEqual([]);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("region", { name: "Open workspaces" })
      .getByRole("button", { name: /^Garden notes / })
      .click();
    const message = page.getByRole("textbox", { name: "Message", exact: true });
    await message.focus();
    for (const height of [430, 800]) {
      await page.evaluate((height) => {
        Object.assign(window.visualViewport!, {
          height,
          offsetTop: 0,
          scale: 1,
        });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      }, height);
      const inset = height === 800 ? bottomInset : 0;
      await expect(page.locator(".app-shell")).toHaveCSS(
        "padding-bottom",
        `${inset}px`,
      );
      await expect(page.locator(".navigation-drawer .app-sidebar")).toHaveCSS(
        "padding-bottom",
        `${Math.max(12, inset)}px`,
      );
      await expect(message).toBeFocused();
    }
  });
}

test("startup failure scrolls to Retry in a short window", async ({ page }) => {
  const error = JSON.stringify({
    key: "native.workspace.create.partial",
    params: {
      path: "/Documents/" + "A long workspace folder/".repeat(120),
      error: "native.workspace.folder.exists",
    },
  });
  await workspaceFixture(page, { ...initial(), ready: false, error });
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto("/");
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await retry.scrollIntoViewIfNeeded();
  await expect(retry).toBeInViewport({ ratio: 1 });
  expect(
    await page.locator(".startup").evaluate((e) => e.scrollTop),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const [mobile, width] of [
  [false, 1280],
  [false, 390],
  [true, 390],
] as const) {
  test(
    `workspace menu switches open sessions (${mobile ? "mobile" : "desktop"}, ${width}px)`,
    {
      tag: mobile ? "@visual-mobile" : width === 1280 ? "@visual-desktop" : [],
    },
    async ({ page, visual }) => {
      const closed = {
        id: "closed",
        name: "Closed notebook",
        display: "/Documents/Closed notebook",
      };
      await workspaceFixture(page, {
        ...initial(),
        mobile,
        known: [garden, closed],
        open: [garden, reading],
        current: garden,
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      if (width < 1184)
        await page.getByRole("button", { name: "Open navigation" }).click();
      if (mobile) {
        await expect(
          page.getByRole("dialog", { name: "Workspace navigation" }),
        ).toBeVisible();
        await visual.capture("navigation.drawer.open");
      }
      const trigger = page.getByRole("button", {
        name: "Workspace menu",
        exact: true,
      });
      await trigger.click();
      const menu = page.getByRole("menu", {
        name: "Workspace",
        exact: true,
      });
      const current = menu.getByRole("menuitem", {
        name: `Garden notes ${mobile ? "Current workspace" : "This window"}`,
      });
      const other = menu.getByRole("menuitem", {
        name: `Reading room ${mobile ? "Open workspace" : "Another window"}`,
      });
      await expect(current).toHaveAttribute("aria-current", "true");
      await expect(other).toBeVisible();
      await expect(menu.getByText("Closed notebook")).toHaveCount(0);
      await expect(
        menu.getByRole("menuitem", {
          name: "Open workspace…",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(
        menu.getByRole("menuitem", {
          name: "Close workspace",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      await expect(current).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(other).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await visual.capture("workspaces.switcher.open");
      await page.keyboard.press("Enter");
      await expect(menu).toHaveCount(0);
      await expect(page.locator(".workspace-entry")).toHaveCount(0);
      if (width < 1184)
        await expect(
          page.getByRole("dialog", {
            name: "Workspace navigation",
          }),
        ).toBeHidden();
      expect(
        await page.evaluate(() =>
          Reflect.get(window, "__ipcCalls").filter(
            (c: { command: string }) => c.command === "workspace_action",
          ),
        ),
      ).toEqual([
        {
          command: "workspace_action",
          args: { action: "open", id: "reading", name: null },
        },
      ]);
      if (mobile) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        await trigger.click();
        await expect(
          menu.getByRole("menuitem", {
            name: `Reading room ${"Current workspace"}`,
          }),
        ).toHaveAttribute("aria-current", "true");
        await expect(
          menu.getByRole("menuitem", {
            name: `Garden notes ${"Open workspace"}`,
          }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await expect(
          page.getByRole("dialog", {
            name: "Workspace navigation",
          }),
        ).toBeVisible();
      }
    },
  );
}
