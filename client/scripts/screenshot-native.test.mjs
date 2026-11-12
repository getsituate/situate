import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildScreenshotApp, screenshotNative } from "./screenshot-native.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "native screenshot fixture "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, output: join(root, "capture.png"), platform: "darwin" };
}

test("visual builds override application data without changing the visual profile", () => {
  const commands = [];
  const executable = buildScreenshotApp(
    "/temporary/client",
    { root: "/temporary/owned data" },
    (command, args, options) => {
      commands.push({ command, args, options });
      return command === "rustc" ? "host: aarch64-apple-darwin\n" : "";
    },
  );
  assert.equal(
    executable,
    "/temporary/client/target/native-visual/aarch64-apple-darwin/debug/situate-client",
  );
  const build = commands[1];
  assert.equal(
    build.args[build.args.indexOf("--config") + 1],
    "src-tauri/tests/visual.conf.json",
  );
  assert.deepEqual(
    JSON.parse(build.args[build.args.lastIndexOf("--config") + 1]),
    { app: { appDirectoriesOverride: "/temporary/owned data" } },
  );
});

test("screenshot builds outside the desktop queue and keeps isolated app data through capture", async (t) => {
  const options = await fixture(t);
  const events = [];
  let isolated;
  await screenshotNative(["--launch", "--output", options.output], {
    ...options,
    build: async (root, data) => {
      assert.equal(root, options.root);
      isolated = data.root;
      events.push("build");
      return join(root, "native app");
    },
    coordinate: async (command) => {
      events.push("capture");
      await access(isolated);
      assert.equal(command.resource, "desktop");
      assert.equal(command.environment.SITUATE_SMOKE_ROOT, isolated);
      assert.match(command.args[0], /screenshot-native-phase\.mjs$/);
      assert.deepEqual(JSON.parse(command.args[1]), {
        root: options.root,
        output: options.output,
        executable: join(options.root, "native app"),
      });
      return 0;
    },
  });
  assert.deepEqual(events, ["build", "capture"]);
  await assert.rejects(access(isolated), { code: "ENOENT" });
});

test("capturing an existing PID queues capture without building or taking ownership of the app", async (t) => {
  const options = await fixture(t);
  await screenshotNative(["--pid", "123", "--output", options.output], {
    ...options,
    build: () => assert.fail("built an existing application"),
    coordinate: async ({ args }) => {
      const capture = JSON.parse(args[1]);
      assert.equal(capture.pid, "123");
      assert.equal(capture.executable, undefined);
      return 0;
    },
  });
});

test("cancelled and failed queued captures remain failures and remove owned temporary data", async (t) => {
  const options = await fixture(t);
  let isolated;
  const controller = new AbortController();
  const build = async (_root, data) => {
    isolated = data.root;
    controller.abort();
    return "/unused";
  };
  await assert.rejects(
    screenshotNative(["--launch", "--output", options.output], {
      ...options,
      build,
      signal: controller.signal,
      coordinate: () => assert.fail("queued after interruption"),
    }),
    { name: "AbortError" },
  );
  await assert.rejects(access(isolated), { code: "ENOENT" });
  await assert.rejects(
    screenshotNative(["--pid", "123", "--output", options.output], {
      ...options,
      coordinate: async () => 17,
    }),
    /capture failed: exit 17/,
  );
});

test("invalid capture options and existing output fail before compilation or queueing", async (t) => {
  const options = await fixture(t);
  const forbidden = () => assert.fail("started native work");
  const dependencies = { ...options, build: forbidden, coordinate: forbidden };
  for (const args of [
    [],
    ["--launch", "--pid", "123"],
    ["--pid", "0"],
    ["--pid", "1.5"],
  ])
    await assert.rejects(screenshotNative(args, dependencies));
  await writeFile(options.output, "keep");
  await assert.rejects(
    screenshotNative(["--launch", "--output", options.output], dependencies),
    /already exists/,
  );
});
