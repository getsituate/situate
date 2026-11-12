import test from "node:test";
import assert from "node:assert/strict";
import {
  startAgentProvider,
  PINNED_AGENT_MODEL,
} from "./agent-e2e-provider.mjs";
import { responseEvents } from "./agent-e2e-fixture.mjs";

const body = (extra = {}) => ({
  model: PINNED_AGENT_MODEL,
  stream: true,
  max_output_tokens: 128,
  input: [{ role: "user", content: "Hello" }],
  ...extra,
});
const final = {
  type: "message",
  id: "msg_test",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text: "Hello", annotations: [] }],
};
function upstream() {
  return new Response(responseEvents(final, PINNED_AGENT_MODEL, 1), {
    headers: {
      "content-type": "text/event-stream",
      "x-request-id": "req_test",
    },
  });
}
async function start(t, options = {}) {
  const broker = await startAgentProvider(options);
  t.after(() => broker.close());
  return broker;
}
function post(broker, value = body(), token = broker.token, path = broker.url) {
  return fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
}
function events(payload) {
  return payload
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

test("fixture HTTP effects use a separate bounded capability without provider credentials or request budget", async (t) => {
  const broker = await start(t);
  const other = await start(t);
  assert.notEqual(broker.pluginEffectsUrl, other.pluginEffectsUrl);
  assert.match(
    broker.pluginEffectsUrl,
    /^http:\/\/127\.0\.0\.1:\d+\/effects\/[a-f0-9]{48}$/,
  );
  assert.ok(!broker.pluginEffectsUrl.includes(broker.token));
  for (const [method, value, headers, status] of [
    ["PUT", '{"fixture":"plugins"}', {}, 405],
    ["POST", "{}", {}, 400],
    ["DELETE", "x".repeat(65), {}, 413],
    [
      "POST",
      '{"fixture":"plugins"}',
      { authorization: `Bearer ${broker.token}` },
      403,
    ],
  ]) {
    const response = await fetch(broker.pluginEffectsUrl, {
      method,
      body: value,
      headers,
    });
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes(broker.token));
  }
  assert.deepEqual(broker.report().pluginEffects, { POST: 0, DELETE: 0 });
  for (const method of ["POST", "DELETE", "POST"]) {
    const response = await fetch(broker.pluginEffectsUrl, {
      method,
      body: '{"fixture":"plugins"}',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { effect: method });
  }
  assert.deepEqual(broker.report().pluginEffects, { POST: 2, DELETE: 1 });
  assert.equal(broker.report().requests, 0);
  assert.deepEqual(broker.report().records, []);
  assert.equal((await post(broker, body(), "not-the-token")).status, 401);
  assert.equal((await post(broker)).status, 200);
  const live = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "synthetic",
    testTransport: () => assert.fail("unexpected upstream call"),
  });
  assert.equal(live.pluginEffectsUrl, undefined);
  assert.equal(
    (
      await post(
        live,
        body(),
        live.token,
        new URL(new URL(broker.pluginEffectsUrl).pathname, live.url),
      )
    ).status,
    404,
  );
  assert.equal(live.report().requests, 0);
});

