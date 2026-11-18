import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { sshArguments } from "./transport.mjs";

const maximumBytes = 256 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const failure = () =>
  new Error(
    "Private launch trace transfer failed; inspect retained evidence before retrying.",
  );

export function launchTraceProgram() {
  return readFileSync(new URL("./launch-trace.py", import.meta.url), "utf8");
}

function binding(identity, traceId) {
  if (
    !identity ||
    Object.keys(identity).sort().join() !==
      "operationId,planDigest,sourceRevision" ||
    ![
      identity.operationId,
      identity.planDigest,
      identity.sourceRevision,
      traceId,
    ].every((value) => typeof value === "string") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(identity.operationId ?? "") ||
    !/^[a-f0-9]{64}$/.test(identity.planDigest ?? "") ||
    !/^[a-f0-9]{40}$/.test(identity.sourceRevision ?? "") ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      traceId ?? "",
    )
  )
    throw failure();
}

function jsonBytes(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 1 ||
    bytes.length > maximumBytes
  )
    throw failure();
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function exchange(
  config,
  { identity, traceId, bytes, environment = process.env, start = spawn },
  action,
) {
  let child;
  let closed;
  let output;
  try {
    binding(identity, traceId);
    const request = { action, identity, traceId };
    if (action === "retain") {
      jsonBytes(bytes);
      Object.assign(request, { size: bytes.length, sha256: sha256(bytes) });
    }
    const code = Buffer.from(launchTraceProgram()).toString("base64");
    const env = Object.fromEntries(
      ["PATH", "HOME", "LANG", "SSH_AUTH_SOCK"]
        .filter((name) => Object.hasOwn(environment, name))
        .map((name) => [name, environment[name]]),
    );
    child = start(
      "ssh",
      [
        ...sshArguments(config),
        `python3 -u -c 'import base64;exec(base64.b64decode("${code}"))'`,
      ],
      { env, stdio: ["pipe", "pipe", "pipe"], timeout: 30000 },
    );
    child.stderr.resume();
    child.stdin.on("error", () => {});
    closed = new Promise((resolve) => {
      child.once("error", () => resolve(-1));
      child.once("close", resolve);
    });
    output = (async () => {
      const chunks = [];
      let size = 0;
      for await (const chunk of child.stdout) {
        size += chunk.length;
        if (size > maximumBytes + 4096) throw failure();
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    })();
    child.stdin.end(
      Buffer.concat([
        Buffer.from(`${JSON.stringify(request)}\n`),
        ...(action === "retain" ? [bytes] : []),
      ]),
    );
    const [response, status] = await Promise.all([output, closed]);
    if (status !== 0) throw failure();
    if (action === "retain") {
      const result = JSON.parse(response.toString("utf8"));
      if (
        Object.keys(result).sort().join() !== "durable,sha256,size,traceId" ||
        result.durable !== true ||
        result.traceId !== traceId ||
        result.sha256 !== request.sha256 ||
        result.size !== request.size
      )
        throw failure();
      return { traceId, sha256: result.sha256, size: result.size };
    }
    const end = response.indexOf(10);
    if (end < 0 || end > 4096) throw failure();
    const metadata = JSON.parse(response.subarray(0, end).toString("utf8"));
    const retained = response.subarray(end + 1);
    if (
      Object.keys(metadata).sort().join() !==
        "identity,schemaVersion,sha256,size,traceId" ||
      metadata.schemaVersion !== 1 ||
      metadata.traceId !== traceId ||
      !isDeepStrictEqual(metadata.identity, identity) ||
      metadata.size !== retained.length ||
      metadata.sha256 !== sha256(retained)
    )
      throw failure();
    jsonBytes(retained);
    return retained;
  } catch {
    child?.stdin.destroy();
    child?.kill("SIGTERM");
    await output?.catch(() => {});
    await closed;
    throw failure();
  }
}

export function retainLaunchTrace(config, options) {
  return exchange(config, options, "retain");
}

export function readLaunchTrace(config, options) {
  return exchange(config, options, "read");
}
