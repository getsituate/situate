import { chooseSelect } from "./select";
import { expect, test, type Locator, type Page } from "./test";
import {
  emptyLayout,
  reduceLayout,
  type LayoutState,
} from "../../src/layout/model";
import { filesFixture } from "./files-fixture";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
} from "./workspace-fixture";

test.use({ localizationMode: "real" });

type Document = { version: 1; layout: LayoutState; pinnedViews: string[] };
async function stored(page: Page): Promise<Document | null> {
  return page.evaluate(
    async () =>
      (await window.__layoutTest.stored("garden")).data as Document | null,
  );
}
async function navigation(page: Page) {
  const sidebar = page.getByRole("navigation", {
    name: "Workspace navigation",
    exact: true,
  });
  const open = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await expect
    .poll(async () => (await sidebar.isVisible()) || (await open.isVisible()))
    .toBe(true);
  if (!(await sidebar.isVisible())) await open.click();
  return sidebar;
}
async function newTab(page: Page) {
  const create = page
    .locator(".tab-header")
    .getByRole("button", { name: "New tab", exact: true });
  if (await create.isVisible()) await create.click();
  else {
    await page.locator(".tab-header .tab-actions-trigger").click();
    await page.getByRole("menuitem", { name: "New tab", exact: true }).click();
  }
}
async function paneOptions(page: Page) {
  const trigger = page.locator(
    ".surface-pane-options, .mobile-pane-header > button, .maximized-pane-toolbar > .situate-icon-button",
  );
  if (await trigger.isVisible()) await trigger.click();
  else if (await page.locator(".pane-tile.active .pane-title").isVisible())
    await page.locator(".pane-tile.active .pane-title").click();
  else {
    await page.locator(".tab-header .tab-actions-trigger").click();
    await page
      .getByRole("menuitem", { name: "Pane layout", exact: true })
      .click();
  }
  return page.getByRole("dialog", { name: "Pane layout", exact: true });
}
test("new chat views leave no conversation or persisted draft before sending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await expect(page.locator(".topic-window")).toBeVisible();
  for (let index = 0; index < 3; index++) {
    await (
      await navigation(page)
    )
      .getByLabel("New chat", { exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(`Unsent thought ${index}`);
  }
  await (
    await navigation(page)
  )
    .getByRole("button", { name: "Files", exact: true })
    .click();
  await expect(page.locator(".chat-pane")).toHaveCount(0);
  await expect
    .poll(async () => JSON.stringify(await stored(page)))
    .not.toContain("new-conversation");
  const calls = await page.evaluate(
    () =>
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: { record?: { draft?: string } };
      }[],
  );
  expect(
    calls.filter((call) => call.command === "ai_create_conversation"),
  ).toEqual([]);
  expect(
    calls.filter(
      (call) =>
        call.command === "ai_conversation_read" &&
        call.args.record?.draft?.startsWith("Unsent thought"),
    ),
  ).toEqual([]);
  expect(JSON.stringify(await stored(page))).not.toContain("Unsent thought");
  await page
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(page.locator(".view-chooser")).toBeVisible();
});

test("the first send lists the conversation before its response and keeps the current view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 });
  await workspaceFixture(page, shellState, {
    aiConnection: { provider: "openai", endpoint: null },
    aiModel: "gpt-4o-mini",
    aiHoldResponse: true,
  });
  await page.goto("/");
  await (
    await navigation(page)
  )
    .getByLabel("New chat", { exact: true })
    .click();
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Remember the first message");
  await expect(page.locator(".conversation-row")).not.toContainText(
    "Remember the first message",
  );
  await message.press("Enter");
  await expect(
    page
      .locator(".conversation-row")
      .filter({ hasText: "Remember the first message" }),
  ).toHaveCount(1);
  await expect(page.locator(".chat-pane")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const document = await stored(page);
      return document?.layout.tabs.flatMap((tab) =>
        tab.panes.flatMap((pane) =>
          pane.navigation.entries.map((entry) => entry.target.kind),
        ),
      );
    })
    .toContain("conversation");
  const creates = await page.evaluate(() =>
    (
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: { initial?: { draft: string } };
      }[]
    ).filter((call) => call.command === "ai_create_conversation"),
  );
  expect(creates).toHaveLength(1);
  expect(creates[0]!.args.initial?.draft).toBe("Remember the first message");
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .click();
});

async function expectCenteredCloseIcon(close: Locator) {
  const offset = await close.evaluate((button) => {
    const target = button.getBoundingClientRect();
    const icon = button.querySelector("svg")!.getBoundingClientRect();
    return {
      x: icon.x + icon.width / 2 - (target.x + target.width / 2),
      y: icon.y + icon.height / 2 - (target.y + target.height / 2),
    };
  });
  expect(offset.x).toBeCloseTo(0, 2);
  expect(offset.y).toBeCloseTo(0, 2);
}

async function compactPaneHeader(page: Page) {
  await expect(async () => {
    const geometry = await page
      .locator(".maximized-pane-header")
      .evaluate((header) => ({
        header: header.getBoundingClientRect().toJSON(),
        controls: [
          ...header.querySelectorAll(".maximized-pane-toolbar button"),
        ].map((button) => button.getBoundingClientRect().toJSON()),
      }));
    expect(geometry.header.height).toBeGreaterThanOrEqual(52);
    expect(geometry.header.height).toBeLessThanOrEqual(56);
    expect(geometry.controls).toHaveLength(5);
    for (const control of geometry.controls) {
      expect(control.width).toBeGreaterThanOrEqual(44);
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.y + control.height / 2).toBeCloseTo(
        geometry.header.y + (geometry.header.height - 1) / 2,
        0,
      );
      expect(control.x).toBeGreaterThanOrEqual(geometry.header.x);
      expect(control.x + control.width).toBeLessThanOrEqual(
        geometry.header.x + geometry.header.width,
      );
    }
  }).toPass({ timeout: 5000 });
}

