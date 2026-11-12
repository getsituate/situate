import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";
import { selectOption, selectOptions } from "./select";
import {
  createSettingsState,
  settingsScenarios,
} from "../../src/settings/model";

async function open(controls: Page, scenario = "settings-formats") {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(preview.locator(".settings-view")).toBeVisible();
  await preview.setViewportSize({ width: 1280, height: 900 });
  return preview;
}

test("formats change independently and sidebar navigation retains preferences", async ({
  page,
}) => {
  const preview = await open(page);
  await expect(preview.locator(".settings-topbar")).toHaveCount(0);
  await expect(
    preview.locator(".settings-view").getByText("Field notes", { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview
      .locator(".desktop-sidebar")
      .getByText("Field notes", { exact: true }),
  ).toBeVisible();
  await selectOption(preview.getByLabel("Time format", { exact: true }), "12");
  await selectOption(preview.getByLabel("Date format", { exact: true }), "ymd");
  await selectOption(
    preview.getByLabel("Number format", { exact: true }),
    "dot-apostrophe",
  );
  await selectOption(
    preview.getByLabel("Interface language", { exact: true }),
    "de",
  );
  await expect(preview.locator("#settings-time")).toHaveText(
    "12-hour · 2:30 PM",
  );
  await expect(preview.locator("#settings-date")).toHaveText("2026-12-31");
  await expect(preview.locator("#settings-number")).toHaveText("1’234.56");
  await expect(
    preview.locator('[aria-labelledby="formats-heading"] p, .format-preview'),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByLabel("Connection outcome")).toHaveCount(0);
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    preview.getByLabel("Time format", { exact: true }),
  ).toHaveAttribute("data-value", "12");
  await page.getByRole("button", { name: "Reset scenario" }).click();
  await expect(
    preview.getByLabel("Time format", { exact: true }),
  ).toHaveAttribute("data-value", "24");
});

test("provider logos load locally in settings and the responsive provider chooser", async ({
  page,
}, testInfo) => {
  const preview = await open(page, "settings-ai");
  const connected = preview.locator(".provider-row .provider-icon img");
  await expect(connected).toHaveCount(2);
  await expect
    .poll(() =>
      connected.evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  const connectedSources = await connected.evaluateAll((images) =>
    images.map((image) => (image as HTMLImageElement).src),
  );
  await preview.getByRole("button", { name: "Add connection" }).click();
  const logos = preview.locator(".providers .provider-icon img");
  await expect(logos).toHaveCount(4);
  await expect
    .poll(() =>
      logos.evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  expect(
    await logos.evaluateAll((images) =>
      images.every((image) => {
        const img = image as HTMLImageElement;
        return (
          img.alt === "" &&
          (img.src.startsWith("data:") ||
            new URL(img.src).origin === location.origin)
        );
      }),
    ),
  ).toBe(true);
  await expect(
    preview.locator('[data-provider="anthropic"] .provider-icon img'),
  ).toHaveJSProperty("src", connectedSources[0]);
  await expect(
    preview.locator('[data-provider="openai"] .provider-icon img'),
  ).toHaveJSProperty("src", connectedSources[1]);
  await expect(
    preview.getByRole("button", { name: /^Anthropic Add another connection$/ }),
  ).toBeEnabled();
  await expect(
    preview.locator('[data-provider="compatible"] .provider-icon svg'),
  ).toHaveCount(1);
  await preview.screenshot({
    path: testInfo.outputPath("provider-logos-desktop.png"),
  });
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      preview
        .locator(".ai-view")
        .evaluate((root) => root.scrollWidth <= root.clientWidth),
    )
    .toBe(true);
  await preview.screenshot({
    path: testInfo.outputPath("provider-logos-narrow.png"),
  });
  await page.getByLabel("Explore deferred providers and methods").check();
  await expect(logos).toHaveCount(40);
  await expect
    .poll(() =>
      logos.evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  const provider = preview.getByRole("button", { name: /^Google Gemini / });
  await provider.focus();
  await expect(provider).toBeFocused();
  await preview.keyboard.press("Enter");
  await expect(
    preview.getByRole("heading", { name: "Connect Google Gemini" }),
  ).toBeVisible();
});

test("advanced disclosure keeps model selection independent of chat visibility and provider-specific", async ({
  page,
}) => {
  const preview = await open(page, "settings-ai");
  await expect(
    preview.getByLabel("Chat model", { exact: true }),
  ).not.toBeVisible();
  await preview
    .locator("summary")
    .filter({ hasText: "Advanced settings" })
    .click();
  await expect(
    preview.getByRole("switch", { name: "Show model picker in chat" }),
  ).not.toBeChecked();
  await selectOption(
    preview.getByLabel("Chat model", { exact: true }),
    "Claude Haiku",
  );
  await expect(
    preview.getByRole("switch", { name: "Show model picker in chat" }),
  ).not.toBeChecked();
  await preview
    .getByRole("switch", { name: "Show model picker in chat" })
    .check();
  await selectOption(preview.getByLabel("Chat connection"), "openai");
  await expect(
    preview.getByLabel("Chat model", { exact: true }),
  ).toHaveAttribute("data-value", "recommended");
  expect(
    (
      await selectOptions(preview.getByLabel("Chat model", { exact: true }))
    ).map((option) => option.label),
  ).toEqual([
    "Use recommended model",
    "GPT Chat",
    "GPT Mini",
    "Example Reasoning",
  ]);
  await expect(
    preview.getByRole("switch", { name: "AI-written progress updates" }),
  ).toHaveAccessibleDescription(
    /may cost more.*still see when Situate is working/,
  );
  await selectOption(
    preview.getByLabel("Model for progress updates", { exact: true }),
    "GPT Mini",
  );
  await preview
    .getByRole("switch", { name: "AI-written progress updates" })
    .uncheck();
  await expect(
    preview.getByLabel("Model for progress updates", { exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("switch", { name: "AI-written progress updates" })
    .check();
  await expect(
    preview.getByLabel("Model for progress updates", { exact: true }),
  ).toHaveAttribute("data-value", "GPT Mini");
});

test("the optional chat picker shares model choice without losing the message draft", async ({
  page,
}) => {
  const preview = await open(page, "settings-ai");
  await preview
    .locator("summary")
    .filter({ hasText: "Advanced settings" })
    .click();
  await preview
    .getByRole("switch", { name: "Show model picker in chat" })
    .check();
  await preview.getByRole("button", { name: "Open chat", exact: true }).click();
  await preview
    .getByLabel("Message", { exact: true })
    .fill("Keep this thought.");
  await selectOption(
    preview.getByLabel("Chat model", { exact: true }),
    "Claude Haiku",
  );
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep this thought.",
  );
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    preview.getByLabel("Chat model", { exact: true }),
  ).toHaveAttribute("data-value", "Claude Haiku");
  await preview
    .getByRole("switch", { name: "Show model picker in chat" })
    .uncheck();
  await preview.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(preview.getByLabel("Chat model", { exact: true })).toHaveCount(
    0,
  );
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep this thought.",
  );
});

test("disconnect confirmation returns focus and does not choose another provider", async ({
  page,
}) => {
  const preview = await open(page, "settings-ai");
  const trigger = preview.getByRole("button", {
    name: "Disconnect Anthropic",
    exact: true,
  });
  await trigger.click();
  await expect(
    preview.getByRole("button", { name: "Keep connection" }),
  ).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await preview
    .getByRole("button", { name: "Disconnect connection", exact: true })
    .click();
  await expect(preview.getByLabel("Chat connection")).toHaveAttribute(
    "data-value",
    "",
  );
  await expect(
    preview.getByText("Choose a connection before sending a message.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Disconnect OpenAI", exact: true }),
  ).toBeVisible();
});

test("settings reuse provider selection, authentication, save failure and completion", async ({
  page,
}) => {
  const preview = await open(page, "settings-empty");
  await preview.getByRole("button", { name: "Add connection" }).click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await expect(preview.locator(".desktop-sidebar")).toContainText(
    "Field notes",
  );
  await expect(
    preview.getByRole("navigation", { name: "Settings categories" }),
  ).toBeVisible();
  await expect(preview.locator(".setup-header, .ai-view .sidebar")).toHaveCount(
    0,
  );
  await expect(
    preview.getByRole("list", { name: "Setup progress" }),
  ).toHaveCount(0);
  await preview.getByLabel("Find a provider").fill("Anthropic");
  await preview.locator('[data-provider="anthropic"]').click();
  await preview.locator('[data-method="key"]').click();
  await preview.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(preview.locator("#credential")).toBeFocused();
  await preview.locator("#credential").fill("example-only");
  await preview.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator('[data-outcome="save-error"]').click();
  await expect(
    preview.getByRole("heading", { name: "Connection was not saved" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Retry saving" }).click();
  await page.locator('[data-outcome="success"]').click();
  await preview.getByRole("button", { name: "Back to settings" }).click();
  await expect(preview.getByLabel("Chat connection")).toHaveAttribute(
    "data-value",
    "anthropic-1",
  );
  await expect(preview.getByRole("status")).toContainText(
    "Anthropic connected",
  );
  await expect(page.getByRole("region", { name: "AI controls" })).toHaveCount(
    0,
  );
  await preview.getByRole("button", { name: "Add connection" }).click();
  await expect(preview.locator('[data-provider="anthropic"]')).toBeEnabled();
  await preview.locator('[data-provider="openai"]').click();
  await preview.locator('[data-method="browser"]').click();
  await preview.getByRole("button", { name: "Cancel sign-in" }).click();
  await page
    .getByRole("button", { name: "Late return after cancellation" })
    .click();
  await preview.getByRole("button", { name: "Back to settings" }).click();
  await expect(
    preview.getByRole("button", { name: "Disconnect OpenAI" }),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: "Add connection" }).click();
  await page.getByRole("button", { name: "Reset scenario" }).click();
  await expect(preview.locator(".ai-view")).toHaveCount(0);
  await expect(
    preview.getByRole("heading", { name: "Set up AI on this device" }),
  ).toBeVisible();
});

test("reconnection explains prohibited subscription access and keeps provider preferences after key replacement", async ({
  page,
}) => {
  const preview = await open(page, "settings-error");
  await preview.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "Connect Anthropic" }),
  ).toBeVisible();
  await page.getByLabel("Explore deferred providers and methods").check();
  await preview.locator('[data-method="browser"]').click();
  await expect(
    preview.getByRole("heading", {
      name: "This subscription can’t connect",
    }),
  ).toBeVisible();
  await expect(page.locator('[data-outcome="success"]')).toHaveCount(0);
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await preview.locator('[data-method="key"]').click();
  await preview.locator("#credential").fill("example-replacement-key");
  await preview.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "Connecting…" }),
  ).toBeVisible();
  await page.locator('[data-outcome="success"]').click();
  await preview.getByRole("button", { name: "Back to settings" }).click();
  await expect(
    preview.getByRole("button", { name: "Reconnect", exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Disconnect OpenAI" }),
  ).toBeVisible();
  await expect(preview.getByLabel("Chat connection")).toHaveAttribute(
    "data-value",
    "anthropic",
  );
  await expect(
    preview.locator(".provider-row").filter({ hasText: "Anthropic" }),
  ).toContainText("API key");
});

