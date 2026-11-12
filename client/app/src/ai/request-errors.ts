const codes = new Set([
  "native.ai.request.failed",
  "native.ai.request.connectTimeout",
  "native.ai.request.responseTimeout",
  "native.ai.response.idleTimeout",
  "native.ai.request.connectionFailed",
  "native.ai.response.interrupted",
  "native.ai.request.rejected",
  "native.ai.access.rejected",
  "native.ai.response.tooLarge",
  "native.ai.response.stopped",
  "native.ai.response.stoppedBilling",
  "native.ai.protocol.invalidData",
  "native.ai.protocol.providerRejected",
  "native.ai.protocol.incompleteStream",
  "native.ai.protocol.unsupported",
]);
export function modelRequestError(reason: unknown): string | undefined {
  if (typeof reason !== "string" || !codes.has(reason)) return;
  return reason === "native.ai.request.failed"
    ? "ai.theResponseFailedCheckAIAccessReconnectIfYour"
    : reason;
}
