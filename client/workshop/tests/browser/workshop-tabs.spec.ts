import { expect, test, type Locator, type Page } from "./test";
import { selectOption } from "./select";
import { selectScenario } from "./scenarios";
import { expectDialogTitle } from "./dialog-typography";

async function open(controls: Page, scenario = "tabs-overview") {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1440, height: 920 });
  await expect(
    preview.locator(
      scenario.startsWith("tabs-") ? ".topic-window" : ".chat-screen",
    ),
  ).toBeVisible();
  await expect(preview.locator(".desktop-sidebar")).toBeVisible();
  return preview;
}
test("tab focus and active pane contours stay inside their surfaces", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.keyboard.press("Tab");
  const tab = preview.locator(".topic-tab-select").first();
  await tab.focus();
  await expect(tab).toBeFocused();
  await expect(tab).toHaveCSS("outline-width", "3px");
  await expect(tab).toHaveCSS("outline-offset", "-3px");
  const active = preview.locator(".pane-tile.active");
  await expect(active).toHaveCSS("box-shadow", "none");
  expect(
    await active.evaluate((pane) => {
      const ring = getComputedStyle(pane, "::after");
      return {
        inset: ring.inset,
        pointerEvents: ring.pointerEvents,
        border: ring.borderTopWidth,
      };
    }),
  ).toEqual({ inset: "0px", pointerEvents: "none", border: "1px" });
  await preview.emulateMedia({ forcedColors: "active" });
  await expect(tab).toHaveCSS("outline-style", "solid");
  await expect(tab).toHaveCSS("outline-offset", "-3px");
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

async function closeActiveTab(preview: Page) {
  await preview.locator(".topic-tab.selected").hover();
  await preview.locator(".topic-tab.selected .tab-close").click();
}
function activeTabControl(preview: Page) {
  return preview.locator(
    '.topic-tabs [aria-selected="true"], .mobile-tab-trigger',
  );
}

async function options(preview: Page, title: string) {
  const mobile = preview.getByRole("button", {
    name: "Pane and tab actions",
    exact: true,
  });
  if (await mobile.isVisible()) {
    await mobile.click();
    await preview
      .getByRole("menuitem", { name: "Pane layout", exact: true })
      .click();
  } else {
    await preview
      .getByRole("button", { name: `Pane layout: ${title}`, exact: true })
      .click();
  }
  const dialog = preview.getByRole("dialog", {
    name: "Pane layout",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", {
      name: /Back in this pane|Forward in this pane|Open a view/,
    }),
  ).toHaveCount(0);
  return dialog;
}

async function navigateFromMenu(preview: Page, name: string) {
  let navigation = preview.locator(".desktop-sidebar");
  if (!(await navigation.isVisible())) {
    await preview
      .getByRole("button", {
        name: "Workspace navigation: Field notes",
        exact: true,
      })
      .click();
    navigation = preview.getByRole("dialog", {
      name: "Workspace navigation",
      exact: true,
    });
  }
  if (
    !(await navigation.getByRole("button", { name, exact: true }).isVisible())
  ) {
    await navigation.getByRole("button", { name: "More", exact: true }).click();
  }
  await navigation.getByRole("button", { name, exact: true }).click();
}

async function backInActivePane(preview: Page) {
  const pane = preview.locator(".pane-tile.active");
  if (await pane.locator(".pane-toolbar").count()) {
    await pane
      .getByRole("button", { name: "Back in this pane", exact: true })
      .click();
  } else {
    await preview
      .locator(".tab-header")
      .getByRole("button", { name: "Back in this pane", exact: true })
      .click();
  }
}

for (const [scenario, tabs, panes] of [
  ["tabs-new-chat", 1, 1],
  ["tabs-single-topic", 1, 3],
  ["tabs-multiple-topics", 3, 1],
  ["tabs-overview", 3, 3],
] as const) {
  test(`tab and pane hierarchy: ${tabs} tabs, ${panes} panes`, async ({
    page,
  }, info) => {
    const preview = await open(page, scenario);
    await preview.emulateMedia({ reducedMotion: "reduce" });
    if (scenario === "tabs-new-chat")
      await expect(preview.locator(".greeting")).toHaveAttribute(
        "data-state",
        "done",
      );
    const header = preview.locator(".tab-header");
    await expect(header).toHaveCount(1);
    await expect(header.getByRole("tab")).toHaveCount(tabs);
    await expect(preview.locator(".pane-toolbar")).toHaveCount(
      panes === 1 ? 0 : panes,
    );
    await expect(header.locator(".pane-history")).toHaveCount(
      panes === 1 ? 1 : 0,
    );
    await expect(
      header.getByRole("button", { name: "All tabs", exact: true }),
    ).toHaveCount(0);
    expect((await header.boundingBox())!.height).toBe(56);
    await expect(preview.locator(".topic-panel > footer")).toHaveCount(0);
    if (panes > 1) {
      await expect(preview.locator(".layout-scroll")).toHaveCSS(
        "padding-bottom",
        "12px",
      );
      const panel = await preview.locator(".topic-panel").boundingBox();
      const canvas = await preview.locator(".layout-canvas").boundingBox();
      expect(panel!.y + panel!.height - canvas!.y - canvas!.height).toBeCloseTo(
        12,
        0,
      );
    }
    await expect(
      preview.locator(".window-toolbar, .surface-heading"),
    ).toHaveCount(0);
    await preview.screenshot({
      path: info.outputPath("hierarchy-desktop.png"),
    });
    await preview.setViewportSize({ width: 390, height: 844 });
    await expect(preview.locator(".mobile-tab-trigger")).toBeVisible();
    await expect(preview.locator(".mobile-pane-header")).toHaveCount(
      panes === 1 ? 0 : 1,
    );
    await expect(header.locator(".pane-history")).toHaveCount(
      panes === 1 ? 1 : 0,
    );
    await expect(preview.locator(".pane-history")).toHaveCount(1);
    expect((await header.boundingBox())!.height).toBe(48);
    if (panes > 1) {
      const paneHeader = preview.locator(".mobile-pane-header");
      await expect(
        paneHeader.getByRole("button", {
          name: "Back in this pane",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        paneHeader.getByRole("button", { name: /^Pane layout:/ }),
      ).toBeVisible();
      await header
        .getByRole("button", { name: "Tab options", exact: true })
        .click();
      await expect(
        preview.getByRole("menuitem", { name: "Pane layout", exact: true }),
      ).toHaveCount(0);
      await preview.keyboard.press("Escape");
    }
    expect(
      await header.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await preview.screenshot({ path: info.outputPath("hierarchy-mobile.png") });
    await preview.setViewportSize({ width: 1440, height: 920 });
    await expect(header.getByRole("tab")).toHaveCount(tabs);
    await expect(preview.locator(".pane-toolbar")).toHaveCount(
      panes === 1 ? 0 : panes,
    );
  });
}

test("tab overflow follows available width and returns focus when it disappears", async ({
  page,
}) => {
  const preview = await open(page, "tabs-multiple-topics");
  const overview = preview.getByRole("button", {
    name: "All tabs",
    exact: true,
  });
  await expect(overview).toHaveCount(0);
  await preview.setViewportSize({ width: 700, height: 920 });
  await expect(overview).toBeVisible();
  await overview.click();
  const dialog = preview.getByRole("dialog", { name: "All tabs", exact: true });
  await expect(dialog.locator(".tab-sheet-select")).toHaveCount(3);
  await preview.keyboard.press("Escape");
  await expect(overview).toBeFocused();
  await preview.setViewportSize({ width: 1440, height: 920 });
  await expect(overview).toHaveCount(0);
  await expect(
    preview.getByRole("tab", { name: "My week", exact: true }),
  ).toBeFocused();
});

test("visible history controls stay local through single panes, tabs and splits", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-empty");
  const back = preview.getByRole("button", {
    name: "Back in this pane",
    exact: true,
  });
  const forward = preview.getByRole("button", {
    name: "Forward in this pane",
    exact: true,
  });
  await expect(preview.getByRole("tablist")).toHaveCount(1);
  await expect(back).toBeVisible();
  await expect(back).toBeDisabled();
  await expect(forward).toBeVisible();
  await expect(forward).toBeDisabled();
  await expect(back).toHaveAttribute(
    "aria-description",
    "No earlier view in this pane.",
  );
  const paneId = await preview.locator(".pane-tile").getAttribute("data-pane");
  await navigateFromMenu(preview, "Calendar");
  await navigateFromMenu(preview, "Notes");
  await back.focus();
  await preview.keyboard.press("Enter");
  await expect(activeTabControl(preview)).toHaveText("Calendar");
  await expect(forward).toBeEnabled();
  await forward.click();
  await expect(activeTabControl(preview)).toHaveText("Notes");
  await back.click();
  await navigateFromMenu(preview, "Tasks");
  await expect(forward).toBeDisabled();
  await expect(preview.locator(".pane-tile")).toHaveAttribute(
    "data-pane",
    paneId!,
  );
  await preview.screenshot({
    path: info.outputPath("single-pane-visible-history.png"),
  });
  await preview.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await preview.getByRole("tab", { name: "Tasks", exact: true }).click();
  await expect(back).toBeEnabled();
  await options(preview, "Tasks");
  await preview
    .getByRole("button", { name: "Add pane to the right", exact: true })
    .click();
  await navigateFromMenu(preview, "Files");
  const original = preview.locator(`[data-pane="${paneId}"]`);
  const second = preview.getByRole("region", {
    name: "Pane: Files",
    exact: true,
  });
  const secondId = await second.getAttribute("data-pane");
  await expect(
    preview.getByRole("group", { name: "Pane history", exact: true }),
  ).toHaveCount(2);
  await expect(preview.locator(".tab-header .pane-history")).toHaveCount(0);
  await second
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(
    preview.locator(`[data-pane="${secondId}"] .view-chooser`),
  ).toBeVisible();
  await expect(
    original.getByRole("heading", { name: "Next steps", exact: true }),
  ).toBeVisible();
  await original
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(original).toHaveAttribute("aria-label", "Pane: Calendar");
  await expect(
    preview.locator(`[data-pane="${secondId}"] .view-chooser`),
  ).toBeVisible();
  await preview.screenshot({
    path: info.outputPath("split-pane-local-history.png"),
  });
});

test("mobile overflow keeps tab and layout actions inside keyboard space", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-new-chat");
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await preview.setViewportSize({ width: 320, height: 540 });
  const draft = preview.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Keep this draft");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(preview.locator(".environment-content")).toHaveCSS(
    "height",
    "187px",
  );
  const trigger = preview.getByRole("button", {
    name: "Pane and tab actions",
    exact: true,
  });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await preview.keyboard.press("ArrowDown");
  const menu = preview.getByRole("menu", {
    name: "Pane and tab actions",
    exact: true,
  });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Pane layout",
    "New tab",
    "Rename tab",
    "Close tab",
    "Close other tabs",
    "Close all tabs",
  ]);
  await expect(
    menu.getByRole("menuitem", { name: "Pane layout", exact: true }),
  ).toBeFocused();
  const area = (await preview.locator(".environment-content").boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(area.y);
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
  expect(box.x).toBeGreaterThanOrEqual(area.x);
  expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);
  await preview.keyboard.press("End");
  const close = menu.getByRole("menuitem", {
    name: "Close all tabs",
    exact: true,
  });
  await expect(close).toBeFocused();
  const closeBox = (await close.boundingBox())!;
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(box.y + box.height);
  await preview.screenshot({
    path: info.outputPath("mobile-actions-keyboard.png"),
  });
  await preview.keyboard.press("Home");
  await preview.keyboard.press("Enter");
  const layout = preview.getByRole("dialog", {
    name: "Pane layout",
    exact: true,
  });
  await expect(layout).toBeVisible();
  await expect(
    layout.getByRole("button", {
      name: /Back in this pane|Forward in this pane|Open a view/,
    }),
  ).toHaveCount(0);
  await preview.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(draft).toHaveValue("Keep this draft");
  await trigger.click();
  await menu.getByRole("menuitem", { name: "Rename tab", exact: true }).click();
  await preview
    .getByRole("textbox", { name: "Tab name", exact: true })
    .fill("Planning");
  await preview.keyboard.press("Enter");
  await expect(activeTabControl(preview)).toHaveText("Planning");
  await expect(trigger).toBeFocused();
  await page.getByLabel("Keyboard occlusion").uncheck();
  await expect(preview.locator(".environment-content")).toHaveCSS(
    "height",
    "447px",
  );
  await trigger.click();
  await page.getByLabel("Keyboard occlusion").check();
  await expect(menu).toBeVisible();
  await expect(async () => {
    const resizedMenu = (await menu.boundingBox())!;
    const resizedArea = (await preview
      .locator(".environment-content")
      .boundingBox())!;
    expect(resizedMenu.y).toBeGreaterThanOrEqual(resizedArea.y);
    expect(resizedMenu.y + resizedMenu.height).toBeLessThanOrEqual(
      resizedArea.y + resizedArea.height,
    );
  }).toPass();
  await preview.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(menu).toHaveCount(0);
  await expect(draft).toHaveValue("");
});

