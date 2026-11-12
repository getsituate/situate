import { expect, test } from "./test";
import { t } from "@situate/localization";
import { onboardingFixture } from "./onboarding-fixture";
import { newOnboardingRecord } from "../../src/onboarding/types";

test.use({ localizationMode: "real" });
// Chromium varies slightly when rasterizing the composer’s SVG edges.
const svgColorRounding = { threshold: 0.02 };

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const evidence = await page.evaluate(() => {
    const fixture = Reflect.get(window, "__onboardingFixture");
    return {
      progress: fixture?.progress(),
      calls: fixture?.calls,
      conversations: fixture?.conversations(),
      turns: fixture?.turns(),
      effects: fixture?.effects(),
    };
  });
  await info.attach("onboarding-fixture", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
});

test(
  "workspace overview starts welcome only on Create and proceeds directly to the five-step creation",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    test.setTimeout(60_000);
    await onboardingFixture(page, { startAtEntry: true, connected: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const create = page.getByRole("button", {
      name: "Create a workspace",
    });
    await expect(create).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Open a workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Welcome to Situate", exact: true }),
    ).toHaveCount(0);
    await create.click();
    await expect(
      page.getByRole("region", { name: "Welcome to Situate", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pause motion", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume motion", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip intro", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(
      page.getByRole("heading", {
        name: "Create a workspace",
        exact: true,
      }),
    ).toBeFocused();
    await expect(page.locator(".setup-steps li")).toHaveCount(5);
    await expect(page.locator(".setup-steps li.active")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(page.locator(".setup-illustration")).toBeVisible();
    const name = page.getByRole("textbox", {
      name: "Workspace name",
      exact: true,
    });
    await expect(name).toHaveValue("My workspace");
    await name.fill("Field notes");
    await page.getByRole("radio", { name: "Cobalt", exact: true }).check();
    await visual.capture("onboarding.creation.ready");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(create).toBeFocused();
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "__ipcCalls").filter(
          (call: { command: string; args: { action?: string } }) =>
            call.command === "workspace_action" &&
            call.args.action === "create",
        ),
      ),
    ).toHaveLength(0);
    await create.click();
    await expect(name).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Welcome to Situate", exact: true }),
    ).toHaveCount(0);
    await name.fill("Field notes");
    await page.getByRole("radio", { name: "Cobalt", exact: true }).check();
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Choose a provider", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".setup-steps li")).toHaveCount(5);
    await expect(page.locator(".setup-steps li").nth(1)).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-workspace-accent",
      "cobalt",
    );
    await visual.capture("onboarding.access.providers");
    const creation = await page.evaluate(() =>
      Reflect.get(window, "__ipcCalls").find(
        (call: { command: string; args: { action?: string } }) =>
          call.command === "workspace_action" && call.args.action === "create",
      ),
    );
    expect(creation.args).toMatchObject({
      name: "Field notes",
      accent: "cobalt",
    });
  },
);

const brief = {
  sources: "Two synthetic Markdown exports in a local folder.",
  preferences: "Keep reading notes in their current folders.",
};
const progress = (page: import("./test").Page) =>
  page.evaluate(() => Reflect.get(window, "__onboardingFixture").progress());
const calls = (page: import("./test").Page) =>
  page.evaluate(() => Reflect.get(window, "__onboardingFixture").calls);
const conversations = (page: import("./test").Page) =>
  page.evaluate(() =>
    Reflect.get(window, "__onboardingFixture").conversations(),
  );
const turns = (page: import("./test").Page) =>
  page.evaluate(() => Reflect.get(window, "__onboardingFixture").turns());
const effects = (page: import("./test").Page) =>
  page.evaluate(() => Reflect.get(window, "__onboardingFixture").effects());
const writes = async (page: import("./test").Page) =>
  (await effects(page)).filter((effect: { name: string }) =>
    ["write", "save_working_method", "file_save"].includes(effect.name),
  );
const cancellations = async (page: import("./test").Page) =>
  (await calls(page)).filter(
    (call: { command: string; args: { action?: { type: string } } }) =>
      call.command === "ai_conversation_action" &&
      call.args.action?.type === "cancel",
  );
const dock = (page: import("./test").Page) => page.locator(".question-dock");
const answer = (page: import("./test").Page) =>
  dock(page).getByRole("textbox", {
    name: t("chatQuestion.answer"),
    exact: true,
  });
