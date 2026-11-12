import { expect, test, type Page } from "./test";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
} from "./workspace-fixture";
import type { InstalledPlugin } from "../../src/plugins/types";
import { emptyLayout, reduceLayout } from "../../src/layout/model";
import { expectDialogTypography } from "./dialog-typography";
import { randomUUID } from "node:crypto";

test.use({ localizationMode: "real", locale: "en-US" });
const diagnostics = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  diagnostics.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      errors.push(message.text());
  });
});
test.afterEach(({ page }) => expect(diagnostics.get(page)).toEqual([]));

const reading: InstalledPlugin = {
  id: "reading-list",
  enabled: false,
  error: null,
  manifest: {
    schemaVersion: 2,
    id: "reading-list",
    name: "Reading list",
    description: "Collect books to read from your notes.",
    skills: ["skills/reading.md"],
    uiEntry: "entry.js",
  },
};
const planning: InstalledPlugin = {
  id: "weekly-plan",
  incarnation: "00000000-0000-4000-8000-000000000002",
  enabled: true,
  error: null,
  manifest: {
    schemaVersion: 2,
    id: "weekly-plan",
    name: "Weekly planning",
    description: "Bring tasks into a plan for the week.",
    skills: [],
  },
};
const instructions =
  "# Reading list\nUse the book notes to prepare a reading list. Ask before sending it anywhere.";
const source =
  "globalThis.inspectedPluginExecuted = true;\nthrow new Error('Source inspection must not execute this file');";

