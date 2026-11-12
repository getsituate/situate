import { chooseSelect } from "./select";
import { expect, test, type Page } from "./test";
import { t } from "@situate/localization";
import { shellState, workspaceFixture } from "./workspace-fixture";
test.use({ localizationMode: "real" });

async function navigation(page: Page): Promise<void> {
  const button = page.getByRole("button", {
    name: t("navigation.openNavigation"),
    exact: true,
  });
  await expect(
    button
      .or(
        page.getByRole("button", {
          name: t("navigation.settings"),
          exact: true,
        }),
      )
      .first(),
  ).toBeVisible();
  if (await button.isVisible()) await button.click();
}
async function settings(page: Page): Promise<void> {
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
  await expect(page.locator(".ai-settings")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.locator(".advanced-settings summary").click();
  await expect(page.locator(".advanced-settings")).toHaveAttribute("open", "");
}
async function chat(page: Page): Promise<void> {
  await navigation(page);
  await page.locator(".conversation-destination").first().click();
}
const connection = {
  provider: "openai",
  endpoint: null,
  connectionId: "work",
  label: "Work",
};

test(
  "provider metadata omissions never reject an explicit compatible model or submit the draft",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 1280, height: 850 });
    await workspaceFixture(page, shellState, {
      aiConnection: connection,
      aiModel: "gpt-5.4",
      showInlineModel: true,
      aiCatalogs: { work: { source: "provider", models: ["gpt-4o-mini"] } },
      aiRefreshCatalogs: { work: [{ source: "provider", models: [] }] },
    });
    await page.goto("/");
    const draft = page.getByRole("textbox", {
      name: t("navigation.message"),
      exact: true,
    });
    await draft.fill("Compare the two workshop schedules.");
    const inline = page.getByRole("button", {
      name: t("ai.model"),
      exact: true,
    });
    await expect(inline).toHaveAttribute("aria-description", /gpt-5\.4/u);
    await expect(inline).toBeEnabled();
    await inline.click();
    await expect(
      page
        .getByRole("menu")
        .locator('[role="menuitemradio"][data-choice="gpt-6.1-sol"]'),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await settings(page);
    await expect(
      page.getByText(t("ai.models.provider"), { exact: true }),
    ).toBeVisible();
    await expect(page.locator("#settings-chat-model")).toHaveAttribute(
      "data-value",
      "gpt-5.4",
    );
    await visual.capture("model.discovery.provider-observation");
    await page
      .getByRole("button", { name: t("ai.models.refresh"), exact: true })
      .click();
    await expect(
      page.getByText(t("ai.models.empty"), { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(
        '#settings-chat-model + select option[value="recommended"], #settings-comment-model + select option[value="recommended"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator("#settings-chat-model")).toHaveAttribute(
      "data-value",
      "gpt-5.4",
    );
    await visual.capture("model.discovery.empty-retained-selection");
    await chat(page);
    await expect(inline).toHaveAttribute("aria-description", /gpt-5\.4/u);
    await expect(inline).toBeEnabled();
    await expect(draft).toHaveValue("Compare the two workshop schedules.");
    await expect(
      page.getByRole("button", {
        name: t("navigation.sendMessage"),
        exact: true,
      }),
    ).toBeEnabled();
    const calls = await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").filter((call: { command: string }) =>
        ["ai_settings_save", "ai_begin", "ai_request"].includes(call.command),
      ),
    );
    expect(calls).toEqual([]);
  },
);