const choice = (page: import("./test").Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function start(page: import("./test").Page) {
  await page
    .getByRole("textbox", {
      name: t("onboarding.conversation.sources"),
      exact: true,
    })
    .fill(brief.sources);
  await page
    .getByRole("textbox", {
      name: t("onboarding.conversation.preferences"),
      exact: true,
    })
    .fill(brief.preferences);
  await page
    .getByRole("button", {
      name: t("onboarding.conversation.start"),
      exact: true,
    })
    .click();
}
async function proposal(page: import("./test").Page) {
  await expect(choice(page, t("onboardingAgent.choice.confirm"))).toBeVisible();
  await expect(answer(page)).toBeEnabled();
  await expect.poll(async () => (await progress(page)).step).toBe("proposal");
}

test(
  "model access must be explicitly verified before the initial brief",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await onboardingFixture(page, { modelProvider: "openai" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const check = page.getByRole("button", {
      name: t("onboarding.access.check"),
      exact: true,
    });
    await expect(check).toBeVisible();
    expect(await turns(page)).toHaveLength(0);
    const model = page.getByRole("combobox", {
      name: t("onboarding.access.modelLabel"),
      exact: true,
    });
    await expect(model).toBeVisible();
    await visual.capture("onboarding.access.model");
    await model.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await visual.capture("onboarding.access.model-options");
    await page.keyboard.press("Escape");
    await check.click();
    await expect(
      page.getByRole("heading", {
        name: t("onboarding.conversation.briefTitle"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".chat-pane")).toHaveCount(0);
    expect(await turns(page)).toHaveLength(1);
    expect(
      (await calls(page)).some(
        (call: { command: string }) =>
          call.command === "ai_create_conversation",
      ),
    ).toBe(false);
    expect(await conversations(page)).toEqual([]);
    await page.mouse.move(0, 0);
    await visual.capture("onboarding.conversation.brief");
  },
);

test(
  "model checks can be stopped and retried without leaving conversations",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await onboardingFixture(page, { modelProvider: "openai" });
    await page.addInitScript(() => {
      const host = Reflect.get(window, "__TAURI_INTERNALS__");
      const original = host.invoke.bind(host);
      let request = 0;
      let release: (() => void) | undefined;
      host.invoke = async (command: string, args: Record<string, unknown>) => {
        if (command === "ai_model_check") {
          request++;
          Reflect.set(window, "__modelCheckRequests", request);
          if (request === 1) {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            throw new Error("native.ai.response.stopped");
          }
          if (request === 2) throw new Error("native.ai.request.failed");
        }
        if (command === "ai_model_check_cancel") release?.();
        return original(command, args);
      };
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const region = page.locator(".setup-check-status");
    const status = region.getByRole("status");
    const initial = await region.boundingBox();
    await page
      .getByRole("button", { name: t("onboarding.access.check"), exact: true })
      .click();
    await expect(status).toHaveText(t("onboarding.access.checking"));
    await expect(
      page.getByRole("combobox", {
        name: t("onboarding.access.modelLabel"),
        exact: true,
      }),
    ).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "__modelCheckRequests")),
      )
      .toBe(1);
    await visual.capture("onboarding.access.checking");
    await page
      .getByRole("button", { name: t("onboarding.access.cancel"), exact: true })
      .click();
    await expect(status).toHaveText(t("onboarding.access.cancelled"));
    await visual.capture("onboarding.access.cancelled");
    await page
      .getByRole("button", { name: t("onboarding.access.retry"), exact: true })
      .click();
    await expect(status).toHaveText(t("onboarding.access.failure"));
    const failed = await region.boundingBox();
    expect(failed?.y).toBe(initial?.y);
    expect(failed?.height).toBe(initial?.height);
    await visual.capture("onboarding.access.failed");
    await page
      .getByRole("button", { name: t("onboarding.access.retry"), exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: t("onboarding.conversation.briefTitle"),
        exact: true,
      }),
    ).toBeVisible();
    const recorded = await calls(page);
    expect(
      await page.evaluate(() => Reflect.get(window, "__modelCheckRequests")),
    ).toBe(3);
    expect(
      recorded.some(
        (call: { command: string }) =>
          call.command === "ai_create_conversation",
      ),
    ).toBe(false);
    expect(await conversations(page)).toEqual([]);
  },
);

test("required access has no manual-use bypass", async ({ page }) => {
  await onboardingFixture(page, { connected: false });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Choose a provider", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Skip for now",
    "Continue without AI",
    t("onboarding.conversation.start"),
    t("onboarding.conversation.openApp"),
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
});

for (const intent of ["keep", "change", "help"] as const) {
  for (const fresh of [false, true]) {
    test(`initial brief keeps ${intent} independent of fresh=${fresh}`, async ({
      page,
    }) => {
      await onboardingFixture(page, {
        record: { ...newOnboardingRecord(), step: "method" },
      });
      await page.goto("/");
      await page
        .getByRole("radio", {
          name: t(`onboarding.conversation.${intent}`),
          exact: true,
        })
        .check();
      const sources = page.getByRole("textbox", {
        name: t("onboarding.conversation.sources"),
        exact: true,
      });
      const begin = page.getByRole("button", {
        name: t("onboarding.conversation.start"),
        exact: true,
      });
      await expect(begin).toBeDisabled();
      if (fresh) {
        await page
          .getByRole("checkbox", {
            name: t("onboarding.conversation.fresh"),
            exact: true,
          })
          .check();
        await expect(sources).toHaveCount(0);
      } else await sources.fill(brief.sources);
      await expect(begin).toBeEnabled();
      await begin.click();
      await expect
        .poll(async () => (await progress(page)).step)
        .toBe("proposal");
      expect(await progress(page)).toMatchObject({ fresh, intent });
      const record = await progress(page);
      expect(record.conversationId).toBeTruthy();
      expect(record.methodConversationId).toBeNull();
      expect(record.sourceConversationId).toBeNull();
      expect(record.supportConversationId).toBeNull();
      expect(
        (await conversations(page)).filter(
          (item: { id: string }) => item.id === record.conversationId,
        ),
      ).toHaveLength(1);
      await expect(
        choice(
          page,
          t(
            fresh
              ? "onboardingAgent.choice.confirmFresh"
              : "onboardingAgent.choice.confirm",
          ),
        ),
      ).toBeVisible();
    });
  }
}

for (const width of [1040, 390, 320]) {
  test(`long clarification collapses without losing the draft at ${width}px`, async ({
    page,
  }, info) => {
    await onboardingFixture(page, {
      questionFirst: true,
      clarification: {
        prompt:
          "The notes describe several possible ways to organize the reading collection. Some group material by topic, while others follow the order in which it was collected. There are also unfinished drafts and links that may still be useful. Changing all of these at once could make it harder to find familiar material.\n\nWhich approach should I use when preparing the working method?",
        suggestions: [
          {
            id: "friday",
            label:
              "Keep the existing folders and review new reading material at the end of each week.",
          },
          {
            id: "monday",
            label:
              "Group the new reading notes by topic while leaving the existing collection unchanged.",
          },
        ],
      },
      record: { ...newOnboardingRecord(), step: "method" },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await start(page);
    await expect(dock(page).locator(".question-text")).toContainText(
      "The notes describe",
    );
    await page.setViewportSize({ width, height: width === 320 ? 350 : 760 });
    const toggle = dock(page).getByRole("button", {
      name: t("chatQuestion.collapse"),
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await answer(page).fill("Keep the folders as they are.");
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("question-expanded.png") });
    await toggle.focus();
    await toggle.press("Enter");
    const reopen = dock(page).getByRole("button", {
      name: t("chatQuestion.show"),
      exact: true,
    });
    await expect(reopen).toBeFocused();
    await expect(dock(page).locator(".question-body")).toBeHidden();
    await expect(dock(page).locator("textarea")).toHaveValue(
      "Keep the folders as they are.",
    );
    await expect(page.locator(".transcript-scroll")).toBeVisible();
    await page.screenshot({ path: info.outputPath("question-collapsed.png") });
    await reopen.press("Enter");
    await expect(answer(page)).toHaveValue("Keep the folders as they are.");
    await answer(page).press("Enter");
    await proposal(page);
  });
}

for (const response of ["suggestion", "text"] as const) {
  test(
    `clarification accepts a direct ${response} in the full question composer`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      await onboardingFixture(page, {
        questionFirst: true,
        record: { ...newOnboardingRecord(), step: "method" },
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/");
      await start(page);
      await expect(dock(page)).toContainText(
        "When would you like to review your notes?",
      );
      const questionId = await dock(page)
        .locator("[data-question-id]")
        .getAttribute("data-question-id");
      await expect(answer(page)).toBeEnabled();
      await expect(dock(page).locator(".chat-composer")).toBeVisible();
      await expect(
        dock(page).getByRole("button", {
          name: t("navigation.attachFile"),
          exact: true,
        }),
      ).toBeVisible();
      if (response === "suggestion") {
        await visual.capture("onboarding.conversation.clarification");
        await choice(page, "Each Friday").click();
      } else {
        await answer(page).fill("Friday, after I finish reading.");
        await visual.capture("onboarding.conversation.clarification-draft");
        await dock(page)
          .getByRole("button", {
            name: t("navigation.sendMessage"),
            exact: true,
          })
          .click();
      }
      await proposal(page);
      const id = (await progress(page)).conversationId;
      const retained = (await conversations(page)).find(
        (item: { id: string }) => item.id === id,
      );
      const events = retained.runtime.events;
      const answered = events.filter(
        (event: { type: string }) => event.type === "question_answered",
      );
      expect(answered).toHaveLength(1);
      expect(answered[0].data.answer).toEqual(
        response === "suggestion"
          ? { text: "Each Friday", choiceId: "friday" }
          : { text: "Friday, after I finish reading." },
      );
      await expect(choice(page, "Each Friday")).toHaveCount(0);
      const requestCount = (await turns(page)).length;
      const rejected = await page.evaluate(
        async ({ id, questionId }) => {
          const modulePath = "/src/ai/chat.ts";
          const { workspaceChat } = await import(modulePath);
          try {
            await workspaceChat("garden", id).answerQuestion({
              questionId,
              choiceId: "friday",
            });
            return null;
          } catch (error) {
            return String(error);
          }
        },
        { id, questionId },
      );
      expect(rejected).toContain("chatQuestion.stale");
      expect(await turns(page)).toHaveLength(requestCount);
      expect((await progress(page)).instructionRevision).toBeNull();
    },
  );
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 800, height: 600 },
]) {
  test(
    `free text on the current proposal revises it without confirming instructions or importing at ${viewport.width}×${viewport.height}`,
    { tag: "@visual-desktop" },
    async ({ page, visual }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await onboardingFixture(page, {
        record: { ...newOnboardingRecord(), step: "method" },
      });
      await page.setViewportSize(viewport);
      await page.goto("/");
      await start(page);
      await proposal(page);
      const id = (await progress(page)).conversationId;
      const question = await dock(page)
        .locator("[data-question-id]")
        .getAttribute("data-question-id");
      await expect(page.locator(".chat-composer")).toHaveCount(1);
      await expect(answer(page)).toBeInViewport({ ratio: 1 });
      await choice(
        page,
        t("onboardingAgent.choice.confirm"),
      ).scrollIntoViewIfNeeded();
      await expect(
        choice(page, t("onboardingAgent.choice.confirm")),
      ).toBeInViewport({ ratio: 1 });
      await expect(answer(page)).toBeInViewport({ ratio: 1 });
      await expect(
        dock(page).getByRole("button", {
          name: t("navigation.sendMessage"),
          exact: true,
        }),
      ).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const explanation = page.locator(".chat-markdown p").filter({
        hasText: "I suggest keeping notes in their existing structure.",
      });
      await explanation.scrollIntoViewIfNeeded();
      await expect(
        dock(page).getByText(t("onboardingAgent.question.method"), {
          exact: true,
        }),
      ).toBeInViewport({ ratio: 1 });
      await expect(explanation).toBeVisible();
      await visual.capture("onboarding.conversation.proposal");
      await expect(page.locator(".proposed-document")).toHaveCount(0);
      await expect(
        page.getByText("I suggest keeping notes in their existing structure.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dock(page).getByRole("button", {
          name: t("chatQuestion.viewDetails"),
          exact: true,
        }),
      ).toHaveCount(0);
      const retained = (await conversations(page)).find(
        (item: { id: string }) => item.id === id,
      );
      const shown = retained.runtime.events
        .filter(
          (event: { type: string }) => event.type === "question_presented",
        )
        .at(-1).data;
      expect(shown.preview).toBeUndefined();
      expect(shown.context.record.proposal).toBe(
        "# Working instructions\n\nKeep notes in their existing structure.\n",
      );
      await expect(answer(page)).toBeInViewport({ ratio: 1 });
      await answer(page).fill("Yes, but keep separate reading lists.");
      await dock(page)
        .getByRole("button", { name: t("navigation.sendMessage"), exact: true })
        .click();
      await expect(
        dock(page).locator("[data-question-id]"),
      ).not.toHaveAttribute("data-question-id", question!);
      await proposal(page);
      expect(await progress(page)).toMatchObject({
        conversationId: id,
        instructionRevision: null,
        entered: false,
      });
      expect(await writes(page)).toHaveLength(0);
      expect(
        (await calls(page)).filter(
          (call: { command: string }) =>
            call.command === "onboarding_development_prepare",
        ),
      ).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    },
  );
}

test(
  "Open app completes guidance during import and preserves ordinary chat across reload",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await onboardingFixture(page, {
      holdImportResponse: true,
      importResult: true,
      noIdeas: true,
      record: { ...newOnboardingRecord(), step: "method" },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await start(page);
    await proposal(page);
    const before = await progress(page);
    await choice(page, t("onboardingAgent.choice.confirm")).click();
    await page.waitForFunction(
      () => typeof Reflect.get(window, "__finishImportResponse") === "function",
    );
    await expect
      .poll(async () => (await progress(page)).instructionRevision)
      .toBeTruthy();
    const composer = page.locator(".chat-pane .chat-composer textarea");
    const showLatestMessages = async () => {
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      const transcript = page.locator(".transcript-scroll");
      await transcript.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() =>
          transcript.evaluate((element) =>
            Math.abs(
              element.scrollHeight - element.clientHeight - element.scrollTop,
            ),
          ),
        )
        .toBeLessThan(1);
    };
    await expect(page.locator(".setup-panel")).not.toHaveAttribute("inert");
    await composer.fill("Keep this unsent import clarification.");
    await expect
      .poll(
        async () =>
          (await conversations(page)).find(
            (item: { id: string }) => item.id === before.conversationId,
          )?.draft,
      )
      .toBe("Keep this unsent import clarification.");
    await showLatestMessages();
    await visual.capture("onboarding.conversation.import-running");
    const aborts = (await cancellations(page)).length;
    try {
      await page
        .getByRole("button", {
          name: t("onboarding.conversation.openApp"),
          exact: true,
        })
        .click();
      const finale = page.getByRole("button", {
        name: "Go to workspace",
        exact: true,
      });
      const reducedMotion = await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      if (!reducedMotion) {
        await expect(finale).toBeVisible();
        await finale.click();
      }
      await expect(page.locator(".topic-window")).toBeVisible();
      await expect(finale).toHaveCount(0);
      await showLatestMessages();
      await visual.capture("onboarding.conversation.first-entry");
      expect(await progress(page)).toMatchObject({
        conversationId: before.conversationId,
        entered: true,
        paused: false,
      });
      expect((await progress(page)).step).toBe("complete");
      expect(await cancellations(page)).toHaveLength(aborts);
      expect(
        (await calls(page)).filter(
          (call: { command: string }) =>
            call.command === "onboarding_development_prepare",
        ),
      ).toHaveLength(0);
      await expect(composer).toHaveValue(
        "Keep this unsent import clarification.",
      );
      await expect(page.locator(".setup-continuation")).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: t("onboarding.conversation.guided"),
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await page.evaluate(() =>
        Reflect.get(window, "__finishImportResponse")?.(),
      );
    }
    await expect
      .poll(async () => {
        const conversation = (await conversations(page)).find(
          (item: { id: string }) => item.id === before.conversationId,
        );
        return conversation?.runtime?.runs?.every(
          (run: { state: string }) => run.state === "completed",
        );
      })
      .toBe(true);
    expect((await progress(page)).step).toBe("complete");
    await expect(choice(page, t("onboardingAgent.choice.support"))).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Finish setup", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".topic-window")).toBeVisible();
    await expect(composer).toHaveValue(
      "Keep this unsent import clarification.",
    );
    await expect(
      page.locator(".setup-continuation, .setup-frame, .setup-finale-overlay"),
    ).toHaveCount(0);
    expect((await progress(page)).step).toBe("complete");
    expect(await turns(page)).toHaveLength(0);
  },
);

test("optional tools remain reachable after informational import replies without replaying import or blocking app entry", async ({
  page,
}) => {
  const missing = ["assets/map.png", "assets/sketch.png", "assets/chart.pdf"];
  const explanation =
    "Three attachments remain unavailable: assets/map.png, assets/sketch.png and assets/chart.pdf.";
  await onboardingFixture(page, {
    importResult: true,
    importMissing: missing,
    importFollowUpText: explanation,
    holdSupportResponse: true,
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await start(page);
  await proposal(page);
  await choice(page, t("onboardingAgent.choice.confirm")).click();
  await expect(
    dock(page).getByRole("button", {
      name: t("onboardingAgent.choice.support"),
      exact: true,
    }),
  ).toBeEnabled();
  const imported = await progress(page);
  await answer(page).fill("What is still missing?");
  await dock(page)
    .getByRole("button", { name: t("navigation.sendMessage"), exact: true })
    .click();
  await expect(dock(page)).toHaveCount(0);
  await expect(page.getByText(explanation, { exact: true })).toBeVisible();
  const composer = page.locator(".chat-pane .chat-composer textarea");
  await expect(composer).toBeEnabled();
  await composer.fill("OK, continue");
  await page
    .locator(".chat-pane")
    .getByRole("button", { name: t("navigation.sendMessage"), exact: true })
    .click();
  const retained = async () =>
    (await conversations(page)).find(
      (item: { id: string }) => item.id === imported.conversationId,
    );
  await expect.poll(async () => (await turns(page)).length).toBe(4);
  await expect
    .poll(async () =>
      (await retained()).runtime.runs.every(
        (run: { state: string }) => run.state === "completed",
      ),
    )
    .toBe(true);
  expect(await progress(page)).toEqual(imported);
  await expect(dock(page)).toHaveCount(0);
  const importResults = async () =>
    (await retained()).runtime.events.filter(
      (event: { type: string; data: { toolName?: string } }) =>
        event.type === "tool_execution_end" &&
        event.data.toolName === "show_imported_files",
    );
  const originalResults = await importResults();
  expect(originalResults).toHaveLength(1);
  expect(originalResults[0].data.result.details).toMatchObject({
    missing,
    complete: false,
  });
  const draft = "Keep this unsent attachment question.";
  await composer.fill(draft);
  await expect.poll(async () => (await retained()).draft).toBe(draft);
  await page.reload();
  const support = page.locator(".conversation-actions").getByRole("button", {
    name: t("onboardingAgent.choice.support"),
    exact: true,
  });
  await expect(support).toBeEnabled();
  await expect(dock(page)).toHaveCount(0);
  await expect(composer).toHaveValue(draft);
  expect(await progress(page)).toEqual(imported);
  expect(await turns(page)).toHaveLength(0);
  const aborts = (await cancellations(page)).length;
  await support.click();
  await page.waitForFunction(
    () => typeof Reflect.get(window, "__finishSupportResponse") === "function",
  );
  try {
    await expect.poll(async () => (await progress(page)).step).toBe("support");
    const open = page.getByRole("button", {
      name: t("onboarding.conversation.openApp"),
      exact: true,
    });
    await expect(open).toBeEnabled();
    await open.click();
    await expect(page.locator(".topic-window")).toBeVisible();
    expect(await progress(page)).toMatchObject({
      step: "complete",
      entered: true,
      imported: imported.imported,
    });
    expect(await cancellations(page)).toHaveLength(aborts);
    await expect(composer).toHaveValue(draft);
  } finally {
    await page.evaluate(() =>
      Reflect.get(window, "__finishSupportResponse")?.(),
    );
  }
  await expect
    .poll(async () =>
      (await retained()).runtime.runs.every(
        (run: { state: string }) => run.state === "completed",
      ),
    )
    .toBe(true);
  expect(await importResults()).toEqual(originalResults);
  const supportAnswers = (await retained()).runtime.events.filter(
    (event: { type: string; data: { answer?: { choiceId?: string } } }) =>
      event.type === "question_answered" &&
      event.data.answer?.choiceId === "support",
  );
  expect(supportAnswers).toHaveLength(1);
  expect(
    (await effects(page)).some((effect: { name: string }) =>
      ["show_imported_files", "start_plugin_development"].includes(effect.name),
    ),
  ).toBe(false);
});

test("previously entered unfinished guidance migrates without a banner or replay", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: {
      ...newOnboardingRecord(),
      entered: true,
      step: "sources",
      instructionRevision: "a".repeat(40),
      conversationId: "retained-import",
      sourceDescription: "Some requested notes remain unavailable.",
    },
  });
  await page.goto("/");
  await expect(page.locator(".topic-window")).toBeVisible();
  await expect.poll(async () => (await progress(page)).step).toBe("complete");
  await expect(
    page.locator(".setup-continuation, .setup-frame, .setup-finale-overlay"),
  ).toHaveCount(0);
  expect((await progress(page)).sourceDescription).toBe(
    "Some requested notes remain unavailable.",
  );
  expect(await turns(page)).toHaveLength(0);
  expect(await cancellations(page)).toHaveLength(0);
  expect(
    (await calls(page)).filter(
      (call: { command: string }) =>
        call.command === "onboarding_development_prepare",
    ),
  ).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".topic-window")).toBeVisible();
  expect((await progress(page)).step).toBe("complete");
});

