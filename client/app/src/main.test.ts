import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

const {
  initializeRecovery,
  createApp,
  mount,
  App,
  StartupFailure,
  startCheckRenderer,
  startNativePresentation,
} = vi.hoisted(() => ({
  initializeRecovery: vi.fn(),
  createApp: vi.fn(),
  mount: vi.fn(),
  App: {},
  StartupFailure: {},
  startCheckRenderer: vi.fn(),
  startNativePresentation: vi.fn(),
}));
vi.mock("vue", async (original) => ({
  ...(await original<typeof import("vue")>()),
  createApp,
}));
vi.mock("./App.vue", () => ({ default: App }));
vi.mock("./StartupFailure.vue", () => ({ default: StartupFailure }));
vi.mock("./recovery", () => ({ initializeRecovery }));
vi.mock("./plugins/check-renderer", () => ({ startCheckRenderer }));
vi.mock("./ai/presentation-client", () => ({ startNativePresentation }));
vi.mock("./diagnostics/failures", () => ({
  installWindowFailureHandlers: vi.fn(() => vi.fn()),
  installFailureHandlers: vi.fn(() => vi.fn()),
}));
vi.mock("./diagnostics", () => ({
  startDiagnostics: vi.fn(),
  stopDiagnostics: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  createApp.mockReturnValue({ mount });
  startCheckRenderer.mockReset().mockResolvedValue(undefined);
  startNativePresentation.mockReset().mockResolvedValue(() => {});
});

it("prevents the default context menu before recovery initialization completes", async () => {
  initializeRecovery.mockReturnValue(new Promise<void>(() => {}));
  await import("./main");
  const target = document.createElement("input");
  document.body.append(target);
  try {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  } finally {
    target.remove();
  }
});

it("does not create or mount App until recovery initialization completes", async () => {
  let resolve!: () => void;
  initializeRecovery.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  await import("./main");
  expect(createApp).not.toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
  resolve();
  await flushPromises();
  expect(createApp).toHaveBeenCalledExactlyOnceWith(App);
  expect(mount).toHaveBeenCalledExactlyOnceWith("#app");
});

it("waits for native presentation without installing a preview renderer in the client", async () => {
  initializeRecovery.mockResolvedValue(undefined);
  let ready!: (stop: () => void) => void;
  startNativePresentation.mockReturnValue(
    new Promise((resolve) => {
      ready = resolve;
    }),
  );
  await import("./main");
  await flushPromises();
  expect(startCheckRenderer).not.toHaveBeenCalled();
  expect(startNativePresentation).toHaveBeenCalledOnce();
  expect(createApp).not.toHaveBeenCalled();
  ready(() => {});
  await flushPromises();
  expect(createApp).toHaveBeenCalledExactlyOnceWith(App);
});
it("presentation registration failure mounts only the built-in failure screen", async () => {
  initializeRecovery.mockResolvedValue(undefined);
  startNativePresentation.mockRejectedValue(
    new Error("private native bridge failure"),
  );
  await import("./main");
  await flushPromises();
  expect(createApp).toHaveBeenCalledExactlyOnceWith(StartupFailure);
  expect(mount).toHaveBeenCalledExactlyOnceWith("#app");
});
it("mounts only the built-in failure screen when native recovery initialization fails", async () => {
  initializeRecovery.mockRejectedValue(new Error("private native failure"));
  await import("./main");
  await flushPromises();
  expect(createApp).toHaveBeenCalledExactlyOnceWith(StartupFailure);
  expect(mount).toHaveBeenCalledExactlyOnceWith("#app");
});
