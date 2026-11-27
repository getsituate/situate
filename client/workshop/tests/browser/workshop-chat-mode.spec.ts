import { expect, test, type Page } from "./test";
import { chooseSelect } from "./select";

const normalTitle = "Notes for my weekly review";
const sampleQuestion =
  "How could I keep track of the notes I want to revisit each week?";
const toDevelopment = "Switch to plugin development";
const toChat = "Switch to chat";
const choosePlacement = (page: Page, placement: string) =>
  chooseSelect(
    page.getByRole("combobox", { name: "Mode switch placement" }),
    placement,
  );

async function open(page: Page, state: string, width: number) {
  await page.goto(`/?workshop=controls&scenario=${state}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width, height: 844 });
  return preview;
}

test("an ordinary chat keeps layout controls out of its headerless view", async ({
  page,
}) => {
  const preview = await open(page, "plugins-mode-chat", 1280);
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveText("Develop a plugin");
  await expect(page.getByLabel("Starting state", { exact: true })).toHaveText(
    "Normal chat",
  );
  const layout = preview.locator(".tab-header");
  const chat = preview.locator(".pane-body").filter({
    has: preview.getByRole("textbox", { name: "Message", exact: true }),
  });
  await expect(layout.getByRole("tab", { name: normalTitle })).toBeVisible();
  await expect(chat.locator(".chat-pane-header")).toHaveCount(0);
  await expect(chat.locator('[aria-haspopup="menu"]')).toHaveCount(1);
  await expect(
    chat.getByRole("button", { name: "Chat actions" }),
  ).toBeVisible();
  await expect(
    layout.getByRole("button", { name: "Tab options" }),
  ).toBeVisible();
  const paneOptions = layout.getByRole("button", { name: /Pane layout:/ });
  await paneOptions.press("ArrowDown");
  const menu = preview.getByRole("menu", { name: "Pane layout" });
  const split = menu.getByRole("menuitem", { name: "Add pane to the right" });
  await expect(split).toBeFocused();
  await split.press("Escape");
  await expect(menu).toBeHidden();
  await expect(paneOptions).toBeFocused();
  await preview.screenshot({
    path: test.info().outputPath("normal-chat-layout.png"),
  });
});

test("plugin development keeps its content controls while the layout owns split and close", async ({
  page,
}) => {
  const preview = await open(page, "plugins-mode-development", 1440);
  await expect(page.getByLabel("Starting state", { exact: true })).toHaveText(
    "Plugin development · checks failed",
  );
  const title = "Bring notes into a reading view";
  const chat = preview
    .locator(".pane-tile")
    .filter({ has: preview.locator(".plugin-development") });
  const changes = chat.getByRole("complementary", { name: "Changes" });
  await expect(changes).toBeVisible();
  await expect(
    chat.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(0);
  const toolbar = (await chat.locator(".chat-corner-actions").boundingBox())!;
  expect(toolbar.x + toolbar.width).toBeLessThan(
    (await changes.boundingBox())!.x,
  );
  await preview.screenshot({
    path: test.info().outputPath("corner-changes-wide.png"),
  });
  await choosePlacement(page, "conversation");
  const contentHeader = chat.locator(".chat-pane-header");
  await expect(
    contentHeader.getByText("Plugin development", { exact: true }),
  ).toBeVisible();
  await expect(
    contentHeader.getByRole("button", { name: "About plugin development" }),
  ).toBeVisible();
  await expect(
    contentHeader.getByRole("button", { name: "Changes" }),
  ).toBeVisible();
  await expect(contentHeader.locator('[aria-haspopup="menu"]')).toHaveCount(0);
  await expect(
    contentHeader.getByRole("button", { name: /Close/ }),
  ).toHaveCount(0);
  const draft = "Keep this draft and the current conversation.";
  const request = chat.getByRole("textbox", { name: "Your request" });
  await request.fill(draft);
  await changes.locator('[data-change-id="notes"]').click();
  const added = changes.locator(".diff-line.added");
  await expect(added).toContainText("limit = 20");
  await preview.getByRole("button", { name: `Pane layout: ${title}` }).click();
  await preview
    .getByRole("menu", { name: "Pane layout" })
    .getByRole("menuitem", { name: "Add pane to the right" })
    .click();
  await expect(preview.locator(".split-layout .pane-tile")).toHaveCount(2);
  const frame = chat.locator(".pane-toolbar");
  await expect(
    frame.getByRole("button", { name: `Pane layout: ${title}` }),
  ).toBeVisible();
  await expect(frame.getByRole("button", { name: "Close pane" })).toBeVisible();
  await preview.screenshot({
    path: test.info().outputPath("development-split-layout.png"),
  });
  await preview
    .locator(".pane-tile")
    .filter({ hasNot: preview.locator(".plugin-development") })
    .getByRole("button", { name: "Close pane" })
    .click();
  await expect(request).toHaveValue(draft);
  await expect(added).toContainText("limit = 20");
  await choosePlacement(page, "composer");
  const exit = chat.getByRole("button", { name: toChat, exact: true });
  await exit.press("Enter");
  await expect(changes).toBeHidden();
  await expect(
    chat.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue(draft);
  const enter = chat.getByRole("button", { name: toDevelopment, exact: true });
  await expect(enter).toBeFocused();
  await enter.press("Enter");
  await expect(request).toHaveValue(draft);
  await expect(added).toContainText("limit = 20");
});

test("a plugin request opens development in the same pane on a narrow layout", async ({
  page,
}) => {
  const preview = await open(page, "plugins-mode-new-chat", 390);
  const request = "Add a reading view to my notes plugin.";
  const chat = preview
    .locator(".pane-tile")
    .filter({ has: preview.locator(".plugin-development") });
  const paneId = await chat.getAttribute("data-pane");
  await expect(chat.locator(".chat-pane-header")).toHaveCount(0);
  await expect(chat.locator(".plugin-conversation")).toHaveCSS(
    "padding-top",
    "0px",
  );
  await chat
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(request);
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(chat.locator(".plugin-development")).toHaveAttribute(
    "aria-label",
    "Bring notes into a reading view",
  );
  await expect(
    chat.getByRole("button", { name: "About plugin development" }),
  ).toBeVisible();
  await expect(chat.getByText(request, { exact: true })).toHaveCount(1);
  await expect(
    chat.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(chat).toHaveAttribute("data-pane", paneId!);
  await expect(chat.locator(".chat-pane-header")).toHaveCount(0);
  expect(await chat.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const actions = chat.getByRole("button", { name: "Chat actions" });
  await actions.click();
  await expect(
    preview.getByRole("menuitem", { name: toChat, exact: true }),
  ).toBeDisabled();
  await preview.keyboard.press("Escape");
  await chat.getByRole("button", { name: "Stop", exact: true }).click();
  await actions.click();
  await preview.getByRole("menuitem", { name: toChat, exact: true }).click();
  await expect(
    chat.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
});

test("the corner menu keeps the full transcript height until the controls would overlap it", async ({
  page,
}) => {
  const preview = await open(page, "plugins-mode-chat", 1440);
  await expect(
    page.getByRole("combobox", { name: "Mode switch placement" }),
  ).toHaveText("Top-right menu");
  const view = preview.locator(".plugin-development");
  const layout = view.locator(".development-layout");
  const transcript = view.locator(".conversation-scroll");
  const toolbar = view.locator(".chat-corner-actions");
  const actions = toolbar.getByRole("button", { name: "Chat actions" });
  const menu = preview.getByRole("menu", { name: "Chat actions" });
  async function clearance() {
    const body = (await layout.boundingBox())!;
    const thread = (await transcript.boundingBox())!;
    return thread.y - body.y;
  }
  await expect(actions).toBeVisible();
  const label = view.locator(".development-mode-label");
  await expect(label).toHaveCount(0);
  await expect(view.locator(".chat-pane-header")).toHaveCount(0);
  await expect.poll(clearance).toBe(0);
  const draft = "Keep the current draft.";
  await view.getByRole("textbox", { name: "Message", exact: true }).fill(draft);
  await actions.press("ArrowDown");
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  const enter = menu.getByRole("menuitem", {
    name: toDevelopment,
    exact: true,
  });
  await expect(enter).toBeFocused();
  await enter.press("Enter");
  await expect(actions).toBeFocused();
  await expect(view.getByRole("textbox", { name: "Your request" })).toHaveValue(
    draft,
  );
  await expect(view.getByText(sampleQuestion, { exact: true })).toBeVisible();
  await expect(view.locator(".chat-pane-header")).toHaveCount(0);
  await expect.poll(clearance).toBe(0);
  await expect(label).toHaveText("Plugin development");
  await expect(label).toBeVisible();
  const info = view.getByRole("button", { name: "About plugin development" });
  const name = (await label.boundingBox())!;
  const icon = (await info.boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(icon.x);
  expect(icon.x + icon.width).toBeLessThan((await actions.boundingBox())!.x);
  await info.click();
  await expect(
    preview.getByRole("dialog", { name: "About plugin development" }),
  ).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(info).toBeFocused();
  await preview.screenshot({ path: test.info().outputPath("corner-wide.png") });

  await preview.setViewportSize({ width: 390, height: 740 });
  await expect.poll(clearance).toBeGreaterThan(0);
  const tools = (await toolbar.boundingBox())!;
  expect((await transcript.boundingBox())!.y).toBeGreaterThanOrEqual(
    tools.y + tools.height,
  );
  await preview.screenshot({
    path: test.info().outputPath("corner-narrow.png"),
  });

  await actions.click();
  await menu.getByRole("menuitem", { name: "Show changes" }).click();
  const changes = view.getByRole("complementary", { name: "Changes" });
  await expect(changes).toBeVisible();
  await expect(transcript).toBeHidden();
  expect(
    (await changes.getByRole("heading", { name: "Changes" }).boundingBox())!.y,
  ).toBeGreaterThanOrEqual(tools.y + tools.height);
  await actions.click();
  await menu.getByRole("menuitem", { name: "Hide changes" }).click();
  await expect(transcript).toBeVisible();
  await expect(view.getByRole("textbox", { name: "Your request" })).toHaveValue(
    draft,
  );
  await preview.setViewportSize({ width: 1440, height: 844 });
  await expect.poll(clearance).toBe(0);
});

for (const placement of ["conversation", "pane", "composer"] as const) {
  test(`${placement} switches in both directions without replacing the conversation`, async ({
    page,
  }) => {
    const preview = await open(page, "plugins-mode-chat", 1280);
    await choosePlacement(page, placement);
    const draft = "Keep this draft and the previous messages.";
    const input = preview.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    const request = preview.getByRole("textbox", {
      name: "Your request",
      exact: true,
    });
    const earlierMessage = preview.getByText(sampleQuestion, { exact: true });
    await input.fill(draft);
    await expect(earlierMessage).toBeVisible();

    const action = async (label: string) => {
      if (placement === "conversation") {
        const trigger = preview.getByRole("button", {
          name: `Options for ${normalTitle}`,
        });
        await trigger.click();
        return preview
          .getByRole("dialog", { name: "Conversation actions" })
          .getByRole("button", { name: label, exact: true });
      }
      if (placement === "pane") {
        await preview
          .getByRole("button", { name: `Pane layout: ${normalTitle}` })
          .press("ArrowDown");
        return preview
          .getByRole("menu", { name: "Pane layout" })
          .getByRole("menuitem", { name: label, exact: true });
      }
      return preview
        .locator(".composer-footer")
        .getByRole("button", { name: label, exact: true });
    };

    const enter = await action(toDevelopment);
    await expect(enter).toBeVisible();
    await preview.screenshot({
      path: test.info().outputPath(`${placement}-placement.png`),
    });
    await enter.press("Enter");
    await expect(request).toHaveValue(draft);
    await expect(earlierMessage).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0);
    await (await action(toChat)).click();
    await expect(input).toHaveValue(draft);
    await expect(earlierMessage).toBeVisible();
    await expect(preview.locator(".chat-pane-header")).toHaveCount(0);
  });
}

test("an unlisted chat can switch from the pane menu even on a narrow layout", async ({
  page,
}) => {
  const preview = await open(page, "plugins-mode-new-chat", 1280);
  await expect(preview.getByRole("tab", { name: "New chat" })).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Options for New chat" }),
  ).toHaveCount(0);
  const draft = "Prepare a reading view.";
  await preview
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(draft);
  await choosePlacement(page, "pane");
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview.getByRole("button", { name: "Pane and tab actions" }).click();
  await preview
    .getByRole("menuitem", { name: "Pane layout", exact: true })
    .click();
  await preview
    .getByRole("menuitem", { name: toDevelopment, exact: true })
    .click();
  await expect(
    preview.getByRole("textbox", { name: "Your request" }),
  ).toHaveValue(draft);
  await expect(
    preview.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
});

for (const scenario of [
  "chat-complete",
  "navigation-chat",
  "tabs-new-chat",
  "files-chat",
]) {
  test(`${scenario} can switch modes without replacing its ordinary draft`, async ({
    page,
  }) => {
    const preview = await open(page, scenario, 390);
    const input = preview.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await input.fill("Keep this draft in the same chat.");
    const actions = preview.getByRole("button", {
      name: "Chat actions",
      exact: true,
    });
    await actions.click();
    await preview
      .getByRole("menuitem", { name: toDevelopment, exact: true })
      .click();
    const development = preview.locator(".plugin-development");
    await expect(
      development.getByRole("textbox", { name: "Your request", exact: true }),
    ).toHaveValue("Keep this draft in the same chat.");
    await expect(
      development.getByRole("button", {
        name: "About plugin development",
        exact: true,
      }),
    ).toBeVisible();
    await actions.click();
    await preview.getByRole("menuitem", { name: toChat, exact: true }).click();
    await expect(input).toHaveValue("Keep this draft in the same chat.");
  });
}

test("a tab conversation retains its development mode and draft when reopened", async ({
  page,
}) => {
  const preview = await open(page, "tabs-new-chat", 1440);
  await preview
    .getByRole("button", { name: "Chat actions", exact: true })
    .click();
  await preview
    .getByRole("menuitem", { name: toDevelopment, exact: true })
    .click();
  const request = preview.getByRole("textbox", {
    name: "Your request",
    exact: true,
  });
  await request.fill("A draft for the new view.");
  await preview.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(request).toBeHidden();
  await preview
    .getByRole("tab", { name: "New conversation", exact: true })
    .click();
  await expect(request).toHaveValue("A draft for the new view.");
  await expect(
    preview.getByRole("button", { name: "About plugin development" }),
  ).toBeVisible();
});

test("development examples without a placement preset can switch in both directions", async ({
  page,
}) => {
  const preview = await open(page, "plugins-error", 1280);
  const actions = preview.getByRole("button", {
    name: "Chat actions",
    exact: true,
  });
  const request = preview.getByRole("textbox", {
    name: "Your request",
    exact: true,
  });
  await expect(request).toBeVisible();
  await request.fill("Keep the failed checks and this draft.");
  const firstMessage = await preview
    .locator(".chat-message.user")
    .first()
    .textContent();
  await actions.click();
  await preview.getByRole("menuitem", { name: toChat, exact: true }).click();
  await expect(
    preview.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep the failed checks and this draft.");
  await actions.click();
  await preview
    .getByRole("menuitem", { name: toDevelopment, exact: true })
    .click();
  await expect(request).toHaveValue("Keep the failed checks and this draft.");
  await expect(preview.locator(".chat-message.user").first()).toHaveText(
    firstMessage!,
  );
});

test("repositioning the action does not interrupt work or queue a mode switch", async ({
  page,
}) => {
  const preview = await open(page, "plugins-mode-chat", 1280);
  await choosePlacement(page, "composer");
  await preview
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Add a reading view to my notes plugin.");
  await preview
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  const firstExit = preview.getByRole("button", { name: toChat, exact: true });
  await expect(firstExit).toBeDisabled();
  await firstExit.press("Enter");
  await choosePlacement(page, "conversation");
  const options = preview.getByRole("button", {
    name: "Options for Bring notes into a reading view",
  });
  await options.click();
  const blockedExit = preview
    .getByRole("dialog", { name: "Conversation actions" })
    .getByRole("button", { name: toChat, exact: true });
  await expect(blockedExit).toBeDisabled();
  await blockedExit.press("Escape");
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    preview.getByRole("textbox", { name: "Your request" }),
  ).toBeVisible();
  await options.click();
  await blockedExit.click();
  await expect(
    preview.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
});
