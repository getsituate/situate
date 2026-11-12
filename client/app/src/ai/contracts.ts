/*
Some message and tool field definitions derive from Pi 1.1.0:
https://github.com/earendil-works/pi/tree/abe508e1b89912adde45528136c3221eb69acdd7/packages

MIT License
Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ThinkingLevel =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
  continuation?: Continuation;
}
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
  continuation?: Continuation;
}
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;
  thoughtSignature?: string;
  namespace?: string;
  continuation?: Continuation;
}
export interface Usage {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  cacheWrite1h?: number | null;
  reasoning?: number | null;
  totalTokens: number | null;
  cost: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    total: number | null;
  } | null;
}
export interface Continuation {
  format:
    | "openai-responses"
    | "openai-completions"
    | "openai-codex-responses"
    | "anthropic-messages";
  data: JsonObject | readonly JsonValue[];
}
export interface NestedToolCalls {
  calls: {
    id: string;
    name: string;
    status: "ok" | "error" | "unfinished";
    arguments?: JsonObject;
    argumentsBytes?: number;
    durationMs?: number;
    error?: string;
  }[];
  complete: boolean;
}
export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}
export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  timestamp: number;
  usage: Usage | null;
  continuation?: Continuation;
  stopReason: "pending" | "stop" | "length" | "toolUse" | "error" | "aborted";
  responseId?: string;
  rawStopReason?: string;
  endTurn?: boolean;
  durationMs?: number;
}
export interface ToolResultMessage<T = JsonValue> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: T;
  structuredContent?: JsonValue;
  nestedCalls?: NestedToolCalls;
  usage?: Usage | null;
  isError: boolean;
  timestamp: number;
  durationMs?: number;
}
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export interface Model {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  type?: "chat";
  input: ("text" | "image")[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  cost: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
  } | null;
}
