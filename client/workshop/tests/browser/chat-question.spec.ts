import { expect, test, type Page } from "./test";
import { selectOption } from "./select";
import copy from "../../src/localization/en.chat-question.json" with { type: "json" };
import setup from "../../src/localization/en.setup-conversation.json" with { type: "json" };

async function open(page: Page, scenario = "chat-question") {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await opened;
  await preview.waitForLoadState("load");
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await preview.setViewportSize({ width: 1040, height: 760 });
  await expect(preview.locator(".chat-screen")).toBeVisible();
  return preview;
}
const input = (page: Page) => page.locator(".chat-footer").getByRole("textbox");

test("ordinary chat keeps its normal composer without a question surface", async ({
  page,
}) => {
  const preview = await open(page, "chat-complete");
  await expect(input(preview)).toHaveAccessibleName("Message");
  await expect(input(preview)).toHaveAttribute("placeholder", "Message…");
  await expect(preview.locator(".question-dock")).toHaveCount(0);
  await input(preview).fill("A normal message.");
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
});

test("suggested answers send immediately and preserve the only composer draft", async ({
  page,
}, info) => {
  const preview = await open(page);
  await expect(preview.getByRole("textbox")).toHaveCount(1);
  await expect(input(preview)).toHaveAccessibleName(copy.answerLabel);
  await input(preview).fill("Keep this unsent detail.");
  await preview.screenshot({ path: info.outputPath("question-ready.png") });
  const option = preview.getByRole("button", {
    name: copy.travel,
    exact: true,
  });
  await option.focus();
  await option.press("Enter");
  await expect(preview.locator(".chat-message.user")).toHaveCount(1);
  await expect(preview.locator(".chat-message.user")).toContainText(
    copy.travel,
  );
  await expect(preview.locator(".question-dock")).toHaveCount(0);
  await expect(preview.locator(".question-options")).toHaveCount(0);
  await expect(preview.locator(".chat-thread .question-text")).toHaveText(
    copy.question,
  );
  await expect(input(preview)).toHaveValue("Keep this unsent detail.");
  await expect(input(preview)).toBeFocused();
  await preview.reload();
  await expect(preview.locator(".question-options")).toHaveCount(0);
  await expect(input(preview)).toHaveValue("Keep this unsent detail.");
  await preview.screenshot({ path: info.outputPath("question-answered.png") });
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(option).toBeVisible();
  await expect(input(preview)).toHaveValue("");
});

for (const scenario of ["chat-question", "chat-question-open"]) {
  test(`${scenario} always accepts a written answer through the full composer`, async ({
    page,
  }) => {
    const preview = await open(page, scenario);
    await expect(preview.getByRole("textbox")).toHaveCount(1);
    await expect(input(preview)).toHaveAttribute("aria-describedby", /.+/);
    await input(preview).fill("I would rather plan cycling routes.");
    await input(preview).press("Enter");
    await expect(preview.locator(".chat-message.user")).toContainText(
      "I would rather plan cycling routes.",
    );
    await expect(input(preview)).toHaveValue("");
    await expect(input(preview)).toHaveAccessibleName("Message");
    await expect(preview.locator(".question-options")).toHaveCount(0);
  });
}

