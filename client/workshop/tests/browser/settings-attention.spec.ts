import { selectOption } from "./select";
import { expect, test, type Page } from "./test";
import { providerStates } from "../../src/settings/model";
import { attentionCopy } from "../../src/settings/content";

async function open(page: Page, scenario = "settings-error") {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  return popup;
}

for (const width of [1280, 390]) {
  test(`provider attention keeps the Settings layout at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page);
    await preview.setViewportSize({ width, height: 900 });
    const external: string[] = [];
    preview.on("request", (request) => {
      if (!request.url().startsWith(new URL(preview.url()).origin))
        external.push(request.url());
    });
    await expect(
      preview.getByRole("heading", { name: "Connections" }),
    ).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "Reconnect", exact: true }),
    ).toBeVisible();
    const select = page.getByLabel("Provider state", { exact: true });
    for (const state of providerStates) {
      await selectOption(select, state.id);
      await expect(
        preview.getByRole("heading", { name: "Connections" }),
      ).toBeVisible();
      await expect(
        preview.getByLabel("Chat connection", { exact: true }),
      ).toBeVisible();
      await expect(
        preview.getByText("Advanced settings", { exact: true }),
      ).toBeVisible();
      await expect(preview.locator(".ai-view")).toHaveCount(0);
      if (state.id === "ready") {
        await expect(preview.locator(".settings-attention")).toHaveCount(0);
      } else {
        const copy =
          attentionCopy[state.id === "session" ? "reconnect" : state.id];
        await expect(
          preview.locator(".provider-row").filter({ hasText: copy.status }),
        ).toHaveCount(1);
        await expect(preview.locator(".settings-attention")).toHaveText(
          state.id === "reconnect"
            ? "Reconnect Anthropic before sending a message."
            : state.id === "session"
              ? "Reconnect OpenAI before sending a message."
              : copy.detail,
        );
        if (copy.action) {
          const action = preview.getByRole("button", {
            name: copy.action,
            exact: true,
          });
          await action.focus();
          await expect(action).toBeInViewport();
        }
      }
      expect(
        await preview.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await preview.screenshot({
        path: info.outputPath(`settings-attention-${state.id}-${width}.png`),
      });
    }
    expect(external).toEqual([]);
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(select).toHaveAttribute("data-value", "reconnect");
    await expect(
      preview.getByRole("button", { name: "Reconnect", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("combobox", { name: "Scenario", exact: true })
        .locator(
          'option[value="ai-locked"], option[value="settings-session-error"]',
        ),
    ).toHaveCount(0);
  });
}

test("inline recovery follows the visible category and reset cancels pending work", async ({
  page,
}) => {
  const preview = await open(page);
  const select = page.getByLabel("Provider state", { exact: true });
  for (const state of ["locked", "store-denied", "store-unavailable"]) {
    await selectOption(select, state);
    await preview
      .getByRole("button", { name: "Try again", exact: true })
      .click();
    await expect(
      preview.getByRole("button", { name: "Trying…", exact: true }),
    ).toBeDisabled();
    await expect(preview.getByRole("status")).toContainText(
      "Waiting for access",
    );
    await page.locator('[data-outcome="store-ready"]').click();
    await expect(preview.locator(".settings-attention")).toHaveCount(0);
    await expect(preview.locator(".ai-view")).toHaveCount(0);
    await expect(select).toHaveAttribute("data-value", "ready");
  }
  await selectOption(select, "locked");
  await preview.getByRole("button", { name: "Try again", exact: true }).click();
  await preview
    .getByRole("button", { name: "Language & formats", exact: true })
    .click();
  await expect(select).toHaveCount(0);
  await expect(page.locator('[data-outcome="store-ready"]')).toHaveCount(0);
  await preview
    .getByRole("button", { name: "AI & models", exact: true })
    .click();
  await expect(select).toHaveAttribute("data-value", "locked");
  await expect(page.locator('[data-outcome="store-ready"]')).toBeVisible();
  await selectOption(select, "missing");
  await expect(page.locator('[data-outcome="store-ready"]')).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Connect again", exact: true }),
  ).toBeVisible();
  await selectOption(select, "locked");
  await preview.getByRole("button", { name: "Try again", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(page.locator('[data-outcome="store-ready"]')).toHaveCount(0);
  await expect(select).toHaveAttribute("data-value", "reconnect");
});

test("sign-in that would end another session cannot be continued", async ({
  page,
}, info) => {
  const preview = await open(page, "ai-session-replacement");
  await expect(
    preview.getByRole("heading", { name: "Choose another sign-in method" }),
  ).toBeVisible();
  await expect(
    preview.getByText(/would end the session on your other device/),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Open sign-in in browser" }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Use on this device" }),
  ).toHaveCount(0);
  await expect(page.locator("[data-outcome]")).toHaveCount(0);
  for (const width of [1280, 390]) {
    await preview.setViewportSize({ width, height: 844 });
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.screenshot({
      path: info.outputPath(`device-sign-in-blocked-${width}.png`),
    });
  }
  await preview
    .getByRole("button", { name: "Choose another method", exact: true })
    .click();
  await preview.locator('[data-method="browser"]').click();
  await expect(
    preview.getByRole("heading", { name: "Choose another sign-in method" }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Choose another method", exact: true })
    .click();
  await preview.locator('[data-method="key"]').click();
  await expect(preview.locator("#credential")).toBeVisible();
});
