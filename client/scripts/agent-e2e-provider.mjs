import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fixtureTurn, responseEvents } from "./agent-e2e-fixture.mjs";

export const PINNED_AGENT_MODEL = "gpt-4.1-mini";
const UPSTREAM = "https://api.openai.com/v1/responses";
const DEFAULTS = Object.freeze({
  maxRequests: 24,
  maxInputTokens: 262144,
  maxTotalInputTokens: 262144,
  maxOutputTokens: 1024,
  maxTotalOutputTokens: 24576,
  maxBodyBytes: 1048576,
  maxResponseBytes: 4194304,
  deadlineMs: 180000,
  timeoutMs: 60000,
  maxConcurrency: 2,
});

function failure(code, status = 400) {
  return Object.assign(new Error(code), { code, status, brokerFailure: true });
}
function authenticate(req, token) {
  const supplied = req.headers.authorization;
  const expected = `Bearer ${token}`;
  return (
    typeof supplied === "string" &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) &&
    req.rawHeaders.filter(
      (value, index) =>
        index % 2 === 0 && value.toLowerCase() === "authorization",
    ).length === 1
  );
}
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw failure("body_limit", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw failure("invalid_json");
  }
}
const SEEDED_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
function validateLiveInput(input) {
  const object = (value, allowed) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))
    )
      throw failure("input_not_allowed");
  };
  const string = (value) => {
    if (typeof value !== "string") throw failure("input_not_allowed");
  };
  const optionalStrings = (value, keys) => {
    for (const key of keys) if (value[key] !== undefined) string(value[key]);
  };
  const content = (parts) => {
    if (typeof parts === "string") return;
    if (!Array.isArray(parts)) throw failure("input_not_allowed");
    for (const part of parts) {
      if (part?.type === "input_text") {
        object(part, ["type", "text"]);
        string(part.text);
      } else if (part?.type === "output_text") {
        object(part, ["type", "text", "annotations"]);
        string(part.text);
        if (
          part.annotations !== undefined &&
          (!Array.isArray(part.annotations) || part.annotations.length !== 0)
        )
          throw failure("input_not_allowed");
      } else if (part?.type === "input_image") {
        object(part, ["type", "image_url", "detail"]);
        if (
          part.image_url !== SEEDED_IMAGE ||
          (part.detail !== undefined &&
            !["auto", "low", "high"].includes(part.detail))
        )
          throw failure("image_not_allowed");
      } else throw failure("input_not_allowed");
    }
  };
  if (typeof input === "string") return;
  if (!Array.isArray(input)) throw failure("input_not_allowed");
  for (const item of input) {
    if (item && (item.type === undefined || item.type === "message")) {
      object(item, ["type", "role", "content", "id", "status", "phase"]);
      if (!["system", "developer", "user", "assistant"].includes(item.role))
        throw failure("input_not_allowed");
      optionalStrings(item, ["id", "status", "phase"]);
      content(item.content);
    } else if (item?.type === "function_call") {
      object(item, [
        "type",
        "id",
        "call_id",
        "name",
        "arguments",
        "status",
        "namespace",
      ]);
      for (const key of ["call_id", "name", "arguments"]) string(item[key]);
      optionalStrings(item, ["id", "status", "namespace"]);
    } else if (item?.type === "function_call_output") {
      object(item, ["type", "id", "call_id", "output", "status"]);
      string(item.call_id);
      optionalStrings(item, ["id", "status"]);
      content(item.output);
    } else throw failure("input_not_allowed");
  }
}
function inputReservation(body, live) {
  if (live) validateLiveInput(body.input);
  let imageTokens = 0;
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "input_image") {
      // The only live image is the seeded 1×1 PNG; reserve well above its patch cost.
      imageTokens += 4096;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(body.input);
  return Buffer.byteLength(JSON.stringify(body)) + imageTokens;
}
function safeUsage(value) {
  const usage = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    if (Number.isSafeInteger(value?.[key]) && value[key] >= 0)
      usage[key] = value[key];
  }
  return usage;
}

