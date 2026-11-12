import type { PluginSource } from "./types";

export interface PreviewIdentity {
  generation: number;
  invocationId: string;
  requestId: string;
}
export type PreviewRequest = PreviewIdentity & {
  operation: "previewOpen" | "previewStep" | "previewClose";
  args: {
    source?: PluginSource;
    sources?: PluginSource[];
    viewId?: string;
    action?: "read" | "click" | "fill" | "capture";
    selector?: string;
    value?: string;
  };
};

export function validPreviewRequest(value: unknown): value is PreviewRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as PreviewRequest;
  return (
    Number.isSafeInteger(request.generation) &&
    request.generation >= 0 &&
    typeof request.invocationId === "string" &&
    !!request.invocationId &&
    request.invocationId.length <= 256 &&
    typeof request.requestId === "string" &&
    !!request.requestId &&
    request.requestId.length <= 256 &&
    ["previewOpen", "previewStep", "previewClose"].includes(
      request.operation,
    ) &&
    !!request.args &&
    typeof request.args === "object" &&
    !Array.isArray(request.args)
  );
}
