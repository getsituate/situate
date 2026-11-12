import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { sessionPaths, startFrontend, run } from "./ios-xcode.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-ios-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return sessionPaths(root);
}

test("frontend servers hold distinct loopback ports with matching HMR transport", async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const paths = sessionPaths(root);
  const output = mkdtempSync(join(tmpdir(), "situate-ios-vite-"));
  const app = join(output, "app");
  mkdirSync(app);
  writeFileSync(
    join(app, "index.html"),
    "<!doctype html><html><body></body></html>",
  );
  writeFileSync(
    join(app, "vite.config.mjs"),
    "export default { optimizeDeps: { noDiscovery: true, include: [] } };",
  );
  const servers = [];
  t.after(async () => {
    for (const web of servers) await web.server.close();
    // Yield between Windows removal attempts so pending close callbacks can finish.
    await rm(output, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    assert.equal(existsSync(output), false);
  });
  for (let index = 0; index < 2; index++) {
    const web = await startFrontend({
      ...paths,
      app,
      output: join(output, String(index)),
    });
    servers.push(web);
    assert.equal(web.server.config.server.host, "127.0.0.1");
    assert.equal(
      web.server.config.server.ws.port,
      Number(new URL(web.url).port),
    );
    assert.equal(
      web.server.config.server.ws.clientPort,
      Number(new URL(web.url).port),
    );
    assert.equal(
      web.server.config.cacheDir,
      join(output, String(index), "vite").split(sep).join("/"),
    );
    const response = await fetch(`${web.url}/@vite/client`);
    assert.equal(response.status, 200);
    const client = await response.text();
    const token = client.match(/const wsToken = "([^"]+)"/)?.[1];
    assert.ok(token);
    const socket = new WebSocket(
      `${web.url.replace("http:", "ws:")}/?token=${token}`,
      "vite-hmr",
    );
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("HMR connection timed out")),
          5000,
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timeout);
            reject(new Error("HMR connection failed"));
          },
          { once: true },
        );
        socket.addEventListener(
          "message",
          (event) => {
            clearTimeout(timeout);
            if (JSON.parse(event.data).type === "connected") resolve();
            else reject(new Error(`Unexpected HMR message: ${event.data}`));
          },
          { once: true },
        );
      });
    } finally {
      socket.close();
    }
  }
  assert.notEqual(servers[0].url, servers[1].url);
});

test(
  "Vite middleware does not exit before session signal cleanup",
  { skip: process.platform === "win32", timeout: 10000 },
  async (t) => {
    const paths = fixture(t);
    const module = new URL("./ios-xcode.mjs", import.meta.url).href;
    const realRoot = fileURLToPath(new URL("../", import.meta.url));
    const ready = join(paths.root, "ready");
    const cleaned = join(paths.root, "cleaned");
    const code = `import {sessionPaths, acquireSession, startFrontend} from ${JSON.stringify(module)};
    import {writeFileSync} from 'node:fs';
    const unlock=acquireSession(sessionPaths(${JSON.stringify(paths.root)}));
    const web=await startFrontend({...sessionPaths(${JSON.stringify(realRoot)}),output:${JSON.stringify(paths.output)}});
    process.on('SIGINT',async()=>{await web.server.close();unlock();writeFileSync(${JSON.stringify(cleaned)},'done');});
    writeFileSync(${JSON.stringify(ready)},'ready');`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      stdio: "ignore",
    });
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
    });
    for (let count = 0; count < 150 && !existsSync(ready); count++)
      await delay(20);
    assert.ok(existsSync(ready));
    child.kill("SIGINT");
    const result = await exited;
    assert.equal(result[0], 0);
    assert.ok(existsSync(cleaned));
    assert.ok(!existsSync(join(paths.output, "session.lock")));
  },
);

function isRunning(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1, `Invalid PID: ${pid}`);
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim())
    return false;
  assert.equal(result.status, 0, result.stderr);
  const state = result.stdout.trim();
  assert.ok(state, "ps returned no process state");
  // A zombie has exited but has not yet been reaped by its parent.
  return !state.startsWith("Z");
}

function killFixture(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function waitForExit(pid) {
  for (let count = 0; count < 100 && isRunning(pid); count++) await delay(20);
  assert.equal(isRunning(pid), false);
}

test(
  "process-state checks reject active survivors but accept an unreaped zombie",
  { skip: process.platform === "win32" },
  async (t) => {
    assert.throws(() => isRunning(0), /Invalid PID/);
    const code = `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      process.stdout.write(String(child.pid)+'\\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);`;
    const parent = spawn(process.execPath, ["-e", code], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const exited = once(parent, "exit");
    let pid;
    t.after(async () => {
      killFixture(-parent.pid);
      await exited;
      if (pid) await waitForExit(pid);
    });
    const [data] = await once(parent.stdout, "data");
    pid = Number(data.toString().trim());
    assert.equal(isRunning(pid), true);
    process.kill(pid, "SIGSTOP");
    assert.equal(isRunning(pid), true);
    process.kill(pid, "SIGKILL");
    await waitForExit(pid);
    const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout.trim(), /^Z/);
  },
);

for (const stdio of ["ignore", "inherit"]) {
  test(
    `abort terminates the command process group, including a child ignoring SIGTERM (${stdio} stdio)`,
    { skip: process.platform === "win32" },
    async (t) => {
      const paths = fixture(t);
      const pidFile = join(paths.root, "pid");
      const controller = new AbortController();
      // Publish readiness atomically, only after installing the signal handler.
      const childCode = `const fs=require('node:fs');
        process.on('SIGTERM',()=>{});
        fs.writeFileSync(${JSON.stringify(`${pidFile}.tmp`)},String(process.pid));
        fs.renameSync(${JSON.stringify(`${pidFile}.tmp`)},${JSON.stringify(pidFile)});
        setInterval(()=>{},1000);`;
      const code = `const {spawn}=require('node:child_process');
        spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:${JSON.stringify(stdio)}});
        setInterval(()=>{},1000);`;
      const running = run(process.execPath, ["-e", code], {
        signal: controller.signal,
        capture: true,
      });
      const rejected = assert.rejects(running, /cancelled/);
      let pid;
      t.after(async () => {
        controller.abort(new Error("cancelled"));
        try {
          await rejected;
        } finally {
          if (pid && isRunning(pid)) {
            killFixture(pid);
            await waitForExit(pid);
          }
        }
      });
      for (let count = 0; count < 100 && !existsSync(pidFile); count++)
        await delay(20);
      assert.ok(existsSync(pidFile));
      pid = Number(readFileSync(pidFile, "utf8"));
      assert.equal(isRunning(pid), true);
      controller.abort(new Error("cancelled"));
      await rejected;
      await waitForExit(pid);
    },
  );
}
