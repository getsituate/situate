import type { Message, Phase } from "../chat/model";
import copy from "../localization/en.import-preparation.json" with { type: "json" };

export function sourceRequest(description: string): string {
  return copy.request.replace("{source}", () => description);
}

export type SourceReply = keyof typeof copy.responses;
export interface SourceConversation {
  messages: Message[];
  draft: string;
  phase: Phase;
  outcome: "success" | "failure" | "wait";
  reply: SourceReply;
  request: SourceReply | null;
  attempt: number;
  ready: boolean;
}
export type SourceAction =
  | { type: "draft"; value: string }
  | { type: "outcome"; value: SourceConversation["outcome"] }
  | { type: "reply"; value: SourceReply }
  | { type: "complete" | "fail"; attempt: number }
  | { type: "send" | "retry" | "stop" };

export function newSourceConversation(): SourceConversation {
  return {
    messages: [],
    draft: "",
    phase: "complete",
    outcome: "success",
    reply: "access",
    request: null,
    attempt: 0,
    ready: false,
  };
}
export function reduceSourceConversation(
  previous: SourceConversation,
  action: SourceAction,
): SourceConversation {
  const s = structuredClone(previous);
  switch (action.type) {
    case "draft":
      s.draft = action.value;
      break;
    case "outcome":
      s.outcome = action.value;
      break;
    case "reply":
      s.reply = action.value;
      break;
    case "send":
    case "retry":
      if (s.phase === "working") break;
      if (action.type === "send") {
        if (!s.draft.trim()) break;
        s.messages.push({
          kind: "message",
          id: `source-${s.messages.length + 1}`,
          speaker: "user",
          text: s.draft,
        });
        s.draft = "";
      } else if (
        !["error", "cancelled"].includes(s.phase) ||
        s.messages.at(-1)?.speaker !== "user"
      )
        break;
      s.ready = false;
      s.phase = "working";
      s.request = s.reply;
      s.attempt += 1;
      if (s.outcome === "failure")
        return reduceSourceConversation(s, {
          type: "fail",
          attempt: s.attempt,
        });
      if (s.outcome === "success")
        return reduceSourceConversation(s, {
          type: "complete",
          attempt: s.attempt,
        });
      break;
    case "complete":
      if (s.phase !== "working" || !s.request || action.attempt !== s.attempt)
        break;
      s.messages.push({
        kind: "message",
        id: `source-${s.messages.length + 1}`,
        speaker: "assistant",
        text: copy.responses[s.request],
      });
      s.ready = s.request === "review";
      s.request = null;
      s.phase = "complete";
      break;
    case "fail":
    case "stop":
      if (
        s.phase !== "working" ||
        (action.type === "fail" && action.attempt !== s.attempt)
      )
        break;
      s.phase = action.type === "fail" ? "error" : "cancelled";
      s.request = null;
      break;
  }
  return s;
}
