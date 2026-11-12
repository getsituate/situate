import { invoke } from "@tauri-apps/api/core";
import { filesRequest } from "./files/api";
import { flushDiagnostics } from "./diagnostics";

export interface FileParticipant {
  prepareClose(id: string): Promise<boolean>;
  completeClose(id: string, closed: boolean): void;
  prepareQuit(ids: string[], token: string): Promise<boolean>;
  prepareRecovery?(ids: string[], token: string): Promise<boolean>;
  cancelQuit(token: string): void;
}
interface QuitStatus {
  sequence: number;
  state: "pending" | "cancelled" | "approved";
  workspaceIds: string[];
}
type UpdatePreparationFailure =
  "conversation_save" | "files_pending" | "dictation_active" | "window_error";
interface UpdateStatus {
  state: "pending" | "cancelled" | "installing";
  workspaceIds: string[];
}
interface RecoveryStatus {
  state: "pending" | "rejected" | "cancelled" | "finishing" | "completed";
  workspaceIds: string[];
}
interface QuitAttempt {
  phase: "preparing" | "awaiting" | "cancelling";
  token: string;
  workspaceId: string;
}

export class LifecycleCoordinator {
  private closing = false;
  private recoveryToken: string | undefined;
  private recoveryRegistration: string | undefined;
  private recoveryCancelled: ((token: string) => void) | undefined;
  private recoveryCompleted: ((token: string) => Promise<void>) | undefined;
  private recoveryFilesReleased = false;
  private recoveryWorkspaceIds: string[] = [];
  private readonly recoveryChecking = new Set<string>();
  private readonly finishedRecoveries = new Set<string>();
  private updateToken: string | undefined;
  private readonly updateChecking = new Set<string>();
  private readonly updateCancellationFailures = new Set<string>();
  private readonly cancelledUpdates = new Set<string>();
  private latestSequence = 0;
  private attempt: QuitAttempt | undefined;
  private readonly checking = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly cancellationFailures = new Set<string>();

  constructor(
    private readonly files: () => FileParticipant | null,
    private readonly report: (message: string) => void,
    private readonly cancellationChanged: (
      retryable: boolean,
    ) => void = () => {},
    private readonly prepareConversationQuit: (
      scopes?: readonly string[],
    ) => Promise<void> = async () => {},
    private readonly prepareDictationClose: (
      scope?: string,
    ) => Promise<boolean> = async () => true,
  ) {}

  get quitting(): boolean {
    return (
      !!this.recoveryToken ||
      this.recoveryChecking.size > 0 ||
      !!this.updateToken ||
      this.updateChecking.size > 0 ||
      this.updateCancellationFailures.size > 0 ||
      !!this.attempt ||
      this.checking.size > 0 ||
      this.cancellationFailures.size > 0
    );
  }

  async close(
    id: string,
    commit: () => Promise<boolean>,
  ): Promise<"closed" | "deferred" | "cancelled"> {
    if (!(await this.reconcile()) || this.closing) return "cancelled";
    this.closing = true;
    let closed = false;
    const files = this.files();
    try {
      if (!(await this.prepareDictationClose(id))) return "cancelled";
      if (files && !(await files.prepareClose(id))) return "cancelled";
      closed = await commit();
      return closed ? "closed" : "deferred";
    } finally {
      files?.completeClose(id, closed);
      this.closing = false;
    }
  }

