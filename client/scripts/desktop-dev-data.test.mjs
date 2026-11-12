import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { desktopDevDataRoot } from "./desktop-dev-data.mjs";
import { tauriDevCommand } from "./tauri-dev.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "desktop data worktrees "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("desktop data is persistent, independent per worktree and canonical across aliases", async (t) => {
  const root = await fixture(t);
  const paths = [];
  for (const name of ["first tree", "second tree"]) {
    const app = join(root, name, "client", "app");
    await mkdir(app, { recursive: true });
    const data = await desktopDevDataRoot(app);
    assert.equal(
      data,
      join(await realpath(root), name, "client", ".desktop-dev-data"),
    );
    await writeFile(join(data, "draft"), name);
    assert.equal(await desktopDevDataRoot(app), data);
    assert.equal(await readFile(join(data, "draft"), "utf8"), name);
    paths.push(data);
  }
  assert.notEqual(paths[0], paths[1]);
  const alias = join(root, "alias");
  await symlink(join(root, "first tree", "client", "app"), alias);
  assert.equal(await desktopDevDataRoot(alias), paths[0]);
});

for (const nested of [false, true]) {
  test(`desktop data rejects ${nested ? "nested" : "root"} symlinks without touching their target`, async (t) => {
    const root = await fixture(t);
    const app = join(root, "client", "app");
    const data = join(root, "client", ".desktop-dev-data");
    const unrelated = join(root, "unrelated");
    await mkdir(app, { recursive: true });
    await mkdir(unrelated);
    await writeFile(join(unrelated, "draft"), "unchanged");
    if (nested) await mkdir(data);
    await symlink(unrelated, nested ? join(data, "settings") : data);
    await assert.rejects(
      desktopDevDataRoot(app),
      /Unsafe desktop development data/,
    );
    assert.equal(await readFile(join(unrelated, "draft"), "utf8"), "unchanged");
  });
}

test("desktop config carries a path with spaces as data and rejects config overrides", () => {
  const appDataRoot = "/temporary/work tree/client/.desktop-dev-data";
  const command = tauriDevCommand(
    "/temporary/work tree/client/app",
    "http://127.0.0.1:49152",
    ["--no-watch"],
    {},
    { appDataRoot },
  );
  assert.deepEqual(JSON.parse(command.args[2]), {
    build: { beforeDevCommand: "", devUrl: "http://127.0.0.1:49152" },
    app: { appDirectoriesOverride: appDataRoot },
  });
  for (const args of [
    ["--config", "other.json"],
    ["--config={}"],
    ["-c", "other.json"],
    ["-cother.json"],
  ])
    assert.throws(
      () =>
        tauriDevCommand(
          "/temporary/app",
          "http://127.0.0.1:49152",
          args,
          {},
          { appDataRoot },
        ),
      /Custom Tauri configuration/,
    );
});