for (const width of [1040, 390]) {
  test(`answer counts and automatic layouts preserve free entry at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page);
    await preview.setViewportSize({ width, height: 760 });
    for (const [scenario, count, stacked] of [
      ["chat-question-six", 6, false],
      ["chat-question-ten", 10, false],
      ["chat-question-six-long", 6, true],
      ["chat-question-ten-long", 10, true],
    ] as const) {
      await selectOption(
        page.getByLabel("Question example", { exact: true }),
        scenario,
      );
      await expect(input(preview)).toHaveValue("");
      await expect(preview.getByRole("textbox")).toHaveCount(1);
      await expect(preview.locator(".question-dock .question-text")).toHaveText(
        copy.question,
      );
      await expect(preview.locator(".chat-thread .question-text")).toHaveCount(
        0,
      );
      await expect(preview.locator(".question-options--list")).toHaveCount(
        stacked ? 1 : 0,
      );
      await expect(preview.locator(".question-options button")).toHaveCount(6);
      await input(preview).fill("None of these fits; keep my own answer.");
      const box = await input(preview).boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(760);
      expect(
        await preview.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await preview.screenshot({
        path: info.outputPath(`${scenario}-${width}.png`),
      });
      if (count > 6) {
        const more = preview.getByRole("button", {
          name: copy.more.replace("{count}", "4"),
          exact: true,
        });
        await more.click();
        await expect(preview.locator(".question-options button")).toHaveCount(
          10,
        );
        await expect(input(preview)).toHaveValue(
          "None of these fits; keep my own answer.",
        );
        await preview.screenshot({
          path: info.outputPath(`${scenario}-expanded-${width}.png`),
        });
        await preview
          .getByRole("button", { name: copy.fewer, exact: true })
          .click();
        await expect(preview.locator(".question-options button")).toHaveCount(
          6,
        );
        await more.click();
      }
      const last = preview.locator(".question-options button").last();
      const label = await last.innerText();
      await last.focus();
      await expect(last).toBeFocused();
      await last.press("Enter");
      await expect(preview.locator(".chat-message.user").last()).toContainText(
        label.trim(),
      );
      await expect(input(preview)).toHaveValue(
        "None of these fits; keep my own answer.",
      );
    }
  });
}

test("a written answer remains available without a suitable AI model", async ({
  page,
}) => {
  const preview = await open(page, "chat-question-ten");
  await selectOption(
    page.getByLabel("Model choice example", { exact: true }),
    "zero",
  );
  await expect(preview.getByRole("dialog")).toBeVisible();
  await preview.keyboard.press("Escape");
  await input(preview).fill("Something not suggested by the assistant.");
  await input(preview).press("Enter");
  await expect(preview.locator(".chat-message.user")).toContainText(
    "Something not suggested by the assistant.",
  );
});

test("the question and input stay separate and reachable in a short window", async ({
  page,
}, info) => {
  const preview = await open(page, "chat-question-six-long");
  await preview.setViewportSize({ width: 320, height: 350 });
  await input(preview).fill("Quiet walks.");
  await input(preview).scrollIntoViewIfNeeded();
  const answer = await input(preview).boundingBox();
  await expect(input(preview)).toBeInViewport();
  expect(answer!.y + answer!.height).toBeLessThanOrEqual(350);
  await preview.screenshot({ path: info.outputPath("question-short.png") });
  await input(preview).press("Enter");
  await expect(preview.locator(".chat-message.user")).toContainText(
    "Quiet walks.",
  );
});

for (const size of [
  { width: 1040, height: 760 },
  { width: 390, height: 600 },
  { width: 320, height: 350 },
]) {
  test(`long questions leave history visible and collapse without losing the draft at ${size.width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "chat-question-prompt-long");
    await preview.setViewportSize(size);
    const prompt = preview.locator(".question-prompt");
    const history = preview.locator(".chat-scroll");
    const toggle = preview.getByRole("button", {
      name: copy.hideQuestion,
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(prompt).toHaveText(
      new RegExp("I found several different plans"),
    );
    const before = await history.boundingBox();
    expect(before!.height).toBeGreaterThan(40);
    expect(
      await preview
        .locator(".question-body")
        .evaluate((el) =>
          [el, el.querySelector(".question-prompt")!].some(
            (region) => region.scrollHeight > region.clientHeight,
          ),
        ),
    ).toBe(true);
    await input(preview).fill("Keep the weekend flexible.");
    await preview.screenshot({
      path: info.outputPath("long-question-expanded.png"),
    });
    await toggle.focus();
    await toggle.press("Enter");
    const reopen = preview.getByRole("button", {
      name: copy.showQuestion,
      exact: true,
    });
    await expect(reopen).toHaveAttribute("aria-expanded", "false");
    await expect(reopen).toBeFocused();
    await expect(prompt).toBeHidden();
    await expect(preview.locator(".chat-footer textarea")).toHaveValue(
      "Keep the weekend flexible.",
    );
    const after = await history.boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height);
    await history.focus();
    await history.press("Home");
    await preview.screenshot({
      path: info.outputPath("long-question-collapsed.png"),
    });
    await reopen.click();
    await expect(prompt).toBeVisible();
    await expect(input(preview)).toHaveValue("Keep the weekend flexible.");
    const last = preview.locator(".question-options button").last();
    await last.focus();
    await expect(last).toBeInViewport();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(
      preview.getByRole("button", { name: copy.hideQuestion, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(input(preview)).toHaveValue("");
  });
}

test("the onboarding answer draft survives app entry, resizing and a return to the guide", async ({
  page,
}, info) => {
  const preview = await open(page, "setup-conversation-support");
  await input(preview).fill("What would the optional plugin do?");
  await preview.screenshot({
    path: info.outputPath("setup-question-guided.png"),
  });
  await preview.getByRole("button", { name: setup.openApp }).click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "app",
  );
  await expect(input(preview)).toHaveValue(
    "What would the optional plugin do?",
  );
  await preview.screenshot({ path: info.outputPath("setup-question-app.png") });
  await preview
    .getByRole("button", { name: setup.guided, exact: false })
    .click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "guided",
  );
  await expect(input(preview)).toHaveValue(
    "What would the optional plugin do?",
  );
  await preview.setViewportSize({ width: 390, height: 760 });
  await expect(input(preview)).toHaveValue(
    "What would the optional plugin do?",
  );
});