  async quit(token: string): Promise<void> {
    if (
      this.cancelled.has(token) ||
      this.checking.has(token) ||
      this.attempt?.token === token ||
      this.cancellationFailures.has(token)
    )
      return;
    this.checking.add(token);
    let attempt: QuitAttempt | undefined;
    try {
      const status = await this.status(token);
      if (this.cancelled.has(token) || status.sequence < this.latestSequence)
        return;
      if (status.state === "cancelled") {
        this.cancelQuit(token);
        return;
      }
      if (status.state === "approved") return;
      const workspaceId = status.workspaceIds[0];
      if (!workspaceId) throw new Error("native.files.quit.noWorkspace");
      // The host admits only one quit attempt. A newer pending token supersedes a missed cancellation.
      if (this.attempt) this.cancelQuit(this.attempt.token);
      attempt = { phase: "preparing", token, workspaceId };
      this.attempt = attempt;
      if (this.closing) {
        await this.cancelHostQuit(attempt);
        return;
      }
      await this.prepareConversationQuit();
      if (this.attempt !== attempt) return;
      const files = this.files();
      const approved =
        files && (await files.prepareQuit(status.workspaceIds, token));
      if (this.attempt !== attempt) return;
      if (!approved || !(await this.prepareDictationClose())) {
        await this.cancelHostQuit(attempt);
        return;
      }
      const reply = await filesRequest({
        workspaceId,
        operation: "quitReady",
        token,
      });
      if (this.attempt !== attempt) return;
      if (reply.status !== "ok")
        throw new Error(reply.message ?? "files.theAppCouldNotQuit");
      attempt.phase = "awaiting";
      flushDiagnostics();
    } catch (reason) {
      if (this.cancelled.has(token)) return;
      this.report(reason instanceof Error ? reason.message : String(reason));
      if (attempt && this.attempt === attempt)
        await this.cancelHostQuit(attempt);
      else this.retainCancellation(token, reason);
    } finally {
      this.checking.delete(token);
    }
  }

  async prepareRecovery(token: string, registration: string): Promise<void> {
    if (
      this.finishedRecoveries.has(token) ||
      this.recoveryChecking.has(token) ||
      this.recoveryToken === token
    )
      return;
    this.recoveryChecking.add(token);
    try {
      const status = await invoke<RecoveryStatus>("recovery_status", { token });
      if (this.finishedRecoveries.has(token)) return;
      if (status.state !== "pending") {
        if (status.state === "completed" && !this.recoveryToken) {
          this.recoveryToken = token;
          this.recoveryRegistration = registration;
          this.recoveryWorkspaceIds = status.workspaceIds;
          this.recoveryFilesReleased = false;
        }
        await this.reconcileRecoveryStatus(token, status);
        return;
      }
      if (
        this.closing ||
        this.attempt ||
        this.updateToken ||
        this.recoveryToken
      )
        throw new Error("native.recovery.failed");
      this.recoveryToken = token;
      this.recoveryRegistration = registration;
      this.recoveryWorkspaceIds = status.workspaceIds;
      this.recoveryFilesReleased = false;
      if (
        !(await this.prepareDictationClose(
          status.workspaceIds.length === 1 ? status.workspaceIds[0] : undefined,
        ))
      )
        throw new Error("native.recovery.failed");
      if (this.recoveryToken !== token) return;
      // Native execution has settled before this event; UI checkpoints are last.
      await this.prepareConversationQuit(status.workspaceIds);
      if (this.recoveryToken !== token) return;
      const files = this.files();
      if (
        status.workspaceIds.length &&
        (!files?.prepareRecovery ||
          !(await files.prepareRecovery(status.workspaceIds, token)))
      )
        throw new Error("native.recovery.failed");
      if (this.recoveryToken !== token) return;
      const current = await invoke<RecoveryStatus>("recovery_status", {
        token,
      });
      if (this.recoveryToken !== token) return;
      if (current.state !== "pending") {
        await this.reconcileRecoveryStatus(token, current);
        return;
      }
      flushDiagnostics();
      await invoke("recovery_ack", { token, registration, approved: true });
    } catch {
      if (this.finishedRecoveries.has(token)) return;
      this.report("native.recovery.failed");
      try {
        await invoke("recovery_ack", { token, registration, approved: false });
        const status = await invoke<RecoveryStatus>("recovery_status", {
          token,
        });
        await this.reconcileRecoveryStatus(token, status);
      } catch {
        // A lost reply cannot establish that native admission was released.
        this.cancellationChanged(true);
      }
    } finally {
      this.recoveryChecking.delete(token);
    }
  }

  onRecoveryCancelled(listener: (token: string) => void): () => void {
    this.recoveryCancelled = listener;
    return () => {
      if (this.recoveryCancelled === listener)
        this.recoveryCancelled = undefined;
    };
  }

  onRecoveryCompleted(listener: (token: string) => Promise<void>): () => void {
    this.recoveryCompleted = listener;
    return () => {
      if (this.recoveryCompleted === listener)
        this.recoveryCompleted = undefined;
    };
  }

