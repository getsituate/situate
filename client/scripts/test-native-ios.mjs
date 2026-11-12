import { spawn } from "node:child_process";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createServer } from "node:http";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { coordinated, runCoordinated } from "../../tools/run-coordinated.mjs";
import { sanitizeIpcTrace } from "../app/src-tauri/tests/support/native-ios-ipc-trace.mjs";
import {
  acquireSession,
  assertLocalPath,
  checkPrerequisites,
  prepareProjectSpec,
  run,
  sessionPaths,
  syncAppIcons,
} from "./ios-xcode.mjs";
import { responseEvents } from "./agent-e2e-fixture.mjs";
import { runChild } from "./agent-e2e-runtime.mjs";

export const BUNDLE = "dev.situate.client.smoke";
const SMOKE_IDENTITY = Object.freeze({
  identifier: BUNDLE,
  productName: "Situate Smoke",
});
const MODEL = "gpt-4.1-mini";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message) => {
  throw new Error(message);
};
export function validateSimulator(id) {
  if (typeof id !== "string" || !UUID.test(id))
    fail("An explicit simulator UUID is required.");
  return id.toUpperCase();
}
export function regularBytes(path, limit = 1048576) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || stat.nlink !== 1)
      fail("Unsafe smoke input file.");
    const bytes = readFileSync(fd);
    if (bytes.length > limit) fail("Smoke input exceeds its size limit.");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

const CONTAINERS = `import json,os,pathlib,plistlib,stat,sys
base=pathlib.Path(sys.argv[1]); bundle=sys.argv[2]; found={"data":[],"bundle":[]}; total=0
for kind,relative in [("data","Data/Application"),("bundle","Bundle/Application")]:
 root=base/relative
 for ancestor in [root,*root.parents]:
  if os.path.lexists(ancestor) and stat.S_ISLNK(ancestor.lstat().st_mode): raise ValueError("unsafe container directory")
 if not root.exists(): continue
 for entry in os.scandir(root):
  total+=1
  if total>512: raise ValueError("container inventory exceeds limit")
  if not entry.is_dir(follow_symlinks=False): raise ValueError("unsafe container entry")
  file=pathlib.Path(entry.path)/".com.apple.mobile_container_manager.metadata.plist"
  if not os.path.lexists(file): continue
  fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   info=os.fstat(fd)
   if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>1048576: raise ValueError("unsafe metadata")
   with os.fdopen(fd,"rb",closefd=False) as stream: data=stream.read(1048577)
   if len(data)>1048576: raise ValueError("metadata exceeds limit")
   metadata=plistlib.loads(data)
   if metadata.get("MCMMetadataIdentifier")==bundle: found[kind].append(str(pathlib.Path(entry.path).resolve()))
  finally: os.close(fd)
print(json.dumps(found))`;
export async function inspectContainers(base, execute = run) {
  try {
    const output = await execute("python3", ["-c", CONTAINERS, base, BUNDLE], {
      capture: true,
    });
    const result = JSON.parse(output);
    if (
      !Array.isArray(result.data) ||
      !Array.isArray(result.bundle) ||
      result.data.length > 1 ||
      result.bundle.length > 1
    )
      fail("Ambiguous smoke container.");
    return result;
  } catch {
    fail("Could not safely inspect simulator container metadata.");
  }
}
export function claimContainer(container, runId) {
  if (
    !UUID.test(runId) ||
    lstatSync(container).isSymbolicLink() ||
    !lstatSync(container).isDirectory()
  )
    fail("Invalid smoke container reservation.");
  const marker = join(container, ".native-ios-smoke-owner");
  writeFileSync(marker, JSON.stringify({ version: 1, runId }), {
    flag: "wx",
    mode: 0o600,
  });
}
export function assertOwned(container, runId) {
  const marker = JSON.parse(
    regularBytes(join(container, ".native-ios-smoke-owner"), 4096),
  );
  if (
    marker.version !== 1 ||
    marker.runId !== runId ||
    Object.keys(marker).length !== 2
  )
    fail("Smoke container ownership changed.");
}

