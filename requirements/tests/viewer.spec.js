import { test, expect } from "./browser-test.js";

test("search, filters, reset and shareable filter state", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Situate · Requirements");
  await expect(page.getByRole("status")).toHaveText("2 of 2 entries");
  await page.getByRole("searchbox").fill("verifiable");
  await expect(page.getByRole("status")).toHaveText("1 of 2 entries");
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("verifiable");
  await expect(
    page.getByLabel("Status", { exact: true }).locator("option"),
  ).toHaveText(["All", "Approved", "Rejected"]);
  await expect(page.getByLabel("Entry type").locator("option")).toHaveText([
    "All",
    "Goal",
    "Requirement",
  ]);
  await expect(page.getByLabel("Priority").locator("option")).toHaveText([
    "All",
    "Must",
    "Should",
    "Could",
  ]);
  await expect(
    page.getByLabel("Area", { exact: true }).locator("option"),
  ).toHaveText(["All", "Test area"]);
  await page.getByLabel("Status", { exact: true }).selectOption("rejected");
  await expect(
    page.getByRole("heading", { name: "No matching entries" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("status")).toHaveText("2 of 2 entries");
});

test("deep links, related entries, sections and sanitized Markdown", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#entry/REQ-9001");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Example requirement",
  );
  await expect(
    page.locator('main script, main img, main a[href^="javascript:"]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page
    .getByRole("link", { name: "Acceptance criteria", exact: true })
    .click();
  await expect(page).toHaveURL(/section=acceptance-criteria/);
  await expect(page.locator("#section-acceptance-criteria")).toBeVisible();
  await page.getByRole("link", { name: "Problem", exact: true }).click();
  await expect(page).toHaveURL(/entry\/GOAL-9001\?section=user-problem/);
  await expect(
    page.getByRole("heading", { name: "Requirements for this goal" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "REQ-9001 · Example requirement" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Example requirement",
  );
  expect(errors).toEqual([]);
});

test("milestone scope, unplanned criteria and shareable routes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Milestones", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Milestones",
  );
  await page.getByRole("link", { name: "MVP", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("MVP");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("main")).toContainText(
    "1 of 2 criteria implemented",
  );
  await expect(page.locator("main")).toContainText(
    "Overall implementation: Partially implemented",
  );
  await expect(page.locator("main")).not.toContainText(
    "Related outcomes can be grouped.",
  );
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page
    .getByRole("link", { name: "REQ-9001 · Example requirement" })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await expect(page.locator("main img")).toHaveCount(0);
  await page.getByRole("link", { name: "Not planned", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Not planned",
  );
  await page.goto("/#milestones?name=missing");
  await expect(
    page.getByRole("heading", { name: "Milestone not found" }),
  ).toBeVisible();
  await page.goto("/#milestones");
  await page
    .getByRole("link", { name: 'Later / "extended" & more', exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    'Later / "extended" & more',
  );
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("main")).toContainText(
    "Milestone scope: Implemented · 1 of 1 criteria implemented",
  );
  await expect(page.locator("main")).toContainText(
    "Overall implementation: Partially implemented",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("structured acceptance criteria are searchable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("AC-03 grouped");
  await expect(page.getByRole("status")).toHaveText("1 of 2 entries");
});

test("foundations, invalid routes and narrow layouts", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Foundations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Constraints" }),
  ).toBeVisible();
  await page.goto("/#entry/%invalid");
  await expect(
    page.getByRole("heading", { name: "Entry not found" }),
  ).toBeVisible();
});
