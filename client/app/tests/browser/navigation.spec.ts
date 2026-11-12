import { expect, test, keyLabel } from "./test";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
  type NativeConversationFixture,
} from "./workspace-fixture";

function withoutDiagnostics<T extends { command: string }>(calls: T[]): T[] {
  return calls.filter(
    (call) =>
      ![
        "diagnostics_register",
        "diagnostics_emit",
        "diagnostics_release",
      ].includes(call.command),
  );
}

test.beforeEach(async ({ page }) => workspaceFixture(page, shellState));

test("desktop navigation collapses and restores without changing the workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    }),
  ).toBeEditable();
  await expect
    .poll(async () =>
      page.evaluate(
        async () => (await window.__layoutTest.stored("garden")).revision,
      ),
    )
    .not.toBeNull();
  const calls = withoutDiagnostics(
    await page.evaluate(() => Reflect.get(window, "__ipcCalls")),
  );
  await page
    .getByRole("button", {
      name: keyLabel("navigation.collapseSidebar"),
      exact: true,
    })
    .click();
  await expect(page.locator(".desktop-sidebar")).toHaveCount(0);
  const open = page.getByRole("button", {
    name: keyLabel("navigation.openNavigation"),
    exact: true,
  });
  await expect(open).toBeVisible();
  await expect(open).toBeFocused();
  await open.click();
  await expect(page.locator(".desktop-sidebar")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: keyLabel("navigation.collapseSidebar"),
      exact: true,
    }),
  ).toBeFocused();
  await expect(open).toBeHidden();
  expect(
    withoutDiagnostics(
      await page.evaluate(() => Reflect.get(window, "__ipcCalls")),
    ),
  ).toEqual(calls);
});

test("desktop sidebar resizes, resets and retains its width across navigation modes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.locator(".desktop-sidebar");
  const handle = page.getByRole("separator", {
    name: keyLabel("navigation.resizeSidebar"),
    exact: true,
  });
  await expect(sidebar).toHaveCSS("width", "300px");
  await expect(handle).toHaveAttribute(
    "aria-controls",
    (await sidebar.getAttribute("id")) as string,
  );
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 100,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", "400px");
  await handle.press("End");
  await expect(handle).toBeFocused();
  await expect(handle).toHaveCSS("outline-style", "none");
  await expect(sidebar).toHaveCSS("width", "480px");
  await handle.press("ArrowRight");
  await expect(sidebar).toHaveCSS("width", "480px");
  await handle.press("Home");
  await expect(sidebar).toHaveCSS("width", "224px");
  await handle.press("ArrowLeft");
  await expect(sidebar).toHaveCSS("width", "224px");
  await handle.press("Enter");
  await expect(sidebar).toHaveCSS("width", "300px");
  await handle.press("Shift+ArrowRight");
  await expect(sidebar).toHaveCSS("width", "332px");

  await page
    .getByRole("button", {
      name: keyLabel("navigation.collapseSidebar"),
      exact: true,
    })
    .click();
  await expect(handle).toHaveCount(0);
  await page
    .getByRole("button", {
      name: keyLabel("navigation.openNavigation"),
      exact: true,
    })
    .click();
  await expect(sidebar).toHaveCSS("width", "332px");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(handle).toHaveCount(0);
  await page.setViewportSize({ width: 1184, height: 900 });
  await expect(sidebar).toHaveCSS("width", "332px");
  await handle.dblclick();
  await expect(sidebar).toHaveCSS("width", "300px");
});

test("chat drafts survive visiting Files without admitting an AI request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const draft = page.getByRole("textbox", {
    name: keyLabel("navigation.message"),
    exact: true,
  });
  await draft.fill("An unsent question about the garden");
  await page
    .getByRole("button", { name: keyLabel("navigation.files"), exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: keyLabel("navigation.files"),
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: keyLabel("layoutUi.back"), exact: true })
    .click();
  await expect(draft).toHaveValue("An unsent question about the garden");
  const calls = await page.evaluate(
    () => Reflect.get(window, "__ipcCalls") as { command: string }[],
  );
  expect(
    calls.some((call) => ["ai_begin", "ai_request"].includes(call.command)),
  ).toBe(false);
});

