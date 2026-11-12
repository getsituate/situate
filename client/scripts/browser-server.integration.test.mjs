import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import * as vite from "vite";
import { stripVTControlCharacters } from "node:util";
import { startBrowserServer } from "../../tools/browser-server.mjs";
import { executeSuite } from "../../tools/test.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

async function listener(t, host, port = 0) {
  const server = createHttpServer((_, response) =>
    response.end("unrelated server"),
  );
  server.listen({ host, port, ipv6Only: host === "::1" });
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  );
  return server.address().port;
}

test(
  "concurrent Vite servers retain distinct IPv4 endpoints and HMR despite occupied configured ports",
  { timeout: 30000 },
  async (t) => {
    const occupied = await listener(t, "127.0.0.1");
    await listener(t, "::1", occupied);
    const temporary = await mkdtemp(join(tmpdir(), "situate-browser-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const directory = await realpath(temporary);
    // Vite's /@fs middleware resolves from the working drive, which can differ from TEMP.
    const outside = await mkdtemp(
      fileURLToPath(
        new URL("../node_modules/.situate-browser-outside-", import.meta.url),
      ),
    );
    t.after(() => rm(outside, { recursive: true, force: true }));
    const outsideFile = join(await realpath(outside), "outside.txt");
    await writeFile(outsideFile, "outside fixture");
    await writeFile(join(directory, ".env"), "FIXTURE_SECRET=private");
    await writeFile(
      join(directory, "index.html"),
      "<title>Isolated fixture</title>",
    );
    const configFile = join(directory, "vite.config.mjs");
    await writeFile(
      configFile,
      `export default { server: { host: 'localhost', port: ${occupied}, strictPort: true, hmr: { host: '::1', port: ${occupied} } } };`,
    );
    const servers = [];
    t.after(async () => {
      await Promise.all(servers.map((server) => server.close()));
    });
    await Promise.all(
      [0, 1].map(async (index) => {
        const server = await startBrowserServer(vite, {
          root: directory,
          configFile,
          cacheDir: join(directory, `cache-${index}`),
        });
        servers.push(server);
        const url = new URL(server.url);
        assert.equal(url.hostname, "127.0.0.1");
        assert.notEqual(Number(url.port), occupied);
        const response = await fetch(server.url);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Isolated fixture/);
        assert.equal(
          server.config.root,
          vite.normalizePath(await realpath(temporary)),
        );
        assert.equal(server.config.server.fs.strict, true);
        for (const path of [
          `/@fs/${vite.normalizePath(outsideFile)}`,
          "/.env",
        ]) {
          const denied = await fetch(`${server.url}${path}`);
          assert.equal(denied.status, 403, path);
          assert.doesNotMatch(
            await denied.text(),
            /outside fixture|FIXTURE_SECRET/,
          );
        }
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
          assert.equal(server.config.server.ws.clientPort, Number(url.port));
        } finally {
          socket.close();
        }
      }),
    );
    assert.notEqual(servers[0].url, servers[1].url);
    for (const server of servers) {
      await server.close();
      await assert.rejects(fetch(server.url));
    }
    assert.equal(
      await (await fetch(`http://127.0.0.1:${occupied}`)).text(),
      "unrelated server",
    );
    assert.equal(
      await (await fetch(`http://[::1]:${occupied}`)).text(),
      "unrelated server",
    );
  },
);

test(
  "startup compiles the requested entry graphs without executing them",
  { timeout: 10000 },
  async (t) => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "situate-browser-startup-")),
    );
    let server;
    t.after(async () => {
      try {
        await server?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
    await writeFile(
      join(directory, "entry.js"),
      'import "./child.js"; throw new Error("must not execute");',
    );
    const dependency = join(directory, "node_modules", "fixture-dependency");
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({
        name: "fixture-dependency",
        type: "module",
        exports: "./index.js",
      }),
    );
    await writeFile(join(dependency, "index.js"), "export const value = true;");
    await writeFile(
      join(directory, "child.js"),
      'import { value } from "fixture-dependency"; export const child = value;',
    );
    await writeFile(join(directory, "lazy.js"), "export const lazy = true;");
    const transformed = new Set();
    server = await startBrowserServer(
      vite,
      {
        root: directory,
        configFile: false,
        optimizeDeps: { include: ["fixture-dependency"] },
        plugins: [
          {
            name: "record-startup-transforms",
            transform(_code, id) {
              transformed.add(id);
            },
          },
        ],
      },
      ["/entry.js", "/lazy.js"],
    );
    for (const file of ["entry.js", "child.js", "lazy.js"])
      assert.ok(
        transformed.has(vite.normalizePath(join(directory, file))),
        file,
      );
    assert.ok(
      [...transformed].some((id) =>
        id.endsWith("/vite/dist/client/client.mjs"),
      ),
    );
    const metadata = JSON.parse(
      await readFile(
        join(server.config.cacheDir, "deps", "_metadata.json"),
        "utf8",
      ),
    );
    assert.ok(metadata.optimized["fixture-dependency"]);
    await readFile(
      join(server.config.cacheDir, "deps", "fixture-dependency.js"),
    );
  },
);

test("failed startup compilation closes Vite and the retained listener", async () => {
  let port;
  let closed = false;
  await assert.rejects(
    startBrowserServer(
      {
        version: vite.version,
        createServer: async (config) => {
          port = config.server.port;
          return {
            close: async () => {
              closed = true;
            },
            environments: {
              client: {
                transformRequest: async () => {
                  throw new Error("invalid startup module");
                },
              },
            },
          };
        },
      },
      {},
      ["/entry.js"],
    ).then((server) => server.close()),
    /invalid startup module/,
  );
  assert.equal(closed, true);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
});

