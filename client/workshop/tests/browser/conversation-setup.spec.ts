import { expect, test, type Page } from "./test";
import { selectScenario } from "./scenarios";
import copy from "../../src/localization/en.setup-conversation.json" with { type: "json" };
import finale from "../../src/localization/en.setup-finale.json" with { type: "json" };

let browserErrors: string[] = [];
test.beforeEach(({ context }) => {
  browserErrors = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => browserErrors.push(error.message)),
  );
});
test.afterEach(() => expect(browserErrors).toEqual([]));

async function open(
  page: Page,
  scenario = "setup-conversation-brief",
  reduced = true,
) {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1280, height: 900 });
  await preview.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await expect(preview.locator(".conversation-setup")).toBeVisible();
  return preview;
}
const draft = (page: Page) => page.locator(".chat-footer").getByRole("textbox");

test("starting details lead into one guided conversation and an explicit method decision", async ({
  page,
}, info) => {
  const preview = await open(page);
  await expect(
    preview.getByRole("button", { name: copy.openApp }),
  ).toBeDisabled();
  await expect(
    preview.getByText("Confirm your working method first.", { exact: false }),
  ).toHaveCount(0);
  await expect(preview.locator(".entry-note")).toHaveCount(0);
  const source = "Apple Notes and Reminders. Keep the project folders.";
  await preview.getByRole("textbox", { name: copy.sourceLabel }).fill(source);
  await preview.getByRole("radio", { name: copy.keep, exact: true }).check();
  await preview
    .getByRole("textbox", { name: copy.preferences, exact: true })
    .fill("No weekly review routine.");
  await preview.screenshot({ path: info.outputPath("setup-brief.png") });
  const bend = await preview.locator(".frame-art").elementHandle();
  await preview.getByRole("button", { name: copy.start, exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "Edit starting details", exact: true }),
  ).toHaveCount(0);
  await expect(preview.locator(".chat-message.user")).toContainText(source);
  await expect(
    preview.getByRole("button", { name: copy.confirm, exact: true }),
  ).toBeEnabled();
  await expect(
    preview.locator(".guided-conversation .chat-heading"),
  ).toHaveCount(0);
  await expect(
    preview.locator(".decision, .imported, .secondary-actions"),
  ).toHaveCount(0);
  expect(await bend!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(preview.locator(".frame-art")).toBeVisible();
  await expect(
    preview.getByRole("button", { name: copy.openApp }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: copy.controls.manual }).check();
  await preview
    .getByRole("button", { name: copy.confirm, exact: true })
    .click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-phase",
    "import",
  );
  await expect(
    preview.getByRole("button", { name: copy.openApp }),
  ).toBeEnabled();
  await expect(
    preview.locator(".setup-steps [aria-current='step']"),
  ).toContainText("Bring your content");
  await preview.screenshot({
    path: info.outputPath("setup-guided-import.png"),
  });
});

test("a written answer revises the method through the headerless chat without approving it", async ({
  page,
}, info) => {
  const preview = await open(page, "setup-conversation-proposal");
  const question = preview.locator(".chat-question").last();
  const id = await question.getAttribute("data-question-id");
  const panel = (await preview.locator(".setup-panel").boundingBox())!;
  const history = (await preview.locator(".chat-scroll").boundingBox())!;
  expect(Math.abs(history.y - panel.y)).toBeLessThan(3);
  const input = draft(preview);
  await input.fill("Keep the folders, but do not add recurring reviews.");
  await input.press("Enter");
  await expect(
    preview.getByRole("button", { name: copy.openApp }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: copy.confirm, exact: true }),
  ).toBeEnabled();
  await expect(
    preview.locator(`[data-question-id="${id}"] button`),
  ).toHaveCount(0);
  await expect(preview.locator(".chat-message.user").last()).toContainText(
    "do not add recurring reviews",
  );
  await expect(input).toHaveValue("");
  await preview.screenshot({
    path: info.outputPath("question-method-revision.png"),
  });
});

test("early app entry retains the chat and draft while import completes alongside another chat", async ({
  page,
}, info) => {
  const preview = await open(page, "setup-conversation-import");
  await draft(preview).fill("Keep this unsent setup question.");
  await preview.getByRole("button", { name: copy.openApp }).click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "app",
  );
  await expect(draft(preview)).toHaveValue("Keep this unsent setup question.");
  await expect(preview.locator(".setup-status")).toContainText(
    copy.importStatus,
  );
  await expect
    .poll(() =>
      preview.locator(".chat-scroll").evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await preview.screenshot({
    path: info.outputPath("setup-app-same-chat.png"),
  });
  await preview
    .getByRole("button", { name: `+ ${copy.newChat}`, exact: true })
    .click();
  await draft(preview).fill("Plan a reading evening.");
  await page
    .getByRole("button", { name: copy.controls.complete, exact: true })
    .click();
  await expect(preview.locator(".setup-status")).toContainText(
    copy.supportStatus,
  );
  await expect(draft(preview)).toHaveValue("Plan a reading evening.");
  await preview.screenshot({
    path: info.outputPath("setup-app-parallel-chat.png"),
  });
  await preview
    .locator(".setup-tabs")
    .getByRole("button", { name: copy.title, exact: true })
    .click();
  await expect(draft(preview)).toHaveValue("Keep this unsent setup question.");
  await expect(
    preview
      .locator(".chat-message.user")
      .filter({ hasText: "Plan a reading evening." }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: copy.guided, exact: false })
    .click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "guided",
  );
  await expect(draft(preview)).toHaveValue("Keep this unsent setup question.");
  await expect(preview.locator(".frame-art")).toBeVisible();
  await expect(
    preview.getByRole("button", { name: copy.finish, exact: true }),
  ).toBeVisible();
  await preview.getByRole("button", { name: copy.openApp }).click();
  await expect(preview.locator(".finale-announcement")).toHaveCount(0);
  await selectScenario(page, "setup-conversation-import");
  await expect(draft(preview)).toHaveValue("");
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "guided",
  );
});

