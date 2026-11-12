import type { PluginSource, PluginToolDescriptor } from "./types";

export type ExecutorCommand =
  | { type: "load"; generation: number; pluginId: string; source: PluginSource }
  | {
      type: "invoke";
      generation: number;
      invocationId: string;
      kind: "tool" | "export" | "check";
      name: string;
      args: unknown;
      script?: string;
    }
  | { type: "terminate"; generation: number }
  | {
      type: "hostReply";
      generation: number;
      invocationId: string;
      requestId: string;
      result?: unknown;
      error?: string;
    };
export type ExecutorEvent =
  | {
      type: "ready";
      generation: number;
      tools: PluginToolDescriptor[];
      exports: string[];
    }
  | {
      type: "result";
      generation: number;
      invocationId: string;
      result: unknown;
    }
  | { type: "error"; generation: number; invocationId?: string; error: string }
  | {
      type: "host";
      generation: number;
      invocationId: string;
      requestId: string;
      request: Record<string, unknown>;
    }
  | {
      type: "progress";
      generation: number;
      invocationId: string;
      value: unknown;
    }
  | { type: "terminated"; generation: number };
