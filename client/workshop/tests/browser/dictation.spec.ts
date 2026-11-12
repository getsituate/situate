import { test, expect, type Page } from "./test";
import { selectScenario } from "./scenarios";
import { selectOption } from "./select";
import { chatPresets, downloadPresets } from "../../src/dictation/model";

async function open(page: Page, scenario = "dictation-ready", mobile = false) {
  await page.goto(
    `/?workshop=controls&scenario=${scenario}${mobile ? "&profile=ios&keyboard=open" : ""}`,
  );
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  return preview;
}
const field = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });
async function selectText(page: Page, start: number, end: number) {
  await field(page).evaluate(
    (input: HTMLTextAreaElement, range) => {
      input.focus();
      input.setSelectionRange(range.start, range.end);
      input.dispatchEvent(new Event("select", { bubbles: true }));
    },
    { start, end },
  );
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const mobile of [false, true]) {
  test(`recording feedback stays compact and interruptible on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, info) => {
    const preview = await open(page, "dictation-recording", mobile);
    const errors: string[] = [];
    preview.on("pageerror", (error) => errors.push(error.message));
    const activity = preview.locator(".dictation-activity");
    const animationCount = () =>
      activity.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      );
    await preview.bringToFront();
    await expect.poll(animationCount).toBe(7);
    const firstMark = activity.locator(".wave-bar").first();
    const before = await firstMark.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await expect
      .poll(() =>
        firstMark.evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe(before);
    await expect(field(preview)).toBeEditable();
    await field(preview).fill("Keep this draft.");
    await activity.evaluate((element) =>
      element.getAnimations({ subtree: true }).forEach((animation) => {
        animation.pause();
        animation.currentTime = 600;
      }),
    );
    await preview.screenshot({
      path: info.outputPath("dictation-recording.png"),
    });
    await activity.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .forEach((animation) => animation.play()),
    );
    for (const speech of ["silence", "quiet", "speaking"]) {
      await selectOption(
        page.getByRole("combobox", { name: "Simulated speech", exact: true }),
        speech,
      );
      await preview.bringToFront();
      await expect(activity).toHaveAttribute("data-speech", speech);
      await expect.poll(animationCount).toBe(speech === "silence" ? 0 : 7);
    }
    const motion = page.getByRole("switch", {
      name: "Animate feedback",
      exact: true,
    });
    await motion.uncheck();
    await expect.poll(animationCount).toBe(0);
    await expect(
      preview.getByRole("button", { name: "Stop recording and transcribe" }),
    ).toBeEnabled();
    await preview.emulateMedia({ reducedMotion: "reduce" });
    await motion.check();
    await expect.poll(animationCount).toBe(0);
    await preview.emulateMedia({ reducedMotion: "no-preference" });
    await preview.bringToFront();
    await expect.poll(animationCount).toBe(7);
    for (const width of mobile ? [320, 390] : [768, 1440]) {
      await preview.setViewportSize({ width, height: mobile ? 844 : 900 });
      await expect(activity).toBeInViewport();
      await noOverflow(preview);
    }
    await preview
      .getByRole("button", { name: "Stop recording and transcribe" })
      .click();
    await expect(activity.locator(".wave-bar")).toHaveCount(0);
    await expect(activity.locator(".processing-dot")).toHaveCount(3);
    await expect.poll(animationCount).toBe(3);
    await motion.uncheck();
    await expect.poll(animationCount).toBe(0);
    await page
      .getByRole("button", { name: "Complete transcription", exact: true })
      .click();
    await expect(activity).toHaveCount(0);
    await expect(field(preview)).toHaveValue(/Keep this draft\./);
    await expect(
      preview.getByText("Message sent.", { exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("inline speech activity becomes processing feedback without moving or blocking the draft", async ({
  page,
}, info) => {
  const preview = await open(page);
  const before = await field(preview).boundingBox();
  const box = preview.locator(".input-line");
  const boxBefore = await box.boundingBox();
  const micBefore = await preview
    .getByRole("button", { name: "Dictate text", exact: true })
    .boundingBox();
  const sendBefore = await preview
    .getByRole("button", { name: "Send message", exact: true })
    .boundingBox();
  await preview
    .getByRole("button", { name: "Dictate text", exact: true })
    .click();
  const activity = preview.locator(".input-actions .dictation-activity");
  expect(await box.boundingBox()).toEqual(boxBefore);
  expect(await field(preview).boundingBox()).toEqual(before);
  expect(await activity.boundingBox()).toEqual(micBefore);
  expect(
    await preview
      .getByRole("button", { name: "Stop recording and transcribe" })
      .boundingBox(),
  ).toEqual(sendBefore);
  const bars = activity.locator(".wave-bar");
  const animations = () =>
    activity.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    );
  await expect(bars).toHaveCount(7);
  await expect.poll(animations).toBe(7);
  const first = await bars
    .first()
    .evaluate((bar) => getComputedStyle(bar).transform);
  await expect
    .poll(() => bars.first().evaluate((bar) => getComputedStyle(bar).transform))
    .not.toBe(first);
  await expect(field(preview)).toHaveAccessibleDescription("Recording");
  await expect(
    preview.locator(".dictation-composer > [role=status]"),
  ).toHaveClass(/sr-only/);
  await expect(
    preview.getByText(/Press the microphone again|You can keep editing/),
  ).toHaveCount(0);
  await expect(
    preview.locator(".dictation-composer > :not(.chat-composer):not(.sr-only)"),
  ).toHaveCount(0);
  await expect(field(preview)).toBeEditable();
  for (const speech of ["silence", "quiet", "speaking"]) {
    await selectOption(
      page.getByRole("combobox", { name: "Simulated speech", exact: true }),
      speech,
    );
    await preview.bringToFront();
    await expect(activity).toHaveAttribute("data-speech", speech);
    await expect.poll(animations).toBe(speech === "silence" ? 0 : 7);
  }
  await preview
    .getByRole("button", { name: "Reading list", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toBeVisible();
  await expect.poll(animations).toBe(0);
  await preview.keyboard.press("Escape");
  await expect.poll(animations).toBe(7);
  await preview
    .getByRole("button", { name: "Stop recording and transcribe" })
    .click();
  await expect(bars).toHaveCount(0);
  await expect(activity.locator(".processing-dot")).toHaveCount(3);
  await expect.poll(animations).toBe(3);
  await expect(field(preview)).toHaveAccessibleDescription(
    "Transcribing on this device…",
  );
  expect(await field(preview).boundingBox()).toEqual(before);
  await preview.screenshot({
    path: info.outputPath("dictation-processing-inline.png"),
  });
  await preview.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(animations).toBe(0);
  await expect(activity).toBeVisible();
  await expect(field(preview)).toBeEditable();
  await page
    .getByRole("button", { name: "Complete transcription", exact: true })
    .click();
  await expect(activity).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Dictate text", exact: true })
    .click();
  await expect(bars).toHaveCount(7);
  await expect.poll(animations).toBe(0);
  await preview.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(animations).toBe(7);
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(activity).toHaveCount(0);
  await expect(field(preview)).toHaveValue(
    "For Thursday: bring something to read.",
  );
});

test("dictation inserts into the current selection and never sends automatically", async ({
  page,
}, info) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  await field(preview).fill("Before OLD after");
  await selectText(preview, 7, 10);
  await preview
    .getByRole("button", { name: "Dictate text", exact: true })
    .click();
  await expect(preview.locator(".dictation-activity.recording")).toBeVisible();
  await expect(field(preview)).toBeEditable();
  await field(preview).press("Enter");
  await field(preview).press("Alt+Enter");
  await expect(field(preview)).toHaveValue("Before OLD after");
  const send = preview.getByRole("button", {
    name: "Send message",
    exact: true,
  });
  await expect(send).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Stop recording and transcribe" }),
  ).toBeEnabled();
  await preview.screenshot({
    path: info.outputPath("dictation-recording.png"),
  });
  await preview
    .getByRole("button", { name: "Stop recording and transcribe" })
    .click();
  await page
    .getByRole("textbox", { name: "Recognized text", exact: true })
    .fill("new words");
  await selectText(preview, 7, 10);
  await page
    .getByRole("button", { name: "Complete transcription", exact: true })
    .click();
  await expect(field(preview)).toHaveValue("Before new words after");
  await expect(
    preview.getByText("Text added to your draft. Review it before sending."),
  ).toBeVisible();
  await expect(preview.getByText("Message sent.", { exact: true })).toHaveCount(
    0,
  );
  await preview
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await expect(field(preview)).toHaveValue("");
  await expect(
    preview.getByText("Before new words after", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("recording navigation has stay and discard branches with keyboard focus", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-recording");
  await preview
    .getByRole("button", { name: "Reading list", exact: true })
    .click();
  const dialog = preview.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Discard this dictation?" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep recording" }),
  ).toBeFocused();
  await preview.screenshot({ path: info.outputPath("dictation-discard.png") });
  await preview.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Reading list", exact: true }),
  ).toBeFocused();
  await expect(preview.locator(".dictation-activity.recording")).toBeVisible();
  await preview
    .getByRole("button", { name: "Reading list", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Discard and continue" }).click();
  await expect(
    preview.getByRole("heading", { name: "Reading list", exact: true }),
  ).toBeVisible();
  await expect(preview.locator(".dictation-activity.recording")).toHaveCount(0);
});

test("transcription follows its draft across chats and split panes", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-transcribing");
  await preview
    .getByRole("button", { name: "Reading list", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Dictate text", exact: true }),
  ).toBeDisabled();
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await expect(preview.locator(".dictation-feedback")).toHaveCount(0);
  const microphone = preview.getByRole("button", {
    name: "Dictate text",
    exact: true,
  });
  await expect(microphone).toHaveAttribute(
    "aria-description",
    "Dictation already in progress",
  );
  await microphone.hover();
  await expect(preview.getByRole("tooltip")).toHaveText(
    "Dictation already in progress",
  );
  await preview.keyboard.press("Escape");
  await field(preview).fill("Keep B intact");
  await preview
    .getByRole("button", { name: "A plan for Thursday", exact: true })
    .click();
  await field(preview).fill("A[]Z");
  await selectText(preview, 1, 3);
  await preview
    .getByRole("button", { name: "Show chats side by side" })
    .click();
  await expect(
    preview.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveCount(2);
  await expect(
    preview.locator(".dictation-composer").nth(1).locator(".input-feedback"),
  ).toHaveCount(0);
  await preview.screenshot({ path: info.outputPath("dictation-split.png") });
  await page
    .getByRole("textbox", { name: "Recognized text", exact: true })
    .fill(" text ");
  await page
    .getByRole("button", { name: "Complete transcription", exact: true })
    .click();
  await expect(field(preview).nth(0)).toHaveValue("A text Z");
  await expect(field(preview).nth(1)).toHaveValue("Keep B intact");
  await expect(
    preview
      .locator(".dictation-composer")
      .nth(1)
      .getByRole("button", { name: "Dictate text", exact: true }),
  ).toBeEnabled();
  await noOverflow(preview);
});

test("another chat has only a disabled microphone and localized tooltip during recording", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-recording");
  await preview
    .getByRole("button", { name: "Show chats side by side" })
    .click();
  const other = preview.locator(".dictation-composer").nth(1);
  await expect(other.locator(".input-feedback")).toHaveCount(0);
  await expect(other.getByRole("textbox")).toHaveAccessibleDescription("");
  await expect(other.getByRole("textbox")).toBeEditable();
  const microphone = other.getByRole("button", {
    name: "Dictate text",
    exact: true,
  });
  await expect(microphone).toBeDisabled();
  await expect(microphone).toHaveCSS("opacity", "0.45");
  await microphone.hover();
  await expect(preview.getByRole("tooltip")).toHaveText(
    "Dictation already in progress",
  );
  await preview.screenshot({
    path: info.outputPath("dictation-other-chat-tooltip.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("tooltip")).toHaveCount(0);
  await expect(preview.locator(".dictation-activity.recording")).toBeVisible();
  await selectOption(
    page.getByRole("combobox", {
      name: "Dictation interface language",
      exact: true,
    }),
    "de",
  );
  await preview.mouse.move(0, 0);
  const germanMicrophone = other.getByRole("button", {
    name: "Text diktieren",
    exact: true,
  });
  await expect(germanMicrophone).toHaveAttribute(
    "aria-description",
    "Diktieren läuft bereits",
  );
  await germanMicrophone.hover();
  await expect(preview.getByRole("tooltip")).toHaveText(
    "Diktieren läuft bereits",
  );
  await expect(other.locator(".input-feedback")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Background or lock", exact: true })
    .click();
  await expect(germanMicrophone).toBeEnabled();
  await expect(preview.getByRole("tooltip")).toHaveCount(0);
  await expect(other.locator(".input-feedback")).toHaveCount(0);
});

test("download status keeps local processing secondary across languages and widths", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-download-active", true);
  const settings = preview.locator(".dictation-settings");
  for (const language of ["en", "de"]) {
    await selectOption(
      page.getByRole("combobox", {
        name: /Dictation interface language|Sprache der Diktieroberfläche/,
      }),
      language,
    );
    await expect(settings.locator(".privacy")).toHaveText(
      language === "en"
        ? "Speech is processed only on this device."
        : "Sprache wird nur auf diesem Gerät verarbeitet.",
    );
    await expect(settings.locator("p")).toHaveCount(3);
    await expect(settings.getByRole("status")).toContainText(
      language === "en"
        ? "Downloading speech recognition"
        : "Spracherkennung wird heruntergeladen",
    );
    await expect(settings.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    for (const width of [320, 768, 1440]) {
      await preview.setViewportSize({ width, height: 900 });
      await noOverflow(preview);
      await expect(settings.locator(".privacy")).toBeVisible();
      await preview.screenshot({
        path: info.outputPath(`dictation-download-${language}-${width}.png`),
      });
    }
  }
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(settings.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
});

test("download pauses on mobile data, resumes on metered Wi-Fi and becomes ready without a reload", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-download-active");
  await expect(preview.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  await selectOption(
    page.getByRole("combobox", { name: "Connection", exact: true }),
    "cellular",
  );
  await expect(
    preview.getByText("Waiting for a connection", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  await preview.screenshot({
    path: info.outputPath("dictation-download-paused.png"),
  });
  await selectOption(
    page.getByRole("combobox", { name: "Connection", exact: true }),
    "metered",
  );
  await page
    .getByRole("button", { name: "Finish download", exact: true })
    .click();
  await expect(
    preview.getByText("Preparing speech recognition", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish preparation", exact: true })
    .click();
  await expect(
    preview.getByText("Ready for offline dictation", { exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "A plan for Thursday", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Dictate text", exact: true })
    .click();
  await expect(preview.locator(".dictation-activity.recording")).toBeVisible();
});

test("download failure and storage recovery keep typed chat available", async ({
  page,
}) => {
  const preview = await open(page, "dictation-download-active");
  for (const failure of ["Fail download", "Insufficient storage"]) {
    await page.getByRole("button", { name: failure, exact: true }).click();
    await expect(
      preview.getByRole("button", { name: "Retry download", exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "A plan for Thursday", exact: true })
      .click();
    await expect(
      preview.getByRole("button", { name: "Dictate text", exact: true }),
    ).toHaveCount(0);
    await expect(preview.locator(".input-feedback")).toHaveCount(0);
    await field(preview).fill("Keep using typed chat");
    await preview
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(field(preview)).toHaveValue("");
    await preview
      .getByRole("button", { name: "Dictation settings", exact: true })
      .click();
    const notice = preview.getByRole("dialog");
    await expect(notice).toBeVisible();
    await notice
      .getByRole("button", { name: "Dictation settings", exact: true })
      .click();
    await preview
      .getByRole("button", { name: "Retry download", exact: true })
      .click();
    await expect(
      preview.getByText("Downloading speech recognition", { exact: true }),
    ).toBeVisible();
  }
});

test("permission, no-speech, failure and return from interruption have distinct recovery", async ({
  page,
}) => {
  const preview = await open(page, "dictation-permission");
  await page
    .getByRole("button", { name: "Deny microphone access", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog").getByText("Microphone access is off."),
  ).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(field(preview)).toBeFocused();
  await expect(field(preview)).toBeEditable();
  await selectOption(
    page.getByRole("combobox", { name: "Microphone access", exact: true }),
    "allowed",
  );
  await preview
    .getByRole("button", { name: "Dictate text", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Background or lock", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog").getByText(/Dictation was interrupted/),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Dismiss notice", exact: true })
    .click();
  await expect(field(preview)).toBeFocused();
  for (const outcome of ["No speech", "Fail transcription"]) {
    await preview
      .getByRole("button", { name: "Dictate text", exact: true })
      .click();
    await preview
      .getByRole("button", { name: "Stop recording and transcribe" })
      .click();
    await field(preview).fill("Preserve these words");
    await selectText(preview, 0, 8);
    await page.getByRole("button", { name: outcome, exact: true }).click();
    await expect(field(preview)).toHaveValue("Preserve these words");
    expect(
      await field(preview).evaluate((input: HTMLTextAreaElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    ).toEqual([0, 8]);
    await expect(
      preview.getByText(
        outcome === "No speech"
          ? /No speech was recognized/
          : /couldn’t be transcribed/,
      ),
    ).toBeVisible();
    await preview.keyboard.press("Escape");
    await expect(field(preview)).toBeFocused();
  }
});

test("permission guidance closes without cancelling and preserves the compact composer", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-permission");
  const dialog = preview.getByRole("dialog");
  await expect(
    dialog.getByText("Waiting for microphone access…"),
  ).toBeVisible();
  const dismiss = dialog.getByRole("button", {
    name: "Dismiss notice",
    exact: true,
  });
  await expect(dismiss).toBeFocused();
  await preview.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await preview.keyboard.press("Tab");
  await expect(dismiss).toBeFocused();
  await preview.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(field(preview)).toBeFocused();
  await field(preview).fill("Keep my draft");
  const box = await preview.locator(".input-line").boundingBox();
  await field(preview).press("Enter");
  await expect(field(preview)).toHaveValue("Keep my draft");
  await page
    .getByRole("button", { name: "Grant microphone access", exact: true })
    .click();
  await expect(preview.locator(".dictation-activity.recording")).toBeVisible();
  expect(await preview.locator(".input-line").boundingBox()).toEqual(box);
  await preview
    .getByRole("button", { name: "Stop recording and transcribe" })
    .click();
  await page
    .getByRole("button", { name: "Fail transcription", exact: true })
    .click();
  await expect(dialog.getByText(/couldn’t be transcribed/)).toBeVisible();
  await preview.screenshot({
    path: info.outputPath("dictation-failure-dialog.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(field(preview)).toBeFocused();
  expect(await preview.locator(".input-line").boundingBox()).toEqual(box);
  await expect(field(preview)).toHaveValue("Keep my draft");
});

test("German recovery dialogs fit above the mobile keyboard and reset removes them", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-denied", true);
  await selectOption(
    page.getByRole("combobox", {
      name: "Dictation interface language",
      exact: true,
    }),
    "de",
  );
  const dialog = preview.getByRole("dialog");
  await expect(
    dialog.getByText("Der Mikrofonzugriff ist ausgeschaltet."),
  ).toBeVisible();
  for (const width of [390, 320]) {
    await preview.setViewportSize({ width, height: 844 });
    await expect(
      dialog.getByRole("button", { name: "Hinweis schließen", exact: true }),
    ).toBeInViewport();
    await expect
      .poll(async () => {
        const popup = await dialog.boundingBox();
        const chat = await preview.locator(".chat-screen").boundingBox();
        return popup!.y + popup!.height <= chat!.y + chat!.height;
      })
      .toBe(true);
    await noOverflow(preview);
    await preview.screenshot({
      path: info.outputPath(`dictation-mobile-notice-${width}.png`),
    });
  }
  await dialog
    .getByRole("button", { name: "Dialog schließen", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    preview.getByRole("textbox", { name: "Nachricht", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Text diktieren", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await selectScenario(page, "dictation-ready");
  await expect(dialog).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Dictate text", exact: true }),
  ).toBeEnabled();
});

test("recording stop stays separate from stopping an agent response", async ({
  page,
}) => {
  const preview = await open(page, "dictation-agent");
  await expect(
    preview.getByRole("button", { name: "Queue message", exact: true }),
  ).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Stop response", exact: true })
    .click();
  await expect(preview.locator(".dictation-activity.recording")).toBeVisible();
  await preview
    .getByRole("button", { name: "Stop recording and transcribe" })
    .click();
  await expect(
    preview.locator(".dictation-activity.transcribing"),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Complete transcription", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
});

test("a failed transcription waits for its own chat before showing a dialog", async ({
  page,
}) => {
  const preview = await open(page, "dictation-transcribing");
  await field(preview).fill("Origin[]");
  await selectText(preview, 6, 8);
  await preview
    .getByRole("button", { name: "Reading list", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fail transcription", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await field(preview).fill("Keep this chat separate");
  await preview
    .getByRole("button", { name: "A plan for Thursday", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog").getByText(/couldn’t be transcribed/),
  ).toBeVisible();
  await preview.keyboard.press("Escape");
  await expect(field(preview)).toHaveValue("Origin[]");
  await expect(field(preview)).toBeFocused();
  expect(
    await field(preview).evaluate((input: HTMLTextAreaElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([6, 8]);
});

test("quit waits or discards, including completion while the warning is open", async ({
  page,
}) => {
  const preview = await open(page, "dictation-transcribing");
  await page
    .getByRole("button", { name: "Request application quit", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "Stay and wait", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Stay and wait", exact: true })
    .click();
  await expect(
    preview.locator(".dictation-activity.transcribing"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request application quit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete transcription", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Dictation has finished" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Stay here", exact: true }).click();
  await expect(
    preview.getByText("Text added to your draft. Review it before sending."),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Dictate text", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Request application quit", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(preview.locator(".dictation-activity.recording")).toHaveCount(0);
});

test("German dictation fits the iOS keyboard profile and reset cancels work", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-offline", true);
  await selectOption(
    page.getByRole("combobox", {
      name: "Dictation interface language",
      exact: true,
    }),
    "de",
  );
  await expect(
    preview.getByText(/Diktieren funktioniert offline/),
  ).toBeVisible();
  const input = preview.getByRole("textbox", {
    name: "Nachricht",
    exact: true,
  });
  await input.fill("Mein Entwurf bleibt erhalten.");
  await preview
    .getByRole("button", { name: "Text diktieren", exact: true })
    .click();
  await expect(input).toBeEditable();
  const stop = preview.getByRole("button", {
    name: "Aufnahme beenden und transkribieren",
  });
  await expect(stop).toBeInViewport();
  await noOverflow(preview);
  await preview.screenshot({
    path: info.outputPath("dictation-ios-german-recording.png"),
  });
  await stop.click();
  await preview.setViewportSize({ width: 320, height: 760 });
  await expect(input).toHaveValue("Mein Entwurf bleibt erhalten.");
  await noOverflow(preview);
  await expect(preview.locator(".input-line .processing-dot")).toHaveCount(3);
  await expect(input).toBeInViewport();
  await preview.screenshot({
    path: info.outputPath("dictation-ios-processing.png"),
  });
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete transcription", exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Dictate text", exact: true }),
  ).toBeEnabled();
  await selectScenario(page, "dictation-download-storage");
  await expect(
    preview.getByRole("button", { name: "Retry download", exact: true }),
  ).toBeInViewport();
  await preview.screenshot({
    path: info.outputPath("dictation-ios-storage.png"),
  });
});

test("workspace changes preserve the originating draft and closure can be cancelled", async ({
  page,
}) => {
  const preview = await open(page, "dictation-transcribing");
  await field(preview).fill("Origin[]");
  await selectText(preview, 6, 8);
  await preview
    .getByRole("button", { name: "Workspace menu", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: /^Reading room/ }).click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(field(preview)).not.toHaveValue("Origin[]");
  await expect(
    preview.getByRole("button", { name: "Dictate text", exact: true }),
  ).toBeDisabled();
  await expect(preview.locator(".dictation-feedback")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Workspace menu", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: /^Field notes/ }).click();
  await expect(field(preview)).toHaveValue("Origin[]");
  await preview
    .getByRole("button", { name: "Workspace menu", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: /Close/ }).click();
  await expect(
    preview.getByRole("button", { name: "Stay and wait" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Stay and wait" }).click();
  await page
    .getByRole("textbox", { name: "Recognized text", exact: true })
    .fill(" stays");
  await page
    .getByRole("button", { name: "Complete transcription", exact: true })
    .click();
  await expect(field(preview)).toHaveValue("Origin stays");
});

test("close review preserves unsaved files and distinguishes an active response", async ({
  page,
}, info) => {
  const preview = await open(page, "dictation-close-files");
  await expect(
    preview.getByRole("heading", { name: "A file still needs saving" }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Discard and continue" }),
  ).toHaveCount(0);
  await preview.screenshot({
    path: info.outputPath("dictation-close-files.png"),
  });
  await preview
    .getByRole("button", { name: "Review file", exact: true })
    .click();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(
    preview.getByText("Couldn’t save. Changes are kept here.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete transcription", exact: true }),
  ).toBeVisible();
  await selectScenario(page, "dictation-close-agent");
  await expect(
    preview.getByText(/Any response still running will stop too/),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Stay and wait" }).click();
  await expect(
    preview.getByText("Checking the reading list…", { exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Stop response", exact: true })
    .click();
  await expect(
    preview.locator(".dictation-activity.transcribing"),
  ).toBeVisible();
});

test("all starting states render without console errors and expose only current controls", async ({
  page,
}, info) => {
  const preview = await open(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  for (const [id] of [...chatPresets, ...downloadPresets]) {
    await selectScenario(page, id);
    await expect(
      preview.locator(".dictation-composer, .dictation-settings").first(),
    ).toBeVisible();
    await noOverflow(preview);
    if (id.startsWith("dictation-download-")) {
      await expect(
        page.getByRole("textbox", { name: "Recognized text", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("combobox", { name: "Connection", exact: true }),
      ).toBeVisible();
    }
    await preview.screenshot({ path: info.outputPath(`${id}.png`) });
  }
  expect(errors).toEqual([]);
});