test("fixture Responses wire covers text, file-tool round trips and pathological usage", async (t) => {
  const broker = await start(t);
  const input = [{ role: "user", content: "[e2e:greeting] Hello." }];
  const invoke = async () => {
    const response = await post(
      broker,
      body({ input, store: false, max_output_tokens: 1024 }),
    );
    assert.equal(response.status, 200);
    const observed = events(await response.text());
    assert.equal(observed[0].type, "response.created");
    assert.equal(observed.at(-1).type, "response.completed");
    assert.deepEqual(
      observed.map(({ sequence_number }) => sequence_number),
      observed.map((_, index) => index),
    );
    const reply = observed.at(-1).response;
    assert.equal(reply.model, PINNED_AGENT_MODEL);
    assert.equal(reply.status, "completed");
    assert.deepEqual(reply.usage, {
      input_tokens: 1000003,
      input_tokens_details: { cached_tokens: 17 },
      output_tokens: 997,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 1001000,
    });
    assert.deepEqual(
      observed.find(({ type }) => type === "response.output_item.done").item,
      reply.output[0],
    );
    input.push(...reply.output);
    return { reply, observed };
  };
  const greeting = await invoke();
  assert.equal(greeting.reply.output[0].type, "message");
  const text = greeting.observed.find(
    ({ type }) => type === "response.output_text.delta",
  );
  assert.equal(text.delta, greeting.reply.output[0].content[0].text);
  for (const [marker, names] of [
    ["create", ["ls", "read", "write", "read"]],
    ["edit", ["read", "edit", "read"]],
  ]) {
    input.push({ role: "user", content: `[e2e:${marker}]` });
    for (const name of names) {
      const { reply, observed } = await invoke();
      const call = reply.output[0];
      assert.equal(call.type, "function_call");
      assert.equal(call.name, name);
      assert.equal(
        observed.find(
          ({ type }) => type === "response.function_call_arguments.delta",
        ).delta,
        call.arguments,
      );
      assert.equal(
        observed.find(
          ({ type }) => type === "response.function_call_arguments.done",
        ).arguments,
        call.arguments,
      );
      if (name === "edit")
        assert.equal(
          JSON.parse(call.arguments).expectedRevision,
          "fixture-tool-revision",
        );
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify({
          revision: "fixture-tool-revision",
          text: "Synthetic note",
        }),
      });
    }
    assert.equal((await invoke()).reply.output[0].type, "message");
  }
  assert.equal(broker.report().requests, 10);
});

test("live requires explicit permission and key", async () => {
  await assert.rejects(
    startAgentProvider({ mode: "openai", apiKey: "secret" }),
    /live_blocked/,
  );
  await assert.rejects(
    startAgentProvider({ mode: "openai", allowLive: true }),
    /live_blocked/,
  );
  await assert.rejects(
    startAgentProvider({ limits: { maxRequests: 65 } }),
    /invalid_limit/,
  );
});

test("loopback endpoint rejects malformed auth and other routes", async (t) => {
  const broker = await start(t);
  assert.equal(new URL(broker.url).hostname, "127.0.0.1");
  for (const token of ["", "wrong", broker.token.slice(1), ` ${broker.token}`])
    assert.equal((await post(broker, body(), token)).status, 401);
  assert.equal(
    (
      await post(
        broker,
        body(),
        broker.token,
        broker.baseUrl + "/chat/completions",
      )
    ).status,
    404,
  );
  assert.equal(broker.report().requests, 0);
});

test("fixture create and edit follow tool outputs, not global request order", async (t) => {
  const broker = await start(t);
  const run = async (prompt, expectedNames) => {
    const input = [{ role: "user", content: prompt }];
    for (const expected of [...expectedNames, null]) {
      const response = await post(broker, body({ input }));
      assert.equal(response.status, 200);
      const stream = events(await response.text());
      assert.equal(stream[0].type, "response.created");
      const complete = stream.at(-1);
      assert.equal(complete.type, "response.completed");
      assert.equal(complete.response.usage.input_tokens, 1000003);
      const item = complete.response.output[0];
      if (expected === null) {
        assert.equal(item.type, "message");
        break;
      }
      assert.equal(item.name, expected);
      const args = JSON.parse(item.arguments);
      if (expected === "write") {
        assert.equal(args.text, "# E2E note\n\nAlpha marker\n");
        assert.equal(args.expectedRevision, null);
      }
      if (expected === "edit")
        assert.deepEqual(args, {
          path: "e2e-note.md",
          expectedRevision: "actual-storage-revision",
          edits: [{ oldText: "Alpha marker", newText: "Beta marker" }],
        });
      input.push(item, {
        type: "function_call_output",
        call_id: item.call_id,
        output: JSON.stringify({
          revision: "actual-storage-revision",
          text: "synthetic note",
        }),
      });
      assert.equal((await post(broker)).status, 200);
    }
  };
  await run("[e2e:create]", ["ls", "read", "write", "read"]);
  await run("[e2e:edit]", ["read", "edit", "read"]);
});

