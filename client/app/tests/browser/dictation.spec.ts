import { expect, test, type Page } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test.use({ localizationMode: "real" });
async function complete(page: Page, text?: string, notice?: string) {
  await page.evaluate(
    ({ text, notice }) =>
      Reflect.get(window, "__dictationTest").complete(text, notice),
    { text, notice },
  );
}
async function select(page: Page, start: number, end = start) {
  await page.getByRole("textbox", { name: "Message", exact: true }).evaluate(
    (field: HTMLTextAreaElement, [start, end]) => {
      field.focus();
      field.setSelectionRange(start, end);
      field.dispatchEvent(new Event("select", { bubbles: true }));
    },
    [start, end],
  );
}

test(
  "dictation keeps the composer compact and inserts into the latest editable selection without sending",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await workspaceFixture(page, shellState, {
      dictationModel: "ready",
      aiConnection: {
        provider: "custom",
        endpoint: "http://localhost:8888/v1",
      },
      aiModel: "test-model",
    });
    await page.goto("/");
    const field = page.getByRole("textbox", { name: "Message", exact: true });
    await field.fill("Bring something tomorrow.");
    await select(page, 6, 15);
    const height = (await page.locator(".input-line").boundingBox())!.height;
    await page
      .getByRole("button", { name: "Dictate text", exact: true })
      .click();
    const stop = page.getByRole("button", {
      name: "Stop recording and transcribe",
    });
    await expect(stop).toBeEnabled();
    await expect(field).toBeEditable();
    expect((await page.locator(".input-line").boundingBox())!.height).toBe(
      height,
    );
    await expect(
      page.locator(".dictation-activity.recording .wave-bar"),
    ).toHaveCount(7);
    await visual.capture("dictation.chat.recording");
    await stop.click();
    await expect(
      page.locator(".dictation-activity.transcribing"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await field.fill("Bring a book tomorrow.");
    await select(page, 6, 12);
    await field.press("Enter");
    await field.press("Alt+Enter");
    await expect(field).toHaveValue("Bring a book tomorrow.");
    await visual.capture("dictation.chat.transcribing");
    await complete(page, "a notebook");
    await expect(field).toHaveValue("Bring a notebook tomorrow.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await visual.capture("dictation.chat.inserted");
    expect(
      await page.evaluate(() =>
        (Reflect.get(window, "__ipcCalls") as { command: string }[]).filter(
          (c) => c.command === "ai_begin",
        ),
      ),
    ).toHaveLength(0);
  },
);

test("recording bars react to microphone levels without moving the composer and stop behind a dialog", async ({
  page,
}, info) => {
  await workspaceFixture(page, shellState, { dictationModel: "ready" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const microphone = page.getByRole("button", {
    name: "Dictate text",
    exact: true,
  });
  const field = page.getByRole("textbox", { name: "Message", exact: true });
  const inputBounds = await field.boundingBox();
  const microphoneBounds = await microphone.boundingBox();
  await microphone.click();
  const activity = page.locator(".dictation-activity.recording");
  const bars = activity.locator(".wave-bar");
  const peak = () =>
    bars.evaluateAll((elements) =>
      Math.max(
        ...elements.map((element) =>
          Number((element as HTMLElement).style.transform.slice(7, -1)),
        ),
      ),
    );
  await expect(bars).toHaveCount(7);
  expect(await activity.boundingBox()).toEqual(microphoneBounds);
  expect(await field.boundingBox()).toEqual(inputBounds);
  await expect.poll(peak).toBe(0.125);
  await page.evaluate(() => Reflect.get(window, "__dictationTest").level(0.9));
  await expect.poll(peak).toBeGreaterThan(0.7);
  const shape = await bars.first().getAttribute("style");
  await expect.poll(() => bars.first().getAttribute("style")).not.toBe(shape);
  await page.screenshot({
    path: info.outputPath("dictation-recording-bars.png"),
  });
  await page.evaluate(() => Reflect.get(window, "__dictationTest").level(0.12));
  await expect.poll(peak).toBeLessThan(0.3);
  await expect.poll(peak).toBeGreaterThan(0.125);
  await page.evaluate(() => Reflect.get(window, "__dictationTest").level(0.9));
  await expect.poll(peak).toBeGreaterThan(0.7);
  await page.locator(".conversations .section-heading button").click();
  await expect(
    page.getByRole("dialog", { name: "Discard this dictation?" }),
  ).toBeVisible();
  await expect.poll(peak).toBe(0.125);
  await page
    .getByRole("button", { name: "Keep recording", exact: true })
    .click();
  await expect.poll(peak).toBeGreaterThan(0.7);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(peak).toBe(0.125);
  await expect(field).toBeEditable();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(peak).toBeGreaterThan(0.7);
  await page.evaluate(() => Reflect.get(window, "__dictationTest").level(0));
  await expect.poll(peak).toBe(0.125);
  const still = await bars.first().getAttribute("style");
  await page.waitForTimeout(250);
  await expect(bars.first()).toHaveAttribute("style", still!);
  await page
    .getByRole("button", { name: "Stop recording and transcribe" })
    .click();
  await expect(page.locator(".dictation-activity.recording")).toHaveCount(0);
  await expect(page.locator(".dictation-activity.transcribing")).toBeVisible();
});

test("recording navigation offers stay or discard before changing tabs", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, { dictationModel: "ready" });
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Message", exact: true });
  await field.fill("Keep this draft");
  await page.getByRole("button", { name: "Dictate text", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording and transcribe" }),
  ).toBeVisible();
  await page.locator(".conversations .section-heading button").click();
  await expect(
    page.getByRole("dialog", { name: "Discard this dictation?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep recording", exact: true })
    .click();
  await expect(field).toHaveValue("Keep this draft");
  await expect(
    page.getByRole("button", { name: "Stop recording and transcribe" }),
  ).toBeVisible();
  await page.locator(".conversations .section-heading button").click();
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(field).toHaveValue("");
  await expect(page.locator(".conversation-destination")).toHaveCount(1);
});

test("hidden transcription returns to its own draft and defers recovery notices", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, { dictationModel: "ready" });
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Message", exact: true });
  await field.fill("First draft");
  await page.getByRole("button", { name: "Dictate text", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop recording and transcribe" })
    .click();
  await page.locator(".conversations .section-heading button").click();
  await field.fill("Second draft");
  await expect(
    page.getByRole("button", { name: "Dictate text", exact: true }),
  ).toBeDisabled();
  await complete(page, undefined, "noSpeech");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(field).toHaveValue("Second draft");
  await page.locator(".conversation-destination").first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "No speech was recognized",
  );
  await page.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("First draft");
});

for (const notice of ["failed", "interrupted"] as const) {
  test(`offline dictation preserves edits after ${notice}`, async ({
    page,
  }) => {
    await workspaceFixture(page, shellState, { dictationModel: "ready" });
    await page.goto("/");
    const field = page.getByRole("textbox", { name: "Message", exact: true });
    await field.fill("Keep my words");
    await page
      .getByRole("button", { name: "Dictate text", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Stop recording and transcribe" }),
    ).toBeVisible();
    if (notice === "failed")
      await page
        .getByRole("button", { name: "Stop recording and transcribe" })
        .click();
    await field.fill("Keep my edited words");
    await select(page, 5, 7);
    await complete(page, undefined, notice);
    await expect(page.getByRole("dialog")).toContainText("dictate again");
    await page.getByRole("button", { name: "Dismiss notice" }).click();
    await expect(field).toHaveValue("Keep my edited words");
    expect(
      await field.evaluate((f: HTMLTextAreaElement) => [
        f.selectionStart,
        f.selectionEnd,
      ]),
    ).toEqual([5, 7]);
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
  });
}

test(
  "model provisioning is device-local and retry keeps waiting for an eligible connection",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await workspaceFixture(page, shellState, { dictationModel: "storage" });
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Typed input stays available");
    await page
      .getByRole("button", { name: "Dictation settings", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Not enough space");
    await visual.capture("dictation.chat.storage-notice");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Dictation settings" })
      .click();
    await expect(page.locator(".dictation-settings")).toBeVisible();
    await visual.capture("dictation.settings.storage");
    await page.getByRole("button", { name: "Retry download" }).click();
    await expect(page.locator(".dictation-settings")).toContainText(
      "Waiting for a connection",
    );
    await visual.capture("dictation.settings.waiting");
    await page.evaluate(() =>
      Reflect.get(window, "__dictationTest").model("downloading", 37),
    );
    await expect(page.locator(".dictation-settings")).toContainText("37%");
    await visual.capture("dictation.settings.downloading");
    await page.evaluate(() =>
      Reflect.get(window, "__dictationTest").model("preparing", 100),
    );
    await expect(page.locator(".dictation-settings")).toContainText(
      "Preparing speech recognition",
    );
    await page.evaluate(() =>
      Reflect.get(window, "__dictationTest").model("ready", 100),
    );
    await expect(page.locator(".dictation-settings")).toContainText(
      "Ready for offline dictation",
    );
    await visual.capture("dictation.settings.ready");
  },
);