  private async reconcileRecoveryStatus(
    token: string,
    status: RecoveryStatus,
  ): Promise<boolean> {
    if (status.state === "cancelled") {
      this.finishRecovery(token);
      return true;
    }
    if (status.state === "completed" && this.recoveryCompleted) {
      await this.recoveryCompleted(token);
      return true;
    }
    return false;
  }

  releaseRecoveryFiles(token: string): void {
    if (this.recoveryToken !== token || this.recoveryFilesReleased) return;
    const files = this.files();
    files?.cancelQuit(token);
    for (const id of this.recoveryWorkspaceIds) files?.completeClose(id, true);
    this.recoveryFilesReleased = true;
  }

  private async cancelHostRecovery(): Promise<void> {
    const token = this.recoveryToken;
    const registration = this.recoveryRegistration;
    if (!token || !registration) return;
    try {
      await invoke("recovery_ack", { token, registration, approved: false });
    } catch {
      // Read back before deciding whether admission can reopen.
    }
    try {
      const status = await invoke<RecoveryStatus>("recovery_status", { token });
      if (await this.reconcileRecoveryStatus(token, status)) return;
    } catch {
      this.report("native.recovery.failed");
    }
    this.cancellationChanged(true);
  }

  finishRecovery(token: string, completed = false): void {
    this.finishedRecoveries.add(token);
    this.recoveryChecking.delete(token);
    if (this.recoveryToken === token) {
      if (completed) this.releaseRecoveryFiles(token);
      else this.files()?.cancelQuit(token);
      this.recoveryWorkspaceIds = [];
      this.recoveryToken = undefined;
      this.recoveryRegistration = undefined;
      this.cancellationChanged(
        this.cancellationFailures.size > 0 ||
          this.updateCancellationFailures.size > 0,
      );
    }
    if (!completed) this.recoveryCancelled?.(token);
  }

  async prepareUpdate(token: string): Promise<void> {
    if (
      this.cancelledUpdates.has(token) ||
      this.updateChecking.has(token) ||
      this.updateToken === token
    )
      return;
    this.updateChecking.add(token);
    let failureReason: UpdatePreparationFailure = "window_error";
    try {
      const status = await invoke<UpdateStatus>("updates_preparation_status", {
        token,
      });
      if (this.cancelledUpdates.has(token)) return;
      if (status.state === "cancelled") {
        this.cancelUpdate(token);
        return;
      }
      if (status.state === "installing") {
        this.updateToken = token;
        return;
      }
      if (
        this.closing ||
        this.attempt ||
        (this.updateToken && this.updateToken !== token)
      ) {
        await this.cancelHostUpdate(token);
        return;
      }
      this.updateToken = token;
      failureReason = "conversation_save";
      await this.prepareConversationQuit();
      if (this.updateToken !== token) return;
      failureReason = "files_pending";
      const files = this.files();
      const approved =
        status.workspaceIds.length === 0 ||
        (!!files && (await files.prepareQuit(status.workspaceIds, token)));
      if (this.updateToken !== token) return;
      if (!approved) {
        await this.cancelHostUpdate(token, "files_pending");
        return;
      }
      failureReason = "dictation_active";
      if (!(await this.prepareDictationClose())) {
        await this.cancelHostUpdate(token, "dictation_active");
        return;
      }
      if (this.updateToken !== token) return;
      failureReason = "window_error";
      const current = await invoke<UpdateStatus>("updates_preparation_status", {
        token,
      });
      if (current.state === "cancelled") {
        this.cancelUpdate(token);
        return;
      }
      await invoke("updates_prepare_ack", { token, approved: true });
      flushDiagnostics();
    } catch (reason) {
      if (!this.cancelledUpdates.has(token)) {
        this.report(reason instanceof Error ? reason.message : String(reason));
        await this.cancelHostUpdate(token, failureReason);
      }
    } finally {
      this.updateChecking.delete(token);
    }
  }

  cancelUpdate(token: string): void {
    this.cancelledUpdates.add(token);
    this.updateChecking.delete(token);
    if (this.updateToken === token) {
      this.files()?.cancelQuit(token);
      this.updateToken = undefined;
    }
    this.updateCancellationFailures.delete(token);
    this.cancellationChanged(
      this.cancellationFailures.size > 0 ||
        this.updateCancellationFailures.size > 0,
    );
  }

