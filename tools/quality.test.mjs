import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";
import { nativeSources } from "./quality.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: root });

function command(script, args, env = process.env) {
  return spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

test("JavaScript bug checks distinguish browser and Node globals", async () => {
  const [browser] = await eslint.lintText(
    "process.exit(0);\nwindow.alert('hi');\n",
    {
      filePath: "requirements/src/quality-fixture.js",
    },
  );
  assert.deepEqual(
    browser.messages.map((message) => [message.ruleId, message.message]),
    [["no-undef", "'process' is not defined."]],
  );
  const [node] = await eslint.lintText(
    "document.title = 'hi';\nprocess.exitCode = 0;\n",
    {
      filePath: "tools/quality-fixture.mjs",
    },
  );
  assert.deepEqual(
    node.messages.map((message) => message.ruleId),
    ["no-undef"],
  );
  const [bug] = await eslint.lintText("new Promise(async () => {});\n", {
    filePath: "tools/quality-fixture.mjs",
  });
  assert.ok(
    bug.messages.some(
      (message) => message.ruleId === "no-async-promise-executor",
    ),
  );
});

test("typed TypeScript and Vue reject lost promises without changing source", async () => {
  const directory = await mkdtemp(
    join(root, "client/app/src/quality-fixture-"),
  );
  const source =
    "async function save(): Promise<void> {}\nsave();\nconst callback: () => void = async () => {};\nvoid callback;\n";
  try {
    for (const [name, content] of [
      ["fixture.ts", source],
      [
        "Fixture.vue",
        `<script setup lang="ts">\n${source}</script>\n<template><div /></template>\n`,
      ],
    ]) {
      const path = join(directory, name);
      await writeFile(path, content);
      const [result] = await eslint.lintFiles(path);
      assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
      const rules = result.messages.map((message) => message.ruleId);
      assert.ok(
        rules.includes("@typescript-eslint/no-floating-promises"),
        JSON.stringify(result.messages),
      );
      assert.ok(
        rules.includes("@typescript-eslint/no-misused-promises"),
        JSON.stringify(result.messages),
      );
      assert.equal(await readFile(path, "utf8"), content);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared UI rejects app package and relative imports", async () => {
  for (const specifier of [
    "@situate/client",
    "../../../app/src/state",
    "@/state",
  ]) {
    const [result] = await eslint.lintText(`import "${specifier}";\n`, {
      filePath: "client/packages/ui/quality-fixture.js",
    });
    assert.ok(
      result.messages.some(
        (message) => message.ruleId === "no-restricted-imports",
      ),
    );
  }
});

test("shared UI rejects dynamic app imports and require calls", async () => {
  for (const extension of ["js", "mjs", "cjs"]) {
    for (const source of [
      'import("@situate/client");',
      'require("../../../app/src/state");',
    ]) {
      const [result] = await eslint.lintText(source, {
        filePath: `client/packages/ui/quality-fixture.${extension}`,
      });
      assert.ok(
        result.messages.some(
          (message) => message.ruleId === "no-restricted-syntax",
        ),
        JSON.stringify(result.messages),
      );
    }
  }
  const [module] = await eslint.lintText('import "@situate/client";', {
    filePath: "client/packages/ui/quality-fixture.mjs",
  });
  assert.ok(
    module.messages.some(
      (message) => message.ruleId === "no-restricted-imports",
    ),
  );
});

test("generated output is ignored but application sources are checked", async () => {
  for (const path of [
    "client/app/src-tauri/gen/apple/file.js",
    "client/target/file.js",
    "client/node_modules/file.js",
  ]) {
    assert.equal(await eslint.isPathIgnored(path), true, path);
  }
  for (const path of [
    "client/app/src/main.ts",
    "client/packages/ui/src/index.ts",
    ".pi/extensions/test-suite/index.ts",
    "requirements/src/main.js",
    "design/brand/bend/bend.js",
  ]) {
    assert.equal(await eslint.isPathIgnored(path), false, path);
  }
});

test("format check fails on malformed formatting without writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-format-"));
  const path = join(directory, "fixture.js");
  const source = "const value={a:1}\n";
  try {
    await writeFile(path, source);
    const result = command("node_modules/prettier/bin/prettier.cjs", [
      "--check",
      "--config",
      resolve(root, ".prettierrc.json"),
      path,
    ]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Code style issues/);
    assert.equal(await readFile(path, "utf8"), source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native inventory includes new files but excludes deleted tracked files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-native-inventory-"));
  try {
    assert.equal(
      spawnSync("git", ["init", "--quiet"], { cwd: directory }).status,
      0,
    );
    await writeFile(join(directory, "removed.swift"), "import Foundation\n");
    assert.equal(
      spawnSync("git", ["add", "removed.swift"], { cwd: directory }).status,
      0,
    );
    await rm(join(directory, "removed.swift"));
    await writeFile(join(directory, "new.swift"), "import Foundation\n");
    assert.deepEqual(nativeSources(".swift", directory), ["new.swift"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Rust dependency policy checks product targets independently of the CI host", async () => {
  const config = await readFile(join(root, "client/deny.toml"), "utf8");
  const graph = config.match(/\[graph\]([\s\S]*?)(?=\n\[)/)?.[1];
  assert.ok(graph, "dependency policy must declare its target graph");
  const targets = [...graph.matchAll(/"([a-z0-9_-]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(targets, [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "aarch64-apple-ios",
    "aarch64-apple-ios-sim",
    "x86_64-apple-ios",
  ]);
  for (const advisory of [
    "RUSTSEC-2026-0385",
    "RUSTSEC-2026-0370",
    "RUSTSEC-2026-0371",
    "RUSTSEC-2026-0372",
  ])
    assert.ok(
      !config.includes(advisory),
      "Linux-only findings must not be suppressed for other targets",
    );
});

test("all native and audit checks explicitly fail when tools are absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-tools-"));
  try {
    for (const name of [
      "swift",
      "kotlin",
      "rust",
      "rust-audit",
      "secrets",
      "audit",
    ]) {
      const result = command("tools/quality.mjs", [name], {
        ...process.env,
        PATH: directory,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Missing required tool/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Rust policy and vulnerability checks run separately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-cargo-deny-"));
  const versions = JSON.parse(
    await readFile(join(root, "tools/toolchain.quality.json"), "utf8"),
  );
  try {
    await writeFile(
      join(directory, "cargo-deny"),
      `#!${process.execPath}\nconsole.log(process.argv.includes('--version') ? 'cargo-deny ${versions["cargo-deny"].version}' : JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o755 },
    );
    for (const [name, args] of [
      [
        "rust",
        ["--offline", "--locked", "check", "licenses", "bans", "sources"],
      ],
      ["rust-audit", ["--locked", "check", "advisories"]],
    ]) {
      const result = command("tools/quality.mjs", [name], {
        ...process.env,
        PATH: directory,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), args);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unversioned Swift tools fail rather than accepting a development build", async () => {
  const directory = await mkdtemp(join(tmpdir(), "situate-tools-"));
  try {
    await writeFile(
      join(directory, "swift-format"),
      `#!${process.execPath}\nconsole.log('main');\n`,
      { mode: 0o755 },
    );
    const result = command("tools/quality.mjs", ["swift"], {
      ...process.env,
      PATH: directory,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Required swift-format .*unrecognized version/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
