import { expect, test } from "./test";
import { selectOption } from "./select";

test("plugin availability is chronological, quiet and independent of the current topic", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=chat-plugin-available");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  await preview.setViewportSize({ width: 1440, height: 900 });
  const notice = preview.getByRole("note", {
    name: "System message",
    exact: true,
  });
  await expect(notice).toHaveText(
    "“Reading list” is now available in this workspace.",
  );
  const live = preview.locator('[role="status"][aria-live="polite"]');
  await expect(live).toHaveText("");
  await expect(
    preview.locator(".chat-thread > .chat-system-message + article"),
  ).toContainText("Keep the evening free too.");
  await expect(notice.locator("button, a, .speaker")).toHaveCount(0);
  await preview.screenshot({
    path: test.info().outputPath("system-message-en.png"),
  });
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Keep discussing Saturday");
  await page
    .getByRole("button", { name: "Deliver availability notice", exact: true })
    .click();
  await expect(live).toHaveText(
    "“Book shelf” is now available in this workspace.",
  );
  await expect(draft).toHaveValue("Keep discussing Saturday");
  expect(await draft.evaluate((el) => el === document.activeElement)).toBe(
    true,
  );
  await expect(preview.locator(".chat-thread > article")).toHaveCount(5);
  await expect(
    preview.getByText("Situate is working", { exact: true }),
  ).toHaveCount(0);
  await selectOption(page.getByLabel("System message language"), "de");
  await expect(
    preview.getByRole("note", { name: "Systemnachricht" }).first(),
  ).toHaveText("„Reading list“ ist jetzt in diesem Arbeitsbereich verfügbar.");
  await expect(live).toHaveText("");
  await expect(draft).toHaveValue("Keep discussing Saturday");
  await preview.setViewportSize({ width: 390, height: 844 });
  await preview.getByRole("note").last().scrollIntoViewIfNeeded();
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await preview.screenshot({
    path: test.info().outputPath("system-message-de-mobile.png"),
  });
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(live).toHaveText("");
  await expect(preview.getByRole("note")).toHaveCount(1);
});