test("a lone conversation keeps its tab row and gains local headers only when split", async ({
  page,
}, info) => {
  const reference = await open(page, "chat-empty");
  await reference.emulateMedia({ reducedMotion: "reduce" });
  await reference.evaluate(() => document.fonts.ready);
  const referenceHeader = (await reference
    .locator(".chat-heading")
    .boundingBox())!;
  const referenceWelcome = (await reference.locator(".welcome").boundingBox())!;
  await reference.close();
  const preview = await open(page, "tabs-new-chat");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await preview.evaluate(() => document.fonts.ready);
  await expect(
    preview.locator(
      ".tabs-bar, .pane-toolbar, .layout-footer, .mobile-pane-header",
    ),
  ).toHaveCount(0);
  const header = (await preview.locator(".tab-header").boundingBox())!;
  const welcome = (await preview.locator(".welcome").boundingBox())!;
  expect(header.height).toBeLessThan(referenceHeader.height);
  expect(welcome.width).toBe(referenceWelcome.width);
  expect(welcome.x).toBe(referenceWelcome.x);
  expect(welcome.y).toBeCloseTo(
    referenceWelcome.y + (header.height - referenceHeader.height) / 2,
    0,
  );
  const tile = (await preview.locator(".pane-tile").boundingBox())!;
  expect(tile.x).toBe(header.x);
  expect(tile.width).toBe(header.width);
  expect(tile.y).toBe(header.y + header.height);
  await expect(preview.locator(".pane-tile")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(preview.locator(".greeting")).toHaveAttribute(
    "data-state",
    "done",
  );
  await preview.screenshot({
    path: info.outputPath("lone-conversation-desktop.png"),
  });
  const draft = preview.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Keep this context");
  await options(preview, "New conversation");
  await preview
    .getByRole("button", { name: "Add pane to the right", exact: true })
    .click();
  await expect(preview.getByRole("tablist")).toHaveCount(1);
  await expect(preview.locator(".pane-toolbar")).toHaveCount(2);
  await expect(draft).toHaveValue("Keep this context");
  await preview.screenshot({ path: info.outputPath("one-tab-two-panes.png") });
  await options(preview, "New pane");
  await preview
    .getByRole("button", { name: "Close pane", exact: true })
    .click();
  await expect(preview.locator(".pane-toolbar")).toHaveCount(0);
  await expect(activeTabControl(preview)).toBeFocused();
  await expect(draft).toHaveValue("Keep this context");
  await preview.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(preview.getByRole("tab")).toHaveCount(2);
  await expect(preview.locator(".pane-toolbar, .layout-footer")).toHaveCount(0);
  await preview.screenshot({ path: info.outputPath("two-tabs-one-pane.png") });
  await preview
    .getByRole("tab", { name: "New conversation", exact: true })
    .click();
  await expect(draft).toHaveValue("Keep this context");
  await expect(
    preview.getByRole("button", { name: "All tabs", exact: true }),
  ).toHaveCount(0);
  await preview.getByRole("tab", { name: "New tab", exact: true }).click();
  await closeActiveTab(preview);

  await expect(preview.getByRole("tablist")).toHaveCount(1);
  await expect(activeTabControl(preview)).toBeFocused();
  await expect(draft).toHaveValue("Keep this context");
});

test("conversation model choices retain drafts, handle save outcomes and reset with the scenario", async ({
  page,
}) => {
  const preview = await open(page, "tabs-new-chat");
  const draft = preview.getByRole("textbox", { name: "Message", exact: true });
  const model = preview.getByRole("button", { name: /^Chat model:/ });
  await draft.fill("A draft before choosing a model");
  await model.click();
  await preview.locator('[data-choice="example-reasoning-long"]').click();
  await expect(draft).toBeFocused();
  await expect(model).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  const thinking = preview.getByRole("button", { name: /^Thinking level:/ });
  await expect(thinking).toHaveAccessibleName(
    "Thinking level: Medium. Workspace default",
  );
  await thinking.click();
  await preview
    .getByRole("menuitemradio", { name: "High", exact: true })
    .click();
  await expect(draft).toHaveValue("A draft before choosing a model");
  await expect(draft).toBeFocused();
  await model.click();
  await preview.locator('[data-choice="example-fast"]').click();
  await page
    .getByRole("button", {
      name: "Model save failed (confirmed unchanged)",
      exact: true,
    })
    .click();
  await expect(draft).toHaveValue("A draft before choosing a model");
  await expect(
    preview.getByRole("dialog", {
      name: "Model choice not saved",
      exact: true,
    }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Keep previous choice", exact: true })
    .click();
  await expect(draft).toBeFocused();
  await expect(thinking).toHaveText("High");
  await preview
    .locator(".desktop-sidebar")
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Model choice outcomes", exact: true }),
  ).toHaveCount(0);
  await backInActivePane(preview);
  await expect(thinking).toHaveText("High");
  await expect(draft).toHaveValue("A draft before choosing a model");
  await draft.press("Enter");
  await expect(preview.locator(".welcome")).toHaveCount(0);
  await expect(draft).toBeFocused();
  await expect(model).toBeEnabled();
  await expect(thinking).toBeEnabled();
  await thinking.click();
  await preview
    .getByRole("menuitemradio", { name: "Low", exact: true })
    .click();
  await expect(page.locator("[data-active-request]")).toContainText(
    "Thinking: high",
  );
  await model.click();
  await preview.locator('[data-choice="example-fast"]').click();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  await expect(model).toHaveText("Example Fast");
  await expect(thinking).toHaveCount(0);
  await expect(page.locator("[data-active-request]")).toContainText(
    "example-reasoning-long",
  );
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(model).toBeEnabled();
  await expect(page.locator("[data-active-request]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(model).toHaveAccessibleName(
    "Chat model: Example Chat. Workspace default",
  );
  await expect(draft).toHaveValue("");
  await expect(preview.locator(".welcome")).toBeVisible();
});

test("a lone mobile tab keeps one header row and adds a pane row only when split", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-empty");
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(
    preview.locator(
      ".mobile-pane-header, .tabs-bar, .pane-toolbar, .layout-footer",
    ),
  ).toHaveCount(0);
  await expect(activeTabControl(preview)).toHaveText("New tab");
  const shell = (await preview.locator(".topic-window").boundingBox())!;
  const header = (await preview.locator(".tab-header").boundingBox())!;
  const body = (await preview.locator(".pane-body").boundingBox())!;
  expect(body.y).toBe(header.y + header.height);
  expect(body.width).toBe(shell.width);
  expect(header.height).toBeLessThanOrEqual(60);
  await preview.screenshot({
    path: info.outputPath("lone-new-tab-mobile.png"),
  });
  await preview
    .locator(".view-chooser")
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await preview.emulateMedia({ reducedMotion: "reduce" });
  const draft = preview.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Keep this mobile draft");
  await page.getByLabel("Keyboard occlusion").check();
  await draft.focus();
  await expect(draft).toHaveValue("Keep this mobile draft");
  const area = (await preview.locator(".environment-content").boundingBox())!;
  const box = (await draft.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
  const model = preview.getByRole("button", { name: /^Chat model:/ });
  await model.click();
  const menu = preview.getByRole("menu", { name: "Chat model", exact: true });
  const bounds = (await menu.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.y + area.height);
  await preview.keyboard.press("Escape");
  await preview.screenshot({
    path: info.outputPath("lone-conversation-mobile-keyboard.png"),
  });
  await page.getByLabel("Keyboard occlusion").uncheck();
  await preview.setViewportSize({ width: 320, height: 540 });
  await expect(preview.locator(".topic-window")).toHaveJSProperty(
    "scrollWidth",
    320,
  );
  await options(preview, "New conversation");
  await preview
    .getByRole("button", { name: "Add pane below", exact: true })
    .click();
  await expect(preview.locator(".pane-pager")).toBeVisible();
  await expect(preview.locator(".mobile-tab-trigger")).toBeVisible();
  await options(preview, "New pane");
  await preview
    .getByRole("button", { name: "Close pane", exact: true })
    .click();
  await expect(preview.locator(".pane-pager")).toHaveCount(0);
  await expect(activeTabControl(preview)).toBeFocused();
  await expect(draft).toHaveValue("Keep this mobile draft");
  await preview
    .getByRole("button", { name: "Pane and tab actions", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "New tab", exact: true }).click();
  await expect(preview.locator(".mobile-tab-trigger")).toContainText("2 tabs");
  await expect(preview.locator(".mobile-pane-header")).toHaveCount(0);
});

test("additional views use a compact heading toggle and reset closed", async ({
  page,
}, info) => {
  const preview = await open(page);
  const sidebar = preview.locator(".desktop-sidebar");
  const more = sidebar.getByRole("button", { name: "More", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(
    sidebar
      .getByRole("button", { name: "Unpin Calendar", exact: true })
      .locator("svg"),
  ).toHaveAttribute("fill", "currentColor");
  await expect(
    sidebar.getByRole("group", { name: "More views", exact: true }),
  ).not.toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Files", exact: true }),
  ).not.toBeVisible();
  await expect(more).toHaveClass(/situate-button--ghost/);
  await expect(more).toHaveCSS("appearance", "none");
  await expect(more).toHaveCSS("border-top-width", "0px");
  await expect(more).toHaveCSS("box-shadow", "none");
  await expect(more).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(more).toHaveText("More");
  await expect(more).toHaveCSS(
    "font-family",
    await sidebar.evaluate((node) => getComputedStyle(node).fontFamily),
  );
  await preview.screenshot({
    path: info.outputPath("additional-views-rest.png"),
  });
  await more.hover();
  await preview.screenshot({
    path: info.outputPath("additional-views-hover.png"),
  });
  await preview.mouse.move(500, 500);
  const heading = sidebar.locator(".views-heading");
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await heading.boundingBox())!.height).toBe(44);
  const arrow = more.locator("svg");
  const closedTransform = await arrow.evaluate(
    (node) => getComputedStyle(node).transform,
  );
  await more.focus();
  await more.press("Enter");
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS("outline-width", "3px");
  await expect(more).toHaveCSS("outline-offset", "-3px");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(more.locator(".more-views-content")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const additionalViews = sidebar.getByRole("group", {
    name: "More views",
    exact: true,
  });
  await expect(additionalViews).toBeVisible();
  await expect(additionalViews.locator(".additional-views-label")).toHaveText(
    "More views",
  );
  await expect(
    additionalViews
      .getByRole("button", { name: "Pin Files", exact: true })
      .locator("svg"),
  ).toHaveAttribute("fill", "none");
  await expect(
    additionalViews.getByRole("button", { name: "Files", exact: true }),
  ).toBeVisible();
  await expect(
    additionalViews.getByRole("button", { name: "Calendar", exact: true }),
  ).toHaveCount(0);
  expect(
    await arrow.evaluate((node) => getComputedStyle(node).transform),
  ).not.toBe(closedTransform);
  await preview.screenshot({
    path: info.outputPath("additional-views-open.png"),
  });
  await more.press("Space");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await preview.screenshot({
    path: info.outputPath("additional-views-closed.png"),
  });
  await more.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "More", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await preview.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const enlarged = sidebar.getByRole("button", {
    name: "More",
    exact: true,
  });
  const enlargedBox = (await enlarged.boundingBox())!;
  const sidebarBox = (await sidebar.boundingBox())!;
  expect(enlargedBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
  expect(enlargedBox.x + enlargedBox.width).toBeLessThanOrEqual(
    sidebarBox.x + sidebarBox.width,
  );
  await enlarged.click();
  await expect(enlarged).toHaveAttribute("aria-expanded", "true");
  await preview.screenshot({
    path: info.outputPath("additional-views-large-text.png"),
  });
});

test("expanding additional views keeps navigation icons aligned when scrolling begins", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 1440, height: 640 });
  const sidebar = preview.locator(".desktop-sidebar");
  const scroller = sidebar.locator(".sidebar-content");
  await expect(scroller).toHaveCSS("overflow-y", "scroll");
  const overflows = () =>
    scroller.evaluate((node) => node.scrollHeight > node.clientHeight);
  expect(await overflows()).toBe(false);
  const icons = [
    sidebar.getByRole("button", { name: "Unpin Calendar", exact: true }),
    sidebar.getByRole("button", { name: "New conversation", exact: true }),
    sidebar.getByRole("button", {
      name: "Options for Garden chat",
      exact: true,
    }),
  ];
  const positions = await Promise.all(
    icons.map(async (icon) => (await icon.boundingBox())!.x),
  );
  const more = sidebar.getByRole("button", { name: "More", exact: true });
  const toggleX = (await more.boundingBox())!.x;
  await more.click();
  expect(await overflows()).toBe(true);
  for (const [index, icon] of icons.entries()) {
    expect((await icon.boundingBox())!.x).toBeCloseTo(positions[index]!, 1);
  }
  expect((await more.boundingBox())!.x).toBeCloseTo(toggleX, 1);
  await preview.screenshot({
    path: info.outputPath("additional-views-stable-scrollbar.png"),
  });
  await more.click();
  expect(await overflows()).toBe(false);
  for (const [index, icon] of icons.entries()) {
    expect((await icon.boundingBox())!.x).toBeCloseTo(positions[index]!, 1);
  }
});

test("all-pinned and no-pins navigation omit empty disclosures and retain pin focus", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-all-pins");
  const sidebar = preview.locator(".desktop-sidebar");
  await expect(sidebar.locator(".more-views")).toHaveCount(0);
  await expect(sidebar.locator(".destination")).toHaveCount(8);
  await preview.screenshot({ path: info.outputPath("all-views-pinned.png") });
  await sidebar
    .getByRole("button", { name: "Unpin Files", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "More", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    sidebar.getByRole("button", { name: "Pin Files", exact: true }),
  ).toBeFocused();
  await sidebar.getByRole("button", { name: "Pin Files", exact: true }).click();
  await expect(sidebar.locator(".more-views")).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: "Unpin Files", exact: true }),
  ).toBeFocused();
  await selectScenario(page, "tabs-no-pins");
  await expect(sidebar.locator(".more-views")).toHaveCount(0);
  await expect(sidebar.locator(".destination")).toHaveCount(8);
  await expect(
    sidebar.getByRole("button", { name: "Files", exact: true }),
  ).toBeVisible();
  await sidebar.getByRole("button", { name: "Pin Notes", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: "Unpin Notes", exact: true }),
  ).toBeFocused();
  await expect(
    sidebar.getByRole("button", { name: "More", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await preview.setViewportSize({ width: 320, height: 540 });
  await preview
    .getByRole("button", {
      name: "Workspace navigation: Field notes",
      exact: true,
    })
    .click();
  const drawer = preview.getByRole("dialog", {
    name: "Workspace navigation",
    exact: true,
  });
  const mobileMore = drawer.getByRole("button", {
    name: "More",
    exact: true,
  });
  await mobileMore.click();
  await expect(mobileMore).toHaveAttribute("aria-expanded", "true");
  const box = (await mobileMore.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await preview.screenshot({
    path: info.outputPath("additional-views-mobile.png"),
  });
});

test("workspace navigation and new tabs share pinned views and target the active pane", async ({
  page,
}, info) => {
  const preview = await open(page);
  const sidebar = preview.locator(".desktop-sidebar");
  await expect(sidebar).toBeVisible();
  const first = preview.locator(".pane-tile.active");
  const id = await first.getAttribute("data-pane");
  const ids = await preview
    .locator(".pane-tile")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-pane")),
    );
  await sidebar.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(first).toHaveAttribute("data-pane", id!);
  await expect(
    first.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("tab")).toHaveCount(3);
  expect(
    await preview
      .locator(".pane-tile")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-pane")),
      ),
  ).toEqual(ids);
  await expect(first.locator(".pane-title")).toBeFocused();
  await first
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(
    first.getByRole("heading", {
      name: "A weekend in the garden",
      exact: true,
    }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "New tab", exact: true }).click();
  const chooser = preview.locator(".view-chooser");
  await expect(chooser.locator(".choose-view")).toHaveText([
    "Calendar",
    "Tasks",
    "Notes",
  ]);
  await preview.screenshot({
    path: info.outputPath("new-tab-with-navigation.png"),
  });
  await sidebar
    .getByRole("button", { name: "Unpin Calendar", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Pin Calendar", exact: true }),
  ).toBeFocused();
  await expect(chooser.locator(".choose-view")).toHaveText(["Tasks", "Notes"]);
  await sidebar
    .getByRole("button", { name: "Pin My day", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Unpin My day", exact: true }),
  ).toBeFocused();
  await expect(chooser.locator(".choose-view")).toHaveText([
    "Tasks",
    "Notes",
    "My day",
  ]);
  await chooser.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(preview.getByRole("tab")).toHaveCount(4);
  await expect(preview.locator(".pane-tile")).toHaveCount(1);
  await expect(
    preview.getByRole("heading", { name: "Next steps", exact: true }),
  ).toBeVisible();
  await backInActivePane(preview);
  await chooser.getByRole("button", { name: "All views", exact: true }).click();
  await expect(chooser.locator(".choose-view")).toHaveCount(8);
  await preview.screenshot({
    path: info.outputPath("all-views-with-navigation.png"),
  });
  await chooser.getByRole("button", { name: "Pin Files", exact: true }).click();
  await chooser
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(chooser.locator(".choose-view")).toHaveText([
    "Tasks",
    "Notes",
    "My day",
    "Files",
  ]);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Unpin Calendar", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Unpin Files", exact: true }),
  ).toHaveCount(0);
});

