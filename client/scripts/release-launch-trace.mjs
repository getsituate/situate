import assert from "node:assert/strict";
import {
  constants,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createFinalArtifactQualificationHost } from "./final-artifact-qualification.mjs";
import { createQualificationProcess } from "./final-artifact-process.mjs";
import { run } from "./ios-xcode.mjs";

const maximumBytes = 256 * 1024;
const privateQuery = `(() => {
  const result = { processes: [] };
  const attribute = (object, name) => {
    try {
      const value = object[name]();
      if (typeof value === "string") return { type: "string", value: value.slice(0, 512), truncated: value.length > 512 };
      return { type: value === null ? "null" : typeof value };
    } catch (error) {
      return { error: String(error).slice(0, 512) };
    }
  };
  try {
    const events = Application("System Events");
    for (const name of ["CoreServicesUIAgent", "SecurityAgent", "Situate"]) {
      const item = { name, windows: [] };
      result.processes.push(item);
      try {
        const process = events.applicationProcesses.byName(name);
        item.present = process.exists();
        if (!item.present) continue;
        const windows = process.windows();
        item.windowCount = windows.length;
        for (const window of windows.slice(0, 4)) {
          const snapshot = { role: attribute(window, "role"), name: attribute(window, "name"), elements: [] };
          item.windows.push(snapshot);
          const visit = (parent) => {
            if (snapshot.elements.length >= 64) { snapshot.truncated = true; return; }
            let children;
            try { children = parent.uiElements(); } catch (error) { snapshot.childError = String(error).slice(0, 512); return; }
            for (const child of children) {
              if (snapshot.elements.length >= 64) { snapshot.truncated = true; return; }
              snapshot.elements.push({ role: attribute(child, "role"), name: attribute(child, "name"), value: attribute(child, "value"), description: attribute(child, "description") });
              visit(child);
            }
          };
          visit(window);
        }
      } catch (error) { item.error = String(error).slice(0, 512); }
    }
  } catch (error) { result.error = String(error).slice(0, 512); }
  const text = JSON.stringify(result);
  return text.length <= 131072 ? text : JSON.stringify({ error: "snapshot_limit" });
})()`;

function failure(error) {
  return {
    name: String(error?.name ?? "Error").slice(0, 64),
    message: String(error?.message ?? "Unknown failure").slice(0, 4096),
  };
}

export function writePrivateLaunchTrace(path, trace) {
  assert.equal(basename(path), "launch-trace.json");
  const parent = dirname(resolve(path)),
    stat = lstatSync(parent);
  assert(
    parent === realpathSync(parent) &&
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o777) === 0o700,
    "Launch trace requires owned private storage",
  );
  const bytes = Buffer.from(`${JSON.stringify(trace)}\n`);
  assert(bytes.length <= maximumBytes, "Launch trace exceeds its bound");
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function createLaunchTraceAdapters(
  path,
  { execute = run, createHost = createFinalArtifactQualificationHost } = {},
) {
  const trace = {
    schemaVersion: 1,
    kind: "macos-launch-diagnostic",
    qualification: false,
    launch: null,
    sample: null,
  };
  let started;
  const raw = async (command, args, options) => {
    if (basename(command) !== "open") return execute(command, args, options);
    started = performance.now();
    trace.launch = { command, args, exits: [] };
    try {
      return await execute(command, args, {
        ...options,
        onExit: (event) => {
          trace.launch.exits.push({
            ...event,
            elapsedMs: Math.round(performance.now() - started),
            afterAbort: options.signal?.aborted === true,
          });
          options.onExit?.(event);
        },
      });
    } catch (error) {
      trace.launch.failure = failure(error);
      throw error;
    }
  };
  return {
    createProcess(options) {
      const diagnostic = createQualificationProcess({
        ...options,
        execute: raw,
        observeLaunch: async ({ signal, environment }) => {
          const timeout = AbortSignal.timeout(3000);
          const combined = signal
            ? AbortSignal.any([signal, timeout])
            : timeout;
          const options = {
            env: environment,
            capture: true,
            signal: combined,
            terminationGraceMs: 2000,
          };
          const results = await Promise.allSettled([
            execute(
              "/usr/bin/osascript",
              ["-l", "JavaScript", "-e", privateQuery],
              options,
            ),
            execute(
              "/bin/ps",
              ["-U", String(process.getuid()), "-o", "pid=,ppid=,stat=,comm="],
              options,
            ),
          ]);
          trace.sample = {
            elapsedMs: Math.round(performance.now() - started),
            results: results.map((result, index) =>
              result.status === "fulfilled"
                ? {
                    kind: index === 0 ? "dialogs" : "processes",
                    output: String(result.value).slice(
                      0,
                      index === 0 ? 131072 : 32768,
                    ),
                    truncated:
                      String(result.value).length >
                      (index === 0 ? 131072 : 32768),
                  }
                : {
                    kind: index === 0 ? "dialogs" : "processes",
                    failure: failure(result.reason),
                  },
            ),
          };
          return "observation_unavailable";
        },
      });
      const readOnly = (command, args, options) =>
        diagnostic(command, args, { ...options, confirmFirstLaunch: false });
      readOnly.assertProgress = diagnostic.assertProgress;
      return readOnly;
    },
    createHost(configuration, options) {
      const host = createHost(configuration, options);
      return {
        ...host,
        async install(input) {
          trace.artifact = {
            version: input.artifact.version,
            sha256: input.artifact.sha256,
            bundleSha256: input.artifact.bundleSha256,
          };
          return host.install(input);
        },
        async journeys() {
          throw new Error(
            "Launch diagnostic stops before product qualification journeys",
          );
        },
        async cleanup(input) {
          let cleanupError, traceError;
          try {
            await host.cleanup(input);
          } catch (error) {
            cleanupError = error;
            trace.cleanup = failure(error);
          }
          if (trace.launch) {
            try {
              trace.elapsedMs = Math.round(performance.now() - started);
              if (Buffer.byteLength(JSON.stringify(trace)) > maximumBytes)
                trace.sample = { captureLimitExceeded: true };
              writePrivateLaunchTrace(path, trace);
            } catch (error) {
              traceError = error;
            }
          }
          if (cleanupError && traceError)
            throw new AggregateError(
              [cleanupError, traceError],
              "Launch diagnostic cleanup and retention failed",
              { cause: cleanupError },
            );
          if (cleanupError) throw cleanupError;
          if (traceError) throw traceError;
        },
      };
    },
  };
}
