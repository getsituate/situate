import { selectOption } from "./select";
import { expect, test } from "./test";
import type { Page } from "@playwright/test";

async function open(page: Page, scenario = "chat-complete") {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  await expect(model(preview)).toBeVisible();
  return preview;
}
const model = (page: Page) =>
  page.getByRole("button", { name: /^Chat model:/ });
const thinking = (page: Page) =>
  page.getByRole("button", { name: /^Thinking level:/ });
const fixture = (page: Page, value: string) =>
  selectOption(page.getByLabel("Model choice example", { exact: true }), value);
async function choose(preview: Page, id: string) {
  await model(preview).click();
  await preview.locator(`[data-choice="${id}"]`).click();
}
const saved = (page: Page) =>
  page.getByRole("button", { name: "Model choice saved", exact: true }).click();
const issue = (page: Page) => page.locator(".issue-dialog");
const issueTrigger = (page: Page) =>
  page.getByRole("button", { name: /^Model issue:/ });
async function singleRow(preview: Page) {
  const region = (await preview.locator(".chat-model-choice").boundingBox())!;
  const row = (await preview.locator(".composer-meta").boundingBox())!;
  expect(Math.abs(region.height - row.height)).toBeLessThan(1);
  await expect(preview.locator(".model-status, .model-recovery")).toHaveCount(
    0,
  );
}
async function silentBusy(preview: Page) {
  await expect(preview.locator(".chat-choices")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(model(preview)).toBeDisabled();
  await expect(issue(preview)).not.toBeVisible();
  await expect(issueTrigger(preview)).toHaveCount(0);
  await expect(
    preview.locator('.chat-model-choice > [role="status"]'),
  ).toHaveClass("sr-only");
  expect(
    await preview
      .locator(".chat-model-choice [title]")
      .evaluateAll((nodes) =>
        nodes.some((node) =>
          /loading models|saving model choice|checking the selected/i.test(
            node.getAttribute("title") || "",
          ),
        ),
      ),
  ).toBe(false);
  await singleRow(preview);
}
async function issueAboveRow(preview: Page) {
  await expect
    .poll(async () => {
      const popup = await issue(preview).boundingBox();
      const row = await preview.locator(".chat-choices").boundingBox();
      return !!popup && !!row && popup.y + popup.height <= row.y;
    })
    .toBe(true);
  const popup = (await issue(preview).boundingBox())!;
  const row = (await preview.locator(".chat-choices").boundingBox())!;
  const area = (await preview.locator(".chat-screen").boundingBox())!;
  expect(popup.y + popup.height).toBeLessThanOrEqual(row.y);
  expect(popup.y).toBeGreaterThanOrEqual(area.y);
  expect(popup.x).toBeGreaterThanOrEqual(area.x);
  expect(popup.x + popup.width).toBeLessThanOrEqual(area.x + area.width);
  for (const button of await issue(preview).getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(popup.y);
    expect(box.y + box.height).toBeLessThanOrEqual(popup.y + popup.height);
  }
  await singleRow(preview);
}

test("separate model and thinking menus preserve drafts and allow next-request choices during active runs", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  const draft = preview.getByLabel("Message", { exact: true });
  const history = await preview.locator(".chat-thread").innerText();
  await draft.fill("Keep this draft");
  await expect(thinking(preview)).toHaveCount(0);
  await model(preview).focus();
  await preview.keyboard.press("Enter");
  const menu = preview.getByRole("menu", { name: "Chat model", exact: true });
  await expect(preview.locator('[data-choice=""]')).toBeFocused();
  await expect(menu.getByRole("menuitemradio")).toHaveCount(5);
  await expect(preview.getByRole("searchbox")).toHaveCount(0);
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await preview.keyboard.press("ArrowDown");
  await expect(preview.locator('[data-choice="example-chat"]')).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(model(preview)).toBeFocused();
  await expect(menu).not.toBeVisible();
  await choose(preview, "example-reasoning-long");
  await expect(draft).toBeFocused();
  await expect(model(preview)).toBeDisabled();
  await saved(page);
  await expect(thinking(preview)).toHaveAccessibleName(
    "Thinking level: Medium. Workspace default",
  );
  await thinking(preview).click();
  await expect(
    preview
      .getByRole("menu", { name: "Thinking level", exact: true })
      .getByRole("menuitemradio")
      .locator(":scope > .option-copy"),
  ).toHaveText([
    /↳\s*Workspace default\s*Recommended · Medium/,
    /☆\s*Recommended\s*Medium/,
    "Low",
    "Medium",
    "High",
  ]);
  await preview.keyboard.press("End");
  await preview.keyboard.press("Enter");
  await expect(thinking(preview)).toHaveText("High");
  await expect(draft).toBeFocused();
  await choose(preview, "example-fast");
  await expect(thinking(preview)).toBeDisabled();
  await saved(page);
  await expect(thinking(preview)).toHaveCount(0);
  await choose(preview, "example-reasoning-long");
  await saved(page);
  await expect(thinking(preview)).toHaveText("High");
  await expect(draft).toHaveValue("Keep this draft");
  expect(await preview.locator(".chat-thread").innerText()).toBe(history);
  await selectOption(
    page.getByLabel("Response state", { exact: true }),
    "working",
  );
  await expect(model(preview)).toBeEnabled();
  await expect(thinking(preview)).toBeEnabled();
  await expect(
    page.getByText("Chat model: example-reasoning-long. Thinking: high.", {
      exact: false,
    }),
  ).toBeVisible();
  await preview.setViewportSize({ width: 1280, height: 800 });
  const desktopBend = (await preview.locator(".bend-status").boundingBox())!;
  const desktopModel = (await model(preview).boundingBox())!;
  expect(
    Math.abs(
      desktopBend.y +
        desktopBend.height / 2 -
        desktopModel.y -
        desktopModel.height / 2,
    ),
  ).toBeLessThan(2);
  await preview.screenshot({
    path: testInfo.outputPath("thinking-working-desktop.png"),
  });
  await preview.setViewportSize({ width: 390, height: 600 });
  const bendBox = (await preview.locator(".bend-status").boundingBox())!;
  const modelBox = (await model(preview).boundingBox())!;
  const thinkingBox = (await thinking(preview).boundingBox())!;
  expect(bendBox.x).toBeGreaterThanOrEqual(0);
  expect(bendBox.width).toBeGreaterThan(44);
  expect(bendBox.y + bendBox.height).toBeLessThanOrEqual(modelBox.y);
  expect(modelBox.width).toBeGreaterThan(100);
  expect(thinkingBox.y).toBe(modelBox.y);
  expect(thinkingBox.x).toBeGreaterThan(modelBox.x);
  expect(thinkingBox.x + thinkingBox.width).toBeLessThanOrEqual(390);
  await preview.screenshot({
    path: testInfo.outputPath("thinking-working-narrow.png"),
  });
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(model(preview)).toBeEnabled();
  await expect(thinking(preview)).toBeEnabled();
  await expect(preview.locator(".bend-status")).toHaveCount(0);
  await expect(draft).toHaveValue("Keep this draft");
});

