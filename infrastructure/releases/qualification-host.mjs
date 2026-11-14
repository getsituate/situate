import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sshArguments } from "./transport.mjs";

const controllers = new WeakMap();
const noncePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const pathPattern =
  /^[A-Za-z0-9][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+-]*)*$/;
const program = () =>
  readFileSync(new URL("./qualification-host.py", import.meta.url)).toString(
    "base64",
  );
const remoteCommand = (action, request) =>
  `python3 -c 'import base64;exec(base64.b64decode("${program()}"))' ${action} ${Buffer.from(JSON.stringify(request)).toString("base64")}`;

function identity(request) {
  const operationNonce = request?.operationNonce;
  const operationId = request?.operationId ?? operationNonce;
  assert(
    typeof operationNonce === "string" &&
      typeof operationId === "string" &&
      noncePattern.test(operationNonce) &&
      noncePattern.test(operationId),
    "Invalid qualification operation identity",
  );
  return { operationId, operationNonce };
}

function sshConfig(config) {
  for (const key of ["sshIdentity", "sshKnownHosts"])
    assert(
      typeof config[key] === "string" &&
        config[key].startsWith("/") &&
        !/[\r\n\0]/.test(config[key]),
      "Explicit SSH identity and verified known-hosts paths are required",
    );
  return sshArguments({
    WEBSITE_DEPLOY_HOST: config.host,
    WEBSITE_SSH_IDENTITY: config.sshIdentity,
    WEBSITE_SSH_KNOWN_HOSTS: config.sshKnownHosts,
  });
}

function hostConfig(config) {
  const result = {
    caddyContainer: config.caddyContainer,
    hostname: config.hostname,
    certificateMount: config.certificateMount ?? "/data",
    certificatePath: config.certificatePath,
    keyPath: config.keyPath,
    hostPort: config.hostPort ?? 24443,
    feedPath: config.feedPath,
    publicFeedSha256: config.publicFeedSha256,
  };
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(result.caddyContainer ?? ""),
    "Invalid Caddy container name",
  );
  assert(
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(result.hostname ?? "") &&
      result.hostname.includes("."),
    "Invalid TLS hostname",
  );
  assert(
    Number.isInteger(result.hostPort) &&
      result.hostPort >= 1024 &&
      result.hostPort <= 65535,
    "Invalid host loopback port",
  );
  assert(
    /^[a-f0-9]{64}$/.test(result.publicFeedSha256 ?? ""),
    "Original public feed SHA-256 is required",
  );
  for (const key of ["certificatePath", "keyPath", "feedPath"])
    assert(
      pathPattern.test(result[key] ?? ""),
      "Invalid certificate or feed path",
    );
  assert(
    result.certificateMount.startsWith("/") &&
      pathPattern.test(result.certificateMount.slice(1)),
    "Invalid certificate mount path",
  );
  return result;
}

function fileDigest(path, expected) {
  assert(
    lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
    "Candidate source must be a regular file",
  );
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(fd);
    assert(
      info.isFile() && info.nlink === 1 && info.size === expected.size,
      "Candidate source size or ownership differs",
    );
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(1024 * 1024);
    let size;
    while ((size = readSync(fd, chunk, 0, chunk.length, null)) > 0)
      hash.update(chunk.subarray(0, size));
    assert(
      hash.digest("hex") === expected.sha256,
      "Candidate source hash differs",
    );
  } finally {
    closeSync(fd);
  }
}

