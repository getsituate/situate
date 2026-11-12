import { expect, test, vi } from "vitest";
import {
  NativeConversation,
  type ConversationSnapshot,
} from "./native-conversation";
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
test("automatic titles arrive independently of response completion and user renames use expected-title actions", async () => {
  const snapshot: ConversationSnapshot = {
    version: 1,
    generation: "owner",
    position: 0,
    record: {
      version: 2,
      id: "chat",
      title: "Provisional",
      revision: 0,
      messages: [],
      draft: "",
    },
    phase: "running",
    error: null,
    taskActive: true,
  };
  mock.invoke.mockResolvedValue(snapshot);
  const client = new NativeConversation("scope", "chat", vi.fn(), vi.fn());
  await client.refresh();
  const generated = {
    ...snapshot,
    position: 1,
    record: {
      ...snapshot.record,
      title: "Garden with reading corner",
      revision: 1,
    },
  };
  mock.channel!.onmessage({
    version: 1,
    subscription: "fixture-subscription",
    generation: "owner",
    position: 1,
    type: "snapshot",
    snapshot: generated,
  });
  expect(client.snapshot?.record.title).toBe("Garden with reading corner");
  expect(client.snapshot?.taskActive).toBe(true);
  mock.invoke.mockResolvedValueOnce({
    ...generated,
    position: 2,
    record: { ...generated.record, title: "My title", revision: 2 },
  });
  await client.action(
    {
      version: 1,
      type: "renameTitle",
      expected: generated.record.title,
      title: "My title",
    },
    "rename",
  );
  expect(client.snapshot?.record.title).toBe("My title");
  expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual([
    "ai_conversation_subscribe",
    "ai_conversation_action",
  ]);
  client.dispose();
});
