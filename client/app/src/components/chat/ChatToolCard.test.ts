import { afterEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, mount, flushPromises } from "@vue/test-utils";
const files = vi.hoisted(() => vi.fn());
vi.mock("../../files/api", () => ({ filesRequest: files }));
import ChatToolCard from "./ChatToolCard.vue";
import ChatTranscript from "./ChatTranscript.vue";
import { initialFormats, setPreferences } from "@situate/localization";
import type { AssistantMessage, ToolResultMessage } from "../../ai/contracts";

enableAutoUnmount(afterEach);

test("keeps working-method tool details collapsed without presenting a file to review", () => {
  const wrapper = mount(ChatToolCard, {
    props: {
      scope: "workspace",
      call: {
        key: "proposal",
        id: "proposal",
        name: "propose_working_method",
        state: "completed",
        args: { markdown: "# Working method\nKeep the project folders." },
      },
    },
  });
  expect(wrapper.find(".proposed-document").exists()).toBe(false);
  expect(wrapper.get("details").attributes("open")).toBeUndefined();
  expect(wrapper.find(".change-saved").exists()).toBe(false);
});
const reply: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Done" }],
  timestamp: 10000,
  stopReason: "stop",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};
const tool: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "call",
  toolName: "read",
  content: [],
  isError: false,
  timestamp: 20000,
};

test.each([
  ["en", "Worked for 1 min 24 sec"],
  ["de", "1 Min. 24 Sek. gearbeitet"],
] as const)(
  "shows one localized work-block duration instead of response or tool times (%s)",
  (language, duration) => {
    Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
    setPreferences({ language, formats: initialFormats(language) });
    const wrapper = mount(ChatTranscript, {
      props: {
        scope: "workspace",
        running: false,
        activity: [],
        workBlocks: [
          {
            id: "work",
            messageCount: 2,
            durationMs: 84000,
            outcome: "complete",
          },
        ],
        messages: [
          { ...reply, durationMs: 1234 },
          { ...tool, durationMs: 0 },
        ],
      },
    });
    expect(wrapper.findAll(".duration").map((node) => node.text())).toEqual([
      duration,
    ]);
  },
);

test("660 imported files use bounded lists and load only the selected snapshot", async () => {
  files.mockReset().mockImplementation(async ({ path, revision }) => ({
    status: "ok",
    document: { version: { revision, text: `# Saved ${path}` } },
  }));
  const messages: (AssistantMessage | ToolResultMessage)[] = [];
  for (let batch = 0; batch < 3; batch++) {
    const id = `batch-${batch}`;
    messages.push(
      {
        ...reply,
        content: [
          {
            type: "toolCall",
            id,
            name: "create_batch",
            arguments: { manifestPath: `.situate/${id}.jsonl` },
          },
        ],
      },
      {
        ...tool,
        toolCallId: id,
        toolName: "create_batch",
        content: [
          { type: "text", text: "Synthetic tool output with file details" },
        ],
        details: {
          historyRevision: "c".repeat(40),
          files: Array.from({ length: 220 }, (_, file) => ({
            path: `batch-${batch}/note-${file}.md`,
            revision: "a".repeat(40),
          })),
        },
      },
    );
  }
  messages.push(reply);
  const wrapper = mount(ChatTranscript, {
    props: { scope: "workspace", running: false, activity: [], messages },
  });
  await flushPromises();
  expect(files).not.toHaveBeenCalled();
  expect(wrapper.find(".change-path").exists()).toBe(false);
  expect(wrapper.find(".change-added").exists()).toBe(false);
  expect(wrapper.find(".tool-content").exists()).toBe(false);
  expect(wrapper.get(".message.assistant").text()).toContain("Done");
  const disclosures = wrapper.findAll<HTMLDetailsElement>(
    "details.call-details",
  );
  expect(disclosures).toHaveLength(3);
  expect(disclosures.every((node) => !node.element.open)).toBe(true);
  expect(disclosures[0]!.get("summary").text()).toContain(
    '⟦files.countMany:{"count":220}⟧',
  );
  expect(disclosures[0]!.get("summary").text()).toContain("⟦chat.completed⟧");

  disclosures[0]!.element.open = true;
  await disclosures[0]!.trigger("toggle");
  await flushPromises();
  expect(files).not.toHaveBeenCalled();
  expect(disclosures[0]!.findAll(".batch-file")).toHaveLength(10);
  expect(wrapper.find(".change-added").exists()).toBe(false);
  expect(wrapper.find(".tool-content").exists()).toBe(false);
  await disclosures[0]!.get(".batch-more").trigger("click");
  expect(disclosures[0]!.findAll(".batch-file")).toHaveLength(20);
  expect(files).not.toHaveBeenCalled();
  await disclosures[0]!.get(".batch-file").trigger("click");
  await flushPromises();
  expect(files).toHaveBeenCalledTimes(1);
  expect(files).toHaveBeenCalledWith({
    workspaceId: "workspace",
    operation: "revision",
    path: "batch-0/note-0.md",
    revision: "c".repeat(40),
    exactPath: true,
  });
  expect(wrapper.findAll(".change-path")).toHaveLength(1);
  expect(disclosures[0]!.get(".change-added pre").text()).toBe(
    "# Saved batch-0/note-0.md",
  );
  expect(disclosures[1]!.find(".change-path").exists()).toBe(false);
  const technical = disclosures[0]!.get<HTMLDetailsElement>(
    "details.batch-technical",
  );
  technical.element.open = true;
  await technical.trigger("toggle");
  expect(technical.text()).toContain("Synthetic tool output with file details");
  disclosures[0]!.element.open = false;
  await disclosures[0]!.trigger("toggle");
  expect(wrapper.find(".change-added").exists()).toBe(false);
  expect(wrapper.find(".tool-content").exists()).toBe(false);
  expect(wrapper.get(".message.assistant").text()).toContain("Done");
});

