import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { build, createServer } from "vite";
import { resolve } from "node:path";
import { readFile, rm, stat } from "node:fs/promises";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    root: process.cwd(),
    worker: { format: "es" },
    build: {
      target: "safari16",
      write: false,
      minify: false,
      lib: {
        entry: resolve("src/plugins/executor-entry.ts"),
        formats: ["iife"],
        name: "ExecutorTest",
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result) as {
    output: { type: string; code: string }[];
  };
  bundle = output.output.find((item) => item.type === "chunk")!.code;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

it("builds the native supervisor on dev startup and atomically refreshes shipped source changes", async () => {
  const path = resolve("dist/executor-supervisor.js");
  const previewPath = resolve("dist/plugin-check-renderer.js");
  await rm(path, { force: true });
  await rm(previewPath, { force: true });
  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    logLevel: "silent",
    server: { watch: { usePolling: false } },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const initial = await readFile(path, "utf8");
    expect(initial).toContain("__SITUATE_EXECUTOR__");
    const preview = await readFile(previewPath, "utf8");
    expect(preview).toContain("plugin_preview_ack");
    expect(preview).toContain("--situate-paper");
    expect(preview).not.toContain("process.env");
    const previewBefore = await stat(previewPath);
    const before = await stat(path);
    server.watcher.emit("change", resolve("src/plugins/executor-worker.ts"));
    await vi.waitFor(async () => {
      expect((await stat(path)).ino).not.toBe(before.ino);
    });
    expect(await readFile(path, "utf8")).toBe(initial);
    await vi.waitFor(async () => {
      expect((await stat(previewPath)).ino).not.toBe(previewBefore.ino);
    });
    const styledBefore = await stat(previewPath);
    server.watcher.emit("change", resolve("src/style.css"));
    await vi.waitFor(async () => {
      expect((await stat(previewPath)).ino).not.toBe(styledBefore.ino);
    });
  } finally {
    await server.close();
  }
}, 15_000);

