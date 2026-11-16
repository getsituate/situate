import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Agent, createServer, get } from "node:https";
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

test("TLS probes do not reuse a private connection for the public reference address", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-routing-tls-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = join(directory, "key.pem"),
    certificate = join(directory, "cert.pem");
  const generated = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore", timeout: 10000, env: { PATH: process.env.PATH } },
  );
  assert.equal(
    generated.status,
    0,
    "Synthetic TLS certificate generation failed",
  );
  const cert = readFileSync(certificate);
  const fixtureData = fixture();
  const identity = fixtureData.replies[0].bytes;
  const feed = fixtureData.replies[2].bytes;
  const references = new WeakMap();
  let publicDestination = false,
    publicLookups = 0;
  const server = createServer(
    { key: readFileSync(key), cert },
    (request, response) => {
      const isPublic = references.get(request.socket);
      if (request.url === fixtureData.config.identityPath) {
        response.writeHead(isPublic ? 404 : 200);
        response.end(isPublic ? "" : identity);
      } else {
        response.writeHead(200);
        response.end(feed);
      }
    },
  );
  server.on("secureConnection", (socket) =>
    references.set(socket, publicDestination),
  );
  const agent = new Agent({ keepAlive: true });
  t.after(async () => {
    agent.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const config = {
    ...fixtureData.config,
    endpoint: `https://localhost:${server.address().port}/releases/current/update.json`,
    publicAddress: "192.0.2.1",
  };
  const adapter = createQualificationRouting(config, {
    resolve: async () => [{ address: config.privateAddress }],
    execute: async () => "interface: lo0\n",
    request: (url, options, callback) =>
      get(
        url,
        {
          ...options,
          ca: cert,
          agent: options.agent === false ? false : agent,
          lookup: (name, lookupOptions, done) => {
            publicDestination = Boolean(options.lookup);
            if (options.lookup) {
              publicLookups++;
              options.lookup(name, lookupOptions, (_error, result) => {
                assert.equal(
                  lookupOptions.all ? result[0].address : result,
                  config.publicAddress,
                );
              });
            }
            // Both logical destinations use this listener; each socket retains its resolved role.
            done(
              null,
              lookupOptions.all
                ? [{ address: "127.0.0.1", family: 4 }]
                : "127.0.0.1",
              4,
            );
          },
        },
        callback,
      ),
  });
  assert.equal((await adapter.inspect()).publicPointerUnchanged, true);
  assert.equal(publicLookups, 2);
});

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
        call.options.agent === false &&
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

test("routing failures retain their exact check phase without changing failure messages", async () => {
  for (const phase of [
    "dns",
    "interface",
    "private-identity",
    "public-isolation",
    "public-feed",
  ]) {
    const f = fixture();
    if (phase === "dns") f.state.address = f.config.publicAddress;
    else if (phase === "interface") f.state.interface = "en0";
    else {
      const index = {
        "private-identity": 0,
        "public-isolation": 1,
        "public-feed": 2,
      }[phase];
      f.replies[index] = { status: 200, bytes: "synthetic mismatched bytes" };
    }
    await assert.rejects(f.adapter.inspect(), (error) => {
      assert.equal(error.qualificationRoutingPhase, phase);
      assert.match(
        error.message,
        /restricted|routed|identity differs|probe failed|feed changed/,
      );
      return true;
    });
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