async function settings(page: Page) {
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  const button = page.getByRole("button", { name: "Settings", exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await button.click();
  await page.locator('[data-action="manage-plugins"]').click();
}
const calls = (page: Page) =>
  page.evaluate(
    () =>
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: {
          scope?: string;
          request?: {
            operation?: string;
            pluginId?: string;
            enabled?: boolean;
            developmentId?: string;
            path?: string;
          };
        };
      }[],
  );

for (const width of [1440, 390]) {
  const tag = width < 600 ? "@visual-mobile" : "@visual-desktop";
  test(
    `plugin disabling stays in its dialog at ${width}px`,
    { tag },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(
        page,
        { ...shellState, mobile: width < 600 },
        {
          installedPlugins: [planning],
          pluginDisablePhase: "waiting",
          pluginDisableRunningActions: [{ pluginId: planning.id, count: 2 }],
        },
      );
      await page.goto("/");
      await settings(page);
      const trigger = page
        .locator('[data-plugin-id="weekly-plan"]')
        .getByRole("button", { name: "Disable", exact: true });
      const dialog = page.getByRole("dialog");
      await trigger.click();
      await dialog
        .getByRole("button", { name: "Disable", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toHaveText(
        "Waiting for 2 running actions to finish.",
      );
      await expect(dialog.getByRole("status")).toBeFocused();
      await expect(dialog.getByRole("listitem")).toHaveText(
        "Weekly planning (2)",
      );
      await expect(
        dialog.getByRole("button", { name: "Cancel disabling", exact: true }),
      ).toBeEnabled();
      await visual.capture("plugins.disable.waiting");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await expect
        .poll(
          async () =>
            (await calls(page)).filter(
              (call) =>
                call.command === "plugin_disable" &&
                call.args.request?.operation === "cancel",
            ).length,
        )
        .toBe(1);
      expect(
        (await calls(page)).some(
          (call) =>
            call.command === "plugin_disable" &&
            call.args.request?.operation === "stop",
        ),
      ).toBe(false);

      await trigger.click();
      await dialog
        .getByRole("button", { name: "Disable", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toHaveText(
        "Waiting for 2 running actions to finish.",
      );
      await dialog
        .getByRole("button", { name: "Abort now", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toHaveText(
        "Stop requested. Waiting for running actions to end.",
      );
      await expect(dialog.getByRole("status")).toBeFocused();
      await visual.capture("plugins.disable.stopping");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(dialog.getByRole("status")).toHaveText(
        "Stop requested. Waiting for running actions to end.",
      );
      await page.evaluate(() =>
        Reflect.get(window, "__setPluginDisablePhase")("disabled"),
      );
      await expect(dialog).not.toBeVisible();
      await expect(
        page.locator('[data-plugin-id="weekly-plan"] .plugin-availability'),
      ).toHaveText("Disabled");
      expect(
        (await calls(page)).filter(
          (call) =>
            call.command === "plugin_disable" &&
            call.args.request?.operation === "begin",
        ),
      ).toHaveLength(2);
      expect(
        (await calls(page)).filter(
          (call) =>
            call.command === "plugin_disable" &&
            call.args.request?.operation === "cancel",
        ),
      ).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    },
  );
  test(
    `uncertain plugin disabling checks before retrying at ${width}px`,
    { tag },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(
        page,
        { ...shellState, mobile: width < 600 },
        {
          installedPlugins: [planning],
          pluginDisablePhase: "uncertain",
          pluginDisableDeferCheck: true,
        },
      );
      await page.goto("/");
      await settings(page);
      const trigger = page
        .locator('[data-plugin-id="weekly-plan"]')
        .getByRole("button", { name: "Disable", exact: true });
      const dialog = page.getByRole("dialog");
      await trigger.click();
      await dialog
        .getByRole("button", { name: "Disable", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toHaveText(
        "The change may have been saved. Check the status before trying again.",
      );
      await expect(
        dialog.getByRole("button", {
          name: "Try disabling again",
          exact: true,
        }),
      ).not.toBeVisible();
      await visual.capture("plugins.disable.uncertain");
      await dialog
        .getByRole("button", { name: "Check status", exact: true })
        .click();
      await expect(dialog.getByRole("status")).toHaveText(
        "Checking whether the plugin was disabled…",
      );
      await expect(dialog.getByRole("status")).toBeFocused();
      await visual.capture("plugins.disable.checking");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await trigger.click();
      await expect(dialog.getByRole("status")).toHaveText(
        "Checking whether the plugin was disabled…",
      );
      await page.evaluate(() => {
        Reflect.get(window, "__setPluginDisablePhase")("failed");
        Reflect.get(window, "__releasePluginDisableCheck")();
      });
      await expect(dialog.getByRole("status")).toHaveText(
        "The plugin was not disabled. Try again or cancel.",
      );
      await visual.capture("plugins.disable.failed");
      await dialog
        .getByRole("button", { name: "Try disabling again", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
      await expect(
        page.locator('[data-plugin-id="weekly-plan"] .plugin-availability'),
      ).toHaveText("Disabled");
      expect(
        (await calls(page)).filter(
          (call) =>
            call.command === "plugin_disable" &&
            call.args.request?.operation === "begin",
        ),
      ).toHaveLength(2);
      expect(
        (await calls(page)).some(
          (call) =>
            call.command === "plugin_disable" &&
            ["cancel", "stop"].includes(call.args.request?.operation ?? ""),
        ),
      ).toBe(false);
    },
  );
}

for (const width of [1440, 700, 375]) {
  test(
    `the navigation shortcut opens plugin management at ${width}px`,
    {
      tag: width < 600 ? "@visual-mobile" : "@visual-desktop",
    },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(
        page,
        { ...shellState, mobile: width < 600 },
        { installedPlugins: [reading] },
      );
      await page.goto("/");
      await expect(page.locator(".topic-window")).toBeVisible();
      const shortcut = page
        .getByRole("navigation", { name: "Workspace navigation", exact: true })
        .getByRole("button", { name: "Plugins", exact: true });
      if (!(await shortcut.isVisible()))
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await expect(shortcut).toBeEnabled();
      await shortcut.click();
      await expect(page.locator(".plugin-card-grid")).toContainText(
        "Reading list",
      );
      await expect(page.locator(".navigation-drawer")).not.toBeVisible();
      await expect(page.locator(".settings-view")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "‹ All settings" }),
      ).toHaveCount(0);
      await expect(page.locator(".plugin-view h1")).toBeFocused();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      const opener = page.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      const collapse = page.getByRole("button", {
        name: "Collapse sidebar",
        exact: true,
      });
      if (width === 1440) {
        await expect(shortcut).toHaveAttribute("aria-current", "page");
        await expect(page.locator(".settings-action")).not.toHaveAttribute(
          "aria-current",
        );
        await collapse.click();
        await expect(opener).toBeFocused();
      }
      await expect(opener).toBeVisible();
      await visual.capture("plugins.navigation.collapsed");
      await opener.press("Enter");
      await expect(shortcut).toBeVisible();
      await expect(shortcut).toHaveAttribute("aria-current", "page");
      await expect(shortcut).toHaveCSS("font-weight", "650");
      await expect(page.locator(".settings-action")).not.toHaveAttribute(
        "aria-current",
      );
      if (width === 1440) await expect(collapse).toBeFocused();
      await shortcut.focus();
      await shortcut.hover();
      await expect(shortcut).toBeFocused();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await visual.capture("plugins.navigation.reopened");
      await page.locator(".settings-action").click();
      await expect(page.locator(".settings-view")).toBeVisible();
      await expect(page.locator(".plugin-view")).toHaveCount(0);
      if (width === 1440) {
        await expect(page.locator(".settings-action")).toHaveAttribute(
          "aria-current",
          "page",
        );
        await expect(shortcut).not.toHaveAttribute("aria-current");
      }
      await page.locator('[data-action="manage-plugins"]').press("Enter");
      await expect(page.locator(".plugin-view h1")).toBeFocused();
      await expect(page.locator(".settings-view")).toHaveCount(0);
      await page
        .getByRole("button", { name: "View files", exact: true })
        .click();
      await expect(page.locator(".plugin-files-view h1")).toHaveText(
        "Reading list",
      );
      if (width === 1440) {
        await collapse.click();
        await expect(opener).toBeFocused();
      }
      await opener.click();
      await expect(shortcut).toHaveAttribute("aria-current", "page");
      if (width === 1440) {
        await expect(collapse).toBeFocused();
      } else {
        await page.keyboard.press("Escape");
        await expect(opener).toBeFocused();
      }
      await expect(page.locator(".plugin-files-view h1")).toHaveText(
        "Reading list",
      );
      await page
        .getByRole("button", { name: "‹ Back to plugins", exact: true })
        .press("Enter");
      await expect(
        page.getByRole("button", { name: "View files", exact: true }),
      ).toBeFocused();
      expect(
        (await calls(page)).filter(
          (call) =>
            call.command === "plugin_runtime" &&
            call.args.request?.operation === "load",
        ),
      ).toEqual([]);
    },
  );
}

for (const width of [1440, 700]) {
  test(
    `plugin cards, read-only instructions and reversible disabling at ${width}px`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(page, shellState, {
        installedPlugins: [planning, reading],
        pluginSourceFiles: {
          "reading-list": {
            "skills/reading.md": instructions,
            "entry.js": source,
          },
        },
      });
      await page.goto("/");
      await settings(page);
      const grid = page.locator(".plugin-card-grid");
      const disabled = grid.locator('[data-plugin-id="reading-list"]');
      const enabled = grid.locator('[data-plugin-id="weekly-plan"]');
      await expect(grid.locator("article")).toHaveCount(2);
      const bounds = await page.locator(".plugin-view").boundingBox();
      expect(bounds!.width).toBeGreaterThan(width / 2);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await expect(disabled).toContainText(
        "Collect books to read from your notes.",
      );
      await expect(disabled.locator(".plugin-availability")).toHaveText(
        "Disabled",
      );
      await expect(
        disabled.getByRole("button", { name: "Settings", exact: true }),
      ).toHaveCount(0);
      await expect(grid.locator(".plugin-card-artwork")).toHaveCount(0);
      await visual.capture("plugins.management.collection");
      await disabled
        .getByRole("button", { name: "View files", exact: true })
        .press("Enter");
      await expect(page.locator(".file-tree")).toContainText("skills");
      await visual.capture("plugins.management.files");
      const folder = page
        .locator(".folder-entry")
        .filter({ hasText: "skills" });
      await folder.click();
      await expect(folder).toHaveAttribute("aria-expanded", "false");
      await folder.click();
      await page
        .locator(".file-entry")
        .filter({ hasText: "reading.md" })
        .press("Enter");
      await expect(page.locator(".markdown h1")).toHaveText("Reading list");
      await expect(page.locator(".markdown")).toContainText(
        "Ask before sending it anywhere.",
      );
      await expect(page.locator(".document-location h3")).toBeFocused();
      await visual.capture("plugins.management.instructions");
      if (!(await page.locator(".file-tree").isVisible()))
        await page
          .getByRole("button", { name: "Expand file browser", exact: true })
          .click();
      await page.locator(".file-entry").filter({ hasText: "entry.js" }).click();
      await expect(page.locator(".text-document")).toHaveText(source);
      await visual.capture("plugins.management.source");
      expect(
        await page.evaluate(() =>
          Reflect.get(window, "inspectedPluginExecuted"),
        ),
      ).toBeUndefined();
      expect(
        (await calls(page)).filter(
          (call) =>
            call.command === "plugin_runtime" &&
            call.args.request?.operation === "load" &&
            call.args.request.pluginId === "reading-list",
        ),
      ).toEqual([]);
      await page
        .getByRole("button", { name: "‹ Back to plugins", exact: true })
        .press("Enter");
      await expect(
        disabled.getByRole("button", { name: "View files", exact: true }),
      ).toBeFocused();
      await disabled
        .getByRole("button", { name: "Enable", exact: true })
        .click();
      await expect(disabled.locator(".plugin-availability")).toHaveText(
        "Enabled",
      );
      await enabled
        .getByRole("button", { name: "Disable", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(
        "The plugin’s code, configuration and data are retained.",
      );
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await expectDialogTypography(dialog);
      await visual.capture("plugins.management.disable-confirmation");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(
        enabled.getByRole("button", { name: "Disable", exact: true }),
      ).toBeFocused();
      await enabled
        .getByRole("button", { name: "Disable", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Disable", exact: true })
        .click();
      await expect(enabled.locator(".plugin-availability")).toHaveText(
        "Disabled",
      );
      await expect(grid.locator("article")).toHaveCount(2);
      await visual.capture("plugins.management.disabled");
      expect(
        (await calls(page))
          .filter(
            (call) =>
              call.command === "plugin_runtime" &&
              call.args.request?.operation === "setEnabled",
          )
          .map((call) => ({
            scope: call.args.scope,
            id: call.args.request!.pluginId,
            enabled: call.args.request!.enabled,
          })),
      ).toEqual([{ scope: "garden", id: "reading-list", enabled: true }]);
      expect(
        (await calls(page))
          .filter(
            (call) =>
              call.command === "plugin_disable" &&
              call.args.request?.operation === "begin",
          )
          .map((call) => ({
            scope: call.args.scope,
            id: call.args.request?.pluginId,
          })),
      ).toEqual([{ scope: "garden", id: "weekly-plan" }]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    },
  );
}

test(
  "empty management opens an unpublished development draft",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspaceFixture(page, shellState, {
      aiConversationTitle: "Garden plans",
      aiConnection: {
        provider: "custom",
        endpoint: "http://localhost:8888/v1",
      },
      aiModel: "test-model",
    });
    await page.goto("/");
    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await composer.fill("Keep this garden question unsent.");
    await settings(page);
    await expect(page.locator(".plugin-first-tool")).toContainText(
      "What should we make first?",
    );
    await expect(page.locator(".plugin-card-grid")).toHaveCount(0);
    await visual.capture("plugins.management.empty");
    await page
      .getByRole("button", { name: "Create a plugin", exact: true })
      .click();
    await expect(page.locator(".plugin-development")).toBeVisible();
    await expect(composer).toHaveValue("");
    await expect(page.locator(".conversation-destination")).toHaveCount(1);
    await composer.fill("Build a reading list.");
    await expect(page.locator(".conversation-destination")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Garden plans", exact: true })
      .click();
    await expect(composer).toHaveValue("Keep this garden question unsent.");
    await expect(page.locator(".conversation-destination")).toHaveCount(1);
    const ipc = await calls(page);
    expect(
      ipc.filter((call) =>
        [
          "plugin_development_create",
          "ai_create_conversation",
          "ai_begin",
          "ai_request",
        ].includes(call.command),
      ),
    ).toEqual([]);
  },
);

test("further development creates one conversation on submission with the same pane and plugin context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState, {
    installedPlugins: [reading],
    aiConversationTitle: "Garden plans",
    aiConnection: { provider: "custom", endpoint: "http://localhost:8888/v1" },
    aiModel: "test-model",
  });
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: "Adapt plugin", exact: true }).click();
  await expect(page.locator(".plugin-development")).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  const rows = page.locator(".conversation-destination");
  await expect(rows).toHaveCount(1);
  await composer.fill("   ");
  await composer.press("Enter");
  await expect(rows).toHaveCount(1);
  await composer.fill("Add a reading filter.");
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".plugin-development")).toBeVisible();
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toBeVisible();
  await composer.fill("Also sort by title.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(composer).toHaveValue("");
  await expect(rows).toHaveCount(2);
  const ipc = await page.evaluate(
    () =>
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: { id?: string; conversation?: string; initial?: unknown };
      }[],
  );
  const creates = ipc.filter(
    (call) => call.command === "ai_create_conversation",
  );
  expect(creates).toHaveLength(1);
  expect(creates[0]!.args.initial).toMatchObject({
    draft: "Add a reading filter.",
    development: { version: 2, pluginId: "reading-list" },
  });
  expect(
    (await nativeRequests(page)).map((request) => request.conversation),
  ).toEqual([creates[0]!.args.id, creates[0]!.args.id]);
  expect(ipc.some((call) => call.command === "plugin_development_create")).toBe(
    false,
  );
});

for (const failure of ["list", "source"] as const) {
  test(
    `unexpected ${failure} failure retains its recovery boundary`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await workspaceFixture(page, shellState, {
        installedPlugins: [reading],
        ...(failure === "list"
          ? { pluginListError: "native.plugins.unavailable" }
          : { pluginSourceError: "native.plugins.invalidPath" }),
      });
      await page.goto("/");
      await settings(page);
      if (failure === "source")
        await page
          .getByRole("button", { name: "View files", exact: true })
          .click();
      if (failure === "list") {
        const management = page.locator(".plugin-view");
        await expect(
          management.getByRole("heading", { name: "Plugins", exact: true }),
        ).toBeVisible();
        await expect(management.getByRole("alert")).toContainText(
          "Plugin source access is unavailable here.",
        );
        await expect(
          management.getByRole("button", { name: "Retry", exact: true }),
        ).toBeEnabled();
        await expect(management.locator(".plugin-first-tool")).toHaveCount(0);
      } else {
        const error = page
          .locator(".files-pane .file-notice")
          .filter({ hasText: "This plugin or source path cannot be opened." });
        await expect(error).toBeVisible();
        await expect(
          error.getByRole("button", { name: "Report a problem", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "‹ Back to plugins", exact: true }),
        ).toBeVisible();
      }
      await visual.capture(`plugins.management.${failure}-error`);
    },
  );
}

test(
  "recovery leaves inspection and development usable without plugin execution",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspaceFixture(page, shellState, {
      recovery: true,
      installedPlugins: [planning, reading],
      pluginSourceFiles: { "weekly-plan": { "SKILL.md": instructions } },
    });
    await page.goto("/");
    await settings(page);
    await expect(page.locator(".recovery-notice")).toBeVisible();
    const grid = page.locator(".plugin-card-grid");
    await expect(
      grid.getByRole("button", { name: "Enable", exact: true }),
    ).toBeEnabled();
    await expect(
      grid.getByRole("button", { name: "Settings", exact: true }),
    ).toHaveCount(0);
    await expect(
      grid.locator('[data-plugin-id="weekly-plan"] .plugin-availability'),
    ).toHaveText("Not running");
    await visual.capture("plugins.management.recovery");
    await grid
      .locator('[data-plugin-id="weekly-plan"]')
      .getByRole("button", { name: "View files", exact: true })
      .click();
    await page.locator(".file-entry").click();
    await expect(page.locator(".markdown h1")).toHaveText("Reading list");
    await page
      .getByRole("button", { name: "‹ Back to plugins", exact: true })
      .click();
    await grid
      .locator('[data-plugin-id="weekly-plan"]')
      .getByRole("button", { name: "Disable", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Disable", exact: true })
      .click();
    await expect(
      grid.locator('[data-plugin-id="weekly-plan"] .plugin-availability'),
    ).toHaveText("Disabled");
    await grid
      .locator('[data-plugin-id="reading-list"]')
      .getByRole("button", { name: "Adapt plugin", exact: true })
      .click();
    await expect(page.locator(".plugin-development")).toBeVisible();
    expect(
      (await calls(page)).filter(
        (call) =>
          call.command === "plugin_runtime" &&
          ["load", "check"].includes(call.args.request?.operation ?? ""),
      ),
    ).toEqual([]);
  },
);

test("recovery resumes individual plugins and then all without enabling disabled plugins @visual-desktop", async ({
  page,
  visual,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState, {
    recovery: true,
    installedPlugins: [
      planning,
      {
        ...planning,
        id: "other",
        manifest: { ...planning.manifest!, id: "other", name: "Other" },
      },
      reading,
    ],
  });
  await page.goto("/");
  await settings(page);
  const grid = page.locator(".plugin-card-grid");
  await grid
    .locator('[data-plugin-id="weekly-plan"]')
    .getByRole("button", { name: "Resume plugin", exact: true })
    .click();
  await expect(
    grid.locator('[data-plugin-id="weekly-plan"] .plugin-availability'),
  ).toHaveText("Enabled");
  await expect(
    grid.locator('[data-plugin-id="other"] .plugin-availability'),
  ).toHaveText("Not running");
  await expect(page.locator(".recovery-notice")).toBeVisible();
  await visual.capture("plugins.management.resumed-one");
  await page
    .getByRole("button", { name: "Resume all plugins", exact: true })
    .click();
  await expect(page.locator(".recovery-notice")).toHaveCount(0);
  await expect(
    grid.locator('[data-plugin-id="other"] .plugin-availability'),
  ).toHaveText("Enabled");
  await expect(
    grid.locator('[data-plugin-id="reading-list"] .plugin-availability'),
  ).toHaveText("Disabled");
  await visual.capture("plugins.management.resumed-all");
});

for (const state of ["paused", "disabled", "missing"] as const) {
  test(`a restored plugin pane ${state === "missing" ? "clears a removed installation" : `distinguishes unavailable installations (${state})`} @visual-desktop`, async ({
    page,
    visual,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const layout = reduceLayout(
      emptyLayout(),
      { type: "open", target: { kind: "view", viewId: "weekly-plan:main" } },
      randomUUID,
    );
    await workspaceFixture(page, shellState, {
      recovery: true,
      installedPlugins:
        state === "missing"
          ? []
          : [{ ...planning, enabled: state === "paused" }],
      layout: {
        records: {
          garden: {
            revision: "saved",
            pluginIncarnations: { "weekly-plan": planning.incarnation! },
            data: { version: 1, layout, pinnedViews: [] },
          },
        },
      },
    });
    await page.goto("/");
    await expect(page.locator(".topic-window")).toBeVisible({
      timeout: 15_000,
    });
    const pane = page.locator(".view-message");
    if (state === "missing") {
      await expect(pane).toHaveCount(0);
      await expect(page.locator(".view-chooser")).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(async () => {
            const record = await window.__layoutTest.stored("garden");
            const data = record.data as {
              layout: {
                tabs: {
                  panes: {
                    navigation: {
                      entries: { target: unknown; presentation: unknown }[];
                    };
                  }[];
                }[];
              };
            };
            return data.layout.tabs[0]!.panes[0]!.navigation.entries.at(-1);
          }),
        )
        .toMatchObject({ target: { kind: "empty" }, presentation: null });
      await visual.capture("plugins.pane.removed");
      return;
    }
    if (state === "paused") {
      await expect(
        pane.getByRole("heading", {
          name: "This plugin is paused",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        pane.getByRole("button", { name: "Resume plugin", exact: true }),
      ).toBeVisible();
      await expect(
        pane.getByRole("button", { name: "View files", exact: true }),
      ).toBeVisible();
      await visual.capture("plugins.pane.paused");
      await pane
        .getByRole("button", { name: "Manage plugins", exact: true })
        .click();
      await expect(page.locator(".plugin-card-grid")).toBeVisible();
    } else {
      await expect(
        pane.getByRole("button", { name: "Resume plugin", exact: true }),
      ).toHaveCount(0);
      await expect(pane.getByRole("heading")).toHaveText("View unavailable");
      const openView = pane.getByRole("button", {
        name: "Open a view",
        exact: true,
      });
      await expect(openView).toBeEnabled();
      await expect(openView).not.toHaveAttribute("aria-busy", "true");
      await expect(openView).toHaveClass(/situate-button--secondary/);
      await visual.capture(`plugins.pane.${state}`);
      await openView.focus();
      await expect(openView).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("region", { name: "Open a view", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".pane-tile")).toHaveCount(1);
      await page
        .getByRole("button", { name: "Back in this pane", exact: true })
        .click();
      await expect(pane.getByRole("heading")).toHaveText("View unavailable");
      await expect(openView).toBeEnabled();
      await openView.press("Space");
      await expect(
        page.getByRole("region", { name: "Open a view", exact: true }),
      ).toBeVisible();
    }
  });
}

test("an enabled settings contribution loads local modules and opens in the workspace rather than behind management", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await workspaceFixture(page, shellState, {
    installedPlugins: [{ ...reading, enabled: true }],
    pluginSources: {
      "reading-list": {
        manifest: reading.manifest!,
        skills: [],
        serviceEntry: null,
        uiEntry: `import createSettings from "./views/settings.js";
import { recordOpen } from "./state.js";
export default (host) => {
  recordOpen();
  return { settings: createSettings(host) };
};`,
        modules: {
          "state.js":
            "export let opens = 0; export const recordOpen = () => { opens++; };",
          "copy.js": 'export { title } from "./copy/en.js";',
          "copy/en.js": 'export const title = "Reading list settings";',
          "views/settings.js": `import { opens } from "../state.js";
import { title } from "../copy.js";
export default ({vue}) => ({
  id: "reading-list:settings",
  title: () => title,
  icon: "notes",
  component: vue.defineComponent({
    setup: () => () => vue.h("section", {"data-localization-content": "user"}, [
      vue.h("p", title),
      vue.h("p", {"data-testid": "open-count"}, String(opens)),
    ]),
  }),
});`,
        },
      },
    },
  });
  await page.goto("/");
  await settings(page);
  await page
    .locator(".plugin-card-grid")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page.locator(".plugin-view")).toHaveCount(0);
  await expect(page.locator(".settings-view")).toHaveCount(0);
  await expect(
    page.getByText("Reading list settings", { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByTestId("open-count")).toHaveText("1");
});
