import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startExecutorWorker } from "./executor-worker";
import type { ExecutorCommand, ExecutorEvent } from "./executor-protocol";

beforeEach(() => vi.stubGlobal("document", undefined));
afterEach(() => vi.unstubAllGlobals());

function worker() {
  let receive!: (command: ExecutorCommand) => void;
  const send = vi.fn<(event: ExecutorEvent) => void>();
  startExecutorWorker({ send, receive: (handler) => (receive = handler) });
  receive({
    type: "load",
    generation: 1,
    pluginId: "archive",
    source: {
      manifest: {
        schemaVersion: 3,
        id: "archive",
        name: "Archive",
        description: "Test source",
        skills: [],
      },
      serviceEntry: null,
      uiEntry: null,
      modules: {},
      skills: [],
    },
  });
  send.mockClear();
  function check(invocationId: string, script: string) {
    receive({
      type: "invoke",
      generation: 1,
      invocationId,
      kind: "check",
      name: "",
      args: {},
      script,
    });
  }
  return { receive, check, send };
}

it("passes only the requested document location and headers to the host", async () => {
  const { receive, check, send } = worker();
  check(
    "check",
    `
    const first = await host.documents.fromFile("/fixture/receipt.pdf");
    assert.equal(first, { size: 7 });
    const second = await host.documents.fromHttp({ url: "https://example.invalid/receipt" });
    assert.equal(second, { size: 8 });
    const third = await host.documents.fromHttp({ url: "https://example.invalid/scan", headers: { Accept: "image/png" } });
    assert.equal(third, { size: 9 });
  `,
  );
  const requests = [
    { operation: "documentFromFile", path: "/fixture/receipt.pdf" },
    {
      operation: "documentFromHttp",
      url: "https://example.invalid/receipt",
      headers: {},
    },
    {
      operation: "documentFromHttp",
      url: "https://example.invalid/scan",
      headers: { Accept: "image/png" },
    },
  ];
  for (const [index, request] of requests.entries()) {
    const requestId = String(index + 1);
    await vi.waitFor(() =>
      expect(send).toHaveBeenNthCalledWith(index + 1, {
        type: "host",
        generation: 1,
        invocationId: "check",
        requestId,
        request,
      }),
    );
    receive({
      type: "hostReply",
      generation: 1,
      invocationId: "check",
      requestId,
      result: { size: index + 7 },
    });
  }
  await vi.waitFor(() =>
    expect(send).toHaveBeenLastCalledWith({
      type: "result",
      generation: 1,
      invocationId: "check",
      result: { passed: true, assertions: 3 },
    }),
  );
});

it("aborts only the targeted invocation and discards late replies without publishing a result", async () => {
  const { receive, check, send } = worker();
  const script =
    'assert.equal(await host.documents.fromFile("/fixture/receipt.pdf"), { size: 7 });';
  check("cancelled", script);
  check("kept", script);
  expect(send).toHaveBeenCalledTimes(2);
  receive({ type: "abort", generation: 1, invocationId: "cancelled" });
  await vi.waitFor(() =>
    expect(send).toHaveBeenNthCalledWith(3, {
      type: "error",
      generation: 1,
      invocationId: "cancelled",
      error: "native.plugins.hostCancelled",
    }),
  );
  receive({
    type: "hostReply",
    generation: 1,
    invocationId: "cancelled",
    requestId: "1",
    result: { size: 7 },
  });
  receive({
    type: "hostReply",
    generation: 1,
    invocationId: "kept",
    requestId: "2",
    result: { size: 7 },
  });
  await vi.waitFor(() =>
    expect(send).toHaveBeenNthCalledWith(4, {
      type: "result",
      generation: 1,
      invocationId: "kept",
      result: { passed: true, assertions: 1 },
    }),
  );
  expect(send).toHaveBeenCalledTimes(4);
});
