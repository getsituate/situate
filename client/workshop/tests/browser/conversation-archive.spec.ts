import { expect, test, type Page } from "./test";

async function openPreview(controls: Page, width: number) {
  await controls.goto("/?workshop=controls&scenario=tabs-empty");
  const popup = controls.waitForEvent("popup");
  await controls.getByRole("button", { name: "Open preview" }).click();
  const preview = await popup;
  await preview.setViewportSize({ width, height: 900 });
  return preview;
}

function actions(preview: Page) {
  return preview.getByRole("dialog", { name: "Conversation actions" });
}

const title = "Garden chat";
const options = `Options for ${title}`;
const quickArchive = `Archive ${title}`;

test("archives a conversation without closing it and restores it from the sidebar", async ({
  page,
  browserName,
}) => {
  const preview = await openPreview(page, 1440);
  const sidebar = preview.getByRole("navigation", {
    name: "Workspace navigation",
  });
  const conversations = sidebar.getByRole("region", { name: "Conversations" });
  const archive = conversations.locator("details");
  const summary = archive.locator("summary");
  const activeChat = conversations.getByRole("button", {
    name: /^Garden chat/,
  });
  const shortcut = conversations.getByRole("button", { name: quickArchive });
  const transcript = preview.getByText(
    /^Help me make a gentle plan for the garden/,
  );

  await expect(archive).toHaveJSProperty("open", false);
  await activeChat.click();
  await expect(transcript).toBeVisible();
  await sidebar.getByRole("heading", { name: "Views", exact: true }).hover();
  await expect(shortcut).toHaveCSS("opacity", "0");
  await activeChat.hover();
  await expect(shortcut).toHaveCSS("opacity", "1");
  await sidebar.getByRole("heading", { name: "Views", exact: true }).hover();
  await expect(shortcut).toHaveCSS("opacity", "0");
  await activeChat.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(shortcut).toBeFocused();
  await expect(shortcut).toHaveCSS("opacity", "1");
  await shortcut.click();
  await expect(summary).toHaveText("Archive");
  await expect(summary).toBeFocused();
  await expect(activeChat).toHaveCount(0);
  await expect(transcript).toBeVisible();

  await sidebar.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(transcript).toHaveCount(0);
  await summary.press("Enter");
  const archivedChat = archive.getByRole("button", { name: /^Garden chat/ });
  await expect(archivedChat).toBeVisible();
  await conversations.screenshot({
    path: test.info().outputPath("expanded-archive.png"),
  });
  await archivedChat.click();
  await expect(transcript).toBeVisible();
  await summary.click();
  await expect(archivedChat).toHaveCount(0);
  await summary.click();

  await archive.getByRole("button", { name: options }).click();
  await actions(preview)
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect(archive.getByText("No archived conversations.")).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(archivedChat).toHaveCount(0);
  await expect(activeChat).toBeVisible();
  await expect(transcript).toBeVisible();
});

test("keeps archive in the menu when the sidebar is too narrow for the shortcut", async ({
  page,
}) => {
  const preview = await openPreview(page, 260);
  await preview.getByRole("button", { name: /^Workspace navigation:/ }).click();
  const drawer = preview.getByRole("dialog", { name: "Workspace navigation" });
  const menu = drawer.getByRole("button", { name: options });
  await menu.hover();
  await expect(drawer.getByRole("button", { name: quickArchive })).toHaveCount(
    0,
  );
  await menu.click();
  const menuActions = actions(preview);
  await expect(menuActions.getByRole("button")).toHaveText([
    "Rename",
    "Archive",
    "Delete…",
  ]);
  await menuActions
    .getByRole("button", { name: "Archive", exact: true })
    .click();

  const archive = drawer.locator("details.conversation-archive");
  const summary = archive.locator("summary");
  await expect(summary).toBeFocused();
  await summary.click();
  const archivedOptions = archive.getByRole("button", { name: options });
  await archivedOptions.click();
  await menuActions
    .getByRole("button", { name: "Delete…", exact: true })
    .click();
  const confirm = preview.getByRole("dialog", { name: "Delete conversation?" });
  const cancel = confirm.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();
  await cancel.press("Escape");
  await expect(archivedOptions).toBeFocused();
  await expect(drawer).toBeVisible();
  await archivedOptions.click();
  await menuActions
    .getByRole("button", { name: "Delete…", exact: true })
    .click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(archive.getByText("No archived conversations.")).toBeVisible();
  await expect(drawer.getByRole("button", { name: options })).toHaveCount(0);
});
