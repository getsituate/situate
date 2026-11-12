#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function prerequisites(
  directory = root,
  {
    coverage = false,
    extended = false,
    platform = process.platform,
    environment = process.env,
  } = {},
) {
  const checks = [
    [
      "root dependencies (npm ci)",
      "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    ],
    [
      "client dependencies (npm ci --prefix client)",
      "client/node_modules/vitest/vitest.mjs",
    ],
    [
      "requirements dependencies (npm ci --prefix requirements)",
      "requirements/node_modules/vite/bin/vite.js",
    ],
  ].map(([name, path]) => ({ name, path: join(directory, path) }));
  if (environment.PI_PACKAGE_ROOT)
    checks[0].path = join(environment.PI_PACKAGE_ROOT, "dist/index.js");
  for (const [name, command, args] of [
    ["Volta", "volta", ["--version"]],
    ["Git", "git", ["--version"]],
    [
      "Python for workflow contract tests",
      platform === "win32" ? "python" : "python3",
      ["--version"],
    ],
    ["Bash for workflow contract tests", "bash", ["--version"]],
    ...(extended ? [["Kotlin linter", "ktlint", ["--version"]]] : []),
    ["Rust dependency policy tool", "cargo-deny", ["--version"]],
    ["Secret scanner", "gitleaks", ["version"]],
    ...(platform === "darwin"
      ? [
          ["Swift formatter", "swift-format", ["--version"]],
          ["Swift linter", "swiftlint", ["version"]],
        ]
      : []),
    ["Rust toolchain", "cargo", ["--version"]],
    ["Rust formatting component", "cargo", ["fmt", "--version"]],
    ...(platform === "darwin" || extended
      ? [["Rust Clippy component", "cargo", ["clippy", "--version"]]]
      : []),
    ["Docker engine", "docker", ["info"]],
    ["Docker Buildx", "docker", ["buildx", "version"]],
    ...(platform === "darwin"
      ? [
          ["Apple Swift", "swift", ["--version"]],
          ["Xcode", "xcodebuild", ["-version"]],
        ]
      : []),
    ...(platform === "linux" && extended
      ? [
          ["D-Bus session launcher", "dbus-run-session", ["--version"]],
          ["Xvfb launcher", "xvfb-run", ["--help"]],
          [
            "WebKitGTK 4.1 development files",
            "pkg-config",
            ["--exists", "webkit2gtk-4.1"],
          ],
          [
            "AppIndicator development files",
            "pkg-config",
            ["--exists", "ayatana-appindicator3-0.1"],
          ],
        ]
      : []),
    ...(coverage
      ? [["Rust LLVM coverage tool", "cargo", ["llvm-cov", "--version"]]]
      : []),
  ])
    checks.push({ name, command, args });
  if (coverage)
    checks.push({
      name: "Vitest V8 coverage provider",
      path: join(
        directory,
        "client/node_modules/@vitest/coverage-v8/package.json",
      ),
    });
  return checks;
}

export function toolchainProblems(pins, node, npm) {
  return Object.entries({ node, npm })
    .filter(([tool, version]) => version !== pins[tool])
    .map(
      ([tool, version]) =>
        `${tool} ${pins[tool]} (running ${version || "unavailable"}); use Volta with its shims first on PATH`,
    );
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      coverage: { type: "boolean" },
      extended: { type: "boolean" },
    },
  });
  const missing = [];
  const { volta } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const npm = spawnSync("npm", ["--version"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
  });
  missing.push(
    ...toolchainProblems(volta, process.versions.node, npm.stdout?.trim()),
  );
  for (const check of prerequisites(root, values)) {
    const result = check.path
      ? { status: existsSync(check.path) ? 0 : 1 }
      : spawnSync(check.command, check.args, {
          cwd: join(root, "client"),
          encoding: "utf8",
          timeout: 15000,
          stdio: "pipe",
        });
    if (result.status !== 0)
      missing.push(
        `${check.name}: ${check.path ?? [check.command, ...check.args].join(" ")}${result.error ? ` (${result.error.message})` : ""}`,
      );
  }
  if (values.coverage) {
    const options = {
      cwd: join(root, "client"),
      encoding: "utf8",
      timeout: 15000,
    };
    const sysroot = spawnSync("rustc", ["--print", "sysroot"], options);
    const compiler = spawnSync("rustc", ["-vV"], options);
    const host = compiler.stdout?.match(/^host: (.+)$/m)?.[1];
    if (sysroot.status !== 0 || compiler.status !== 0 || !host)
      missing.push(
        "Active Rust compiler sysroot and host (rustc --print sysroot; rustc -vV)",
      );
    else
      for (const tool of ["llvm-profdata", "llvm-cov"]) {
        const path = join(
          sysroot.stdout.trim(),
          "lib/rustlib",
          host,
          "bin",
          `${tool}${process.platform === "win32" ? ".exe" : ""}`,
        );
        if (!existsSync(path))
          missing.push(
            `Rust LLVM tool: ${path}. Put the pinned rustup toolchain on PATH and install its llvm-tools component.`,
          );
      }
  }
  for (const [project, browsers] of [
    ...(process.platform === "darwin" || values.extended
      ? [["client", ["chromium", "webkit"]]]
      : []),
    ["requirements", ["chromium"]],
  ]) {
    try {
      const require = createRequire(join(root, project, "package.json"));
      const playwright = require("playwright");
      for (const browser of browsers) {
        const executable = playwright[browser].executablePath();
        if (!existsSync(executable))
          missing.push(`${project} Playwright ${browser}: ${executable}`);
      }
    } catch (error) {
      missing.push(`${project} Playwright installation: ${error.message}`);
    }
  }
  for (const item of missing) console.error(`Missing prerequisite: ${item}`);
  if (!missing.length)
    console.log(
      "Host test prerequisites found. Runtime permissions and device access still require execution.",
    );
  return missing.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = main();
