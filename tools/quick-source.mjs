import { spawn, execFileSync } from "node:child_process";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { extname, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const textExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".jsx",
  ".vue",
  ".json",
  ".md",
  ".adoc",
  ".rs",
  ".swift",
  ".toml",
  ".yaml",
  ".yml",
  ".css",
  ".html",
]);

export async function checkSources(
  directory,
  files,
  { syntax = true, deadline = performance.now() + 3000, signal } = {},
) {
  const errors = [];
  const controller = new AbortController();
  const executionSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.ceil(deadline - performance.now())),
  );
  const remaining = files.values();
  async function worker() {
    for (const file of remaining) {
      executionSignal.throwIfAborted();
      if (performance.now() >= deadline)
        throw new Error(
          "Source checks exceeded their execution budget; run --feedback --changed.",
        );
      const path = resolve(directory, file);
      const local = relative(directory, path);
      if (local === ".." || local.startsWith("../") || isAbsolute(local))
        throw new Error("Source checks require worktree-local files.");
      if (!textExtensions.has(extname(file))) continue;
      let before;
      try {
        before = lstatSync(path);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!before.isFile()) continue;
      const resolved = relative(realpathSync(directory), realpathSync(path));
      if (
        resolved === ".." ||
        resolved.startsWith("../") ||
        isAbsolute(resolved)
      )
        throw new Error("Source checks require worktree-local files.");
      if (before.size > 2 * 1024 * 1024) {
        errors.push(
          `${file}: too large for quick source checks; run --feedback --changed`,
        );
        continue;
      }
      const source = readFileSync(path, "utf8");
      if (/^(?:<{7} |={7}$|>{7} )/m.test(source))
        errors.push(`${file}: unresolved merge conflict`);
      if (extname(file) === ".json") {
        try {
          JSON.parse(source);
        } catch {
          errors.push(`${file}: invalid JSON`);
        }
      }
      if (syntax && /\.[cm]?js$/.test(file)) {
        const status = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ["--check", path], {
            stdio: "ignore",
            signal: executionSignal,
            killSignal: "SIGKILL",
            env: { ...process.env, NODE_OPTIONS: "", NODE_TEST_CONTEXT: "" },
          });
          let error;
          child.on("error", (cause) => {
            error = cause;
          });
          child.on("close", (code) => {
            if (error) reject(error);
            else resolve(code);
          });
        });
        executionSignal.throwIfAborted();
        if (status !== 0)
          errors.push(`${file}: JavaScript syntax check failed`);
      }
      const after = lstatSync(path);
      if (
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        errors.push(`${file}: changed during source checks`);
    }
  }
  const workers = Array.from({ length: 4 }, () => worker());
  try {
    await Promise.all(workers);
    if (performance.now() >= deadline) controller.abort();
    executionSignal.throwIfAborted();
    return errors;
  } catch (error) {
    controller.abort();
    await Promise.allSettled(workers);
    if (performance.now() >= deadline)
      throw new Error(
        "Source checks exceeded their execution budget; run --feedback --changed.",
        { cause: error },
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.once(signal, () => controller.abort());
  const args = process.argv.slice(2);
  const syntax = args[0] !== "--scan";
  if (!syntax) args.shift();
  try {
    const files = syntax
      ? args
      : [
          ...new Set(
            execFileSync(
              "git",
              ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
              {
                encoding: "utf8",
                timeout: 1000,
                maxBuffer: 16 * 1024 * 1024,
              },
            )
              .split("\0")
              .filter(Boolean),
          ),
        ];
    const errors = await checkSources(process.cwd(), files, {
      syntax,
      signal: controller.signal,
    });
    if (errors.length) console.error(errors.join("\n"));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = /budget/.test(error.message) ? 75 : 1;
  }
}
