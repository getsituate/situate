import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  controllers.set(controller, { binding, args, env });
  return controller;
}

/** Runs only on a trusted disposable macOS runner; the callback receives no SSH configuration. */
export async function withQualificationRoute(
  routeConfig,
  callback,
  { execute = execFileSync, platform = process.platform } = {},
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
  const request = { ...operation, hostname, privateAddress, localPort };
  const env = { PATH: context.env.PATH, LANG: "C" };
  const socket = "/private/var/run/situate-qualification-route/ssh";
  const effect = (args, label) => {
    try {
      return execute("/usr/bin/sudo", ["-n", ...args], {
        env,
        timeout: 30_000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024,
      });
    } catch {
      throw new Error(
        `Private runner ${label} outcome is uncertain; inspect operation ${operation.operationNonce}`,
      );
    }
  };
  const runner = (action) =>
    effect(
      [
        "/usr/bin/python3",
        "-c",
        `import base64;exec(base64.b64decode("${program()}"))`,
        action,
        Buffer.from(JSON.stringify(request)).toString("base64"),
      ],
      action,
    );
  const ssh = (args) =>
    effect(["/usr/bin/ssh", "-F", "/dev/null", ...args], "SSH control");
  const base = ["-S", socket, ...context.args];
  let reserved = false;
  let masterAttempted = false;
  let teardownFailed = false;
  const errors = [];
  let result;
  try {
    runner("runner-prepare");
    reserved = true;
    runner("runner-ssh-pending");
    masterAttempted = true;
    ssh([
      "-M",
      "-f",
      "-N",
      "-o",
      "ControlPersist=no",
      "-o",
      "ExitOnForwardFailure=yes",
      "-L",
      `${privateAddress}:${localPort}:127.0.0.1:${context.binding.hostPort}`,
      ...base,
    ]);
    ssh(["-O", "check", ...base]);
    runner("runner-serving");
    result = await callback(
      Object.freeze({
        ...state,
        privateAddress,
        interface: "lo0",
        runnerPort: localPort,
      }),
    );
  } catch (error) {
    errors.push(error);
    if (reserved) {
      try {
        runner("runner-failed");
      } catch (recordError) {
        errors.push(recordError);
      }
    }
  } finally {
    if (reserved) {
      if (masterAttempted) {
        try {
          ssh(["-O", "exit", ...base]);
        } catch {
          teardownFailed = true;
          errors.push(
            new Error(
              "SSH forward teardown is uncertain; runner ownership retained",
            ),
          );
        }
      }
      if (teardownFailed) {
        try {
          runner("runner-failed");
        } catch (error) {
          errors.push(error);
        }
      } else {
        try {
          runner("runner-cleanup");
        } catch (error) {
          errors.push(error);
        }
      }
    }
  }
  if (errors.length) {
    const error = new AggregateError(
      errors,
      "Private qualification route failed; inspect retained operation evidence before recovery",
    );
    error.operationNonce = operation.operationNonce;
    error.uncertain = true;
    throw error;
  }
  return result;
}
