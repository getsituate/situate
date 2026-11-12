import { selectScenario } from "./scenarios";
import { chooseSelect } from "./select";
import { expect, test } from "./test";

test("work time groups follow-ups, ends at questions and survives resize and reset", async ({
  page,
}, testInfo) => {
  const now = new Date("2026-01-01T12:00:00Z");
  await page.clock.setFixedTime(now);
  await page.goto("/?workshop=controls&scenario=chat-work-time-working");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  await preview.clock.setFixedTime(now);
  await expect(preview.locator(".bend-status")).toBeVisible();
  await expect(preview.locator(".work-duration")).toHaveCount(0);
  const message = preview.getByLabel("Message", { exact: true });
  await message.fill("Keep the list short.");
  await message.press("Enter");
  await expect(
    preview.getByText("Keep the list short.", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("timer")).toHaveText("1:09");
  await page
    .getByRole("button", { name: "Advance work by 15 seconds" })
    .click();
  await chooseSelect(page.getByLabel("Composer control language"), "de");
  await chooseSelect(page.getByLabel("Response state"), "complete");
  await expect(preview.locator(".work-history-heading")).toHaveText([
    "1 Min. 24 Sek. gearbeitet",
  ]);
  await expect(preview.locator(".bend-status")).toHaveCount(0);
  await message.fill("Draft for the next request");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(message).toHaveValue("Draft for the next request");
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await preview.locator(".work-history-heading").scrollIntoViewIfNeeded();
  await preview.screenshot({
    path: testInfo.outputPath("work-time-mobile.png"),
  });
  await message.fill("Add a second selection.");
  await message.press("Enter");
  await expect(preview.getByRole("timer")).toHaveText("0:00");
  await page
    .getByRole("button", { name: "Advance work by 15 seconds" })
    .click();
  await page
    .getByRole("button", { name: "Ask a question and end block" })
    .click();
  await expect(preview.locator(".work-history-heading")).toHaveText([
    "1 Min. 24 Sek. gearbeitet",
    "15 Sek. gearbeitet",
  ]);
  await expect(
    preview.getByText("Welche Notiz soll ich verwenden?", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Advance work by 15 seconds" }),
  ).toHaveCount(0);
  await message.fill("Book shortlist.md");
  await message.press("Enter");
  await expect(preview.getByRole("timer")).toHaveText("0:00");
  await page
    .getByRole("button", { name: "Advance work by 15 seconds" })
    .click();
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.locator(".work-history-heading").last()).toHaveText(
    "Gestoppt · 15 Sek. gearbeitet",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator(".work-duration")).toHaveCount(0);
  await expect(message).toHaveValue("");
  await expect(preview.getByRole("timer")).toHaveText("1:09");
  await chooseSelect(page.getByLabel("Response state"), "error");
  await expect(preview.locator(".work-history-heading")).toHaveText([
    "Ended with an error · worked for 1 min 9 sec",
  ]);
  await preview.setViewportSize({ width: 1100, height: 820 });
  await preview.locator(".work-history-heading").scrollIntoViewIfNeeded();
  await preview.screenshot({
    path: testInfo.outputPath("work-time-desktop.png"),
  });
});

test("chat preserves chronology, discloses calls and retains drafts on resize", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=chat-complete");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  await expect(
    preview.getByRole("heading", { name: "A plan for Thursday" }),
  ).toBeVisible();
  await expect(preview.locator(".chat-kicker, .chat-context")).toHaveCount(0);
  await expect(
    preview.getByRole("button", {
      name: "Split pane — A plan for Thursday",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", {
      name: "Close pane — A plan for Thursday",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Dictate text", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Attach file", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".work-history-toggle")).toHaveCount(1);
  await expect(preview.locator(".activity, .speaker, .plugin-use")).toHaveCount(
    0,
  );
  await expect(preview.locator(".change-card")).toHaveCount(2);
  const summary = preview.locator(".work-history-toggle");
  await summary.focus();
  await preview.keyboard.press("Enter");
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await preview.locator(".history-tools > summary").first().click();
  await preview.locator(".history-call > summary").first().click();
  await expect(
    preview.getByText("query: reading group", { exact: true }),
  ).toBeVisible();
  await preview.getByLabel("Message", { exact: true }).fill("Keep my draft");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep my draft",
  );
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await selectScenario(page, "chat-work-history-working");
  await expect(
    preview.getByText("Situate is working", { exact: true }),
  ).toBeVisible();
  const inputBox = await preview
    .getByLabel("Message", { exact: true })
    .boundingBox();
  const statusBox = await preview.locator(".bend-status").boundingBox();
  expect(statusBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
  const stopBox = await preview
    .getByRole("button", { name: "Stop", exact: true })
    .boundingBox();
  expect(stopBox!.y).toBeLessThan(statusBox!.y);
  await expect(
    preview
      .locator(".input-line")
      .getByRole("button", { name: "Attach file", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".attach-action")).toHaveCount(0);
  expect(statusBox!.height).toBeLessThanOrEqual(40);
  await expect(preview.locator(".mini-bend-playful")).toBeVisible();
  await preview
    .getByRole("button", { name: "Pause animation", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Resume animation", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    preview.getByText("Situate is working", { exact: true }),
  ).toBeVisible();
  expect(
    await preview
      .locator(".mini-bend-playful")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await preview
    .getByRole("button", { name: "Resume animation", exact: true })
    .click();
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      preview
        .locator(".mini-bend-playful")
        .evaluate((element) => element.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.locator(".bend-status")).toHaveCount(0);
  await expect(preview.locator(".chat-error")).toHaveCount(0);
  await expect(preview.locator(".work-history-toggle")).toContainText(
    "Stopped",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue("");
  await expect(preview.locator(".bend-status")).toBeVisible();
});
