import { chooseSelect } from "./select";
import { expect, test, type Page } from "./test";
import { t } from "@situate/localization";
import { shellState, workspaceFixture } from "./workspace-fixture";
test.use({ localizationMode: "real" });
async function settings(page: Page) {
  const navigation = page.getByRole("button", {
    name: t("navigation.openNavigation"),
    exact: true,
  });
  await expect(
    page.getByRole("textbox", { name: t("navigation.message"), exact: true }),
  ).toBeVisible();
  if (await navigation.isVisible()) await navigation.click();
  await page
    .getByRole("button", { name: t("navigation.settings"), exact: true })
    .click();
  await page
    .getByRole("button", { name: t("settings.ai.title"), exact: true })
    .click();
}
const configs = [
  {
    connectionId: "personal",
    label: "Personal",
    provider: "openai",
    endpoint: null,
  },
  { connectionId: "work", label: "Work", provider: "openai", endpoint: null },
];
for (const width of [375, 1280]) {
  test(
    `same-provider connection selection and confirmed device forgetting at ${width}px`,
    { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual, browserName }) => {
      await page.setViewportSize({ width, height: 850 });
      await workspaceFixture(page, shellState, {
        aiConnections: configs,
        aiModel: "gpt-4.1",
      });
      await page.goto("/");
      const draft = page.getByRole("textbox", {
        name: t("navigation.message"),
        exact: true,
      });
      await draft.fill("Outline the weekend planting plan.");
      await settings(page);
      const work = page
        .locator(".connections li")
        .filter({ has: page.getByText("Work", { exact: true }) });
      await chooseSelect(page.locator("#chat-connection"), "work");
      await expect(
        work.getByText(t("ai.connections.selected"), { exact: true }),
      ).toBeVisible();
      await chooseSelect(page.locator("#chat-connection"), "personal");
      await page.locator(".advanced-settings summary").click();
      await expect(page.locator("#settings-chat-model")).toHaveAttribute(
        "data-value",
        "gpt-4.1",
      );
      await visual.capture("ai.connections.selected");
      await work
        .getByRole("button", { name: t("ai.connections.rename"), exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const name = dialog.getByRole("textbox");
      await expect(name).toBeFocused();
      const cancel = dialog.getByRole("button", {
        name: t("navigation.cancel"),
        exact: true,
      });
      const rename = dialog.getByRole("button", {
        name: t("ai.connections.rename"),
        exact: true,
      });
      await expect(cancel).toHaveClass(/situate-button--secondary/);
      await expect(rename).toHaveClass(/situate-button--primary/);
      // WebKit follows the host's native keyboard-navigation preference.
      if (browserName === "chromium") {
        await page.keyboard.press("Tab");
        await expect(cancel).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(rename).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(cancel).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(name).toBeFocused();
      }
      await name.fill("Personal");
      await dialog
        .getByRole("button", { name: t("ai.connections.rename"), exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(name).toBeFocused();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await visual.capture("ai.connections.duplicate-name");
      await name.fill("Studio");
      await dialog
        .getByRole("button", { name: t("ai.connections.rename"), exact: true })
        .click();
      const studio = page
        .locator(".connections li")
        .filter({ has: page.getByText("Studio", { exact: true }) });
      await expect(studio).toBeVisible();
      await expect(page.locator("#chat-connection")).toHaveAttribute(
        "data-value",
        "personal",
      );
      await studio
        .getByRole("button", { name: t("ai.connections.manage"), exact: true })
        .click();
      await expect(dialog).toBeVisible();
      await visual.capture("ai.connections.manage");
      await dialog
        .getByRole("button", { name: t("ai.connections.forget"), exact: true })
        .click();
      await expect(
        dialog.getByText(t("ai.connections.forgetEffect"), { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", {
          name: t("ai.connections.forget"),
          exact: true,
        }),
      ).toHaveClass(/situate-button--danger/);
      await visual.capture("ai.connections.forget-confirmation");
      await page.keyboard.press("Escape");
      await expect(
        studio.getByRole("button", {
          name: t("ai.connections.manage"),
          exact: true,
        }),
      ).toBeFocused();
      await studio
        .getByRole("button", { name: t("ai.connections.manage"), exact: true })
        .click();
      await dialog
        .getByRole("button", { name: t("ai.connections.forget"), exact: true })
        .click();
      await dialog
        .getByRole("button", { name: t("ai.connections.forget"), exact: true })
        .click();
      await expect(
        studio.getByText(t("native.ai.access.required"), { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".connections li")).toHaveCount(2);
      await visual.capture("ai.connections.forgotten");
      await studio
        .getByRole("button", {
          name: t("ai.connections.disconnect"),
          exact: true,
        })
        .click();
      await expect(
        dialog.getByText(t("ai.connections.removeEffect"), { exact: true }),
      ).toBeVisible();
      await visual.capture("ai.connections.remove-confirmation");
      await dialog
        .getByRole("button", { name: t("ai.connections.remove"), exact: true })
        .click();
      await expect(page.locator(".connections li")).toHaveCount(1);
      expect(
        await page.evaluate(() =>
          Reflect.get(window, "__ipcCalls").filter(
            (call: { command: string }) =>
              call.command === "ai_rename_connection",
          ),
        ),
      ).toEqual([
        {
          command: "ai_rename_connection",
          args: { scope: "garden", connectionId: "work", label: "Studio" },
        },
      ]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const navigation = page.getByRole("button", {
        name: t("navigation.openNavigation"),
        exact: true,
      });
      if (await navigation.isVisible()) await navigation.click();
      await page.locator(".conversation-destination").first().click();
      await expect(draft).toHaveValue("Outline the weekend planting plan.");
    },
  );
}
for (const width of [375, 1280]) {
  test(
    `adding a second OpenAI account preserves the selected connection at ${width}px`,
    { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 850 });
      await workspaceFixture(page, shellState, {
        aiConnections: [configs[0]!],
        aiModel: "gpt-4.1",
      });
      await page.goto("/");
      await settings(page);
      await page
        .getByRole("button", { name: t("ai.connections.add"), exact: true })
        .click();
      await page
        .locator(".ai-provider-grid button")
        .filter({ has: page.getByText("OpenAI", { exact: true }) })
        .click();
      await page
        .getByLabel(t("ai.connections.label"), { exact: true })
        .fill("Studio");
      await page
        .locator(".ai-choices button")
        .filter({ has: page.getByText(t("ai.apiKeyMethod"), { exact: true }) })
        .click();
      await page.locator("#ai-key").fill("synthetic-second-key");
      await page
        .getByRole("button", { name: t("ai.saveAIAccess"), exact: true })
        .click();
      await expect(page.locator(".connections li")).toHaveCount(2);
      await expect(
        page.locator(".connections li").getByText("Studio", { exact: true }),
      ).toBeVisible();
      await expect(page.locator("#chat-connection")).toHaveAttribute(
        "data-value",
        "personal",
      );
      await page.locator(".advanced-settings summary").click();
      await expect(page.locator("#settings-chat-model")).toHaveAttribute(
        "data-value",
        "gpt-4.1",
      );
      await visual.capture("ai.connections.added-without-selecting");
      await chooseSelect(page.locator("#chat-connection"), { label: "Studio" });
      await expect(page.locator("#settings-chat-model")).toHaveAttribute(
        "data-value",
        "recommended",
      );
      await chooseSelect(page.locator("#chat-connection"), "personal");
      await expect(page.locator("#settings-chat-model")).toHaveAttribute(
        "data-value",
        "gpt-4.1",
      );
      const calls = await page.evaluate(
        () =>
          Reflect.get(window, "__ipcCalls") as {
            command: string;
            args: { config?: { label: string }; key?: string };
          }[],
      );
      expect(
        calls
          .filter((call) => call.command === "ai_save")
          .map((call) => call.args),
      ).toEqual([
        {
          scope: "garden",
          config: { provider: "openai", endpoint: null, label: "Studio" },
          key: "synthetic-second-key",
        },
      ]);
      expect(
        calls.filter((call) =>
          ["ai_begin", "ai_request"].includes(call.command),
        ),
      ).toEqual([]);
    },
  );
}

test(
  "custom endpoint optional key and destination-specific HTTP consent stay inside Settings",
  { tag: "@visual-mobile" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await workspaceFixture(page, shellState);
    await page.goto("/");
    await settings(page);
    await page
      .getByRole("button", { name: t("ai.connections.add"), exact: true })
      .click();
    await page
      .getByRole("button", { name: t("ai.compatibleEndpoint") })
      .click();
    await page
      .getByLabel(t("ai.connections.label"), { exact: true })
      .fill("Local server");
    const endpoint = page.getByLabel(t("ai.openaiCompatibleEndpoint"), {
      exact: true,
    });
    await endpoint.fill("http://localhost:8888/v1");
    const consent = page.getByRole("checkbox", {
      name: t("ai.connections.httpConsent"),
      exact: true,
    });
    await expect(consent).not.toBeChecked();
    await visual.capture("ai.connections.http-warning");
    await consent.check();
    await endpoint.fill("http://localhost:9999/v1");
    await expect(consent).not.toBeChecked();
    await visual.capture("ai.connections.http-destination-changed");
    await consent.check();
    await page
      .getByRole("button", { name: t("ai.saveAIAccess"), exact: true })
      .click();
    await expect(
      page
        .locator(".connections li")
        .getByText("Local server", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".settings-content .ai-settings")).toBeVisible();
    await visual.capture("ai.connections.custom-model-required");
    const saves = await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter(
        (call: { command: string }) => call.command === "ai_save",
      ),
    );
    expect(saves).toHaveLength(1);
    expect(saves[0].args).toEqual({
      scope: "garden",
      config: {
        provider: "custom",
        endpoint: "http://localhost:9999/v1",
        label: "Local server",
        httpAcknowledgement: "http://localhost:9999/v1",
      },
      key: "",
    });
  },
);
test(
  "device login on the same phone waits for native approval and opens only its attempt",
  { tag: "@visual-mobile" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await workspaceFixture(page, shellState, {
      aiDeviceOutcome: "pending",
      aiConnections: configs,
      aiModel: "gpt-4.1",
    });
    await page.goto("/");
    await settings(page);
    await page
      .getByRole("button", { name: t("ai.connections.add"), exact: true })
      .click();
    await page
      .getByRole("button", { name: t("ai.providers.codex"), exact: true })
      .click();
    await page.getByLabel(t("ai.connections.label")).fill("Travel");
    await page.locator(".ai-choices button").click();
    await page
      .getByRole("button", { name: t("ai.device.start"), exact: true })
      .click();
    await expect(page.locator(".device-code")).toHaveText("FAKE-CODE");
    await expect(page.locator(".device-login input")).toHaveCount(0);
    const colors = await page
      .getByRole("button", { name: t("ai.device.open"), exact: true })
      .evaluate((button) => {
        const style = getComputedStyle(button);
        return { text: style.color, background: style.backgroundColor };
      });
    expect(colors.text).not.toBe(colors.background);
    await visual.capture("ai.connections.device-code");
    await page
      .getByRole("button", { name: t("ai.device.open"), exact: true })
      .click();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      Reflect.get(window, "__finishDeviceLogin")();
    });
    await expect(
      page.locator(".connections li").getByText("Travel", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("#chat-connection")).toHaveAttribute(
      "data-value",
      "personal",
    );
    const calls = await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter(
        (call: { command: string }) => call.command === "ai_codex_open",
      ),
    );
    expect(calls).toEqual([
      { command: "ai_codex_open", args: { scope: "garden", id: "device-1" } },
    ]);
  },
);
test(
  "device authorization denial preserves existing access",
  { tag: "@visual-mobile" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await workspaceFixture(page, shellState, {
      aiConnections: configs,
      aiDeviceOutcome: "denied",
    });
    await page.goto("/");
    await settings(page);
    await page
      .getByRole("button", { name: t("ai.connections.add"), exact: true })
      .click();
    await page
      .getByRole("button", { name: t("ai.providers.codex"), exact: true })
      .click();
    await page.locator(".ai-choices button").click();
    await page
      .getByRole("button", { name: t("ai.device.start"), exact: true })
      .click();
    await expect(
      page.getByText(t("native.ai.login.denied"), { exact: true }),
    ).toBeVisible();
    await visual.capture("ai.connections.device-denied");
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__ipcCalls").filter((call: { command: string }) =>
          ["ai_save", "ai_remove", "ai_forget_connection"].includes(
            call.command,
          ),
        ),
      ),
    ).toEqual([]);
  },
);

