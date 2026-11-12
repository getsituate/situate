import { expect, test, type Page } from "./test";
import { selectOption } from "./select";

async function open(
  page: Page,
  scenario = "chat-work-history",
  profile?: "ios",
) {
  const now = new Date("2026-01-01T12:00:00Z");
  await page.clock.setFixedTime(now);
  await page.goto(
    `/?workshop=controls&scenario=${scenario}${profile ? `&profile=${profile}` : ""}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  await preview.clock.setFixedTime(now);
  await preview.setViewportSize({ width: 1040, height: 900 });
  await preview.locator(".work-history").waitFor();
  return preview;
}

test("work time opens a chronological history with nested tool details and no answer headline", async ({
  page,
}) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  const toggle = preview.getByRole("button", {
    name: "Worked for 1 min 43 sec",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const answer = preview.getByRole("article", { name: "Answer", exact: true });
  await expect(answer).toBeVisible();
  await expect(answer.locator(".speaker")).toHaveCount(0);
  await expect(preview.locator(".history-plugin")).toHaveCount(0);
  await expect(preview.locator(".call-plugin")).toHaveCount(0);
  await expect(preview.locator(".history-reasoning").first()).toBeHidden();
  await expect(
    preview.getByRole("article", { name: "Progress update" }),
  ).toHaveCount(0);
  await preview.screenshot({
    path: test.info().outputPath("work-history.closed.png"),
  });

  await toggle.focus();
  await preview.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    preview.getByRole("note", { name: "Model reasoning" }),
  ).toHaveCount(3);
  await expect(
    preview.getByRole("article", { name: "Progress update" }),
  ).toHaveCount(2);
  await expect(preview.locator(".history-tools")).toHaveCount(2);
  await expect(preview.locator(".history-reasoning").last()).toContainText(
    "twenty minutes of passages",
  );
  await expect
    .poll(() =>
      preview
        .locator(".history-reasoning")
        .first()
        .evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeLessThan(100);
  await expect(preview.locator(".history-tools").first()).not.toHaveAttribute(
    "open",
  );
  await preview.screenshot({
    path: test.info().outputPath("work-history.open.png"),
  });

  const reads = preview
    .locator(".history-tools")
    .filter({ has: preview.locator("summary", { hasText: "Read 2 files" }) });
  const readSummary = reads.locator(":scope > summary");
  await readSummary.focus();
  await preview.keyboard.press("Enter");
  await expect(reads).toHaveAttribute("open", "");
  await expect(reads.locator(".history-call")).toHaveCount(2);
  const call = reads.locator(".history-call").first();
  await call.locator(":scope > summary").click();
  await expect(call.locator(":scope > summary .call-label")).toHaveText(
    "Reading evenings.md",
  );
  await expect(call.locator("pre").first()).toHaveText(
    JSON.stringify({ path: "Reading evenings.md" }, null, 2),
  );
  await expect(call.locator("pre").last()).toContainText("Start at 18:30");
  await preview.screenshot({
    path: test.info().outputPath("work-history.tool-details.png"),
  });
  await toggle.click();
  await expect(readSummary).toBeHidden();
  await toggle.click();
  await expect(reads).toHaveAttribute("open", "");
  await expect(call).toHaveAttribute("open", "");
  await expect(call.locator("pre").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("plugin origin belongs to the plugin call rather than the work-time heading", async ({
  page,
}) => {
  const preview = await open(page, "chat-work-history-plugin");
  const toggle = preview.locator(".work-history-toggle");
  await expect(preview.locator(".work-history-heading")).not.toContainText(
    "Book shelf",
  );
  await expect(preview.locator(".history-plugin")).toHaveCount(0);
  await toggle.click();
  await preview
    .locator(".history-tools")
    .first()
    .locator(":scope > summary")
    .click();
  const pluginCall = preview
    .locator(".history-call")
    .filter({ has: preview.locator(".call-plugin") });
  await expect(pluginCall.locator(".call-label")).toHaveText("books.search");
  await expect(pluginCall.locator(".call-plugin")).toHaveText("Book shelf");
  await preview
    .locator(".history-tools")
    .last()
    .locator(":scope > summary")
    .click();
  await expect(preview.locator(".history-call .call-plugin")).toHaveCount(1);
  const readLabels = preview
    .locator(".history-tools")
    .last()
    .locator(".call-label");
  await expect(readLabels).toHaveText([
    "Reading evenings.md",
    "Reading notes.md",
  ]);
  await preview.screenshot({
    path: test.info().outputPath("work-history.call-origin.png"),
  });
  await selectOption(page.getByLabel("Work history example"), "mixed");
  const searchGroup = preview.locator(".history-tools").first();
  if ((await searchGroup.getAttribute("open")) === null)
    await searchGroup.locator(":scope > summary").click();
  await expect(preview.locator(".history-call .call-plugin")).toHaveCount(0);
  await expect(preview.locator(".history-call .call-label").first()).toHaveText(
    "reading evening",
  );
});

test("retired reasoning links open the retained work history instead of an old design", async ({
  page,
}) => {
  const preview = await open(page, "chat-reasoning-long");
  await expect(
    page.getByLabel("Starting state", { exact: true }),
  ).toHaveAttribute("data-value", "chat-work-history");
  await expect(preview.locator(".work-history-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(
    preview.locator(".reasoning-marker, .reasoning-heading"),
  ).toHaveCount(0);
  await preview.locator(".work-history-toggle").click();
  await expect(preview.locator(".history-reasoning h3").first()).toHaveText(
    "Preserve the open conversation",
  );
});

test("identified updates fold on completion while deliberate inspection and drafts survive", async ({
  page,
}) => {
  const preview = await open(page, "chat-work-history-working");
  const toggle = preview.locator(".work-history-toggle");
  await expect(toggle).toHaveText("Working…");
  await expect(
    preview.getByRole("article", { name: "Progress update" }),
  ).toHaveCount(2);
  await expect(preview.locator(".history-reasoning").first()).toBeHidden();
  const draft = preview.getByLabel("Message", { exact: true });
  await draft.fill("Keep my draft");
  await page
    .getByRole("button", { name: "Continue the current thought", exact: true })
    .click();
  await selectOption(page.getByLabel("Response state"), "complete");
  await expect(toggle).toHaveText("Worked for 1 min 58 sec");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    preview.getByRole("article", { name: "Progress update" }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("article", { name: "Answer", exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveValue("Keep my draft");
  await toggle.click();
  await expect(preview.locator(".history-reasoning").last()).toContainText(
    "Timing check:",
  );
  await selectOption(page.getByLabel("Response state"), "working");
  const reads = preview.locator(".history-tools").last();
  await reads.locator(":scope > summary").click();
  await reads
    .locator(".history-call")
    .first()
    .locator(":scope > summary")
    .click();
  await selectOption(page.getByLabel("Response state"), "complete");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(reads).toHaveAttribute("open", "");
  await expect(reads.locator(".history-call").first()).toHaveAttribute(
    "open",
    "",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(draft).toHaveValue("");
  await expect(preview.locator(".history-reasoning").last()).not.toContainText(
    "Timing check:",
  );
});

test("different output shapes do not hide unclassified messages, note changes, or invent missing reasoning", async ({
  page,
}) => {
  const preview = await open(page, "chat-work-history-unclassified");
  const unknown = preview.getByText(
    "The previous note says 6:30 pm. That differs from the 7 pm start you requested.",
    { exact: true },
  );
  await expect(unknown).toBeVisible();
  await preview.locator(".work-history-toggle").click();
  await expect(unknown).toBeVisible();
  await selectOption(page.getByLabel("Work history example"), "changes");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await selectOption(page.getByLabel("Work history example"), "changes");
  const toggle = preview.locator(".work-history-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(preview.locator(".change-card")).toBeVisible();
  await expect(preview.locator(".change-card .removed")).toContainText("18:30");
  await expect(preview.locator(".change-card .added")).toContainText("19:00");
  await toggle.click();
  const order = await preview
    .locator(".history-segment")
    .evaluateAll((elements) => elements.map((el) => el.id));
  const changeIndex = order.findIndex((id) =>
    id.endsWith("history-visible-change"),
  );
  expect(changeIndex).toBeGreaterThan(
    order.findIndex((id) => id.endsWith("history-read-plan")),
  );
  expect(changeIndex).toBeLessThan(
    order.findIndex((id) => id.endsWith("history-thought-last")),
  );
  await preview.screenshot({
    path: test.info().outputPath("work-history.visible-change.png"),
  });
  await selectOption(page.getByLabel("Work history example"), "no-reasoning");
  await expect(preview.locator(".history-reasoning")).toHaveCount(0);
  await expect(preview.locator(".history-tools")).toHaveCount(2);
  await selectOption(page.getByLabel("Work history example"), "fragments");
  await expect(preview.locator(".history-reasoning")).toHaveCount(3);
  await selectOption(page.getByLabel("Work history example"), "text-only");
  await expect(
    preview.locator(".work-history-toggle, .history-reasoning, .history-tools"),
  ).toHaveCount(0);
  await expect(preview.locator(".work-history-time")).toHaveText(
    "Worked for 1 min 43 sec",
  );
  await expect(
    preview.getByRole("article", { name: "Answer", exact: true }),
  ).toBeVisible();
});

test("questions and approval remain actionable when the work history is closed", async ({
  page,
}) => {
  const preview = await open(page, "chat-work-history-approval");
  const toggle = preview.locator(".work-history-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    preview.getByRole("button", { name: "Send invitation", exact: true }),
  ).toBeVisible();
  const input = preview.getByLabel("Your answer", { exact: true });
  await input.fill("What will the invitation say?");
  await input.press("Enter");
  await expect(
    preview.getByRole("button", { name: "Send invitation", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByText(
      "The invitation has not been sent. Choose whether to send it or keep it as a draft.",
      { exact: true },
    ),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Keep as draft", exact: true })
    .click();
  await expect(
    preview.getByText("The invitation remains a draft. It has not been sent.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Send invitation", exact: true }),
  ).toHaveCount(0);
  await selectOption(page.getByLabel("Work history example"), "question");
  await expect(
    preview.getByRole("button", { name: "Create a new note", exact: true }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("stopped and interrupted work keeps its history without masquerading as a completed answer", async ({
  page,
}) => {
  const preview = await open(page, "chat-work-history-working");
  await page
    .getByRole("button", { name: "Continue the current thought", exact: true })
    .click();
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.locator(".work-history-toggle")).toContainText(
    "Stopped",
  );
  await expect(preview.locator(".chat-error")).toHaveCount(0);
  await expect(preview.getByRole("timer")).toHaveCount(0);
  await expect(
    preview.getByRole("article", { name: "Answer", exact: true }),
  ).toHaveCount(0);
  await preview.locator(".work-history-toggle").click();
  await expect(preview.locator(".history-reasoning").last()).toContainText(
    "Timing check:",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await selectOption(page.getByLabel("Response state"), "error");
  await expect(preview.locator(".chat-error, [role=alert]")).toHaveCount(0);
  await expect(preview.locator(".work-history-toggle")).toContainText(
    "Ended with an error",
  );
  await expect(
    preview.locator(".history-tools").last().locator(":scope > summary"),
  ).toContainText("Failed");
  await expect(
    preview.locator(".history-tools").last().locator(":scope > summary"),
  ).toBeHidden();
  await preview.locator(".work-history-toggle").click();
  await expect(preview.locator(".history-reasoning")).toHaveCount(3);
  const failed = preview.locator(".history-tools").last();
  await expect(failed.locator(":scope > summary")).toBeVisible();
  await failed.locator(":scope > summary").click();
  await expect(failed.locator(".call-state")).toHaveText("Failed");
  await expect(failed.locator(":scope > summary")).toContainText("File read");
  await expect(failed.locator(":scope > summary")).toContainText("Failed");
  await preview.screenshot({
    path: test.info().outputPath("work-history.interrupted.png"),
  });
});

test.describe("mobile work history", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("long Markdown, nesting, translation and resizing retain drafts", async ({
    page,
  }) => {
    const preview = await open(page, "chat-work-history-long", "ios");
    await preview.setViewportSize({ width: 390, height: 844 });
    const toggle = preview.locator(".work-history-toggle");
    await toggle.tap();
    await expect(preview.locator(".history-reasoning h3").first()).toHaveText(
      "Preserve the open conversation",
    );
    await expect(preview.locator(".history-reasoning pre code")).toContainText(
      "19:25",
    );
    await preview
      .locator(".history-tools")
      .last()
      .locator(":scope > summary")
      .tap();
    await preview
      .locator(".history-call")
      .last()
      .locator(":scope > summary")
      .tap();
    await preview.locator(".history-call-data").last().scrollIntoViewIfNeeded();
    expect(
      await preview
        .locator(".chat-scroll")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await preview.screenshot({
      path: test.info().outputPath("work-history.mobile-details.png"),
    });
    const draft = preview.getByLabel("Message", { exact: true });
    await draft.fill("Keep my draft");
    await page.getByLabel("Keyboard occlusion", { exact: true }).check();
    await expect(draft).toHaveValue("Keep my draft");
    await page.getByLabel("Keyboard occlusion", { exact: true }).uncheck();
    await selectOption(page.getByLabel("Composer control language"), "de");
    await expect(toggle).toContainText("1 Min");
    await expect(
      preview.locator(".history-tools").last().locator(":scope > summary"),
    ).toContainText("2 Dateien gelesen");
    await preview.setViewportSize({ width: 320, height: 700 });
    await expect(draft).toHaveValue("Keep my draft");
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await preview
        .locator(".chat-scroll")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await toggle.tap();
    await expect(
      preview.getByRole("article", { name: "Antwort", exact: true }),
    ).toBeVisible();
    await preview.screenshot({
      path: test.info().outputPath("work-history.mobile-closed-de.png"),
    });
  });
});
