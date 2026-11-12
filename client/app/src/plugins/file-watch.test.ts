import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchPluginFiles } from "./file-watch";
import type { PluginFileEntry } from "./types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const entry = (path: string, changeToken: string): PluginFileEntry => ({
  path,
  changeToken,
});

it("announces the initial set and only invalidates added, changed and deleted paths", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce([entry("a.md", "a1"), entry("b.md", "b1")])
    .mockResolvedValueOnce([entry("a.md", "a1"), entry("b.md", "b1")])
    .mockResolvedValueOnce([entry("b.md", "b2"), entry("c.md", "c1")]);
  const listener = vi.fn();
  const query = { roots: ["Notes"], extensions: [".md"] };
  const stop = await watchPluginFiles(
    list,
    query,
    listener,
    new AbortController().signal,
  );
  query.roots[0] = "Elsewhere";
  expect(listener.mock.calls).toEqual([
    [
      {
        type: "reset",
        files: [entry("a.md", "a1"), entry("b.md", "b1")],
      },
    ],
  ]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenLastCalledWith({
    type: "changed",
    paths: ["b.md", "c.md"],
    deleted: ["a.md"],
  });
  expect(list).toHaveBeenLastCalledWith(
    { roots: ["Notes"], extensions: [".md"] },
    expect.any(AbortSignal),
  );
  stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(list).toHaveBeenCalledTimes(3);
});

it.each(["stop", "caller", "lifecycle"])(
  "cancels an in-flight poll on %s without delivering late changes",
  async (mode) => {
    const lifecycle = new AbortController();
    const caller = new AbortController();
    let finish!: (files: PluginFileEntry[]) => void;
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<PluginFileEntry[]>((resolve) => {
            finish = resolve;
          }),
      );
    const listener = vi.fn();
    const stop = await watchPluginFiles(
      list,
      {},
      listener,
      lifecycle.signal,
      caller.signal,
    );
    await vi.advanceTimersByTimeAsync(1000);
    if (mode === "stop") stop();
    if (mode === "caller") caller.abort();
    if (mode === "lifecycle") lifecycle.abort();
    expect(list.mock.calls[1][1].aborted).toBe(true);
    finish([entry("late.md", "late")]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
  },
);

it("does not overlap polls or asynchronous listeners", async () => {
  let finishRead!: (files: PluginFileEntry[]) => void;
  let finishListener!: () => void;
  const list = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockImplementationOnce(
      () =>
        new Promise<PluginFileEntry[]>((resolve) => {
          finishRead = resolve;
        }),
    )
    .mockResolvedValue([]);
  const listener = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishListener = resolve;
        }),
    );
  const stop = await watchPluginFiles(
    list,
    {},
    listener,
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(list).toHaveBeenCalledTimes(2);
  finishRead([entry("a.md", "a1")]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(2);
  finishListener();
  await vi.advanceTimersByTimeAsync(1000);
  expect(list).toHaveBeenCalledTimes(3);
  stop();
});

it.each(["native.plugins.stateConflict", new Error("private content")])(
  "reports a failed poll and stops instead of publishing an empty set: %s",
  async (failure) => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([entry("a.md", "a1")])
      .mockRejectedValueOnce(failure);
    const listener = vi.fn();
    await watchPluginFiles(list, {}, listener, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).toHaveBeenLastCalledWith({
      type: "error",
      message:
        typeof failure === "string" ? failure : "native.plugins.hostFailed",
    });
    expect(list).toHaveBeenCalledTimes(2);
  },
);

it("rejects a failed initial scan without leaving a subscription", async () => {
  const list = vi.fn().mockRejectedValue("native.plugins.invalidPath");
  const listener = vi.fn();
  await expect(
    watchPluginFiles(list, {}, listener, new AbortController().signal),
  ).rejects.toBe("native.plugins.invalidPath");
  await vi.advanceTimersByTimeAsync(5000);
  expect(list).toHaveBeenCalledTimes(1);
  expect(listener).not.toHaveBeenCalled();
});

it("rejects an asynchronous initial listener failure without leaving a poll", async () => {
  const list = vi.fn().mockResolvedValue([]);
  const listener = vi.fn().mockRejectedValue(new Error("initial listener"));
  await expect(
    watchPluginFiles(list, {}, listener, new AbortController().signal),
  ).rejects.toThrow("initial listener");
  await vi.advanceTimersByTimeAsync(5000);
  expect(list).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("rejects already-aborted subscriptions and stops after a listener throws", async () => {
  const controller = new AbortController();
  controller.abort();
  const list = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([entry("a.md", "a1")]);
  const listener = vi
    .fn()
    .mockImplementationOnce(() => undefined)
    .mockImplementationOnce(() => {
      throw new Error("listener");
    });
  await expect(
    watchPluginFiles(list, {}, listener, controller.signal),
  ).rejects.toThrow();
  expect(list).not.toHaveBeenCalled();
  await watchPluginFiles(list, {}, listener, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5000);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(2);
});