async function setup(): Promise<Page> {
  const page = await browser.newPage();
  await page.route("http://executor.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'">`,
    }),
  );
  await page.goto("http://executor.test/");
  await page.evaluate(() => {
    const state = globalThis as unknown as {
      events: unknown[];
      __SITUATE_EXECUTOR__: { send(value: unknown): void };
    };
    state.events = [];
    state.__SITUATE_EXECUTOR__ = {
      send(value) {
        state.events.push(value);
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  return page;
}
async function dispatch(page: Page, command: unknown) {
  await page.evaluate(
    (command) =>
      (
        globalThis as unknown as {
          __SITUATE_EXECUTOR__: { receive(command: unknown): void };
        }
      ).__SITUATE_EXECUTOR__.receive(command),
    command,
  );
}
async function event(page: Page, type: string, invocationId?: string) {
  const handle = await page.waitForFunction(
    ({ type, invocationId }) =>
      (
        globalThis as unknown as {
          events: { type: string; invocationId?: string; error?: string }[];
        }
      ).events.find(
        (value) =>
          (value.type === type || value.type === "error") &&
          (invocationId === undefined || value.invocationId === invocationId),
      ),
    { type, invocationId },
  );
  const value = await handle.jsonValue();
  await handle.dispose();
  if (!value) throw new Error("Missing Worker event");
  if (value.type !== type) throw new Error(value.error);
  return value;
}
function load(serviceEntry: string) {
  return {
    type: "load",
    generation: 1,
    pluginId: "synthetic",
    source: {
      manifest: {
        schemaVersion: 2,
        id: "synthetic",
        name: "Synthetic",
        description: "Synthetic",
        skills: [],
        serviceEntry: "service.js",
      },
      serviceEntry,
      uiEntry: null,
      modules: {},
      skills: [],
    },
  };
}

it("transports a throwing service factory error before supervisor termination", async () => {
  const page = await setup();
  try {
    await dispatch(
      page,
      load('export default () => { throw new Error("plugins.checkFailed"); };'),
    );
    expect(await event(page, "error")).toEqual({
      type: "error",
      generation: 1,
      error: "plugins.checkFailed",
    });
    await page.evaluate(() => {
      (globalThis as unknown as { events: unknown[] }).events = [];
    });
    await dispatch(page, { type: "terminate", generation: 1 });
    expect(await event(page, "terminated")).toEqual({
      type: "terminated",
      generation: 1,
    });
  } finally {
    await page.close();
  }
});

it.each(["initialization", "tool", "check"])(
  "terminates a real Worker during a synchronous %s loop without blocking its supervisor",
  async (kind) => {
    const page = await setup();
    try {
      const service =
        kind === "initialization"
          ? 'postMessage({type:"progress",generation:1,invocationId:"entered",value:"entered"}); while(true) {}'
          : 'export default () => ({tools:[{name:"loop",description:"Loop",parameters:{type:"object"},execute(_args,context){context.progress("entered"); while(true) {}}}]});';
      // Initialization has no invocation, so use a Worker-side message observable to the supervisor.
      if (kind === "initialization") {
        await dispatch(
          page,
          load(
            'postMessage({type:"ready",generation:1,tools:[],exports:[]}); while(true) {}',
          ),
        );
        await event(page, "ready");
      } else {
        await dispatch(page, load(service));
        await event(page, "ready");
        await dispatch(page, {
          type: "invoke",
          generation: 1,
          invocationId: "loop",
          kind: kind === "tool" ? "tool" : "check",
          name: "loop",
          args: {},
          script: 'host.progress("entered"); while(true) {}',
        });
        await event(page, "progress", "loop");
      }
      await dispatch(page, { type: "terminate", generation: 1 });
      expect(await event(page, "terminated")).toEqual({
        type: "terminated",
        generation: 1,
      });
      await dispatch(page, {
        type: "invoke",
        generation: 1,
        invocationId: "late",
        kind: "tool",
        name: "loop",
        args: {},
      });
      expect(
        await page.evaluate(() =>
          (
            globalThis as unknown as { events: { invocationId?: string }[] }
          ).events.some((value) => value.invocationId === "late"),
        ),
      ).toBe(false);
    } finally {
      await page.close();
    }
  },
  15_000,
);

it("rejects malformed nested tool schemas before publishing service definitions", async () => {
  const page = await setup();
  try {
    await dispatch(
      page,
      load(
        'export default () => ({tools:[{name:"invalid",description:"Invalid",parameters:{type:"object",properties:{value:{type:"not-a-schema-type"}}},execute(){return null}}]});',
      ),
    );
    expect(await event(page, "error")).toMatchObject({
      error: "plugins.invalidContributions",
    });
  } finally {
    await page.close();
  }
});

it("checks immutable captured skill sources without a service entry", async () => {
  const page = await setup();
  try {
    const command = load("") as unknown as Record<string, unknown>;
    command.source = {
      manifest: {
        schemaVersion: 2,
        id: "synthetic",
        name: "Synthetic",
        description: "Synthetic",
        skills: ["skills/organize.md"],
      },
      serviceEntry: null,
      uiEntry: null,
      modules: {},
      skills: [
        {
          path: "skills/organize.md",
          text: "# Organize\nUse the captured instructions.",
        },
      ],
    };
    await dispatch(page, command);
    await event(page, "ready");
    await dispatch(page, {
      type: "invoke",
      generation: 1,
      invocationId: "skills",
      kind: "check",
      name: "",
      args: {},
      script:
        'assert.ok(Object.isFrozen(plugin.skills)); assert.ok(Object.isFrozen(plugin.skills[0])); assert.equal(plugin.skills[0].path, "skills/organize.md"); assert.equal(plugin.skill("skills/organize.md"), "# Organize\\nUse the captured instructions.");',
    });
    expect(await event(page, "result", "skills")).toMatchObject({
      result: { passed: true, assertions: 4 },
    });
  } finally {
    await page.close();
  }
});

it("reports successful assertions and preserves caught assertion failure in the Worker", async () => {
  const page = await setup();
  try {
    await dispatch(page, load("export default () => ({});"));
    await event(page, "ready");
    await dispatch(page, {
      type: "invoke",
      generation: 1,
      invocationId: "pass",
      kind: "check",
      name: "",
      args: {},
      script: `assert.equal(JSON.parse('{"config":"consumer config","provider":{"config":"connection config","version":"first"},"version":"first"}'), {version:"first",provider:{version:"first",config:"connection config"},config:"consumer config"});`,
    });
    expect(await event(page, "result", "pass")).toMatchObject({
      result: { passed: true, assertions: 1 },
    });
    await dispatch(page, {
      type: "invoke",
      generation: 1,
      invocationId: "fail",
      kind: "check",
      name: "",
      args: {},
      script: "try { assert.ok(false); } catch {} assert.ok(true);",
    });
    expect(await event(page, "result", "fail")).toMatchObject({
      result: {
        passed: false,
        assertions: 1,
        error: "plugins.checkAssertionFailed",
        failure: {
          assertion: 1,
          operator: "ok",
          actual: "false",
          expected: "true",
        },
      },
    });
    await dispatch(page, {
      type: "invoke",
      generation: 1,
      invocationId: "exception",
      kind: "check",
      name: "",
      args: {},
      script: 'assert.ok(true); throw new TypeError("private payload")',
    });
    expect(await event(page, "result", "exception")).toMatchObject({
      result: { passed: false, assertions: 1, error: "plugins.checkTypeError" },
    });
  } finally {
    await page.close();
  }
});

it("initializes once, preserves overlapping invocation identity and rejects redispatch", async () => {
  const page = await setup();
  try {
    const source = load(
      `let initialized=0; export default () => { initialized++; return {exports:{count:(_args,context)=>context.dependencies.invoke("dependency","read",initialized)}}; };`,
    );
    await dispatch(page, source);
    await event(page, "ready");
    await dispatch(page, source);
    for (const invocationId of ["one", "two"])
      await dispatch(page, {
        type: "invoke",
        generation: 1,
        invocationId,
        kind: "export",
        name: "count",
        args: {},
      });
    const first = (await event(page, "host", "one")) as unknown as {
      requestId: string;
      request: { args: unknown };
    };
    const second = (await event(page, "host", "two")) as unknown as {
      requestId: string;
      request: { args: unknown };
    };
    expect(first.request.args).toBe(1);
    expect(second.request.args).toBe(1);
    for (const [invocationId, request] of [
      ["two", second],
      ["one", first],
    ] as const)
      await dispatch(page, {
        type: "hostReply",
        generation: 1,
        invocationId,
        requestId: request.requestId,
        result: invocationId,
      });
    expect(await event(page, "result", "one")).toMatchObject({ result: "one" });
    expect(await event(page, "result", "two")).toMatchObject({ result: "two" });
    await dispatch(page, {
      type: "invoke",
      generation: 1,
      invocationId: "one",
      kind: "export",
      name: "count",
      args: {},
    });
    await dispatch(page, { type: "terminate", generation: 1 });
    const hosts = await page.evaluate(
      () =>
        (globalThis as unknown as { events: { type: string }[] }).events.filter(
          (value) => value.type === "host",
        ).length,
    );
    expect(hosts).toBe(2);
  } finally {
    await page.close();
  }
});
