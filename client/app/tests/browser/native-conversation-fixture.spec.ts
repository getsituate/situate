import { expect, test } from "./test";
import {
  shellState,
  workspaceFixture,
  nativeRequests,
  type NativeConversationFixture,
} from "./workspace-fixture";
test.use({ localizationMode: "real" });
const connection = {
  provider: "openai",
  endpoint: null,
  auth: "api_key" as const,
};

test("canonical conversation reads reject mutations and initial records accept only draft data", async ({
  page,
}) => {
  await workspaceFixture(page, shellState);
  await page.goto("/");
  const observed = await page.evaluate(async () => {
    const native = Reflect.get(
      window,
      "__nativeConversationFixture",
    ) as NativeConversationFixture;
    const before = native.getRecord("garden", "legacy");
    const invoke = Reflect.get(window, "__TAURI_INTERNALS__").invoke;
    const read = await invoke("ai_conversation_read", {
      scope: "garden",
      conversation: "legacy",
    });
    const rejected = [];
    for (const [command, args] of [
      ["ai_conversation", { scope: "garden", conversation: "legacy" }],
      [
        "ai_conversation_read",
        {
          scope: "garden",
          conversation: "legacy",
          record: { ...before, draft: "Overwrite" },
        },
      ],
      [
        "ai_create_conversation",
        {
          scope: "garden",
          id: "rejected",
          title: "",
          initial: {
            draft: "",
            runtime: { runs: [{ id: "forged", state: "running" }] },
          },
        },
      ],
    ] as const) {
      try {
        await invoke(command, args);
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
    }
    return {
      before,
      read,
      after: native.getRecord("garden", "legacy"),
      rejected,
    };
  });
  expect(observed.read).toEqual(observed.before);
  expect(observed.read.version).toBe(2);
  expect(observed.after).toEqual(observed.before);
  expect(observed.rejected).toEqual([true, true, true]);
});
for (const width of [1280, 390]) {
  test(`Stop preserves the draft and pending follow-up until explicit recall at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await workspaceFixture(
      page,
      { ...shellState, mobile: width < 600 },
      {
        aiConnection: connection,
        aiModel: "gpt-4o-mini",
        aiHoldPartialResponse: true,
      },
    );
    await page.goto("/");
    const draft = page.getByRole("textbox", { name: "Message", exact: true });
    const stop = page.getByRole("button", {
      name: "Stop response",
      exact: true,
    });
    await draft.fill("Start a response");
    await draft.press("Enter");
    await expect(stop).toBeVisible();
    await draft.fill("Recover this followup");
    await draft.press("Alt+Enter");
    await expect(draft).toHaveValue("");
    await expect(page.locator(".pending-toggle")).toHaveAccessibleName(
      "1 pending",
    );
    await draft.fill("Keep this draft");
    await stop.click();
    await expect(stop).toHaveCount(0);
    await expect(draft).toHaveValue("Keep this draft");
    await expect(page.locator(".pending-toggle")).toHaveAccessibleName(
      "1 pending",
    );
    await page.locator(".pending-toggle").click();
    await expect(page.locator(".pending-preview")).toHaveText(
      "Recover this followup",
    );
    await page.evaluate(() => Reflect.get(window, "__finishResponse")());
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              Reflect.get(
                window,
                "__nativeConversationFixture",
              ) as NativeConversationFixture
            ).getRecord("garden", "legacy").draft,
        ),
      )
      .toBe("Keep this draft");
    const stopped = await page.evaluate(() =>
      (
        Reflect.get(
          window,
          "__nativeConversationFixture",
        ) as NativeConversationFixture
      ).snapshot("garden", "legacy"),
    );
    expect(stopped.phase).toBe("interrupted");
    expect(stopped.taskActive).toBe(false);
    expect(stopped.record.draft).toBe("Keep this draft");
    expect(
      stopped.record.runtime?.pending
        .filter((row) => row.state === "pending")
        .map(({ kind, text }) => ({ kind, text })),
    ).toEqual([{ kind: "followUp", text: "Recover this followup" }]);
    expect(await nativeRequests(page)).toHaveLength(1);
    if (width < 600)
      await page
        .getByRole("button", { name: "Edit all pending", exact: true })
        .click();
    else await draft.press("Alt+ArrowUp");
    await expect(draft).toHaveValue("Recover this followup\n\nKeep this draft");
    await expect(draft).toBeFocused();
    await expect(page.locator(".pending")).toHaveCount(0);
    const recalled = await page.evaluate(() =>
      (
        Reflect.get(
          window,
          "__nativeConversationFixture",
        ) as NativeConversationFixture
      ).getRecord("garden", "legacy"),
    );
    expect(
      recalled.runtime?.pending.filter((row) => row.state === "pending"),
    ).toEqual([]);
    expect(
      recalled.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content),
    ).toEqual(["Start a response"]);
    expect(await nativeRequests(page)).toHaveLength(1);
    const actions = await page.evaluate(() =>
      (
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: { action?: { type: string } };
        }[]
      )
        .filter((call) => call.command === "ai_conversation_action")
        .map((call) => call.args.action?.type)
        .filter((type) => type !== "draft"),
    );
    expect(actions).toEqual(["submit", "enqueue", "cancel", "recall"]);
  });
}
test("reattachment after a WebView reload observes retained native work without a second submission", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConnection: connection,
    aiModel: "gpt-4o-mini",
    aiHoldResponse: true,
  });
  await page.goto("/");
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Keep working while I reload");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("A streamed test response.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        Reflect.get(
          window,
          "__nativeConversationFixture",
        ) as NativeConversationFixture
      ).requests(),
    ),
  ).toHaveLength(1);
  await page.evaluate(() => Reflect.get(window, "__finishResponse")());
  await expect(
    page.getByRole("button", { name: "Stop response", exact: true }),
  ).toHaveCount(0);
  const record = await page.evaluate(() =>
    (
      Reflect.get(
        window,
        "__nativeConversationFixture",
      ) as NativeConversationFixture
    ).getRecord("garden", "legacy"),
  );
  expect(record.version).toBe(2);
  expect(
    record.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
  expect(
    record.messages.filter((message) => message.role === "assistant"),
  ).toHaveLength(1);
});

test("accepted question effects remain explicitly retryable without repeating the accepted answer", async ({
  page,
}) => {
  await workspaceFixture(page, shellState, {
    aiConnection: connection,
    aiModel: "gpt-4o-mini",
  });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const fixture = Reflect.get(
      window,
      "__nativeConversationFixture",
    ) as NativeConversationFixture;
    await fixture.accept("garden", "legacy", "present-fixture", {
      version: 1,
      type: "presentQuestion",
      question: {
        id: "question",
        prompt: "What should I prepare?",
        context: { kind: "fixture" },
      },
    });
  });
  await page
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill("A reading list");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            Reflect.get(
              window,
              "__nativeConversationFixture",
            ) as NativeConversationFixture
          )
            .getRecord("garden", "legacy")
            .runtime?.events.filter(
              (event) => event.type === "question_answered",
            ).length,
      ),
    )
    .toBe(1);
  await page.evaluate(() =>
    (
      Reflect.get(
        window,
        "__nativeConversationFixture",
      ) as NativeConversationFixture
    ).publish("garden", "legacy", {
      questionBusy: false,
      taskActive: false,
      phase: "idle",
      error: "native.onboarding.storage.writeFailed",
    }),
  );
  const retry = page.getByRole("button", {
    name: "Continue setup",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await page
    .getByRole("dialog", { name: "Action failed", exact: true })
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await retry.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            Reflect.get(
              window,
              "__nativeConversationFixture",
            ) as NativeConversationFixture
          ).snapshot("garden", "legacy").questionBusy,
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    const fixture = Reflect.get(
      window,
      "__nativeConversationFixture",
    ) as NativeConversationFixture;
    const record = fixture.getRecord("garden", "legacy");
    const runId = fixture.snapshot("garden", "legacy").actionId!;
    const sequence =
      Math.max(
        0,
        ...record
          .runtime!.events.filter((event) => event.runId === runId)
          .map((event) => event.sequence),
      ) + 1;
    record.runtime!.events.push({
      id: `${runId}-${sequence}`,
      runId,
      sequence,
      type: "question_action_completed",
      data: { questionId: "question" },
    });
    fixture.saveRecord("garden", record, {
      questionBusy: false,
      taskActive: false,
      phase: "idle",
      error: null,
    });
  });
  await expect(retry).toHaveCount(0);
  const record = await page.evaluate(() =>
    (
      Reflect.get(
        window,
        "__nativeConversationFixture",
      ) as NativeConversationFixture
    ).getRecord("garden", "legacy"),
  );
  expect(
    record.runtime!.events.filter(
      (event) => event.type === "question_answered",
    ),
  ).toHaveLength(1);
  expect(
    record.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      (
        Reflect.get(
          window,
          "__nativeConversationFixture",
        ) as NativeConversationFixture
      ).requests(),
    ),
  ).toEqual([]);
});
