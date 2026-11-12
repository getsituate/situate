import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  checkUpdates,
  initializeUpdates,
  installUpdate,
  stopUpdatesListeners,
  updateReady,
  updates,
  updateRequestError,
  updateRequestPending,
  type UpdateSnapshot,
} from "./runtime";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const snapshot: UpdateSnapshot = {
  supported: true,
  installedVersion: "1.0.0",
  phase: "current",
  availableVersion: null,
  artifactId: null,
  downloadedBytes: 0,
  totalBytes: null,
  lastSuccessfulCheck: null,
  error: null,
  runningActions: false,
};
let changed: (event: { payload: UpdateSnapshot }) => void;
const unlisten = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(updates, snapshot);
  updateRequestError.value = null;
  updateRequestPending.value = false;
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    changed = callback as typeof changed;
    return unlisten;
  });
  vi.mocked(invoke).mockResolvedValue(snapshot);
});
afterEach(stopUpdatesListeners);
it("subscribes before readback and never overwrites a newer event with the startup snapshot", async () => {
  let resolve!: (value: UpdateSnapshot) => void;
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const startup = initializeUpdates();
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("updates_snapshot"),
  );
  changed({
    payload: { ...snapshot, phase: "downloading", downloadedBytes: 24 },
  });
  resolve(snapshot);
  await startup;
  expect(updates.phase).toBe("downloading");
  expect(updates.downloadedBytes).toBe(24);
});
it("cleans up a listener whose registration completes after unmount", async () => {
  let resolve!: (value: typeof unlisten) => void;
  vi.mocked(listen).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const startup = initializeUpdates();
  stopUpdatesListeners();
  resolve(unlisten);
  await startup;
  expect(unlisten).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});
it("ignores late events and readback after cleanup", async () => {
  await initializeUpdates();
  stopUpdatesListeners();
  changed({ payload: { ...snapshot, phase: "ready" } });
  expect(updates.phase).toBe("current");
  expect(unlisten).toHaveBeenCalledOnce();
});
it("keeps unsupported variants from manual check and installation IPC", async () => {
  updates.supported = false;
  expect(await checkUpdates()).toBe(false);
  expect(await installUpdate("artifact-b", true)).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});
it("reports manual errors without inventing native state and retries explicitly", async () => {
  vi.mocked(invoke).mockRejectedValueOnce("native.updates.checkFailed");
  expect(await checkUpdates()).toBe(false);
  expect(updateRequestError.value).toBe("native.updates.checkFailed");
  expect(updates.phase).toBe("current");
  expect(await checkUpdates()).toBe(true);
  expect(updateRequestError.value).toBeNull();
});
it.each(["1.2.0", "1.1.0"])(
  "rejects a captured target after a background replacement at version %s",
  async (availableVersion) => {
    await initializeUpdates();
    changed({
      payload: {
        ...snapshot,
        phase: "ready",
        availableVersion: "1.1.0",
        artifactId: "artifact-b",
      },
    });
    const captured = updates.artifactId!;
    changed({
      payload: {
        ...snapshot,
        phase: "ready",
        availableVersion,
        artifactId: "artifact-c",
      },
    });
    vi.mocked(invoke).mockClear();
    expect(await installUpdate(captured, true)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(updateRequestError.value).toBe("native.updates.changed");
    expect(await installUpdate("artifact-c", false)).toBe(true);
    expect(invoke).toHaveBeenCalledWith("updates_install", {
      artifactId: "artifact-c",
      abortRunning: false,
    });
  },
);
it("requires a native artifact identity for readiness and installation", async () => {
  updates.phase = "ready";
  expect(updateReady()).toBe(false);
  expect(await installUpdate("artifact-b", true)).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  updates.artifactId = "artifact-b";
  expect(updateReady()).toBe(true);
});
it("force implies stopping actions without bypassing artifact validation", async () => {
  updates.phase = "ready";
  updates.artifactId = "artifact-b";
  await installUpdate("artifact-b", false, true);
  expect(invoke).toHaveBeenLastCalledWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: true,
    force: true,
  });
  vi.mocked(invoke).mockClear();
  expect(await installUpdate("stale", true, true)).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});
it("sends only explicit abort consent and keeps a verified package after failure", async () => {
  updates.phase = "ready";
  updates.artifactId = "artifact-b";
  vi.mocked(invoke).mockRejectedValue("native.updates.installFailed");
  await installUpdate("artifact-b", false);
  expect(invoke).toHaveBeenLastCalledWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: false,
  });
  expect(updates.phase).toBe("ready");
  await installUpdate("artifact-b", true);
  expect(invoke).toHaveBeenLastCalledWith("updates_install", {
    artifactId: "artifact-b",
    abortRunning: true,
  });
});