test("earlier assistant proposals stay visible across tools and a later setup question", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  await page.evaluate(() => {
    const native = Reflect.get(window, "__nativeConversationFixture");
    const id = Reflect.get(window, "__onboardingFixture").progress()
      .conversationId;
    const record = native.getRecord("garden", id);
    const first = record.messages.findIndex(
      (message: { role: string }) => message.role === "assistant",
    );
    const assistant = record.messages[first];
    const earlier = [
      "I will compare the available reading notes.",
      "I suggest two short reading sessions each week.",
    ].flatMap((text, index) => [
      {
        ...assistant,
        timestamp: assistant.timestamp - 4 + index * 2,
        content: [
          { type: "thinking", thinking: "Compare the available times." },
          {
            type: "text",
            text,
            textSignature: JSON.stringify({
              v: 1,
              id: `proposal-${index}`,
              phase: "commentary",
            }),
          },
          {
            type: "toolCall",
            id: `read-${index}`,
            name: "read",
            arguments: { path: "Reading.md" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: `read-${index}`,
        toolName: "read",
        content: [{ type: "text", text: "Recorded reading note." }],
        timestamp: assistant.timestamp - 3 + index * 2,
        isError: false,
      },
    ]);
    record.messages.splice(first, 0, ...earlier);
    for (const event of record.runtime.events) {
      if (event.type === "work_block_end")
        event.data.messageCount += earlier.length;
    }
    native.saveRecord("garden", record);
  });
  await page.reload();
  await proposal(page);
  const texts = [
    "I will compare the available reading notes.",
    "I suggest two short reading sessions each week.",
  ];
  for (const text of texts)
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  const toggle = page.locator(".work-history-toggle").first();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".history-reasoning").first()).toBeHidden();
  await toggle.click();
  await toggle.click();
  for (const text of texts)
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  await page.reload();
  await proposal(page);
  for (const text of texts)
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  expect(await turns(page)).toHaveLength(0);
});

