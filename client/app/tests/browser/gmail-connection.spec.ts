import { readFileSync } from "node:fs";
import type { PluginSource } from "../../src/plugins/types";
import { emptyLayout, reduceLayout } from "../../src/layout/model";
import { expect, test, type Page } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

function sourceFile(directory: string, file: string) {
  return readFileSync(
    new URL(`../../${directory}/${file}`, import.meta.url),
    "utf8",
  );
}
const gmailFiles = Object.fromEntries(
  ["plugin.json", "service.js", "ui.js"].map((file) => [
    file,
    sourceFile("src-tauri/plugins/gmail", file),
  ]),
);
const gmail: PluginSource = {
  manifest: JSON.parse(gmailFiles["plugin.json"]!),
  serviceEntry: gmailFiles["service.js"]!,
  uiEntry: gmailFiles["ui.js"]!,
  skills: [],
  modules: {},
};
const example = "src/plugins/examples/gmail-inbox";
const consumer: PluginSource = {
  manifest: JSON.parse(sourceFile(example, "plugin.json")),
  serviceEntry: null,
  uiEntry: sourceFile(example, "ui.js"),
  skills: [],
  modules: {
    "account-settings.js": sourceFile(example, "account-settings.js"),
  },
};
const account = {
  id: "81000000-0000-4000-8000-000000000001",
  email: "mail@example.test",
  permissions: ["metadata"],
  missing: ["send"],
  partial: true,
  reconnect: false,
};

const installed = ({ manifest }: PluginSource) => ({
  id: manifest.id,
  manifest,
  enabled: true,
  error: null,
});

test.use({ localizationMode: "real", locale: "en-US" });

async function openSettings(page: Page) {
  const settings = page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Settings", exact: true });
  const navigation = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await expect(settings.or(navigation).first()).toBeVisible();
  if (!(await settings.isVisible())) await navigation.click();
  await settings.click();
}

async function openPlugins(page: Page) {
  await page.locator('[data-action="manage-plugins"]').click();
  await expect(
    page.getByRole("heading", { name: "Plugins", exact: true }),
  ).toBeVisible();
}

test("opens the installed Gmail plugin settings in the originating pane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let sequence = 0;
  const nextId = () => `gmail-layout-${++sequence}`;
  const management = reduceLayout(
    emptyLayout(),
    { type: "open", target: { kind: "view", viewId: "plugins" } },
    nextId,
  );
  const tab = management.tabs[0]!;
  const layout = reduceLayout(
    management,
    { type: "split", tabId: tab.id, paneId: tab.activePaneId, edge: "right" },
    nextId,
  );
  await workspaceFixture(page, shellState, {
    installedPlugins: [installed(gmail)],
    pluginSources: { [gmail.manifest.id]: gmail },
    layout: {
      records: {
        garden: {
          revision: "gmail-layout",
          data: { version: 1, layout, pinnedViews: [] },
        },
      },
    },
  });
  await page.goto("/");
  const card = page.getByRole("article", { name: "Gmail", exact: true });
  await expect(card).toBeVisible();
  const panes = page.locator(".pane-tile");
  await expect(panes.last()).toHaveAttribute("aria-label", "Pane: New tab");
  await card
    .getByRole("button", { name: "Settings", exact: true })
    .dispatchEvent("click");
  await expect(
    panes.first().getByRole("heading", { name: "Connected accounts" }),
  ).toBeVisible();
  await expect(panes.last()).toHaveAttribute("aria-label", "Pane: New tab");
  const settingsPane = panes.first();
  await settingsPane.getByRole("button", { name: "Connect account" }).click();
  const reading = settingsPane.getByRole("group", {
    name: "Reading",
    exact: true,
  });
  const writing = settingsPane.getByRole("group", {
    name: "Drafts and sending",
    exact: true,
  });
  await expect(reading).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect
    .poll(async () => {
      const [first, second] = await Promise.all([
        reading.boundingBox(),
        writing.boundingBox(),
      ]);
      return !!first && !!second && second.x === first.x && second.y > first.y;
    })
    .toBe(true);
  await panes
    .first()
    .getByRole("button", { name: "Back in this pane" })
    .click();
  await expect(card).toBeVisible();
});