test("catalog and persistence recovery do not overwrite either confirmed choice", async ({
  page,
}) => {
  const preview = await open(page, "chat-error");
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Do not discard");
  await fixture(page, "load-error");
  await expect(model(preview)).toBeDisabled();
  await preview.getByRole("button", { name: "Retry loading" }).click();
  await expect(draft).toBeFocused();
  await expect(preview.locator(".chat-choices")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Model catalog loaded" }).click();
  await choose(preview, "example-reasoning-long");
  await saved(page);
  await thinking(preview).click();
  await preview
    .getByRole("menuitemradio", { name: "High", exact: true })
    .click();
  await choose(preview, "example-fast");
  await page
    .getByRole("button", {
      name: "Model save failed (confirmed unchanged)",
      exact: true,
    })
    .click();
  await expect(model(preview)).toContainText("Example Reasoning");
  await expect(thinking(preview)).toHaveText("High");
  await expect(thinking(preview)).toBeDisabled();
  await preview.getByRole("button", { name: "Keep previous choice" }).click();
  await expect(thinking(preview)).toBeEnabled();
  await choose(preview, "example-fast");
  await page
    .getByRole("button", { name: "Model save outcome uncertain" })
    .click();
  await expect(model(preview)).toBeDisabled();
  await expect(thinking(preview)).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: "Keep previous choice" }),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: "Check saved choice" }).click();
  await page
    .getByRole("button", { name: "Readback confirms previous model" })
    .click();
  await expect(thinking(preview)).toHaveText("High");
  await fixture(page, "reasoning-limited");
  await thinking(preview).click();
  await expect(
    preview
      .getByRole("menu", { name: "Thinking level", exact: true })
      .getByRole("menuitemradio")
      .locator(":scope > .option-copy"),
  ).toHaveText([
    /↳\s*Workspace default\s*Recommended · Low/,
    /☆\s*Recommended\s*Low/,
    "Low",
    "High",
  ]);
  await preview.keyboard.press("Tab");
  await expect(preview.getByRole("menu")).not.toBeVisible();
  await fixture(page, "unsaved");
  await expect(model(preview)).toBeEnabled();
  await page
    .getByRole("button", { name: "Response saved", exact: true })
    .click();
  await expect(model(preview)).toBeEnabled();
  await fixture(page, "disconnected");
  await expect(model(preview)).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await expect(draft).toHaveValue("Do not discard");
});