test("drawer traps keyboard focus, closes with Escape and restores focus", async ({
  page,
  browserName,
}) => {
  const tab =
    process.platform === "darwin" && browserName === "webkit"
      ? "Alt+Tab"
      : "Tab";
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const open = page.getByRole("button", {
    name: keyLabel("navigation.openNavigation"),
  });
  await expect(open).toBeVisible();
  await page.keyboard.press(tab);
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  const close = page.getByRole("button", {
    name: keyLabel("navigation.closeNavigation"),
  });
  await expect(close).toBeFocused();
  const dialog = page.getByRole("dialog", {
    name: keyLabel("navigation.workspaceNavigation"),
  });
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
    true,
  );
  for (const key of [
    tab,
    tab,
    tab,
    "Shift+" + tab,
    "Shift+" + tab,
    "Shift+" + tab,
  ]) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(() => {
        // Native dialog traversal may visit browser chrome, but never background content.
        return (
          !document.hasFocus() || !!document.activeElement?.closest("dialog")
        );
      }),
    ).toBe(true);
  }
  await page
    .getByRole("textbox", { name: keyLabel("navigation.message"), exact: true })
    .evaluate((element) => (element as HTMLElement).focus());
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await close.focus();
  const tooltip = page.getByRole("tooltip", {
    name: keyLabel("navigation.closeNavigation"),
  });
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute("aria-expanded", "false");
});

test("backdrop dismisses navigation and resizing releases modality", async ({
  page,
}) => {
  let releaseLayout!: () => void;
  const layoutReady = new Promise<void>((resolve) => {
    releaseLayout = resolve;
  });
  await page.route(
    "**/layout/components/WorkspaceLayout.vue*",
    async (route) => {
      await layoutReady;
      await route.continue();
    },
  );
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  const open = page.getByRole("button", {
    name: keyLabel("navigation.openNavigation"),
  });
  await open.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await page.mouse.click(700, 100);
  await expect(page.getByRole("dialog")).toBeHidden();
  const placeholder = page.locator(".layout-recovery-header .open-navigation");
  await expect(placeholder).toBeFocused();
  releaseLayout();
  await expect(page.locator(".topic-window")).toBeVisible();
  await expect(placeholder).toHaveCount(0);
  await expect(open).toBeFocused();

  await open.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("tab", {
      name: keyLabel("navigation.newChat"),
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page
    .getByRole("textbox", { name: keyLabel("navigation.message"), exact: true })
    .focus();
  await expect(
    page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    }),
  ).toBeFocused();

  await page.setViewportSize({ width: 375, height: 812 });
  await open.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: keyLabel("navigation.closeNavigation") }),
  ).toBeFocused();
});

