import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  containerPlan,
  buildContainerRelease,
  proxyVariables,
} from "./release-docker.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-docker-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("Linux plans distinguish the engine architecture from an emulated build", () => {
  assert.equal(containerPlan().dockerPlatform, "linux/arm64");
  assert.equal(containerPlan({ arch: "x64" }).dockerPlatform, "linux/amd64");
  assert.equal(containerPlan({ daemon: "linux/x86_64" }).targetArch, "x64");
  assert.ok(containerPlan({ check: true }).command.at(-1).includes("xvfb-run"));
  assert.ok(!containerPlan().command.at(-1).includes("npm test"));
});

test("Windows cross-builds require acknowledgement and target x64 without host emulation", () => {
  assert.throws(
    () => containerPlan({ platform: "windows" }),
    /license acknowledgement/,
  );
  const plan = containerPlan({
    platform: "windows",
    acceptWindowsSdkLicense: true,
    check: true,
  });
  assert.equal(plan.dockerPlatform, "linux/arm64");
  assert.equal(plan.targetArch, "x64");
  assert.ok(
    plan.command
      .at(-1)
      .includes("--windows-cross --accept-windows-sdk-license"),
  );
  assert.ok(!plan.command.at(-1).includes("test:native"));
});

test("rejects unsupported platforms, architectures and Docker engines", () => {
  for (const options of [
    { platform: "ios" },
    { arch: "mips" },
    { daemon: "windows/amd64" },
    { daemon: "linux/riscv64" },
    { platform: "windows", arch: "arm64", acceptWindowsSdkLicense: true },
  ]) {
    assert.throws(() => containerPlan(options));
  }
});

test("missing Microsoft acknowledgement fails before invoking Docker", async (t) => {
  await assert.rejects(
    buildContainerRelease({
      root: fixture(t),
      platform: "windows",
      execute: () => assert.fail("Docker must not run"),
    }),
    /license acknowledgement/,
  );
});

function mockDocker(
  calls,
  {
    state = "exited/0",
    failBuild = false,
    failStart = false,
    manifestStatus = "complete",
    image = "a",
  } = {},
) {
  return async (args) => {
    calls.push(args);
    if (args[0] === "info") return "linux/aarch64";
    if (args[0] === "buildx") {
      if (failBuild) throw new Error("Image build failed");
      writeFileSync(
        args[args.indexOf("--iidfile") + 1],
        `sha256:${image.repeat(64)}`,
      );
    }
    if (args[0] === "start" && failStart)
      throw new Error("Attachment interrupted");
    if (args[0] === "inspect") return state;
    if (args[0] === "cp") {
      const release = join(args.at(-1), "release-test");
      mkdirSync(join(release, "linux-arm64"), { recursive: true });
      writeFileSync(join(release, "linux-arm64/Situate.deb"), "package");
      writeFileSync(
        join(release, "manifest.json"),
        JSON.stringify({
          status: manifestStatus,
          architecture: "arm64",
          completed: ["linux"],
          artifacts: ["linux-arm64/Situate.deb"],
        }),
      );
    }
    return "";
  };
}

test("builds a filtered image, uses only named volumes, exports artifacts and removes its container", async (t) => {
  const root = fixture(t);
  const calls = [];
  const output = await buildContainerRelease({
    root,
    execute: mockDocker(calls),
  });
  const report = JSON.parse(readFileSync(join(output, "container.json")));
  assert.equal(report.status, "complete");
  assert.equal(report.image, `sha256:${"a".repeat(64)}`);
  const build = calls.find(([op]) => op === "buildx");
  assert.equal(
    build[build.indexOf("--file") + 1],
    join(root, "docker/Dockerfile"),
  );
  assert.equal(build[build.indexOf("--platform") + 1], "linux/arm64");
  const create = calls.find(([op]) => op === "create");
  assert.ok(create.includes(report.image));
  assert.ok(build.includes("--provenance=false"));
  for (const name of proxyVariables) {
    assert.equal(build[build.indexOf(`${name}=`) - 1], "--build-arg");
    assert.equal(create[create.indexOf(`${name}=`) - 1], "--env");
  }
  assert.ok(
    create.includes(
      `type=volume,source=${report.targetVolume},target=/workspace/client/target`,
    ),
  );
  assert.equal(
    create.filter((arg) => arg.startsWith("type=volume,")).length,
    3,
  );
  assert.ok(
    create.every(
      (arg) => !arg.includes("type=bind") && !arg.includes("--privileged"),
    ),
  );
  assert.ok(
    calls
      .find(([op]) => op === "cp")
      .at(-1)
      .startsWith(join(root, "artifacts")),
  );
  assert.deepEqual(calls.at(-1), ["rm", "--force", report.container]);
  assert.ok(!existsSync(build[build.indexOf("--iidfile") + 1]));
});

