import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { t, type MessageKey } from "@situate/localization";
import { shallowReactive, shallowRef } from "vue";

export type Phase = "permission" | "recording" | "transcribing";
export type Notice =
  "permission" | "denied" | "noSpeech" | "failed" | "interrupted" | "model";
export interface DictationOwner {
  id: string;
  scope: string;
  conversation: string;
  phase: Phase;
}
export interface Snapshot {
  supported: boolean;
  model:
    | "missing"
    | "checking"
    | "waiting"
    | "downloading"
    | "preparing"
    | "ready"
    | "failed"
    | "storage";
  progress: number;
  busy: boolean;
  owner: DictationOwner | null;
}
export const dictation = shallowReactive<Snapshot>({
  supported: false,
  model: "checking",
  progress: 0,
  busy: false,
  owner: null,
});
export const dictationLevel = shallowRef(0);
export const dictationSettingsRequested = shallowRef(0);
export const noticePresentation = shallowRef<symbol | null>(null);
export const dismissedPermission = shallowRef<string | null>(null);
export const confirmation = shallowRef<{
  id: string;
  notice?: Notice;
  inserted?: boolean;
  decide: (discard: boolean) => void;
} | null>(null);
export function ownsDictation(scope: string, conversation: string): boolean {
  return (
    dictation.owner?.scope === scope &&
    dictation.owner.conversation === conversation
  );
}

export function modelLabel(): string {
  const key: MessageKey =
    dictation.model === "failed"
      ? "dictation.downloadFailed"
      : dictation.model === "storage"
        ? "dictation.storageFailed"
        : dictation.model === "checking"
          ? "dictation.preparing"
          : `dictation.${dictation.model}`;
  return t(key);
}

let binding:
  | { id: string; complete: (text?: string, notice?: Notice) => void }
  | undefined;
let initialization: Promise<void> | undefined;
let listeners: UnlistenFn[] = [];
let version = 0;
const finished = new Map<string, () => void>();

export async function refreshDictation(): Promise<void> {
  const request = ++version;
  const snapshot = await invoke<Snapshot>("dictation_snapshot");
  if (request === version) {
    if (
      snapshot.owner?.id !== dictation.owner?.id ||
      snapshot.owner?.phase !== "recording"
    )
      dictationLevel.value = 0;
    Object.assign(dictation, snapshot);
  }
}
export function initializeDictation(): Promise<void> {
  if (initialization) return initialization;
  initialization = (async () => {
    listeners.push(
      await listen("dictation-changed", () => {
        void refreshDictation().catch(() => {});
      }),
    );
    listeners.push(
      await listen<{ id: string; level: number }>(
        "dictation-level",
        ({ payload }) => {
          if (
            payload.id === dictation.owner?.id &&
            dictation.owner?.phase === "recording" &&
            Number.isFinite(payload.level)
          )
            dictationLevel.value = Math.max(0, Math.min(1, payload.level));
        },
      ),
    );
    listeners.push(
      await listen<{ id: string; text?: string; notice?: Notice }>(
        "dictation-result",
        ({ payload }) => {
          ++version;
          if (confirmation.value && confirmation.value.id === payload.id)
            confirmation.value = {
              ...confirmation.value,
              notice: payload.notice,
              inserted: !!payload.text,
            };
          if (binding && binding.id === payload.id) {
            const current = binding;
            binding = undefined;
            current.complete(payload.text, payload.notice);
          }
          if (dictation.owner?.id === payload.id) {
            dictationLevel.value = 0;
            Object.assign(dictation, { owner: null, busy: false });
          }
          finished.get(payload.id)?.();
          finished.delete(payload.id);
        },
      ),
    );
    await refreshDictation();
  })().catch(() => {
    stopDictationListeners();
    Object.assign(dictation, {
      supported: true,
      model: "failed",
      busy: false,
      owner: null,
    });
  });
  return initialization;
}
export function stopDictationListeners(): void {
  listeners.forEach((unlisten) => unlisten());
  listeners = [];
  initialization = undefined;
  binding = undefined;
  dictationLevel.value = 0;
  confirmation.value?.decide(false);
  noticePresentation.value = null;
  dismissedPermission.value = null;
}
export async function startDictation(
  scope: string,
  conversation: string,
  complete: (text?: string, notice?: Notice) => void,
  live: () => boolean = () => true,
): Promise<void> {
  await initializeDictation();
  if (!live() || dictation.busy || dictation.model !== "ready") return;
  const id = crypto.randomUUID();
  ++version;
  binding = { id, complete };
  dictationLevel.value = 0;
  dictation.owner = { id, scope, conversation, phase: "permission" };
  dictation.busy = true;
  try {
    await invoke("dictation_start", { scope, conversation, id });
  } catch {
    await refreshDictation();
    if (dictation.owner?.id !== id && binding?.id === id) {
      binding = undefined;
      complete(undefined, "failed");
    }
  }
}
export async function stopRecording(): Promise<void> {
  const id = dictation.owner?.id;
  if (!id || dictation.owner?.phase !== "recording") return;
  await invoke("dictation_control", { action: "stop", id });
}
export async function retryProvisioning(): Promise<void> {
  await initializeDictation();
  try {
    await invoke("dictation_control", { action: "retry" });
  } catch {
    dictation.model = "failed";
  }
}

export async function discardDictation(id: string): Promise<void> {
  const completion = new Promise<void>((resolve) => {
    finished.set(id, resolve);
  });
  try {
    await invoke("dictation_control", { action: "discard", id });
    await completion;
  } finally {
    finished.delete(id);
  }
}

export async function guardDictation(
  scope?: string,
  closing = false,
): Promise<boolean> {
  const owner = dictation.owner;
  if (
    !owner ||
    (scope && owner.scope !== scope) ||
    (!closing && owner.phase === "transcribing")
  )
    return true;
  if (confirmation.value) return false;
  const discard = await new Promise<boolean>((resolve) => {
    confirmation.value = { id: owner.id, decide: resolve };
  });
  confirmation.value = null;
  if (!discard) return false;
  if (dictation.owner?.id !== owner.id) return true;
  try {
    await discardDictation(owner.id);
    return true;
  } catch {
    return false;
  }
}