  private async cancelHostUpdate(
    token: string,
    reason?: UpdatePreparationFailure,
  ): Promise<void> {
    try {
      await invoke("updates_prepare_ack", {
        token,
        approved: false,
        ...(reason ? { reason } : {}),
      });
      this.cancelUpdate(token);
    } catch {
      try {
        if (
          (await invoke<UpdateStatus>("updates_preparation_status", { token }))
            .state === "cancelled"
        ) {
          this.cancelUpdate(token);
          return;
        }
      } catch {
        /* Preserve the admission barrier until cancellation is confirmed. */
      }
      this.updateCancellationFailures.add(token);
      this.cancellationChanged(true);
      this.report("native.updates.preparationFailed");
    }
  }

  cancelQuit(token: string): void {
    this.cancelled.add(token);
    if (this.attempt?.token === token) {
      this.files()?.cancelQuit(token);
      this.attempt = undefined;
    }
    this.cancellationFailures.delete(token);
    this.cancellationChanged(
      this.cancellationFailures.size > 0 ||
        this.updateCancellationFailures.size > 0,
    );
  }

  async reconcile(): Promise<boolean> {
    if (
      this.checking.size ||
      this.updateChecking.size ||
      this.recoveryChecking.size
    )
      return false;
    if (this.recoveryToken) {
      const token = this.recoveryToken;
      try {
        const status = await invoke<RecoveryStatus>("recovery_status", {
          token,
        });
        await this.reconcileRecoveryStatus(token, status);
      } catch {
        this.cancellationChanged(true);
      }
    }
    const updates = new Set(this.updateCancellationFailures);
    if (this.updateToken) updates.add(this.updateToken);
    for (const token of updates) {
      try {
        if (
          (await invoke<UpdateStatus>("updates_preparation_status", { token }))
            .state === "cancelled"
        )
          this.cancelUpdate(token);
      } catch {
        this.updateCancellationFailures.add(token);
        this.cancellationChanged(true);
      }
    }
    const tokens = new Set(this.cancellationFailures);
    if (this.attempt) tokens.add(this.attempt.token);
    for (const token of tokens) {
      try {
        if ((await this.status(token)).state === "cancelled")
          this.cancelQuit(token);
      } catch (reason) {
        this.retainCancellation(token, reason);
      }
    }
    return !this.quitting;
  }

  async retryCancellation(): Promise<void> {
    await this.cancelHostRecovery();
    for (const token of [...this.updateCancellationFailures])
      await this.cancelHostUpdate(token);
    for (const token of [...this.cancellationFailures]) {
      try {
        const status = await this.status(token);
        if (status.state === "cancelled") {
          this.cancelQuit(token);
          continue;
        }
        const workspaceId = status.workspaceIds[0];
        if (status.state !== "pending" || !workspaceId)
          throw new Error("native.files.quit.cannotCancel");
        await this.cancelHostQuit({ phase: "cancelling", token, workspaceId });
      } catch (reason) {
        this.retainCancellation(token, reason);
      }
    }
  }

  private async status(token: string): Promise<QuitStatus> {
    const status = await invoke<QuitStatus>("lifecycle_status", { token });
    this.latestSequence = Math.max(this.latestSequence, status.sequence);
    return status;
  }

  private retainCancellation(token: string, reason: unknown): void {
    if (this.cancelled.has(token)) return;
    this.cancellationFailures.add(token);
    this.cancellationChanged(true);
    this.report(
      JSON.stringify({
        key: "files.quitCancellationUnconfirmed",
        params: {
          error: reason instanceof Error ? reason.message : String(reason),
        },
      }),
    );
  }

  private async cancelHostQuit(attempt: QuitAttempt): Promise<void> {
    attempt.phase = "cancelling";
    const { token, workspaceId } = attempt;
    try {
      const reply = await filesRequest({
        workspaceId,
        operation: "cancelQuit",
        token,
      });
      if (reply.status !== "ok")
        throw new Error(reply.message ?? "files.quitCancelFailed");
      this.cancelQuit(token);
    } catch (reason) {
      // A lost reply or broadcast does not imply rollback failed. Read state, but never retry the write implicitly.
      try {
        if ((await this.status(token)).state === "cancelled") {
          this.cancelQuit(token);
          return;
        }
      } catch {
        /* Keep the token until a later explicit reconciliation can confirm rollback. */
      }
      this.retainCancellation(token, reason);
    }
  }
}
