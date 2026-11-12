import { afterEach, expect, test } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { SituateIcon } from "@situate/ui";
import { initialFormats, setPreferences } from "@situate/localization";
import ChatToolGroup from "./ChatToolGroup.vue";
import ChatTranscript from "./ChatTranscript.vue";
import type { AgentMessage } from "../../ai/contracts";

enableAutoUnmount(afterEach);

test.each([
  ["de", "Webseiten abrufen · 2"],
  ["en", "Fetch web pages · 2"],
] as const)(
  "labels web requests without claiming completion (%s)",
  async (language, label) => {
    Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
    setPreferences({ language, formats: initialFormats(language) });
    const calls = ["one", "two"].map((id) => ({
      key: id,
      id,
      name: "web_fetch",
      state: "running",
      args: { url: `https://example.com/${id}` },
    }));
    const view = mount(ChatToolGroup, {
      props: { calls, category: "web", scope: "test" },
    });
    for (const state of ["running", "completed", "failed", "interrupted"]) {
      await view.setProps({ calls: calls.map((call) => ({ ...call, state })) });
      expect(view.get("summary > span").text()).toBe(label);
      expect(view.findComponent(SituateIcon).props("name")).toBe("globe");
    }
    await view.setProps({ calls: [calls[0]] });
    expect(view.get("summary > span").text()).toBe(label.replace("2", "1"));
  },
);

test("keeps file reads and web requests in separate disclosures with their own captions", async () => {
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  setPreferences({ language: "de", formats: initialFormats("de") });
  const messages: AgentMessage[] = [
    {
      role: "assistant",
      timestamp: 1,
      stopReason: "toolUse",
      usage: null,
      content: [
        {
          type: "toolCall",
          id: "file",
          name: "read",
          arguments: { path: "Notes.md" },
        },
        {
          type: "toolCall",
          id: "page",
          name: "web_fetch",
          arguments: { url: "https://example.com/guide" },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "file",
      toolName: "read",
      timestamp: 2,
      isError: false,
      content: [],
    },
    {
      role: "toolResult",
      toolCallId: "page",
      toolName: "web_fetch",
      timestamp: 3,
      isError: false,
      content: [],
    },
  ];
  const view = mount(ChatTranscript, {
    props: { messages, activity: [], running: false, scope: "test" },
  });
  const groups = view.findAll(".history-tools");
  expect(groups).toHaveLength(2);
  expect(groups[0].get("summary").text()).toBe("1 Datei gelesen");
  expect(groups[1].get("summary").text()).toBe("Webseiten abrufen · 1");
  await groups[1].get("summary").trigger("click");
  expect(groups[1].get(".call-details summary").text()).toContain(
    "example.com/guide",
  );
});
