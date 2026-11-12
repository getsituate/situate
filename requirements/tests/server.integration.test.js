import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vite from "vite";
import { startBrowserServer } from "../../tools/browser-server.mjs";

test(
  "requirements Vite serves HTTP and HMR on its retained listener",
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "situate-viewer-transport-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(
      join(directory, "index.html"),
      "<title>Requirements fixture</title>",
    );
    const server = await startBrowserServer(vite, {
      root: directory,
      configFile: false,
    });
    t.after(() => server.close());
    assert.match(
      await (await fetch(server.url)).text(),
      /Requirements fixture/,
    );
    const client = await (await fetch(`${server.url}/@vite/client`)).text();
    const token = client.match(/const wsToken = "([^"]+)"/)?.[1];
    assert.ok(token);
    const socket = new WebSocket(
      `${server.url.replace("http:", "ws:")}/?token=${token}`,
      "vite-hmr",
    );
    try {
      const message = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("HMR connection timed out")),
          5000,
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("HMR connection failed"));
          },
          { once: true },
        );
        socket.addEventListener(
          "message",
          (event) => {
            clearTimeout(timer);
            resolve(JSON.parse(event.data));
          },
          { once: true },
        );
      });
      assert.equal(message.type, "connected");
    } finally {
      socket.close();
    }
    await server.close();
    await assert.rejects(fetch(server.url));
  },
);
