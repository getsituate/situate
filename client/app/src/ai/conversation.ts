import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "./contracts";

export type PortableMessage =
  UserMessage | AssistantMessage | ToolResultMessage;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const string = (value: unknown): value is string => typeof value === "string";
function fields(
  value: ObjectValue,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}
function optionalStrings(value: ObjectValue, keys: string[]): boolean {
  return keys.every((key) => !Object.hasOwn(value, key) || string(value[key]));
}
function block(value: unknown, assistant: boolean): boolean {
  if (!object(value)) return false;
  if (value.type === "text")
    return (
      fields(value, ["type", "text"], ["textSignature", "continuation"]) &&
      (!Object.hasOwn(value, "continuation") ||
        continuation(value.continuation)) &&
      string(value.text) &&
      optionalStrings(value, ["textSignature"])
    );
  if (value.type === "image" && !assistant)
    return (
      fields(value, ["type", "data", "mimeType"]) &&
      string(value.data) &&
      string(value.mimeType) &&
      !!value.mimeType
    );
  if (value.type === "toolCall" && assistant)
    return (
      fields(
        value,
        ["type", "id", "name", "arguments"],
        ["thoughtSignature", "namespace", "continuation"],
      ) &&
      string(value.id) &&
      !!value.id &&
      string(value.name) &&
      !!value.name &&
      object(value.arguments) &&
      (!Object.hasOwn(value, "continuation") ||
        continuation(value.continuation)) &&
      optionalStrings(value, ["thoughtSignature", "namespace"])
    );
  return (
    assistant &&
    value.type === "thinking" &&
    fields(
      value,
      ["type", "thinking"],
      ["thinkingSignature", "redacted", "continuation"],
    ) &&
    (!Object.hasOwn(value, "continuation") ||
      continuation(value.continuation)) &&
    string(value.thinking) &&
    optionalStrings(value, ["thinkingSignature"]) &&
    (value.redacted === undefined || typeof value.redacted === "boolean")
  );
}
function usage(value: unknown): boolean {
  if (value === null) return true;
  if (!object(value) || (value.cost !== null && !object(value.cost)))
    return false;
  const counters = [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "totalTokens",
  ];
  const costs = ["input", "output", "cacheRead", "cacheWrite", "total"];
  const count = (value: unknown) => value === null || number(value);
  return (
    fields(value, [...counters, "cost"], ["cacheWrite1h", "reasoning"]) &&
    counters.every((key) => count(value[key])) &&
    ["cacheWrite1h", "reasoning"].every(
      (key) => !Object.hasOwn(value, key) || count(value[key]),
    ) &&
    (value.cost === null ||
      (fields(value.cost as ObjectValue, costs) &&
        costs.every((key) => count((value.cost as ObjectValue)[key]))))
  );
}
function continuation(value: unknown): boolean {
  return (
    object(value) &&
    fields(value, ["format", "data"]) &&
    [
      "openai-responses",
      "openai-completions",
      "openai-codex-responses",
      "anthropic-messages",
    ].includes(value.format as string) &&
    (object(value.data) || Array.isArray(value.data))
  );
}
function nestedCalls(value: unknown): boolean {
  return (
    object(value) &&
    fields(value, ["calls", "complete"]) &&
    typeof value.complete === "boolean" &&
    Array.isArray(value.calls) &&
    value.calls.every(
      (call: unknown) =>
        object(call) &&
        fields(
          call,
          ["id", "name", "status"],
          ["arguments", "argumentsBytes", "durationMs", "error"],
        ) &&
        string(call.id) &&
        string(call.name) &&
        ["ok", "error", "unfinished"].includes(call.status as string) &&
        optionalStrings(call, ["error"]) &&
        (call.arguments === undefined || object(call.arguments)) &&
        (call.argumentsBytes === undefined ||
          (Number.isSafeInteger(call.argumentsBytes) &&
            number(call.argumentsBytes))) &&
        (call.durationMs === undefined || number(call.durationMs)),
    )
  );
}
function message(value: unknown, partial = false): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  if (value.role === "user")
    return (
      fields(value, ["role", "content", "timestamp"]) &&
      (string(value.content) ||
        (Array.isArray(value.content) &&
          value.content.every((item) => block(item, false))))
    );
  if (value.role === "toolResult")
    return (
      fields(
        value,
        ["role", "toolCallId", "toolName", "content", "isError", "timestamp"],
        ["details", "structuredContent", "nestedCalls", "usage", "durationMs"],
      ) &&
      string(value.toolCallId) &&
      !!value.toolCallId &&
      string(value.toolName) &&
      !!value.toolName &&
      typeof value.isError === "boolean" &&
      (!Object.hasOwn(value, "usage") || usage(value.usage)) &&
      (!Object.hasOwn(value, "nestedCalls") ||
        nestedCalls(value.nestedCalls)) &&
      (!Object.hasOwn(value, "durationMs") || number(value.durationMs)) &&
      Array.isArray(value.content) &&
      value.content.every((item) => block(item, false))
    );
  return (
    value.role === "assistant" &&
    fields(
      value,
      ["role", "content", "timestamp", "usage", "stopReason"],
      ["responseId", "rawStopReason", "endTurn", "durationMs", "continuation"],
    ) &&
    optionalStrings(value, ["responseId", "rawStopReason"]) &&
    (!Object.hasOwn(value, "continuation") ||
      continuation(value.continuation)) &&
    (!Object.hasOwn(value, "durationMs") || number(value.durationMs)) &&
    (value.endTurn === undefined || typeof value.endTurn === "boolean") &&
    ((partial && value.stopReason === "pending") ||
      ["stop", "length", "toolUse", "error", "aborted"].includes(
        value.stopReason as string,
      )) &&
    usage(value.usage) &&
    Array.isArray(value.content) &&
    value.content.every((item) => block(item, true))
  );
}
export function loadConversation(value: unknown): PortableMessage[] {
  if (!Array.isArray(value) || !value.every((item) => message(item)))
    throw new Error("native.ai.conversation.versionInvalid");
  return value as PortableMessage[];
}
export function readPartialMessage(value: unknown): AssistantMessage {
  if (!object(value) || value.role !== "assistant" || !message(value, true))
    throw new Error("native.ai.conversation.versionInvalid");
  return value as unknown as AssistantMessage;
}
