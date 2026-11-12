import { expect, test, keyLabel } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

const catalogRequest = (url: string) =>
  /\/ai\/(?:model-catalog\.ts|catalog\.generated\.json)$/u.test(
    new URL(url).pathname,
  );

test("provider setup requests metadata only after the offer and keeps choices unavailable until it arrives", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/ai/model-catalog.ts*", async (route) => {
    await pending;
    await route.continue();
  });
  await workspaceFixture(page, { ...shellState, aiSetup: true });
  try {
    await page.goto("/");
    const connect = page.getByRole("button", {
      name: new RegExp(keyLabel("ai.connectMyProvider"), "u"),
    });
    await expect(connect).toBeEnabled();
    expect(requests.filter(catalogRequest)).toEqual([]);
    await connect.click();
    await expect(
      page.getByText(keyLabel("ai.loadingModels"), { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ai-provider-grid")).toHaveCount(0);
    await expect.poll(() => requests.filter(catalogRequest).length).toBe(1);
    release();
    await expect(page.locator(".ai-provider-grid button")).toHaveCount(5);
    await expect(
      page.locator(".ai-provider-grid button").first(),
    ).toBeEnabled();
    expect(
      requests.filter((url) =>
        /pi-ai\/.*(?:openai|anthropic|providers\/all)/u.test(url),
      ),
    ).toEqual([]);
  } finally {
    release();
  }
});

test("a disconnected chat does not load provider metadata", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await workspaceFixture(page, shellState);
  await page.goto("/");
  const draft = page.getByRole("textbox", {
    name: keyLabel("navigation.message"),
    exact: true,
  });
  await draft.fill("Keep this disconnected draft");
  await draft.press("Enter");
  await expect(draft).toHaveValue("Keep this disconnected draft");
  await expect(
    page.getByRole("button", { name: keyLabel("navigation.sendMessage") }),
  ).toBeDisabled();
  await expect(page.locator(".model-picker")).toHaveCount(0);
  expect(requests.filter(catalogRequest)).toEqual([]);
});

test("delayed model metadata preserves workspace language, selected model and a typed draft", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/ai/model-catalog.ts*", async (route) => {
    await pending;
    await route.continue();
  });
  await workspaceFixture(page, shellState, {
    aiConnection: { provider: "openai", endpoint: null },
    aiModel: "gpt-5.4",
    showInlineModel: true,
    localization: {
      language: "de",
      formats: { time: "24", date: "ymd", number: "dot-apostrophe" },
      writable: true,
    },
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", {
      name: keyLabel("ai.model"),
      exact: true,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator(".model-picker")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(trigger).toBeDisabled();
    const draft = page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    });
    await draft.fill("Keep this draft while models load.");
    release();
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAttribute("aria-description", /gpt-5\.4/u);
    await trigger.click();
    await expect(
      page.getByRole("menuitemradio", { name: "GPT-5.4", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(draft).toHaveValue("Keep this draft while models load.");
    expect(
      await page.evaluate(() =>
        (Reflect.get(window, "__ipcCalls") as { command: string }[]).filter(
          (call) =>
            [
              "ai_settings_save",
              "ai_select_model",
              "ai_begin",
              "ai_request",
              "localization_update",
            ].includes(call.command),
        ),
      ),
    ).toEqual([]);
  } finally {
    release();
  }
});
