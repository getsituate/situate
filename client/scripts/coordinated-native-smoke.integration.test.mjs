import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { runCoordinated } from "../../tools/run-coordinated.mjs";
import { runCoordinatedSmokePhase } from "./coordinated-native-smoke.mjs";

async function waitFile(path) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(20);
  }
  assert.fail("Fixture process did not become ready.");
}

for (const cancel of [false, true]) {
  test(
    `native workers across worktrees ${cancel ? "cancel a queued fixture phase without launching it" : "serialize fixture phases after independent preparation"}`,
    { timeout: 30000 },
    async (t) => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "native queued worktrees ")),
      );
      t.after(() => rm(root, { recursive: true, force: true }));
      for (const name of ["first tree", "second tree"])
        await mkdir(join(root, name));
      for (const name of ["native-smoke-phase.mjs", "native-smoke-runtime.mjs"])
        await copyFile(new URL(name, import.meta.url), join(root, name));
      await writeFile(
        join(root, "native-desktop-session.mjs"),
        "export function requireNativeDesktop() {}\n",
      );
      const gate = join(root, "active");
      const ready = join(root, "ready");
      const release = join(root, "release");
      const started = join(root, "second-started");
      const report = "console.log('SITUATE_NATIVE_SMOKE {\"passed\":true}');";
      const firstSource = `require('node:assert/strict').equal(process.cwd(), ${JSON.stringify(join(root, "first tree"))}); const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(gate)}, 'first', {flag:'wx'}); fs.writeFileSync(${JSON.stringify(ready)}, 'ready'); const timer = setInterval(() => { if(fs.existsSync(${JSON.stringify(release)})) { clearInterval(timer); fs.unlinkSync(${JSON.stringify(gate)}); ${report} } }, 20);`;
      const secondSource = `require('node:assert/strict').equal(process.cwd(), ${JSON.stringify(join(root, "second tree"))}); const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(gate)}, 'second', {flag:'wx'}); fs.writeFileSync(${JSON.stringify(started)}, 'started'); fs.unlinkSync(${JSON.stringify(gate)}); ${report}`;
      let queued;
      const waiting = new Promise((resolve) => {
        queued = resolve;
      });
      const output = new Writable({
        write(chunk, _encoding, done) {
          if (String(chunk).includes("Waiting for the current worktree"))
            queued();
          done();
        },
      });
      const controllers = [new AbortController(), new AbortController()];
      const runs = [];
      t.after(async () => {
        controllers.forEach((controller) => controller.abort());
        await Promise.allSettled(runs);
        output.end();
      });
      const run = (name, source, controller) =>
        runCoordinatedSmokePhase(
          process.execPath,
          {
            cwd: join(root, name),
            args: ["-e", source],
            signal: controller.signal,
            timeout: 15000,
          },
          (options) =>
            // Node fixtures share a private queue, not the machine's desktop.
            runCoordinated({
              ...options,
              resource: "worktree",
              directory: root,
              args: [
                join(root, "native-smoke-phase.mjs"),
                JSON.stringify({
                  ...JSON.parse(options.args[1]),
                  cwd: options.directory,
                }),
              ],
              output,
            }),
        );
      const first = run("first tree", firstSource, controllers[0]);
      runs.push(first);
      await waitFile(ready);
      const second = run("second tree", secondSource, controllers[1]);
      runs.push(second);
      const secondOutcome = second.then(
        () => null,
        (error) => error,
      );
      await Promise.race([
        waiting,
        delay(10000, undefined, { ref: false }).then(() =>
          assert.fail("Second phase did not queue."),
        ),
      ]);
      await assert.rejects(readFile(started), { code: "ENOENT" });
      if (cancel) {
        controllers[1].abort();
        assert.match(
          (await secondOutcome).message,
          /Native smoke phase failed/,
        );
      }
      await writeFile(release, "release");
      await first;
      if (cancel) await assert.rejects(readFile(started), { code: "ENOENT" });
      else {
        assert.equal(await secondOutcome, null);
        assert.equal(await readFile(started, "utf8"), "started");
      }
    },
  );
}
