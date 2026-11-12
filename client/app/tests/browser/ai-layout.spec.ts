import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import { onboardingFixture } from "./onboarding-fixture";

test.use({ localizationMode: "real" });

for (const width of [320, 375, 800, 1280, 1920]) {
  test(
    `provider selection keeps a compact accessible list at ${width}px`,
    {
      tag: width < 600 ? "@visual-mobile" : "@visual-desktop",
    },
    async ({ page, visual, browserName }, info) => {
      await page.setViewportSize({ width, height: 800 });
      await workspaceFixture(page, {
        ...shellState,
        aiSetup: true,
        mobile: width < 600,
      });
      await page.goto("/");
      const setup = page.locator(".ai-setup");
      const offer = await setup.boundingBox();
      expect(offer?.x).toBe(0);
      expect(offer?.width).toBe(width);
      await expect(
        page.getByRole("heading", { name: "Make room for your next idea." }),
      ).toBeVisible();
      await visual.capture("ai.setup.offer");
      await page.getByRole("button", { name: /Connect my provider/u }).click();
      const heading = page.getByRole("heading", { name: "Choose a provider" });
      await expect(heading).toBeVisible();
      await expect(heading).toBeFocused();
      const list = page.getByRole("group", { name: "Choose a provider" });
      const choices = list.getByRole("button");
      await expect(choices).toHaveCount(5);
      const names = [
        "Anthropic",
        "OpenAI",
        "OpenAI Codex",
        "OpenRouter",
        "OpenAI-compatible server",
      ];
      for (const [index, name] of names.entries()) {
        await expect(choices.nth(index)).toHaveAccessibleName(name);
        const box = await choices.nth(index).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeLessThanOrEqual(640);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        if (index > 0) {
          const previous = await choices.nth(index - 1).boundingBox();
          expect(box!.x).toBe(previous!.x);
          expect(box!.y).toBeGreaterThanOrEqual(previous!.y + previous!.height);
        }
      }
      await expect(list.locator(".provider-icon")).toHaveCount(5);
      await expect(list.locator("small")).toHaveCount(0);
      await expect(page.getByRole("searchbox")).toHaveCount(0);
      await expect(setup.locator(".ai-subtitle")).toHaveCount(0);
      await expect(setup.locator(".ai-result-count")).toHaveCount(0);
      const footer = await setup.locator("footer").boundingBox();
      expect(footer?.x).toBe(0);
      expect(footer?.width).toBe(width);
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(800);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.mouse.move(0, 0);
      await visual.capture("ai.setup.providers");
      if (!info.project.name.match(/^(desktop|mobile)$/u)) {
        await page.screenshot({ path: info.outputPath("providers.png") });
      }
      for (const choice of await choices.all()) {
        await page.keyboard.press(
          process.platform === "darwin" && browserName === "webkit"
            ? "Alt+Tab"
            : "Tab",
        );
        await expect(choice).toBeFocused();
        expect(
          await choice.evaluate((element) => {
            const style = getComputedStyle(element);
            return (
              style.outlineStyle !== "none" &&
              parseFloat(style.outlineWidth) >= 3
            );
          }),
        ).toBe(true);
      }
      await visual.capture("ai.setup.providers-focused");
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Connect an endpoint" }),
      ).toBeVisible();
      await expect(
        page.getByLabel("OpenAI-compatible endpoint", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Connection name (optional)")).toBeVisible();
      await visual.capture("ai.setup.server-form");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(heading).toBeVisible();
      await list.getByRole("button", { name: "OpenAI", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Connect OpenAI", exact: true }),
      ).toBeVisible();
      const account = page.getByRole("button", {
        name: "Sign in with ChatGPT",
        exact: true,
      });
      await expect(account).toHaveAccessibleDescription(
        /ChatGPT account.*usage limits/u,
      );
      const name = page.getByLabel("Connection name (optional)");
      await name.fill("Personal");
      const labelBox = await setup
        .locator('label[for="ai-connection-label"]')
        .boundingBox();
      const inputBox = await name.boundingBox();
      expect(inputBox!.y - labelBox!.y - labelBox!.height).toBeCloseTo(8, 0);
      await expect(setup.locator(".ai-subtitle")).toHaveCount(0);
      await expect(
        setup.getByText(/Environment variables|Your provider’s terms/u),
      ).toHaveCount(0);
      await page.mouse.move(0, 0);
      await visual.capture("ai.setup.openai-methods");
      if (!info.project.name.match(/^(desktop|mobile)$/u)) {
        await page.screenshot({ path: info.outputPath("methods.png") });
      }
      await page.getByRole("button", { name: "API key", exact: true }).click();
      await expect(page.getByLabel("Connection name (optional)")).toHaveValue(
        "Personal",
      );
      await expect(
        page.getByLabel("API key or token", { exact: true }),
      ).toHaveAccessibleDescription(/billed separately from ChatGPT/u);
      await visual.capture("ai.setup.openai-key");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await account.click();
      await expect(
        page.getByRole("heading", { name: "Sign in to OpenAI", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Sign in to OpenAI in your browser, then return here to continue.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByText(/No password|does not revoke/u)).toHaveCount(
        0,
      );
      await visual.capture("ai.setup.openai-browser");
      await page
        .getByRole("button", { name: "Cancel sign-in", exact: true })
        .click();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await list
        .getByRole("button", { name: "OpenAI Codex", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Connect OpenAI Codex",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Sign in with Codex", exact: true }),
      ).toHaveAccessibleDescription(/ChatGPT account.*Codex access/u);
      await visual.capture("ai.setup.codex-method");
      await page
        .getByRole("button", { name: "Sign in with Codex", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Get sign-in code", exact: true }),
      ).toBeVisible();
      await visual.capture("ai.setup.codex-ready");
      await page
        .getByRole("button", { name: "Cancel sign-in", exact: true })
        .click();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      for (const provider of ["Anthropic", "OpenRouter"]) {
        await list.getByRole("button", { name: provider, exact: true }).click();
        await expect(
          page.getByRole("heading", {
            name: `Connect ${provider}`,
            exact: true,
          }),
        ).toBeVisible();
        const apiKey = page.getByRole("button", {
          name: "API key",
          exact: true,
        });
        await expect(apiKey).toHaveAccessibleDescription(
          provider === "Anthropic"
            ? /Anthropic Console.*separate/u
            : /OpenRouter account.*billed/u,
        );
        await visual.capture(`ai.setup.${provider.toLowerCase()}-method`);
        await apiKey.click();
        await expect(
          page.getByLabel("API key or token", { exact: true }),
        ).toBeVisible();
        await visual.capture(`ai.setup.${provider.toLowerCase()}-key`);
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await page.getByRole("button", { name: "Back", exact: true }).click();
      }
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Make room for your next idea." }),
      ).toBeVisible();
    },
  );
}

for (const width of [375, 1280]) {
  test(
    `onboarding provider selection and connection fields at ${width}px`,
    {
      tag: width < 600 ? "@visual-mobile" : "@visual-desktop",
    },
    async ({ page, visual }, info) => {
      await page.setViewportSize({ width, height: 850 });
      await onboardingFixture(page, { connected: false });
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Choose a provider", exact: true }),
      ).toBeVisible();
      const list = page.getByRole("group", {
        name: "Choose a provider",
        exact: true,
      });
      const choices = list.getByRole("button");
      await expect(choices).toHaveCount(5);
      const first = await choices.nth(0).boundingBox();
      const second = await choices.nth(1).boundingBox();
      expect(first!.x).toBe(second!.x);
      expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
      await visual.capture("ai.setup.embedded-providers");
      if (!info.project.name.match(/^(desktop|mobile)$/u)) {
        await page.screenshot({
          path: info.outputPath("onboarding-providers.png"),
        });
      }
      await list.getByRole("button", { name: "OpenAI", exact: true }).click();
      await expect(page.getByLabel("Connection name (optional)")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Sign in with ChatGPT", exact: true }),
      ).toBeVisible();
      await visual.capture("ai.setup.embedded-methods");
      if (!info.project.name.match(/^(desktop|mobile)$/u)) {
        await page.screenshot({
          path: info.outputPath("onboarding-methods.png"),
        });
      }
      await page
        .getByRole("button", { name: "Sign in with ChatGPT", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Open sign-in in browser",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Cancel sign-in", exact: true })
        .click();
      await expect(page.getByLabel("Connection name (optional)")).toBeVisible();
    },
  );
}
