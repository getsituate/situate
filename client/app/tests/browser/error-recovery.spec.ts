import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
test.use({ localizationMode: "real", locale: "en-US" });
for (const width of [1440, 390]) {
  test(
    `unexpected failure preserves work and offers a private report at ${width}px`,
    { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
    async ({ page, visual }) => {
      await page.setViewportSize({ width, height: 900 });
      await workspaceFixture(page, { ...shellState, mobile: width < 600 });
      await page.goto("/");
      const composer = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await composer.fill("PRIVATE_DRAFT_MARKER");
      await page.evaluate(() => {
        Object.defineProperty(crypto, "randomUUID", {
          configurable: true,
          value: () => "11111111-1111-4111-8111-111111111111",
        });
        void Promise.reject(
          new Error("PRIVATE_EXCEPTION_MARKER /private/path token=private"),
        );
      });
      const dialog = page.getByRole("dialog", {
        name: "Oops. Something went wrong.",
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Reload workspace", exact: true }),
      ).toBeDisabled();
      await expect
        .poll(() =>
          dialog
            .locator(".recovery-bend")
            .evaluate(
              (el) =>
                el
                  .getAnimations({ subtree: true })
                  .filter((a) => a.playState === "running").length,
            ),
        )
        .toBe(0);
      await visual.capture("recovery.unexpected");
      await dialog
        .getByRole("button", { name: "Report a problem", exact: true })
        .click();
      const report = page.getByRole("dialog", {
        name: "Review problem report",
      });
      await report
        .getByLabel("What were you doing? (optional)", { exact: true })
        .fill("Opening a view");
      await report.getByText("Technical details", { exact: true }).click();
      await expect(report).not.toContainText("PRIVATE_DRAFT_MARKER");
      await expect(report).not.toContainText("PRIVATE_EXCEPTION_MARKER");
      await expect(report).not.toContainText("/private/path");
      await visual.capture("recovery.report");
      await report
        .getByRole("button", { name: "Open email draft", exact: true })
        .click();
      const mail = page.getByRole("dialog", {
        name: "Email draft",
        exact: true,
      });
      await expect(mail).toBeVisible();
      await expect(
        mail.getByRole("textbox", { name: "Report text", exact: true }),
      ).toHaveValue(/Opening a view/);
      await visual.capture("recovery.mail-unavailable");
      await mail.getByRole("button", { name: "Close", exact: true }).click();
      await expect(composer).toHaveValue("PRIVATE_DRAFT_MARKER");
      await page.evaluate(() => {
        void Promise.reject(new Error("PRIVATE_EXCEPTION_MARKER"));
      });
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: "Review error", exact: true }),
      ).toHaveCount(1);
    },
  );
}
