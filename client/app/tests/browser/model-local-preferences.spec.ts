import { chooseSelect } from "./select";
import { expect, test, type Page } from "./test";
import { t } from "@situate/localization";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
} from "./workspace-fixture";

test.use({ localizationMode: "real" });
const connections = [
  {
    connectionId: "personal",
    label: "Personal",
    provider: "openai",
    endpoint: null,
  },
  { connectionId: "work", label: "Work", provider: "openai", endpoint: null },
];
const model = (page: Page) =>
  page.getByRole("button", { name: t("ai.model"), exact: true });
const draft = (page: Page) =>
  page.getByRole("textbox", { name: t("navigation.message"), exact: true });
const send = (page: Page) =>
  page.getByRole("button", { name: t("navigation.sendMessage"), exact: true });
const calls = (page: Page) =>
  page.evaluate(
    () =>
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: {
          model?: string | null;
          thinking?: string | null;
          connectionId?: string;
          config?: { connectionId: string };
          settings?: unknown;
        };
      }[],
  );
async function navigation(page: Page) {
  const button = page.getByRole("button", {
    name: t("navigation.openNavigation"),
    exact: true,
  });
  if (await button.isVisible()) await button.click();
}
async function settings(page: Page) {
  await navigation(page);
  await page
    .getByRole("button", { name: t("navigation.settings"), exact: true })
    .click();
  await page
    .getByRole("button", { name: t("settings.ai.title"), exact: true })
    .click();
  await expect(page.locator(".ai-settings .connections")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function chat(page: Page) {
  await navigation(page);
  await page.locator(".conversation-destination").first().click();
}
async function choose(page: Page, value: string, kind = "model") {
  await page
    .getByRole("button", {
      name: t(kind === "model" ? "ai.model" : "settings.ai.thinking"),
      exact: true,
    })
    .click();
  await page
    .getByRole("menu")
    .locator(`[role="menuitemradio"][data-choice="${value}"]`)
    .click();
}

for (const width of [375, 1280]) {
  const tag = width < 600 ? "@visual-mobile" : "@visual-desktop";
  test(
    `a local override keeps account A when default B changes or is removed at ${width}px`,
    { tag },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 850 });
      await workspaceFixture(page, shellState, {
        aiConnections: connections,
        aiModel: "gpt-5.4",
        showInlineModel: true,
      });
      await page.goto("/");
      await draft(page).fill("Keep the account-specific draft.");
      await choose(page, "gpt-4.1");
      await settings(page);
      await expect(page.locator(".advanced-settings")).not.toHaveAttribute(
        "open",
        "",
      );
      await chooseSelect(page.locator("#chat-connection"), "work");
      await expect(page.locator("#chat-connection")).toHaveAttribute(
        "data-value",
        "work",
      );
      await chat(page);
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /Personal.*gpt-4\.1/u,
      );
      await model(page).click();
      await expect(
        page.getByRole("menu").locator('[data-choice=""] small'),
      ).toHaveText("Work · openai · gpt-6.1-sol");
      await expect(
        page.getByRole("menu").locator('[data-choice="gpt-4.1"]'),
      ).toHaveAttribute("aria-checked", "true");
      await visual.capture("model.local.account-bound");
      await page.keyboard.press("Escape");
      await choose(page, "");
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /Work.*gpt-6\.1-sol/u,
      );
      await expect(model(page)).toContainText("GPT-6.1 Sol");
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /Workspace default/u,
      );
      await expect(draft(page)).toHaveValue("Keep the account-specific draft.");
      await visual.capture("model.local.default-restored");
      await settings(page);
      await chooseSelect(page.locator("#chat-connection"), "personal");
      await chat(page);
      await choose(page, "gpt-4.1");
      await settings(page);
      await chooseSelect(page.locator("#chat-connection"), "work");
      const work = page
        .locator(".connections li")
        .filter({ has: page.getByText("Work", { exact: true }) });
      await work
        .getByRole("button", {
          name: t("ai.connections.disconnect"),
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: t("ai.connections.remove"), exact: true })
        .click();
      await expect(page.locator("#chat-connection")).toHaveAttribute(
        "data-value",
        "",
      );
      await chat(page);
      await expect(model(page)).toHaveAttribute(
        "aria-description",
        /Personal.*gpt-4\.1/u,
      );
      await expect(send(page)).toBeEnabled();
      await model(page).click();
      await expect(
        page.getByRole("menu").locator('[data-choice=""] small'),
      ).toHaveText(t("ai.workspaceDefaultUnavailable"));
      await page.keyboard.press("Escape");
      await expect(draft(page)).toHaveValue("Keep the account-specific draft.");
      await send(page).click();
      await expect(
        page.getByText("A streamed test response.", { exact: true }),
      ).toBeVisible();
      expect(
        (await nativeRequests(page)).map(({ model, config }) => ({
          model,
          connection: config?.connectionId,
        })),
      ).toEqual([{ model: "gpt-4.1", connection: "personal" }]);
      expect(
        (await calls(page))
          .filter((call) => call.command === "ai_select_conversation_model")
          .map((call) => call.args.model),
      ).toEqual(["gpt-4.1", null, "gpt-4.1"]);
      await visual.capture("model.local.default-removed");
    },
  );

  test(
    `thinking choices retain per-model overrides and restore recommended defaults at ${width}px`,
    { tag },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 850 });
      await workspaceFixture(page, shellState, {
        aiConnection: connections[0],
        aiModel: "gpt-6.1-sol",
        showInlineModel: true,
      });
      await page.goto("/");
      await draft(page).fill("Keep this thinking draft.");
      const thinking = page.getByRole("button", {
        name: t("settings.ai.thinking"),
        exact: true,
      });
      await expect(thinking).toContainText(t("settings.ai.thinking.medium"));
      await expect(thinking).toHaveAttribute(
        "aria-description",
        /Workspace default/u,
      );
      await choose(page, "high", "thinking");
      await expect(thinking).toHaveText(t("settings.ai.thinking.high"));
      await choose(page, "gpt-5.4");
      await expect(thinking).toHaveCount(0);
      await choose(page, "gpt-6.1-sol");
      await expect(thinking).toHaveText(t("settings.ai.thinking.high"));
      await thinking.click();
      await expect(
        page
          .getByRole("menu")
          .locator('[role="menuitemradio"][data-choice="high"]'),
      ).toHaveAttribute("aria-checked", "true");
      await visual.capture("model.local.thinking-menu");
      await page.keyboard.press("Escape");
      await choose(page, "", "thinking");
      await expect(thinking).toContainText(t("settings.ai.thinking.medium"));
      await expect(thinking).toHaveAttribute(
        "aria-description",
        /Workspace default/u,
      );
      await settings(page);
      await page.locator(".advanced-settings summary").click();
      await chooseSelect(page.locator("#settings-thinking"), "high");
      const defaultThinking = page.locator("#settings-thinking");
      await expect(defaultThinking).toHaveAttribute("data-value", "high");
      await expect(defaultThinking).toBeEnabled();
      await defaultThinking.evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await expect(defaultThinking).toBeInViewport();
      await visual.capture("model.local.thinking-default");
      await chat(page);
      await expect(thinking).toContainText(t("settings.ai.thinking.high"));
      await expect(thinking).toHaveAttribute(
        "aria-description",
        /Workspace default/u,
      );
      await choose(page, "recommended", "thinking");
      await expect(thinking).toContainText(t("settings.ai.thinking.medium"));
      await expect(thinking).toHaveAttribute(
        "aria-description",
        /Recommended/u,
      );
      await expect(draft(page)).toHaveValue("Keep this thinking draft.");
      await send(page).click();
      await expect(
        page.getByText("A streamed test response.", { exact: true }),
      ).toBeVisible();
      expect(
        (await calls(page))
          .filter((call) => call.command === "ai_select_conversation_thinking")
          .map((call) => call.args.thinking),
      ).toEqual(["high", null, "recommended"]);
      await visual.capture("model.local.thinking-recommended");
    },
  );
}