export function sanitizeAppleDiagnostic(value, clipped = false) {
  let text = String(value ?? "");
  if (text.length > 8192) {
    text = text.slice(-8192);
    clipped = true;
  }
  if (clipped)
    text = text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : "";
  return stripVTControlCharacters(text)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\r\n]*/gi, "[url]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(
      /\b(?:[a-z][a-z0-9_]*(?:token|secret|password|api_key)|authorization|token|password|secret|api[_-]?key)\s*["']?\s*[=:][^\r\n]*/gi,
      "[redacted]",
    )
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted]")
    .replace(/(^|[\s"'(=:])\/[^\r\n]*/gm, "$1[path]")
    .split("\n")
    .filter(Boolean)
    .slice(-8)
    .join("\n")
    .slice(-2048);
}
export function appleFailureDiagnostic(details, stderr, clipped = false) {
  return {
    reason: [
      "server-exit",
      "supervisor-exit",
      "spawn-error",
      "stdin-error",
      "rpc-output-limit",
      "session-inactive",
      "tool-error",
    ].includes(details.reason)
      ? details.reason
      : "unknown",
    tool: /^[a-z_]+$/.test(details.tool ?? "") ? details.tool : null,
    exitCode: Number.isInteger(details.code) ? details.code : null,
    signal: /^SIG[A-Z0-9]+$/.test(details.signal ?? "") ? details.signal : null,
    spawnCode: /^[A-Z][A-Z0-9_]{0,30}$/.test(details.spawnCode ?? "")
      ? details.spawnCode
      : null,
    bufferedCharacters: Number.isInteger(details.bufferedCharacters)
      ? details.bufferedCharacters
      : null,
    stderr: sanitizeAppleDiagnostic(stderr, clipped),
  };
}

// Pin the group leader while MCP owns compiler processes and its stdio connection.
const APPLE_SUPERVISOR = `
const {spawn}=require('node:child_process');
process.on('SIGTERM',()=>{});
process.on('disconnect',()=>process.kill(-process.pid,'SIGKILL'));
const child=spawn('xcodebuildmcp',['mcp'],{stdio:['pipe','pipe','pipe']});
process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.stdin.on('error',()=>{});
child.once('error',(error)=>process.send({type:'ended',reason:'spawn-error',spawnCode:error.code}));
child.once('exit',(code,signal)=>process.send({type:'ended',reason:'server-exit',code,signal}));
`;

export class AppleTools {
  constructor(environment, signal) {
    signal?.throwIfAborted();
    this.signal = signal;
    this.next = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.stderrClipped = false;
    this.child = spawn(process.execPath, ["--eval", APPLE_SUPERVISOR], {
      env: environment,
      detached: true,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    this.child.stderr.on("data", (chunk) => {
      const combined = this.stderr + chunk.toString();
      this.stderrClipped ||= combined.length > 8192;
      this.stderr = combined.slice(-8192);
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      if (this.buffer.length > 16 * 1024 * 1024) {
        this.failure = {
          reason: "rpc-output-limit",
          bufferedCharacters: this.buffer.length,
        };
        void this.close().catch(() => {});
        return;
      }
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        const request = this.pending.get(frame.id);
        if (!request) continue;
        this.pending.delete(frame.id);
        if (frame.error)
          request.reject(
            new Error("Apple tool protocol rejected the request."),
          );
        else request.resolve(frame.result);
      }
    });
    const ended = (details) => {
      this.ended = true;
      this.failure ??= details;
      for (const request of this.pending.values())
        request.reject(this.failureError(this.failure));
      this.pending.clear();
    };
    this.child.on("error", (error) =>
      ended({ reason: "spawn-error", spawnCode: error.code }),
    );
    this.child.on("exit", (code, signal) =>
      ended({ reason: "supervisor-exit", code, signal }),
    );
    this.child.on("message", (message) => {
      if (message.type === "ended") ended(message);
    });
    this.child.stdin.on("error", (error) =>
      ended({ reason: "stdin-error", spawnCode: error.code }),
    );
    this.abort = () => {
      void this.close().catch(() => {});
    };
    signal?.addEventListener("abort", this.abort, { once: true });
  }
  failureError(details) {
    const error = new Error("Apple tool operation failed.");
    const tool = this.lastTool;
    error.code = "apple-" + details.reason;
    Object.defineProperty(error, "diagnostic", {
      get: () =>
        appleFailureDiagnostic(
          { ...details, tool },
          this.stderr + (details.message ? "\n" + details.message : ""),
          this.stderrClipped,
        ),
    });
    return error;
  }
  rpc(method, params) {
    if (this.ended || this.closing)
      return Promise.reject(
        this.failureError(this.failure ?? { reason: "session-inactive" }),
      );
    const id = this.next++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
  async initialize() {
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "situate-native-ios", version: "1" },
    });
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
  }
  async call(name, args = {}) {
    this.lastTool = name;
    const result = await this.rpc("tools/call", { name, arguments: args });
    if (
      result?.isError ||
      result?.structuredContent?.didError ||
      result?.structuredContent?.result?.didError
    )
      throw this.failureError({
        reason: "tool-error",
        message:
          result.structuredContent?.result?.error ??
          result.structuredContent?.error ??
          result.content
            ?.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
      });
    return result;
  }
  close() {
    if (this.closing) return this.closing;
    this.signal?.removeEventListener("abort", this.abort);
    this.closing = new Promise((done, reject) => {
      if (
        !this.child.pid ||
        this.child.exitCode !== null ||
        this.child.signalCode !== null
      ) {
        done();
        return;
      }
      let escalation, deadline;
      const kill = (signal) => {
        if (this.child.exitCode !== null || this.child.signalCode !== null)
          return;
        try {
          process.kill(-this.child.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH")
            reject(new Error("Apple tool cleanup failed."));
        }
      };
      this.child.once("close", () => {
        clearTimeout(escalation);
        clearTimeout(deadline);
        done();
      });
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 1000);
      deadline = setTimeout(
        () => reject(new Error("Apple tool session did not drain.")),
        3000,
      );
    });
    return this.closing;
  }
}
export function toolData(result) {
  const data =
    result.structuredContent?.data ?? result.structuredContent?.result;
  if (data) return data.artifacts ?? data;
  return (
    result.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}
export function requireSimulator(result, simulatorId) {
  const selected = toolData(result).simulators?.find(
    (device) => device.simulatorId?.toUpperCase() === simulatorId,
  );
  if (
    !selected?.isAvailable ||
    !/^iOS\b/.test(selected.runtime) ||
    !["Booted", "Shutdown"].includes(selected.state)
  )
    fail("The explicit iOS simulator is unavailable or busy.");
  return selected;
}

export function checkDefaults(result, expected) {
  const data = toolData(result);
  const actual = data.profiles?.[data.currentProfile];
  if (
    !actual ||
    Object.entries(expected).some(([key, value]) => actual[key] !== value)
  )
    fail("Apple build defaults do not match the smoke session.");
}

export async function startProvider(runId, supervisor) {
  const token = randomBytes(32).toString("hex");
  const reports = new Map();
  const listeners = new Map();
  const recordName = `plugin_${createHash("sha256").update("native-ios-worker").digest("hex").slice(0, 16)}_record`;
  let requests = 0;
  const dispatchCounts = { main: 0, title: 0, comment: 0, compaction: 0 };
  const server = createServer(async (request, response) => {
    try {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        response.writeHead(401).end();
        return;
      }
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1048576) fail("Fixture request exceeds its size limit.");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks));
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      if (request.url === "/report") {
        if (
          body.version !== 1 ||
          body.runId !== runId ||
          !UUID.test(body.launchId) ||
          !["exercise", "reopen", "cleanup"].includes(body.phase) ||
          body.qualification !== "debug" ||
          body.supervisorSha256 !== supervisor ||
          typeof body.passed !== "boolean" ||
          reports.has(body.launchId)
        ) {
          response.writeHead(400).end();
          return;
        }
        reports.set(body.launchId, {
          ...body,
          providerRequests: requests,
          dispatchCounts: { ...dispatchCounts },
        });
        listeners.get(body.launchId)?.(reports.get(body.launchId));
        listeners.delete(body.launchId);
        response.writeHead(200).end();
        return;
      }
      if (
        request.url !== "/v1/responses" ||
        body.model !== MODEL ||
        body.stream !== true ||
        ++requests > 24
      ) {
        response.writeHead(400).end();
        return;
      }
      const input = body.input;
      if (!Array.isArray(input)) fail("Invalid native provider input.");
      const tools = body.tools ?? [];
      const kind = request.headers["x-situate-test-kind"];
      if (!Object.hasOwn(dispatchCounts, kind))
        fail("The native request kind is missing.");
      dispatchCounts[kind]++;
      if (
        kind !== "main" ||
        dispatchCounts.main > 4 ||
        !tools.some((tool) => tool.name === "write")
      )
        fail("Unexpected native auxiliary or repeated dispatch.");
      let item;
      const message = (text) => ({
        type: "message",
        id: `msg_${requests}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      });
      const call = (name, args) => ({
        type: "function_call",
        id: `fc_${requests}`,
        call_id: `call_${requests}`,
        name,
        arguments: JSON.stringify(args),
        status: "completed",
      });
      {
        if (!tools.some((tool) => tool.name === recordName))
          fail("Native plugin descriptor was not captured.");
        const calls = input.filter((item) => item.type === "function_call");
        const previous = calls.at(-1);
        const output =
          previous &&
          input.find(
            (item) =>
              item.type === "function_call_output" &&
              item.call_id === previous.call_id,
          );
        if (!previous) {
          const source = JSON.stringify(input);
          if (
            !source.includes("Synthetic iOS attachment: retained Unicode") ||
            !source.includes("Synthetic iOS referenced source") ||
            !source.includes("data:image/png;base64,")
          )
            fail(
              "Native submitted sources were not resolved for the provider.",
            );
          item = call("write", {
            path: "ios-smoke-note.txt",
            text: "Synthetic native iOS note\n",
            expectedRevision: null,
          });
        } else if (!output) fail("Native tool output is missing.");
        else if (previous.name === "write")
          item = call("read", { path: "ios-smoke-note.txt" });
        else if (previous.name === "read") {
          if (!JSON.stringify(output).includes("Synthetic native iOS note"))
            fail("Native file result is invalid.");
          item = call(recordName, {});
        } else if (previous.name === recordName) {
          if (
            !JSON.stringify(output).includes(
              "Synthetic iOS Worker effect recorded",
            )
          )
            fail("Native Worker result is invalid.");
          item = message("Native iOS file and Worker checks completed.");
        } else fail("Unexpected native tool dispatch.");
      }
      const stream = responseEvents(item, MODEL, requests)
        .split("\n")
        .map((line) => {
          if (!line.startsWith("data: ")) return line;
          const event = JSON.parse(line.slice(6));
          if (event.response?.usage)
            event.response.usage = {
              input_tokens: 32,
              output_tokens: 8,
              total_tokens: 40,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            };
          return "data: " + JSON.stringify(event);
        })
        .join("\n");
      const expectedStage = ["write", "read", recordName, null][
        dispatchCounts.main - 1
      ];
      if ((item.type === "function_call" ? item.name : null) !== expectedStage)
        fail("Native dispatch order changed.");
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(stream);
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const port = server.address().port;
  return {
    token,
    url: `http://127.0.0.1:${port}/v1/responses`,
    report(launchId, signal) {
      if (reports.has(launchId)) return Promise.resolve(reports.get(launchId));
      return new Promise((done, reject) => {
        const abort = () => {
          listeners.delete(launchId);
          reject(new Error("Native iOS report deadline exceeded."));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        listeners.set(launchId, (value) => {
          signal.removeEventListener("abort", abort);
          done(value);
        });
      });
    },
    async close() {
      server.closeAllConnections();
      await new Promise((done) => {
        server.close(done);
      });
    },
  };
}

async function cliReady(path, before, ended, signal) {
  for (;;) {
    signal.throwIfAborted();
    if (ended()) fail("The Tauri iOS build session ended.");
    if (existsSync(path)) {
      const bytes = regularBytes(path, 4096).toString();
      if (bytes !== before) {
        const options = JSON.parse(bytes);
        if (
          !/^127\.0\.0\.1:\d+$/.test(options.addr) ||
          typeof options.token !== "string"
        )
          fail("Invalid Tauri build session.");
        return;
      }
    }
    await delay(50, undefined, { signal });
  }
}
export function isolatedEnvironment(environment) {
  if (
    environment.SITUATE_WORKTREE_WAIT_MS !== undefined &&
    !/^[0-9]{1,12}$/.test(environment.SITUATE_WORKTREE_WAIT_MS)
  )
    fail("Invalid queue timing marker.");
  if (
    environment.SITUATE_NATIVE_IOS_BUILD_HELD !== undefined &&
    !/^[a-f0-9]{12}$/.test(environment.SITUATE_NATIVE_IOS_BUILD_HELD)
  )
    fail("Invalid iOS build ownership marker.");
  if (
    environment.CARGO_BUILD_JOBS !== undefined &&
    (!/^[0-9]{1,3}$/.test(environment.CARGO_BUILD_JOBS) ||
      Number(environment.CARGO_BUILD_JOBS) < 1 ||
      Number(environment.CARGO_BUILD_JOBS) > 256)
  )
    fail("Invalid Cargo parallelism setting.");
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) =>
      /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|LC_.+|DEVELOPER_DIR|RUSTUP_HOME|CARGO_HOME|VOLTA_HOME|SITUATE_COORDINATED_WORKTREE|SITUATE_COORDINATED_DESKTOP|SITUATE_WORKTREE_WAIT_MS|SITUATE_NATIVE_IOS_BUILD_HELD|CARGO_BUILD_JOBS)$/.test(
        key,
      ),
    ),
  );
}

