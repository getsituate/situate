import { expect, test } from "./test";
import { selectScenario } from "./scenarios";
import { selectOption, selectOptions } from "./select";
import { conversationScenarios } from "../../src/chat/conversation-presets";

test("Conversation has ten starting states with one transcript style", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=chat-work-history");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  const options = await selectOptions(
    page.getByLabel("Starting state", { exact: true }),
  );
  expect(options.map((option) => option.value)).toEqual(
    conversationScenarios.map((state) => state.id),
  );
  for (const state of conversationScenarios) {
    await selectScenario(page, state.id);
    await expect(preview.locator(".chat-screen")).toBeVisible();
    await expect(
      preview.locator(".speaker, .activity, .plugin-use, .work-duration"),
    ).toHaveCount(0);
    if (
      state.id === "chat-question" ||
      state.id === "chat-work-history-approval"
    )
      await expect(preview.locator(".question-dock")).toBeVisible();
    if (state.id === "chat-work-history-changes")
      await expect(preview.locator(".change-card")).toBeVisible();
    if (state.id === "chat-work-history-error") {
      await expect(preview.locator(".work-history-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(preview.locator(".history-tools:visible")).toHaveCount(0);
    }
    await preview.screenshot({
      path: test.info().outputPath(`${state.id}.png`),
    });
  }
});

test("working examples switch between reasoning and follow-ups without adding starting states", async ({
  page,
}) => {
  const now = new Date("2026-01-01T12:00:00Z");
  await page.clock.setFixedTime(now);
  await page.goto("/?workshop=controls&scenario=chat-work-history-working");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.clock.setFixedTime(now);
  const examples = page.getByLabel("Work history example", { exact: true });
  const message = preview.getByLabel("Message", { exact: true });
  await message.fill("Replace this example draft");
  await selectOption(examples, "followup");
  await expect(message).toHaveValue("");
  await message.fill("Keep it brief.");
  await message.press("Enter");
  await expect(
    preview.getByText("Keep it brief.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Advance work by 15 seconds", exact: true })
    .click();
  await selectOption(
    page.getByLabel("Response state", { exact: true }),
    "complete",
  );
  await expect(preview.locator(".work-history-heading")).toHaveText(
    "Worked for 1 min 24 sec",
  );
  await expect(
    preview.getByText("Keep it brief.", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.locator(".speaker, .activity, .work-duration"),
  ).toHaveCount(0);
  await selectOption(examples, "long");
  await expect(preview.locator(".work-history-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await preview.locator(".work-history-toggle").click();
  await expect(preview.locator(".history-reasoning h3").first()).toHaveText(
    "Preserve the open conversation",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(examples).toHaveAttribute("data-value", "mixed");
  await expect(preview.locator(".bend-status")).toBeVisible();
});
