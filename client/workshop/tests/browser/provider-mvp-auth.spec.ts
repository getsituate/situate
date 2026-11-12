import { expect, test, type Page } from "./test";

async function open(controls: Page, scenario: string) {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(preview.locator(".ai-view")).toBeVisible();
  return preview;
}

for (const width of [320, 390, 1280]) {
  test(`MVP provider methods and HTTP consent at ${width}px desktop`, async ({
    page,
  }, info) => {
    const preview = await open(page, "ai-providers");
    await preview.setViewportSize({ width, height: 800 });
    const external: string[] = [];
    preview.on("request", (request) => {
      if (!request.url().startsWith(new URL(preview.url()).origin))
        external.push(request.url());
    });
    await expect(preview.locator("[data-provider]")).toHaveCount(6);
    await expect(
      preview.getByText("Explore deferred providers and methods"),
    ).toHaveCount(0);
    await preview.locator('[data-provider="openai"]').click();
    await expect(preview.locator("[data-method]")).toHaveCount(2);
    await expect(
      preview.getByRole("button", { name: /Sign in with ChatGPT/ }),
    ).toBeVisible();
    await expect(preview.locator('[data-method="device"]')).toHaveCount(0);
    await preview.screenshot({
      path: info.outputPath(`openai-methods-${width}.png`),
    });
    await preview.getByRole("button", { name: "Back", exact: true }).click();
    await preview.locator('[data-provider="openai-codex"]').click();
    await expect(
      preview.getByRole("heading", { name: "Connect OpenAI Codex" }),
    ).toBeVisible();
    await expect(preview.locator("[data-method]")).toHaveCount(1);
    await expect(preview.locator('[data-method="device"]')).toBeVisible();
    await preview.screenshot({
      path: info.outputPath(`codex-method-${width}.png`),
    });
    for (const provider of ["anthropic", "openrouter"]) {
      await preview.getByRole("button", { name: "Back", exact: true }).click();
      await preview.locator(`[data-provider="${provider}"]`).click();
      await expect(preview.locator("[data-method]")).toHaveCount(1);
      await expect(preview.locator('[data-method="key"]')).toBeVisible();
    }
    await preview.getByRole("button", { name: "Back", exact: true }).click();
    await preview.locator('[data-provider="compatible"]').click();
    await preview.locator('[data-method="key"]').click();
    await preview.locator("#endpoint").fill("http://LAN.example.invalid:80/v1");
    await preview.locator("#credential").fill("example-only");
    await preview
      .getByRole("button", { name: "Connect endpoint", exact: true })
      .focus();
    await preview.keyboard.press("Enter");
    const warning = preview.getByRole("heading", {
      name: "Connect without encryption?",
    });
    await expect(warning).toBeFocused();
    await expect(preview.locator(".http-destination")).toHaveText(
      "http://lan.example.invalid/v1",
    );
    await expect(
      preview.getByText(/Prompts, chat contents, responses and any API keys/),
    ).toBeVisible();
    await expect(page.locator('[data-outcome="success"]')).toHaveCount(0);
    await expect(preview.getByRole("checkbox")).toHaveCount(0);
    await preview.screenshot({
      path: info.outputPath(`http-consent-${width}.png`),
    });
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview
      .getByRole("button", { name: "Back to address", exact: true })
      .click();
    await expect(preview.locator("#credential")).toHaveValue("example-only");
    await expect(preview.locator("#endpoint")).toHaveValue(
      "http://lan.example.invalid/v1",
    );
    await preview
      .locator("#endpoint")
      .fill("http://other.example.invalid:8080/v2");
    await preview
      .getByRole("button", { name: "Connect endpoint", exact: true })
      .click();
    await expect(preview.locator(".http-destination")).toHaveText(
      "http://other.example.invalid:8080/v2",
    );
    const consent = preview.getByRole("button", {
      name: "Connect to this address",
      exact: true,
    });
    await consent.focus();
    await preview.keyboard.press("Enter");
    await expect(
      preview.locator('.ai-view[data-screen="connecting"]'),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Cancel connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Late return after cancellation" })
      .click();
    await expect(
      preview.locator('.ai-view[data-screen="cancelled"]'),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(preview.locator("[data-provider]")).toHaveCount(6);
    expect(external).toEqual([]);
  });
}

test("endpoint reset clears consent; malformed addresses never connect and HTTPS needs no warning", async ({
  page,
}) => {
  const preview = await open(page, "ai-endpoint");
  for (const url of [
    "http://",
    "http://user:example@host.invalid/v1",
    "https://host.invalid:99999",
  ]) {
    await preview.locator("#endpoint").fill(url);
    await preview
      .getByRole("button", { name: "Connect endpoint", exact: true })
      .click();
    await expect(preview.locator("#endpoint")).toBeFocused();
    await expect(preview.locator("#endpoint")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.locator('[data-outcome="success"]')).toHaveCount(0);
  }
  await preview.locator("#endpoint").fill("http://localhost:8080/v1");
  await preview
    .getByRole("button", { name: "Connect endpoint", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator("#endpoint")).toHaveValue("");
  await preview.locator("#endpoint").fill("http://localhost:8080/v1");
  await preview
    .getByRole("button", { name: "Connect endpoint", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Connect without encryption?" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Back to address", exact: true })
    .click();
  await preview.locator("#endpoint").fill("https://server.example.invalid/v1");
  await preview
    .getByRole("button", { name: "Connect endpoint", exact: true })
    .click();
  await expect(
    preview.locator('.ai-view[data-screen="connecting"]'),
  ).toBeVisible();
  await page.locator('[data-outcome="success"]').click();
  await expect(
    preview.getByRole("heading", { name: "AI access connected" }),
  ).toBeVisible();
});
