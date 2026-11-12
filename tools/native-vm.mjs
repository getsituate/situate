import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { readFileSync } from "node:fs";
import {
  lstat,
  chmod,
  readdir,
  mkdtemp,
  mkdir,
  open,
  writeFile,
  rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { isIP } from "node:net";

export function nativeVmConfiguration(environment = process.env) {
  const executor = environment.SITUATE_NATIVE_EXECUTOR;
  if (executor === "local") return null;
  if (executor !== undefined && executor !== "vm")
    throw new Error("Invalid native executor.");
  const file =
    environment.SITUATE_NATIVE_VM_CONFIG ??
    path.join(
      environment.HOME ?? homedir(),
      ".config/situate/native-test-vm.json",
    );
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (executor === "vm" || environment.SITUATE_NATIVE_VM_CONFIG !== undefined)
      throw new Error("Native VM configuration is missing.", { cause: error });
    return null;
  }
  const config = JSON.parse(contents);
  if (
    !config ||
    config.version !== 1 ||
    Object.keys(config).sort().join(",") !==
      "identityFile,knownHostsFile,node,user,version,vm" ||
    typeof config.vm !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.vm) ||
    typeof config.user !== "string" ||
    !/^[a-z_][a-z0-9_-]*$/.test(config.user) ||
    ![config.identityFile, config.knownHostsFile, config.node].every(
      (value) =>
        typeof value === "string" &&
        path.posix.isAbsolute(value) &&
        !hasControlCharacter(value) &&
        path.posix.normalize(value) === value,
    )
  ) {
    throw new Error("Invalid native VM configuration.");
  }
  return Object.freeze(config);
}

const hasControlCharacter = (value) =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const safeRelative = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  value
    .split("/")
    .every(
      (part) =>
        part &&
        part !== "." &&
        part !== ".." &&
        !hasControlCharacter(part) &&
        !part.includes("\\"),
    );

function command(
  program,
  args,
  { environment, signal, input, heartbeat = false, forward = false } = {},
) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: environment,
      stdio: [
        "pipe",
        forward ? "inherit" : "pipe",
        forward ? "inherit" : "pipe",
      ],
    });
    let output = "";
    let error = "";
    child.stdout?.on("data", (data) => {
      output += data;
    });
    child.stderr?.on("data", (data) => {
      error += data;
    });
    child.stdin.on("error", () => {});
    const timer = heartbeat
      ? setInterval(() => child.stdin.write(".\n"), 1000)
      : null;
    let killTimer;
    const abort = () => {
      clearInterval(timer);
      child.stdin.end();
      killTimer = setTimeout(() => child.kill("SIGKILL"), 15000);
      if (!heartbeat) child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (heartbeat) child.stdin.write(".\n");
    else child.stdin.end(input);
    const finish = () => {
      clearInterval(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", (failure) => {
      finish();
      reject(failure);
    });
    child.once("close", (code) => {
      finish();
      if (signal?.aborted)
        reject(signal.reason ?? new Error("Native VM operation cancelled."));
      else if (code === null)
        reject(new Error("Native VM transport disconnected."));
      else resolve({ code, output, error });
    });
  });
}