test("model, input, output, body and tools are rejected before forwarding", async (t) => {
  let calls = 0;
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "secret",
    limits: { maxBodyBytes: 1024, maxInputTokens: 512 },
    testTransport: async () => {
      calls++;
      return upstream();
    },
  });
  for (const value of [
    body({ model: "other" }),
    body({ max_output_tokens: 1025 }),
    body({ max_output_tokens: undefined }),
    body({ input: "x".repeat(513) }),
    body({ input: "x".repeat(1200) }),
    body({ tools: [{ type: "function", name: "shell" }] }),
    body({ tools: [{ type: "function", name: "start_plugin_development" }] }),
    body({ tools: [{ type: "function", name: "send_email" }] }),
    body({ tools: [{ type: "function", name: "inspect_plugin" }] }),
    body({ tools: [{ type: "web_search" }] }),
  ])
    assert.notEqual((await post(broker, value)).status, 200);
  assert.equal(calls, 0);
});

test("onboarding and navigation tools retain the bounded local-tool live contract", async (t) => {
  const received = [];
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "synthetic-test-key",
    testTransport: async (_url, options) => {
      received.push(JSON.parse(options.body).tools);
      return upstream();
    },
  });
  const tools = [
    "propose_working_method",
    "show_imported_files",
    "create_batch",
    "open_view",
    "reveal_content",
    "open_conversation",
  ].map((name) => ({ type: "function", name }));
  assert.equal((await post(broker, body({ tools }))).status, 200);
  assert.deepEqual(received, [tools]);
});

test("upstream is fixed HTTPS, redirects forbidden, budgets survive new client connections", async (t) => {
  let calls = 0;
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "private-key",
    limits: { maxTotalOutputTokens: 256 },
    testTransport: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.authorization, "Bearer private-key");
      return upstream();
    },
  });
  assert.equal((await post(broker)).status, 200);
  assert.equal((await post(broker)).status, 200);
  assert.equal((await post(broker)).status, 429);
  assert.equal(calls, 2);
  const report = broker.report();
  assert.equal(report.reservedOutputTokens, 256);
  assert.equal(report.records[0].requestId, "req_test");
  assert.equal(JSON.stringify(report).includes("private-key"), false);
  assert.equal(JSON.stringify(report).includes("Hello"), false);
});

test("failed upstream never retries, refunds budgets, or exposes private errors", async (t) => {
  let calls = 0;
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "private-key",
    limits: { maxRequests: 1 },
    testTransport: async () => {
      calls++;
      throw Object.assign(new Error("private-key raw private body"), {
        code: "private_key",
      });
    },
  });
  const response = await post(broker);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: { code: "upstream_failure" },
  });
  assert.equal((await post(broker)).status, 429);
  assert.equal(calls, 1);
  assert.equal(broker.report().records[0].outcome, "upstream_failure");
});

test("rejects redirects and oversized upstream streams without retry", async (t) => {
  for (const response of [
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.example" },
    }),
    new Response("x".repeat(150), {
      headers: { "content-type": "text/event-stream" },
    }),
  ]) {
    let calls = 0;
    const broker = await start(t, {
      mode: "openai",
      allowLive: true,
      apiKey: "secret",
      limits: { maxResponseBytes: 100 },
      testTransport: async () => {
        calls++;
        return response;
      },
    });
    assert.equal((await post(broker)).status, 502);
    assert.equal(calls, 1);
  }
});

test("fixture barriers support concurrency refusal, release and cancellation", async (t) => {
  const broker = await start(t, { limits: { maxConcurrency: 1 } });
  const pending = post(broker, body({ input: "[e2e:queue]" }));
  await broker.control.waitFor("[e2e:queue]");
  assert.equal((await post(broker)).status, 429);
  const controlUrl = new URL("/control", broker.url).href;
  assert.equal(
    (
      await post(
        broker,
        { action: "release", marker: "[e2e:queue]" },
        broker.token,
        controlUrl,
      )
    ).status,
    200,
  );
  assert.equal((await pending).status, 200);
  const controller = new AbortController();
  const stopped = fetch(broker.url, {
    method: "POST",
    headers: { authorization: `Bearer ${broker.token}` },
    body: JSON.stringify(body({ input: "[e2e:stop]" })),
    signal: controller.signal,
  });
  await broker.control.waitFor("[e2e:stop]");
  controller.abort();
  await assert.rejects(stopped);
  await broker.close();
  assert.equal(broker.report().active, 0);
  assert.equal(broker.report().records.at(-1).outcome, "aborted");
});