test("offers a settings update instead of reinstalling the existing connection", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    installedPlugins: [installed(gmail)],
    pluginSources: { [gmail.manifest.id]: gmail },
    gmailUpdateAvailable: true,
  });
  await page.addInitScript(() =>
    localStorage.setItem("gmail-experiment-fixture", "true"),
  );
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("button", { name: "Experimental features" }).click();
  const update = page.getByRole("button", { name: "Update Gmail settings" });
  await expect(update).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install Gmail in this workspace" }),
  ).toHaveCount(0);
  await update.click();
  await expect(update).toHaveCount(0);
  await expect(page.getByText(/Gmail is installed/)).toBeVisible();
});

for (const width of [700, 1440]) {
  test(
    `Gmail installs as a connection and shares the chosen account with an installed consumer at ${width}px`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(page, shellState, {
        gmailGrant: account,
        installedPlugins: [installed(consumer)],
        pluginSources: {
          [consumer.manifest.id]: consumer,
          [gmail.manifest.id]: gmail,
        },
        pluginSourceFiles: { [gmail.manifest.id]: gmailFiles },
      });
      await page.goto("/");
      const gmailCard = page.getByRole("article", {
        name: "Gmail",
        exact: true,
      });
      const inboxCard = page.getByRole("article", {
        name: "Gmail inbox",
        exact: true,
      });
      const settings = (card: typeof gmailCard) =>
        card.getByRole("button", { name: "Settings", exact: true });
      const back = () =>
        page.getByRole("button", { name: "Back in this pane" }).click();
      await openSettings(page);
      await openPlugins(page);
      await expect(gmailCard).toHaveCount(0);
      await openSettings(page);
      await page.getByRole("button", { name: "Experimental features" }).click();
      await page.getByRole("switch", { name: "Gmail" }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Enable Gmail" })
        .click();
      await page
        .getByRole("button", { name: "Install Gmail in this workspace" })
        .click();
      await expect(page.getByText(/Gmail is installed/)).toBeVisible();
      if (width === 700) await page.locator(".settings-back").click();
      await openPlugins(page);
      await expect(gmailCard).toBeVisible();
      await gmailCard.scrollIntoViewIfNeeded();
      await visual.capture("gmail.connection-card");
      await gmailCard
        .getByRole("button", { name: "View files", exact: true })
        .click();
      await expect(page.locator(".plugin-files-view h1")).toHaveText("Gmail");
      await expect(
        page.getByRole("button", { name: "service.js", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "‹ Back to plugins", exact: true })
        .click();
      await settings(gmailCard).click();
      await expect(
        page.getByText("No Gmail accounts connected."),
      ).toBeVisible();
      await visual.capture("gmail.no-accounts");
      const connect = page.getByRole("button", { name: "Connect account" });
      await connect.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Connect account" }),
      ).toBeFocused();
      await page
        .getByRole("button", { name: "Back to Gmail accounts" })
        .click();
      await expect(connect).toBeFocused();
      await connect.click();
      await page.getByRole("button", { name: "Continue to Google" }).click();
      await expect(
        page.getByRole("checkbox", { name: "Read message details" }),
      ).toBeFocused();
      await expect(page.getByRole("alert")).toHaveText(
        "Select at least one permission.",
      );
      await expect(
        page.getByRole("checkbox", { name: /Permanently delete/ }),
      ).not.toBeChecked();
      await page
        .getByRole("checkbox", { name: "Read message details" })
        .check();
      await page.getByRole("checkbox", { name: "Send email" }).check();
      await visual.capture("gmail.permissions");
      await page.getByRole("button", { name: "Continue to Google" }).click();
      await expect(
        page.getByRole("heading", { name: account.email }),
      ).toBeVisible();
      await expect(page.getByText("Not granted: Send email")).toBeVisible();
      await visual.capture("gmail.partial-grant");
      await back();
      await settings(inboxCard).click();
      const selector = page.getByLabel("Gmail account", { exact: true });
      await selector.selectOption({ label: account.email });
      await expect(selector).toHaveValue(account.id);
      await back();
      await settings(inboxCard).click();
      await expect(selector).toHaveValue(account.id);
      await back();
      await settings(gmailCard).click();
      await page
        .getByRole("button", {
          name: `Disconnect: ${account.email}`,
          exact: true,
        })
        .click();
      const confirm = page.getByRole("dialog", {
        name: "Disconnect Gmail account?",
      });
      await expect(confirm).toBeVisible();
      await visual.capture("gmail.disconnect-confirmation");
      await confirm
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await expect(
        page.getByText("No Gmail accounts connected."),
      ).toBeVisible();
      await back();
      await settings(inboxCard).click();
      await expect(selector).toBeEnabled();
      await expect(selector).toHaveValue("");
    },
  );
}