/** Effects are single-attempt. A lost response requires inspect(), not an automatic replay. */
export function createQualificationHost(
  config,
  { execute = execFileSync, environment = process.env } = {},
) {
  config = structuredClone(config);
  const args = sshConfig(config);
  const binding = hostConfig(config);
  const env = Object.fromEntries(
    ["PATH", "HOME", "SSH_AUTH_SOCK", "LANG"]
      .filter((key) => Object.hasOwn(environment, key))
      .map((key) => [key, environment[key]]),
  );
  const invoke = (action, request, inputFd) => {
    const payload = {
      ...identity(request),
      config: binding,
      ...(request.files ? { files: request.files } : {}),
      ...(action === "cleanup" && request.retainArtifacts === true
        ? { retainArtifacts: true }
        : {}),
    };
    let output;
    try {
      output = execute("ssh", [...args, remoteCommand(action, payload)], {
        env,
        timeout: action === "stage" ? 600_000 : 120_000,
        encoding: "utf8",
        stdio: [inputFd ?? "ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024,
      });
    } catch {
      const error = new Error(
        `Private qualification ${action} outcome is uncertain; inspect operation ${payload.operationNonce} before recovery`,
      );
      error.operationNonce = payload.operationNonce;
      error.uncertain = true;
      throw error;
    }
    try {
      return JSON.parse(output);
    } catch {
      const error = new Error(
        "Invalid private qualification response; inspect before recovery",
      );
      error.operationNonce = payload.operationNonce;
      error.uncertain = true;
      throw error;
    }
  };
  const controller = {
    inspect: (request) => invoke("inspect", request),
    prepare: (request) => invoke("prepare", request),
    serve: (request) => invoke("serve", request),
    cleanup: (request) => invoke("cleanup", request),
    stage(request) {
      identity(request);
      assert(
        Array.isArray(request.files) &&
          request.files.length > 0 &&
          request.files.length <= 128,
        "An exact candidate file inventory is required",
      );
      const files = {};
      for (const file of request.files) {
        assert(
          pathPattern.test(file.path ?? "") &&
            file.path !== "identity.json" &&
            !Object.hasOwn(files, file.path),
          "Invalid or duplicate candidate path",
        );
        assert(
          Number.isSafeInteger(file.size) &&
            file.size >= 0 &&
            /^[a-f0-9]{64}$/.test(file.sha256 ?? ""),
          "Invalid candidate file hash",
        );
        files[file.path] = { size: file.size, sha256: file.sha256 };
      }
      assert(
        Object.hasOwn(files, binding.feedPath),
        "Candidate inventory must include the generated feed",
      );
      const temporary = mkdtempSync(
        join(tmpdir(), "situate-qualification-stage-"),
      );
      let fd;
      try {
        const payload = join(temporary, "payload");
        mkdirSync(payload, { mode: 0o700 });
        for (const file of request.files) {
          fileDigest(file.source, file);
          const destination = join(payload, file.path);
          mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
          copyFileSync(file.source, destination, constants.COPYFILE_EXCL);
          fileDigest(destination, file);
        }
        const archive = join(temporary, "candidate.tar");
        execute(
          "tar",
          [
            "--format=ustar",
            "-cf",
            archive,
            "-C",
            payload,
            ...Object.keys(files),
          ],
          {
            env: { PATH: env.PATH, COPYFILE_DISABLE: "1" },
            timeout: 120_000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        fd = openSync(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
        return invoke("stage", { ...request, files }, fd);
      } finally {
        if (fd !== undefined) closeSync(fd);
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  };
  controllers.set(controller, {
    binding,
    args,
    env,
    ssh: {
      host: config.host,
      identityPath: config.sshIdentity,
      knownHostsPath: config.sshKnownHosts,
      hostPort: binding.hostPort,
    },
  });
  return controller;
}

/** Runs only on a trusted disposable macOS runner; the callback receives no SSH configuration. */
export async function withQualificationRoute(
  routeConfig,
  callback,
  { spawnProcess = spawn, platform = process.platform, signal } = {},
) {
  const {
    host,
    hostname,
    privateAddress = "127.0.0.2",
    localPort = 443,
  } = routeConfig;
  const context = controllers.get(host);
  assert(
    context &&
      platform === "darwin" &&
      routeConfig.trustedEphemeralRunner === true,
    "Private routing requires a prepared controller and trusted ephemeral macOS runner",
  );
  assert(
    hostname === context.binding.hostname &&
      privateAddress === "127.0.0.2" &&
      localPort === 443,
    "Private routing must use the reserved hostname and runner loopback 127.0.0.2:443",
  );
  assert(
    typeof callback === "function",
    "A qualification callback is required",
  );
  const operation = identity(routeConfig);
  const state = await host.inspect(operation);
  assert(
    state.operationNonce === operation.operationNonce &&
      state.operationId === operation.operationId &&
      state.publicFeedSha256 === context.binding.publicFeedSha256 &&
      state.status === "serving" &&
      !state.uncertain &&
      state.containerRunning === true,
    "Private listener is not verified serving",
  );
  signal?.throwIfAborted();
  const request = {
    route: { ...operation, hostname, privateAddress, localPort },
    ssh: context.ssh,
  };
  const guardian = readFileSync(
    new URL("./qualification-route-guardian.py", import.meta.url),
  ).toString("base64");
  const code = `import base64,json,types,sys\nr=types.ModuleType('qualification_runner')\nexec(base64.b64decode('${program()}'),r.__dict__)\ng=types.ModuleType('qualification_guardian')\nexec(base64.b64decode('${guardian}'),g.__dict__)\nsys.exit(g.guardian_main(r,json.loads(base64.b64decode('${Buffer.from(JSON.stringify(request)).toString("base64")}'))))`;
  const ready = Promise.withResolvers();
  const exited = Promise.withResolvers();
  const lifetime = new AbortController();
  const errors = [];
  let pending = "",
    size = 0,
    closed,
    isReady = false;
  const child = spawnProcess(
    "/usr/bin/sudo",
    ["-n", "/usr/bin/python3", "-c", code],
    {
      env: { PATH: context.env.PATH, LANG: "C" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const failure = () => {
    const error = new Error(
      "Private route guardian failed; inspect retained operation evidence",
    );
    error.operationNonce = operation.operationNonce;
    error.uncertain = true;
    return error;
  };
  const fail = () => {
    const error = failure();
    lifetime.abort(error);
    if (!isReady) ready.reject(error);
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
  };
  child.stdout.on("data", (chunk) => {
    size += chunk.length;
    if (size > 64 * 1024) {
      fail();
      return;
    }
    pending += chunk.toString("utf8");
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const value = JSON.parse(line);
        if (value.operationNonce !== operation.operationNonce)
          throw new Error();
        if (value.ready === true && !isReady) {
          isReady = true;
          ready.resolve();
        } else if (value.closed === true && !closed) closed = value;
        else throw new Error();
      } catch {
        fail();
      }
    }
  });
  child.stderr.resume();
  child.stdin.on("error", fail);
  child.once("error", () => {
    fail();
    exited.resolve({ failed: true });
  });
  child.once("close", (status) => {
    const okay =
      status === 0 && closed?.cleaned === true && closed?.uncertain === false;
    if (!okay || !isReady) fail();
    lifetime.abort(failure());
    exited.resolve({ failed: !okay });
  });
  const startup = setTimeout(fail, 35_000);
  startup.unref();
  const cancel = () => {
    lifetime.abort(signal.reason);
    fail();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  let result;
  try {
    await ready.promise;
    clearTimeout(startup);
    lifetime.signal.throwIfAborted();
    result = await callback(
      Object.freeze({
        ...state,
        privateAddress,
        interface: "lo0",
        runnerPort: localPort,
      }),
      lifetime.signal,
    );
  } catch (error) {
    errors.push(error);
  } finally {
    clearTimeout(startup);
    signal?.removeEventListener("abort", cancel);
    if (!child.stdin.destroyed && !child.stdin.writableEnded)
      child.stdin.end("close\n");
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ failed: true }), 90_000);
      timer.unref();
    });
    const outcome = await Promise.race([exited.promise, timeout]);
    clearTimeout(timer);
    if (outcome.failed) errors.push(failure());
  }
  if (errors.length) {
    const error = new AggregateError(
      errors,
      "Private qualification route failed; inspect retained operation evidence before recovery",
    );
    error.operationNonce = operation.operationNonce;
    error.uncertain = errors.some((item) => item?.uncertain === true);
    throw error;
  }
  return result;
}
