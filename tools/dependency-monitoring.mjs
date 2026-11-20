import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safePath } from "./release-catalog.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function monitoringCommands() {
  return [
    ...[".", "client", "requirements"].map((directory) => ({
      id: `npm-${directory === "." ? "root" : directory}`,
      command: "npm",
      args: ["audit", "--package-lock-only", "--audit-level=high", "--json"],
      directory,
    })),
    ...["client", "tools/dev-tui"].map((directory) => ({
      id: directory === "client" ? "cargo-client" : "cargo-dev-tui",
      command: "cargo-deny",
      args: [
        "--manifest-path",
        `${directory}/Cargo.toml`,
        "--locked",
        "--target",
        "aarch64-apple-darwin",
        "--target",
        "x86_64-apple-darwin",
        "check",
        "--config",
        "client/deny.toml",
        "advisories",
      ],
      directory: ".",
    })),
  ];
}
function reportOutput(directory, requested, names) {
  const checkout = realpathSync(directory);
  const selected = resolve(
    requested ?? join(directory, "test-results/dependency-monitoring"),
  );
  const local = [resolve(directory), checkout]
    .map((anchor) => relative(anchor, selected))
    .find(
      (path) =>
        path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path),
    );
  const output =
    local === undefined
      ? selected
      : local
        ? safePath(checkout, local.split(sep).join("/"))
        : checkout;
  mkdirSync(output, { recursive: true });
  if (!lstatSync(output).isDirectory())
    throw new Error("Report output must be a directory.");
  const target = realpathSync(output);
  function destination(name) {
    const path = safePath(target, name);
    const previous = lstatSync(path, { throwIfNoEntry: false });
    if (previous && !previous.isFile())
      throw new Error(`Invalid report output: ${name}`);
    return path;
  }
  for (const name of names) destination(name);
  return (name, contents) => {
    const path = destination(name);
    const temporary = safePath(target, `.monitor-${randomUUID()}.tmp`);
    const fd = openSync(temporary, "wx", 0o600);
    try {
      try {
        writeFileSync(fd, contents);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  };
}

export function monitor({
  directory = root,
  reportDirectory,
  execute = spawnSync,
} = {}) {
  const commands = monitoringCommands();
  const write = reportOutput(directory, reportDirectory, [
    "report.json",
    ...commands.map(({ id }) => `${id}.txt`),
  ]);
  const results = commands.map(({ id, command, args, directory: cwd }) => {
    const result = execute(command, args, {
      cwd: resolve(directory, cwd),
      encoding: "utf8",
      timeout: 15 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    write(`${id}.txt`, details);
    console.log(`Dependency monitor: ${id}\n${details}`);
    return {
      id,
      status: result.error || result.status !== 0 ? "failed" : "passed",
      exitCode: result.status ?? null,
      error: result.error?.code ?? null,
    };
  });
  const report = {
    schemaVersion: 1,
    status: results.every(({ status }) => status === "passed")
      ? "passed"
      : "failed",
    results,
  };
  write("report.json", `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 2) {
    console.error(
      "Set a report directory using the pipeline container launcher.",
    );
    process.exitCode = 2;
  } else {
    const report = monitor();
    console.log(JSON.stringify(report));
    if (report.status !== "passed") process.exitCode = 1;
  }
}
