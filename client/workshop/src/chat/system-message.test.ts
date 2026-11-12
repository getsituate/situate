import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatSystemMessage from "../components/ChatSystemMessage.vue";
import ChatSystemAnnouncement from "../components/ChatSystemAnnouncement.vue";
import { createChatState, groupEvents } from "./model";
import { pluginAvailableText, systemMessageCopy } from "./system-message";
import { createSimulation, reduceSimulation } from "../workshop/simulation";

describe("plugin availability system messages", () => {
  it("keeps the notice chronological after a topic change and before a later message", () => {
    const state = createChatState("chat-plugin-available");
    const blocks = groupEvents(state.transcript!);
    expect(blocks.map((block) => block.id)).toEqual([
      "plugin-request",
      "handoff",
      "changed-topic",
      "saturday-plan",
      "plugin-available",
      "followup",
    ]);
    expect(blocks[4]).toEqual({
      kind: "system",
      id: "plugin-available",
      pluginName: "Reading list",
    });
    expect(state.phase).toBe("complete");
    expect(state.run).toBeNull();
    expect(state.systemAnnouncement).toBe("");
  });

  it.each(["en", "de"] as const)(
    "renders localized %s text without assistant attribution or actions",
    (locale) => {
      const text = pluginAvailableText("<Reading list>", locale);
      const wrapper = mount(ChatSystemMessage, {
        props: { message: text, label: systemMessageCopy[locale].label },
      });
      expect(wrapper.get('[role="note"]').text()).toBe(text);
      expect(wrapper.classes()).not.toContain("assistant");
      expect(wrapper.findAll("button, a, .speaker, reading")).toHaveLength(0);
      expect(wrapper.attributes("aria-live")).toBeUndefined();
      wrapper.unmount();
    },
  );

  it("announces only new deliveries, not mounting or restoring previous notices", async () => {
    const wrapper = mount(ChatSystemAnnouncement, {
      props: { message: "Earlier notice" },
    });
    expect(wrapper.get('[role="status"]').text()).toBe("");
    await wrapper.setProps({ message: "New delivery" });
    expect(wrapper.text()).toBe("New delivery");
    expect(wrapper.attributes("aria-live")).toBe("polite");
    await wrapper.setProps({ message: "" });
    expect(wrapper.text()).toBe("");
    wrapper.unmount();
  });

  it("preserves drafts across viewport changes and restores silent history on reset", () => {
    let state = createSimulation("chat-plugin-available");
    state.chat.draft = "Keep my current topic";
    state.chat.systemAnnouncement = "New delivery";
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.chat.draft).toBe("Keep my current topic");
    expect(state.chat.phase).toBe("complete");
    state = reduceSimulation(state, { type: "reset" });
    expect(state.chat.systemAnnouncement).toBe("");
    expect(state.chat.transcript).toHaveLength(6);
  });
});
