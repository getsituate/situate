import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatTranscript from "./ChatTranscript.vue";
import { events } from "./model";
import { createPluginState, currentDevelopment } from "../plugins/model";
import { developmentTranscript } from "../plugins/development-transcript";

describe("shared chat transcript", () => {
  it("keeps a recorded note change visible when its historical contents cannot be loaded", () => {
    const d = currentDevelopment(
      createPluginState("plugins-development-changes"),
    )!;
    d.inspection.recordedChanges.find(
      (change) => change.group === "workspace",
    )!.after!.status = "unavailable";
    const wrapper = mount(ChatTranscript, {
      props: { events: developmentTranscript(d) },
    });
    expect(wrapper.get(".change-card [role=note]").text()).toContain(
      "earlier contents are no longer available",
    );
    expect(wrapper.find(".change-card .removed").exists()).toBe(false);
    wrapper.unmount();
  });
  it.each([
    ["ordinary", events],
    [
      "development",
      developmentTranscript(
        currentDevelopment(createPluginState("plugins-development-changes"))!,
      ),
    ],
  ] as const)(
    "uses the same collapsed call and visible content structure in %s conversations",
    (_name, transcript) => {
      const wrapper = mount(ChatTranscript, {
        props: { events: [...transcript] },
      });
      expect(wrapper.findAll(".activity").length).toBeGreaterThan(0);
      expect(
        wrapper
          .findAll(".activity")
          .every((activity) => activity.attributes("open") === undefined),
      ).toBe(true);
      expect(wrapper.find(".call-data").exists()).toBe(true);
      expect(wrapper.find(".change-card .edit-content .removed").exists()).toBe(
        true,
      );
      expect(wrapper.find(".change-card .edit-content .added").exists()).toBe(
        true,
      );
      expect(wrapper.find(".chat-message.user").exists()).toBe(true);
      expect(wrapper.find(".chat-message.assistant").exists()).toBe(true);
      wrapper.unmount();
    },
  );
});