test(
  "web development commands run concurrently on separate ports",
  { timeout: 30000 },
  async (t) => {
    const runs = [];
    const controllers = [];
    const urls = [];
    t.after(async () => {
      controllers.forEach((controller) => controller.abort());
      await Promise.allSettled(runs);
    });
    for (let index = 0; index < 2; index++) {
      const controller = new AbortController();
      controllers.push(controller);
      let ready;
      const started = new Promise((resolve) => {
        ready = resolve;
      });
      let output = "";
      const run = executeSuite(
        { cwd: "client", command: "npm", args: ["run", "dev"] },
        {
          directory: root,
          signal: controller.signal,
          timeout: 20,
          environment: { ...process.env, TAURI_DEV_HOST: "127.0.0.1" },
          output: new Writable({
            write(chunk, _, done) {
              output += stripVTControlCharacters(chunk.toString());
              const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
              if (url) ready(url);
              done();
            },
          }),
        },
      );
      runs.push(run);
      urls.push(
        await Promise.race([
          started,
          run.then((result) => assert.fail(`${result.status}: ${output}`)),
        ]),
      );
    }
    assert.notEqual(urls[0], urls[1]);
    for (const url of urls) assert.equal((await fetch(url)).status, 200);
    controllers[0].abort();
    assert.equal((await runs[0]).status, "cancelled");
    await assert.rejects(fetch(urls[0]));
    assert.equal((await fetch(urls[1])).status, 200);
    controllers[1].abort();
    assert.equal((await runs[1]).status, "cancelled");
    await assert.rejects(fetch(urls[1]));
  },
);

test("Vite 7 callers without startup URLs retain their HMR transport", async (t) => {
  const server = await startBrowserServer(
    {
      version: "7.3.1",
      createServer: async (config) => ({ config, close: async () => {} }),
    },
    {},
  );
  t.after(() => server.close());
  assert.equal(
    server.config.server.hmr.clientPort,
    Number(new URL(server.url).port),
  );
  assert.equal(server.config.server.ws, undefined);
});

test("failed Vite startup releases the retained listener", async () => {
  let port;
  await assert.rejects(
    startBrowserServer(
      {
        version: vite.version,
        createServer: async (config) => {
          port = config.server.port;
          throw new Error("invalid configuration");
        },
      },
      {},
    ),
    /invalid configuration/,
  );
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
});

for (const phase of ["creation", "compilation"])
  test(
    `cancellation during ${phase} releases the listener without publishing readiness`,
    { skip: process.platform === "win32", timeout: 10000 },
    async (t) => {
      const module = new URL("../../tools/browser-server.mjs", import.meta.url)
        .href;
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
    import { serveBrowserTests, startBrowserServer } from ${JSON.stringify(module)};
    process.once('SIGTERM', () => process.send('stopped'));
    await serveBrowserTests(() => startBrowserServer({ version: '8.0.0', createServer: async config => {
      const pause = async () => {
        process.send(config.server.port);
        await new Promise(resolve => process.once('message', resolve));
      };
      if (${JSON.stringify(phase)} === 'creation') await pause();
      return {
        close: async () => process.send('closed'),
        environments: { client: {
          transformRequest: async url => {
            if (${JSON.stringify(phase)} === 'compilation' && url === '/entry.js') await pause();
          },
          waitForRequestsIdle: async () => {},
        } },
      };
    } }, {}, ['/entry.js']));
    process.disconnect();
  `,
        ],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const exited = once(child, "exit");
      const [port] = await once(child, "message");
      const stopping = once(child, "message");
      child.kill("SIGTERM");
      assert.equal((await stopping)[0], "stopped");
      const closed = once(child, "message");
      child.send("continue");
      assert.equal((await closed)[0], "closed");
      assert.equal((await exited)[0], 0, output);
      assert.doesNotMatch(output, /SITUATE_BROWSER_URL=/);
      await assert.rejects(fetch(`http://127.0.0.1:${port}`));
    },
  );

for (const [cwd, script] of [
  ["client/app", "../scripts/browser-server.mjs"],
  ["client/workshop", "../scripts/browser-server.mjs"],
]) {
  test(
    `runner cancellation closes ${cwd} HTTP and WebSocket listeners without stopping unrelated servers`,
    { timeout: 30000 },
    async (t) => {
      const occupied = await listener(t, "127.0.0.1");
      const controller = new AbortController();
      t.after(() => controller.abort());
      let output = "",
        url;
      const result = await executeSuite(
        { cwd, command: process.execPath, args: [script] },
        {
          directory: root,
          signal: controller.signal,
          timeout: 20,
          environment: { ...process.env, TAURI_DEV_HOST: "::1" },
          output: new Writable({
            write(chunk, _, done) {
              output += chunk;
              url = output.match(
                /SITUATE_BROWSER_URL=(http:\/\/127\.0\.0\.1:\d+)/,
              )?.[1];
              if (url) controller.abort();
              done();
            },
          }),
        },
      );
      assert.ok(url, output);
      assert.equal(result.status, "cancelled");
      assert.equal(result.error, undefined);
      await assert.rejects(fetch(url));
      assert.equal(
        await (await fetch(`http://127.0.0.1:${occupied}`)).text(),
        "unrelated server",
      );
    },
  );
}