export async function createNativeVmRun({
  environment = process.env,
  signal,
} = {}) {
  const config = nativeVmConfiguration(environment);
  if (!config) throw new Error("Native VM execution is not configured.");
  const address = await command("tart", ["ip", config.vm], {
    environment,
    signal,
  });
  const ip = address.output.trim();
  if (address.code !== 0 || !isIP(ip))
    throw new Error("Cannot resolve the running native VM.");
  const id = randomUUID();
  const root = `/Users/${config.user}/.situate-test-runs/${id}`;
  const supervisor = readFileSync(
    new URL("./native-vm-supervisor.py", import.meta.url),
  ).toString("base64");
  const sshArgs = [
    "-F",
    "/dev/null",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile="${config.knownHostsFile.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    `HostKeyAlias=situate-native-vm-${config.vm}`,
    "-o",
    "ForwardAgent=no",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=3",
    "-i",
    config.identityFile,
    `${config.user}@${ip}`,
  ];
  const remote = (operation, data = {}, options = {}) => {
    const request = Buffer.from(
      JSON.stringify({ operation, root, id, node: config.node, ...data }),
    ).toString("base64");
    const script = `import base64;exec(compile(base64.b64decode(${JSON.stringify(supervisor)}),'native-vm-supervisor.py','exec'))`;
    return command(
      "ssh",
      [...sshArgs, `/usr/bin/python3 -c ${quote(script)} ${quote(request)}`],
      { environment, ...options },
    );
  };
  const checked = async (...args) => {
    const result = await remote(...args);
    if (result.code !== 0)
      throw new Error(
        `Native VM ${args[0]} failed (${result.code}): ${result.error}`,
      );
    return result;
  };
  await checked("create", {}, { signal });
  let state = "created";
  return {
    root,
    id,
    async upload(packageDirectory) {
      if (state !== "created")
        throw new Error("The native VM package can only be uploaded once.");
      state = "uploading";
      const temporary = await mkdtemp(
        path.join(tmpdir(), "situate-native-package-"),
      );
      const staging = path.join(temporary, "package");
      try {
        await mkdir(staging);
        const source = path.resolve(packageDirectory);
        if (
          !(await lstat(source)).isDirectory() ||
          (await lstat(source)).isSymbolicLink()
        )
          throw new Error("Package must be an ordinary directory.");
        const manifest = [];
        const copy = async (directory, relative = "") => {
          for (const name of await readdir(directory)) {
            const entry = relative ? `${relative}/${name}` : name;
            if (
              !safeRelative(entry) ||
              entry.split("/").some((part) => part.startsWith(".native-vm-")) ||
              entry === ".situate-manifest.json"
            )
              throw new Error("Unsafe package path.");
            const from = path.join(directory, name);
            const to = path.join(staging, entry);
            const info = await lstat(from);
            if (info.isDirectory()) {
              await mkdir(to);
              await copy(from, entry);
            } else if (info.isFile() && info.nlink === 1) {
              const handle = await open(
                from,
                constants.O_RDONLY | constants.O_NOFOLLOW,
              );
              try {
                const opened = await handle.stat();
                if (
                  !opened.isFile() ||
                  opened.ino !== info.ino ||
                  opened.dev !== info.dev
                )
                  throw new Error("Package changed during upload.");
                const bytes = await handle.readFile();
                await writeFile(to, bytes, { mode: info.mode & 0o777 });
                await chmod(to, info.mode & 0o777);
                manifest.push({
                  path: entry,
                  mode: info.mode & 0o777,
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                });
              } finally {
                await handle.close();
              }
            } else
              throw new Error(
                "Package contains a symlink, hard link, or special file.",
              );
          }
        };
        await copy(source);
        await writeFile(
          path.join(staging, ".situate-manifest.json"),
          JSON.stringify(manifest),
        );
        const archive = path.join(temporary, "package.tar");
        try {
          const packed = await command(
            "/usr/bin/tar",
            ["-cf", archive, "-C", staging, "."],
            { environment: { ...environment, COPYFILE_DISABLE: "1" }, signal },
          );
          if (packed.code !== 0)
            throw new Error("Cannot package native VM run.");
          const bytes = readFileSync(archive);
          await checked("upload", {}, { signal, input: bytes });
          state = "uploaded";
        } finally {
          await rm(archive, { force: true });
        }
      } catch (error) {
        state = "upload-failed";
        throw error;
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
    async execute({ entrypoint, args = [], timeoutMs = 1800000 }) {
      if (
        state !== "uploaded" ||
        !safeRelative(entrypoint) ||
        !Array.isArray(args) ||
        !args.every((arg) => typeof arg === "string" && !arg.includes("\0")) ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs <= 0
      )
        throw new Error("Invalid native VM execution.");
      state = "executing";
      const result = await remote(
        "execute",
        { entrypoint, args, timeoutMs },
        {
          heartbeat: true,
          forward: true,
          signal,
        },
      );
      // SSH's transport failure is indistinguishable from a guest exit of 255.
      if (result.code === 255)
        throw new Error(
          "Native VM connection lost; guest ownership must be checked before recovery.",
        );
      state = "completed";
      return result.code;
    },
    async cleanup() {
      if (state === "executing" || state === "uploading")
        throw new Error(
          "Native VM completion is uncertain; retaining the owned root.",
        );
      if (state === "cleaned") return;
      await checked("cleanup");
      state = "cleaned";
    },
  };
}
