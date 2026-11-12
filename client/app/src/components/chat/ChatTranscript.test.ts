import { afterEach, expect, test } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import ChatTranscript from "./ChatTranscript.vue";
import ChatSystemAnnouncement from "./ChatSystemAnnouncement.vue";
import type { PluginNotice } from "../../ai/plugin-notices";
import type { AssistantMessage } from "../../ai/contracts";

function response(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: 2,
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
}
enableAutoUnmount(afterEach);
const notice: PluginNotice = {
  id: "one",
  pluginName: "Reading list",
  timestamp: 3,
};
function transcript(notices: PluginNotice[] = [], announcement?: PluginNotice) {
  return mount(ChatTranscript, {
    props: {
      messages: [],
      activity: [],
      running: false,
      scope: "workspace",
      notices,
      announcement,
    },
  });
}
test("answered questions stay readable beside the accepted answer with no active controls", async () => {
  const wrapper = transcript();
  await wrapper.setProps({
    questions: [
      {
        id: "q",
        prompt: "Where?",
        status: "answered",
        timestamp: 1,
        answer: { text: "Home" },
        suggestions: [{ id: "home", label: "Home" }],
      },
    ],
    messages: [{ role: "user", content: "Home", timestamp: 2 }],
  });
  expect(wrapper.get(".retained-question").text()).toBe("Where?");
  expect(wrapper.get(".message.user").text()).toContain("Home");
  expect(wrapper.find(".question-options").exists()).toBe(false);
  expect(wrapper.get("[role=status]").text()).toBe("");
});

test.each([true, false])(
  "a stopped response has only its work-history status (text: %s)",
  async (withText) => {
    const wrapper = transcript();
    const stopped = response("Partial answer");
    stopped.stopReason = "aborted";
    if (!withText) stopped.content = [];
    await wrapper.setProps({ messages: [stopped] });
    expect(wrapper.get(".work-history-time").text()).toBe(
      "⟦chat.stoppedState⟧",
    );
    expect(wrapper.find(".response-stopped").exists()).toBe(false);
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
    expect(wrapper.find("dialog").exists()).toBe(false);

    expect(wrapper.find(".message.assistant").exists()).toBe(withText);
    if (withText)
      expect(wrapper.get(".assistant").text()).toContain("Partial answer");
    await wrapper.setProps({
      messages: [stopped, response("Next answer")],
    });
    expect(wrapper.findAll(".work-history-time")).toHaveLength(1);
    expect(wrapper.findAll(".assistant").at(-1)?.text()).toContain(
      "Next answer",
    );
  },
);

test("an empty conversation retains only its silent live region", () => {
  const wrapper = transcript();
  expect(wrapper.find(".messages").exists()).toBe(false);
  expect(wrapper.get("[role=status]").text()).toBe("");
});
test("restored notices are discreet system notes, never assistant messages or live announcements", async () => {
  const wrapper = transcript([notice], notice);
  await flushPromises();
  expect(wrapper.get("[role=note]").attributes("aria-label")).toBe(
    "⟦chat.systemNotice⟧",
  );
  expect(wrapper.get("[role=note]").text()).toContain("⟦chat.pluginAvailable");
  expect(wrapper.find("article, button, .assistant, .message").exists()).toBe(
    false,
  );
  expect(wrapper.get("[role=status]").text()).toBe("");
  await wrapper.setProps({ notices: [notice, { ...notice, id: "restored" }] });
  expect(wrapper.findAll("[role=note]")).toHaveLength(2);
  expect(wrapper.get("[role=status]").text()).toBe("");
});
test("a new notice is announced once, independently from history hydration", async () => {
  const wrapper = transcript();
  await wrapper.setProps({ notices: [notice] });
  expect(wrapper.get("[role=status]").text()).toBe("");
  await wrapper.setProps({ announcement: notice });
  await flushPromises();
  expect(wrapper.get("[role=status]").text()).toContain(
    "⟦chat.pluginAvailable",
  );
  await wrapper.setProps({ announcement: undefined });
  await flushPromises();
  await wrapper.setProps({ announcement: { ...notice } });
  await flushPromises();
  expect(wrapper.get("[role=status]").text()).toBe("");
});
test("distinct identities with identical announcement text clear and redeliver the polite region", async () => {
  const wrapper = mount(ChatSystemAnnouncement, {
    props: { message: "Reading list is available" },
  });
  await wrapper.setProps({ id: "one" });
  await flushPromises();
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) =>
    mutations.push(...records),
  );
  observer.observe(wrapper.element, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
  });
  await wrapper.setProps({ id: "two" });
  await flushPromises();
  observer.disconnect();
  expect(wrapper.text()).toBe("Reading list is available");
  expect(
    mutations.some(
      (record) => record.type === "childList" && record.addedNodes.length === 0,
    ),
  ).toBe(true);
  expect(
    mutations.some((record) =>
      [...record.addedNodes].some(
        (node) => node.textContent === "Reading list is available",
      ),
    ),
  ).toBe(true);
  expect(wrapper.attributes()).toMatchObject({
    "aria-live": "polite",
    "aria-atomic": "true",
  });
});
test("rapid changes and disposal cannot deliver superseded announcements", async () => {
  const wrapper = mount(ChatSystemAnnouncement, { props: { message: "" } });
  const first = wrapper.setProps({ id: "first", message: "Obsolete" });
  const second = wrapper.setProps({ id: "second", message: "Current" });
  await Promise.all([first, second]);
  await flushPromises();
  expect(wrapper.text()).toBe("Current");
  const element = wrapper.element;
  const pending = wrapper.setProps({ id: "third", message: "Disposed" });
  wrapper.unmount();
  await pending;
  await flushPromises();
  expect(element.textContent).not.toBe("Disposed");
});
test("assistant Markdown renders during streaming and keeps formatting when completed", async () => {
  const wrapper = transcript();
  await wrapper.setProps({
    messages: [response("**Important")],
    running: true,
  });
  await expect
    .poll(() => wrapper.find(".assistant strong:not(.sr-only)").text())
    .toBe("Important");
  await wrapper.setProps({
    messages: [
      response("**Important**\n\n- First\n- Second\n\n```ts\nconst count = 1;"),
    ],
  });
  await expect.poll(() => wrapper.findAll(".assistant li").length).toBe(2);
  await expect
    .poll(() => wrapper.find(".assistant pre").text())
    .toContain("const count = 1;");
  await wrapper.setProps({
    messages: [
      response(
        "**Important**\n\n- First\n- Second\n\n```ts\nconst count = 1;\n```",
      ),
    ],
    running: false,
  });
  await expect
    .poll(() => wrapper.find(".assistant pre").text())
    .toContain("const count = 1;");
  expect(wrapper.get(".assistant strong:not(.sr-only)").text()).toBe(
    "Important",
  );
});

