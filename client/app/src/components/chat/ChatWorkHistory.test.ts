import { afterEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, mount, flushPromises } from "@vue/test-utils";
import type { AssistantMessage, AgentMessage } from "../../ai/contracts";
import type { WorkBlock } from "../../ai/work-blocks";
import ChatTranscript from "./ChatTranscript.vue";
const response = (content: AssistantMessage["content"]): AssistantMessage => ({
  role: "assistant",
  content,
  timestamp: 1,
  stopReason: "stop",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());

test("folds reasoning and failed calls but never assistant text", async () => {
  const messages = [
    { role: "user" as const, content: "Read the notes", timestamp: 0 },
    response([
      { type: "thinking", thinking: "**Context**\n\nReview the notes." },
      {
        type: "text",
        text: "I will check the note.",
        textSignature: '{"v":1,"id":"comment","phase":"commentary"}',
      },
      { type: "text", text: "An ordinary unclassified message." },
      {
        type: "toolCall",
        id: "call",
        name: "read",
        arguments: { path: "Notes.md" },
      },
    ]),
    {
      role: "toolResult" as const,
      toolCallId: "call",
      toolName: "read",
      isError: true,
      timestamp: 2,
      content: [{ type: "text" as const, text: "Access denied" }],
    },
    response([{ type: "text", text: "Please choose another file." }]),
  ];
  const view = mount(ChatTranscript, {
    props: {
      messages,
      activity: [],
      running: false,
      scope: "test",
      workBlocks: [
        {
          id: "work",
          startMessageCount: 0,
          messageCount: 4,
          durationMs: 12000,
          outcome: "error",
        },
      ],
    },
  });
  const button = view.get(".work-history-toggle");
  expect(button.attributes("aria-expanded")).toBe("false");
  const details = view.findAll<HTMLElement>(".history-detail");
  expect(details).toHaveLength(2);
  expect(details.every((detail) => detail.element.hidden)).toBe(true);
  expect(
    view
      .findAll<HTMLElement>(".history-segment:not(.history-detail)")
      .every((segment) => !segment.element.hidden),
  ).toBe(true);
  expect(
    view.findAll(".message.assistant").map((message) => message.text()),
  ).toEqual([
    "⟦navigation.ai⟧I will check the note.An ordinary unclassified message.",
    "⟦navigation.ai⟧Please choose another file.",
  ]);
  expect(view.find(".response-stopped, .reasoning, .activity").exists()).toBe(
    false,
  );
  await button.trigger("click");
  expect(details.every((detail) => !detail.element.hidden)).toBe(true);
  await flushPromises();
  expect(view.get(".history-reasoning strong").text()).toBe("Context");
  expect(view.get(".history-tools summary").text()).toContain("⟦chat.failed⟧");
  expect(view.get(".call-details summary").text()).toContain("Notes.md");
  expect(view.get(".tool-identifier").text()).toBe("read");
  expect(view.get(".tool-content").text()).toContain("Access denied");
});

test("retains deliberate inspection and timer across updates, then freezes at recorded completion", async () => {
  vi.useFakeTimers();
  const messages = [
    response([
      { type: "thinking", thinking: "Check the timing." },
      {
        type: "text",
        text: "I will prepare a plan.",
        textSignature: '{"v":1,"id":"p","phase":"commentary"}',
      },
    ]),
  ];
  const view = mount(ChatTranscript, {
    props: {
      messages,
      activity: [],
      running: true,
      scope: "test",
      activeWork: {
        id: "work",
        startMessageCount: 0,
        startedAt: performance.now(),
      },
    },
  });
  expect(view.get('[role="timer"]').text()).toBe("0:00");
  expect(view.get('[role="timer"]').attributes("aria-live")).toBe("off");
  expect(
    view
      .findAll<HTMLElement>(".history-segment")
      .map((segment) => segment.element.hidden),
  ).toEqual([true, false]);
  await vi.advanceTimersByTimeAsync(3000);
  expect(view.get('[role="timer"]').text()).toBe("0:03");
  await view.get(".work-history-toggle").trigger("click");
  await view.setProps({
    running: false,
    activeWork: undefined,
    workBlocks: [
      {
        id: "work",
        startMessageCount: 0,
        messageCount: 1,
        durationMs: 3000,
        outcome: "cancelled",
      },
    ],
  });
  expect(view.find('[role="timer"]').exists()).toBe(false);
  expect(view.get(".work-history-toggle").attributes("aria-expanded")).toBe(
    "true",
  );
  expect(
    view
      .findAll<HTMLElement>(".history-detail")
      .every((segment) => !segment.element.hidden),
  ).toBe(true);
  expect(view.get(".duration").text()).toContain("⟦chat.workStopped");
  const completed = view.get(".work-history-heading .duration").text();
  await vi.advanceTimersByTimeAsync(60000);
  await view.setProps({ messages: [...messages] });
  expect(view.findAll(".duration")).toHaveLength(1);
  expect(view.get(".work-history-heading .duration").text()).toBe(completed);
  const retained = view.props();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  const reopened = mount(ChatTranscript, { props: retained });
  expect(reopened.get(".work-history-heading .duration").text()).toBe(
    completed,
  );
  expect(reopened.find('[role="timer"]').exists()).toBe(false);
});

test("unknown interruption durations render an outcome without an invented time", () => {
  const view = mount(ChatTranscript, {
    props: {
      messages: [],
      activity: [],
      running: false,
      scope: "test",
      workBlocks: [
        {
          id: "unknown",
          startMessageCount: 5,
          messageCount: 8,
          outcome: "interrupted",
        },
      ],
    },
  });
  expect(view.get(".duration").text()).toBe("⟦chat.interrupted⟧");
  expect(view.find(".work-history-clock, .work-history-toggle").exists()).toBe(
    false,
  );
});
test.each(["commentary", "final_answer", undefined])(
  "keeps the response accompanying a question visible with phase %s",
  async (phase) => {
    const messages = [
      response([
        { type: "thinking", thinking: "Compare the available notes." },
        {
          type: "text",
          text: "The reading plan is ready. Shall I save it?",
          ...(phase
            ? { textSignature: JSON.stringify({ v: 1, id: "decision", phase }) }
            : {}),
        },
        {
          type: "toolCall",
          id: "question",
          name: "ask_question",
          arguments: { prompt: "Save the plan?", suggestions: [] },
        },
      ]),
    ];
    const props = {
      messages,
      activity: [],
      running: false,
      scope: "test",
      workBlocks: [
        {
          id: "work",
          startMessageCount: 0,
          messageCount: 1,
          durationMs: 44000,
          outcome: "complete" as const,
        },
      ],
    };
    const view = mount(ChatTranscript, { props });
    await flushPromises();
    const responseText = view.get(".message.assistant");
    expect(responseText.text()).toContain("The reading plan is ready.");
    expect(responseText.element.closest("[hidden]")).toBeNull();
    expect(view.get(".work-history-toggle").attributes("aria-expanded")).toBe(
      "false",
    );
    await view.get(".work-history-toggle").trigger("click");
    await view.get(".work-history-toggle").trigger("click");
    expect(responseText.element.closest("[hidden]")).toBeNull();
    await view.setProps({
      messages: [
        ...messages,
        {
          role: "toolResult",
          toolCallId: "question",
          toolName: "ask_question",
          timestamp: 2,
          isError: false,
          content: [{ type: "text", text: "Save it" }],
        },
      ],
    });
    expect(
      view.get(".message.assistant").element.closest("[hidden]"),
    ).toBeNull();
    expect(view.findAll(".duration")).toHaveLength(1);
    expect(view.get(".work-history-heading .duration").text()).toContain(
      "⟦chat.workDuration",
    );
    view.unmount();
    const reopened = mount(ChatTranscript, { props });
    await flushPromises();
    expect(
      reopened.get(".message.assistant").element.closest("[hidden]"),
    ).toBeNull();
    expect(reopened.get(".work-history-heading .duration").text()).toContain(
      "⟦chat.workDuration",
    );
  },
);

test.each(["complete", "cancelled", "error", "interrupted"] as const)(
  "keeps streamed text in place across tools, phase updates and %s",
  async (outcome) => {
    const first = response([{ type: "text", text: "I will check" }]);
    const messages: AgentMessage[] = [
      { role: "user", content: "Prepare a reading plan", timestamp: 0 },
      first,
    ];
    const view = mount(ChatTranscript, {
      props: {
        messages: [...messages],
        activity: [],
        running: true,
        scope: "test",
        activeWork: { id: "work", startMessageCount: 0, startedAt: 0 },
      },
    });
    await flushPromises();
    const opening = view.get(".message.assistant").element;
    expect(view.get(".message.assistant").text()).toContain("I will check");
    expect(opening.closest("[hidden]")).toBeNull();
    for (const [index, text] of [
      "I will check the notes.",
      "Two short reading sessions would fit.",
    ].entries()) {
      const previousNodes = view
        .findAll(".message.assistant")
        .map((entry) => entry.element);
      const message = messages.at(-1) as AssistantMessage;
      message.content = message.content.map((part) =>
        part.type === "text"
          ? {
              ...part,
              text,
              textSignature: JSON.stringify({
                v: 1,
                id: `text-${index}`,
                phase: "commentary",
              }),
            }
          : part,
      );
      message.content.push({
        type: "toolCall",
        id: `read-${index}`,
        name: "read",
        arguments: { path: "Reading.md" },
      });
      await view.setProps({ messages: structuredClone(messages) });
      view.findAll(".message.assistant").forEach((entry, index) => {
        expect(entry.element).toBe(previousNodes[index]);
      });
      await flushPromises();
      expect(view.findAll(".message.assistant").at(-1)!.text()).toContain(text);
      messages.push({
        role: "toolResult",
        toolCallId: `read-${index}`,
        toolName: "read",
        content: [],
        isError: false,
        timestamp: index + 2,
      });
      messages.push(
        response(
          index === 0
            ? [
                { type: "thinking", thinking: "Compare the available times." },
                { type: "text", text: "Two short reading sessions would fit." },
              ]
            : [{ type: "text", text: "The reading plan is ready." }],
        ),
      );
      await view.setProps({ messages: structuredClone(messages) });
    }
    await flushPromises();
    const nodes = view
      .findAll(".message.assistant")
      .map((entry) => entry.element);
    expect(nodes[0]).toBe(opening);
    expect(nodes).toHaveLength(3);
    const work: WorkBlock = {
      id: "work",
      startMessageCount: 0,
      messageCount: messages.length,
      durationMs: 1000,
      outcome,
    };
    await view.setProps({
      running: false,
      activeWork: undefined,
      workBlocks: [work],
      ...(outcome === "error"
        ? { workError: "native.ai.response.interrupted" }
        : {}),
    });
    for (let toggle = 0; toggle < 3; toggle++) {
      view.findAll(".message.assistant").forEach((entry, index) => {
        expect(entry.element).toBe(nodes[index]);
      });
      expect(nodes.every((node) => !node.closest("[hidden]"))).toBe(true);
      await view.get(".work-history-toggle").trigger("click");
    }
    if (outcome === "error")
      expect(
        view.get(".history-failure").element.closest("[hidden]"),
      ).toBeNull();
    expect(view.findAll(".duration")).toHaveLength(1);
    const props = view.props();
    view.unmount();
    const reopened = mount(ChatTranscript, { props });
    await flushPromises();
    expect(
      reopened.findAll(".message.assistant").map((entry) => entry.text()),
    ).toEqual([
      "⟦navigation.ai⟧I will check the notes.",
      "⟦navigation.ai⟧Two short reading sessions would fit.",
      "⟦navigation.ai⟧The reading plan is ready.",
    ]);
    expect(
      reopened
        .findAll(".history-detail")
        .every((entry) => entry.attributes("hidden") !== undefined),
    ).toBe(true);
    expect(
      reopened
        .findAll(".message.assistant")
        .every((entry) => !entry.element.closest("[hidden]")),
    ).toBe(true);
  },
);

test("counts unique paths and keeps host-provided provenance only on its call", async () => {
  const messages = [
    response([
      {
        type: "toolCall",
        id: "one",
        name: "read",
        arguments: { path: "Notes.md" },
      },
      {
        type: "toolCall",
        id: "two",
        name: "read",
        arguments: { path: "Notes.md", offset: 100 },
      },
      { type: "toolCall", id: "plugin", name: "books_read", arguments: {} },
    ]),
    ...["one", "two", "plugin"].map((id, index) => ({
      role: "toolResult" as const,
      toolCallId: id,
      toolName: id === "plugin" ? "books_read" : "read",
      content: [],
      isError: false,
      timestamp: index + 2,
    })),
  ];
  const view = mount(ChatTranscript, {
    props: {
      messages,
      running: false,
      scope: "test",
      activity: [
        {
          id: "plugin",
          messageIndex: 0,
          runId: "r",
          name: "books_read",
          args: {},
          state: "completed",
          pluginId: "books",
          pluginName: "Book shelf",
        },
      ],
      workBlocks: [
        {
          id: "work",
          startMessageCount: 0,
          messageCount: 4,
          durationMs: 1000,
          outcome: "complete",
        },
      ],
    },
  });
  expect(view.get(".work-history-heading").text()).not.toContain("Book shelf");
  expect(
    view
      .findAll<HTMLElement>(".history-detail")
      .every((segment) => segment.element.hidden),
  ).toBe(true);
  await view.get(".work-history-toggle").trigger("click");
  const groups = view.findAll("details.history-tools");
  expect(groups[0].get("summary").text()).toBe("⟦chat.historyReadFile⟧");
  expect(view.findAll(".plugin-name")).toHaveLength(1);
  expect(view.get(".plugin-name").text()).toContain("Book shelf");
  expect(
    view
      .get(".plugin-name")
      .element.closest(".call-details")!
      .getAttribute("open"),
  ).toBeNull();
});