test("ordinary note writes keep their confirmed content visible outside tool details", () => {
  const wrapper = mount(ChatToolCard, {
    props: {
      scope: "workspace",
      call: {
        key: "write",
        id: "write",
        name: "write",
        state: "completed",
        result: {
          ...tool,
          toolName: "write",
          details: {
            change: {
              path: "Garden.md",
              before: null,
              after: "# Garden notes",
              beforeRevision: null,
              afterRevision: "a".repeat(40),
            },
          },
        },
      },
    },
  });
  expect(wrapper.get(".change-added pre").text()).toBe("# Garden notes");
  expect(wrapper.get(".change-added").element.closest("details")).toBeNull();
  expect(
    wrapper.get<HTMLDetailsElement>("details.call-details").element.open,
  ).toBe(false);
});

test("partial import previews reject intervening content instead of displaying it as the saved write", async () => {
  files.mockReset().mockResolvedValue({
    status: "ok",
    document: {
      version: { revision: "b".repeat(40), text: "Intervening edit" },
    },
  });
  const wrapper = mount(ChatToolCard, {
    props: {
      scope: "workspace",
      call: {
        key: "batch",
        id: "batch",
        name: "create_batch",
        state: "failed",
        result: {
          ...tool,
          isError: true,
          details: {
            files: [{ path: "A.md", revision: "a".repeat(40) }],
            historyRevision: null,
          },
        },
      },
    },
  });
  expect(wrapper.get("summary").text()).toContain("⟦chat.failed⟧");
  expect(files).not.toHaveBeenCalled();
  const disclosure = wrapper.get<HTMLDetailsElement>("details.call-details");
  disclosure.element.open = true;
  await disclosure.trigger("toggle");
  await wrapper.get(".batch-file").trigger("click");
  await flushPromises();
  expect(files).toHaveBeenCalledWith({
    workspaceId: "workspace",
    operation: "read",
    path: "A.md",
  });
  expect(wrapper.find(".change-added").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("Intervening edit");
  expect(wrapper.text()).toContain("⟦chat.importChangeUnavailable⟧");
});

test("stable batch results do not reload snapshots on transcript refresh", async () => {
  files.mockReset().mockResolvedValue({
    status: "ok",
    document: { version: { revision: "c".repeat(40), text: "# Saved" } },
  });
  const call = {
    key: "batch",
    id: "batch",
    name: "create_batch",
    state: "completed",
    result: {
      ...tool,
      details: {
        files: [{ path: "A.md", revision: "a".repeat(40) }],
        historyRevision: "c".repeat(40),
      },
    },
  };
  const wrapper = mount(ChatToolCard, { props: { scope: "workspace", call } });
  const disclosure = wrapper.get<HTMLDetailsElement>("details.call-details");
  disclosure.element.open = true;
  await disclosure.trigger("toggle");
  await wrapper.get(".batch-file").trigger("click");
  await flushPromises();
  await wrapper.setProps({ call: structuredClone(call) });
  await flushPromises();
  expect(files).toHaveBeenCalledTimes(1);
  expect(wrapper.get(".change-added pre").text()).toBe("# Saved");
});

test("closing a batch preview stops further reads and discards late results", async () => {
  let finish!: (value: unknown) => void;
  files.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = mount(ChatToolCard, {
    props: {
      scope: "workspace",
      call: {
        key: "batch",
        id: "batch",
        name: "create_batch",
        state: "completed",
        result: {
          ...tool,
          details: {
            files: [
              { path: "A.md", revision: "a".repeat(40) },
              { path: "B.md", revision: "b".repeat(40) },
            ],
            historyRevision: "c".repeat(40),
          },
        },
      },
    },
  });
  const disclosure = wrapper.get<HTMLDetailsElement>("details.call-details");
  disclosure.element.open = true;
  await disclosure.trigger("toggle");
  await wrapper.get(".batch-file").trigger("click");
  expect(files).toHaveBeenCalledTimes(1);
  disclosure.element.open = false;
  await disclosure.trigger("toggle");
  finish({
    status: "ok",
    document: { version: { revision: "c".repeat(40), text: "# Saved" } },
  });
  await flushPromises();
  expect(files).toHaveBeenCalledTimes(1);
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(wrapper.find(".change-added").exists()).toBe(false);
});

test("reasoning and tool details share a retained outer work-history disclosure", async () => {
  const wrapper = mount(ChatTranscript, {
    props: {
      scope: "workspace",
      running: false,
      activity: [],
      messages: [
        {
          ...reply,
          content: [{ type: "thinking", thinking: "Review the garden notes" }],
        },
        tool,
      ],
    },
  });
  const history = wrapper.get(".work-history-toggle");
  const reasoning = wrapper.get(".history-reasoning");
  const activity = wrapper.get<HTMLDetailsElement>("details.history-tools");
  expect(activity.classes()).toContain("situate-disclosure");
  expect(history.attributes("aria-expanded")).toBe("false");
  expect(reasoning.element.parentElement!.hidden).toBe(true);
  await history.trigger("click");
  await wrapper.setProps({ running: true });
  expect(history.attributes("aria-expanded")).toBe("true");
  expect(activity.element.open).toBe(false);
  expect(reasoning.text()).toBe("Review the garden notes");
  expect(activity.get(".call-details").classes()).toContain(
    "situate-disclosure",
  );
});

test("live tool output stays textual as its disclosure remains open", async () => {
  const call = {
    key: "call",
    id: "call",
    name: "read",
    state: "running",
    progress: { message: "Reading garden notes" },
  };
  const wrapper = mount(ChatToolCard, { props: { scope: "workspace", call } });
  const disclosure = wrapper.get<HTMLDetailsElement>("details.call-details");
  expect(disclosure.classes()).toContain("situate-disclosure");
  disclosure.element.open = true;
  await disclosure.trigger("toggle");
  await wrapper.setProps({
    call: { ...call, progress: { message: "Reading another note" } },
  });
  expect(disclosure.element.open).toBe(true);
  expect(wrapper.get(".tool-state").text()).toBe("⟦chat.running⟧");
  expect(wrapper.get(".tool-content pre").text()).toBe(
    '{\n  "message": "Reading another note"\n}',
  );
  expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
});

test("old responses and unexecuted tools do not acquire inferred durations", () => {
  const wrapper = mount(ChatTranscript, {
    props: {
      scope: "workspace",
      running: false,
      activity: [],
      messages: [reply, { ...tool, isError: true }],
    },
  });
  expect(wrapper.find(".duration").exists()).toBe(false);
});

test.each([
  [true, "ai.responseStopped", "⟦ai.responseStopped⟧"],
  [true, "Command returned exit code 2", "Command returned exit code 2"],
  [false, "ai.responseStopped", "ai.responseStopped"],
])(
  "renders tool error text without changing ordinary output (%s, %s)",
  (isError, text, expected) => {
    const wrapper = mount(ChatToolCard, {
      props: {
        scope: "workspace",
        call: {
          key: "call",
          id: "call",
          name: "ls",
          args: {},
          state: isError ? "failed" : "completed",
          result: {
            role: "toolResult",
            toolCallId: "call",
            toolName: "ls",
            timestamp: 1,
            isError,
            content: [{ type: "text", text }],
          },
        },
      },
    });
    expect(wrapper.findAll(".tool-content pre").at(-1)?.text()).toBe(expected);
  },
);
