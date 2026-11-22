import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(
  new URL("./check-line-endings.mjs", import.meta.url),
);

test("the policy checks the index, not checkout line endings or binary bytes", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "situate-line-endings-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd });
  const write = (path, contents) => writeFileSync(join(cwd, path), contents);
  const check = () =>
    spawnSync(process.execPath, [checker], { cwd, encoding: "utf8" });
  git("init", "-q");
  write("notes.txt", "one\ntwo\n");
  write("binary.dat", "\0one\r\n");
  git("add", ".");
  write("notes.txt", "one\r\ntwo\r\n");
  assert.equal(check().status, 0);

  write("mixed text.txt", "one\ntwo\r\n");
  git("add", ".");
  const result = check();
  assert.equal(result.status, 1);
  assert.deepEqual(
    result.stderr
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line)),
    ["mixed text.txt", "notes.txt"],
  );
});

test("repository attributes keep Windows checkouts at LF", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "situate-checkout-lf-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.autocrlf=true", ...args], { cwd });
  git("init", "-q");
  copyFileSync(
    new URL("../.gitattributes", import.meta.url),
    join(cwd, ".gitattributes"),
  );
  const asset = join(cwd, "page.css");
  writeFileSync(asset, "body {}\r\n");
  git("add", ".");
  rmSync(asset);
  git("checkout-index", "page.css");
  assert.equal(readFileSync(asset, "utf8"), "body {}\n");
});