test("source-image rollbacks reuse only their own compiled-target cache", async (t) => {
  const root = fixture(t);
  const reports = [];
  for (const image of ["a", "b", "a"]) {
    const output = await buildContainerRelease({
      root,
      execute: mockDocker([], { image }),
    });
    reports.push(JSON.parse(readFileSync(join(output, "container.json"))));
  }
  assert.notEqual(reports[0].targetVolume, reports[1].targetVolume);
  assert.equal(reports[0].targetVolume, reports[2].targetVolume);
  assert.equal(reports[0].cachePrefix, reports[1].cachePrefix);
});

test("cancellation during export cannot be reported as a successful build", async (t) => {
  const calls = [];
  const controller = new AbortController();
  const run = mockDocker(calls);
  await assert.rejects(
    buildContainerRelease({
      root: fixture(t),
      signal: controller.signal,
      execute: async (args) => {
        const result = await run(args);
        if (args[0] === "cp") controller.abort();
        return result;
      },
    }),
    /abort/i,
  );
  const output = calls.find(([op]) => op === "cp").at(-1);
  assert.equal(
    JSON.parse(readFileSync(join(output, "container.json"))).status,
    "failed",
  );
  assert.equal(calls.at(-1)[0], "rm");
});

test("nonzero container exit fails even when Docker attachment reports success", async (t) => {
  const root = fixture(t);
  const calls = [];
  await assert.rejects(
    buildContainerRelease({
      root,
      execute: mockDocker(calls, { state: "exited/1" }),
    }),
    /did not exit successfully/,
  );
  assert.ok(calls.find(([op]) => op === "stop"));
  assert.ok(calls.find(([op]) => op === "cp"));
  assert.equal(calls.at(-1)[0], "rm");
  const output = calls.find(([op]) => op === "cp").at(-1);
  assert.equal(
    JSON.parse(readFileSync(join(output, "container.json"))).status,
    "failed",
  );
});

test("interrupted attachment stops the container before artifact export", async (t) => {
  const calls = [];
  await assert.rejects(
    buildContainerRelease({
      root: fixture(t),
      execute: mockDocker(calls, { failStart: true }),
    }),
    /interrupted/,
  );
  const ops = calls.map(([op]) => op);
  assert.ok(ops.indexOf("stop") < ops.indexOf("cp"));
  assert.equal(ops.at(-1), "rm");
});

test("image failure never creates or removes a runtime container", async (t) => {
  const calls = [];
  await assert.rejects(
    buildContainerRelease({
      root: fixture(t),
      execute: mockDocker(calls, { failBuild: true }),
    }),
    /Image build failed/,
  );
  assert.ok(calls.every(([op]) => !["create", "rm"].includes(op)));
});

test("a failed release manifest cannot become a successful container result", async (t) => {
  const calls = [];
  await assert.rejects(
    buildContainerRelease({
      root: fixture(t),
      execute: mockDocker(calls, { manifestStatus: "failed" }),
    }),
    /complete build/,
  );
  assert.equal(calls.at(-1)[0], "rm");
});

test("artifact exports cannot traverse a host symlink", async (t) => {
  const root = fixture(t);
  const external = fixture(t);
  symlinkSync(external, join(root, "artifacts"), "junction");
  await assert.rejects(
    buildContainerRelease({ root, execute: mockDocker([]) }),
    /symbolic link/,
  );
  assert.ok(!existsSync(join(external, "container.json")));
});