test("a saved conversation draft returns after reload without a model request", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  const id = (await progress(page)).conversationId;
  await answer(page).fill("An unsent question about the proposal.");
  await expect
    .poll(
      async () =>
        (await conversations(page)).find(
          (item: { id: string }) => item.id === id,
        )?.draft,
    )
    .toBe("An unsent question about the proposal.");
  await page.reload();
  await proposal(page);
  await expect(answer(page)).toHaveValue(
    "An unsent question about the proposal.",
  );
  expect((await progress(page)).conversationId).toBe(id);
  expect(await turns(page)).toHaveLength(0);
});

test(
  "a progress durability error preserves the initial brief for explicit retry",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await onboardingFixture(page, {
      record: { ...newOnboardingRecord(), step: "method" },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const preferences = page.getByRole("textbox", {
      name: t("onboarding.conversation.preferences"),
      exact: true,
    });
    await expect(preferences).toBeVisible();
    await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").failNextProgressSave(),
    );
    await preferences.fill(brief.preferences);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(preferences).toHaveValue(brief.preferences);
    await visual.capture("onboarding.conversation.save-error");
    await page
      .getByRole("button", { name: t("onboarding.retry"), exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.reload();
    await expect(preferences).toHaveValue(brief.preferences);
    expect(await turns(page)).toHaveLength(0);
  },
);

test(
  "plugin ideas stay in chat and explicit commissions start before setup completion",
  { tag: "@visual-desktop" },
  async ({ page, visual }) => {
    await onboardingFixture(page, {
      record: { ...newOnboardingRecord(), step: "method", fresh: true },
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page
      .getByRole("button", {
        name: t("onboarding.conversation.start"),
        exact: true,
      })
      .click();
    await choice(page, t("onboardingAgent.choice.confirmFresh")).click();
    await expect(page.getByText("Reading view", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Review helper", { exact: true }),
    ).toBeVisible();
    await expect(dock(page)).toHaveCount(0);
    const id = (await progress(page)).conversationId;
    const developmentCalls = async () =>
      (await effects(page)).filter(
        (effect: { name: string }) =>
          effect.name === "start_plugin_development",
      );
    expect(await developmentCalls()).toHaveLength(0);
    await expect(
      choice(page, t("onboardingAgent.choice.finish")),
    ).toBeEnabled();
    await expect(page.locator(".setup-panel")).toHaveAttribute(
      "data-transition-phase",
      "idle",
    );
    await expect(page.locator(".setup-panel")).toHaveCSS("transform", "none");
    await page.mouse.move(0, 0);
    await page.locator(".transcript-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByText(/Situate can develop these additional tools as plugins/u),
    ).toBeInViewport({ ratio: 1 });
    await visual.capture(
      "onboarding.conversation.support-choice",
      svgColorRounding,
    );
    const composer = page.locator(".chat-pane textarea");
    await composer.fill("Develop the reading view.");
    await page
      .getByRole("button", { name: t("navigation.sendMessage"), exact: true })
      .click();
    await expect.poll(async () => (await developmentCalls()).length).toBe(1);
    await expect(
      choice(page, t("onboardingAgent.choice.finish")),
    ).toBeEnabled();
    const development = (await developmentCalls())[0];
    await expect
      .poll(async () =>
        (await conversations(page))
          .find(
            (item: { id: string }) =>
              item.id === development.input.developmentId,
          )
          ?.messages.some(
            (message: { role: string }) => message.role === "user",
          ),
      )
      .toBe(true);
    expect(await progress(page)).toMatchObject({
      step: "support",
      entered: false,
      conversationId: id,
      ideas: [],
    });
    await composer.fill("Save the review helper for later.");
    await page
      .getByRole("button", { name: t("navigation.sendMessage"), exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await effects(page)).filter(
            (effect: { name: string; input: { path?: string } }) =>
              effect.name === "write" &&
              effect.input.path === "Review helper idea.md",
          ).length,
      )
      .toBe(1);
    await expect(
      choice(page, t("onboardingAgent.choice.finish")),
    ).toBeEnabled();
    expect(await developmentCalls()).toHaveLength(1);
    await expect(
      page.getByText("I saved the review helper as a note for later.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: t("navigation.stopResponse"),
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(composer).toHaveValue("");
    await expect(page.locator(".setup-panel")).toHaveAttribute(
      "data-transition-phase",
      "idle",
    );
    await page.mouse.move(0, 0);
    await expect(page.locator(".setup-panel")).toHaveCSS("transform", "none");
    await visual.capture(
      "onboarding.conversation.support-final",
      svgColorRounding,
    );
    await choice(page, t("onboardingAgent.choice.finish")).click();
    await expect.poll(async () => (await progress(page)).step).toBe("complete");
    const finale = page.getByRole("button", {
      name: "Go to workspace",
      exact: true,
    });
    if (
      !(await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ))
    )
      await finale.click();
    await expect(page.locator(".topic-window")).toBeVisible();
    await expect(finale).toHaveCount(0);
    const navigation = page.getByRole("navigation", {
      name: t("navigation.workspaceNavigation"),
    });
    await expect(navigation.locator(".more-views")).toHaveCount(0);
    await expect(navigation.locator(".nav-destination")).toHaveText([
      t("navigation.files"),
    ]);
    expect(await developmentCalls()).toHaveLength(1);
    expect(
      (await calls(page)).some(
        (call: { command: string }) =>
          call.command === "onboarding_development_prepare",
      ),
    ).toBe(false);
    await page.reload();
    expect(
      (await effects(page)).some(
        (effect: { name: string }) =>
          effect.name === "start_plugin_development",
      ),
    ).toBe(false);
  },
);

test("a successful import explains optional plugins in chat without a review or selection gate and retains it on reload", async ({
  page,
}) => {
  await onboardingFixture(page, {
    importResult: true,
    importMissing: [],
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  await choice(page, t("onboardingAgent.choice.confirm")).click();
  await expect(page.getByText("Reading view", { exact: true })).toBeVisible();
  await expect(page.getByText("Review helper", { exact: true })).toBeVisible();
  await expect(dock(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({ step: "support", ideas: [] });
  const id = (await progress(page)).conversationId;
  const conversation = (await conversations(page)).find(
    (item: { id: string }) => item.id === id,
  );
  expect(
    conversation.runtime.events.filter(
      (event: { type: string; data: { context?: { action?: string } } }) =>
        event.type === "question_presented" &&
        event.data.context?.action === "import",
    ),
  ).toHaveLength(0);
  expect(
    conversation.runtime.events.filter(
      (event: { type: string }) => event.type === "question_answered",
    ),
  ).toHaveLength(1);
  expect(await turns(page)).toHaveLength(3);
  await page.reload();
  await expect(page.getByText("Reading view", { exact: true })).toBeVisible();
  await expect(dock(page)).toHaveCount(0);
  await expect(choice(page, t("onboardingAgent.choice.finish"))).toBeEnabled();
  expect([...(await turns(page)), ...(await effects(page))]).toHaveLength(0);
});

test("native conversation reads reject record payloads without altering retained state", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  const id = (await progress(page)).conversationId;
  const observed = await page.evaluate(async (id) => {
    const invoke = Reflect.get(window, "__TAURI_INTERNALS__").invoke;
    const before = await invoke("ai_conversation_read", {
      scope: "garden",
      conversation: id,
    });
    let rejected = false;
    try {
      await invoke("ai_conversation_read", {
        scope: "garden",
        conversation: id,
        record: { ...before, draft: "Unexpected replacement" },
      });
    } catch {
      rejected = true;
    }
    const after = await invoke("ai_conversation_read", {
      scope: "garden",
      conversation: id,
    });
    return { rejected, before, after };
  }, id);
  expect(observed.rejected).toBe(true);
  expect(observed.after).toEqual(observed.before);
});

test("duplicate native submission receipts do not repeat onboarding services", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  const before = await turns(page);
  const results = await effects(page);
  await page.evaluate(async () => {
    const fixture = Reflect.get(window, "__onboardingFixture");
    const submission = fixture.calls.find(
      (call: { command: string; args: { action?: { type: string } } }) =>
        call.command === "ai_conversation_action" &&
        call.args.action?.type === "submit",
    );
    await Reflect.get(window, "__TAURI_INTERNALS__").invoke(
      submission.command,
      submission.args,
    );
  });
  expect(await turns(page)).toEqual(before);
  expect(await effects(page)).toEqual(results);
});

test("native workspace cancellation drains a held import without publishing or replaying it", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: { ...newOnboardingRecord(), step: "method" },
    importResult: true,
    holdImportResponse: true,
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  await choice(page, t("onboardingAgent.choice.confirm")).click();
  await page.waitForFunction(
    () => typeof Reflect.get(window, "__finishImportResponse") === "function",
  );
  const id = (await progress(page)).conversationId;
  const stopped = await page.evaluate(async (id) => {
    await Reflect.get(window, "__TAURI_INTERNALS__").invoke(
      "ai_conversations_abort",
      { scope: "garden" },
    );
    Reflect.get(window, "__finishImportResponse")?.();
    return Reflect.get(window, "__nativeConversationFixture").snapshot(
      "garden",
      id,
    );
  }, id);
  expect(stopped).toMatchObject({ phase: "interrupted", taskActive: false });
  expect(
    (await effects(page)).filter(
      (effect: { name: string }) => effect.name === "show_imported_files",
    ),
  ).toHaveLength(0);
  expect((await progress(page)).step).toBe("sources");
  const previous = await turns(page);
  await page.reload();
  expect(await turns(page)).toHaveLength(0);
  expect(
    previous.filter((turn: { stage: string }) => turn.stage === "import"),
  ).toHaveLength(1);
  expect(
    (await effects(page)).filter(
      (effect: { name: string }) => effect.name === "show_imported_files",
    ),
  ).toHaveLength(0);
});

test("an interrupted confirmation retries its saved answer without a second instruction write", async ({
  page,
}) => {
  await onboardingFixture(page, {
    importResult: true,
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  const questionId = await dock(page)
    .locator("[data-question-id]")
    .getAttribute("data-question-id");
  await page.evaluate(() =>
    Reflect.get(window, "__onboardingFixture").failNextProgressSave(),
  );
  await choice(page, t("onboardingAgent.choice.confirm")).click();
  const retry = page
    .locator(".question-retry")
    .getByRole("button", { name: t("chatQuestion.retry"), exact: true });
  await expect(page.locator(".setup-panel")).not.toHaveAttribute("inert");
  await expect(retry).toBeVisible();
  const methodWrites = async () =>
    (await effects(page)).filter(
      (effect: { name: string }) => effect.name === "save_working_method",
    );
  expect(await methodWrites()).toHaveLength(1);
  const failure = page.getByRole("dialog");
  await expect(failure).toContainText(
    t("native.onboarding.storage.durability"),
  );
  await failure
    .getByRole("button", { name: t("settings.ai.dismiss"), exact: true })
    .click();
  await retry.click();
  await expect(
    dock(page).getByRole("button", {
      name: t("onboardingAgent.choice.support"),
      exact: true,
    }),
  ).toBeVisible();
  expect(await methodWrites()).toHaveLength(1);
  const id = (await progress(page)).conversationId;
  const retained = (await conversations(page)).find(
    (item: { id: string }) => item.id === id,
  );
  for (const type of ["question_answered", "question_action_completed"])
    expect(
      retained.runtime.events.filter(
        (event: { type: string; data: { questionId: string } }) =>
          event.type === type && event.data.questionId === questionId,
      ),
    ).toHaveLength(1);
});

test("restoring progress offers explicit question recovery without replaying a model turn", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: {
      ...newOnboardingRecord(),
      step: "proposal",
      conversationId: "restored-setup",
      proposal: "# Working instructions\n\nKeep existing folders.\n",
      sourceDescription: brief.sources,
    },
  });
  await page.goto("/");
  const recover = page.getByRole("button", {
    name: t("onboarding.conversation.recover"),
    exact: true,
  });
  await expect(recover).toBeVisible();
  await expect(dock(page)).toHaveCount(0);
  expect(await turns(page)).toHaveLength(0);
  await recover.click();
  await proposal(page);
  expect((await progress(page)).conversationId).toBe("restored-setup");
  expect(await turns(page)).toHaveLength(0);
});

for (const fresh of [false, true]) {
  test(`conversation feedback revises the source scope to fresh=${fresh} before confirmation`, async ({
    page,
  }) => {
    const revisedScope = {
      sourceDescription: fresh
        ? ""
        : "A replacement Markdown export containing only reading notes.",
      fresh,
      intent: "change" as const,
      description: "Keep reading notes separate from tasks.",
    };
    await onboardingFixture(page, {
      revisedScope,
      noIdeas: true,
      importResult: true,
      record: { ...newOnboardingRecord(), step: "method" },
    });
    await page.goto("/");
    await start(page);
    await proposal(page);
    const initial = await progress(page);
    const previousQuestionId = await dock(page)
      .locator("[data-question-id]")
      .getAttribute("data-question-id");
    const feedback = fresh
      ? "Do not bring over the exports. Start without importing anything and keep reading notes separate from tasks."
      : "Use only the replacement Markdown reading export instead, and keep reading notes separate from tasks.";
    await answer(page).fill(feedback);
    await dock(page)
      .getByRole("button", { name: t("navigation.sendMessage"), exact: true })
      .click();
    await expect(dock(page).locator("[data-question-id]")).not.toHaveAttribute(
      "data-question-id",
      previousQuestionId!,
    );
    const confirm = choice(
      page,
      t(
        fresh
          ? "onboardingAgent.choice.confirmFresh"
          : "onboardingAgent.choice.confirm",
      ),
    );
    await expect(confirm).toBeEnabled();
    expect(await progress(page)).toMatchObject({
      ...revisedScope,
      conversationId: initial.conversationId,
      step: "proposal",
      instructionRevision: null,
    });
    await expect(page.locator(".proposed-document")).toHaveCount(0);
    const retained = (await conversations(page)).find(
      (item: { id: string }) => item.id === initial.conversationId,
    );
    const currentQuestion = retained.runtime.events
      .filter((event: { type: string }) => event.type === "question_presented")
      .at(-1);
    expect(currentQuestion.data.context.record).toMatchObject(revisedScope);
    expect(await writes(page)).toHaveLength(0);
    await confirm.click();
    await expect(
      (fresh ? page : dock(page)).getByRole("button", {
        name: t(
          fresh
            ? "onboardingAgent.choice.finish"
            : "onboardingAgent.choice.support",
        ),
        exact: true,
      }),
    ).toBeVisible();
    expect(await progress(page)).toMatchObject({
      ...revisedScope,
      conversationId: initial.conversationId,
      step: fresh ? "support" : "sources",
    });
    expect((await progress(page)).instructionRevision).toBeTruthy();
    await expect
      .poll(async () => (await turns(page)).at(-1).context)
      .toMatchObject({
        preferences: revisedScope.description,
        sources: revisedScope.sourceDescription,
        fresh,
        intent: "change",
      });
  });
}

test("stale retained setup questions cannot confirm changed scope and recover explicitly without a model request", async ({
  page,
}) => {
  await onboardingFixture(page, {
    record: { ...newOnboardingRecord(), step: "method" },
  });
  await page.goto("/");
  await start(page);
  await proposal(page);
  const previousQuestionId = await dock(page)
    .locator("[data-question-id]")
    .getAttribute("data-question-id");
  const id = (await progress(page)).conversationId;
  const changedSources =
    "Only the synthetic archive export, not the original folder.";
  await page.evaluate(async (sourceDescription) => {
    const invoke = Reflect.get(window, "__TAURI_INTERNALS__").invoke;
    const saved = await invoke("onboarding_load", { scope: "garden" });
    await invoke("onboarding_save", {
      scope: "garden",
      expectedRevision: saved.revision,
      record: { ...saved.record, sourceDescription },
    });
  }, changedSources);
  await page.reload();
  await expect(dock(page).locator("[data-question-id]")).toHaveAttribute(
    "data-question-id",
    previousQuestionId!,
  );
  const before = (await conversations(page)).find(
    (item: { id: string }) => item.id === id,
  );
  await choice(page, t("onboardingAgent.choice.confirm")).click();
  const failure = page.getByRole("dialog");
  await expect(failure.getByRole("alert")).toContainText(
    t("chatQuestion.stale"),
  );
  await failure
    .getByRole("button", { name: t("settings.ai.dismiss"), exact: true })
    .click();
  expect((await progress(page)).instructionRevision).toBeNull();
  const rejected = (await conversations(page)).find(
    (item: { id: string }) => item.id === id,
  );
  expect(rejected.messages).toEqual(before.messages);
  expect(rejected.runtime.events).toEqual(before.runtime.events);
  expect(await turns(page)).toHaveLength(0);
  await page
    .getByRole("button", {
      name: t("onboarding.conversation.recover"),
      exact: true,
    })
    .click();
  await expect(dock(page).locator("[data-question-id]")).not.toHaveAttribute(
    "data-question-id",
    previousQuestionId!,
  );
  await proposal(page);
  const recovered = (await conversations(page)).find(
    (item: { id: string }) => item.id === id,
  );
  const shown = recovered.runtime.events.filter(
    (event: { type: string }) => event.type === "question_presented",
  );
  expect(shown.at(-1).data.context.record.sourceDescription).toBe(
    changedSources,
  );
  expect(shown.at(-1).data.context.record.conversationId).toBe(id);
  expect(recovered.messages).toEqual(before.messages);
  expect(await turns(page)).toHaveLength(0);
});

test("recovered proposal inspection shows retained bytes, not later .situate/working-method.md edits", async ({
  page,
}) => {
  const originalProposal =
    "# Original proposal\n\nKeep the synthetic reading folders.\n";
  const recoveredProposal =
    "# Current workspace rules\n\nReview synthetic notes on Thursday.\n";
  const laterInstructions =
    "# Later workspace rules\n\nA separate edit after recovery.\n";
  await onboardingFixture(page, {
    record: {
      ...newOnboardingRecord(),
      step: "proposal",
      conversationId: "recovered-instructions",
      entered: false,
      instructionRevision: null,
      proposal: originalProposal,
      sourceDescription: brief.sources,
    },
    files: [
      {
        path: ".situate/working-method.md",
        text: recoveredProposal,
        html: "<h1>Current workspace rules</h1><p>Review synthetic notes on Thursday.</p>",
      },
    ],
  });
  await page.goto("/");
  await page
    .getByRole("button", {
      name: t("onboarding.conversation.recover"),
      exact: true,
    })
    .click();
  await proposal(page);
  const current = await progress(page);
  expect(current).toMatchObject({
    proposal: recoveredProposal,
    instructionRevision: null,
  });
  expect(current.instructionBase.text).toBe(recoveredProposal);
  const retained = (await conversations(page)).find(
    (item: { id: string }) => item.id === current.conversationId,
  );
  const shown = retained.runtime.events.filter(
    (event: { type: string }) => event.type === "question_presented",
  );
  expect(
    shown.map(
      (event: { data: { context: { record: { proposal: string } } } }) =>
        event.data.context.record.proposal,
    ),
  ).toEqual([originalProposal, recoveredProposal]);
  await page.evaluate(async (text) => {
    const invoke = Reflect.get(window, "__TAURI_INTERNALS__").invoke;
    const read = await invoke("files_request", {
      request: {
        workspaceId: "garden",
        operation: "read",
        path: ".situate/working-method.md",
      },
    });
    await invoke("files_request", {
      request: {
        workspaceId: "garden",
        operation: "save",
        path: ".situate/working-method.md",
        text,
        base: read.document.version,
      },
    });
  }, laterInstructions);
  await page.reload();
  await expect(dock(page)).toBeVisible();
  const restored = (await conversations(page)).find(
    (item: { id: string }) => item.id === current.conversationId,
  );
  const preview = restored.runtime.events
    .filter((event: { type: string }) => event.type === "question_presented")
    .at(-1).data.preview;
  expect(preview.text).toBe(recoveredProposal);
  expect(preview.summary).toContain(brief.sources);
  expect(preview.summary).toContain(t("onboarding.conversation.help"));
  const writesBeforeInspection = (await writes(page)).length;
  await dock(page)
    .getByRole("button", { name: t("chatQuestion.viewDetails"), exact: true })
    .click();
  const reader = page.getByRole("dialog", {
    name: t("onboarding.proposal.file"),
    exact: true,
  });
  await expect(reader).toBeVisible();
  await expect(reader).toContainText(brief.sources);
  await expect(reader).toContainText(t("onboarding.conversation.help"));
  await expect(reader).toContainText("Review synthetic notes on Thursday.");
  await expect(reader).not.toContainText("A separate edit after recovery.");
  await expect(reader).not.toContainText("Keep the synthetic reading folders.");
  await expect(reader.locator("textarea")).toHaveCount(0);
  await reader
    .getByRole("button", { name: t("settings.ai.dismiss"), exact: true })
    .click();
  expect((await progress(page)).proposal).toBe(recoveredProposal);
  expect(await writes(page)).toHaveLength(writesBeforeInspection);
  expect(await turns(page)).toHaveLength(0);
});
