import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { collectRustRuntimeLicenses } from "./native-licenses-runtime.mjs";
import { run } from "./ios-xcode.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-runtime-notices-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  };
  write("client/rust-toolchain.toml", '[toolchain]\nchannel = "1.2.3"\n');
  write(
    "sysroot/share/doc/rust/COPYRIGHT-library.html",
    "<html><body>Rust Standard Library synthetic inventory</body></html>",
  );
  for (const component of [
    "std",
    "core",
    "alloc",
    "compiler_builtins",
    "rustc_demangle",
  ])
    write(
      `sysroot/lib/rustlib/aarch64-apple-ios/lib/lib${component}-example.rlib`,
      `Synthetic ${component}`,
    );
  for (const name of [
    "Apache-2.0",
    "MIT",
    "Unicode-3.0",
    "BSD-2-Clause",
    "LLVM-exception",
  ])
    write(
      `sysroot/share/doc/rust/licenses/${name}.txt`,
      `Synthetic ${name} license terms`,
    );
  mkdirSync(join(directory, "output"));
  const state = { version: "1.2.3" };
  const requests = [];
  const args = {
    root: join(directory, "client"),
    targets: ["aarch64-apple-ios"],
    output: join(directory, "output"),
    execute: async (command, args) => {
      if (command === "rustup") return join(directory, "sysroot/bin/rustc");
      if (command === "python3")
        return JSON.stringify(
          "Rust Standard Library\nCopyright 1991-2024 Unicode, Inc\nSynthetic embedded library notice",
        );
      if (args[0] === "-vV")
        return `release: ${state.version}\ncommit-hash: ${"a".repeat(40)}\n`;
      return join(directory, "sysroot");
    },
    request: async (url) => {
      requests.push(url);
      return {
        ok: true,
        text: async () =>
          "Synthetic compiler-builtins/libm copyright and terms",
      };
    },
  };
  return { directory, args, state, requests, write };
}

test("binds Rust runtime notices to compiler, target components and exact runtime sources", async (t) => {
  const { directory, args, requests } = fixture(t);
  await collectRustRuntimeLicenses(args);
  const text = readFileSync(
    join(directory, "output/rust-runtime-notices.txt"),
    "utf8",
  );
  for (const value of [
    "Rust standard library and runtime 1.2.3",
    "1991-2024 Unicode",
    "Unicode-3.0 license terms",
    "BSD-2-Clause license terms",
    "LLVM-exception license terms",
    "rustc_demangle",
    "compiler_builtins",
    "Synthetic compiler-builtins/libm copyright",
    "SHA-256:",
  ])
    assert.ok(text.includes(value), value);
  assert.ok(!text.includes(directory));
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.includes("a".repeat(40))));
});

test("converts the library inventory to plain text without losing copyright or license wording", async (t) => {
  const { directory, args, write } = fixture(t);
  write(
    "sysroot/share/doc/rust/COPYRIGHT-library.html",
    "<html><body><h1>Rust Standard Library</h1><p>Copyright &copy; 1991-2024 Unicode, Inc</p><pre>Permission line one\n  Permission line two</pre></body></html>",
  );
  const execute = args.execute;
  await collectRustRuntimeLicenses({
    ...args,
    execute: (command, arguments_, options) =>
      command === "python3"
        ? run(command, arguments_, {
            ...options,
            env: { PATH: process.env.PATH },
          })
        : execute(command, arguments_, options),
  });
  const text = readFileSync(
    join(directory, "output/rust-runtime-notices.txt"),
    "utf8",
  );
  assert.ok(text.includes("Copyright © 1991-2024 Unicode, Inc"));
  assert.ok(text.includes("Permission line one\n  Permission line two"));
  assert.ok(!text.includes("<pre>"));
});

test("missing target components, mismatched toolchains and missing notices block delivery", async (t) => {
  const { directory, args, state, write } = fixture(t);
  state.version = "1.2.4";
  await assert.rejects(collectRustRuntimeLicenses(args), /pinned compiler/);
  state.version = "1.2.3";
  rmSync(join(directory, "sysroot/share/doc/rust/COPYRIGHT-library.html"));
  await assert.rejects(collectRustRuntimeLicenses(args), /Install rust-docs/);
  write(
    "sysroot/share/doc/rust/COPYRIGHT-library.html",
    "Rust Standard Library synthetic inventory",
  );
  await assert.rejects(
    collectRustRuntimeLicenses({
      ...args,
      request: async () => ({ ok: false }),
    }),
    /Missing exact Rust runtime notice/,
  );
  rmSync(
    join(
      directory,
      "sysroot/lib/rustlib/aarch64-apple-ios/lib/libcore-example.rlib",
    ),
  );
  await assert.rejects(
    collectRustRuntimeLicenses(args),
    /Missing selected target Rust runtime/,
  );
});