test(
  "unknown lookup exposes static manual choices and retry uses native account admission without replacing the draft",
  { tag: "@visual-mobile" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await workspaceFixture(page, shellState, {
      aiConnection: { ...connection, auth: "oauth" },
      aiModel: "gpt-6.1-sol",
      showInlineModel: true,
      aiCatalogs: { work: { source: "account", models: ["gpt-6.1-sol"] } },
      aiRefreshCatalogs: {
        work: [
          { source: "unknown", models: [] },
          { source: "account", models: ["gpt-4o-mini"] },
        ],
      },
    });
    await page.goto("/");
    const draft = page.getByRole("textbox", {
      name: t("navigation.message"),
      exact: true,
    });
    await draft.fill("Draft a checklist for the exhibition setup.");
    await settings(page);
    await page
      .getByRole("button", { name: t("ai.models.refresh"), exact: true })
      .click();
    const lookupWarning = page
      .locator(".model-discovery")
      .getByText(t("ai.models.lookupFailed"), { exact: true });
    await expect(lookupWarning).toBeVisible();
    await expect(
      page.locator(
        '#settings-chat-model + select option[value="recommended"], #settings-comment-model + select option[value="recommended"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator('#settings-chat-model + select option[value="gpt-5.4"]'),
    ).toHaveCount(1);
    await lookupWarning.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await expect(lookupWarning).toBeInViewport();
    await visual.capture("model.discovery.lookup-unavailable");
    await chat(page);
    const recovery = page.getByRole("dialog", {
      name: t("settings.ai.recovery"),
    });
    await expect(recovery).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(recovery).toBeHidden();
    await page
      .getByRole("button", { name: t("ai.model"), exact: true })
      .click();
    await expect(
      page
        .getByRole("menu")
        .locator('[role="menuitemradio"][data-choice="recommended"]'),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("menu")
        .locator('[role="menuitemradio"][data-choice="gpt-5.4"]'),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).not.toBeVisible();
    await page
      .getByRole("button", { name: t("settings.ai.recovery"), exact: true })
      .click();
    await expect(recovery).toBeVisible();
    await visual.capture("model.discovery.inline-retry");
    await page
      .locator(".model-error")
      .getByRole("button", { name: t("localization.retry"), exact: true })
      .click();
    await expect(page.locator(".model-error")).toContainText(
      t("native.ai.model.savedUnavailable"),
    );
    await expect(
      page.getByRole("button", { name: t("ai.model"), exact: true }),
    ).toHaveAttribute("aria-description", /gpt-6\.1-sol/u);
    await expect(
      page.getByRole("button", {
        name: t("navigation.sendMessage"),
        exact: true,
      }),
    ).toBeDisabled();
    await expect(draft).toHaveValue(
      "Draft a checklist for the exhibition setup.",
    );
    await visual.capture("model.discovery.saved-model-unavailable");
    await page.keyboard.press("Escape");
    await expect(recovery).toBeHidden();
    await page
      .getByRole("button", { name: t("ai.model"), exact: true })
      .click();
    await expect(
      page
        .getByRole("menu")
        .locator('[role="menuitemradio"][data-choice="recommended"]'),
    ).toHaveCount(0);
    await page
      .getByRole("menu")
      .locator('[role="menuitemradio"][data-choice="gpt-4o-mini"]')
      .click();
    await expect(
      page.getByRole("button", { name: t("ai.model"), exact: true }),
    ).toHaveAttribute("aria-description", /gpt-4o-mini/u);
    await expect(
      page.getByRole("button", {
        name: t("navigation.sendMessage"),
        exact: true,
      }),
    ).toBeEnabled();
    await expect(draft).toHaveValue(
      "Draft a checklist for the exhibition setup.",
    );
    await visual.capture("model.discovery.reselected");
    const calls = await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: Record<string, unknown>;
        }[],
    );
    expect(
      calls
        .filter((call) => call.command === "ai_refresh_models")
        .map((call) => call.args),
    ).toEqual([
      { scope: "garden", connectionId: "work" },
      { scope: "garden", connectionId: "work" },
    ]);
    expect(
      calls.filter((call) => ["ai_begin", "ai_request"].includes(call.command)),
    ).toEqual([]);
  },
);

test("switching same-provider connection IDs updates catalog candidates in Settings and chat", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConnections: [
      { ...connection, auth: "oauth" },
      {
        ...connection,
        auth: "oauth",
        connectionId: "personal",
        label: "Personal",
      },
    ],
    aiModel: "gpt-4o-mini",
    showInlineModel: true,
    aiCatalogs: {
      work: { source: "account", models: ["gpt-4o-mini"] },
      personal: { source: "account", models: ["gpt-6.1-sol"] },
    },
  });
  await page.goto("/");
  await settings(page);
  await chooseSelect(page.locator("#chat-connection"), "personal");
  await expect(
    page.locator('#settings-chat-model + select option[value="gpt-4o-mini"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('#settings-chat-model + select option[value="gpt-6.1-sol"]'),
  ).toHaveCount(1);
  await chooseSelect(page.locator("#settings-chat-model"), "recommended");
  await expect(page.locator("#settings-chat-model")).toHaveAttribute(
    "data-value",
    "recommended",
  );
  await chat(page);
  await page.getByRole("button", { name: t("ai.model"), exact: true }).click();
  await expect(
    page
      .getByRole("menu")
      .locator('[role="menuitemradio"][data-choice="gpt-4o-mini"]'),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: t("ai.model"), exact: true }),
  ).toHaveAttribute("aria-description", /gpt-6\.1-sol/u);
  await settings(page);
  await chooseSelect(page.locator("#chat-connection"), "work");
  await expect(page.locator("#settings-chat-model")).toHaveAttribute(
    "data-value",
    "gpt-4o-mini",
  );
  await expect(
    page.locator('#settings-chat-model + select option[value="gpt-6.1-sol"]'),
  ).toHaveCount(0);
});

