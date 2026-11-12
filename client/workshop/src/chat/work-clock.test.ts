import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatState, changePhase } from "./model";
import { advanceHistory } from "./work-history";
import { setConversationExample } from "./conversation-examples";
import { startWorkClock, workClockTime, workClockText } from "./work-clock";
import { finishWorkTime, sendWorkTimeMessage } from "./work-time";
import WorkHistory from "./WorkHistory.vue";

afterEach(() => vi.useRealTimers());

describe("work clock", () => {
  it.each([
    [0, "0:00"],
    [59000, "0:59"],
    [60000, "1:00"],
    [3599000, "59:59"],
    [3600000, "1:00:00"],
    [NaN, ""],
    [-1, ""],
  ])("formats %s as %s", (ms, text) => {
    expect(workClockText(ms as number)).toBe(text);
  });
  it("starts once and preserves elapsed time across updates and manual advances", () => {
    const state = startWorkClock(
      createChatState("chat-work-history-working"),
      1000,
    );
    expect(workClockTime(state, 4000)).toBe(106000);
    expect(startWorkClock(state, 4000)).toBe(state);
    expect(workClockTime(advanceHistory(state), 4000)).toBe(121000);
    expect(workClockTime(state, 500)).toBe(103000);
    expect(
      startWorkClock(createChatState("chat-empty"), 1000).workClockStartedAt,
    ).toBeUndefined();
  });
  it.each(["complete", "cancelled", "error"] as const)(
    "freezes %s at the actual elapsed time",
    (phase) => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      let state = startWorkClock(createChatState("chat-work-history-working"));
      vi.setSystemTime(4500);
      state = changePhase(state, phase);
      expect(state.workHistory?.milliseconds).toBe(106500);
      expect(state.workClockStartedAt).toBeUndefined();
      vi.setSystemTime(100000);
      expect(workClockTime(state)).toBe(106500);
    },
  );
  it("keeps follow-ups in one timed block and starts a new clock for the next request", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let state = startWorkClock(createChatState("chat-work-time-working"));
    state.draft = "Keep it short.";
    state = sendWorkTimeMessage(state);
    expect(state.workClockStartedAt).toBe(1000);
    vi.setSystemTime(4500);
    state = finishWorkTime(state, "cancelled");
    expect(state.transcript!.at(-1)).toMatchObject({
      text: "",
      workDuration: { milliseconds: 72500, outcome: "cancelled" },
    });
    state.draft = "Another request";
    state = startWorkClock(sendWorkTimeMessage(state));
    expect(state.workClockStartedAt).toBe(4500);
    expect(workClockTime(state)).toBe(0);
  });
  it("replaces example clocks instead of retaining the previous start time", () => {
    const state = startWorkClock(
      createChatState("chat-work-history-working"),
      1000,
    );
    expect(
      setConversationExample(state, "long").workClockStartedAt,
    ).toBeUndefined();
    expect(
      setConversationExample(state, "followup").workClockStartedAt,
    ).toBeUndefined();
  });
  it("ticks underneath Working without announcements and cleans up on completion or unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const state = startWorkClock(createChatState("chat-work-history-working"));
    const view = mount(WorkHistory, {
      props: {
        events: state.transcript!,
        history: state.workHistory!,
        phase: state.phase,
        startedAt: state.workClockStartedAt,
      },
    });
    expect(view.get('[role="timer"]').text()).toBe("1:43");
    expect(view.get('[role="timer"]').attributes("aria-live")).toBe("off");
    await vi.advanceTimersByTimeAsync(3000);
    expect(view.get('[role="timer"]').text()).toBe("1:46");
    await view.setProps({ locale: "de" });
    expect(view.get('[role="timer"]').attributes("aria-label")).toBe(
      "Bisherige Arbeitszeit",
    );
    expect(view.get('[role="timer"]').text()).toBe("1:46");
    const finished = changePhase(state, "complete");
    await view.setProps({
      phase: finished.phase,
      history: finished.workHistory!,
      startedAt: undefined,
    });
    expect(view.find('[role="timer"]').exists()).toBe(false);
    expect(view.get(".work-history-toggle").text()).toBe(
      "1 Min. 46 Sek. gearbeitet",
    );
    expect(vi.getTimerCount()).toBe(0);
    await view.setProps({ phase: "working", startedAt: Date.now() });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