for (const loading of [false, true]) {
  test(`rapid drawer reopen keeps the trigger expanded (layout loading: ${loading})`, async ({
    page,
  }) => {
    let releaseLayout!: () => void;
    if (loading) {
      const ready = new Promise<void>((resolve) => {
        releaseLayout = resolve;
      });
      await page.route(
        "**/layout/components/WorkspaceLayout.vue*",
        async (route) => {
          await ready;
          await route.continue();
        },
      );
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const open = page.getByRole("button", {
      name: keyLabel("navigation.openNavigation"),
    });
    await open.click();
    await page.evaluate(
      ({ close, open }) => {
        document
          .querySelector<HTMLButtonElement>(`button[aria-label="${close}"]`)!
          .click();
        document
          .querySelector<HTMLButtonElement>(`button[aria-label="${open}"]`)!
          .click();
      },
      {
        close: keyLabel("navigation.closeNavigation"),
        open: keyLabel("navigation.openNavigation"),
      },
    );
    const dialog = page.getByRole("dialog", {
      name: keyLabel("navigation.workspaceNavigation"),
    });
    await expect(dialog).toBeVisible();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(dialog).toBeHidden();
    if (loading) releaseLayout();
    await expect(
      page.getByRole("tab", {
        name: keyLabel("navigation.newChat"),
        exact: true,
      }),
    ).toBeFocused();
  });
}

test("unavailable controls and blocked sending preserve the draft and leave unrelated storage untouched", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem("existing-content", "Keep this");
    sessionStorage.setItem("existing-draft", "Keep this too");
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (["fetch", "xhr"].includes(request.resourceType()))
      requests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const message = page.getByRole("textbox", {
    name: keyLabel("navigation.message"),
    exact: true,
  });
  await expect(message).toBeVisible();
  await message.focus();
  await page.keyboard.type("Do not send");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", {
      name: keyLabel("navigation.newChat"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: new RegExp(
        `^(?:${keyLabel("ai.aiAccess")}|${keyLabel("ai.connectAIAccess")})$`,
        "u",
      ),
    }),
  ).toHaveCount(0);
  await expect(message).toHaveValue("Do not send");
  const beforeDisabledClicks = withoutDiagnostics(
    await page.evaluate(() => Reflect.get(window, "__ipcCalls")),
  ).filter(
    (call) =>
      ![
        "ai_conversation_read",
        "ai_conversation_subscribe",
        "ai_conversation_ack",
        "ai_conversation_action",
        "layout_save",
        "plugin_runtime",
        "plugin_executor",
      ].includes(call.command),
  ).length;
  for (const button of await page.locator("button:disabled").all()) {
    await button.evaluate((element) => (element as HTMLButtonElement).click());
  }
  await page.clock.runFor(2000);
  const calls = withoutDiagnostics(
    await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: Record<string, unknown>;
        }[],
    ),
  );
  expect(
    calls.filter(
      (call) =>
        ![
          "ai_conversation_read",
          "ai_conversation_subscribe",
          "ai_conversation_ack",
          "ai_conversation_action",
          "layout_save",
          "plugin_runtime",
          "plugin_executor",
        ].includes(call.command),
    ),
  ).toHaveLength(beforeDisabledClicks);
  expect(
    calls.filter(
      (call) =>
        ![
          "plugin:event|listen",
          "workspace_snapshot",
          "layout_load",
          "layout_save",
          "localization_snapshot",
          "appearance_snapshot",
          "dictation_snapshot",
          "updates_snapshot",
          "plugin:app|version",
          "recovery_register",
          "plugin_recovery_mode",
          "plugin_runtime",
          "plugin_executor",
          "ai_status",
          "ai_settings_load",
          "ai_conversations",
          "ai_conversation_read",
          "ai_conversation_subscribe",
          "ai_conversation_ack",
          "ai_conversation_action",
        ].includes(call.command),
    ),
  ).toEqual([]);
  for (const call of calls.filter((call) => call.command === "plugin_executor"))
    expect(call).toEqual({
      command: "plugin_executor",
      args: {
        scope: "garden",
        request: {
          operation: "pendingPersistences",
        },
      },
    });
  const mutations = calls.filter(
    (call) => call.command === "ai_conversation_action",
  );
  expect(mutations.length).toBeGreaterThan(0);
  for (const call of mutations)
    expect(call.args.action).toMatchObject({
      version: 1,
      type: "draft",
      input: { text: "Do not send", attachments: [], references: [] },
    });
  expect(await nativeRequests(page)).toEqual([]);
  const record = await page.evaluate(() =>
    (
      Reflect.get(
        window,
        "__nativeConversationFixture",
      ) as NativeConversationFixture
    ).getRecord("garden", "legacy"),
  );
  expect(record.messages).toEqual([]);
  expect(record.draft).toBe("Do not send");
  const pluginCalls = calls.filter((call) => call.command === "plugin_runtime");
  expect(pluginCalls.length).toBeGreaterThan(1);
  for (const call of pluginCalls)
    expect(call).toEqual({
      command: "plugin_runtime",
      args: { scope: "garden", request: { operation: "list" } },
    });
  const layouts = calls
    .filter((call) => call.command === "layout_save")
    .map(
      (call) =>
        call.args.data as {
          layout: {
            tabs: {
              panes: { navigation: { entries: { target: unknown }[] } }[];
            }[];
            closedTabs: unknown[];
          };
        },
    );
  for (const { layout } of layouts) {
    expect(layout.tabs).toHaveLength(1);
    expect(layout.tabs[0]!.panes).toHaveLength(1);
    expect(
      layout.tabs[0]!.panes[0]!.navigation.entries.map((entry) => entry.target),
    ).toEqual([{ kind: "conversation", conversationId: "legacy" }]);
    expect(layout.closedTabs).toEqual([]);
  }
  expect(requests).toEqual([]);
  await expect(page).toHaveURL("/");
  expect(
    await page.evaluate(() => ({
      local: { ...localStorage },
      session: Object.fromEntries(
        Object.entries(sessionStorage).filter(
          ([key]) => key !== "native-conversation-fixture-v2",
        ),
      ),
    })),
  ).toEqual({
    local: { "existing-content": "Keep this" },
    session: { "existing-draft": "Keep this too" },
  });
  await expect(page.getByRole("tree")).toHaveCount(0);
  await expect(page.getByText("Save text", { exact: true })).toHaveCount(0);
});