export async function startAgentProvider(options = {}) {
  const { model = PINNED_AGENT_MODEL, apiKey, signal } = options;
  const mode = options.mode === "live" ? "openai" : (options.mode ?? "fixture");
  if (!["fixture", "openai"].includes(mode)) throw failure("invalid_mode");
  if (![PINNED_AGENT_MODEL, "gpt-6.1-sol"].includes(model))
    throw failure("model_not_allowed");
  if (
    mode === "openai" &&
    (!(options.allowLive || options.allowPaid) ||
      typeof apiKey !== "string" ||
      !apiKey.trim())
  )
    throw failure("live_blocked", 403);
  const ceilings =
    mode === "fixture"
      ? {
          ...DEFAULTS,
          maxRequests: 64,
          maxInputTokens: 32 * 1024 * 1024,
          maxTotalInputTokens: 256 * 1024 * 1024,
          maxConcurrency: 3,
          maxBodyBytes: 32 * 1024 * 1024,
          maxResponseBytes: 32 * 1024 * 1024,
          maxTotalOutputTokens: 65536,
          deadlineMs: 300000,
          timeoutMs: 300000,
        }
      : DEFAULTS;
  const limits = { ...ceilings, ...options.limits };
  for (const [key, value] of Object.entries(limits)) {
    if (
      !(key in ceilings) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > ceilings[key]
    )
      throw failure("invalid_limit");
  }
  if (signal?.aborted) throw failure("aborted");
  const token = randomBytes(32).toString("hex");
  const effectsPath =
    mode === "fixture"
      ? `/effects/${randomBytes(24).toString("hex")}`
      : undefined;
  const pluginEffects = { POST: 0, DELETE: 0 };
  const started = Date.now();
  const records = [];
  const controllers = new Set();
  const inFlight = new Set();
  const barriers = new Map();
  const heldMarkers = new Set();
  const lifecycle = new AbortController();
  let requests = 0,
    reservedOutputTokens = 0,
    reservedInputTokens = 0,
    active = 0,
    budgetDenials = 0,
    closed = false;
  const barrier = (marker) => {
    if (!barriers.has(marker)) {
      let release, reached;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const arrival = new Promise((resolve) => {
        reached = resolve;
      });
      barriers.set(marker, { gate, arrival, release, reached });
    }
    return barriers.get(marker);
  };
  const control = {
    hold(marker) {
      heldMarkers.add(marker);
      barriers.delete(marker);
      barrier(marker);
    },
    release(marker) {
      barrier(marker).release();
    },
    async waitFor(marker, timeoutMs = 10000, waitSignal) {
      if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 10000
      )
        throw failure("invalid_control");
      const remaining = limits.deadlineMs - (Date.now() - started);
      if (remaining <= 0) throw failure("deadline", 429);
      const signal = waitSignal
        ? AbortSignal.any([lifecycle.signal, waitSignal])
        : lifecycle.signal;
      if (signal.aborted) throw failure("aborted", 408);
      let timer, abort;
      try {
        await Promise.race([
          barrier(marker).arrival,
          new Promise((_, reject) => {
            abort = () => reject(failure("aborted", 408));
            signal.addEventListener("abort", abort, { once: true });
            timer = setTimeout(
              () => reject(failure("barrier_timeout", 408)),
              Math.min(timeoutMs, remaining),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
    },
  };
  const server = createServer(async (req, res) => {
    let record, controller, timer, settle;
    let countedActive = false;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    inFlight.add(settled);
    try {
      if (effectsPath && req.url === effectsPath) {
        if (closed || Date.now() - started >= limits.deadlineMs)
          throw failure("deadline", 429);
        if (req.headers.authorization !== undefined)
          throw failure("effect_authorization_not_allowed", 403);
        if (!["POST", "DELETE"].includes(req.method))
          throw failure("method_not_allowed", 405);
        timer = setTimeout(
          () => req.destroy(),
          Math.min(
            limits.timeoutMs,
            limits.deadlineMs - (Date.now() - started),
          ),
        );
        const body = await readBody(req, 64);
        if (closed || Date.now() - started >= limits.deadlineMs)
          throw failure("deadline", 429);
        if (JSON.stringify(body) !== '{"fixture":"plugins"}')
          throw failure("invalid_effect");
        pluginEffects[req.method]++;
        res
          .writeHead(202, { "content-type": "application/json" })
          .end(JSON.stringify({ effect: req.method }));
        return;
      }
      if (!authenticate(req, token)) throw failure("unauthorized", 401);
      if (req.method !== "POST") throw failure("method_not_allowed", 405);
      if (closed || Date.now() - started >= limits.deadlineMs)
        throw failure("deadline", 429);
      if (req.url === "/control" && mode === "fixture") {
        controller = new AbortController();
        controllers.add(controller);
        timer = setTimeout(
          () => {
            controller.abort();
            if (!req.complete) req.destroy();
          },
          Math.min(10000, limits.deadlineMs - (Date.now() - started)),
        );
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const body = await readBody(req, 1024);
        if (
          !["hold", "release", "wait"].includes(body.action) ||
          typeof body.marker !== "string" ||
          body.marker.length > 80
        )
          throw failure("invalid_control");
        if (controller.signal.aborted) throw failure("aborted", 408);
        if (body.action === "wait")
          await control.waitFor(body.marker, 10000, controller.signal);
        else control[body.action](body.marker);
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
        return;
      }
      if (req.url !== "/v1/responses") throw failure("path_not_allowed", 404);
      if (active >= limits.maxConcurrency)
        throw failure("concurrency_limit", 429);
      active++;
      countedActive = true;
      controller = new AbortController();
      controllers.add(controller);
      timer = setTimeout(
        () => {
          controller.abort();
          if (!req.complete) req.destroy();
        },
        Math.min(limits.timeoutMs, limits.deadlineMs - (Date.now() - started)),
      );
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const body = await readBody(req, limits.maxBodyBytes);
      if (controller.signal.aborted) throw failure("aborted", 408);
      if (
        !body ||
        body.model !== model ||
        body.stream !== true ||
        body.background === true ||
        body.previous_response_id != null ||
        body.conversation != null ||
        body.prompt != null
      )
        throw failure("invalid_request");
      if (
        !Number.isSafeInteger(body.max_output_tokens) ||
        body.max_output_tokens < 1 ||
        body.max_output_tokens > limits.maxOutputTokens
      )
        throw failure("output_limit", 429);
      // UTF-8 bytes conservatively bound text token counts without model-specific tokenization.
      const inputTokens = inputReservation(body, mode === "openai");
      if (inputTokens > limits.maxInputTokens)
        throw failure("input_limit", 429);
      if (
        mode === "openai" &&
        (body.tools ?? []).some(
          (tool) =>
            tool.type !== "function" ||
            ![
              "read",
              "ls",
              "find",
              "grep",
              "write",
              "create_batch",
              "edit",
              "history",
              "read_revision",
              "list_conversations",
              "read_conversation",
              "open_view",
              "reveal_content",
              "open_conversation",
              "ask_question",
              "propose_working_method",
              "show_imported_files",
            ].includes(tool.name),
        )
      )
        throw failure("tool_not_allowed");
      if (
        requests >= limits.maxRequests ||
        reservedOutputTokens + body.max_output_tokens >
          limits.maxTotalOutputTokens ||
        reservedInputTokens + inputTokens > limits.maxTotalInputTokens
      )
        throw failure("run_budget", 429);
      requests++;
      reservedOutputTokens += body.max_output_tokens;
      reservedInputTokens += inputTokens;
      const suppliedKind = req.headers["x-situate-test-kind"];
      const kind = ["main", "comment", "compaction", "title"].includes(
        suppliedKind,
      )
        ? suppliedKind
        : "main";
      const inputImages =
        JSON.stringify(body.input ?? []).match(/"type":"input_image"/g)
          ?.length ?? 0;
      record = {
        sequence: requests,
        kind,
        inputImages,
        outcome: "pending",
        startedMs: Date.now() - started,
      };
      records.push(record);
      let pendingEvent = "",
        complete = false,
        responseBytes = 0;
      const decoder = new TextDecoder();
      const inspect = (text) => {
        pendingEvent += text;
        const frames = pendingEvent.split(/\r?\n\r?\n/);
        pendingEvent = frames.pop();
        for (const frame of frames) {
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            throw failure("upstream_invalid_event", 502);
          }
          if (
            ["response.failed", "response.incomplete", "error"].includes(
              event.type,
            )
          )
            throw failure("upstream_event", 502);
          if (event.type === "response.completed") {
            complete = true;
            record.usage = safeUsage(event.response?.usage);
          }
        }
      };
      const forward = async (chunk) => {
        responseBytes += chunk.byteLength;
        if (responseBytes > limits.maxResponseBytes)
          throw failure("response_limit", 502);
        if (controller.signal.aborted) throw failure("aborted", 408);
        inspect(decoder.decode(chunk, { stream: true }));
        if (!res.headersSent)
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
          });
        record.responseStarted = true;
        record.responseBytes = responseBytes;
        if (!res.write(chunk))
          await once(res, "drain", { signal: controller.signal });
      };
      if (mode === "fixture") {
        const turn = fixtureTurn(body, kind, pluginEffectsUrl);
        record.scenario = turn.scenario;
        if (turn.marker) {
          const held =
            heldMarkers.has(turn.marker) ||
            /\[e2e:(queue|consume|stop|plugins)/.test(turn.marker);
          const entry = barrier(turn.marker);
          entry.reached();
          if (held) {
            await Promise.race([
              entry.gate,
              new Promise((_, reject) => {
                controller.signal.addEventListener(
                  "abort",
                  () => reject(failure("aborted", 408)),
                  { once: true },
                );
              }),
            ]);
          }
        }
        await forward(
          Buffer.from(
            responseEvents(turn.item, model, requests, body.max_output_tokens),
          ),
        );
      } else {
        // Test transport is injected explicitly; production always uses this one fixed HTTPS origin.
        const upstream = await (options.testTransport ?? fetch)(UPSTREAM, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!upstream.ok) throw failure("upstream_status", 502);
        if (
          !(upstream.headers.get("content-type") ?? "").startsWith(
            "text/event-stream",
          )
        )
          throw failure("upstream_content_type", 502);
        const requestId = upstream.headers.get("x-request-id");
        if (/^req_[A-Za-z0-9_-]{1,100}$/.test(requestId ?? ""))
          record.requestId = requestId;
        for await (const chunk of upstream.body) await forward(chunk);
      }
      if (controller.signal.aborted) throw failure("aborted", 408);
      inspect(decoder.decode() + "\n\n");
      if (!complete) throw failure("incomplete_response", 502);
      record.outcome = "completed";
      res.end();
    } catch (error) {
      const code = error.brokerFailure
        ? error.code
        : controller?.signal.aborted
          ? "aborted"
          : "upstream_failure";
      if (
        [
          "run_budget",
          "output_limit",
          "input_limit",
          "body_limit",
          "response_limit",
          "deadline",
          "concurrency_limit",
        ].includes(code)
      )
        budgetDenials++;
      if (record) {
        record.outcome = code;
        record.streamInterrupted = res.headersSent;
      }
      controller?.abort();
      if (res.headersSent) res.destroy();
      else if (!res.destroyed)
        res
          .writeHead(error.brokerFailure ? error.status : 502, {
            "content-type": "application/json",
          })
          .end(JSON.stringify({ error: { code } }));
    } finally {
      clearTimeout(timer);
      if (controller) {
        if (countedActive) active--;
        controllers.delete(controller);
      }
      if (record) record.durationMs = Date.now() - started - record.startedMs;
      inFlight.delete(settled);
      settle();
    }
  });
  server.requestTimeout = limits.timeoutMs;
  server.headersTimeout = Math.min(10000, limits.timeoutMs);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const baseUrl = `${origin}/v1`;
  const pluginEffectsUrl = effectsPath ? `${origin}${effectsPath}` : undefined;
  let closing;
  const close = () => {
    if (closing) return closing;
    closed = true;
    lifecycle.abort();
    signal?.removeEventListener("abort", close);
    for (const controller of controllers) controller.abort();
    closing = Promise.all([
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
      ...inFlight,
    ]).then(() => undefined);
    return closing;
  };
  signal?.addEventListener("abort", close, { once: true });
  return {
    url: `${baseUrl}/responses`,
    baseUrl,
    token,
    pluginEffectsUrl,
    close,
    control: mode === "fixture" ? control : undefined,
    report: () =>
      structuredClone({
        mode,
        model,
        requests,
        pluginEffects,
        reservedOutputTokens,
        reservedInputTokens,
        active,
        budgetDenials,
        elapsedMs: Date.now() - started,
        records,
      }),
  };
}
export const startAgentE2EProvider = startAgentProvider;
