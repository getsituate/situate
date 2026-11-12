import { diagnosticsFor, type Context } from "../diagnostics";
import {
  annotateCheckFailure,
  checkDiagnostic,
  checkStages,
  parseCheckDiagnostic,
  type CheckDiagnostic,
  type CheckStage,
} from "./check-errors";

export interface CheckProgress {
  stage: CheckStage;
  diagnostic?: CheckDiagnostic;
}
export type ReportCheckProgress = (progress: CheckProgress) => void;

export function checkProgressLogger(
  scope: string,
  context?: Context,
): ReportCheckProgress {
  return ({ stage, diagnostic }) => {
    try {
      if (!checkStages.includes(stage)) return;
      const safe = parseCheckDiagnostic(diagnostic);
      const cancelled =
        safe?.code === "plugins.executionCancelled" ||
        safe?.code === "native.plugins.hostCancelled";
      diagnosticsFor(scope).emit(
        "operation.progress",
        "plugin",
        {
          component: "plugin_check",
          check_stage: stage,
          ...(safe
            ? {
                check_error: safe.code,
                error_type: safe.kind,
                outcome: cancelled ? "cancelled" : "failure",
              }
            : {}),
        },
        context,
        safe ? (cancelled ? "info" : "error") : "debug",
      );
    } catch {
      // Diagnostics must not change check results or block cleanup.
    }
  };
}

export function checkProgress(report: ReportCheckProgress = () => {}) {
  let previous: CheckStage | undefined;
  function emit(stage: CheckStage, diagnostic?: CheckDiagnostic) {
    if (!diagnostic && stage === previous) return;
    previous = stage;
    try {
      report({ stage, ...(diagnostic ? { diagnostic } : {}) });
    } catch {
      /* A failed observer must not fail a check. */
    }
  }
  return {
    emit,
    async at<T>(stage: CheckStage, work: () => T | Promise<T>): Promise<T> {
      emit(stage);
      try {
        return await work();
      } catch (error) {
        throw annotateCheckFailure(error, stage);
      }
    },
    sync<T>(stage: CheckStage, work: () => T): T {
      emit(stage);
      try {
        return work();
      } catch (error) {
        throw annotateCheckFailure(error, stage);
      }
    },
    failure(error: unknown) {
      const diagnostic = checkDiagnostic(error);
      if (diagnostic) emit(diagnostic.stage, diagnostic);
    },
  };
}