test("new conversations keep independent drafts and survive navigation and tab closure", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-empty");
  const chooser = preview.locator(".view-chooser");
  await chooser
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(preview.getByRole("tab")).toHaveCount(1);
  await expect(activeTabControl(preview)).toHaveText("New conversation");
  const composer = preview.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await expect(composer).toHaveValue("");
  await expect(preview.locator(".user-message")).toHaveCount(0);
  await composer.fill("First conversation draft");
  const sidebar = preview.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: "Notes", exact: true }).click();
  await backInActivePane(preview);
  await expect(composer).toHaveValue("First conversation draft");
  await preview.getByRole("button", { name: "New tab", exact: true }).click();
  await chooser
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(composer).toHaveValue("");
  await composer.fill("Second conversation draft");
  await preview.screenshot({
    path: info.outputPath("new-conversation-with-navigation.png"),
  });
  await preview.getByRole("tab").first().click();
  await expect(composer).toHaveValue("First conversation draft");
  await closeActiveTab(preview);
  await expect(composer).toHaveValue("Second conversation draft");
  await sidebar
    .locator(".conversation-title")
    .filter({ hasText: "New conversation" })
    .first()
    .click();
  await expect(composer).toHaveValue("First conversation draft");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(preview.locator(".sent-message")).toHaveText(
    "YouFirst conversation draft",
  );
  await expect(preview.locator(".work-status")).toHaveText("Working");
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.locator(".work-status")).toHaveCount(0);
  await backInActivePane(preview);
  await expect(composer).toHaveValue("Second conversation draft");
});