test("returning OpenAI browser sign-in retains the other provider and selected chat provider", async ({
  page,
}) => {
  const preview = await open(page, "settings-error");
  await selectOption(
    page.getByLabel("Provider state", { exact: true }),
    "session",
  );
  await selectOption(
    preview.getByLabel("Chat connection", { exact: true }),
    "anthropic",
  );
  await preview.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "Connect OpenAI" }),
  ).toBeVisible();
  await preview.locator('[data-method="browser"]').click();
  await page.locator('[data-outcome="success"]').click();
  await expect(
    preview.getByRole("heading", { name: "Connecting…" }),
  ).toBeVisible();
  await page.locator('[data-outcome="success"]').click();
  await preview.getByRole("button", { name: "Back to settings" }).click();
  await expect(
    preview.getByRole("button", { name: "Reconnect", exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Disconnect Anthropic" }),
  ).toBeVisible();
  await expect(preview.getByLabel("Chat connection")).toHaveAttribute(
    "data-value",
    "anthropic",
  );
  await expect(
    preview.locator(".provider-row").filter({ hasText: "OpenAI" }),
  ).toContainText("Browser sign-in");
});

test("branded select fields retain selection, keyboard focus and disabled states", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  const time = preview.getByLabel("Time format", { exact: true });
  await time.focus();
  await selectOption(time, "12");
  await expect(time).toHaveAttribute("data-value", "12");
  await time.press("Tab");
  await expect(
    preview.getByLabel("Date format", { exact: true }),
  ).toBeFocused();
  await preview.keyboard.press("Shift+Tab");
  await expect(time).toBeFocused();
  expect(await time.evaluate((el) => getComputedStyle(el).borderRadius)).toBe(
    "12px",
  );
  await preview.screenshot({
    path: testInfo.outputPath("settings-select-focus.png"),
  });
  await selectScenario(page, "settings-empty");
  await expect(preview.getByLabel("Chat connection")).toBeDisabled();
  await preview
    .locator("summary")
    .filter({ hasText: "Advanced settings" })
    .click();
  await expect(
    preview.getByLabel("Chat model", { exact: true }),
  ).toBeDisabled();
});

