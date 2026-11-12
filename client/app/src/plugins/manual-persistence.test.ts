import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { t } from "@situate/localization";
import { observeManualPersistence } from "./manual-persistence";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const persistence = {
  invocationId: "invocation-one",
  pluginId: "demo",
  error: "native.plugins.stateSaveFailed" as const,
};
let persistences: (typeof persistence)[];
let onError: ReturnType<typeof vi.fn<(error: unknown) => void>>;
const observers: ReturnType<typeof observeManualPersistence>[] = [];
function observe(isCurrent = () => true) {
  const observer = observeManualPersistence("scope", isCurrent, onError);
  observers.push(observer);
  return observer;
}
function button(key: Parameters<typeof t>[0]) {
  const element = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === t(key),
  );
  expect(element).toBeDefined();
  return element!;
}
beforeEach(() => {
  vi.resetAllMocks();
  persistences = [];
  onError = vi.fn();
  mocks.invoke.mockImplementation(async (_command, { request }) => {
    if (request.operation === "pendingPersistences") return persistences;
    if (request.operation === "retryPersistence")
      return { outcome: "completed", value: { saved: true } };
    throw new Error("Unexpected native command");
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  for (const observer of observers.splice(0)) observer.dispose();
  expect(document.querySelector("dialog")).toBeNull();
});

describe("manual plugin persistence recovery", () => {
  it("queries only retained persistence and keeps recovery failures observable", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("native.plugins.unavailable"));
    await expect(observe().ready).rejects.toThrow("native.plugins.unavailable");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("plugin_executor", {
      scope: "scope",
      request: { operation: "pendingPersistences" },
    });
    expect(document.querySelector("dialog")).toBeNull();
  });

  it.each(["disposal", "workspace change"])(
    "ignores recovery replies after %s",
    async (reason) => {
      let finish!: (value: unknown) => void;
      mocks.invoke.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      let current = true;
      const observer = observe(() => current);
      if (reason === "disposal") observer.dispose();
      else current = false;
      finish([persistence]);
      await observer.ready;
      await flushPromises();
      expect(document.querySelector("dialog")).toBeNull();
      await expect(
        observer.unwrap({ outcome: "completed", value: 1 }, "demo"),
      ).rejects.toThrow("plugins.workspaceUnavailable");
      observer.dispose();
      expect(mocks.invoke).toHaveBeenCalledOnce();
    },
  );

  it("dismisses a save dialog on Escape without repeating effects or retrying", async () => {
    const observer = observe();
    await observer.ready;
    const pending = observer.unwrap(
      {
        outcome: "pendingPersistence",
        invocationId: persistence.invocationId,
        error: persistence.error,
      },
      "demo",
    );
    const rejection = expect(pending).rejects.toThrow(persistence.error);
    await flushPromises();
    document
      .querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }));
    await rejection;
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("rejects mismatched persistence receipts without replaying an invocation", async () => {
    const observer = observe();
    await observer.ready;
    const pending = observer.unwrap(
      {
        outcome: "pendingPersistence",
        invocationId: persistence.invocationId,
        error: persistence.error,
      },
      "demo",
    );
    const rejection = expect(pending).rejects.toThrow(
      "native.plugins.stateOutcomeUnknown",
    );
    mocks.invoke.mockResolvedValueOnce({
      outcome: "pendingPersistence",
      invocationId: "other",
      error: persistence.error,
    });
    await flushPromises();
    button("files.retrySaves").click();
    await rejection;
    await flushPromises();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      mocks.invoke.mock.calls.map(([, { request }]) => request.operation),
    ).toEqual(["pendingPersistences", "retryPersistence"]);
  });

  it("unwraps completed values without presenting another action", async () => {
    const observer = observe();
    await observer.ready;
    expect(
      await observer.unwrap(
        { outcome: "completed", value: { content: ["observed"] } },
        "demo",
      ),
    ).toEqual({ content: ["observed"] });
    expect(document.querySelector("dialog")).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("plugin_executor", {
      scope: "scope",
      request: { operation: "pendingPersistences" },
    });
  });

  it("returns the observed value after an explicit save-only retry", async () => {
    const observer = observe();
    await observer.ready;
    const pending = observer.unwrap(
      {
        outcome: "pendingPersistence",
        invocationId: persistence.invocationId,
        error: persistence.error,
      },
      "demo",
    );
    const finished = vi.fn();
    void pending.then(finished);
    await flushPromises();
    expect(finished).not.toHaveBeenCalled();
    button("files.retrySaves").click();
    expect(await pending).toEqual({ saved: true });
    expect(mocks.invoke).toHaveBeenLastCalledWith("plugin_executor", {
      scope: "scope",
      request: {
        operation: "retryPersistence",
        invocationId: "invocation-one",
      },
    });
    expect(
      mocks.invoke.mock.calls.some(
        ([, { request }]) => request.operation === "invoke",
      ),
    ).toBe(false);
  });

  it("leaves persistence retained on decline and rejects the original call", async () => {
    const observer = observe();
    await observer.ready;
    const pending = observer.unwrap(
      {
        outcome: "pendingPersistence",
        invocationId: persistence.invocationId,
        error: persistence.error,
      },
      "demo",
    );
    const rejection = expect(pending).rejects.toThrow(persistence.error);
    await flushPromises();
    button("pluginManagement.uninstall.close").click();
    await rejection;
    expect(
      mocks.invoke.mock.calls.filter(
        ([, { request }]) => !request.operation.startsWith("pending"),
      ),
    ).toHaveLength(0);
  });

  it("recovers retained persistence without loading or invoking service code", async () => {
    persistences = [persistence, persistence];
    await observe().ready;
    await flushPromises();
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    button("files.retrySaves").click();
    await flushPromises();
    expect(document.querySelector("dialog")).toBeNull();
    expect(
      mocks.invoke.mock.calls.some(
        ([, { request }]) => request.operation === "invoke",
      ),
    ).toBe(false);
  });

  it("requires another explicit decision if saving remains pending", async () => {
    const observer = observe();
    await observer.ready;
    const reply = {
      outcome: "pendingPersistence",
      invocationId: persistence.invocationId,
      error: persistence.error,
    };
    mocks.invoke.mockResolvedValueOnce(reply);
    const pending = observer.unwrap(reply, "demo");
    await flushPromises();
    button("files.retrySaves").click();
    await flushPromises();
    expect(document.querySelector("dialog")).not.toBeNull();
    expect(
      mocks.invoke.mock.calls.filter(
        ([, { request }]) => request.operation === "retryPersistence",
      ),
    ).toHaveLength(1);
    button("files.retrySaves").click();
    expect(await pending).toEqual({ saved: true });
  });

  it("propagates the original native terminal error after persistence instead of fabricating a value", async () => {
    const observer = observe();
    await observer.ready;
    const pending = observer.unwrap(
      {
        outcome: "pendingPersistence",
        invocationId: persistence.invocationId,
        error: persistence.error,
      },
      "demo",
    );
    const rejection = expect(pending).rejects.toThrow(
      "native.plugins.unavailable",
    );
    await flushPromises();
    mocks.invoke.mockRejectedValueOnce(new Error("native.plugins.unavailable"));
    button("files.retrySaves").click();
    await rejection;
    await flushPromises();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("rejects waiting callers on disposal without sending a save or effect request", async () => {
    const observer = observe();
    await observer.ready;
    const pending = observer.unwrap(
      {
        outcome: "pendingPersistence",
        invocationId: persistence.invocationId,
        error: persistence.error,
      },
      "demo",
    );
    const rejection = expect(pending).rejects.toThrow(
      "plugins.workspaceUnavailable",
    );
    observer.dispose();
    await rejection;
    expect(
      mocks.invoke.mock.calls.every(([, { request }]) =>
        request.operation.startsWith("pending"),
      ),
    ).toBe(true);
  });
});
