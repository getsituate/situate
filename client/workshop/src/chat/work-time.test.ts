import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createChatState } from "./model";
import ChatTranscript from "./ChatTranscript.vue";
import {
  advanceWorkTime,
  finishWorkTime,
  sendWorkTimeMessage,
  workDurationText,
} from "./work-time";

describe("work block timing", () => {
  it("counts steering messages in one block and freezes its duration on completion", () => {
    let state = createChatState("chat-work-time-working");
    state.draft = "Keep it short.";
    state = sendWorkTimeMessage(state);
    expect(state.workTimeMs).toBe(69000);
    state = advanceWorkTime(state);
    state = finishWorkTime(state, "complete");
    const summary = state.transcript!.at(-1)!;
    expect(summary).toMatchObject({ workDuration: { milliseconds: 84000 } });
    expect(advanceWorkTime(state)).toBe(state);
    state.draft = "Add another book.";
    state = sendWorkTimeMessage(state);
    expect(state.workTimeMs).toBe(0);
    expect(state.transcript).toContainEqual(summary);
  });
  it("ends at a question and does not count waiting time", () => {
    let state = finishWorkTime(
      createChatState("chat-work-time-working"),
      "complete",
      true,
    );
    expect(state.phase).toBe("complete");
    expect(advanceWorkTime(state, 600000)).toBe(state);
    state.draft = "Book shortlist.md";
    state = sendWorkTimeMessage(state);
    state = finishWorkTime(advanceWorkTime(state), "complete");
    expect(
      state
        .transcript!.filter(
          (event) => event.kind === "message" && event.workDuration,
        )
        .map(
          (event) =>
            event.kind === "message" && event.workDuration?.milliseconds,
        ),
    ).toEqual([69000, 15000]);
  });
  it.each([
    [0, "Weniger als 1 Sek. gearbeitet"],
    [42000, "42 Sek. gearbeitet"],
    [84000, "1 Min. 24 Sek. gearbeitet"],
    [3600000, "60 Min. 0 Sek. gearbeitet"],
  ])("formats %s without fractional seconds", (milliseconds, expected) => {
    const actual = workDurationText(
      { milliseconds, outcome: "complete" },
      "de",
    );
    expect(actual.toLowerCase()).toBe(expected.toLowerCase());
  });
  it.each(["cancelled", "error"] as const)(
    "keeps %s distinct from completion",
    (phase) => {
      const state = finishWorkTime(
        createChatState("chat-work-time-working"),
        phase,
      );
      expect(state.transcript!.at(-1)).toMatchObject({
        workDuration: { outcome: phase, milliseconds: 69000 },
      });
    },
  );
  it("renders one understated summary after the final answer and none on calls", () => {
    const state = createChatState("chat-work-time");
    const wrapper = mount(ChatTranscript, {
      props: { events: state.transcript!, locale: "de" },
    });
    expect(wrapper.findAll(".work-duration")).toHaveLength(1);
    expect(wrapper.get(".work-duration").text()).toBe(
      "1 Min. 24 Sek. gearbeitet",
    );
    expect(wrapper.find(".call-detail .work-duration").exists()).toBe(false);
    wrapper.unmount();
  });
  it("does not display a running duration or fabricate an unknown duration", () => {
    const state = createChatState("chat-work-time-working");
    const wrapper = mount(ChatTranscript, {
      props: { events: state.transcript! },
    });
    expect(wrapper.find(".work-duration").exists()).toBe(false);
    expect(
      workDurationText({ milliseconds: NaN, outcome: "complete" }, "en"),
    ).toBe("");
    wrapper.unmount();
  });
});
