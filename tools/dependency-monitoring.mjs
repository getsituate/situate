import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

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
export function monitor({
  directory = root,
  reportDirectory = join(directory, "test-results/dependency-monitoring"),
  execute = spawnSync,
} = {}) {
  mkdirSync(reportDirectory, { recursive: true });
  const results = monitoringCommands().map(
    ({ id, command, args, directory: cwd }) => {
      const result = execute(command, args, {
        cwd: resolve(directory, cwd),
        encoding: "utf8",
        timeout: 15 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });
      const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      writeFileSync(join(reportDirectory, `${id}.txt`), details);
      console.log(`Dependency monitor: ${id}\n${details}`);
      return {
        id,
        status: result.error || result.status !== 0 ? "failed" : "passed",
        exitCode: result.status ?? null,
        error: result.error?.code ?? null,
      };
    },
  );
  const report = {
    schemaVersion: 1,
    status: results.every(({ status }) => status === "passed")
      ? "passed"
      : "failed",
    results,
  };
  writeFileSync(
    join(reportDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { "report-directory": { type: "string" } },
  });
  const report = monitor({ reportDirectory: values["report-directory"] });
  console.log(JSON.stringify(report));
  if (report.status !== "passed") process.exitCode = 1;
}