test("mobile new tabs without pins retain a route to views and fresh conversations", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-no-pins");
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await preview.setViewportSize({ width: 390, height: 844 });
  const chooser = preview.locator(".view-chooser");
  await expect(preview.locator(".desktop-sidebar")).not.toBeVisible();
  await expect(preview.locator(".mobile-topbar")).toBeVisible();
  await expect(
    chooser.getByText("No pinned views yet.", { exact: true }),
  ).toBeVisible();
  await preview.screenshot({
    path: info.outputPath("new-tab-no-pins-mobile.png"),
  });
  await chooser.getByRole("button", { name: "All views", exact: true }).click();
  await chooser.getByRole("button", { name: "Pin Notes", exact: true }).click();
  await chooser
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(chooser.locator(".choose-view")).toHaveText(["Notes"]);
  await preview
    .getByRole("button", {
      name: "Workspace navigation: Field notes",
      exact: true,
    })
    .click();
  const navigation = preview.getByRole("dialog", {
    name: "Workspace navigation",
    exact: true,
  });
  await expect(
    navigation.getByRole("button", { name: "Unpin Notes", exact: true }),
  ).toBeVisible();
  await preview.screenshot({
    path: info.outputPath("pinned-navigation-mobile.png"),
  });
  await navigation.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(navigation).not.toBeVisible();
  await expect(activeTabControl(preview)).toHaveText("Notes");
  await expect(activeTabControl(preview)).toBeFocused();
  await preview
    .getByRole("button", {
      name: "Workspace navigation: Field notes",
      exact: true,
    })
    .click();
  await navigation
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(preview.locator(".mobile-tab-trigger")).toBeVisible();
  await expect(activeTabControl(preview)).toHaveText("New conversation");
  const composer = preview.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await composer.fill("A separate mobile draft");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(composer).toHaveValue("A separate mobile draft");
  const box = (await composer.boundingBox())!;
  const area = (await preview.locator(".environment-content").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
  await preview.screenshot({
    path: info.outputPath("new-conversation-mobile-keyboard.png"),
  });
  await page.getByLabel("Keyboard occlusion").uncheck();
  await preview.setViewportSize({ width: 320, height: 540 });
  await expect(composer).toHaveValue("A separate mobile draft");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    chooser.getByText("No pinned views yet.", { exact: true }),
  ).toBeVisible();
});