test("only options scroll in a short viewport; desktop and phone retain input and focus", async ({
  page,
}, testInfo) => {
  const preview = await open(page, "chat-empty");
  const draft = preview.getByLabel("Message", { exact: true });
  await preview.setViewportSize({ width: 1280, height: 800 });
  await draft.fill("Keep my narrow draft");
  await draft.evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(2, 6),
  );
  await fixture(page, "long");
  await expect(model(preview)).toHaveText("Example Reasoning");
  await expect(draft).toBeFocused();
  await model(preview).hover();
  await preview.screenshot({
    path: testInfo.outputPath("thinking-controls-desktop.png"),
  });
  await model(preview).click();
  const menu = preview.getByRole("menu", { name: "Chat model", exact: true });
  expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(280);
  await preview.screenshot({
    path: testInfo.outputPath("model-list-desktop.png"),
  });
  await preview.mouse.click(320, 40);
  await expect(menu).not.toBeVisible();
  await thinking(preview).click();
  await preview.screenshot({
    path: testInfo.outputPath("thinking-list-desktop.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(thinking(preview)).toBeFocused();
  await preview.setViewportSize({ width: 390, height: 240 });
  await model(preview).click();
  const area = (await preview.locator(".chat-screen").boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(area.x);
  expect(box.y).toBeGreaterThanOrEqual(area.y);
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
  expect(
    await menu.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await preview.keyboard.press("End");
  await expect(
    preview.locator('[data-choice="example-desktop"]'),
  ).toBeFocused();
  expect(await menu.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await preview.screenshot({
    path: testInfo.outputPath("model-list-short-scrolled.png"),
  });
  await preview.keyboard.press("Home");
  await expect(menu.locator('[data-choice=""]')).toBeFocused();
  await preview.keyboard.press("Escape");
  await preview.setViewportSize({ width: 390, height: 844 });
  await draft.focus();
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("Keep my narrow draft");
  expect(
    await draft.evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
    ]),
  ).toEqual([2, 6]);
  await preview.screenshot({
    path: testInfo.outputPath("thinking-controls-phone-keyboard.png"),
  });
  await model(preview).click();
  const phoneArea = (await preview.locator(".chat-screen").boundingBox())!;
  const phoneBox = (await menu.boundingBox())!;
  expect(phoneBox.y + phoneBox.height).toBeLessThanOrEqual(
    phoneArea.y + phoneArea.height,
  );
  await preview.screenshot({
    path: testInfo.outputPath("model-list-phone-keyboard.png"),
  });
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(draft).toHaveValue("");
  await expect(model(preview)).toHaveAccessibleName(
    "Chat model: Example Chat. Workspace default",
  );
  await expect(thinking(preview)).toHaveCount(0);
  await expect(menu).not.toBeVisible();
});

test("manual IDs do not invent thinking support and preserve validation and save recovery", async ({
  page,
}) => {
  const preview = await open(page, "chat-empty");
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Keep manual draft");
  await fixture(page, "custom");
  await expect(model(preview)).toHaveCSS("padding", "4px 6px");
  await expect(model(preview)).toHaveCSS("border-top-width", "0px");
  await expect(model(preview)).toHaveCSS("color", "rgb(106, 92, 112)");
  await expect(thinking(preview)).toHaveCount(0);
  await preview.setViewportSize({ width: 390, height: 320 });
  await model(preview).click();
  await expect(
    preview.getByRole("textbox", { name: "Model ID", exact: true }),
  ).toBeFocused();
  await expect(
    preview.getByRole("textbox", { name: "Model ID", exact: true }),
  ).toHaveValue("local-chat");
  await preview
    .getByRole("textbox", { name: "Model ID", exact: true })
    .fill("");
  await preview.getByRole("button", { name: "Use model ID" }).click();
  await expect(
    preview.getByRole("textbox", { name: "Model ID", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  const action = (await preview
    .getByRole("button", { name: "Use model ID" })
    .boundingBox())!;
  const dialog = (await preview
    .getByRole("dialog", { name: "Model ID" })
    .boundingBox())!;
  expect(action.y + action.height).toBeLessThanOrEqual(
    dialog.y + dialog.height,
  );
  await preview
    .getByRole("textbox", { name: "Model ID", exact: true })
    .fill(" example-reasoning-long ");
  await preview.getByRole("button", { name: "Use model ID" }).click();
  await expect(draft).toBeFocused();
  await page
    .getByRole("button", {
      name: "Model save failed (confirmed unchanged)",
      exact: true,
    })
    .click();
  await preview.getByRole("button", { name: "Retry save" }).click();
  await saved(page);
  await expect(model(preview)).toHaveText("example-reasoning-long");
  await expect(thinking(preview)).toHaveCount(0);
  await expect(draft).toHaveValue("Keep manual draft");
  await model(preview).click();
  await preview.keyboard.press("Escape");
  await expect(model(preview)).toBeFocused();
});

test("issues dismiss without clearing, reopen in place, and disappear through retry and success", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Retain recovery draft");
  await fixture(page, "load-error");
  await expect(issue(preview)).toBeVisible();
  await expect(issue(preview)).toHaveAccessibleName(
    "Models couldn’t be loaded",
  );
  const close = preview.getByRole("button", { name: "Close model issue" });
  await expect(close).toBeFocused();
  await expect(close).toHaveCSS("border-top-width", "0px");
  await expect(close).toHaveCSS("padding", "12px");
  await expect(issueTrigger(preview)).toHaveCSS("border-top-width", "0px");
  await expect(issueTrigger(preview)).toHaveCSS("padding", "0px");
  await issueAboveRow(preview);
  await preview.screenshot({
    path: testInfo.outputPath("catalog-error-desktop.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(issueTrigger(preview)).toBeFocused();
  await expect(issue(preview)).not.toBeVisible();
  await expect(model(preview)).toBeDisabled();
  await draft.fill("Draft after dismissal");
  await expect(issue(preview)).not.toBeVisible();
  await issueTrigger(preview).click();
  await preview.keyboard.press("Shift+Tab");
  await expect(
    preview.getByRole("button", { name: "Retry loading", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await preview
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  await expect(draft).toBeFocused();
  await silentBusy(preview);
  await page
    .getByRole("button", { name: "Model catalog failed", exact: true })
    .click();
  await expect(issue(preview)).toBeVisible();
  await preview
    .getByRole("button", { name: "Retry loading", exact: true })
    .click();
  await silentBusy(preview);
  await page
    .getByRole("button", { name: "Model catalog loaded", exact: true })
    .click();
  await expect(issueTrigger(preview)).toHaveCount(0);
  await expect(issue(preview)).not.toBeVisible();
  await expect(model(preview)).toHaveAccessibleName(
    "Chat model: Example Chat. Workspace default",
  );
  await choose(preview, "example-fast");
  await silentBusy(preview);
  await page
    .getByRole("button", {
      name: "Model save failed (confirmed unchanged)",
      exact: true,
    })
    .click();
  await expect(issue(preview)).toHaveAccessibleName("Model choice not saved");
  await preview
    .getByRole("button", { name: "Keep previous choice", exact: true })
    .click();
  await expect(issueTrigger(preview)).toHaveCount(0);
  await expect(model(preview)).toHaveAccessibleName(
    "Chat model: Example Chat. Workspace default",
  );
  await choose(preview, "example-chat");
  await saved(page);
  await choose(preview, "example-fast");
  await page
    .getByRole("button", { name: "Model save outcome uncertain", exact: true })
    .click();
  await expect(issue(preview)).toHaveAccessibleName("Model choice unconfirmed");
  await expect(
    issue(preview).getByRole("button", { name: /Keep|Discard/ }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Check saved choice", exact: true })
    .click();
  await silentBusy(preview);
  await page
    .getByRole("button", { name: "Readback confirms new model", exact: true })
    .click();
  await expect(model(preview)).toHaveText("Example Fast");
  await expect(issueTrigger(preview)).toHaveCount(0);
  await expect(draft).toHaveValue("Draft after dismissal");
  await singleRow(preview);
});

test("error dialogs replace menus and retain unresolved blocked states after closing", async ({
  page,
}) => {
  const preview = await open(page);
  await model(preview).click();
  await expect(preview.getByRole("menu")).toBeVisible();
  await fixture(page, "save-error");
  await expect(issue(preview)).toBeVisible();
  await expect(preview.locator(":popover-open")).toHaveCount(0);
  await preview.keyboard.press("Escape");
  await model(preview).click();
  await expect(preview.getByRole("menu")).toBeVisible();
  await issueTrigger(preview).click();
  await expect(issue(preview)).toBeVisible();
  await expect(preview.locator(":popover-open")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Retry save", exact: true })
    .click();
  await silentBusy(preview);
  await saved(page);
  await expect(issue(preview)).not.toBeVisible();
  await expect(issueTrigger(preview)).toHaveCount(0);
  await fixture(page, "long");
  await thinking(preview).click();
  await expect(preview.getByRole("menu")).toBeVisible();
  await fixture(page, "uncertain");
  await expect(issue(preview)).toBeVisible();
  await expect(preview.locator(":popover-open")).toHaveCount(0);
  for (const [value, title] of [
    ["unsaved", "Response not saved"],
    ["disconnected", "AI access unavailable"],
    ["zero", "No chat models available"],
  ]) {
    await fixture(page, value);
    await expect(issue(preview)).toHaveAccessibleName(title);
    if (value === "unsaved") await expect(model(preview)).toBeEnabled();
    else await expect(model(preview)).toBeDisabled();
    await preview.getByRole("button", { name: "Close model issue" }).click();
    await expect(issue(preview)).not.toBeVisible();
    await expect(issueTrigger(preview)).toBeVisible();
    if (value === "unsaved") await expect(model(preview)).toBeEnabled();
    else await expect(model(preview)).toBeDisabled();
    await issueTrigger(preview).click();
    await expect(issue(preview)).toHaveAccessibleName(title);
    await singleRow(preview);
  }
  await fixture(page, "unavailable");
  await expect(issue(preview)).toHaveAccessibleName("Model unavailable");
  await preview
    .getByRole("button", { name: "Choose model", exact: true })
    .click();
  await expect(issue(preview)).not.toBeVisible();
  await expect(preview.getByRole("menu")).toBeVisible();
  await preview.locator('[data-choice="example-chat"]').click();
  await silentBusy(preview);
  await saved(page);
  await expect(issueTrigger(preview)).toHaveCount(0);
  await fixture(page, "new");
  await expect(issueTrigger(preview)).toHaveCount(0);
  await expect(issue(preview)).not.toBeVisible();
  await model(preview).click();
  await expect(preview.getByRole("menu")).toBeVisible();
});

test("recovery stays above the row with reachable actions on narrow, short and keyboard-occluded screens", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  await preview.setViewportSize({ width: 390, height: 600 });
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Keep the constrained draft");
  await choose(preview, "example-reasoning-long");
  await page
    .getByRole("button", {
      name: "Model save failed (confirmed unchanged)",
      exact: true,
    })
    .click();
  await issueAboveRow(preview);
  await preview.screenshot({
    path: testInfo.outputPath("save-error-narrow.png"),
  });
  await preview.setViewportSize({ width: 390, height: 240 });
  await issueAboveRow(preview);
  await preview.screenshot({
    path: testInfo.outputPath("save-error-short.png"),
  });
  await preview
    .getByRole("button", { name: "Keep previous choice", exact: true })
    .click();
  await expect(draft).toBeFocused();
  await expect(issueTrigger(preview)).toHaveCount(0);
  await preview.setViewportSize({ width: 390, height: 844 });
  await selectOption(
    page.getByLabel("Platform profile", { exact: true }),
    "ios",
  );
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  await fixture(page, "uncertain");
  await issueAboveRow(preview);
  await preview.screenshot({
    path: testInfo.outputPath("uncertain-keyboard.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(issueTrigger(preview)).toBeFocused();
  await issueTrigger(preview).click();
  await preview
    .getByRole("button", { name: "Retry save", exact: true })
    .click();
  await silentBusy(preview);
  await expect(draft).toBeFocused();
  await saved(page);
  await expect(issue(preview)).not.toBeVisible();
  await expect(issueTrigger(preview)).toHaveCount(0);
  await expect(draft).toHaveValue("Keep the constrained draft");
});
