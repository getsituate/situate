import { expect, test } from "./test";
import { selectOption } from "./select";

test("a removed account's conversation override can return to the current default without losing its draft", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=chat-complete");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1280, height: 844 });
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Keep this through account changes");
  await preview.getByRole("button", { name: /^Chat model:/ }).click();
  await preview.locator('[data-choice="example-fast"]').click();
  await page
    .getByRole("button", { name: "Model choice saved", exact: true })
    .click();
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await preview
    .getByRole("button", { name: "AI & models", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "+ Add connection", exact: true })
    .click();
  await preview.locator('[data-provider="anthropic"]').click();
  await preview.locator('[data-method="key"]').click();
  await preview.locator("#credential").fill("synthetic-only");
  await preview.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator('[data-outcome="success"]').click();
  await preview
    .getByRole("button", { name: "Back to settings", exact: true })
    .click();
  await selectOption(
    preview.getByLabel("Chat connection", { exact: true }),
    "anthropic-1",
  );
  await preview
    .getByRole("button", { name: "Disconnect OpenAI", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Disconnect connection", exact: true })
    .click();
  await preview.getByRole("button", { name: "Open chat", exact: true }).click();
  const send = preview.getByRole("button", {
    name: "Send message",
    exact: true,
  });
  await expect(send).toBeDisabled();
  await expect(draft).toHaveValue("Keep this through account changes");
  await preview
    .getByRole("button", {
      name: "Model issue: AI access unavailable",
      exact: true,
    })
    .click();
  await preview
    .getByRole("button", { name: "Use workspace default", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Model save outcome uncertain", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", {
      name: "Model choice unconfirmed",
      exact: true,
    }),
  ).toBeVisible();
  await expect(send).toBeDisabled();
  await preview
    .getByRole("button", { name: "Check saved choice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Readback confirms new model", exact: true })
    .click();
  await expect(
    preview.getByRole("button", {
      name: "Chat model: Example Studio. Workspace default",
      exact: true,
    }),
  ).toHaveAttribute(
    "aria-description",
    "Workspace default · Anthropic · Example Studio. Applies to the next message in this conversation on this device.",
  );
  await expect(send).toBeEnabled();
  await expect(draft).toHaveValue("Keep this through account changes");
  await expect(preview.locator(".chat-thread")).not.toContainText(
    "Example Studio",
  );
});
