import { expect, test } from "./test";

test("empty conversation reuses the large greeting and keeps its text through input and resizing", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=chat-empty");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await opened;
  await preview.waitForLoadState("load");
  await expect(
    preview.getByRole("heading", { name: "New chat", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".welcome-bend svg")).toBeVisible();
  await expect(preview.locator(".chat-footer, .bend-status")).toHaveCount(0);
  const greeting = await preview.locator(".greeting h2 .sr-only").textContent();
  await expect(preview.locator(".greeting")).toHaveAttribute(
    "data-state",
    "done",
  );
  await expect(preview.locator(".greeting-letter.unrevealed")).toHaveCount(0);
  await preview
    .getByLabel("Message", { exact: true })
    .fill("Keep this thought");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep this thought",
  );
  await expect(preview.locator(".greeting h2 .sr-only")).toHaveText(greeting!);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.locator(".greeting h2 .sr-only")).not.toHaveText(
    greeting!,
  );
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect(preview.locator(".greeting")).toHaveAttribute(
    "data-state",
    "done",
  );
  expect(
    await preview
      .locator(".greeting")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(preview.getByLabel("Message", { exact: true })).toHaveValue("");
});
