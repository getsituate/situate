import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmdirSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function worktreeRoot(directory) {
  try {
    return realpathSync(
      execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
      }).trim(),
    );
  } catch {
    return realpathSync(directory);
  }
}

export function coordinated(directory, environment = process.env) {
  return environment.SITUATE_COORDINATED_WORKTREE === worktreeRoot(directory);
}

export async function runCoordinated({
  directory,
  resource = "worktree",
  command,
  args = [],
  environment = process.env,
  signal,
  output,
  cleanupGraceMs = 2000,
  onTiming = () => {},
}) {
  signal?.throwIfAborted();
  if (
    !Number.isInteger(cleanupGraceMs) ||
    cleanupGraceMs < 1 ||
    cleanupGraceMs > 120000
  )
    throw new Error(
      "Coordinated cleanup grace must be an integer from 1 to 120000 ms.",
    );
  if (!["worktree", "desktop", "build"].includes(resource))
    throw new Error("Unknown coordinated resource.");
  if (
    resource === "build" &&
    environment.SITUATE_HOST_ADMISSION &&
    environment.SITUATE_HOST_ADMITTED !== "1"
  ) {
    const controller = new AbortController();
    const admissionSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    let signalExit;
    const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => {
      const handler = () => {
        signalExit = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[name];
        controller.abort();
      };
      process.on(name, handler);
      return [name, handler];
    });
    try {
      const { withHostBuildAdmission } =
        await import("./container-admission.mjs");
      const code = await withHostBuildAdmission(
        (admittedEnvironment) =>
          runCoordinated({
            directory,
            resource,
            command,
            args,
            environment: admittedEnvironment,
            signal: admissionSignal,
            output,
            cleanupGraceMs,
          }),
        { environment, signal: admissionSignal, onTiming },
      );
      return signalExit ?? code;
    } catch (error) {
      if (signalExit !== undefined) return signalExit;
      throw error;
    } finally {
      for (const [name, handler] of handlers)
        process.removeListener(name, handler);
    }
  }
  let dockerLeaseDirectory;
  if (resource === "worktree") {
    const workspace = worktreeRoot(directory);
    if (environment.SITUATE_COORDINATED_WORKTREE !== workspace) {
      const temp = realpathSync(tmpdir());
      const fromWorkspace = relative(workspace, temp);
      const outside =
        isAbsolute(fromWorkspace) ||
        fromWorkspace === ".." ||
        fromWorkspace.startsWith(`..${sep}`);
      // The child keeps its TMPDIR, but Docker control files must not be mounted with the checkout.
      const leaseRoot = outside ? temp : realpathSync("/tmp");
      dockerLeaseDirectory = mkdtempSync(
        join(leaseRoot, "situate-docker-lease-"),
      );
    }
  }
  const dockerLease = dockerLeaseDirectory
    ? join(dockerLeaseDirectory, "container.json")
    : undefined;
  const child = spawn(
    "python3",
    [
      "-u",
      fileURLToPath(new URL("./worktree-supervisor.py", import.meta.url)),
      "--cleanup-grace-ms",
      String(cleanupGraceMs),
      ...(dockerLease ? ["--docker-lease", dockerLease] : []),
      resource,
      realpathSync(directory),
      command,
      ...args,
    ],
    {
      cwd: directory,
      env: dockerLease
        ? { ...environment, SITUATE_DOCKER_LEASE: dockerLease }
        : environment,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  let timingBuffer = "";
  child.stdio[3].setEncoding("utf8");
  child.stdio[3].on("data", (chunk) => {
    timingBuffer += chunk;
    const lines = timingBuffer.split("\n");
    timingBuffer = lines.pop();
    for (const line of lines) {
      try {
        onTiming(JSON.parse(line));
      } catch {
        /* Telemetry cannot change command ownership. */
      }
    }
  });
  child.stdout.pipe(output ?? process.stdout, { end: false });
  child.stderr.pipe(output ?? process.stderr, { end: false });
  // The pipe is a lease on the caller's lifetime, including an uncatchable kill.
  const abort = () => child.stdin.end();
  let signalExit;
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => {
    const handler = () => {
      signalExit = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[name];
      abort();
    };
    process.on(name, handler);
    return [name, handler];
  });
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  child.stdin.on("error", () => {});
  try {
    return await new Promise((done, reject) => {
      child.once("error", (error) => {
        if (dockerLeaseDirectory) {
          try {
            rmdirSync(dockerLeaseDirectory);
          } catch {
            /* A nonempty lease directory belongs to the supervisor. */
          }
        }
        reject(error);
      });
      child.once("close", (code) => done(signalExit ?? code ?? 1));
    });
  } finally {
    signal?.removeEventListener("abort", abort);
    for (const [name, handler] of handlers)
      process.removeListener(name, handler);
    child.stdin.destroy();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  let resource = "worktree";
  if (args[0] === "--resource") {
    resource = args[1];
    args.splice(0, 2);
  }
  if (args.shift() !== "--" || !args.length) {
    console.error(
      "Usage: node tools/run-coordinated.mjs [--resource desktop|build] -- command [arguments]",
    );
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = await runCoordinated({
        directory: process.cwd(),
        resource,
        command: args.shift(),
        args,
        onTiming: (event) => {
          try {
            writeSync(3, JSON.stringify(event) + "\n");
          } catch {
            /* No timing consumer. */
          }
        },
      });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