export function nativeFailureStage(stage) {
  return [
    "bootstrap",
    "workspace-parent",
    "workspace-create",
    "workspace-open",
    "workspace-prepare",
    "migration",
    "attachments",
    "references",
    "presentation",
    "workspace-close",
    "workspace-close-dialog",
    "workspace-close-cancel",
    "workspace-close-drain",
    "workspace-reopen",
    "conversation",
    "native-terminal",
    "worker-enter",
    "worker-stop",
    "worker-outcome",
    "worker-idle",
    "worker-readback",
    "verify",
    "verification",
    "cleanup",
    "complete",
  ].includes(stage)
    ? stage
    : "verification";
}

export function nativeCleanupError(code) {
  if (code == null) return null;
  return [
    "native.ai.secureStore.locked",
    "native.ai.secureStore.unavailable",
    "native.ai.secureStore.failed",
    "native.ai.secureStore.invalid",
    "native.smoke.cleanupFailed",
  ].includes(code)
    ? code
    : "native.smoke.cleanupFailed";
}

export async function launchPhase(
  apple,
  provider,
  { container, runId, simulatorId, supervisor, phase },
  signal,
) {
  assertOwned(container, runId);
  const launchId = randomUUID();
  await apple.call("launch_app_sim", {
    bundleId: BUNDLE,
    simulatorId,
    env: {
      SITUATE_NATIVE_IOS_RUN_ID: runId,
      SITUATE_NATIVE_IOS_LAUNCH_ID: launchId,
      SITUATE_NATIVE_IOS_PHASE: phase,
      SITUATE_NATIVE_IOS_PROVIDER: provider.url,
      SITUATE_NATIVE_IOS_TOKEN: provider.token,
      SITUATE_NATIVE_IOS_SUPERVISOR: supervisor,
      NO_PROXY: "127.0.0.1",
    },
  });
  try {
    const report = await provider.report(
      launchId,
      AbortSignal.any([signal, AbortSignal.timeout(150000)]),
    );
    if (
      !report.passed ||
      report.phase !== phase ||
      report.runId !== runId ||
      report.launchId !== launchId
    )
      throw Object.assign(new Error("Native iOS launch verification failed."), {
        code: "ios-native-report-failed",
        nativeFailure: {
          stage: nativeFailureStage(report.stage),
          cleanupError: nativeCleanupError(report.cleanupError),
          keysDeleted: report.keysDeleted === true,
          phase,
          runId,
          ...(sanitizeIpcTrace(report.ipcTrace).length
            ? { ipcTrace: sanitizeIpcTrace(report.ipcTrace) }
            : {}),
        },
      });
    return report;
  } finally {
    await apple.call("stop_app_sim", { bundleId: BUNDLE, simulatorId });
  }
}