test("fresh setup needs neither source access nor a compulsory plugin", async ({
  page,
}) => {
  const preview = await open(page, "setup-conversation-fresh");
  await expect(
    preview.getByRole("textbox", { name: copy.sourceLabel }),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: copy.start, exact: true }).click();
  await preview
    .getByRole("button", { name: copy.confirm, exact: true })
    .click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-phase",
    "support",
  );
  await expect(preview.getByRole("checkbox", { name: copy.build })).toHaveCount(
    0,
  );
  await expect(
    preview
      .locator(".chat-message.assistant")
      .filter({ hasText: copy.emptyReady }),
  ).toHaveCount(1);
  await preview.getByRole("button", { name: copy.finish, exact: true }).click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "app",
  );
  await expect(preview.locator(".setup-status")).toContainText(copy.doneStatus);
});

test("early entry and full guided completion use the existing celebration", async ({
  page,
}, info) => {
  const preview = await open(page, "setup-conversation-import", false);
  for (const [scenario, action] of [
    ["setup-conversation-import", copy.openApp],
    ["setup-conversation-support", copy.finish],
  ]) {
    await selectScenario(page, scenario!);
    await preview.getByRole("button", { name: action!, exact: false }).click();
    await page
      .getByRole("button", { name: finale.controls.celebrate, exact: true })
      .click();
    await expect(
      preview.getByRole("heading", { name: finale.heading, exact: true }),
    ).toBeVisible();
    await expect(preview.locator(".finale-frame")).toBeVisible();
    await preview.screenshot({
      path: info.outputPath(`${scenario}-same-finale.png`),
    });
    await preview
      .getByRole("button", { name: finale.skip, exact: false })
      .click();
    await expect(preview.locator(".conversation-setup")).toHaveAttribute(
      "data-view",
      "app",
    );
  }
});

test("blocked access retains the setup conversation and does not force import completion before entry", async ({
  page,
}) => {
  const preview = await open(page, "setup-conversation-blocked");
  await expect(
    preview
      .locator(".chat-message.assistant")
      .filter({ hasText: copy.sourceBlocked }),
  ).toHaveCount(1);
  await expect(
    preview.getByRole("button", { name: copy.retryImport, exact: true }),
  ).toBeVisible();
  const link = preview.getByRole("button", {
    name: "Garden/Planning.md",
    exact: false,
  });
  await link.click();
  await expect(preview.getByRole("dialog")).toBeVisible();
  await expect(preview.getByRole("dialog")).toContainText(
    "Bring a printed garden map.",
  );
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("dialog")).not.toBeVisible();
  await expect(link).toBeFocused();
  await preview.getByRole("button", { name: copy.openApp }).click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "app",
  );
  await expect(
    preview.getByRole("button", { name: copy.retryImport, exact: true }),
  ).toBeVisible();
});

test("selected development appears in its own ordinary conversation after setup", async ({
  page,
}) => {
  const preview = await open(page, "setup-conversation-support");
  await preview.getByRole("button", { name: copy.build, exact: true }).click();
  await preview.getByRole("button", { name: copy.finish, exact: true }).click();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "app",
  );
  await preview
    .locator(".desktop-sidebar")
    .getByRole("button", { name: copy.developmentTitle, exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: copy.developmentTitle, exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".chat-message.assistant")).toContainText(
    copy.developmentMessage,
  );
  await draft(preview).fill("Keep this development draft.");
  await preview
    .locator(".setup-tabs")
    .getByRole("button", { name: copy.title, exact: true })
    .click();
  await expect(draft(preview)).toHaveValue("");
  await preview
    .locator(".desktop-sidebar")
    .getByRole("button", { name: copy.developmentTitle, exact: true })
    .click();
  await expect(draft(preview)).toHaveValue("Keep this development draft.");
});

test("the existing finale plays through naturally on early app entry", async ({
  page,
}) => {
  const preview = await open(page, "setup-conversation-import", false);
  await preview.getByRole("button", { name: copy.openApp }).click();
  await expect(preview.locator(".finale-frame")).toBeVisible();
  await expect(preview.locator(".conversation-setup")).toHaveAttribute(
    "data-view",
    "app",
    { timeout: 10000 },
  );
  await expect(preview.locator(".setup-status")).toContainText(
    copy.importStatus,
  );
});

for (const width of [1040, 800]) {
  test(`guided conversation keeps its composer and app action reachable at ${width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "setup-conversation-partial");
    await preview.setViewportSize({ width, height: 600 });
    await expect(preview.locator(".frame-art")).toBeVisible();
    await expect(draft(preview)).toBeInViewport();
    await expect(
      preview.getByRole("button", { name: copy.openApp }),
    ).toBeInViewport();
    await draft(preview).fill("Keep this draft through resizing.");
    await preview.setViewportSize({ width, height: 720 });
    await expect(draft(preview)).toHaveValue(
      "Keep this draft through resizing.",
    );
    await preview.screenshot({
      path: info.outputPath(`setup-partial-${width}.png`),
    });
    await preview
      .getByRole("button", { name: copy.withoutRest, exact: true })
      .click();
    await expect(preview.locator(".conversation-setup")).toHaveAttribute(
      "data-phase",
      "support",
    );
    await expect(preview.locator(".message-file")).toHaveCount(1);
  });
}
