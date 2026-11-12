import { selectOption, selectOptions } from "./select";
import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";
async function open(
  page: Page,
  scenario = "chat-queue-mixed",
  expandPending = true,
) {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.waitForLoadState("load");
  await expect(preview.locator(".queue-composer")).toBeVisible();
  if (expandPending)
    await preview
      .getByRole("button", { name: /^\d+ pending messages?$/ })
      .click();
  return preview;
}
const composer = (page: Page) => page.locator(".queue-composer textarea");
async function clearPendingDraft(controls: Page, preview: Page) {
  await selectScenario(controls, "chat-queue-mixed");
  await preview
    .getByRole("button", { name: "Edit all pending", exact: true })
    .click();
  const remove = preview.getByRole("button", { name: /^Remove attachment / });
  while (await remove.count()) await remove.first().click();
  await composer(preview).fill("");
}

test("pending messages start compact and expand on demand without losing the draft", async ({
  page,
}, testInfo) => {
  const preview = await open(page, "chat-queue-long", false);
  await preview.setViewportSize({ width: 390, height: 844 });
  const toggle = preview.getByRole("button", {
    name: "4 pending messages",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(preview.locator(".pending-list")).toBeHidden();
  const compact = await preview.locator(".pending").boundingBox();
  expect(compact!.height).toBeLessThanOrEqual(56);
  const historyBefore = await preview.locator(".queue-history").boundingBox();
  await preview.screenshot({
    path: testInfo.outputPath("queue-collapsed-narrow.png"),
  });
  await toggle.focus();
  await preview.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    preview.getByRole("heading", { name: /^Steering/ }),
  ).toBeVisible();
  await expect(
    preview.getByRole("heading", { name: /^Follow-up/ }),
  ).toBeVisible();
  const rows = preview.locator(".pending-message > summary");
  await expect(rows).toHaveCount(4);
  const listBox = await preview.locator(".pending-list").boundingBox();
  for (const row of await rows.all()) {
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(listBox!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      listBox!.y + listBox!.height,
    );
  }
  await preview.screenshot({
    path: testInfo.outputPath("queue-four-pending-rows.png"),
  });
  await rows.first().click();
  await expect(preview.locator(".pending-body").first()).toBeVisible();
  await expect(preview.locator(".pending-body").first()).toContainText(
    "shorten the introduction, not the conversation",
  );
  await rows.first().click();
  await toggle.focus();
  const historyExpanded = await preview.locator(".queue-history").boundingBox();
  expect(historyBefore!.height).toBeGreaterThan(historyExpanded!.height + 100);
  await preview.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(composer(preview)).toHaveValue(
    "Also keep the invitation informal.",
  );
  await composer(preview).fill("Another steering message");
  await composer(preview).press("Enter");
  await expect(
    preview.getByRole("button", { name: "5 pending messages", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await preview
    .getByRole("button", { name: "Edit all pending", exact: true })
    .click();
  await expect(preview.locator(".pending")).toHaveCount(0);
  await expect(composer(preview)).toBeFocused();
  await composer(preview).press("Enter");
  await expect(
    preview.getByRole("button", { name: "1 pending message", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("attachments can be removed before sending and empty queues show no placeholder", async ({
  page,
}) => {
  const preview = await open(page);
  await preview
    .getByRole("button", {
      name: "Remove attachment Room details.md",
      exact: true,
    })
    .click();
  await expect(preview.locator(".draft-attachments")).toHaveCount(0);
  await expect(composer(preview)).toHaveValue(
    "Also keep the invitation informal.",
  );
  await expect(composer(preview)).toBeFocused();
  await preview
    .locator(".pending-message")
    .filter({ hasText: "After this, draft a short invitation." })
    .locator("summary")
    .click();
  await expect(
    preview
      .locator(".pending")
      .getByRole("button", { name: /^Remove attachment / }),
  ).toHaveCount(0);
  await expect(preview.locator(".pending-message")).toHaveCount(3);
  await expect(
    preview
      .locator(".pending")
      .getByText("Invitation outline.md", { exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Edit all pending", exact: true })
    .click();
  await expect(preview.locator(".draft-attachments .attachment")).toHaveText([
    "Agenda notes.md",
    "Invitation outline.md",
  ]);
  await preview
    .getByRole("button", {
      name: "Remove attachment Invitation outline.md",
      exact: true,
    })
    .focus();
  await preview.keyboard.press("Enter");
  await expect(preview.locator(".draft-attachments .attachment")).toHaveText([
    "Agenda notes.md",
  ]);
  await expect(preview.locator(".pending, .queue-empty")).toHaveCount(0);
  await expect(
    preview.getByText("No pending messages", { exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", {
      name: "Remove attachment Agenda notes.md",
      exact: true,
    })
    .click();
  await expect(preview.locator(".draft-attachments")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Queue steering", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "3 pending messages", exact: true })
    .click();
  for (const summary of await preview
    .locator(".pending-message > summary")
    .all())
    await summary.click();
  await expect(
    preview
      .locator(".pending")
      .getByRole("button", { name: /^Remove attachment / }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: /^Remove attachment / }),
  ).toHaveCount(1);
});

test("preview omits shortcut instructions while retaining accessible queue actions", async ({
  page,
}) => {
  const preview = await open(page);
  const edit = preview.getByRole("button", {
    name: "Edit all pending",
    exact: true,
  });
  await expect(edit).toBeVisible();
  await expect(edit).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp");
  await expect(
    preview.getByRole("heading", { name: /^Steering/ }),
  ).toBeVisible();
  await expect(
    preview.getByRole("heading", { name: /^Follow-up/ }),
  ).toBeVisible();
  for (const phase of ["working", "compacting", "stopped", "complete"]) {
    await selectOption(page.getByLabel("Task state"), phase);
    await expect(preview.locator(".queue-chat")).not.toContainText(
      /Alt\+|Shift\+|Enter to|ArrowUp/,
    );
    await expect(
      preview.locator("#queue-submit-help, .submit-help, .recall-hint"),
    ).toHaveCount(0);
    await expect(composer(preview)).not.toHaveAttribute("aria-describedby");
    await expect(
      preview.getByRole("textbox", { name: "Message", exact: true }),
    ).toBeVisible();
  }
});

test("Enter steers, Alt+Enter follows up, and restoring merges all pending content without stopping", async ({
  page,
}) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  await expect(
    preview.getByRole("region", { name: "Pending messages", exact: true }),
  ).toBeVisible();
  await composer(preview).fill("A new steering message");
  await composer(preview).press("Enter");
  await expect(preview.locator(".pending-message")).toHaveCount(4);
  await composer(preview).fill("A new follow-up message");
  await composer(preview).press("Alt+Enter");
  await expect(preview.locator(".pending-message")).toHaveCount(5);
  await composer(preview).fill("My existing draft");
  await composer(preview).press("ArrowUp");
  await expect(preview.locator(".pending-message")).toHaveCount(5);
  await composer(preview).press("Alt+ArrowUp");
  await expect(preview.locator(".pending-message")).toHaveCount(0);
  await expect(composer(preview)).toHaveValue(
    "Keep the discussion to chapters 1–4.\n\nLeave ten minutes for questions.\n\nA new steering message\n\nAfter this, draft a short invitation.\n\nA new follow-up message\n\nMy existing draft",
  );
  await expect(composer(preview)).toBeFocused();
  await expect(preview.locator(".draft-attachments .attachment")).toHaveCount(
    3,
  );
  await expect(
    preview.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(
    preview
      .getByRole("status")
      .filter({ hasText: "All pending messages moved to the draft." }),
  ).toBeVisible();
  await composer(preview).press("Alt+ArrowUp");
  await expect(composer(preview)).toHaveValue(/My existing draft$/);
  await expect(preview.locator(".received")).toHaveCount(0);
  await expect(
    page.getByLabel("Restore shortcut (decision pending)"),
  ).toHaveCount(0);
  await composer(preview).press("Enter");
  await composer(preview).press("ArrowUp");
  await expect(preview.locator(".pending-message")).toHaveCount(1);
  await preview.getByRole("button", { name: "Edit all pending" }).click();
  await expect(composer(preview)).toBeFocused();
  expect(errors).toEqual([]);
});

test("consumption, task completion, compaction and stop retain only still-pending input", async ({
  page,
}) => {
  const preview = await open(page);
  await page.getByRole("button", { name: "Consume next steering" }).click();
  await expect(preview.locator(".pending-message")).toHaveCount(2);
  await preview.getByRole("button", { name: "Edit all pending" }).click();
  await expect(composer(preview)).toHaveValue(
    "Leave ten minutes for questions.\n\nAfter this, draft a short invitation.\n\nAlso keep the invitation informal.",
  );
  await expect(preview.locator(".received summary")).toContainText(
    "1 message received",
  );
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await selectOption(page.getByLabel("Task state"), "compacting");
  await expect(
    page.getByRole("button", { name: "Consume next steering" }),
  ).toBeDisabled();
  await composer(preview).fill("Wait until the plan is finished");
  await composer(preview).press("Alt+Enter");
  await expect(preview.locator(".pending-message")).toHaveCount(4);
  await expect(
    preview.getByText("Making room to keep going.", { exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview.locator(".queue-footer .bend-status")).toHaveCount(0);
  await expect(preview.locator(".phase-status")).toHaveText("Stopped");
  await expect(
    preview.getByText("Stopped. The note changes shown above were saved.", {
      exact: true,
    }),
  ).toBeHidden();
  expect(
    await preview.locator(".phase-status").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderInlineStartWidth,
      };
    }),
  ).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px" });
  await expect(composer(preview)).toHaveValue(
    "Keep the discussion to chapters 1–4.\n\nLeave ten minutes for questions.\n\nAfter this, draft a short invitation.\n\nWait until the plan is finished",
  );
  await expect(preview.locator(".draft-attachments .attachment")).toHaveText([
    "Agenda notes.md",
    "Invitation outline.md",
    "Room details.md",
  ]);
  await expect(composer(preview)).toBeFocused();
  await expect(preview.locator(".received")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Edit all pending" }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }).last(),
  ).toBeVisible();
  await expect(preview.locator(".pending-message")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await page.getByRole("button", { name: "Consume next steering" }).click();
  await page.getByRole("button", { name: "Consume next steering" }).click();
  await expect(preview.locator(".pending-message")).toHaveCount(1);
  await page.getByRole("button", { name: "Finish current task" }).click();
  await expect(preview.locator(".pending-message")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish current task" }).click();
  await expect(preview.locator(".queue-footer .bend-status")).toHaveCount(0);
});

test("Stop restores only pending messages into the existing draft and stopped fixtures never send", async ({
  page,
}, testInfo) => {
  const preview = await open(page);
  await page.getByRole("button", { name: "Consume next steering" }).click();
  await page.getByRole("button", { name: "Consume next steering" }).click();
  await composer(preview).fill("My draft\nSecond line");
  await composer(preview).press("End");
  const cursor = await composer(preview).evaluate(
    (element) => (element as HTMLTextAreaElement).selectionStart,
  );
  await composer(preview).press("ArrowUp");
  expect(
    await composer(preview).evaluate(
      (element) => (element as HTMLTextAreaElement).selectionStart,
    ),
  ).toBeLessThan(cursor);
  await expect(preview.locator(".pending-message")).toHaveCount(1);
  await expect(composer(preview)).toHaveValue("My draft\nSecond line");
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(composer(preview)).toHaveValue(
    "After this, draft a short invitation.\n\nMy draft\nSecond line",
  );
  await expect(preview.locator(".draft-attachments .attachment")).toHaveText([
    "Invitation outline.md",
    "Room details.md",
  ]);
  await expect(preview.locator(".received summary")).toContainText(
    "2 messages received",
  );
  await expect(preview.locator(".pending-message")).toHaveCount(0);
  await expect(preview.locator(".queue-footer .bend-status")).toHaveCount(0);
  await expect(composer(preview)).toBeFocused();
  await composer(preview).press("Alt+ArrowUp");
  await expect(composer(preview)).toHaveValue(
    "After this, draft a short invitation.\n\nMy draft\nSecond line",
  );
  await selectScenario(page, "chat-queue-stopped");
  await expect(composer(preview)).toHaveValue(
    "Keep the discussion to chapters 1–4.\n\nLeave ten minutes for questions.\n\nAfter this, draft a short invitation.\n\nAlso keep the invitation informal.",
  );
  await expect(preview.locator(".draft-attachments .attachment")).toHaveText([
    "Agenda notes.md",
    "Invitation outline.md",
    "Room details.md",
  ]);
  await expect(
    preview.locator(".pending-message, .received, .queue-footer .bend-status"),
  ).toHaveCount(0);
  await preview.screenshot({
    path: testInfo.outputPath("queue-stopped-restored.png"),
  });
  await clearPendingDraft(page, preview);
  await composer(preview).fill("Keep this unsent");
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(composer(preview)).toHaveValue("Keep this unsent");
  await expect(
    preview.locator(".pending-message, .received, .queue-footer .bend-status"),
  ).toHaveCount(0);
});

test("long queues reflow, preserve drafts across environment changes, and retain accessible motion controls", async ({
  page,
}, testInfo) => {
  const preview = await open(page, "chat-queue-long");
  await preview.setViewportSize({ width: 1280, height: 800 });
  await expect(preview.locator(".pending-message")).toHaveCount(4);
  await expect(
    preview.getByRole("heading", { name: /^Follow-up · 2/ }),
  ).toBeVisible();
  await expect(preview.locator(".queue-history .change-card")).toHaveCount(2);
  await preview.locator(".queue-history .activity > summary").first().click();
  await preview
    .locator(".queue-history .call-detail > summary")
    .first()
    .click();
  await expect(
    preview.getByText("query: reading group", { exact: true }),
  ).toBeVisible();
  await preview.locator(".queue-history .activity > summary").first().click();
  await preview.screenshot({ path: testInfo.outputPath("queue-desktop.png") });
  await composer(preview).fill("Keep this draft");
  await composer(preview).press("Shift+Enter");
  await composer(preview).press("End");
  await expect(composer(preview)).toHaveValue("Keep this draft\n");
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(composer(preview)).toHaveValue("Keep this draft\n");
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await preview.screenshot({ path: testInfo.outputPath("queue-narrow.png") });
  for (const label of [
    "Pending steering messages",
    "Pending follow-up messages",
  ]) {
    const box = await preview.getByLabel(label, { exact: true }).boundingBox();
    expect(box!.y + box!.height).toBeLessThan(844);
    await preview.getByLabel(label, { exact: true }).focus();
    await preview.keyboard.press("End");
  }
  await selectOption(page.getByLabel("Platform profile"), "ios");
  await page.getByLabel("Keyboard occlusion").check();
  await expect(composer(preview)).toHaveValue("Keep this draft\n");
  await composer(preview).focus();
  await composer(preview).scrollIntoViewIfNeeded();
  await expect(composer(preview)).toBeInViewport();
  await preview.screenshot({
    path: testInfo.outputPath("queue-ios-keyboard.png"),
  });
  await page.getByLabel("Keyboard occlusion").uncheck();
  await selectOption(page.getByLabel("Platform profile"), "mac");
  await preview
    .getByRole("button", { name: "Pause animation", exact: true })
    .last()
    .click();
  await expect(
    preview
      .getByRole("button", { name: "Resume animation", exact: true })
      .last(),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      preview
        .locator(".queue-footer .mini-bend-playful")
        .evaluate((element) => element.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  await preview
    .getByRole("button", { name: "Resume animation", exact: true })
    .last()
    .click();
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      preview
        .locator(".queue-footer .mini-bend-playful")
        .evaluate((element) => element.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  await clearPendingDraft(page, preview);
  await expect(
    (
      await selectOptions(
        page.getByRole("combobox", { name: "Scenario", exact: true }),
      )
    ).filter((option) => option.value === "chat-queue-empty"),
  ).toHaveLength(0);
  await expect(
    preview.getByText("No pending messages", { exact: true }),
  ).toHaveCount(0);
  await expect(preview.locator(".pending")).toHaveCount(0);
  await expect(composer(preview)).toHaveValue("");
  await composer(preview).press("Alt+ArrowUp");
  await expect(composer(preview)).toHaveValue("");
});