test("consumed steering and follow-up do not replay an earlier barrier", async (t) => {
  const broker = await start(t);
  const first = post(broker, body({ input: "[e2e:consume]" }));
  await broker.control.waitFor("[e2e:consume]");
  broker.control.release("[e2e:consume]");
  assert.equal((await first).status, 200);
  const response = await post(
    broker,
    body({
      input: [
        { role: "user", content: "[e2e:consume]" },
        { role: "assistant", content: "Acknowledged." },
        { role: "user", content: "[e2e:followup]" },
      ],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(broker.report().records.at(-1).scenario, "followup");
});

test("deadline aborts upstream and retained run refuses subsequent requests", async (t) => {
  let calls = 0;
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "secret",
    limits: { deadlineMs: 40 },
    testTransport: async (_, options) => {
      calls++;
      return new Promise((_, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    },
  });
  assert.equal((await post(broker)).status, 502);
  assert.equal((await post(broker)).status, 429);
  assert.equal(calls, 1);
});

test("child request metadata takes precedence over markers in quoted context", async (t) => {
  const broker = await start(t);
  for (const kind of ["comment", "compaction", "title"]) {
    const response = await fetch(broker.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${broker.token}`,
        "x-situate-test-kind": kind,
      },
      body: JSON.stringify(body({ input: "[e2e:create] [e2e:stop]" })),
    });
    assert.equal(response.status, 200);
    const item = events(await response.text()).at(-1).response.output[0];
    assert.equal(item.type, "message");
    assert.equal(broker.report().records.at(-1).kind, kind);
  }
});

test("image wire evidence is counted without retaining image data", async (t) => {
  const broker = await start(t);
  const response = await post(
    broker,
    body({
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "[e2e:image]" },
            {
              type: "input_image",
              image_url: "data:image/png;base64,cHJpdmF0ZQ==",
            },
          ],
        },
      ],
    }),
  );
  assert.equal(response.status, 200);
  const report = broker.report();
  assert.equal(report.records[0].inputImages, 1);
  assert.equal(report.records[0].scenario, "image");
  assert.equal(JSON.stringify(report).includes("cHJpdmF0ZQ=="), false);
});

test("fixture permits synthetic attachment size while live retains strict ceilings", async (t) => {
  await assert.rejects(
    startAgentProvider({
      mode: "openai",
      allowLive: true,
      apiKey: "secret",
      limits: { maxBodyBytes: 32 * 1024 * 1024 },
    }),
    /invalid_limit/,
  );
  const broker = await start(t, {
    limits: {
      maxRequests: 64,
      deadlineMs: 300000,
      maxBodyBytes: 32 * 1024 * 1024,
    },
  });
  assert.equal(
    (
      await post(
        broker,
        body({ input: "[e2e:long] " + "context ".repeat(300000) }),
      )
    ).status,
    200,
  );
  assert.equal(broker.report().records[0].usage.output_tokens, 128);
});

test("request budget denial is reported without private request data", async (t) => {
  const broker = await start(t, { limits: { maxRequests: 1 } });
  await post(broker);
  assert.equal((await post(broker)).status, 429);
  assert.equal(broker.report().budgetDenials, 1);
});

function gatedUpstream() {
  let streamController, upstreamSignal, markAborted;
  const aborted = new Promise((resolve) => {
    markAborted = resolve;
  });
  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
  });
  return {
    aborted,
    get signal() {
      return upstreamSignal;
    },
    push(text) {
      streamController.enqueue(Buffer.from(text));
    },
    close() {
      streamController.close();
    },
    transport: async (_, options) => {
      upstreamSignal = options.signal;
      upstreamSignal.addEventListener(
        "abort",
        () => {
          markAborted();
          streamController.error(new Error("cancelled"));
        },
        { once: true },
      );
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  };
}

const delta = 'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n';
const completion =
  'data: {"type":"response.completed","response":{"usage":{"input_tokens":41,"output_tokens":7,"total_tokens":48}}}\n\n';

test(
  "live delta arrives before upstream finishes and split usage is decoded incrementally",
  { timeout: 2000 },
  async (t) => {
    const source = gatedUpstream();
    const broker = await start(t, {
      mode: "openai",
      allowLive: true,
      apiKey: "secret",
      testTransport: source.transport,
    });
    source.push(delta);
    const response = await post(broker);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.equal(Buffer.from(first.value).toString(), delta);
    assert.equal(broker.report().records[0].outcome, "pending");
    source.push(completion.slice(0, 37));
    source.push(completion.slice(37));
    source.close();
    let remaining = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      remaining += Buffer.from(part.value).toString();
    }
    assert.equal(remaining, completion);
    assert.equal(broker.report().records[0].outcome, "completed");
    assert.deepEqual(broker.report().records[0].usage, {
      input_tokens: 41,
      output_tokens: 7,
      total_tokens: 48,
    });
  },
);

test(
  "client cancellation after first delta aborts upstream without refunding reservations",
  { timeout: 2000 },
  async (t) => {
    const source = gatedUpstream();
    const broker = await start(t, {
      mode: "openai",
      allowLive: true,
      apiKey: "secret",
      testTransport: source.transport,
    });
    source.push(delta);
    const response = await post(broker);
    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false);
    await reader.cancel();
    await source.aborted;
    assert.equal(source.signal.aborted, true);
    await broker.close();
    const report = broker.report();
    assert.equal(report.records[0].outcome, "aborted");
    assert.equal(report.records[0].streamInterrupted, true);
    assert.equal(report.reservedOutputTokens, 128);
    assert.ok(report.reservedInputTokens > 0);
  },
);

test(
  "partial stream failures remain failures after headers were sent",
  { timeout: 2000 },
  async (t) => {
    for (const outcome of [
      "incomplete_response",
      "response_limit",
      "upstream_event",
    ]) {
      const source = gatedUpstream();
      const broker = await start(t, {
        mode: "openai",
        allowLive: true,
        apiKey: "secret",
        limits: { maxResponseBytes: 200 },
        testTransport: source.transport,
      });
      source.push(delta);
      const response = await post(broker);
      const reader = response.body.getReader();
      await reader.read();
      if (outcome === "incomplete_response") source.close();
      else if (outcome === "response_limit") source.push("x".repeat(201));
      else
        source.push(
          'data: {"type":"response.failed","error":"private upstream detail"}\n\n',
        );
      await assert.rejects(reader.read());
      await broker.close();
      assert.equal(broker.report().records[0].outcome, outcome);
      assert.equal(broker.report().records[0].streamInterrupted, true);
      assert.equal(
        JSON.stringify(broker.report()).includes("private upstream detail"),
        false,
      );
    }
  },
);

test("cumulative input reservations and image restrictions apply before forwarding", async (t) => {
  let calls = 0;
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "secret",
    limits: { maxTotalInputTokens: 200 },
    testTransport: async () => {
      calls++;
      return upstream();
    },
  });
  assert.equal((await post(broker)).status, 200);
  assert.equal((await post(broker)).status, 429);
  assert.equal(calls, 1);
  assert.equal(
    broker.report().reservedInputTokens,
    Buffer.byteLength(JSON.stringify(body())),
  );
  const other = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "secret",
    testTransport: async () => {
      calls++;
      return upstream();
    },
  });
  for (const image_url of [
    "https://example.com/image.png",
    "data:image/png;base64,unknown",
  ]) {
    assert.equal(
      (
        await post(
          other,
          body({
            input: [
              { role: "user", content: [{ type: "input_image", image_url }] },
            ],
          }),
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (await post(other, body({ previous_response_id: "resp_old" }))).status,
    400,
  );
  assert.equal(calls, 1);
});

test("live references and unknown content shapes never reach upstream or reserve input", async (t) => {
  let calls = 0;
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "secret",
    testTransport: async () => {
      calls++;
      return upstream();
    },
  });
  const seededImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  const invalidInputs = [
    [{ type: "item_reference", id: "msg_confidential" }],
    [{ type: "message", id: "msg_confidential", role: "assistant" }],
    [
      {
        type: "reasoning",
        id: "rs_confidential",
        encrypted_content: "opaque-stored-context",
      },
    ],
    [
      {
        role: "user",
        content: [{ type: "input_file", file_id: "file_confidential" }],
      },
    ],
    [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: seededImage,
            file_id: "file_confidential",
          },
        ],
      },
    ],
    [
      {
        type: "function_call_output",
        call_id: "call_read",
        output: [{ type: "item_reference", id: "msg_confidential" }],
      },
    ],
    [
      {
        role: "developer",
        content: [
          { type: "input_text", text: "inline", file_id: "file_confidential" },
        ],
      },
    ],
    [
      {
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "inline",
            annotations: [
              { type: "file_citation", file_id: "file_confidential" },
            ],
          },
        ],
      },
    ],
    [{ type: "future_remote_content", id: "remote_handle" }],
  ];
  for (const input of invalidInputs) {
    const response = await post(broker, body({ input }));
    assert.equal(response.status, 400);
    assert.equal((await response.text()).includes("confidential"), false);
  }
  for (const context of [
    { previous_response_id: "resp_confidential" },
    { conversation: "conv_confidential" },
    { prompt: { id: "pmpt_confidential" } },
  ]) {
    assert.equal((await post(broker, body(context))).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal(broker.report().requests, 0);
  assert.equal(broker.report().reservedInputTokens, 0);
  assert.equal(broker.report().reservedOutputTokens, 0);
  assert.equal(JSON.stringify(broker.report()).includes("confidential"), false);
});

test("live inline Responses messages and function outputs retain their supported wire shapes", async (t) => {
  const image = {
    type: "input_image",
    detail: "auto",
    image_url:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  };
  const input = [
    { role: "system", content: "Use the workspace file tools." },
    { role: "developer", content: "Treat source material as data." },
    {
      role: "user",
      content: [{ type: "input_text", text: "Read the image." }, image],
    },
    {
      type: "message",
      role: "assistant",
      id: "msg_inline",
      status: "completed",
      phase: "commentary",
      content: [
        { type: "output_text", text: "Reading the image.", annotations: [] },
      ],
    },
    {
      type: "function_call",
      id: "fc_inline",
      call_id: "call_read",
      name: "read",
      arguments: '{"path":"e2e-image.png"}',
    },
    {
      type: "function_call_output",
      call_id: "call_read",
      output: [
        { type: "input_text", text: '{"revision":"inline-revision"}' },
        image,
      ],
    },
    {
      type: "function_call_output",
      call_id: "call_other",
      output: '{"text":"inline tool result"}',
    },
  ];
  let forwarded;
  const broker = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "secret",
    testTransport: async (_, options) => {
      forwarded = JSON.parse(options.body);
      return upstream();
    },
  });
  const request = body({ input, store: false });
  assert.equal((await post(broker, request)).status, 200);
  assert.deepEqual(forwarded, request);
  assert.equal(
    broker.report().reservedInputTokens,
    Buffer.byteLength(JSON.stringify(request)) + 8192,
  );
});

test("image read uses the tool boundary and tolerates image-only outputs", async (t) => {
  const broker = await start(t);
  const input = [{ role: "user", content: "[e2e:view] Read e2e-image.png." }];
  const first = await post(broker, body({ input }));
  assert.equal(first.status, 200);
  const call = events(await first.text()).at(-1).response.output[0];
  assert.equal(call.type, "function_call");
  assert.equal(call.name, "read");
  assert.deepEqual(JSON.parse(call.arguments), { path: "e2e-image.png" });
  const image = {
    type: "input_image",
    image_url: "data:image/png;base64,image-not-json",
  };
  for (const output of [
    [image],
    [image, { type: "input_text", text: '{"revision":"image-revision"}' }],
  ]) {
    const response = await post(
      broker,
      body({
        input: [
          ...input,
          call,
          { type: "function_call_output", call_id: call.call_id, output },
        ],
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(
      events(await response.text()).at(-1).response.output[0].type,
      "message",
    );
    assert.equal(broker.report().records.at(-1).scenario, "view");
    assert.equal(broker.report().records.at(-1).inputImages, 1);
  }
  const failed = await post(
    broker,
    body({
      input: [
        ...input,
        call,
        {
          type: "function_call_output",
          call_id: call.call_id,
          output: [{ type: "input_text", text: '{"error":"read failed"}' }],
        },
      ],
    }),
  );
  assert.equal(failed.status, 502);
});

test("authenticated fixture control waits for provider arrival without spending request budget", async (t) => {
  const broker = await start(t, { limits: { maxRequests: 1 } });
  const controlUrl = new URL("/control", broker.url).href;
  assert.equal(
    (
      await post(
        broker,
        { action: "wait", marker: "[e2e:queue]" },
        "wrong",
        controlUrl,
      )
    ).status,
    401,
  );
  const arrival = post(
    broker,
    { action: "wait", marker: "[e2e:queue]" },
    broker.token,
    controlUrl,
  );
  const main = post(broker, body({ input: "[e2e:queue]" }));
  assert.equal((await arrival).status, 200);
  assert.equal(broker.report().requests, 1);
  assert.equal(broker.report().active, 1);
  assert.equal(
    (
      await post(
        broker,
        { action: "release", marker: "[e2e:queue]" },
        broker.token,
        controlUrl,
      )
    ).status,
    200,
  );
  assert.equal((await main).status, 200);
  assert.equal((await post(broker)).status, 429);
  const live = await start(t, {
    mode: "openai",
    allowLive: true,
    apiKey: "secret",
    testTransport: async () => {
      throw new Error("unexpected upstream call");
    },
  });
  assert.equal(
    (
      await post(
        live,
        { action: "wait", marker: "[e2e:queue]" },
        live.token,
        new URL("/control", live.url).href,
      )
    ).status,
    404,
  );
});

test(
  "barrier waits are bounded and aborted waits and close settle promptly",
  { timeout: 2000 },
  async (t) => {
    const broker = await start(t);
    await assert.rejects(
      broker.control.waitFor("[e2e:queue]", 5),
      /barrier_timeout/,
    );
    await assert.rejects(
      broker.control.waitFor("[e2e:queue]", 10001),
      /invalid_control/,
    );
    const controller = new AbortController();
    const cancelled = broker.control.waitFor(
      "[e2e:consume]",
      10000,
      controller.signal,
    );
    controller.abort();
    await assert.rejects(cancelled, /aborted/);
    const closing = broker.control.waitFor("[e2e:stop]");
    const rejected = assert.rejects(closing, /aborted/);
    const httpWait = post(
      broker,
      { action: "wait", marker: "[e2e:queue]" },
      broker.token,
      new URL("/control", broker.url).href,
    );
    const httpSettled = httpWait.then(
      async (response) => {
        assert.equal(response.status, 408);
      },
      () => {},
    );
    await broker.close();
    await rejected;
    await httpSettled;
    assert.equal(broker.report().active, 0);
    assert.equal(broker.report().requests, 0);
  },
);

test(
  "HTTP barrier waits share the broker run deadline and return sanitized timeout",
  { timeout: 2000 },
  async (t) => {
    const broker = await start(t, { limits: { deadlineMs: 40 } });
    const response = await post(
      broker,
      { action: "wait", marker: "[e2e:queue]" },
      broker.token,
      new URL("/control", broker.url).href,
    );
    assert.equal(response.status, 408);
    assert.ok(
      ["barrier_timeout", "aborted"].includes(
        (await response.json()).error.code,
      ),
    );
    assert.equal(broker.report().requests, 0);
    assert.equal((await post(broker)).status, 429);
  },
);

test("fixture comments can complete while a main response is held", async (t) => {
  const broker = await start(t);
  const main = post(broker, body({ input: "[e2e:queue]" }));
  await broker.control.waitFor("[e2e:queue]");
  const comment = await fetch(broker.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${broker.token}`,
      "x-situate-test-kind": "comment",
    },
    body: JSON.stringify(body()),
  });
  assert.equal(comment.status, 200);
  broker.control.release("[e2e:queue]");
  assert.equal((await main).status, 200);
});
