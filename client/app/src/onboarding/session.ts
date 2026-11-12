import { shallowReactive } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { loadOnboarding, saveOnboarding } from "./api";
import {
  isOnboardingSnapshot,
  type OnboardingRecord,
  type OnboardingSnapshot,
} from "./types";

function createSession(scope: string) {
  const state = shallowReactive({
    record: null as OnboardingRecord | null,
    revision: null as string | null,
    writable: false,
    loading: false,
    saving: false,
    dirty: false,
    error: undefined as unknown,
    conversationOpen: false,
    accessConversationId: null as string | null,
  });
  let alive = true;
  let loaded = false;
  let version = 0;
  let pending: Promise<void> | undefined;
  let loading: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  function adopt(snapshot: OnboardingSnapshot) {
    state.record = snapshot.record;
    state.revision = snapshot.revision;
    state.writable = snapshot.writable;
    state.dirty = false;
    state.error = undefined;
  }
  async function load() {
    if (loaded || !alive) return;
    if (loading) return loading;
    state.loading = true;
    loading = (async () => {
      try {
        const snapshot = await loadOnboarding(scope);
        if (!alive) return;
        adopt(snapshot);
        if (state.record?.entered && state.record.step !== "complete") {
          const completed: unknown = await invoke("onboarding_action", {
            scope,
            action: "enter",
            expected: structuredClone(state.record),
          });
          if (!isOnboardingSnapshot(completed))
            throw new Error("native.onboarding.storage.invalid");
          if (!alive) return;
          adopt(completed);
        }
        loaded = true;
      } catch (error) {
        if (alive) state.error = error;
        throw error;
      } finally {
        state.loading = false;
        loading = undefined;
      }
    })();
    return loading;
  }
  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (pending) {
      await pending;
      if (state.dirty) return flush();
      return;
    }
    if (!state.dirty || !state.record || !alive) return;
    if (state.error) throw state.error;
    if (!state.writable) throw new Error("native.onboarding.storage.failed");
    state.saving = true;
    const record = structuredClone(state.record);
    const submitted = version;
    const expected = state.revision;
    pending = (async () => {
      let snapshot: OnboardingSnapshot;
      try {
        snapshot = await saveOnboarding(scope, record, expected);
      } catch (error) {
        // Visible replacement establishes its revision, not successful directory synchronization.
        const current = await loadOnboarding(scope).catch(() => undefined);
        if (alive && current && same(current.record, record)) {
          state.revision = current.revision;
          state.writable = current.writable;
        }
        throw error;
      }
      if (!alive) return;
      state.revision = snapshot.revision;
      state.writable = snapshot.writable;
      if (submitted === version) adopt(snapshot);
    })();
    try {
      await pending;
    } catch (error) {
      if (alive) state.error = error;
      throw error;
    } finally {
      state.saving = false;
      pending = undefined;
    }
    if (state.dirty) await flush();
  }
  function patch(patch: Partial<OnboardingRecord>) {
    if (!state.record || !alive) return;
    state.record = { ...state.record, ...patch };
    state.dirty = true;
    version++;
    clearTimeout(timer);
    timer = setTimeout(() => void flush().catch(() => {}), 200);
  }
  async function update(
    patch:
      | Partial<OnboardingRecord>
      | ((record: OnboardingRecord) => Partial<OnboardingRecord>),
    signal?: AbortSignal,
  ) {
    await load();
    await flush();
    signal?.throwIfAborted();
    patchRecord(typeof patch === "function" ? patch(state.record!) : patch);
    await flush();
  }
  function patchRecord(value: Partial<OnboardingRecord>) {
    if (!alive || !state.record)
      throw new Error("native.onboarding.storage.invalid");
    patch(value);
  }
  async function retry() {
    if (!loaded) return load();
    const snapshot = await loadOnboarding(scope);
    if (!alive) return;
    if (state.dirty) {
      if (
        !same(snapshot.record, state.record) &&
        snapshot.revision !== state.revision
      )
        throw new Error("native.onboarding.storage.conflict");
      state.revision = snapshot.revision;
      state.error = undefined;
      await flush();
    } else adopt(snapshot);
  }
  return {
    state,
    load,
    patch,
    update,
    flush,
    retry,
    dispose() {
      alive = false;
      clearTimeout(timer);
    },
  };
}
const sessions = new Map<string, ReturnType<typeof createSession>>();
export function onboardingSession(scope: string) {
  let session = sessions.get(scope);
  if (!session) {
    session = createSession(scope);
    sessions.set(scope, session);
  }
  return session;
}
export function currentOnboarding(scope: string) {
  return sessions.get(scope);
}
export async function flushOnboarding() {
  await Promise.all([...sessions.values()].map((session) => session.flush()));
}
export function retainOnboarding(scopes: string[]) {
  for (const [scope, session] of sessions) {
    if (!scopes.includes(scope)) {
      session.dispose();
      sessions.delete(scope);
    }
  }
}
