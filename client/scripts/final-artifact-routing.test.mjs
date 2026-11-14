import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createQualificationRouting } from "./final-artifact-routing.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const identity = JSON.stringify({ operationId: "synthetic-operation" });
  const publicFeed = JSON.stringify({
    version: "0.1.5",
    platforms: {
      "darwin-aarch64": {
        signature: "U3ludGhldGljQXJt",
        url: "https://example.com/arm.tar.gz",
      },
      "darwin-x86_64": {
        signature: "U3ludGhldGljSW50ZWw=",
        url: "https://example.com/intel.tar.gz",
      },
    },
    notes: "Synthetic predecessor notes",
  });
  const config = {
    endpoint: "https://example.com/releases/current/update.json",
    privateAddress: "127.0.0.1",
    publicAddress: "93.184.215.14",
    interface: "lo0",
    identityPath: "/private-qualification/identity.json",
    identitySha256: sha(identity),
    publicFeedSha256: sha(publicFeed),
    operationId: "synthetic-operation",
  };
  const replies = [
    { status: 200, bytes: identity },
    { status: 404, bytes: "" },
    { status: 200, bytes: publicFeed },
  ];
  const calls = [];
  const state = { address: config.privateAddress, interface: "lo0" };
  const request = (url, options, callback) => {
    calls.push({ url, options });
    const req = new EventEmitter();
    req.destroy = (error) => req.emit("error", error);
    queueMicrotask(() => {
      const reply = replies.shift();
      const response = Readable.from([Buffer.from(reply.bytes)]);
      response.statusCode = reply.status;
      callback(response);
    });
    return req;
  };
  return {
    config,
    replies,
    calls,
    state,
    adapter: createQualificationRouting(config, {
      resolve: async () => [{ address: state.address }],
      execute: async () => `interface: ${state.interface}\n`,
      request,
    }),
  };
}

test("routing inspects OS resolution/interface, private TLS identity and unchanged public feed", async () => {
  const { adapter, calls, config } = fixture();
  assert.deepEqual(await adapter.inspect(), {
    endpoint: config.endpoint,
    publicVersion: "0.1.5",
    publicSignatures: {
      "darwin-aarch64": "U3ludGhldGljQXJt",
      "darwin-x86_64": "U3ludGhldGljSW50ZWw=",
    },
    isolatedRouting: true,
    normalTls: true,
    publicPointerUnchanged: true,
  });
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (call) =>
        call.options.rejectUnauthorized === true &&
        call.url.hostname === "example.com",
    ),
  );
  assert.equal(calls[0].options.lookup, undefined);
  let publicAddress;
  calls[2].options.lookup("example.com", { all: true }, (_error, values) => {
    publicAddress = values[0].address;
  });
  assert.equal(publicAddress, config.publicAddress);
});

test("routing rejects public DNS leakage and unrestricted interface before HTTPS probes", async () => {
  for (const change of [{ address: "93.184.215.14" }, { interface: "en0" }]) {
    const { adapter, state, calls } = fixture();
    Object.assign(state, change);
    await assert.rejects(adapter.inspect(), /restricted|routed/);
    assert.equal(calls.length, 0);
  }
});

test("routing rejects wrong private identity, publicly exposed listener and changed public pointer", async () => {
  for (const [index, replacement] of [
    [0, { status: 200, bytes: "different private identity" }],
    [1, { status: 200, bytes: "exposed" }],
    [2, { status: 200, bytes: "changed public feed" }],
  ]) {
    const { adapter, replies } = fixture();
    replies[index] = replacement;
    await assert.rejects(
      adapter.inspect(),
      /identity differs|probe failed|feed changed/,
    );
  }
});
