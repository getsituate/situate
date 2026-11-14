import { expect, test } from "./test";
import {
  shellState,
  workspaceFixture,
  type NativeConversationFixture,
} from "./workspace-fixture";

test.use({ localizationMode: "real" });

test("streamed Markdown follows growth, stops on upward scrolling and stays put at completion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 760 });
  await workspaceFixture(page, shellState, {
    aiConnection: {
      provider: "custom",
      endpoint: "https://model.example.invalid/v1",
      auth: "api_key",
    },
    aiModel: "fixture-model",
    aiHoldPartialResponse: true,
    aiResponseText: "",
  });
  async function stream(text: string, done = false) {
    await page.evaluate(
      ({ text, done }) => {
        const native = Reflect.get(
          window,
          "__nativeConversationFixture",
        ) as NativeConversationFixture;
        const current = native.snapshot("garden", "legacy");
        const accumulated =
          (current.partialMessage?.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("") ?? "") + text;
        if (done) native.finish("garden", "legacy", accumulated);
        else
          native.publish("garden", "legacy", {
            partialMessage: {
              role: "assistant",
              content: [{ type: "text", text: accumulated }],
              timestamp: current.partialMessage?.timestamp ?? Date.now(),
              usage: null,
              stopReason: "pending",
            },
          });
      },
      { text, done },
    );
  }
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Suggest a reading plan.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toBeVisible();
  const region = page.locator(".transcript-scroll");
  const distance = () =>
    region.evaluate(
      (element) =>
        element.scrollHeight - element.clientHeight - element.scrollTop,
    );
  for (const section of ["Morning", "Afternoon", "Evening"]) {
    await stream(
      `\n\n## ${section}\n\n` +
        "Read a chapter and record one useful idea.\n\n".repeat(14),
    );
    await expect(page.locator(".chat-markdown").last()).toContainText(section);
    await expect.poll(distance).toBeLessThanOrEqual(1);
  }
  const bounds = (await region.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const readingTop = await region.evaluate(
    (element) => element.scrollTop - 400,
  );
  await page.mouse.wheel(0, -400);
  await expect
    .poll(() => region.evaluate((element) => element.scrollTop))
    .toBeCloseTo(readingTop, 0);
  await expect.poll(distance).toBeGreaterThan(48);
  const readingAnchor = await page
    .locator(".message.assistant")
    .evaluate((element) => {
      const edge = element
        .closest(".transcript-scroll")!
        .getBoundingClientRect().top;
      const paragraphs = [...element.querySelectorAll("p")];
      const index = paragraphs.findIndex(
        (paragraph) => paragraph.getBoundingClientRect().bottom > edge,
      );
      return {
        index,
        offset: paragraphs[index]!.getBoundingClientRect().top - edge,
      };
    });
  await stream(
    "\n\n## Weekend\n\n" + "Review the reading notes.\n\n".repeat(14),
  );
  await expect(page.locator(".chat-markdown").last()).toContainText("Weekend");
  await stream("", true);
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".message.assistant p")
        .nth(readingAnchor.index)
        .evaluate(
          (element) =>
            element.getBoundingClientRect().top -
            element.closest(".transcript-scroll")!.getBoundingClientRect().top,
        ),
    )
    .toBeCloseTo(readingAnchor.offset, 0);
});
