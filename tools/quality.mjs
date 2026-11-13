#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versions = JSON.parse(
  readFileSync(new URL("./toolchain.quality.json", import.meta.url), "utf8"),
);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.signal ?? result.status})`);
}

function requireTool(command, versionArgs = ["--version"]) {
  const expected = versions[command].version;
  const result = spawnSync(command, versionArgs, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error)
    throw new Error(
      `Missing required tool ${command} ${expected}: ${result.error.message}`,
    );
  const actual = `${result.stdout}\n${result.stderr}`.match(
    /\b\d+\.\d+\.\d+\b/,
  )?.[0];
  if (result.status !== 0 || actual !== expected) {
    throw new Error(
      `Required ${command} ${expected}; found ${actual ?? "unrecognized version"}`,
    );
  }
}

export function nativeSources(extension, directory = root) {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: directory,
      encoding: "utf8",
    },
  );
  if (result.error || result.status !== 0)
    throw new Error("Cannot enumerate native sources with git ls-files");
  const paths = [...new Set(result.stdout.split("\0"))].filter(
    (path) =>
      path.endsWith(extension) &&
      existsSync(resolve(directory, path)) &&
      !/(^|\/)(node_modules|target|build|dist|vendor|\.build|\.gradle|\.tauri)\//.test(
        path,
      ) &&
      !path.startsWith("client/app/src-tauri/gen/"),
  );
  if (paths.length === 0) throw new Error(`No ${extension} sources found`);
  return paths;
}

const checks = {
  swift() {
    requireTool("swift-format");
    requireTool("swiftlint", ["version"]);
    const paths = nativeSources(".swift");
    const failures = [];
    for (const [command, args] of [
      [
        "swift-format",
        ["lint", "--strict", "--configuration", ".swift-format", ...paths],
      ],
      [
        "swiftlint",
        [
          "lint",
          "--strict",
          "--no-cache",
          "--config",
          ".swiftlint.yml",
          ...paths,
        ],
      ],
    ]) {
      try {
        run(command, args);
      } catch (error) {
        failures.push(error.message);
      }
    }
    if (failures.length) throw new Error(failures.join("; "));
  },
  kotlin() {
    requireTool("ktlint");
    run("ktlint", [
      "--editorconfig=.editorconfig",
      ...nativeSources(".kt"),
      ...nativeSources(".kts"),
    ]);
  },
  rust() {
    requireTool("cargo-deny");
    run(
      "cargo-deny",
      ["--locked", "check", "licenses", "bans", "sources"],
      resolve(root, "client"),
    );
  },
  "rust-audit"() {
    requireTool("cargo-deny");
    run(
      "cargo-deny",
      ["--locked", "check", "advisories"],
      resolve(root, "client"),
    );
  },
  secrets() {
    requireTool("gitleaks", ["version"]);
    run("gitleaks", [
      "dir",
      ".",
      "--redact",
      "--no-banner",
      "--config",
      ".gitleaks.toml",
    ]);
  },
  audit() {
    requireTool("npm");
    const failures = [];
    for (const directory of [".", "client", "requirements"]) {
      try {
        run(
          "npm",
          ["audit", "--package-lock-only", "--audit-level=high"],
          resolve(root, directory),
        );
      } catch (error) {
        failures.push(`${directory}: ${error.message}`);
      }
    }
    if (failures.length) throw new Error(failures.join("; "));
  },
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [name, ...extra] = process.argv.slice(2);
    if (!Object.hasOwn(checks, name) || extra.length) {
      throw new Error(
        `Usage: node tools/quality.mjs <${Object.keys(checks).join("|")}>`,
      );
    }
    checks[name]();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