test("model Markdown cannot create executable HTML, unsafe links or remote images", async () => {
  const wrapper = transcript();
  await wrapper.setProps({
    messages: [
      response(
        '<script>alert(1)</script>\n\n<img src="https://example.invalid/pixel" onerror="alert(1)">\n\n[Unsafe](javascript:alert(1))\n\n![Pixel](https://example.invalid/pixel)\n\n[Safe](https://example.org)',
      ),
    ],
  });
  await expect
    .poll(() =>
      wrapper.find(".assistant a[href='https://example.org']").exists(),
    )
    .toBe(true);
  expect(
    wrapper
      .find(
        ".assistant script, .assistant img, .assistant [onerror], .assistant a[href^='javascript:']",
      )
      .exists(),
  ).toBe(false);
});

test("presented user attachments keep image references and text content visible", () => {
  const wrapper = mount(ChatTranscript, {
    props: {
      messages: [
        {
          role: "user",
          timestamp: 1,
          content: [
            { type: "text", text: "Request" },
            {
              type: "image",
              mimeType: "image/png",
              data: `attachment:${"a".repeat(48)}`,
            },
            { type: "text", text: "note.txt\nAttached text" },
          ],
        },
      ],
      activity: [],
      running: false,
      scope: "workspace",
    },
  });
  expect(wrapper.find(".message.user .chat-image").exists()).toBe(true);
  expect(wrapper.get(".message.user").text()).toContain("note.txt");
  expect(wrapper.get(".message.user").text()).toContain("Attached text");
});

test("older history is requested explicitly and the loading control cannot repeat it", async () => {
  const wrapper = mount(ChatTranscript, {
    props: {
      messages: [{ role: "user", content: "Recent", timestamp: 1 }],
      activity: [],
      running: false,
      scope: "workspace",
      historyBefore: "entry",
      messageOffset: 20,
    },
  });
  expect(wrapper.emitted("loadOlder")).toBeUndefined();
  const button = wrapper.get("button[data-chat-disclosure]");
  expect(button.text()).toBe("⟦chat.loadEarlierMessages⟧");
  await button.trigger("click");
  expect(wrapper.emitted("loadOlder")).toEqual([[]]);
  await wrapper.setProps({ historyLoading: true });
  expect(button.attributes("disabled")).toBeDefined();
  expect(button.text()).toBe("⟦chat.loadingEarlierMessages⟧");
  const recent = wrapper.get(".message.user").element;
  await wrapper.setProps({
    historyBefore: null,
    messageOffset: 19,
    messages: [
      { role: "user", content: "Earlier", timestamp: 0 },
      { role: "user", content: "Recent", timestamp: 1 },
    ],
  });
  expect(wrapper.find("button[data-chat-disclosure]").exists()).toBe(false);
  expect(wrapper.findAll(".message.user")[1].element).toBe(recent);
});

test("ordinary user messages keep their existing attribution without system notes", () => {
  const wrapper = mount(ChatTranscript, {
    props: {
      messages: [
        { role: "user", content: "**Ordinary request**", timestamp: 1 },
      ],
      activity: [],
      running: false,
      scope: "workspace",
    },
  });
  expect(wrapper.get(".message.user p").text()).toBe("**Ordinary request**");
  expect(wrapper.find(".message.user .chat-markdown").exists()).toBe(false);
  expect(wrapper.get(".message.user strong").text()).toBe("⟦navigation.you⟧");
  expect(wrapper.find("[role=note]").exists()).toBe(false);
  expect(wrapper.get("[role=status]").text()).toBe("");
});
