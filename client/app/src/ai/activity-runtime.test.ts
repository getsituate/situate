import { expect, test, vi } from "vitest";
import { NativeConversation } from "./native-conversation";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  ack: vi.fn().mockResolvedValue(undefined),
  channel: undefined as undefined | { onmessage: (event: unknown) => void },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: unknown) =>
    command === "ai_conversation_ack"
      ? mock.ack(command, args)
      : mock.invoke(command, args),
  Channel: class {
    onmessage = (_event: unknown) => {};
    constructor() {
      mock.channel = this;
    }
  },
}));
test("activity comes from ordered native progress, clears explicitly, and ignores detached updates", async () => {
  vi.useFakeTimers();
  mock.invoke.mockResolvedValue({
    version: 1,
    generation: "owner",
    position: 0,
    record: {
      version: 2,
      id: "chat",
      title: "",
      revision: 0,
      messages: [],
      draft: "",
    },
    phase: "running",
    error: null,
    taskActive: true,
  });
  const publish = vi.fn();
  const client = new NativeConversation("scope", "chat", publish, vi.fn());
  try {
    await client.refresh();
    mock.channel!.onmessage({
      version: 1,
      subscription: "fixture-subscription",
      generation: "owner",
      position: 1,
      type: "progress",
      activityComment: "Reading notes",
    });
    expect(client.snapshot?.activityComment).toBe("Reading notes");
    await vi.advanceTimersByTimeAsync(60000);
    expect(mock.invoke).toHaveBeenCalledOnce();
    mock.channel!.onmessage({
      version: 1,
      subscription: "fixture-subscription",
      generation: "owner",
      position: 2,
      type: "progress",
      activityComment: "",
    });
    expect(client.snapshot?.activityComment).toBe("");
    client.dispose();
    mock.channel!.onmessage({
      version: 1,
      subscription: "fixture-subscription",
      generation: "owner",
      position: 3,
      type: "progress",
      activityComment: "Late",
    });
    expect(client.snapshot?.activityComment).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});
