import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test.use({ localizationMode: "real" });

test("startup uses compatible viewport directives without browser warnings", async ({
  page,
  browserName,
}) => {
  const diagnostics: string[] = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type()))
      diagnostics.push(message.text());
  });
  await workspaceFixture(page, shellState);
  await page.goto("/");
  await expect(page.locator(".topic-window")).toBeVisible();
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    browserName === "chromium"
      ? "width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
      : "width=device-width, initial-scale=1.0, viewport-fit=cover",
  );
  expect(diagnostics).toEqual([]);
});
