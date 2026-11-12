import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test("long manual model IDs stay bounded without inventing thinking support", async ({
  page,
}) => {
  const modelId = "example-lab/extended-context-conversational-model-2026-09";
  await workspaceFixture(page, shellState, {
    aiConnection: {
      provider: "custom",
      endpoint: "https://models.example.test/v1",
    },
    aiModel: modelId,
    showInlineModel: true,
  });
  await page.goto("/");
  const trigger = page.locator(".manual-trigger");
  await expect(trigger).toContainText(modelId);
  await expect(trigger).toHaveAttribute(
    "aria-description",
    new RegExp(modelId),
  );
  await expect(page.locator(".thinking-choice")).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(trigger).toBeInViewport({ ratio: 1 });
    expect((await trigger.boundingBox())!.width).toBeLessThanOrEqual(260);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

for (const language of ["en", "de"] as const) {
  test.describe(language, () => {
    test.use({
      localizationMode: "real",
      locale: language === "de" ? "de-DE" : "en-US",
    });
    for (const width of [390, 1280]) {
      test(
        `compact composer preserves activity space and independent settings at ${width}px`,
        { tag: width < 600 ? "@visual-mobile" : "@visual-desktop" },
        async ({ page, visual }, info) => {
          const phrase =
            language === "de"
              ? "Ich prüfe die Zusammenhänge und ordne die offenen Punkte für die nächste Antwort."
              : "Checking the connections and arranging the open questions for the next reply.";
          await page.setViewportSize({ width, height: 800 });
          await workspaceFixture(
            page,
            { ...shellState, mobile: width < 600 },
            {
              aiConnection: {
                provider: "openai",
                endpoint: null,
                connectionId: "personal",
                label: "Personal",
              },
              aiModel: "gpt-6.1-sol",
              showInlineModel: true,
              aiHoldResponse: true,
              aiComment: phrase,
              aiConversationTitle: "Plan review",
              localization: {
                language,
                formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
                writable: true,
              },
            },
          );
          await page.goto("/");
          const input = page.locator(".chat-composer textarea");
          const controls = page.locator(".composer-selectors");
          const model = controls.locator(".choice-trigger").first();
          const thinking = controls.locator(".choice-trigger").last();
          await input.fill("Review the plan");
          await input.press("Enter");
          await expect(page.locator(".comment-reveal")).toHaveText(phrase, {
            timeout: 20_000,
          });
          await input.fill("Keep this draft");
          await expect(model).toContainText("GPT-6.1 Sol");
          await expect(thinking).toContainText(
            language === "de" ? "Mittel" : "Medium",
          );
          for (const availableWidth of [1280, 768, 540, 390, 320, width]) {
            await page.setViewportSize({ width: availableWidth, height: 800 });
            const { row, activity, settings } = await page.evaluate(() => {
              const box = (selector: string) => {
                const bounds = document
                  .querySelector(selector)!
                  .getBoundingClientRect();
                return {
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                };
              };
              return {
                row: box(".composer-bottom"),
                activity: box(".chat-activity"),
                settings: box(".composer-selectors"),
              };
            });
            expect(activity.x).toBeCloseTo(row.x, 0);
            expect(settings.x + settings.width).toBeCloseTo(
              row.x + row.width,
              0,
            );
            expect(settings.width).toBeLessThanOrEqual(260);
            expect(activity.width).toBeGreaterThanOrEqual(row.width * 0.5);
            for (const trigger of [model, thinking]) {
              await expect(trigger).toBeInViewport({ ratio: 1 });
              expect(
                (await trigger.boundingBox())!.height,
              ).toBeGreaterThanOrEqual(44);
            }
            if (row.width <= 480)
              expect(settings.y).toBeGreaterThanOrEqual(
                activity.y + activity.height,
              );
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
          }
          await page.screenshot({
            path: info.outputPath("compact-composer-working.png"),
          });
          await visual.capture("chat.controls.working");
          await thinking.focus();
          await page.keyboard.press("ArrowDown");
          await expect(page.getByRole("menu")).toBeInViewport({ ratio: 1 });
          await expect(
            page.getByRole("menu").locator('[data-choice=""]'),
          ).toBeFocused();
          await expect(
            page.getByRole("menu").locator('[data-choice=""]'),
          ).toContainText(language === "de" ? "Mittel" : "Medium");
          await expect(
            page.getByRole("menu").locator('[data-choice="recommended"]'),
          ).toContainText(language === "de" ? "Mittel" : "Medium");
          await page.keyboard.press(language === "de" ? "e" : "r");
          await expect(
            page.getByRole("menu").locator('[data-choice="recommended"]'),
          ).toBeFocused();
          await page.keyboard.press("Home");
          await expect(
            page.getByRole("menu").locator('[data-choice=""]'),
          ).toBeFocused();
          await visual.capture("chat.controls.thinking-menu");
          await page
            .getByRole("menu")
            .locator('[data-choice="recommended"]')
            .click();
          await expect(input).toBeFocused();
          await expect(
            thinking.locator('[aria-hidden="true"]').first(),
          ).toHaveText("☆");
          await expect(input).toHaveValue("Keep this draft");
          await page.evaluate(() => Reflect.get(window, "__finishResponse")());
          await expect(page.locator(".chat-activity")).toHaveCount(0);
          const row = (await page.locator(".composer-bottom").boundingBox())!;
          const settings = (await controls.boundingBox())!;
          expect(settings.x + settings.width).toBeCloseTo(row.x + row.width, 0);
          await visual.capture("chat.controls.idle");
        },
      );
    }
  });
}