test("topic tabs preserve drafts, support optional names and keyboard navigation", async ({
  page,
}) => {
  const preview = await open(page);
  await preview
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep Saturday afternoon free");
  await preview.getByRole("tab", { name: "My week", exact: true }).click();
  await expect(preview.locator(".pane-tile")).toHaveCount(1);
  await preview
    .getByRole("tab", { name: "Garden weekend", exact: true })
    .click();
  await expect(
    preview.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep Saturday afternoon free");
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await preview.getByLabel("Tab name", { exact: true }).fill("Saturday");
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    preview.getByRole("tab", { name: "Saturday", exact: true }),
  ).toBeVisible();
  await preview.getByRole("tab", { name: "Saturday", exact: true }).focus();
  await preview.keyboard.press("ArrowRight");
  await expect(
    preview.getByRole("tab", { name: "My week", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press("Home");
  await expect(
    preview.getByRole("tab", { name: "Saturday", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await preview.getByLabel("Tab name", { exact: true }).fill("");
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    preview.getByRole("tab", { name: "Weekend plan", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(preview.getByLabel("Tab name", { exact: true })).toHaveValue(
    "Weekend plan",
  );
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await preview
    .getByRole("region", { name: "Pane: Weekend plan", exact: true })
    .locator(".pane-title")
    .focus();
  await navigateFromMenu(preview, "Files");
  await expect(
    preview.getByRole("tab", { name: "Files", exact: true }).first(),
  ).toHaveAttribute("aria-selected", "true");
});

test("nested panes split, resize, move and maximize without losing their arrangement", async ({
  page,
}, info) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  await preview.screenshot({ path: info.outputPath("tabs-desktop.png") });
  const originalIds = await preview
    .locator(".pane-tile")
    .evaluateAll((panes) => panes.map((p) => p.getAttribute("data-pane")));
  const divider = preview
    .locator('[role="separator"][aria-orientation="vertical"]')
    .first();
  const before = Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus();
  await preview.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", String(before + 5));
  const box = (await divider.boundingBox())!;
  await preview.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await preview.mouse.down();
  await preview.mouse.move(box.x - 70, box.y + box.height / 2);
  await preview.mouse.up();
  await expect(divider).not.toHaveAttribute(
    "aria-valuenow",
    String(before + 5),
  );
  await options(preview, "Garden chat");
  await preview
    .getByRole("button", { name: "Maximize pane", exact: true })
    .click();
  await expect(preview.locator(".pane-tile")).toHaveCount(1);
  await preview
    .getByRole("button", { name: "Restore arrangement", exact: true })
    .click();
  await expect(preview.locator(".pane-tile")).toHaveCount(3);
  await options(preview, "Garden chat");
  await preview.getByRole("button", { name: "Move pane", exact: true }).click();
  await selectOption(preview.getByLabel("Beside pane"), originalIds[0]!);
  await selectOption(preview.getByLabel("Position", { exact: true }), "top");
  await preview.screenshot({ path: info.outputPath("tabs-move.png") });
  await preview.getByRole("button", { name: "Move", exact: true }).click();
  expect(
    await preview
      .locator(".pane-tile")
      .evaluateAll((panes) => panes.map((p) => p.getAttribute("data-pane"))),
  ).toEqual([originalIds[2], originalIds[0], originalIds[1]]);
  await options(preview, "Tasks");
  await preview
    .getByRole("button", { name: "Add pane to the right", exact: true })
    .click();
  await expect(preview.locator(".pane-tile")).toHaveCount(4);
  await preview
    .locator(".view-chooser")
    .getByRole("button", { name: "All views", exact: true })
    .click();
  await preview
    .locator(".view-choices")
    .getByRole("button", { name: "Files", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "In this workspace" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("pane navigation has its own history and resets do not retain transient dialogs", async ({
  page,
}) => {
  const preview = await open(page);
  await navigateFromMenu(preview, "Files");
  const pane = preview.getByRole("region", {
    name: "Pane: Files",
    exact: true,
  });
  await pane
    .getByRole("button", { name: "Weekend plan.md", exact: true })
    .click();
  const note = preview.getByRole("region", {
    name: "Pane: Weekend plan",
    exact: true,
  });
  await note
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(
    preview.getByRole("region", { name: "Pane: Files", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("region", { name: "Pane: Garden chat", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await preview
    .getByLabel("Tab name", { exact: true })
    .fill("Unfinished rename");
  await page.getByRole("button", { name: "Reset scenario" }).click();
  await expect(preview.locator("dialog[open]")).toHaveCount(0);
  await expect(
    preview.getByRole("tab", { name: "Garden weekend", exact: true }),
  ).toBeVisible();
});

test("narrow presentations retain drafts and restore tiled panes", async ({
  page,
}, info) => {
  const preview = await open(page);
  const chat = preview.getByRole("textbox", { name: "Message", exact: true });
  await chat.fill("My draft");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.locator(".pane-tile")).toHaveCount(1);
  await expect(chat).toHaveValue("My draft");
  await expect(chat).toBeFocused();
  await preview.screenshot({ path: info.outputPath("tabs-mobile.png") });
  await preview.locator('.pane-pager [aria-current="true"]').focus();
  await preview.keyboard.press("Home");
  await expect(
    preview.getByRole("heading", { name: "A weekend in the garden" }),
  ).toBeVisible();
  await preview.keyboard.press("End");
  await preview.setViewportSize({ width: 320, height: 540 });
  await expect(chat).toHaveValue("My draft");
  expect(
    await preview
      .locator(".topic-window")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await chat.focus();
  await preview.setViewportSize({ width: 1440, height: 920 });
  await expect(preview.locator(".pane-tile")).toHaveCount(3);
  await expect(chat).toHaveValue("My draft");
  await expect(chat).toBeFocused();
});

test("mobile pane titles reveal neighbors and support taps and bounded swipes", async ({
  page,
  browserName,
}, info) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  const pager = preview.getByRole("group", { name: "Panes", exact: true });
  const currentButton = pager.locator('[aria-current="true"]');
  const current = currentButton.locator("span");
  await expect(
    preview.getByRole("combobox", { name: "Panes", exact: true }),
  ).toHaveCount(0);
  await expect(current).toHaveText("Weekend plan");
  await expect(pager.locator(".pager-position")).toContainText("1/3");
  const box = (await pager.locator(".pager-viewport").boundingBox())!;
  const expectCentered = () =>
    expect
      .poll(async () => {
        const bounds = (await currentButton.boundingBox())!;
        return Math.abs(bounds.x + bounds.width / 2 - box.x - box.width / 2);
      })
      .toBeLessThan(1);
  await expectCentered();
  const neighbor = await pager
    .getByRole("button", { name: "Tasks · 2 of 3", exact: true })
    .boundingBox();
  expect(neighbor!.x).toBeLessThan(box.x + box.width);
  expect(neighbor!.x + neighbor!.width).toBeGreaterThan(box.x + box.width);
  await preview.mouse.click(box.x + box.width - 20, box.y + 22);
  await expect(current).toHaveText("Tasks");
  await expectCentered();
  await preview.screenshot({ path: info.outputPath("pane-pager-mobile.png") });
  const swipe = async (distance: number) => {
    await preview.mouse.move(box.x + box.width / 2, box.y + 22);
    await preview.mouse.down();
    await preview.mouse.move(box.x + box.width / 2 + distance, box.y + 22, {
      steps: 8,
    });
    await preview.mouse.up();
  };
  await swipe(-100);
  await expect(current).toHaveText("Garden chat");
  await swipe(-100);
  await expect(current).toHaveText("Garden chat");
  await swipe(100);
  await expect(current).toHaveText("Tasks");
  await swipe(100);
  await expect(current).toHaveText("Weekend plan");
  await swipe(100);
  await expect(current).toHaveText("Weekend plan");
  if (browserName === "chromium") {
    const touch = await preview.context().newCDPSession(preview);
    const x = box.x + box.width / 2,
      y = box.y + 22;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 8; step++)
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x - step * 12, y }],
      });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(current).toHaveText("Tasks");
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - 100, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect(current).toHaveText("Tasks");
    await touch.detach();
  }
  await preview.locator(".mobile-tab-trigger").click();
  await preview
    .getByRole("dialog")
    .locator(".tab-sheet-select")
    .filter({ hasText: "My week" })
    .click();
  await expect(pager).toHaveCount(0);
});

test("pane swipes follow the pointer, cancel safely and do not capture content gestures", async ({
  page,
}) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  const viewport = preview.locator(".pager-viewport");
  const track = preview.locator(".pager-track");
  const currentButton = preview.locator('.pane-pager [aria-current="true"]');
  const current = currentButton.locator("span");
  const box = (await viewport.boundingBox())!;
  const begin = async (dx: number, dy = 0) => {
    await preview.mouse.move(box.x + box.width / 2, box.y + 22);
    await preview.mouse.down();
    await preview.mouse.move(box.x + box.width / 2 + dx, box.y + 22 + dy, {
      steps: 6,
    });
  };
  const initial = await track.getAttribute("style");
  await begin(-90);
  await expect(viewport).toHaveClass(/dragging/);
  expect(await track.getAttribute("style")).not.toBe(initial);
  await viewport.dispatchEvent("pointercancel");
  await preview.mouse.up();
  await expect(current).toHaveText("Weekend plan");
  await expect(track).toHaveAttribute("style", initial!);
  await begin(-15);
  await preview.mouse.up();
  await expect(current).toHaveText("Weekend plan");
  await begin(-10, 50);
  await preview.mouse.up();
  await expect(current).toHaveText("Weekend plan");
  const body = (await preview.locator(".pane-body").boundingBox())!;
  await preview.mouse.move(body.x + 180, body.y + 60);
  await preview.mouse.down();
  await preview.mouse.move(body.x + 50, body.y + 60, { steps: 6 });
  await preview.mouse.up();
  await expect(current).toHaveText("Weekend plan");
  await begin(-90);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await preview.mouse.up();
  await expect(current).toHaveText("Weekend plan");
  await expect(viewport).not.toHaveClass(/dragging/);
  await currentButton.focus();
  await preview.keyboard.press("ArrowRight");
  await expect(current).toHaveText("Tasks");
  await expect(currentButton).toBeFocused();
  await preview.keyboard.press("End");
  await expect(current).toHaveText("Garden chat");
  await preview.keyboard.press("Home");
  await expect(current).toHaveText("Weekend plan");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(track).toHaveCSS("transition-duration", "0s");
});

test("desktop tab close and bulk actions preserve selection and reset to a fresh empty tab", async ({
  page,
}, info) => {
  const preview = await open(page);
  const selected = preview.getByRole("tab", { selected: true });
  const selectedId = await selected.getAttribute("id");
  const inactive = preview.locator(".topic-tab").filter({
    has: preview.getByRole("tab", { name: "My week", exact: true }),
  });
  await preview.mouse.move(0, 900);
  for (const close of await preview.locator(".topic-tab .tab-close").all()) {
    await expect(close).toHaveCSS("opacity", "1");
    await expect(close).toHaveCSS("pointer-events", "auto");
    await expectCenteredCloseIcon(close);
  }
  const tabWidth = (await inactive.boundingBox())!.width;
  await preview.screenshot({ path: info.outputPath("tabs-close-visible.png") });
  await inactive.hover();
  expect((await inactive.boundingBox())!.width).toBe(tabWidth);
  await expect(inactive.locator(".tab-close")).toHaveCSS("opacity", "1");
  await inactive.locator(".tab-close").hover();
  await expectCenteredCloseIcon(inactive.locator(".tab-close"));
  await expectCenteredCloseIcon(
    preview.locator(".topic-tab.selected .tab-close"),
  );
  await inactive
    .getByRole("button", { name: "Close tab: My week", exact: true })
    .click();
  await expect(selected).toHaveAttribute("id", selectedId!);
  await expect(selected).toBeFocused();
  await expect(preview.getByRole("tab")).toHaveCount(2);
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await expect(
    preview.getByRole("menuitem", { name: "Close tab", exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("menuitem", { name: "Close other tabs", exact: true })
    .click();
  await expect(preview.getByRole("tab")).toHaveCount(1);
  await expect(selected).toHaveAttribute("id", selectedId!);
  await selected.focus();
  await preview.keyboard.press("Tab");
  await expect(preview.locator(".tab-close")).toBeFocused();
  await expect(preview.locator(".tab-close")).toHaveCSS("opacity", "1");
  await preview.keyboard.press("Enter");
  await expect(preview.getByRole("tab")).toHaveCount(1);
  await expect(preview.getByRole("tab")).not.toHaveAttribute("id", selectedId!);
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await expect(
    preview.getByRole("menuitem", { name: "Close other tabs", exact: true }),
  ).toBeDisabled();
  const emptyId = await preview.getByRole("tab").getAttribute("id");
  await preview
    .getByRole("menuitem", { name: "Close all tabs", exact: true })
    .click();
  await expect(preview.getByRole("tab")).not.toHaveAttribute("id", emptyId!);
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
});

test.describe("touch tab strip", () => {
  test.use({ hasTouch: true });
  test("close controls stay visible without hover and preserve the active tab", async ({
    page,
  }) => {
    const preview = await open(page);
    const selectedId = await preview
      .getByRole("tab", { selected: true })
      .getAttribute("id");
    const close = preview.getByRole("button", {
      name: "Close tab: My week",
      exact: true,
    });
    await expect(close).toHaveCSS("opacity", "1");
    await expect(close).toHaveCSS("width", "44px");
    await expect(close).toHaveCSS("height", "44px");
    await expectCenteredCloseIcon(close);
    await close.tap();
    await expect(preview.getByRole("tab")).toHaveCount(2);
    await expect(preview.getByRole("tab", { selected: true })).toHaveAttribute(
      "id",
      selectedId!,
    );
  });
});

test("narrow bulk close leaves an ordinary empty tab", async ({ page }) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await expect(
    preview.getByRole("menuitem", { name: "Close tab", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("menuitem", { name: "Close other tabs", exact: true })
    .click();
  await expect(preview.locator(".mobile-tab-trigger")).not.toContainText(
    "tabs",
  );
  await preview
    .getByRole("button", { name: "Tab options", exact: true })
    .click();
  await expect(
    preview.getByRole("menuitem", { name: "Close other tabs", exact: true }),
  ).toBeDisabled();
  await preview
    .getByRole("menuitem", { name: "Close all tabs", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Pane and tab actions", exact: true })
    .click();
  await preview
    .getByRole("menuitem", { name: "Close tab", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
});

test("tab action menus support keyboard navigation, dismissal and reset", async ({
  page,
}) => {
  const preview = await open(page);
  const trigger = preview.getByRole("button", {
    name: "Tab options",
    exact: true,
  });
  const menu = preview.getByRole("menu", { name: "Tab options", exact: true });
  const rename = menu.getByRole("menuitem", { name: "Rename", exact: true });
  const close = menu.getByRole("menuitem", {
    name: "Close all tabs",
    exact: true,
  });
  const others = menu.getByRole("menuitem", {
    name: "Close other tabs",
    exact: true,
  });
  await trigger.focus();
  await preview.keyboard.press("ArrowDown");
  await expect(rename).toBeFocused();
  await expect(rename).toHaveCSS("display", "flex");
  await expect(rename).toHaveCSS("min-height", "44px");
  await expect(rename).toHaveCSS("outline-width", "3px");
  await preview.keyboard.press("ArrowDown");
  await expect(others).toBeFocused();
  await preview.keyboard.press("ArrowDown");
  await expect(close).toBeFocused();
  await preview.keyboard.press("ArrowDown");
  await expect(rename).toBeFocused();
  await preview.keyboard.press("End");
  await expect(close).toBeFocused();
  await preview.keyboard.press("Home");
  await expect(rename).toBeFocused();
  await preview.keyboard.press("c");
  await expect(others).toBeFocused();
  await preview.keyboard.press("c");
  await expect(close).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await preview.keyboard.press("ArrowUp");
  await expect(close).toBeFocused();
  await preview.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  await trigger.click();
  await trigger.click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await preview.setViewportSize({ width: 1200, height: 820 });
  await expect(menu).toBeInViewport();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1200);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(820);
  await rename.click();
  await expect(preview.getByLabel("Tab name", { exact: true })).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await preview.getByRole("tab", { name: "My week", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(
    preview.getByRole("tab", { name: "My week", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await trigger.click();
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(menu).toHaveCount(0);
  await expect(preview.locator(".mobile-tab-trigger")).toBeFocused();
  await preview.setViewportSize({ width: 1440, height: 920 });
  await trigger.click();
  await expect(menu).toBeVisible();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(menu).toHaveCount(0);
});

test("mobile tab renaming stays compact and returns to the overview without selecting the tab", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  const active = preview.locator(".mobile-tab-trigger");
  await active.click();
  const overview = preview.getByRole("dialog", {
    name: "All tabs",
    exact: true,
  });
  const options = overview.getByRole("button", {
    name: "Tab options: My week",
    exact: true,
  });
  await options.click();
  const menu = overview.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Rename", "Close tab"]);
  await preview.screenshot({ path: info.outputPath("mobile-tab-actions.png") });
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = preview.getByRole("dialog", {
    name: "Rename tab",
    exact: true,
  });
  const input = rename.getByRole("textbox", { name: "Tab name", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("My week");
  await expect(rename.locator("p")).toHaveCount(0);
  await expect(
    rename.getByRole("button", { name: "Close tab", exact: true }),
  ).toHaveCount(0);
  expect((await rename.boundingBox())!.height).toBeLessThanOrEqual(240);
  await preview.screenshot({ path: info.outputPath("mobile-rename-tab.png") });
  await input.fill("Unfinished name");
  await rename.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(overview).toBeVisible();
  await expect(options).toBeFocused();
  await expect(active).toContainText("Garden weekend");
  await options.click();
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(input).toHaveValue("My week");
  await rename.getByRole("button", { name: "Close", exact: true }).click();
  await expect(options).toBeFocused();
  await options.press("ArrowDown");
  await menu
    .getByRole("menuitem", { name: "Rename", exact: true })
    .press("Enter");
  await input.fill("Next week");
  await input.press("Enter");
  await expect(
    overview.getByRole("button", {
      name: "Tab options: Next week",
      exact: true,
    }),
  ).toBeFocused();
  await expect(active).toContainText("Garden weekend");
  for (const title of ["Files", "Next week", "Garden weekend"]) {
    await overview
      .getByRole("button", { name: `Tab options: ${title}`, exact: true })
      .click();
    const bounds = (await menu.boundingBox())!;
    const sheet = (await overview.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(sheet.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      sheet.y + sheet.height,
    );
    await menu
      .getByRole("menuitem", { name: "Close tab", exact: true })
      .click();
    await expect(overview).toBeVisible();
  }
  await expect(overview.locator(".tab-sheet-row")).toHaveCount(1);
  await expect(overview.locator(".tab-sheet-select")).toContainText("New tab");
  const create = overview.getByRole("button", { name: "New tab", exact: true });
  await expect(create).toBeFocused();
  await create.click();
  await expect(
    preview.getByRole("heading", {
      name: "What would you like here?",
      exact: true,
    }),
  ).toBeVisible();
});

test("tab action menus stay inside a scrolled narrow overview", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-many");
  await preview.setViewportSize({ width: 320, height: 540 });
  await preview.locator(".mobile-tab-trigger").click();
  const overview = preview.getByRole("dialog", {
    name: "All tabs",
    exact: true,
  });
  const trigger = overview.locator(".tab-actions-trigger").last();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const menu = overview.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = (await menu.boundingBox())!;
  const sheet = (await overview.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(sheet.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(sheet.x + sheet.width);
  expect(bounds.y).toBeGreaterThanOrEqual(sheet.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(sheet.y + sheet.height);
  await preview.screenshot({
    path: info.outputPath("mobile-overflow-tab-actions.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(overview).toBeVisible();
  await trigger.click();
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await preview.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await overview.evaluate((element) => element.scrollTo(0, 0));
  await expect(menu).toHaveCount(0);
});

test("tab overview uses the shared dialog hierarchy with long and sparse content", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  const trigger = preview.locator(".mobile-tab-trigger");
  await trigger.click();
  const overview = preview.getByRole("dialog", {
    name: "All tabs",
    exact: true,
  });
  for (const title of ["My week", "Files"]) {
    await overview
      .getByRole("button", { name: `Tab options: ${title}`, exact: true })
      .click();
    await overview
      .getByRole("menuitem", { name: "Close tab", exact: true })
      .click();
  }
  await overview
    .getByRole("button", { name: "Tab options: Garden weekend", exact: true })
    .click();
  await overview.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const longTitle =
    "Community garden plans, seasonal observations and preparations for next spring";
  await preview
    .getByRole("textbox", { name: "Tab name", exact: true })
    .fill(longTitle);
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await expect(overview).toBeVisible();
  await expect(overview.locator(".tab-sheet-row")).toHaveCount(1);
  await expect(overview.locator(".tab-sheet-current")).toBeVisible();
  const title = overview.getByRole("heading", { level: 2 });
  const create = overview.getByRole("button", { name: "New tab", exact: true });
  const reopen = overview.getByRole("button", {
    name: "Reopen closed tab",
    exact: true,
  });
  await expect(reopen).toBeVisible();

  for (const width of [1440, 390, 320]) {
    await preview.setViewportSize({ width, height: 844 });
    await expectDialogTitle(title);
    await expect(overview.locator(".tab-sheet-title")).toHaveCSS(
      "font-size",
      "14px",
    );
    await expect(overview.locator(".tab-sheet-title")).toHaveCSS(
      "font-weight",
      "600",
    );
    await expect(create).toHaveCSS("font-size", "14px");
    const header = (await overview
      .locator(".situate-dialog__header")
      .boundingBox())!;
    const row = (await overview.locator(".tab-sheet-row").boundingBox())!;
    expect(row.y - header.y - header.height).toBeCloseTo(16, 0);
    expect(row.height).toBeLessThan(140);
    const name = (await overview.locator(".tab-sheet-title").boundingBox())!;
    const meta = (await overview.locator(".tab-sheet-meta").boundingBox())!;
    expect(meta.x).toBeCloseTo(name.x, 1);
    expect((await reopen.boundingBox())!.y).toBeGreaterThan(row.y + row.height);
    expect(
      await overview.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await preview.screenshot({
      path: info.outputPath(`all-tabs-sparse-${width}.png`),
    });
  }
  await reopen.click();
  await expect(overview).not.toBeVisible();
  await expect(trigger).toContainText("Files");
  await trigger.click();
  await expect(overview.locator(".tab-sheet-row")).toHaveCount(2);
  await overview.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
});

for (const width of [1440, 320]) {
  test(`tab overview keeps long lists usable at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "tabs-many");
    await preview.setViewportSize({ width: 390, height: 540 });
    await preview.locator(".mobile-tab-trigger").click();
    await preview.setViewportSize({ width, height: 540 });
    const overview = preview.getByRole("dialog", {
      name: "All tabs",
      exact: true,
    });
    await expectDialogTitle(overview.getByRole("heading", { level: 2 }));
    const bounds = (await overview.boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(540);
    expect(
      await overview.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await preview.screenshot({
      path: info.outputPath(`all-tabs-many-${width}.png`),
    });
    const create = overview.getByRole("button", {
      name: "New tab",
      exact: true,
    });
    await create.focus();
    await expect(create).toBeInViewport();
    await create.press("Enter");
    await expect(overview).not.toBeVisible();
    await expect(
      preview.getByRole("heading", {
        name: "What would you like here?",
        exact: true,
      }),
    ).toBeVisible();
  });
}

test("compact mobile chrome keeps content below two rows and manages tabs in a bottom sheet", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  const trigger = preview.locator(".mobile-tab-trigger");
  await expect(trigger).toContainText("Garden weekend");
  await expect(trigger).toContainText("3 tabs");
  await expect(
    preview.locator(".tabs-bar, .pane-toolbar, .layout-footer"),
  ).toHaveCount(0);
  const top = (await preview.locator(".topic-window").boundingBox())!.y;
  const content = (await preview.locator(".pane-body").boundingBox())!;
  expect(content.y - top).toBeLessThanOrEqual(96);
  await expect
    .poll(async () => {
      const button = (await preview
        .locator('.pane-pager [aria-current="true"]')
        .boundingBox())!;
      const strip = (await preview.locator(".pager-viewport").boundingBox())!;
      return Math.abs(button.x + button.width / 2 - strip.x - strip.width / 2);
    })
    .toBeLessThan(1);
  await preview.screenshot({ path: info.outputPath("compact-mobile.png") });
  await trigger.click();
  const sheet = preview.getByRole("dialog", { name: "All tabs", exact: true });
  const bounds = (await sheet.boundingBox())!;
  expect(bounds.y + bounds.height).toBeCloseTo(844, 0);
  expect(bounds.width).toBe(390);
  await preview.screenshot({ path: info.outputPath("mobile-tab-sheet.png") });
  await sheet
    .getByRole("button", { name: "Tab options: My week", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await preview.getByLabel("Tab name", { exact: true }).fill("Next week");
  await preview.getByRole("button", { name: "Save", exact: true }).click();
  await expect(trigger).toContainText("Garden weekend");
  await expect(
    sheet.getByRole("button", { name: "Tab options: Next week", exact: true }),
  ).toBeFocused();
  await sheet
    .locator(".tab-sheet-select")
    .filter({ hasText: "Next week" })
    .click();
  await expect(trigger).toContainText("Next week");
  await expect(preview.locator(".mobile-pane-header")).toHaveCount(0);
  await expect(
    preview.getByRole("heading", { name: "Next steps", exact: true }),
  ).toBeVisible();
  await trigger.click();
  await sheet.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(trigger).toContainText("4 tabs");
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
  await trigger.click();
  await sheet
    .getByRole("button", { name: "Tab options: New tab", exact: true })
    .click();
  await preview
    .getByRole("menuitem", { name: "Close tab", exact: true })
    .click();
  await expect(trigger).toContainText("3 tabs");
  await preview.setViewportSize({ width: 320, height: 540 });
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(
    await preview
      .locator(".topic-window")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await preview
    .getByRole("button", {
      name: "Workspace navigation: Field notes",
      exact: true,
    })
    .click();
  await expect(
    preview.getByRole("dialog", { name: "Workspace navigation", exact: true }),
  ).toBeVisible();
});

test("mobile pane history stays visible and sheets fit keyboard space", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await expect(
    preview.getByRole("button", { name: "Back in this pane", exact: true }),
  ).toBeDisabled();
  await navigateFromMenu(preview, "Files");
  await preview.locator('.pane-pager [aria-current="true"]').focus();
  await preview.keyboard.press("ArrowRight");
  await expect(
    preview.getByRole("button", { name: "Back in this pane", exact: true }),
  ).toBeDisabled();
  await preview.keyboard.press("Home");
  await expect(
    preview.getByRole("button", { name: "Back in this pane", exact: true }),
  ).toBeEnabled();
  await preview
    .getByRole("button", { name: "Back in this pane", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "A weekend in the garden" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Forward in this pane", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "In this workspace" }),
  ).toBeVisible();
  const trigger = preview.locator(".mobile-tab-trigger");
  await trigger.click();
  await preview
    .getByRole("button", { name: "Tab options: Garden weekend", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await preview.getByLabel("Tab name", { exact: true }).fill("Weekend");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(preview.getByLabel("Tab name", { exact: true })).toHaveValue(
    "Weekend",
  );
  const envelope = (await preview
    .locator(".environment-content")
    .boundingBox())!;
  const bounds = (await preview.getByRole("dialog").boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(envelope.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    envelope.y + envelope.height + 1,
  );
  await preview.screenshot({
    path: info.outputPath("mobile-tab-name-keyboard.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(
    preview.getByRole("dialog", { name: "All tabs", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", {
      name: "Tab options: Garden weekend",
      exact: true,
    }),
  ).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Garden weekend");
});

test("mobile pane actions preserve focus and respect keyboard occlusion", async ({
  page,
}, info) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await options(preview, "Weekend plan");
  await preview
    .getByRole("button", { name: "Add pane below", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
  await expect(
    preview.locator('.pane-pager [aria-current="true"]'),
  ).toBeFocused();
  await preview
    .locator(".view-chooser")
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const chat = preview.getByRole("textbox", { name: "Message", exact: true });
  await chat.fill("A phone draft");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(chat).toHaveValue("A phone draft");
  const box = (await chat.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(844 - 260);
  await preview.screenshot({ path: info.outputPath("tabs-keyboard.png") });
  await page.getByLabel("Keyboard occlusion").uncheck();
  await expect(chat).toHaveValue("A phone draft");
  await expect(preview.locator(".mobile-tab-trigger")).toBeVisible();
});

test("topic activity survives pane navigation and settings round trips retain work", async ({
  page,
}) => {
  const preview = await open(page);
  await selectOption(
    page.getByLabel("Garden conversation", { exact: true }),
    "working",
  );
  await preview
    .getByRole("region", { name: "Pane: Garden chat", exact: true })
    .getByRole("textbox")
    .focus();
  await navigateFromMenu(preview, "Files");
  await expect(
    preview.getByRole("tab", { name: "Garden weekend Working", exact: true }),
  ).toBeVisible();
  await preview.getByRole("tab", { name: "My week", exact: true }).click();
  await expect(preview.locator(".layout-footer")).toHaveCount(0);
  await preview
    .getByRole("tab", { name: "Garden weekend Working", exact: true })
    .click();
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await preview
    .getByRole("button", { name: "Back to tabs", exact: true })
    .click();
  await expect(
    preview.getByRole("tab", { name: "Garden weekend Working", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    preview.getByRole("region", { name: "Pane: Files", exact: true }),
  ).toBeVisible();
});

test("divider limits match geometry and pointer dragging repositions a pane", async ({
  page,
}) => {
  const preview = await open(page);
  const divider = preview
    .locator('[role="separator"][aria-orientation="vertical"]')
    .first();
  await divider.focus();
  await preview.keyboard.press("End");
  await expect(divider).toHaveAttribute(
    "aria-valuenow",
    (await divider.getAttribute("aria-valuemax"))!,
  );
  await expect
    .poll(async () =>
      divider.evaluate((element) => {
        const parent = element.parentElement!.getBoundingClientRect();
        return Math.round(
          ((element.getBoundingClientRect().x - parent.x) /
            (parent.width - 10)) *
            100,
        );
      }),
    )
    .toBe(Number(await divider.getAttribute("aria-valuemax")));
  const box = (await divider.boundingBox())!;
  await preview.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await divider.boundingBox())!.x)
    .toBeLessThan(box.x - 20);
  const panes = preview.locator(".pane-tile");
  const ids = await panes.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-pane")),
  );
  const handle = preview
    .getByRole("region", { name: "Pane: Garden chat", exact: true })
    .locator(".pane-grip");
  const source = (await handle.boundingBox())!;
  const destination = (await panes.first().boundingBox())!;
  await preview.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await preview.mouse.down();
  await preview.mouse.move(source.x - 20, source.y + 10, { steps: 5 });
  await preview.mouse.move(
    destination.x + destination.width / 2,
    destination.y + 100,
    { steps: 5 },
  );
  await expect(preview.locator(".drop-top").first()).toBeVisible();
  const drop = (await preview.locator(".drop-top").first().boundingBox())!;
  await preview.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2);
  await preview.mouse.up();
  await expect
    .poll(async () => panes.first().getAttribute("data-pane"))
    .toBe(ids[2]);
  await expect(preview.locator(".drop-targets")).toHaveCount(0);
});

test("empty, loading, unavailable and overflowing tabs remain reachable", async ({
  page,
}, info) => {
  const preview = await open(page, "tabs-empty");
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
  await preview
    .locator(".view-choices")
    .getByRole("button", { name: "Notes", exact: true })
    .click();
  await selectOption(page.getByLabel(/Active pane ·/), "loading");
  await expect(preview.getByRole("status")).toHaveText("Opening view…");
  await selectOption(page.getByLabel(/Active pane ·/), "unavailable");
  await expect(
    preview.getByRole("heading", { name: "This view isn’t available" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Open a view", exact: true })
    .click();
  await closeActiveTab(preview);
  await expect(
    preview.getByRole("heading", { name: "What would you like here?" }),
  ).toBeVisible();
  await selectScenario(page, "tabs-many");
  await preview.getByRole("button", { name: /All tabs/ }).click();
  const long = preview
    .getByRole("dialog")
    .locator(".tab-sheet-select")
    .filter({ hasText: /community garden · 16/ });
  await long.scrollIntoViewIfNeeded();
  await long.click();
  await expect(
    preview.getByRole("tab", { name: /community garden · 16/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(preview.locator(".tab-header")).toHaveCount(1);
  await expect(
    preview.getByRole("button", { name: "All tabs", exact: true }),
  ).toBeVisible();
  const close = preview.locator(".topic-tab.selected .tab-close");
  await expect(close).toHaveCSS("opacity", "1");
  await expect
    .poll(async () => {
      const button = (await close.boundingBox())!;
      const strip = (await preview.locator(".topic-tabs").boundingBox())!;
      return (
        button.x >= strip.x && button.x + button.width <= strip.x + strip.width
      );
    })
    .toBe(true);
  await preview.screenshot({ path: info.outputPath("tabs-overflow.png") });
});
