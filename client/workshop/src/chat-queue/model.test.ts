import { describe, expect, it } from "vitest";
import { createQueueState, reduceQueue } from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";

describe("chat queue", () => {
  it("removes only the selected attachment and never changes consumed messages", () => {
    const original = createQueueState("chat-queue-mixed");
    let state = reduceQueue(original, { type: "remove-attachment", index: 0 });
    expect(state.attachments).toEqual([]);
    expect(state.draft).toBe(original.draft);
    expect(state.pending).toEqual(original.pending);
    expect(original.attachments).toHaveLength(1);
    state = reduceQueue(reduceQueue(state, { type: "consume" }), {
      type: "consume",
    });
    const consumed = state.consumed;
    state = reduceQueue(state, { type: "remove-attachment", index: 0 });
    expect(state.consumed).toEqual(consumed);
    expect(state.consumed[1]!.attachments).toHaveLength(1);
    state = reduceQueue(state, { type: "restore" });
    expect(state.attachments.map((item) => item.id)).toEqual(["invitation"]);
    state = reduceQueue(state, { type: "remove-attachment", index: 0 });
    expect(state.attachments).toEqual([]);
    expect(state.consumed).toEqual(consumed);
  });
  it("restores steering, follow-up and existing draft without stopping or sending", () => {
    const state = createQueueState("chat-queue-mixed");
    const restored = reduceQueue(state, { type: "restore" });
    expect(restored.draft).toBe(
      "Keep the discussion to chapters 1–4.\n\nLeave ten minutes for questions.\n\nAfter this, draft a short invitation.\n\nAlso keep the invitation informal.",
    );
    expect(restored.attachments.map((item) => item.id)).toEqual([
      "agenda",
      "invitation",
      "draft",
    ]);
    expect(restored.pending).toEqual([]);
    expect(restored.consumed).toEqual([]);
    expect(restored.phase).toBe("working");
    expect(state.pending).toHaveLength(3);
  });
  it("does not restore consumed messages or their attachments", () => {
    let state = createQueueState("chat-queue-mixed");
    state = reduceQueue(reduceQueue(state, { type: "consume" }), {
      type: "consume",
    });
    state = reduceQueue(state, { type: "restore" });
    expect(state.consumed).toHaveLength(2);
    expect(state.draft).toBe(
      "After this, draft a short invitation.\n\nAlso keep the invitation informal.",
    );
    expect(state.attachments.map((item) => item.id)).toEqual([
      "invitation",
      "draft",
    ]);
  });
  it("queues during compaction and only delivers follow-up at the task boundary", () => {
    let state = createQueueState("chat-queue-compacting");
    state = reduceQueue(state, { type: "submit", kind: "follow-up" });
    expect(state.pending).toHaveLength(4);
    expect(reduceQueue(state, { type: "consume" }).pending).toHaveLength(4);
    expect(reduceQueue(state, { type: "finish" }).pending).toHaveLength(4);
    state = reduceQueue(state, { type: "phase", phase: "working" });
    state = reduceQueue(reduceQueue(state, { type: "consume" }), {
      type: "consume",
    });
    expect(state.pending.every((item) => item.kind === "follow-up")).toBe(true);
    state = reduceQueue(state, { type: "finish" });
    expect(state.consumed.at(-1)?.text).toBe(
      "After this, draft a short invitation.",
    );
    expect(state.phase).toBe("working");
  });
  it.each(["chat-queue-mixed", "chat-queue-compacting"])(
    "Stop restores all pending content from %s without sending",
    (scenario) => {
      const before = createQueueState(scenario);
      const stopped = reduceQueue(before, { type: "phase", phase: "stopped" });
      expect(stopped.phase).toBe("stopped");
      expect(stopped.pending).toEqual([]);
      expect(stopped.consumed).toEqual([]);
      expect(stopped.nextId).toBe(before.nextId);
      expect(stopped.draft).toBe(
        "Keep the discussion to chapters 1–4.\n\nLeave ten minutes for questions.\n\nAfter this, draft a short invitation.\n\nAlso keep the invitation informal.",
      );
      expect(stopped.attachments).toEqual([
        { id: "agenda", name: "Agenda notes.md" },
        { id: "invitation", name: "Invitation outline.md" },
        { id: "draft", name: "Room details.md" },
      ]);
      expect(reduceQueue(stopped, { type: "phase", phase: "stopped" })).toEqual(
        stopped,
      );
      expect(reduceQueue(stopped, { type: "finish" })).toEqual(stopped);
      expect(before.pending).toHaveLength(3);
    },
  );
  it("Stop excludes consumed text and attachments and keeps the existing draft", () => {
    let state = createQueueState("chat-queue-mixed");
    state = reduceQueue(reduceQueue(state, { type: "consume" }), {
      type: "consume",
    });
    const consumed = state.consumed;
    state = reduceQueue(state, { type: "phase", phase: "stopped" });
    expect(state.pending).toEqual([]);
    expect(state.consumed).toEqual(consumed);
    expect(state.draft).toBe(
      "After this, draft a short invitation.\n\nAlso keep the invitation informal.",
    );
    expect(state.attachments.map((item) => item.id)).toEqual([
      "invitation",
      "draft",
    ]);
  });
  it("Stop with an empty queue preserves draft text and attachments exactly", () => {
    const state = createQueueState("chat-queue-mixed");
    state.pending = [];
    state.draft = "\nUnsent draft\n";
    state.attachments = [{ id: "draft-only", name: "Draft notes.md" }];
    const stopped = reduceQueue(state, { type: "phase", phase: "stopped" });
    expect(stopped.draft).toBe(state.draft);
    expect(stopped.attachments).toEqual(state.attachments);
    expect(stopped.pending).toEqual([]);
    expect(stopped.consumed).toEqual([]);
    expect(stopped.phase).toBe("stopped");
  });
  it("opens the stopped fixture with a restored unsent draft and empty queues", () => {
    const stopped = createQueueState("chat-queue-stopped");
    expect(stopped.phase).toBe("stopped");
    expect(stopped.pending).toEqual([]);
    expect(stopped.consumed).toEqual([]);
    expect(stopped.draft).toBe(
      "Keep the discussion to chapters 1–4.\n\nLeave ten minutes for questions.\n\nAfter this, draft a short invitation.\n\nAlso keep the invitation informal.",
    );
    expect(stopped.attachments.map((item) => item.id)).toEqual([
      "agenda",
      "invitation",
      "draft",
    ]);
    expect(reduceQueue(stopped, { type: "restore" })).toEqual(stopped);
    const sent = reduceQueue(stopped, { type: "submit", kind: "steering" });
    expect(sent.phase).toBe("working");
    expect(sent.consumed).toHaveLength(1);
    expect(sent.draft).toBe("");
  });
  it("resets the isolated state and controls without changing the environment", () => {
    let state = createSimulation("chat-queue-mixed");
    expect(screenControls(state).controls).toEqual(["chat-queue"]);
    expect(screenControls(state).canSetOutcome).toBe(false);
    state = reduceSimulation(state, {
      type: "chat-queue",
      action: { type: "restore" },
    });
    state = reduceSimulation(state, { type: "reset" });
    expect(state.chatQueue).toEqual(createQueueState("chat-queue-mixed"));
    expect(state.epoch).toBe(1);
    state = reduceSimulation(state, { type: "feature", feature: "editor" });
    expect(screenControls(state).controls).not.toContain("chat-queue");
  });
});
