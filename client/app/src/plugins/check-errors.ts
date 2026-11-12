import { t, type MessageKey } from "@situate/localization";

const codes = [
  "plugins.checkFailed",
  "plugins.checkAssertionFailed",
  "plugins.checkAssertionsRequired",
  "plugins.checkUnknownPreviewApi",
  "plugins.checkReferenceError",
  "plugins.checkTypeError",
  "plugins.checkSyntaxError",
  "plugins.invalidContributions",
  "plugins.moduleImportInvalid",
  "plugins.moduleImportUnsupported",
  "plugins.moduleCycle",
  "plugins.moduleNotFound",
  "plugins.previewInvalidArguments",
  "plugins.previewViewNotFound",
  "plugins.previewElementNotFound",
  "plugins.previewRenderFailed",
  "plugins.previewUnavailable",
  "plugins.executionCancelled",
  "plugins.workspaceUnavailable",
  "native.plugins.recoveryBlocked",
  "native.plugins.dependencyUnavailable",
  "native.plugins.invalidManifest",
  "native.plugins.checkInvalid",
  "native.plugins.checkLimit",
  "native.plugins.captureUnavailable",
  "native.plugins.stateBusy",
  "native.plugins.testProcessBlocked",
] as const;
export type CheckFailureCode = (typeof codes)[number];
const known = new Set<string>(codes);

export const checkStages = [
  "renderer_open",
  "renderer_ready",
  "renderer_recovery",
  "renderer_start",
  "native_admission",
  "host_modules",
  "host_open",
  "host_request",
  "fixtures",
  "module_link",
  "module_import",
  "factory",
  "contributions",
  "script",
  "preview_open",
  "preview_read",
  "preview_click",
  "preview_fill",
  "preview_capture",
  "preview_validate",
  "dispose",
  "native_finish",
  "renderer_result",
  "renderer_reply",
] as const;
export type CheckStage = (typeof checkStages)[number];
export const checkErrorTypes = [
  "error",
  "type_error",
  "reference_error",
  "syntax_error",
  "string",
  "other",
] as const;
export const checkDiagnosticCodes = [
  ...codes,
  "ipc_invalid_arguments",
  "native.plugins.hostFailed",
  "native.plugins.hostCancelled",
  "native.plugins.invalidPath",
  "native.plugins.unavailable",
  "native.plugins.readFailed",
  "native.plugins.tooLarge",
  "native.plugins.retainedStorageFailed",
  "native.plugins.developmentToolDenied",
  "native.plugins.developmentDraftUnavailable",
  "native.plugins.developmentOutcomeUnknown",
  "native.plugins.stateInvalid",
  "native.plugins.stateConflict",
  "native.plugins.stateSaveFailed",
  "native.plugins.stateOutcomeUnknown",
  "native.plugins.testNetworkBlocked",
  "native.plugins.credentialMissing",
  "native.files.editor.closed",
  "native.files.workspace.closing",
  "native.files.operation.unavailable",
  "native.content.base.mismatch",
] as const;
export type CheckDiagnostic = {
  stage: CheckStage;
  code: (typeof checkDiagnosticCodes)[number];
  kind: (typeof checkErrorTypes)[number];
};
const diagnostics = new WeakMap<Error, CheckDiagnostic>();

function safeMessage(error: unknown): unknown {
  if (typeof error === "string") return error;
  try {
    return error instanceof Error
      ? Object.getOwnPropertyDescriptor(error, "message")?.value
      : undefined;
  } catch {
    return undefined;
  }
}
function errorType(error: unknown): CheckDiagnostic["kind"] {
  try {
    if (typeof error === "string") return "string";
    if (error instanceof TypeError) return "type_error";
    if (error instanceof ReferenceError) return "reference_error";
    if (error instanceof SyntaxError) return "syntax_error";
    if (error instanceof Error) return "error";
  } catch {
    /* Unknown thrown values remain opaque. */
  }
  return "other";
}
export function parseCheckDiagnostic(
  value: unknown,
): CheckDiagnostic | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (
      Object.keys(value).some((key) => !["stage", "code", "kind"].includes(key))
    )
      return;
    const stage = Object.getOwnPropertyDescriptor(value, "stage")?.value;
    const code = Object.getOwnPropertyDescriptor(value, "code")?.value;
    const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
    if (
      checkStages.includes(stage) &&
      checkDiagnosticCodes.includes(code) &&
      checkErrorTypes.includes(kind)
    )
      return { stage, code, kind };
  } catch {
    /* Invalid bridge metadata is not diagnostic data. */
  }
}
export function checkDiagnostic(error: unknown): CheckDiagnostic | undefined {
  try {
    return error instanceof Error ? diagnostics.get(error) : undefined;
  } catch {
    return undefined;
  }
}
export function annotateCheckFailure(error: unknown, stage: CheckStage): Error {
  if (checkDiagnostic(error)) return error as Error;
  const message = safeMessage(error);
  const diagnosticCode =
    typeof message === "string" &&
    checkDiagnosticCodes.includes(message as CheckDiagnostic["code"])
      ? (message as CheckDiagnostic["code"])
      : typeof message === "string" && message.startsWith("invalid args ")
        ? "ipc_invalid_arguments"
        : checkFailureCode(error);
  const wrapped = new Error(checkFailureCode(error));
  diagnostics.set(wrapped, {
    stage,
    code: diagnosticCode,
    kind: errorType(error),
  });
  return wrapped;
}
export function restoreCheckFailure(
  error: unknown,
  value: unknown,
  fallback: CheckStage,
): Error {
  const wrapped = annotateCheckFailure(error, fallback);
  const diagnostic = parseCheckDiagnostic(value);
  if (diagnostic) diagnostics.set(wrapped, diagnostic);
  return wrapped;
}

export function checkFailureCode(error: unknown): CheckFailureCode {
  const message = safeMessage(error);
  if (typeof message === "string" && known.has(message))
    return message as CheckFailureCode;
  if (errorType(error) === "reference_error")
    return message === "preview is not defined" ||
      message === "Can't find variable: preview"
      ? "plugins.checkUnknownPreviewApi"
      : "plugins.checkReferenceError";
  if (errorType(error) === "type_error") return "plugins.checkTypeError";
  if (errorType(error) === "syntax_error") return "plugins.checkSyntaxError";
  return "plugins.checkFailed";
}

export function describeCheckFailure(error: unknown) {
  const code: MessageKey = checkFailureCode(error);
  const diagnostic = checkDiagnostic(error);
  return {
    error: code,
    message: t(code),
    ...(diagnostic ? { diagnostic } : {}),
  };
}