for (const viewport of [
  { width: 1440, height: 920, touch: false },
  { width: 1180, height: 820, touch: true },
  { width: 820, height: 1180, touch: true },
  { width: 390, height: 844, touch: true },
]) {
  test.describe(`pane controls at ${viewport.width}px`, () => {
    test.use({ hasTouch: viewport.touch });
    test(
      "compact maximization and standard move controls preserve pane state",
      {
        tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop",
      },
      async ({ page, visual }) => {
        await page.setViewportSize({ width: 1440, height: 920 });
        await workspaceFixture(page, shellState);
        await page.goto("/");
        const draft = "Keep this draft while moving between panes";
        await page
          .getByRole("textbox", { name: "Message", exact: true })
          .fill(draft);
        await (
          await paneOptions(page)
        )
          .getByRole("button", { name: "Add pane to the right", exact: true })
          .click();
        await page
          .locator(".pane-tile")
          .last()
          .getByRole("button", { name: "Files", exact: true })
          .click();
        const ids = await page
          .locator(".pane-tile")
          .evaluateAll((panes) =>
            panes.map((pane) => pane.getAttribute("data-pane")!),
          );
        await expect
          .poll(async () => (await stored(page))?.layout.tabs[0]?.panes.length)
          .toBe(2);
        await expect(page.locator(".topic-panel > footer")).toHaveCount(0);
        await expect(page.locator(".layout-scroll")).toHaveCSS(
          "padding-bottom",
          "12px",
        );
        const panel = await page.locator(".topic-panel").boundingBox();
        const canvas = await page.locator(".layout-canvas").boundingBox();
        expect(
          panel!.y + panel!.height - canvas!.y - canvas!.height,
        ).toBeCloseTo(12, 0);
        if (viewport.width === 1440) {
          const activePane = page.locator(".pane-tile.active");
          await expect(activePane).toBeVisible();
          await expect(activePane).toHaveCSS("box-shadow", "none");
          expect(
            await activePane.evaluate((pane) => {
              const ring = getComputedStyle(pane, "::after");
              return {
                inset: ring.inset,
                pointerEvents: ring.pointerEvents,
                border: ring.borderTopWidth,
              };
            }),
          ).toEqual({ inset: "0px", pointerEvents: "none", border: "1px" });
          await visual.capture("layout.panes.active-contour");
        }
        const arrangement = (await stored(page))!.layout.tabs[0]!.layout;
        await page
          .getByRole("textbox", { name: "Message", exact: true })
          .focus();
        const maximize = (await paneOptions(page)).getByRole("button", {
          name: "Maximize pane",
          exact: true,
        });
        const maximizeIcon = await maximize.locator("path").getAttribute("d");
        await maximize.click();
        await page.setViewportSize(viewport);
        if (viewport.width < 660)
          await expect(page.locator(".topic-window")).toHaveClass(
            /narrow-tabs/,
          );
        const header = page.locator(".maximized-pane-header");
        await expect(header).toBeVisible();
        const restore = header.getByRole("button", {
          name: "Restore arrangement",
          exact: true,
        });
        await expect(restore).toHaveText("");
        await expect(restore).toHaveAttribute(
          "aria-description",
          "Restore arrangement",
        );
        const restoreIcon = await restore.locator("path").getAttribute("d");
        expect(restoreIcon).toBeTruthy();
        expect(restoreIcon).not.toBe(maximizeIcon);
        await expect(page.locator(".pane-tile")).toHaveCount(1);
        await expect(page.locator(".pane-toolbar, .layout-footer")).toHaveCount(
          0,
        );
        await compactPaneHeader(page);
        if (viewport.touch && viewport.width >= 660) {
          const close = page.locator(".topic-tab.selected .tab-close");
          await expect(close).toHaveCSS("width", "44px");
          await expect(close).toHaveCSS("height", "44px");
          await expectCenteredCloseIcon(close);
        }
        if (viewport.touch)
          expect(
            await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
          ).toBe(true);
        await expect(
          page.getByRole("textbox", { name: "Message", exact: true }),
        ).toHaveValue(draft);
        await visual.capture("layout.panes.maximized");
        const switcher = header.locator(".switch-pane");
        await switcher.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", {
          name: "Switch pane",
          exact: true,
        });
        await expect(dialog.locator('[aria-current="true"]')).toBeFocused();
        await visual.capture("layout.panes.switch-list");
        await page.keyboard.press("Shift+Tab");
        await expect(
          dialog.getByRole("button", { name: "Close", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(
          dialog.locator(".maximized-pane-list button").last(),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(
          dialog.getByRole("button", { name: "Close", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(switcher).toBeFocused();
        await switcher.click();
        await dialog.locator(".maximized-pane-list button").last().click();
        await expect(page.locator(".pane-tile")).toHaveAttribute(
          "data-pane",
          ids[1]!,
        );
        await expect(switcher).toHaveAccessibleName("Switch pane: Files");
        await expect(switcher).toBeFocused();
        await expect
          .poll(
            async () => (await stored(page))?.layout.tabs[0]?.maximizedPaneId,
          )
          .toBe(ids[1]);
        await switcher.click();
        await dialog.locator(".maximized-pane-list button").first().click();
        await expect(
          page.getByRole("textbox", { name: "Message", exact: true }),
        ).toHaveValue(draft);
        await (
          await navigation(page)
        )
          .getByRole("button", { name: "Files", exact: true })
          .click();
        await expect(switcher).toHaveAccessibleName("Switch pane: Files");
        await header
          .getByRole("button", { name: "Back in this pane", exact: true })
          .click();
        await expect(
          page.getByRole("textbox", { name: "Message", exact: true }),
        ).toHaveValue(draft);
        await expect(switcher).toBeFocused();
        await header
          .getByRole("button", { name: "Forward in this pane", exact: true })
          .click();
        await expect(switcher).toHaveAccessibleName("Switch pane: Files");
        await header
          .getByRole("button", { name: "Back in this pane", exact: true })
          .click();
        if (viewport.width >= 660) {
          const options = await paneOptions(page);
          const menuRestore = options.getByRole("button", {
            name: "Restore arrangement",
            exact: true,
          });
          await expect(menuRestore).toBeVisible();
          await expect(menuRestore).toHaveText("Restore arrangement");
          await expect(menuRestore.locator("path")).toHaveAttribute(
            "d",
            restoreIcon!,
          );
          const split = options.getByRole("button", {
            name: "Add pane to the right",
            exact: true,
          });
          expect(await split.locator("path").getAttribute("d")).not.toBe(
            restoreIcon,
          );
          await visual.capture("layout.panes.restore-menu");
          await page.keyboard.press("Escape");
        }
        await restore.click();
        await expect(header).toHaveCount(0);
        await expect
          .poll(async () => (await stored(page))?.layout.tabs[0]?.layout)
          .toEqual(arrangement);
        await expect(
          page.getByRole("textbox", { name: "Message", exact: true }),
        ).toHaveValue(draft);
        if (viewport.width < 660)
          await expect(
            page.locator('.pane-pager [aria-current="true"]'),
          ).toBeFocused();
        else
          await expect(
            page.locator(".pane-tile.active .pane-title"),
          ).toBeFocused();
        await (
          await paneOptions(page)
        )
          .getByRole("button", { name: "Move pane", exact: true })
          .click();
        const move = page.getByRole("dialog", {
          name: "Move pane",
          exact: true,
        });
        await expect(move.locator(".situate-select")).toHaveCount(2);
        const target = move.getByLabel("Beside pane", { exact: true });
        const position = move.getByLabel("Position", { exact: true });
        await expect(target).toBeFocused();
        for (const control of [
          target,
          position,
          move.getByRole("button", { name: "Move", exact: true }),
          move.getByRole("button", { name: "Cancel", exact: true }),
        ]) {
          const box = (await control.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(48);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        await chooseSelect(position, "top");
        await visual.capture("layout.panes.move-form");
        await move.getByRole("button", { name: "Move", exact: true }).click();
        await expect(move).not.toBeVisible();
        await expect
          .poll(async () => (await stored(page))?.layout.tabs[0]?.layout)
          .toMatchObject({
            kind: "split",
            axis: "column",
            first: { kind: "pane", id: ids[0] },
            second: { kind: "pane", id: ids[1] },
          });
        await expect(
          page.getByRole("textbox", { name: "Message", exact: true }),
        ).toHaveValue(draft);
      },
    );
  });
}

test.describe("localized maximized pane titles", () => {
  test.use({ locale: "de-DE" });
  for (const width of [1440, 390]) {
    test(
      `long pane titles remain accessible at ${width}px`,
      { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
      async ({ page, visual }) => {
        const title =
          "Community garden planning — spring planting, summer watering and observations for the following season";
        const panes = [
          {
            id: "chat",
            navigation: {
              cursor: 0,
              entries: [
                {
                  id: "chat-entry",
                  target: {
                    kind: "conversation" as const,
                    conversationId: "legacy",
                  },
                  presentation: null,
                },
              ],
            },
          },
          {
            id: "empty",
            navigation: {
              cursor: 0,
              entries: [
                {
                  id: "empty-entry",
                  target: { kind: "empty" as const },
                  presentation: null,
                },
              ],
            },
          },
        ];
        const document: Document = {
          version: 1,
          pinnedViews: ["files"],
          layout: {
            activeTabId: "garden-topic",
            closedTabs: [],
            tabs: [
              {
                id: "garden-topic",
                name: "",
                activePaneId: "chat",
                maximizedPaneId: "chat",
                conversationIds: ["legacy"],
                panes,
                layout: {
                  kind: "split",
                  id: "split",
                  axis: "row",
                  ratio: 0.5,
                  first: { kind: "pane", id: "chat" },
                  second: { kind: "pane", id: "empty" },
                },
              },
            ],
          },
        };
        await page.setViewportSize({ width, height: width < 600 ? 844 : 920 });
        await workspaceFixture(
          page,
          { ...shellState, mobile: width < 600 },
          {
            aiConversationTitle: title,
            layout: {
              records: { garden: { revision: "saved-layout", data: document } },
            },
            localization: {
              language: "de",
              formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
              writable: true,
            },
          },
        );
        await page.goto("/");
        const header = page.locator(".maximized-pane-header");
        const switcher = header.locator(".switch-pane");
        await expect(switcher).toHaveAccessibleName(
          `Bereich wechseln: ${title}`,
        );
        await compactPaneHeader(page);
        if (width < 600)
          expect(
            await switcher
              .locator("span")
              .evaluate((label) => label.scrollWidth > label.clientWidth),
          ).toBe(true);
        await visual.capture("layout.panes.maximized-long-title");
        await switcher.click();
        const dialog = page.getByRole("dialog", {
          name: "Bereich wechseln",
          exact: true,
        });
        const current = dialog.locator('[aria-current="true"]');
        await expect(current).toContainText(title);
        expect(
          await current.evaluate(
            (item) => item.scrollWidth <= item.clientWidth,
          ),
        ).toBe(true);
        await visual.capture("layout.panes.switch-list-long-title");
        await page.keyboard.press("Escape");
        await expect(switcher).toBeFocused();
        await page.reload();
        await expect(switcher).toHaveAccessibleName(
          `Bereich wechseln: ${title}`,
        );
        await expect(page.locator(".pane-tile")).toHaveCount(1);
        await header
          .getByRole("button", {
            name: "Anordnung wiederherstellen",
            exact: true,
          })
          .click();
        await expect(header).toHaveCount(0);
        await expect
          .poll(
            async () => (await stored(page))?.layout.tabs[0]?.maximizedPaneId,
          )
          .toBeNull();
      },
    );
  }
});

async function rename(page: Page, name: string) {
  await page.locator(".tab-header .tab-actions-trigger").click();
  await page.getByRole("menuitem", { name: /^(Rename|Rename tab)$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Rename tab", exact: true });
  await dialog
    .getByRole("textbox", { name: "Tab name", exact: true })
    .fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
}
async function closeTab(page: Page) {
  const tab = page.locator(".topic-tab.selected");
  if (await tab.isVisible()) {
    await tab.hover();
    await tab.locator(".tab-close").click();
  } else {
    await page.locator(".tab-header .tab-actions-trigger").click();
    await page
      .getByRole("menuitem", { name: "Close tab", exact: true })
      .click();
  }
}

for (const viewport of [
  { width: 1440, height: 920 },
  { width: 390, height: 844 },
]) {
  test(
    `tabs close directly and in groups without losing drafts at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await workspaceFixture(page, {
        ...shellState,
        mobile: viewport.width < 600,
      });
      await page.goto("/");
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Keep this draft after closing its tab");
      await rename(page, "Draft");
      await newTab(page);
      await rename(page, "Other");
      await newTab(page);
      await rename(page, "Keep");
      const menu = () =>
        page.locator(".tab-header .tab-actions-trigger").click();
      const action = (name: string) =>
        page.getByRole("menuitem", { name, exact: true }).click();
      if (viewport.width > 600) {
        const other = page.locator(".topic-tab").filter({
          has: page.getByRole("tab", { name: "Other", exact: true }),
        });
        const close = other.getByRole("button", {
          name: "Close tab: Other",
          exact: true,
        });
        await page.mouse.move(0, 0);
        for (const control of await page
          .locator(".topic-tab .tab-close")
          .all()) {
          await expect(control).toHaveCSS("opacity", "1");
          await expect(control).toHaveCSS("pointer-events", "auto");
          await expectCenteredCloseIcon(control);
        }
        const tabWidth = (await other.boundingBox())!.width;
        await visual.capture("layout.tabs.close-controls-visible");
        await close.hover();
        await expect(page.getByRole("tooltip")).toHaveText("Close tab");
        expect((await other.boundingBox())!.width).toBe(tabWidth);
        await expectCenteredCloseIcon(close);
        await expectCenteredCloseIcon(
          page.locator(".topic-tab.selected .tab-close"),
        );
        await visual.capture("layout.tabs.close-button-hover");
        await close.click();
        await expect(
          page.getByRole("tab", { name: "Keep", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("tab")).toHaveCount(2);
        await menu();
        await action("Reopen closed tab");
        await page.getByRole("tab", { name: "Keep", exact: true }).click();
      }
      await expect
        .poll(async () =>
          (await stored(page))?.layout.tabs.map((tab) => tab.name),
        )
        .toEqual(["Draft", "Other", "Keep"]);
      const original = (await stored(page))!.layout.tabs;
      await menu();
      await expect(
        page.getByRole("menuitem", { name: "Close other tabs", exact: true }),
      ).toBeEnabled();
      await visual.capture("layout.tabs.bulk-menu");
      await action("Close other tabs");
      await expect
        .poll(async () => (await stored(page))?.layout.tabs)
        .toEqual([original[2]]);
      await menu();
      await expect(
        page.getByRole("menuitem", { name: "Close other tabs", exact: true }),
      ).toBeDisabled();
      await action("Reopen closed tab");
      await menu();
      await action("Reopen closed tab");
      await expect
        .poll(async () => (await stored(page))?.layout.tabs)
        .toEqual(original);
      await menu();
      await action("Close all tabs");
      await expect(
        page.getByRole("heading", {
          name: "What would you like here?",
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(async () => (await stored(page))?.layout.tabs.length)
        .toBe(1);
      const empty = (await stored(page))!.layout.tabs[0]!;
      expect(original.map((tab) => tab.id)).not.toContain(empty.id);
      expect(empty.panes[0]!.navigation.entries[0]!.target).toEqual({
        kind: "empty",
      });
      await visual.capture("layout.tabs.empty-after-close-all");
      await menu();
      await action("Reopen closed tab");
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toHaveValue("Keep this draft after closing its tab");
      if (viewport.width > 600) {
        await page.getByRole("tab", { name: "Draft", exact: true }).focus();
        await page.keyboard.press("Tab");
        const close = page.getByRole("button", {
          name: "Close tab: Draft",
          exact: true,
        });
        await expect(close).toBeFocused();
        await expect(close).toHaveCSS("opacity", "1");
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("tab", { name: "New tab", exact: true }),
        ).toBeFocused();
      } else await closeTab(page);
      await expect
        .poll(async () => (await stored(page))?.layout.tabs)
        .toEqual([empty]);
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: "What would you like here?",
          exact: true,
        }),
      ).toBeVisible();
      await menu();
      await action("Reopen closed tab");
      if (viewport.width > 600)
        await expect(
          page.getByRole("tab", { name: "Draft", exact: true }),
        ).toBeVisible();
      else
        await expect(page.locator(".mobile-tab-trigger")).toContainText(
          "Draft",
        );
      await expect
        .poll(async () => (await stored(page))?.layout.activeTabId)
        .toBe(original[0]!.id);
    },
  );
}

test("pane grips move between all four edges with real pointer gestures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await (
    await paneOptions(page)
  )
    .getByRole("button", { name: "Add pane to the right", exact: true })
    .click();
  const ids = await page
    .locator(".pane-tile")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-pane")!),
    );
  const source = page.locator(`[data-pane="${ids[0]}"]`);
  const target = page.locator(`[data-pane="${ids[1]}"]`);
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const grip = (await source.locator(".pane-grip").boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 30, grip.y + 10, { steps: 5 });
    const drop = target.locator(`.drop-${edge}`);
    await expect(drop).toBeVisible();
    const box = (await drop.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 10,
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.up();
    await expect(page.locator(".drop-targets")).toHaveCount(0);
    await expect
      .poll(async () => {
        const a = (await source.boundingBox())!;
        const b = (await target.boundingBox())!;
        return edge === "top"
          ? a.y + a.height <= b.y
          : edge === "bottom"
            ? b.y + b.height <= a.y
            : edge === "left"
              ? a.x + a.width <= b.x
              : b.x + b.width <= a.x;
      })
      .toBe(true);
    await expect
      .poll(async () => (await stored(page))?.layout.tabs[0]?.layout)
      .toMatchObject({
        kind: "split",
        axis: edge === "top" || edge === "bottom" ? "column" : "row",
        first: {
          kind: "pane",
          id: ids[edge === "top" || edge === "left" ? 0 : 1],
        },
        second: {
          kind: "pane",
          id: ids[edge === "top" || edge === "left" ? 1 : 0],
        },
      });
  }
});

test(
  "main navigation reveals an open conversation while pane Back permits two shared displays",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    await workspaceFixture(page, shellState);
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("One conversation, two displays");
    await (
      await paneOptions(page)
    )
      .getByRole("button", { name: "Add pane to the right", exact: true })
      .click();
    const panes = page.locator(".pane-tile");
    await expect(panes).toHaveCount(2);
    await panes
      .last()
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await panes
      .first()
      .getByRole("textbox", { name: "Message", exact: true })
      .focus();
    await (
      await navigation(page)
    )
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await panes.last().locator(".pane-title").click();
    await page.keyboard.press("Escape");
    await (
      await navigation(page)
    )
      .locator(".conversation-destination")
      .first()
      .click();
    await expect(
      panes.last().getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("One conversation, two displays");
    await panes
      .first()
      .getByRole("button", { name: "Back in this pane", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveCount(2);
    await panes
      .first()
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Shared draft updated from the first display");
    await expect(
      panes.last().getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Shared draft updated from the first display");
    await visual.capture("layout.conversation.history-duplicate");
    await (
      await navigation(page)
    )
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await expect(panes.first().locator(".file-browser")).toBeVisible();
    await (
      await navigation(page)
    )
      .locator(".conversation-destination")
      .first()
      .click();
    await expect(panes.last()).toHaveClass(/active/);
    await expect(panes.first().locator(".file-browser")).toBeVisible();
    await newTab(page);
    await expect(page.locator(".view-chooser")).toBeVisible();
    await (
      await navigation(page)
    )
      .locator(".conversation-destination")
      .first()
      .click();
    await expect(panes).toHaveCount(2);
    await expect(panes.last()).toHaveClass(/active/);
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveCount(1);
    await visual.capture("layout.conversation.revealed-existing-topic");
    await panes.first().getByRole("searchbox", { name: "Find a file" }).focus();
    await expect(panes.first()).toHaveClass(/active/);
    await expect(panes.last()).not.toHaveClass(/active/);
    const divider = page.getByRole("separator", {
      name: "Resize panes",
      exact: true,
    });
    // Restored splits expose minimum bounds until ResizeObserver measures them.
    await expect
      .poll(
        async () =>
          Number(await divider.getAttribute("aria-valuenow")) -
          Number(await divider.getAttribute("aria-valuemin")),
      )
      .toBeGreaterThan(8);
    const originalSize = Number(await divider.getAttribute("aria-valuenow"));
    await divider.focus();
    await divider.press("ArrowLeft");
    await expect(divider).toHaveAttribute(
      "aria-valuenow",
      String(originalSize - 8),
    );
    await visual.capture("layout.conversation.resized-files-active");
    const calls = await page.evaluate(
      () => Reflect.get(window, "__ipcCalls") as { command: string }[],
    );
    expect(
      calls.filter((call) =>
        ["ai_create_conversation", "ai_begin", "ai_request"].includes(
          call.command,
        ),
      ),
    ).toEqual([]);
  },
);

test(
  "chat panes keep independent model overrides while another conversation runs",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    await workspaceFixture(page, shellState, {
      aiConnection: { provider: "openai", endpoint: null },
      aiModel: "gpt-5.4",
      showInlineModel: true,
      aiHoldResponse: true,
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Model", exact: true }),
    ).toHaveAttribute("aria-description", /gpt-5\.4/u);
    await (
      await paneOptions(page)
    )
      .getByRole("button", { name: "Add pane to the right", exact: true })
      .click();
    const panes = page.locator(".pane-tile");
    await panes
      .last()
      .getByRole("button", { name: "New chat", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Model", exact: true }),
    ).toHaveCount(2);
    await panes
      .first()
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Plan the herb garden");
    await panes
      .first()
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      panes.first().getByRole("button", { name: "Stop response", exact: true }),
    ).toBeVisible();
    await expect(
      panes.first().getByRole("button", { name: "Model", exact: true }),
    ).toBeEnabled();
    await panes
      .last()
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Plan a quiet reading weekend");
    await panes
      .last()
      .getByRole("button", { name: "Model", exact: true })
      .click();
    await page
      .getByRole("menu")
      .locator('[role="menuitemradio"][data-choice="gpt-4.1"]')
      .click();
    await expect(
      panes.last().getByRole("button", { name: "Model", exact: true }),
    ).toHaveAttribute("aria-description", /gpt-4\.1/u);
    await expect(
      panes.first().getByRole("button", { name: "Model", exact: true }),
    ).toHaveAttribute("aria-description", /gpt-5\.4/u);
    await expect(
      panes.last().getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Plan a quiet reading weekend");
    await expect
      .poll(() =>
        page.evaluate(() => typeof Reflect.get(window, "__finishResponse")),
      )
      .toBe("function");
    const calls = await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: {
            conversation?: string;
            model?: string;
          };
        }[],
    );
    expect(await nativeRequests(page)).toHaveLength(1);
    const selection = calls.filter(
      (call) => call.command === "ai_select_conversation_model",
    );
    expect(selection).toHaveLength(0);
    expect(
      calls.filter((call) => call.command === "ai_create_conversation"),
    ).toEqual([]);
    const preview = calls.filter(
      (call) => call.command === "ai_preview_conversation_status",
    );
    expect(preview.at(-1)!.args.model).toBe("gpt-4.1");
    expect(
      calls.filter((call) =>
        ["ai_select_model", "ai_settings_save"].includes(call.command),
      ),
    ).toEqual([]);
    await visual.capture("layout.conversation.independent-models");
    await expect
      .poll(() =>
        page.evaluate(() => typeof Reflect.get(window, "__finishResponse")),
      )
      .toBe("function");
    await page.evaluate(() => Reflect.get(window, "__finishResponse")());
    await expect(
      panes.first().getByRole("button", { name: "Stop response", exact: true }),
    ).toHaveCount(0);
  },
);

test(
  "independent file editors survive narrow projection and their arrangement survives restart",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1600, height: 920 });
    await filesFixture(page);
    await page.goto("/");
    await (
      await navigation(page)
    )
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await page.getByRole("button", { name: "Garden.md", exact: true }).click();
    await (
      await paneOptions(page)
    )
      .getByRole("button", { name: "Add pane to the right", exact: true })
      .click();
    const panes = page.locator(".pane-tile");
    await panes
      .last()
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await panes
      .last()
      .getByRole("button", { name: "Reading.md", exact: true })
      .click();
    await expect(
      panes
        .first()
        .getByRole("heading", { name: "A small garden", exact: true }),
    ).toBeVisible();
    await expect(
      panes.last().getByRole("heading", { name: "Reading list", exact: true }),
    ).toBeVisible();
    await panes
      .first()
      .getByRole("button", { name: "File actions", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Edit source", exact: true })
      .click();
    await panes
      .first()
      .getByRole("textbox", { name: "Markdown source", exact: true })
      .fill("# A small garden\n\nLavender beside the path.");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__filesTest.calls
              .filter(
                (call) =>
                  call.operation === "save" && call.path === "Notes/Garden.md",
              )
              .at(-1)?.text,
        ),
      )
      .toBe("# A small garden\n\nLavender beside the path.");
    await expect(
      panes.last().getByRole("heading", { name: "Reading list", exact: true }),
    ).toBeVisible();
    await panes
      .last()
      .getByRole("button", { name: "File actions", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Edit source", exact: true })
      .click();
    await panes
      .last()
      .getByRole("textbox", { name: "Markdown source", exact: true })
      .fill("# Reading list\n\nA quiet weekend book.");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__filesTest.calls
              .filter(
                (call) =>
                  call.operation === "save" && call.path === "Notes/Reading.md",
              )
              .at(-1)?.text,
        ),
      )
      .toBe("# Reading list\n\nA quiet weekend book.");
    const divider = page.getByRole("separator", {
      name: "Resize panes",
      exact: true,
    });
    const originalSize = Number(await divider.getAttribute("aria-valuenow"));
    const available = await divider.evaluate(
      (element) => element.parentElement!.getBoundingClientRect().width - 10,
    );
    const resized = originalSize + 8;
    await divider.focus();
    await divider.press("ArrowRight");
    await expect(divider).toHaveAttribute("aria-valuenow", String(resized));
    await expect
      .poll(async () => (await stored(page))?.layout.tabs[0]?.layout)
      .toMatchObject({
        kind: "split",
        axis: "row",
        ratio: resized / available,
      });
    const arrangement = (await stored(page))!.layout.tabs[0]!.layout;
    await visual.capture("layout.files.independent-editors");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panes).toHaveCount(1);
    await page
      .getByRole("button", { name: "Collapse file browser", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Markdown source", exact: true }),
    ).toHaveValue("# Reading list\n\nA quiet weekend book.");
    await page.locator('.pane-pager [aria-current="true"]').press("ArrowLeft");
    await page
      .getByRole("button", { name: "Collapse file browser", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Markdown source", exact: true }),
    ).toHaveValue("# A small garden\n\nLavender beside the path.");
    await page.setViewportSize({ width: 1600, height: 920 });
    await expect(panes).toHaveCount(2);
    await expect(divider).toHaveAttribute("aria-valuenow", String(resized));
    expect((await stored(page))!.layout.tabs[0]!.layout).toEqual(arrangement);
    await rename(page, "Weekend research");
    await expect
      .poll(async () => (await stored(page))?.layout.tabs[0]?.name)
      .toBe("Weekend research");
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Weekend research", exact: true }),
    ).toBeVisible();
    await expect(panes).toHaveCount(2);
    await expect(divider).toHaveAttribute("aria-valuenow", String(resized));
    await expect(panes.first().locator(".document-location h3")).toHaveText(
      "Garden.md",
    );
    await expect(panes.last().locator(".document-location h3")).toHaveText(
      "Reading.md",
    );
    expect((await stored(page))!.layout.tabs[0]!.layout).toEqual(arrangement);
    await visual.capture("layout.files.restored-arrangement");
    const source = panes
      .first()
      .getByRole("textbox", { name: "Markdown source", exact: true });
    const longSource =
      "# A small garden\n\n" + "Lavender beside the path.\n".repeat(100);
    await source.fill(longSource);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__filesTest.calls
              .filter(
                (call) =>
                  call.operation === "save" && call.path === "Notes/Garden.md",
              )
              .at(-1)?.text,
        ),
      )
      .toBe(longSource);
    await source.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(() => source.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(source).toBeFocused();
    await expect(panes.first()).toHaveClass(/active/);
    await expect(panes.last()).not.toHaveClass(/active/);
    await visual.capture("layout.files.scrolled-source");
    await panes
      .first()
      .getByRole("button", { name: "File actions", exact: true })
      .click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(
      menu.getByRole("menuitemradio", { name: "Edit source", exact: true }),
    ).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(source).toHaveValue(longSource);
  },
);

test("a live reference follows a managed move after its old path is reused", async ({
  page,
}) => {
  await filesFixture(page);
  await page.goto("/");
  await expect(page.locator(".topic-window")).toBeVisible();
  await (
    await navigation(page)
  )
    .getByRole("button", { name: "Files", exact: true })
    .click();
  await page.getByRole("button", { name: "Garden.md", exact: true }).click();
  await page
    .getByRole("button", { name: "New chat with this file", exact: true })
    .click();
  await expect(page.locator(".draft-references")).toContainText("Garden.md");
  await page.evaluate(async () => {
    const workspaceId = window.__filesTest.calls.find(
      (request) => request.operation === "captureReference",
    )!.workspaceId;
    await Reflect.get(window, "__TAURI_INTERNALS__").invoke("files_request", {
      request: {
        operation: "rename",
        workspaceId,
        path: "Notes/Garden.md",
        destination: "Notes/Original.md",
      },
    });
    window.__filesTest.external("Notes/Original.md", "# Original garden");
    window.__filesTest.external("Notes/Garden.md", "# Unrelated replacement");
  });
  await page.locator(".draft-references .reference-open").click();
  await expect(
    page.getByRole("heading", { name: "Original garden", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Unrelated replacement", exact: true }),
  ).toHaveCount(0);
  const calls = await page.evaluate(
    () => Reflect.get(window, "__ipcCalls") as { command: string }[],
  );
  expect(
    calls.filter((call) => ["ai_begin", "ai_request"].includes(call.command)),
  ).toEqual([]);
});

test(
  "a file opens a referenced chat without sending and the reference returns to its file",
  { tag: "@visual-mobile" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await filesFixture(page, { mobile: true });
    await page.goto("/");
    await expect(page.locator(".topic-window")).toBeVisible();
    await (
      await navigation(page)
    )
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await page.getByRole("button", { name: "Garden.md", exact: true }).click();
    await page
      .getByRole("button", { name: "New chat with this file", exact: true })
      .click();
    await expect(page.locator(".draft-references")).toContainText("Garden.md");
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("");
    expect(
      await page.evaluate(() => {
        const calls = Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: { record?: unknown };
        }[];
        return calls.filter(
          (call) =>
            call.command === "ai_create_conversation" ||
            (call.command === "ai_conversation_read" && call.args.record),
        );
      }),
    ).toEqual([]);
    await visual.capture("layout.reference.unsent-chat");
    await page.locator(".draft-references .reference-open").click();
    await expect(
      page.getByRole("heading", { name: "A small garden", exact: true }),
    ).toBeVisible();
    await visual.capture("layout.reference.opened-file");
    await page
      .getByRole("button", { name: "Back in this pane", exact: true })
      .click();
    await expect(page.locator(".view-chooser")).toBeVisible();
    await expect(page.locator(".draft-references")).toHaveCount(0);
    const calls = await page.evaluate(
      () => Reflect.get(window, "__ipcCalls") as { command: string }[],
    );
    expect(
      calls.filter((call) => call.command === "ai_create_conversation"),
    ).toHaveLength(0);
    expect(
      calls.filter((call) => ["ai_begin", "ai_request"].includes(call.command)),
    ).toEqual([]);
  },
);

test("the tab overview button follows strip overflow rather than clipped titles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  const longTitle =
    "Seasonal garden observations and preparations for next spring";
  await rename(page, longTitle);
  const overview = page.getByRole("button", { name: "All tabs", exact: true });
  const label = page
    .locator(".topic-tab.selected .topic-tab-select > span")
    .first();
  expect(
    await label.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await expect(overview).toHaveCount(0);
  for (let index = 0; index < 2; index++) {
    await newTab(page);
    await rename(page, `${longTitle} · ${index + 1}`);
  }
  await expect(overview).toHaveCount(0);
  await page.setViewportSize({ width: 700, height: 920 });
  await expect(overview).toBeVisible();
  await overview.click();
  const dialog = page.getByRole("dialog", { name: "All tabs", exact: true });
  await expect(dialog.locator(".tab-sheet-row")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(overview).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 920 });
  await expect(overview).toHaveCount(0);
  await expect(
    page.locator('.topic-tab-select[aria-selected="true"]'),
  ).toBeFocused();
  await page.setViewportSize({ width: 700, height: 920 });
  await expect(overview).toBeVisible();
  await closeTab(page);
  await closeTab(page);
  await expect(overview).toHaveCount(0);
  await expect
    .poll(async () => (await stored(page))?.layout.tabs.length)
    .toBe(1);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: longTitle, exact: true }),
  ).toBeVisible();
  await expect(overview).toHaveCount(0);
});

for (const viewport of [
  { width: 1440, height: 920 },
  { width: 390, height: 844 },
  { width: 320, height: 540 },
]) {
  test(
    `tab overview keeps rows and actions compact at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }, info) => {
      let next = 0;
      const id = () => `overview-${++next}`;
      let layout = emptyLayout();
      const longTitle =
        "Community garden plans, seasonal observations and preparations for next spring";
      for (const name of [longTitle, "My week", "Files"]) {
        layout = reduceLayout(layout, { type: "new-tab" }, id);
        layout = reduceLayout(
          layout,
          { type: "rename-tab", tabId: layout.activeTabId!, name },
          id,
        );
      }
      const tabId = layout.tabs[0]!.id;
      layout = reduceLayout(layout, { type: "select-tab", tabId }, id);
      layout = reduceLayout(
        layout,
        {
          type: "split",
          tabId,
          paneId: layout.tabs[0]!.activePaneId,
          edge: "right",
        },
        id,
      );
      await page.setViewportSize({ width: 700, height: viewport.height });
      await workspaceFixture(
        page,
        { ...shellState, mobile: viewport.width < 600 },
        {
          layout: {
            records: {
              garden: {
                revision: "overview-layout",
                data: { version: 1, layout, pinnedViews: ["files"] },
              },
            },
          },
        },
      );
      await page.goto("/");
      const trigger = page.locator(
        viewport.width < 600 ? ".mobile-tab-trigger" : ".all-tabs",
      );
      await trigger.click();
      await page.setViewportSize(viewport);
      const overview = page.getByRole("dialog", {
        name: "All tabs",
        exact: true,
      });
      await expect(overview.locator(".tab-sheet-row")).toHaveCount(3);
      await expect(overview.locator('[aria-current="true"]')).toBeFocused();
      await expect(
        overview.getByRole("heading", { name: "All tabs", exact: true }),
      ).toHaveCSS("font-size", "20px");
      await expect(overview.locator(".tab-sheet-title").first()).toHaveCSS(
        "font-size",
        "14px",
      );
      await expect(overview.locator(".tab-sheet-title").first()).toHaveCSS(
        "font-weight",
        "600",
      );
      await expect(overview.locator(".tab-sheet-current")).toBeVisible();
      await expect(
        overview.getByRole("button", {
          name: "Reopen closed tab",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(
        await overview.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await visual.capture("layout.tabs.overview");
      await page.screenshot({ path: info.outputPath("all-tabs-overview.png") });
      for (const title of ["My week", "Files"]) {
        await overview
          .getByRole("button", { name: `Tab options: ${title}`, exact: true })
          .click();
        await overview
          .getByRole("menuitem", { name: "Close tab", exact: true })
          .click();
      }
      await expect(overview.locator(".tab-sheet-row")).toHaveCount(1);
      const row = (await overview.locator(".tab-sheet-row").boundingBox())!;
      const header = (await overview
        .locator(".situate-dialog__header")
        .boundingBox())!;
      expect(row.y - header.y - header.height).toBeCloseTo(16, 0);
      expect(row.height).toBeLessThan(110);
      const title = (await overview.locator(".tab-sheet-title").boundingBox())!;
      const meta = (await overview.locator(".tab-sheet-meta").boundingBox())!;
      expect(meta.x).toBeCloseTo(title.x, 1);
      const reopen = overview.getByRole("button", {
        name: "Reopen closed tab",
        exact: true,
      });
      await expect(reopen).toBeVisible();
      expect((await reopen.boundingBox())!.y).toBeGreaterThan(
        row.y + row.height,
      );
      expect(
        await overview.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await visual.capture("layout.tabs.overview-sparse");
      await page.screenshot({ path: info.outputPath("all-tabs-sparse.png") });
      await reopen.click();
      await expect(overview).not.toBeVisible();
      await expect
        .poll(async () => {
          const document = await stored(page);
          return document?.layout.tabs.find(
            (tab) => tab.id === document.layout.activeTabId,
          )?.name;
        })
        .toBe("Files");
    },
  );
}

for (const viewport of [
  { width: 1440, height: 920 },
  { width: 390, height: 844 },
  { width: 320, height: 540 },
]) {
  test(
    `tabs rename, close and reopen with their pane arrangement at ${viewport.width}px`,
    { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize(viewport);
      await workspaceFixture(page, {
        ...shellState,
        mobile: viewport.width < 600,
      });
      await page.goto("/");
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toBeVisible();
      await newTab(page);
      await expect(
        page.getByRole("region", { name: "Open a view", exact: true }),
      ).toBeVisible();
      const chooser = page.locator(".view-chooser");
      await expect(
        chooser.getByRole("heading", {
          name: "What would you like here?",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        chooser.getByRole("heading", { name: "Pinned views", exact: true }),
      ).toBeVisible();
      await expect(
        chooser.getByRole("button", { name: "Files", exact: true }),
      ).toBeVisible();
      const frame = (await chooser.boundingBox())!;
      const content = (await chooser
        .locator(".chooser-content")
        .boundingBox())!;
      expect(
        Math.abs(content.x + content.width / 2 - frame.x - frame.width / 2),
      ).toBeLessThan(2);
      expect(
        Math.abs(content.y + content.height / 2 - frame.y - frame.height / 2),
      ).toBeLessThan(2);
      await visual.capture("layout.tabs.empty-topic");
      await chooser
        .getByRole("button", { name: "All views", exact: true })
        .click();
      await expect(
        chooser.getByRole("heading", { name: "All views", exact: true }),
      ).toBeVisible();
      await chooser
        .getByRole("button", { name: "Unpin Files", exact: true })
        .click();
      await expect
        .poll(async () => (await stored(page))?.pinnedViews)
        .toEqual([]);
      await visual.capture("layout.tabs.all-views");
      await chooser.getByRole("button", { name: "Back", exact: true }).click();
      await expect(
        chooser.getByText("No pinned views yet.", { exact: true }),
      ).toBeVisible();
      await expect(
        chooser.getByRole("button", { name: "New chat", exact: true }),
      ).toBeVisible();
      await visual.capture("layout.tabs.no-pinned-views");
      await chooser
        .getByRole("button", { name: "All views", exact: true })
        .click();
      await chooser
        .getByRole("button", { name: "Pin Files", exact: true })
        .click();
      await chooser.getByRole("button", { name: "Back", exact: true }).click();
      await expect(
        chooser.getByRole("button", { name: "Files", exact: true }),
      ).toBeVisible();
      await page.locator(".tab-header .tab-actions-trigger").click();
      await expect(
        page.getByRole("menuitem", {
          name: viewport.width < 600 ? "Close tab" : "Close all tabs",
          exact: true,
        }),
      ).toBeVisible();
      await visual.capture("layout.tabs.close-menu");
      await page.keyboard.press("Escape");
      await rename(page, "Reading and weekend plans with a long topic name");
      await (
        await paneOptions(page)
      )
        .getByRole("button", { name: "Add pane below", exact: true })
        .click();
      await expect(
        page.locator(
          viewport.width < 600 ? ".pane-pager" : ".split-layout.column",
        ),
      ).toBeVisible();
      await expect
        .poll(async () => (await stored(page))?.layout.tabs[1]?.panes.length)
        .toBe(2);
      const before = (await stored(page))!.layout.tabs[1]!;
      if (viewport.width >= 600) {
        await page.locator(".pane-title").last().hover();
        await expect(
          page.getByRole("tooltip").filter({ hasText: /^New tab$/u }),
        ).toBeVisible();
      }
      await visual.capture("layout.tabs.named-split-topic");
      await closeTab(page);
      await expect(
        page.getByRole("textbox", { name: "Message", exact: true }),
      ).toBeVisible();
      await page.locator(".tab-header .tab-actions-trigger").click();
      await expect(
        page.getByRole("menuitem", { name: "Reopen closed tab", exact: true }),
      ).toBeVisible();
      await visual.capture("layout.tabs.reopen-menu");
      await page
        .getByRole("menuitem", { name: "Reopen closed tab", exact: true })
        .click();
      await expect(
        page.locator(
          viewport.width < 600 ? ".pane-pager" : ".split-layout.column",
        ),
      ).toBeVisible();
      await expect
        .poll(async () => (await stored(page))?.layout.tabs[1])
        .toEqual(before);
      await closeTab(page);
      await closeTab(page);
      await expect(
        page.getByRole("heading", {
          name: "What would you like here?",
          exact: true,
        }),
      ).toBeVisible();
      const remainingTab = page.getByRole("tab", {
        name: "New tab",
        exact: true,
      });
      await expect(remainingTab).toBeVisible();
      await page.mouse.move(0, 0);
      await remainingTab.focus();
      await expect(remainingTab).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("layout.tabs.empty-after-close");
      await page.locator(".tab-header .tab-actions-trigger").click();
      await expect(
        page.getByRole("menuitem", { name: "Reopen closed tab", exact: true }),
      ).toBeVisible();
    },
  );
}

test(
  "an unreadable saved layout is preserved until a successful reload",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    const unreadable = {
      revision: "unreadable-1",
      data: {
        version: 99,
        layout: { original: "Keep this data" },
        pinnedViews: [],
      },
    };
    await workspaceFixture(page, shellState, {
      layout: { records: { garden: unreadable } },
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "This layout was saved by an unsupported version of Situate.",
    );
    await expect(page.locator(".topic-window")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__layoutTest.stored("garden")),
    ).toEqual(unreadable);
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__ipcCalls").filter(
          (call: { command: string }) => call.command === "layout_save",
        ),
      ),
    ).toEqual([]);
    await visual.capture("layout.storage.unreadable");
    await page.evaluate(() =>
      window.__layoutTest.replace("garden", { revision: null, data: null }),
    );
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.locator(".view-chooser")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  },
);

test(
  "failed layout saves retain changes and conflict recovery never overwrites another revision",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    await workspaceFixture(page, shellState);
    await page.goto("/");
    await expect
      .poll(async () => (await stored(page))?.layout.tabs.length)
      .toBe(1);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await page.evaluate(() =>
      window.__layoutTest.failSave("native.layout.storage.failed"),
    );
    await newTab(page);
    await expect(page.getByRole("alert")).toContainText(
      "The workspace layout could not be read or saved.",
    );
    await expect(page.getByRole("tab")).toHaveCount(2);
    expect((await stored(page))!.layout.tabs).toHaveLength(1);
    await visual.capture("layout.storage.save-failed");
    await page.evaluate(() => window.__layoutTest.failSave(null));
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect
      .poll(async () => (await stored(page))?.layout.tabs.length)
      .toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
    const saved = (await stored(page))!;
    const external: Document = {
      ...saved,
      layout: {
        ...saved.layout,
        tabs: saved.layout.tabs.map((tab, index) =>
          index ? tab : { ...tab, name: "Saved elsewhere" },
        ),
      },
    };
    await page.evaluate(
      (serialized) =>
        window.__layoutTest.replace("garden", {
          revision: "external-revision",
          data: JSON.parse(serialized),
        }),
      JSON.stringify(external),
    );
    await newTab(page);
    await expect(page.getByRole("alert")).toContainText(
      "The workspace layout changed. Reload it before saving again.",
    );
    expect((await stored(page))!.layout.tabs).toHaveLength(2);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "The saved layout changed elsewhere.",
    );
    await page
      .getByRole("button", { name: "Use saved layout", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Reload the saved layout?",
      exact: true,
    });
    await expect(dialog).toContainText(
      "keeps your files and conversation drafts",
    );
    await visual.capture("layout.storage.reload-confirmation");
    await dialog
      .getByRole("button", { name: "Use saved layout", exact: true })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(
      page.getByRole("tab", { name: "Saved elsewhere", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await stored(page)).toEqual(external);
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Saved elsewhere", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(2);
  },
);
