import type { AgentMessage, JsonValue } from "./contracts";
import type { CompactionCheckpoint } from "./queue-runtime";

const encoder = new TextEncoder();
const repeatableObservations = new Set([
  "read",
  "ls",
  "find",
  "grep",
  "history",
  "read_revision",
  "read_conversation",
  "read_plugin_design",
  "read_plugin_development",
  "read_plugin_source",
  "inspect_plugin",
]);
const omittedOutput = {
  type: "text" as const,
  text: "Earlier tool output omitted from model context. Consult conversation history for the original result; do not repeat completed effects.",
};

function textTokens(text: string): number {
  return Math.ceil(encoder.encode(text).length / 3);
}
function messageTokens(message: AgentMessage): number {
  if (typeof message.content === "string")
    return 16 + textTokens(message.content);
  return (
    16 +
    message.content.reduce((total, block) => {
      if (block.type === "image") {
        // shortcut: Image allowance is approximate; use provider-aware sizing for high-resolution workloads.
        return total + 8192;
      }
      if (block.type === "text") return total + textTokens(block.text);
      if (block.type === "thinking")
        return (
          total + textTokens(block.thinking + (block.thinkingSignature ?? ""))
        );
      if (block.type === "toolCall")
        return total + textTokens(block.name + JSON.stringify(block.arguments));
      return total;
    }, 0)
  );
}
function inputBudget(contextWindow: number, maxTokens: number): number {
  return Math.max(256, contextWindow - Math.min(maxTokens, contextWindow / 4));
}
export function contextNeedsCompaction(
  messages: readonly AgentMessage[],
  contextWindow: number,
  maxTokens: number,
  overheadTokens = 0,
): boolean {
  return (
    overheadTokens +
      messages.reduce((total, message) => total + messageTokens(message), 0) >
    inputBudget(contextWindow, maxTokens) * 0.75
  );
}

function latestUserIndex(messages: AgentMessage[]): number {
  let index = messages.length - 1;
  while (index >= 0 && messages[index]!.role !== "user") index--;
  return index;
}
export function compactContext(
  messages: AgentMessage[],
  checkpoint?: CompactionCheckpoint,
): AgentMessage[] {
  if (!checkpoint) return messages;
  const latestUser = latestUserIndex(messages);
  return [
    {
      role: "user",
      content: `Context summary of earlier work (do not repeat completed actions):\n${checkpoint.summary}`,
      timestamp: 0,
    },
    ...(latestUser >= 0 && latestUser < checkpoint.sourceCount
      ? [messages[latestUser]!]
      : []),
    ...messages.slice(checkpoint.sourceCount),
  ];
}

function recentBoundary(messages: AgentMessage[], tokens: number): number {
  let retained = 0;
  let candidate = messages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    const size = messageTokens(messages[index]!);
    if (retained && retained + size > tokens) break;
    retained += size;
    candidate = index;
  }
  let boundary = 0;
  const pending = new Set<string>();
  for (let index = 0; index <= candidate && index < messages.length; index++) {
    const message = messages[index]!;
    if (!pending.size && message.role !== "toolResult") boundary = index;
    if (message.role === "assistant") {
      for (const block of message.content)
        if (block.type === "toolCall") pending.add(block.id);
    } else if (message.role === "toolResult")
      pending.delete(message.toolCallId);
  }
  return boundary;
}

function maskObservation(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult" || message.isError) return message;
  // Action receipts and unknown plugin results need semantic summarization.
  if (
    repeatableObservations.has(message.toolName) &&
    messageTokens(message) > 256
  )
    return { ...message, content: [omittedOutput] };
  if (!message.content.some((block) => block.type === "image")) return message;
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "image" ? omittedOutput : block,
    ),
  };
}

export function planCompaction(
  source: AgentMessage[],
  checkpoint: CompactionCheckpoint | undefined,
  budget: {
    contextWindow: number;
    maxTokens: number;
    instructions?: string;
    tools?: readonly JsonValue[];
  },
): { messages: AgentMessage[]; sourceCount?: number } {
  const { contextWindow, maxTokens } = budget;
  const previous = checkpoint?.sourceCount ?? 0;
  const overhead =
    textTokens(budget.instructions ?? "") +
    textTokens(JSON.stringify(budget.tools ?? []));
  const boundary = recentBoundary(
    source,
    Math.min(12000, Math.max(256, inputBudget(contextWindow, maxTokens) / 4)),
  );
  const messages = compactContext(
    source.map((message, index) =>
      index >= previous && index < boundary
        ? maskObservation(message)
        : message,
    ),
    checkpoint,
  );
  const latestUser = latestUserIndex(source);
  const hasOlderMessages = source
    .slice(previous, boundary)
    .some((_, index) => previous + index !== latestUser);
  return {
    messages,
    ...(boundary > previous &&
    hasOlderMessages &&
    contextNeedsCompaction(messages, contextWindow, maxTokens, overhead)
      ? { sourceCount: boundary }
      : {}),
  };
}

export function compactionChunks(
  messages: AgentMessage[],
  contextWindow: number,
): string[] {
  const budget = Math.max(256, Math.floor(contextWindow * 0.35) * 3);
  const source = messages.map((message) => ({
    ...message,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map((block) =>
            block.type === "image"
              ? {
                  ...block,
                  data: block.data.startsWith("attachment:")
                    ? block.data
                    : "[image attachment]",
                }
              : block,
          ),
  }));
  const bytes = encoder.encode(JSON.stringify(source));
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length;) {
    let end = Math.min(offset + budget, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    chunks.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
  }
  return chunks;
}