test(
  "custom model observations suggest IDs without restricting manual aliases",
  { tag: "@visual-mobile" },
  async ({ page, visual }) => {
    await page.setViewportSize({ width: 375, height: 850 });
    await workspaceFixture(page, shellState, {
      aiConnection: {
        ...connection,
        provider: "custom",
        endpoint: "https://models.example.test/v1",
      },
      aiModel: "saved-alias",
      showInlineModel: true,
      aiCatalogs: {
        work: {
          source: "provider",
          models: ["server/chat", "server/embedding"],
        },
      },
    });
    await page.goto("/");
    const draft = page.getByRole("textbox", {
      name: t("navigation.message"),
      exact: true,
    });
    await draft.fill("Summarize the greenhouse experiment notes.");
    const trigger = page.getByRole("button", {
      name: t("ai.model"),
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const inline = dialog.getByLabel(t("ai.modelID"), { exact: true });
    await expect(inline).toHaveValue("saved-alias");
    await expect(dialog.locator("datalist option")).toHaveCount(2);
    await visual.capture("model.custom.id-dialog");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await settings(page);
    const suggestions = page.locator(".ai-settings datalist option");
    await expect(suggestions).toHaveCount(2);
    expect(
      await suggestions.evaluateAll((options) =>
        options.map((option) => option.getAttribute("value")),
      ),
    ).toEqual(["server/chat", "server/embedding"]);
    for (const id of ["settings-chat-model", "settings-comment-model"]) {
      await expect(page.locator(`#${id}`)).toHaveValue("");
      await expect(page.locator(`#${id}`)).toHaveAttribute(
        "list",
        (await page.locator(".ai-settings datalist").getAttribute("id"))!,
      );
    }
    await page.locator("#settings-comment-model").fill("comment-alias");
    await page
      .locator(".ai-settings form")
      .filter({ has: page.locator("#settings-comment-model") })
      .getByRole("button", { name: t("ai.useModelID"), exact: true })
      .click();
    await expect(page.locator("#settings-comment-model")).toHaveAttribute(
      "placeholder",
      t("model.selectedLabel", { name: "comment-alias" }),
    );
    await chat(page);
    await trigger.click();
    await inline.fill("unlisted-chat-alias");
    await dialog
      .getByRole("button", { name: t("ai.useModelID"), exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toHaveAttribute(
      "aria-description",
      /unlisted-chat-alias/u,
    );
    await visual.capture("model.custom.selected");
    await expect(draft).toHaveValue(
      "Summarize the greenhouse experiment notes.",
    );
    await expect(
      page.getByRole("button", {
        name: t("navigation.sendMessage"),
        exact: true,
      }),
    ).toBeEnabled();
    const calls = await page.evaluate(
      () =>
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: {
            settings?: { chat: { model: string }; comment: { model: string } };
            model?: string;
          };
        }[],
    );
    const saves = calls.filter((call) => call.command === "ai_settings_save");
    expect(saves).toHaveLength(1);
    expect(saves[0]!.args.settings).toMatchObject({
      chat: { model: "saved-alias" },
      comment: { model: "comment-alias" },
    });
    expect(
      calls
        .filter((call) => call.command === "ai_select_conversation_model")
        .at(-1)?.args,
    ).toMatchObject({
      scope: "garden",
      conversation: "legacy",
      model: "unlisted-chat-alias",
    });
    expect(
      calls.filter((call) => ["ai_begin", "ai_request"].includes(call.command)),
    ).toEqual([]);
  },
);
