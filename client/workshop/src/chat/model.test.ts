import { describe, expect, it } from "vitest";
import { events, groupEvents, type Call } from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
describe("chronological chat disclosure", () => {
  it("groups only consecutive hidden calls and preserves every event in order", () => {
    const blocks = groupEvents(events);
    expect(blocks.map((block) => block.kind)).toEqual([
      "message",
      "activity",
      "message",
      "activity",
      "call",
      "activity",
      "call",
      "activity",
      "message",
    ]);
    expect(
      blocks.flatMap((block) =>
        block.kind === "activity" ? block.calls : [block],
      ),
    ).toEqual(events);
  });
  it("does not create empty groups and respects plugin presentation independently of tool name", () => {
    const call: Call = {
      kind: "call",
      id: "plugin",
      tool: "plugin.edit",
      label: "Updated",
      input: "",
      result: "",
      visible: false,
    };
    expect(groupEvents([])).toEqual([]);
    expect(groupEvents([call])[0]?.kind).toBe("activity");
    expect(groupEvents([{ ...call, visible: true }])[0]?.kind).toBe("call");
  });
  it("retains drafts on environment changes and resets deterministically", () => {
    let state = createSimulation("chat-working");
    state = reduceSimulation(state, {
      type: "chat",
      state: { ...state.chat, draft: "Keep this" },
    });
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.chat.draft).toBe("Keep this");
    expect(state.chat.ai.mobile).toBe(true);
    expect(screenControls(state).controls).toEqual(["chat"]);
    expect(screenControls(state).canSetOutcome).toBe(false);
    const reset = reduceSimulation(state, { type: "reset" });
    expect(reset.chat.draft).toBe("");
    expect(reset.epoch).toBe(1);
  });
});
