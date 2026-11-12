import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";
import { aiScenarios } from "../../src/ai/model";

async function open(controls: Page, scenario: string, options = "") {
  await controls.goto(`/?workshop=controls&scenario=${scenario}${options}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(
    controls.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.locator(".ai-view, .settings-view, .chat-screen").first(),
  ).toBeVisible();
  return preview;
}
async function scenario(controls: Page, id: string) {
  await selectScenario(controls, id);
}
async function outcome(controls: Page, id: string) {
  await controls.locator(`[data-outcome="${id}"]`).click();
}
async function fits(preview: Page) {
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await preview.locator("iframe").count()).toBe(0);
  const bounds = await preview.locator(".ai-view").evaluate((node) => {
    node = node.closest(".settings-view") ?? node;
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: innerHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
}

for (const size of [
  { width: 1200, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`all AI starting states are selectable without a setup workspace shell at ${size.width}px`, async ({
    page,
  }) => {
    const preview = await open(page, "ai-offer");
    const errors: string[] = [];
    preview.on("pageerror", (error) => errors.push(error.message));
    await preview.setViewportSize(size);
    for (const item of aiScenarios) {
      await scenario(page, item.id);
      await expect(
        preview.locator(".ai-view .heading [tabindex], .ai-view #chat-title"),
      ).toBeVisible();
      await expect(
        page.getByLabel("Workspace examples", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel("Action result", { exact: true }),
      ).toHaveCount(0);
      await fits(preview);
    }
    await scenario(page, "ai-offer");
    await expect(preview.getByLabel("Active workspace")).toHaveCount(0);
    await expect(preview.getByRole("navigation")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("AI setup choices retain rectangular card corners", async ({ page }) => {
  const preview = await open(page, "ai-offer");
  const choices = preview.locator(".entry-choices .choice");
  await expect(choices).toHaveCount(2);
  for (const choice of await choices.all()) {
    await expect(choice).toHaveCSS("border-radius", "16px");
  }
});

test("skip keeps local editing and opens the shared chat with unavailable access", async ({
  page,
}) => {
  const preview = await open(page, "ai-offer");
  await preview.getByRole("button", { name: "Skip for now" }).click();
  await expect(
    preview.getByRole("dialog", { name: "Continue without AI?" }),
  ).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(
    preview.getByRole("button", { name: "Skip for now" }),
  ).toBeFocused();
  await preview.getByRole("button", { name: "Skip for now" }).click();
  await preview.getByRole("button", { name: "Continue without AI" }).click();
  await preview.locator("#local-note").fill("My local note");
  await preview.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(preview.locator(".chat-screen .chat-composer")).toBeVisible();
  await expect(preview.locator(".ai-view")).toHaveCount(0);
  await preview.getByLabel("Message", { exact: true }).fill("Keep my draft");
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: /^Model issue: AI access/ }),
  ).toBeVisible();
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep my draft",
  );
});

test("key validation and save retry lead to a resolved inherited model in the shared conversation", async ({
  page,
}) => {
  const preview = await open(page, "ai-key");
  await preview.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(preview.locator("#credential")).toBeFocused();
  await expect(preview.locator("#credential")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await preview.locator("#credential").fill("example-only");
  await preview.getByRole("button", { name: "Show value" }).click();
  await expect(preview.locator("#credential")).toHaveAttribute("type", "text");
  await preview.getByRole("button", { name: "Connect", exact: true }).click();
  await outcome(page, "save-error");
  await expect(
    preview.getByRole("heading", { name: "Connection was not saved" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Retry saving" }).click();
  await outcome(page, "success");
  await preview.getByRole("button", { name: "Continue to workspace" }).click();
  await expect(preview.locator(".chat-screen")).toBeVisible();
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("A retained thought.");
  const model = preview.getByRole("button", { name: /^Chat model:/ });
  await expect(model).toHaveAccessibleName(
    "Chat model: Example Chat. Workspace default",
  );
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await model.click();
  await preview.locator('[data-choice="example-fast"]').click();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  await expect(model).toHaveText("Example Fast");
  await preview.reload();
  await expect(model).toHaveText("Example Fast");
  await expect(draft).toHaveValue("A retained thought.");
});

test("workspace changes, cancellation, late returns and removal never borrow another connection", async ({
  page,
}) => {
  const preview = await open(page, "settings-ai");
  async function workspace(name: string) {
    await preview
      .getByRole("button", { name: "Workspace menu", exact: true })
      .click();
    await preview.getByRole("menuitem", { name: new RegExp(name) }).click();
    await preview
      .getByRole("button", { name: "AI & models", exact: true })
      .click();
  }
  await workspace("Reading room");
  await preview
    .getByRole("button", { name: "Manage Anthropic", exact: true })
    .click();
  await expect(preview.locator(".summary").first()).toContainText("Anthropic");
  await preview.getByRole("button", { name: "Change connection" }).click();
  await page.getByLabel("Explore deferred providers and methods").check();
  await preview.locator('[data-provider="anthropic"]').click();
  await preview.locator('[data-method="browser"]').click();
  await expect(
    preview.getByRole("heading", { name: "This subscription can’t connect" }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Open sign-in in browser" }),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await workspace("Field notes");
  await preview
    .getByRole("button", { name: "Manage OpenAI", exact: true })
    .click();
  await expect(preview.locator(".summary").first()).toContainText("OpenAI");
  await preview.getByRole("button", { name: "Change connection" }).click();
  await page.getByLabel("Explore deferred providers and methods").check();
  await preview.locator('[data-provider="openrouter"]').click();
  await preview.locator('[data-method="browser"]').click();
  await expect(
    preview.getByText(
      "Your saved OpenAI connection stays until the new one is saved.",
    ),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Open sign-in in browser" })
    .click();
  await preview.getByRole("button", { name: "Cancel sign-in" }).click();
  await page
    .getByRole("button", { name: "Late return after cancellation" })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Connection cancelled" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Back to settings", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Manage OpenAI", exact: true })
    .click();
  await expect(preview.locator(".summary").first()).toContainText("OpenAI");
  await preview.getByText("Manage connection", { exact: true }).click();
  await preview
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await preview.getByRole("button", { name: "Keep connection" }).click();
  await expect(preview.locator(".summary").first()).toContainText("OpenAI");
  await expect(
    preview.getByRole("button", { name: "Remove connection", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await preview
    .getByRole("dialog")
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Set up AI on this device" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Back to AI & models", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Manage OpenAI", exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Manage Anthropic", exact: true }),
  ).toBeVisible();
  await workspace("Reading room");
  await preview
    .getByRole("button", { name: "Manage Anthropic", exact: true })
    .click();
  await expect(preview.locator(".summary").first()).toContainText("Anthropic");
});

test("browser approval waits for saving while copy-code and device flows require their code step", async ({
  page,
}) => {
  const preview = await open(page, "ai-browser");
  await outcome(page, "success");
  await expect(
    preview.getByRole("heading", { name: "Connecting…" }),
  ).toBeVisible();
  await outcome(page, "success");
  await expect(
    preview.getByRole("heading", { name: "AI access connected" }),
  ).toBeVisible();
  await scenario(page, "ai-copy-code");
  await expect(page.locator('[data-outcome="success"]')).toHaveCount(0);
  await preview.locator("#code").fill("example-return-value");
  await preview
    .getByRole("button", { name: "Continue with pasted value" })
    .click();
  await outcome(page, "success");
  await scenario(page, "ai-providers");
  await page.getByLabel("Explore deferred providers and methods").check();
  await preview.locator('[data-provider="github-copilot"]').click();
  await preview.locator('[data-method="device"]').click();
  await expect(preview.locator(".code")).toHaveCount(0);
  await expect(page.locator('[data-outcome="success"]')).toHaveCount(0);
  await preview.getByRole("button", { name: "Get device code" }).click();
  await expect(preview.locator(".code")).toHaveText("DEMO-ONLY");
  const pages = preview.context().pages().length;
  await preview.getByRole("button", { name: "Copy code" }).click();
  await preview
    .getByRole("button", { name: "Open provider", exact: true })
    .click();
  expect(preview.context().pages()).toHaveLength(pages);
  await outcome(page, "success");
  await expect(
    preview.getByRole("heading", { name: "Connecting…" }),
  ).toBeVisible();
});