test(
  "a new device offers ordinary local setup and retains the conversation draft",
  { tag: "@visual-mobile" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await workspaceFixture(page, shellState, {
      aiConversationTitle: "Garden layout",
    });
    await page.goto("/");
    const draft = page.getByRole("textbox", {
      name: t("navigation.message"),
      exact: true,
    });
    await draft.fill("Keep the garden path accessible.");
    await expect(
      page.getByRole("button", {
        name: t("navigation.sendMessage"),
        exact: true,
      }),
    ).toBeDisabled();
    await settings(page);
    await expect(
      page.getByText(t("ai.connections.empty"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await visual.capture("ai.connections.new-device");
    await page
      .getByRole("button", { name: t("ai.connections.add"), exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: t("ai.chooseAProvider"), exact: true }),
    ).toBeVisible();
    await visual.capture("ai.connections.new-device-setup");
    await page
      .locator(".ai-embedded")
      .getByRole("button", { name: t("navigation.cancel"), exact: true })
      .click();
    await page
      .getByRole("button", {
        name: t("navigation.openNavigation"),
        exact: true,
      })
      .click();
    await page.locator(".conversation-destination").first().click();
    await expect(draft).toHaveValue("Keep the garden path accessible.");
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__ipcCalls").filter((call: { command: string }) =>
          ["ai_associate_connections", "ai_begin", "ai_request"].includes(
            call.command,
          ),
        ),
      ),
    ).toEqual([]);
  },
);
