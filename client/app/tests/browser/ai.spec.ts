import { expect, test, keyLabel, type Page } from "./test";
import {
  garden,
  reading,
  shellState,
  workspaceFixture,
  nativeRequests,
} from "./workspace-fixture";

for (const width of [375, 800, 1280]) {
  test(`standalone setup, skip confirmation and draft gate at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await workspaceFixture(page, { ...shellState, aiSetup: true });
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: keyLabel("ai.makeRoomForYourNextIdea"),
      }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toBeHidden();
    await expect(
      page.getByRole("list", { name: keyLabel("ai.workspaceSetup") }),
    ).toBeVisible();
    await expect(page.locator(".ai-bend")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`ai-offer-${width}.png`) });
    const skip = page.getByRole("button", { name: keyLabel("ai.skipForNow") });
    await skip.click();
    await expect(
      page.getByRole("dialog", { name: keyLabel("ai.continueWithoutAI") }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(skip).toBeFocused();
    await skip.click();
    await page
      .getByRole("button", { name: keyLabel("ai.continueWithoutAIDetail") })
      .click();
    const message = page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    });
    await message.fill("Keep my draft");
    await message.press("Enter");
    await expect(
      page.getByRole("tab", {
        name: keyLabel("navigation.newChat"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: new RegExp(
          `^(?:${keyLabel("ai.aiAccess")}|${keyLabel("ai.connectAIAccess")})$`,
          "u",
        ),
      }),
    ).toHaveCount(0);
    if (
      await page
        .getByRole("button", { name: keyLabel("navigation.openNavigation") })
        .isVisible()
    )
      await page
        .getByRole("button", { name: keyLabel("navigation.openNavigation") })
        .click();
    await page
      .getByRole("button", {
        name: keyLabel("navigation.settings"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: keyLabel("settings.ai.title"), exact: true })
      .click();
    await page
      .getByRole("button", {
        name: keyLabel("ai.connections.add"),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: keyLabel("ai.chooseAProvider"),
        exact: true,
      }),
    ).toBeVisible();
    await page
      .locator(".ai-embedded")
      .getByRole("button", { name: keyLabel("navigation.cancel"), exact: true })
      .click();
    const navigation = page.getByRole("button", {
      name: keyLabel("navigation.openNavigation"),
      exact: true,
    });
    if (await navigation.isVisible()) await navigation.click();
    await page.locator(".conversation-destination").first().click();
    await expect(message).toHaveValue("Keep my draft");
    const requests = await nativeRequests(page);
    expect(requests).toEqual([]);
  });
}

test("custom connection streams a response and stays independent when switching mobile workspaces", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await workspaceFixture(page, {
    ...shellState,
    mobile: true,
    open: [garden, reading],
    known: [garden, reading],
    aiSetup: true,
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: keyLabel("ai.connectMyProvider") })
    .click();
  await page
    .getByRole("button", { name: keyLabel("ai.compatibleEndpoint") })
    .click();
  await page
    .getByLabel(keyLabel("ai.openaiCompatibleEndpoint"), { exact: true })
    .fill("http://localhost:8888/v1");
  await expect(
    page.getByLabel(keyLabel("ai.modelID"), { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel(keyLabel("ai.optionalKey"), { exact: true })
    .fill("synthetic-test-key");
  expect(
    (await page
      .locator(".ai-reveal")
      .filter({ hasText: keyLabel("ai.showKey") })
      .boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await page
    .getByRole("checkbox", { name: keyLabel("ai.connections.httpConsent") })
    .check();
  await page.getByRole("button", { name: keyLabel("ai.saveAIAccess") }).click();
  await expect(
    page.getByRole("heading", { name: keyLabel("ai.aiAccessSaved") }),
  ).toBeVisible();
  await expect(
    page.getByText(keyLabel("ai.noTestMessageWasSentAccessWillBeChecked"), {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("ai-saved-phone.png") });
  await page
    .getByRole("button", { name: keyLabel("ai.continueToWorkspace") })
    .click();
  await expect(
    page.getByRole("button", { name: keyLabel("navigation.sendMessage") }),
  ).toBeDisabled();
  const recovery = page.getByRole("dialog", {
    name: keyLabel("settings.ai.recovery"),
  });
  await expect(recovery).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(recovery).toBeHidden();
  await page
    .getByRole("button", { name: keyLabel("ai.model"), exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(keyLabel("ai.modelID"), { exact: true })
    .fill("test-model");
  await page.getByRole("button", { name: keyLabel("ai.useModelID") }).click();
  await expect(
    page.getByLabel(keyLabel("ai.modelID"), { exact: true }),
  ).toBeHidden();
  await page
    .getByRole("textbox", { name: keyLabel("navigation.message"), exact: true })
    .fill("A local test message");
  await page
    .getByRole("button", { name: keyLabel("navigation.sendMessage") })
    .click();
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: keyLabel("navigation.openNavigation") })
    .click();
  await page
    .getByRole("button", { name: keyLabel("navigation.workspaceMenu") })
    .click();
  await page.getByRole("menuitem", { name: /Reading room/u }).click();
  await expect(
    page.getByRole("button", { name: keyLabel("navigation.sendMessage") }),
  ).toBeDisabled();
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    }),
  ).toHaveValue("");
});

async function openOpenAiSignIn(page: Page): Promise<void> {
  await page.goto("/");
  await page
    .getByRole("button", { name: keyLabel("ai.connectMyProvider") })
    .click();
  await page
    .locator(".ai-provider-grid button")
    .filter({ has: page.getByText("OpenAI", { exact: true }) })
    .click();
  await page
    .getByRole("button", { name: keyLabel("ai.signInWithChatGPT") })
    .click();
  await expect(
    page.getByRole("heading", { name: keyLabel("ai.signInToOpenAI") }),
  ).toBeVisible();
  await expect(page.getByLabel("Chat model", { exact: true })).toHaveCount(0);
}

test("OpenAI browser access enables a Responses chat without submitting the draft during login", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await workspaceFixture(
    page,
    { ...shellState, aiSetup: true },
    { aiLoginOutcome: "success" },
  );
  await openOpenAiSignIn(page);
  await expect(page.getByLabel("Chat model", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("ai-openai-browser-1280.png"),
  });
  await page
    .getByRole("button", { name: keyLabel("ai.openSignInInBrowser") })
    .click();
  await expect(
    page.getByRole("heading", { name: keyLabel("ai.aiAccessConnected") }),
  ).toBeVisible();
  await expect(
    page.getByText(
      keyLabel("ai.signedInToOpenAIModelAvailabilityDependsOnYour"),
      { exact: false },
    ),
  ).toBeVisible();
  expect(await nativeRequests(page)).toEqual([]);
  await page
    .getByRole("button", { name: keyLabel("ai.continueToWorkspace") })
    .click();
  await expect(
    page.getByRole("button", { name: keyLabel("navigation.sendMessage") }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: keyLabel("navigation.message"), exact: true })
    .fill("A browser-authenticated chat test");
  await page
    .getByRole("button", { name: keyLabel("navigation.sendMessage") })
    .click();
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          __ipcCalls: {
            command: string;
          }[];
        }
      ).__ipcCalls,
  );
  expect(await nativeRequests(page)).toMatchObject([
    {
      scope: "garden",
      conversation: "legacy",
      config: { provider: "openai", auth: "oauth" },
      model: "gpt-6.1-sol",
    },
  ]);
  expect(calls.filter((call) => call.command === "ai_save")).toEqual([]);
});

for (const outcome of ["pending", "denied"] as const) {
  test(`OpenAI browser sign-in can leave ${outcome} access without connecting chat`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await workspaceFixture(
      page,
      { ...shellState, aiSetup: true },
      { aiLoginOutcome: outcome },
    );
    await openOpenAiSignIn(page);
    await page
      .getByRole("button", { name: keyLabel("ai.openSignInInBrowser") })
      .click();
    if (outcome === "pending")
      await expect(page.getByRole("status")).toContainText(
        keyLabel("ai.waitingForSignIn"),
      );
    else {
      await expect(page.getByRole("alert")).toContainText(
        keyLabel("native.ai.login.denied"),
      );
      await expect(
        page.getByRole("button", { name: keyLabel("ai.trySignInAgain") }),
      ).toBeEnabled();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`ai-openai-${outcome}-375.png`),
    });
    await page
      .getByRole("button", { name: keyLabel("ai.cancelSignIn") })
      .click();
    await expect(
      page.getByRole("heading", {
        name: keyLabel("ai.connectProvider", { name: "OpenAI" }),
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: keyLabel("workspace.back"), exact: true })
      .click();
    await page
      .getByRole("button", { name: keyLabel("workspace.back"), exact: true })
      .click();
    await page.getByRole("button", { name: keyLabel("ai.skipForNow") }).click();
    await page
      .getByRole("button", { name: keyLabel("ai.continueWithoutAIDetail") })
      .click();
    await expect(
      page.getByRole("button", { name: keyLabel("navigation.sendMessage") }),
    ).toBeDisabled();
    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            __ipcCalls: { command: string; args: Record<string, unknown> }[];
          }
        ).__ipcCalls,
    );
    expect(await nativeRequests(page)).toEqual([]);
    expect(calls.filter((call) => call.command === "ai_save")).toEqual([]);
    if (outcome === "pending")
      expect(
        calls.filter((call) => call.command === "ai_openai_cancel"),
      ).toHaveLength(1);
  });
}

test("unavailable platform is explicit and never accepts a synthetic successful connection", async ({
  page,
}) => {
  await workspaceFixture(
    page,
    { ...shellState, aiSetup: true },
    { aiReason: "native.ai.access.platform" },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: keyLabel("ai.connectMyProvider") }),
  ).toBeDisabled();
  await expect(
    page.getByText(keyLabel("native.ai.access.platform"), { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: keyLabel("ai.skipForNow") }).click();
  await page
    .getByRole("button", { name: keyLabel("ai.continueWithoutAIDetail") })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: keyLabel("navigation.message"),
      exact: true,
    }),
  ).toBeEditable();
});
