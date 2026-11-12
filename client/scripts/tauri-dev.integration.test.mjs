import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as vite from "vite";
import { startBrowserServer } from "../../tools/browser-server.mjs";
import { runTauriDev } from "./tauri-dev.mjs";
import { desktopDevDataRoot } from "./desktop-dev-data.mjs";

test(
  "desktop launches retain separate worktree servers and stop only their own listener",
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "situate desktop worktrees-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const children = [];
    const runs = [];
    const urls = [];
    const dataRoots = [];
    t.after(async () => {
      children.forEach((child) => child.emit("exit", 0, null));
      await Promise.allSettled(runs);
    });
    for (const name of ["first", "second"]) {
      const root = join(directory, name, "app");
      await mkdir(root, { recursive: true });
      const appDataRoot = await desktopDevDataRoot(root);
      await writeFile(
        join(root, "index.html"),
        `<title>${name} worktree</title>`,
      );
      let ready;
      const launched = new Promise((resolve) => {
        ready = resolve;
      });
      const run = runTauriDev({
        root,
        appDataRoot,
        start: () => startBrowserServer(vite, { root, configFile: false }),
        launch: (command) => {
          assert.equal(command.cwd, root);
          const config = JSON.parse(command.args[2]);
          assert.equal(config.build.beforeDevCommand, "");
          urls.push(config.build.devUrl);
          assert.equal(config.app.appDirectoriesOverride, appDataRoot);
          dataRoots.push(config.app.appDirectoriesOverride);
          const child = new EventEmitter();
          children.push(child);
          ready();
          return child;
        },
      });
      runs.push(run);
      await Promise.race([
        launched,
        run.then(() => assert.fail("exited before launch")),
      ]);
    }
    assert.notEqual(urls[0], urls[1]);
    assert.notEqual(dataRoots[0], dataRoots[1]);
    for (const [index, name] of ["first", "second"].entries()) {
      assert.match(
        await (await fetch(urls[index])).text(),
        new RegExp(`<title>${name} worktree</title>`),
      );
    }
    children[0].emit("exit", 17, null);
    assert.equal(await runs[0], 17);
    await assert.rejects(fetch(urls[0]));
    assert.match(await (await fetch(urls[1])).text(), /second worktree/);
    children[1].emit("exit", 0, null);
    assert.equal(await runs[1], 0);
    await assert.rejects(fetch(urls[1]));
  },
);
