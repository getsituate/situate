import { expect, test } from "./test";
import { selectOption } from "./select";

test("the working clock advances below its label, survives reload and freezes on completion", async ({
  page,
}) => {
  const start = Date.parse("2026-01-01T12:00:00Z");
  await page.clock.setFixedTime(start);
  await page.goto("/?workshop=controls&scenario=chat-work-history-working");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.clock.setFixedTime(start);
  const timer = preview.getByRole("timer", { name: "Elapsed working time" });
  await expect(timer).toHaveText("1:43");
  await expect(timer).toHaveAttribute("aria-live", "off");
  const heading = preview.locator(".work-history-toggle");
  expect((await timer.boundingBox())!.y).toBeGreaterThan(
    (await heading.boundingBox())!.y,
  );
  await preview.getByLabel("Message", { exact: true }).fill("Keep this draft");
  await page.clock.setFixedTime(start + 3500);
  await preview.clock.setFixedTime(start + 3500);
  await expect(timer).toHaveText("1:46");
  await preview.reload();
  await expect(timer).toHaveText("1:46");
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep this draft",
  );
  await preview.setViewportSize({ width: 390, height: 844 });
  await selectOption(page.getByLabel("Composer control language"), "de");
  await expect(
    preview.getByRole("timer", { name: "Bisherige Arbeitszeit" }),
  ).toHaveText("1:46");
  await preview.screenshot({
    path: test.info().outputPath("work-clock.mobile.png"),
  });
  await selectOption(page.getByLabel("Response state"), "complete");
  await expect(preview.getByRole("timer")).toHaveCount(0);
  await expect(heading).toHaveText("1 Min. 46 Sek. gearbeitet");
  await page.clock.setFixedTime(start + 30000);
  await preview.clock.setFixedTime(start + 30000);
  await expect(heading).toHaveText("1 Min. 46 Sek. gearbeitet");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByRole("timer")).toHaveText("1:43");
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.getByRole("timer")).toHaveCount(0);
  await expect(preview.locator(".chat-error, [role=alert]")).toHaveCount(0);
  await expect(heading).toHaveText("Stopped · worked for 1 min 43 sec");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await selectOption(page.getByLabel("Response state"), "error");
  await expect(preview.locator(".chat-error, [role=alert]")).toHaveCount(0);
  await expect(heading).toContainText("Ended with an error");
  await expect(
    preview.locator(".history-tools").last().locator(":scope > summary"),
  ).toContainText("Failed");
  await expect(preview.locator(".history-tools").last()).toBeHidden();
  await preview.screenshot({
    path: test.info().outputPath("work-clock.interrupted.png"),
  });
  await heading.click();
  await expect(preview.locator(".history-tools").last()).toBeVisible();
});
