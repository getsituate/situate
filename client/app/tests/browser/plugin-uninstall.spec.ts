import { expect, test, type Page } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import { expectDialogTypography } from "./dialog-typography";
import type { InstalledPlugin } from "../../src/plugins/types";

test.use({ localizationMode: "real", locale: "en-US" });

const reading: InstalledPlugin = {
  id: "reading-list",
  enabled: false,
  error: null,
  manifest: {
    schemaVersion: 1,
    id: "reading-list",
    name: "Reading list",
    description: "Collect books to read from your notes.",
    skills: [],
  },
};

async function openManagement(
  page: Page,
  plugins = [reading],
  recovery = false,
) {
  await workspaceFixture(page, shellState, {
    installedPlugins: plugins,
    recovery,
  });
  await page.goto("/");
  await page.locator(".topic-window").waitFor({ state: "visible" });
  const navigation = page.getByRole("button", { name: "Plugins", exact: true });
  if (!(await navigation.isVisible()))
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await navigation.click();
  await expect(page.locator(".plugin-card-grid")).toBeVisible();
}

async function openUninstall(page: Page, captureMenu?: () => Promise<void>) {
  const more = page.getByRole("button", {
    name: "More actions for Reading list",
    exact: true,
  });
  await more.focus();
  await more.press("ArrowDown");
  const item = page.getByRole("menuitem", { name: "Uninstall…", exact: true });
  await expect(item).toBeFocused();
  await captureMenu?.();
  await item.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Uninstall Reading list?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return { dialog, more };
}

async function uninstallFixture(
  page: Page,
  outcome: "success" | "stateBusy" | "unknown" | "unknown-removed" | "pending",
) {
  await page.evaluate(
    ({ outcome }) => {
      const internals = Reflect.get(window, "__TAURI_INTERNALS__");
      const invoke = internals.invoke.bind(internals);
      let removed = false;
      let attempts = 0;
      let finish: (() => void) | undefined;
      Reflect.set(window, "finishUninstall", () => finish?.());
      Reflect.set(window, "uninstallAttempts", () => attempts);
      internals.invoke = async (
        command: string,
        args: {
          scope?: string;
          request?: { operation: string; pluginId?: string };
        },
      ) => {
        if (
          command === "plugin_runtime" &&
          args.request?.operation === "uninstall"
        ) {
          attempts++;
          if (outcome === "stateBusy" && attempts === 1)
            throw "native.plugins.stateBusy";
          if (outcome === "unknown") throw "native.plugins.stateOutcomeUnknown";
          if (outcome === "pending")
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          removed = true;
          if (outcome === "unknown-removed")
            throw "native.plugins.stateOutcomeUnknown";
          return { revision: "removed" };
        }
        const result = await invoke(command, args);
        if (
          command === "plugin_runtime" &&
          args.request?.operation === "list" &&
          removed
        )
          return {
            ...result,
            revision: "removed",
            plugins: result.plugins.filter(
              (p: { id: string }) => p.id !== "reading-list",
            ),
          };
        return result;
      };
    },
    { outcome },
  );
}

for (const width of [1100, 375]) {
  test(
    `keyboard uninstall confirmation restores focus and fits at ${width}px in recovery`,
    { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, browserName, visual }) => {
      await page.setViewportSize({ width, height: 800 });
      await openManagement(page, [reading], true);
      const { dialog, more } = await openUninstall(page, () =>
        visual.capture("plugins.uninstall.menu"),
      );
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await expect(dialog).toContainText(
        "Your notes, tasks, documents and chats stay.",
      );
      await expect(
        dialog.getByRole("button", { name: "Disable instead", exact: true }),
      ).toHaveCount(0);
      await expectDialogTypography(dialog);
      await visual.capture("plugins.uninstall.confirmation");
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const tab =
        process.platform === "darwin" && browserName === "webkit"
          ? "Alt+Tab"
          : "Tab";
      await page.keyboard.press(tab);
      await expect(
        dialog.getByRole("button", { name: "Uninstall plugin", exact: true }),
      ).toBeFocused();
      await page.keyboard.press(`Shift+${tab}`);
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(more).toBeFocused();
    },
  );
}