export function smokeInitArgs(paths) {
  return [
    paths.cli,
    "ios",
    "init",
    "--ci",
    "--skip-targets-install",
    "--config",
    JSON.stringify(SMOKE_IDENTITY),
  ];
}
export function smokeFrontendBuildArgs(paths) {
  return [
    "run",
    "build",
    "--workspace",
    "@situate/client",
    "--",
    "--config",
    join(paths.root, "scripts/native-ios-trace-vite.config.mjs"),
  ];
}

export function smokeSessionArgs(paths) {
  return [
    paths.cli,
    "ios",
    "dev",
    "--open",
    "--no-watch",
    "--no-dev-server",
    "--no-dev-server-wait",
    "--features",
    "native-smoke,custom-protocol",
    "--config",
    JSON.stringify({
      ...SMOKE_IDENTITY,
      build: { beforeDevCommand: "", devUrl: null, beforeBuildCommand: "" },
    }),
  ];
}

export function smokeProjectSpec(source, paths) {
  for (const key of ["bundleIdPrefix", "PRODUCT_BUNDLE_IDENTIFIER"]) {
    const pattern = new RegExp("^( +)" + key + ":[^\\r\\n]*$", "gm");
    if ([...source.matchAll(pattern)].length !== 1)
      fail("Unexpected generated iOS bundle settings.");
    source = source.replace(pattern, "$1" + key + ': "' + BUNDLE + '"');
  }
  source = prepareProjectSpec(source, paths);
  const signing =
    /^([ \t]+)"?CODE_SIGNING_ALLOWED\[sdk=iphonesimulator\*\]"?:[^\r\n]*$/gm;
  if ([...source.matchAll(signing)].length !== 1)
    fail("Unexpected generated iOS simulator signing settings.");
  return source.replace(
    signing,
    '$1"CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": YES',
  );
}
export async function buildSmokeApp(apple, simulatorId) {
  const selected = requireSimulator(
    await apple.call("list_sims", { enabled: true }),
    simulatorId,
  );
  if (selected.state === "Shutdown")
    await apple.call("boot_sim", { simulatorId });
  await apple.call("build_sim", {
    extraArgs: [
      "CODE_SIGNING_ALLOWED=YES",
      "CODE_SIGNING_REQUIRED=YES",
      "CODE_SIGN_IDENTITY=-",
      "AD_HOC_CODE_SIGNING_ALLOWED=YES",
      "CODE_SIGN_STYLE=Manual",
      "DEVELOPMENT_TEAM=",
    ],
  });
}
export function releaseSmokeSession({
  cleanupFailed,
  reserved,
  reservation,
  unlock,
  runId,
  simulatorId,
}) {
  let failure;
  try {
    if (cleanupFailed) {
      const error = new Error("Owned iOS smoke cleanup could not be verified.");
      Object.assign(error, {
        code: "ios-cleanup-unverified",
        runId,
        simulatorId,
      });
      throw error;
    }
    if (reserved) rmSync(reservation, { recursive: true });
  } catch (error) {
    failure = error;
  } finally {
    try {
      unlock();
    } catch (error) {
      error.projectSessionReleased = false;
      failure = error;
    }
  }
  if (failure) throw failure;
}

