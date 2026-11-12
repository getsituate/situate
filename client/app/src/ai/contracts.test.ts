import { expect, expectTypeOf, test } from "vitest";
import type { AssistantMessage, Usage } from "./contracts";
import { loadConversation } from "./conversation";
test("native accounting represents unknown counters and costs without fabricated zeroes", () => {
  const usage: Usage = {
    input: null,
    output: 2,
    cacheRead: null,
    cacheWrite: null,
    totalTokens: null,
    cost: {
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      total: null,
    },
  };
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "Ready" }],
    timestamp: 1,
    stopReason: "stop",
    usage,
  };
  expect(loadConversation([message])[0]).toEqual(message);
  expectTypeOf<AssistantMessage>().not.toHaveProperty("provider");
  expectTypeOf<AssistantMessage>().not.toHaveProperty("model");
  expectTypeOf<AssistantMessage>().not.toHaveProperty("api");
});