test(
  "disabled direct and indirect dependents block uninstall; Disable instead uses the existing confirmation",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    const base = { ...reading, enabled: true };
    const direct = {
      ...reading,
      id: "direct",
      manifest: {
        ...reading.manifest!,
        id: "direct",
        name: "Direct consumer",
        dependencies: ["reading-list"],
      },
    };
    const indirect = {
      ...reading,
      id: "indirect",
      manifest: {
        ...reading.manifest!,
        id: "indirect",
        name: "Indirect consumer",
        dependencies: ["direct"],
      },
    };
    await openManagement(page, [base, direct, indirect]);
    const { dialog, more } = await openUninstall(page);
    await expect(dialog.getByRole("listitem")).toHaveText([
      "Direct consumer",
      "Indirect consumer",
    ]);
    await expect(
      dialog.getByRole("button", { name: "Uninstall plugin", exact: true }),
    ).toHaveCount(0);
    await expectDialogTypography(dialog);
    await visual.capture("plugins.uninstall.dependencies");
    await dialog
      .getByRole("button", { name: "Disable instead", exact: true })
      .click();
    const disable = page.getByRole("dialog");
    await expect(disable).toContainText(
      "The plugin’s code, configuration and data are retained.",
    );
    await expect(
      disable.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
  },
);

test(
  "pending removal cannot duplicate or dismiss; success removes the card and announces its name",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await openManagement(page);
    await uninstallFixture(page, "pending");
    const { dialog } = await openUninstall(page);
    await dialog
      .getByRole("button", { name: "Uninstall plugin", exact: true })
      .click();
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Uninstall plugin", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await visual.capture("plugins.uninstall.pending");
    await page.evaluate(() => Reflect.get(window, "finishUninstall")());
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-plugin-id="reading-list"]')).toHaveCount(
      0,
    );
    await expect(page.locator(".plugin-announcement")).toHaveText(
      "Reading list uninstalled.",
    );
    await expect(
      page.getByRole("heading", { name: "Plugins", exact: true }),
    ).toBeFocused();
    await visual.capture("plugins.uninstall.success");
    expect(
      await page.evaluate(() => Reflect.get(window, "uninstallAttempts")()),
    ).toBe(1);
  },
);

test(
  "a known preflight refusal can be retried explicitly",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await openManagement(page);
    await uninstallFixture(page, "stateBusy");
    const { dialog } = await openUninstall(page);
    await dialog
      .getByRole("button", { name: "Uninstall plugin", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Couldn’t uninstall. Try again.",
    );
    await visual.capture("plugins.uninstall.retry");
    await dialog
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".plugin-announcement")).toHaveText(
      "Reading list uninstalled.",
    );
  },
);

for (const outcome of ["unknown", "unknown-removed"] as const) {
  test(
    `uncertain removal re-reads inventory without offering retry (${outcome})`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      await openManagement(page);
      await uninstallFixture(page, outcome);
      const { dialog } = await openUninstall(page);
      await dialog
        .getByRole("button", { name: "Uninstall plugin", exact: true })
        .click();
      if (outcome === "unknown") {
        await expect(dialog.getByRole("alert")).toContainText(
          "Couldn’t confirm whether the plugin was uninstalled.",
        );
        await expect(
          dialog.getByRole("button", { name: "Try again", exact: true }),
        ).toHaveCount(0);
        await visual.capture("plugins.uninstall.unknown");
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        const reopened = await openUninstall(page);
        await expect(
          reopened.dialog.getByRole("button", {
            name: "Uninstall plugin",
            exact: true,
          }),
        ).toHaveCount(0);
      } else {
        await expect(dialog).toHaveCount(0);
        await expect(
          page.locator('[data-plugin-id="reading-list"]'),
        ).toHaveCount(0);
        await expect(page.locator(".plugin-announcement")).toHaveText(
          "Couldn’t confirm whether Reading list was uninstalled. Check this workspace before trying again.",
        );
        await expect(
          page.getByRole("heading", { name: "Plugins", exact: true }),
        ).toBeFocused();
        await visual.capture("plugins.uninstall.unknown-removed");
      }
      expect(
        await page.evaluate(() => Reflect.get(window, "uninstallAttempts")()),
      ).toBe(1);
    },
  );
}