export function coordinationStep(paths, environment = process.env) {
  if (!coordinated(paths.root, environment)) return "worktree";
  return environment.SITUATE_NATIVE_IOS_BUILD_HELD === paths.id
    ? null
    : "build";
}

export async function nativeIos(
  paths,
  {
    simulatorId,
    signal,
    execute = run,
    appleFactory = (environment, signal) => new AppleTools(environment, signal),
  },
) {
  simulatorId = validateSimulator(simulatorId);
  const environment = isolatedEnvironment(process.env);
  const { env } = await checkPrerequisites(paths, {
    environment,
    execute,
    signal,
  });
  const unlock = acquireSession(paths, false, () => {
    throw Object.assign(new Error("The guarded iOS build lock remains."), {
      code: "ios-build-lock-retained",
    });
  });
  const runId = randomUUID();
  const reservation = join(tmpdir(), `situate-native-ios-${simulatorId}.lock`);
  let reserved = false,
    apple,
    session,
    provider,
    container,
    supervisor,
    installed = false,
    completed = false;
  const sessionController = new AbortController();
  let sessionEnded = false,
    sessionFailure,
    firstFailure,
    result;
  const base = join(
    realpathSync(homedir()),
    "Library/Developer/CoreSimulator/Devices",
    simulatorId,
    "data/Containers",
  );
  const appOptions = { cwd: paths.app, env, signal, capture: true };
  try {
    mkdirSync(reservation, { mode: 0o700 });
    reserved = true;
    apple = appleFactory(environment, signal);
    await apple.initialize();
    await apple.call("session_show_defaults");
    requireSimulator(
      await apple.call("list_sims", { enabled: true }),
      simulatorId,
    );
    const initial = await inspectContainers(base, execute);
    if (initial.data.length || initial.bundle.length)
      fail(
        "The selected simulator already contains the smoke app. No state was changed.",
      );
    assertLocalPath(paths.root, paths.apple);
    if (!existsSync(join(paths.apple, "project.yml")))
      await execute(process.execPath, smokeInitArgs(paths), appOptions);
    await execute("npm", smokeFrontendBuildArgs(paths), {
      cwd: paths.root,
      env,
      signal,
      capture: true,
    });
    supervisor = createHash("sha256")
      .update(
        regularBytes(
          join(paths.app, "dist/executor-supervisor.js"),
          8 * 1024 * 1024,
        ),
      )
      .digest("hex");
    const spec = join(paths.apple, "project.native-smoke.yml");
    assertLocalPath(paths.root, spec);
    writeFileSync(
      spec,
      smokeProjectSpec(
        regularBytes(join(paths.apple, "project.yml")).toString(),
        paths,
      ),
    );
    await execute("xcodegen", ["generate", "--spec", spec], appOptions);
    syncAppIcons(paths);
    const optionsFile = join(paths.apple, ".tauri/cli-options-server.json");
    const before = existsSync(optionsFile)
      ? regularBytes(optionsFile, 4096).toString()
      : "";
    session = runChild(process.execPath, smokeSessionArgs(paths), {
      cwd: paths.app,
      env,
      signal: sessionController.signal,
      timeoutMs: 900000,
    })
      .catch((error) => {
        sessionFailure = error;
      })
      .finally(() => {
        sessionEnded = true;
      });
    await cliReady(optionsFile, before, () => sessionEnded, signal);
    const defaults = {
      projectPath: join(paths.apple, "situate-client.xcodeproj"),
      scheme: "situate-client_iOS",
      configuration: "debug",
      simulatorId,
      derivedDataPath: join(paths.output, "native-smoke-derived-data"),
      bundleId: BUNDLE,
    };
    assertLocalPath(paths.root, defaults.projectPath);
    assertLocalPath(paths.root, defaults.derivedDataPath);
    mkdirSync(defaults.derivedDataPath, { recursive: true });
    await apple.call("session_set_defaults", {
      ...defaults,
      profile: `native-ios-${runId}`,
      createIfNotExists: true,
      persist: false,
      env: {},
      extraArgs: [],
      preferXcodebuild: true,
    });
    checkDefaults(await apple.call("session_show_defaults"), defaults);
    await buildSmokeApp(apple, simulatorId);
    const built = toolData(
      await apple.call("get_sim_app_path", { platform: "iOS Simulator" }),
    );
    const appPath = built.appPath;
    if (
      !appPath ||
      !realpathSync(appPath).startsWith(
        realpathSync(defaults.derivedDataPath) + "/",
      )
    )
      fail("The built app is outside the reserved output.");
    const bundle = toolData(await apple.call("get_app_bundle_id", { appPath }));
    if (bundle.bundleId !== BUNDLE)
      fail("The built artifact is not the isolated smoke app.");
    await apple.call("install_app_sim", { appPath, simulatorId });
    installed = true;
    const containers = await inspectContainers(base, execute);
    if (containers.data.length !== 1 || containers.bundle.length !== 1)
      fail("The installed smoke data container is unavailable before launch.");
    container = containers.data[0];
    claimContainer(container, runId);
    provider = await startProvider(runId, supervisor);
    let previousRequests;
    for (const phase of ["exercise", "reopen"]) {
      const report = await launchPhase(
        apple,
        provider,
        { container, runId, simulatorId, supervisor, phase },
        signal,
      );
      if (
        report.providerRequests !== 4 ||
        Object.entries({ main: 4, title: 0, comment: 0, compaction: 0 }).some(
          ([kind, count]) => report.dispatchCounts?.[kind] !== count,
        ) ||
        (phase === "reopen" &&
          (!report.keysDeleted ||
            report.deletedKeys < 1 ||
            report.providerRequests !== previousRequests))
      )
        fail(
          "The native iOS journey did not preserve results or delete its owned credentials.",
        );
      previousRequests = report.providerRequests;
    }
    completed = true;
    result = {
      runId,
      passed: true,
      qualification: "debug",
      launches: 2,
      supervisorSha256: supervisor,
      providerRequests: previousRequests,
      keysDeleted: true,
    };
  } catch (error) {
    firstFailure = error;
  } finally {
    let cleanupFailed = false,
      cleanupComplete = false;
    try {
      if (installed && container && provider && !completed && apple) {
        try {
          assertOwned(container, runId);
          if (signal.aborted || apple.ended || apple.closing) {
            await apple.close();
            apple = appleFactory(environment, AbortSignal.timeout(30000));
            await apple.initialize();
            await apple.call("session_show_defaults");
          }
          try {
            await apple.call("stop_app_sim", { bundleId: BUNDLE, simulatorId });
          } catch {
            /* The fresh launch identity below must still prove cleanup. */
          }
          const report = await launchPhase(
            apple,
            provider,
            { container, runId, simulatorId, supervisor, phase: "cleanup" },
            AbortSignal.timeout(30000),
          );
          if (!report.keysDeleted) cleanupFailed = true;
        } catch {
          cleanupFailed = true;
        }
      }
      try {
        await provider?.close();
      } catch {
        cleanupFailed = true;
      }
      try {
        await apple?.close();
      } catch {
        cleanupFailed = true;
      }
      sessionController.abort();
      await session;
      if (sessionFailure?.cleanupUnsafe) cleanupFailed = true;
      cleanupComplete = true;
    } finally {
      try {
        releaseSmokeSession({
          cleanupFailed: cleanupFailed || !cleanupComplete,
          reserved,
          reservation,
          unlock,
          runId,
          simulatorId,
        });
      } catch (error) {
        if (firstFailure?.diagnostic)
          error.diagnostic = firstFailure.diagnostic;
        if (firstFailure?.nativeFailure)
          error.nativeFailure = firstFailure.nativeFailure;
        firstFailure = error;
      }
    }
  }
  if (firstFailure) throw firstFailure;
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  const stop = () =>
    controller.abort(new Error("Native iOS smoke interrupted."));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const { values } = parseArgs({
      options: {
        "simulator-id": { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "Usage: node client/scripts/test-native-ios.mjs --simulator-id UUID\nRuns two synthetic debug app launches on a simulator without an existing smoke container.",
      );
    else {
      validateSimulator(values["simulator-id"]);
      const paths = sessionPaths(
        fileURLToPath(new URL("../", import.meta.url)),
      );
      const resource = coordinationStep(paths);
      if (resource)
        process.exitCode = await runCoordinated({
          directory: paths.root,
          resource,
          environment: {
            ...process.env,
            SITUATE_NATIVE_IOS_BUILD_HELD: resource === "build" ? paths.id : "",
          },
          command: process.execPath,
          args: [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
          signal: controller.signal,
        });
      else
        console.log(
          JSON.stringify(
            await nativeIos(paths, {
              simulatorId: values["simulator-id"],
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(900000),
              ]),
            }),
          ),
        );
    }
  } catch (error) {
    if (error.diagnostic || error.code === "ios-build-lock-retained")
      console.error(
        JSON.stringify({
          passed: false,
          qualification: "not-established",
          code: error.code,
          projectSessionReleased:
            error.projectSessionReleased ??
            error.code !== "ios-build-lock-retained",
          apple: error.diagnostic,
          nativeFailure: error.nativeFailure,
        }),
      );
    else if (error.code === "ios-cleanup-unverified")
      console.error(
        JSON.stringify({
          passed: false,
          stage: "cleanup",
          qualification: "not-established",
          projectSessionReleased: true,
          simulatorReservationRetained: error.simulatorId,
          runId: error.runId,
          nativeFailure: error.nativeFailure,
        }),
      );
    else if (error.nativeFailure)
      console.error(
        JSON.stringify({
          passed: false,
          qualification: "not-established",
          code: error.code,
          ...error.nativeFailure,
        }),
      );
    else
      console.error(
        "Native iOS smoke failed; no native qualification was established.",
      );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