test("shortcuts reject duplicates, preserve drafts during resizing and restore defaults", async ({
  page,
}) => {
  const preview = await open(page, "settings-shortcuts");
  await preview
    .getByRole("button", { name: "Change shortcut for New chat" })
    .click();
  await preview.getByLabel("Press a key combination").press("Control+k");
  await preview.getByRole("button", { name: "Save shortcut" }).click();
  await expect(preview.getByRole("alert")).toContainText("Already used");
  await preview.getByLabel("Press a key combination").press("Control+Shift+j");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.getByLabel("Press a key combination")).toHaveValue(
    /Shift.*J/,
  );
  await preview.getByRole("button", { name: "Save shortcut" }).click();
  await preview.getByRole("button", { name: /Keyboard shortcuts/ }).click();
  await expect(
    preview.getByRole("button", { name: "Change shortcut for New chat" }),
  ).toContainText("Modified");
  await preview
    .getByRole("button", { name: "Change shortcut for New chat" })
    .click();
  await preview.getByRole("button", { name: "Use default" }).click();
  await preview.getByRole("button", { name: "Save shortcut" }).click();
  await expect(
    preview.getByRole("button", { name: "Change shortcut for New chat" }),
  ).not.toContainText("Modified");
});

test("mobile keyboard and safe areas preserve search and keep shortcut dialogs reachable", async ({
  page,
}, testInfo) => {
  const preview = await open(page, "settings-shortcuts");
  for (const profile of ["ios", "android"]) {
    await selectOption(page.getByLabel("Platform profile"), profile);
    await preview.setViewportSize({
      width: profile === "ios" ? 390 : 412,
      height: 844,
    });
    if (
      await preview
        .getByRole("navigation", { name: "Settings categories" })
        .isVisible()
    )
      await preview.getByRole("button", { name: /Keyboard shortcuts/ }).click();
    await preview.getByLabel("Find an action").fill("chat");
    await page.getByLabel("Keyboard occlusion").check();
    await expect(preview.getByLabel("Find an action")).toHaveValue("chat");
    await preview
      .getByRole("button", { name: "Change shortcut for New chat" })
      .click();
    await preview
      .getByLabel("Press a key combination")
      .press("Control+Shift+j");
    await preview
      .getByRole("button", { name: "Save shortcut" })
      .scrollIntoViewIfNeeded();
    const box = await preview
      .getByRole("button", { name: "Save shortcut" })
      .boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(
      844 - (profile === "ios" ? 294 : 296),
    );
    await preview.keyboard.press("Escape");
    await expect(
      preview.getByRole("button", { name: "Change shortcut for New chat" }),
    ).toBeFocused();
    await page.getByLabel("Keyboard occlusion").uncheck();
  }
  await selectScenario(page, "settings-formats");
  await preview.getByRole("button", { name: /Language & formats/ }).click();
  await preview.screenshot({
    path: testInfo.outputPath("settings-mobile.png"),
  });
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`settings starting states fit at ${size.width}px without console errors`, async ({
    page,
  }, testInfo) => {
    const preview = await open(page);
    const errors: string[] = [];
    preview.on("pageerror", (error) => errors.push(error.message));
    await preview.setViewportSize(size);
    for (const scene of settingsScenarios) {
      await selectScenario(page, scene.id);
      if (size.width <= 760 && !scene.id.startsWith("settings-appearance")) {
        if (createSettingsState(scene.id).detail) {
          await preview.getByRole("button", { name: /All settings/ }).click();
        }
        await preview
          .getByRole("navigation", { name: "Settings categories" })
          .getByRole("button", {
            name:
              scene.page === "formats"
                ? /Language & formats/
                : scene.page === "ai"
                  ? /AI & models/
                  : /Keyboard shortcuts/,
          })
          .click();
        await expect(
          preview.locator(".settings-page-heading h2"),
        ).toBeFocused();
      }
      expect(
        await preview.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await preview
          .locator(".settings-content")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await expect(
        page.getByLabel("Workspace examples", { exact: true }),
      ).toHaveCount(0);
    }
    await selectScenario(page, "settings-formats");
    if (size.width <= 760)
      await preview
        .getByRole("button", { name: "Language & formats", exact: true })
        .click();
    await preview.screenshot({
      path: testInfo.outputPath("settings-formats.png"),
    });
    await selectScenario(page, "settings-ai");
    if (size.width <= 760)
      await preview
        .getByRole("button", { name: "AI & models", exact: true })
        .click();
    await preview.screenshot({ path: testInfo.outputPath("settings-ai.png") });
    expect(errors).toEqual([]);
  });
}
