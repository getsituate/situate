import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { childEnvironment, configuration, sshArguments } from "./config.mjs";
import { createArchive, main, stage } from "./deploy.mjs";
import { gunzipSync } from "node:zlib";

function temporary(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "situate-deploy-")));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("configuration parses only requested values without evaluating shell expressions", (t) => {
  const directory = temporary(t);
  writeFileSync(
    join(directory, ".env"),
    "WEBSITE_DEPLOY_HOST=deploy@example.test\nHCLOUD_TOKEN='$(touch unsafe)'\nUNRELATED=private\n",
    { mode: 0o600 },
  );
  assert.deepEqual(configuration(["WEBSITE_DEPLOY_HOST"], {}, directory), {
    WEBSITE_DEPLOY_HOST: "deploy@example.test",
  });
  assert.deepEqual(configuration(["HCLOUD_TOKEN"], {}, directory), {
    HCLOUD_TOKEN: "$(touch unsafe)",
  });
  assert.deepEqual(
    configuration(
      ["WEBSITE_DEPLOY_HOST"],
      { WEBSITE_DEPLOY_HOST: "" },
      directory,
    ),
    { WEBSITE_DEPLOY_HOST: "" },
  );
  assert.deepEqual(
    configuration(["WEBSITE_DEPLOY_HOST"], { CI: "true" }, directory),
    { WEBSITE_DEPLOY_HOST: undefined },
  );
  assert.equal(existsSync(join(directory, "unsafe")), false);
});

test("configuration rejects public permissions and symlinked environment files", (t) => {
  const directory = temporary(t);
  const env = join(directory, ".env");
  writeFileSync(env, "HCLOUD_TOKEN=synthetic", { mode: 0o600 });
  if (process.platform !== "win32") {
    chmodSync(env, 0o644);
    assert.throws(
      () => configuration(["HCLOUD_TOKEN"], {}, directory),
      /owner-only/,
    );
  }
  rmSync(env);
  writeFileSync(join(directory, "other"), "", { mode: 0o600 });
  symlinkSync(join(directory, "other"), env);
  assert.throws(
    () => configuration(["HCLOUD_TOKEN"], {}, directory),
    /regular/,
  );
});

test("subprocesses do not inherit unrelated credentials", () => {
  assert.deepEqual(
    childEnvironment({
      PATH: "/bin",
      HOME: "/tmp",
      HCLOUD_TOKEN: "synthetic",
      TEST_OPENAI_API_KEY: "synthetic",
    }),
    { PATH: "/bin", HOME: "/tmp" },
  );
});

test("SSH enforces pinned hosts and rejects option or shell injection", () => {
  const args = sshArguments({
    WEBSITE_DEPLOY_HOST: "deploy@example.test",
    WEBSITE_SSH_IDENTITY: "/tmp/key with spaces.pub",
  });
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.ok(args.includes("BatchMode=yes"));
  assert.ok(args.includes("IdentitiesOnly=yes"));
  assert.ok(args.includes("/tmp/key with spaces.pub"));
  for (const host of [
    "",
    "-Fconfig",
    "host;echo bad",
    "host\ncommand",
    "user@host other",
  ])
    assert.throws(
      () => sshArguments({ WEBSITE_DEPLOY_HOST: host }),
      /WEBSITE_DEPLOY_HOST/,
    );
});

test("staging contains localized static output but no source catalogs or private configuration", async (t) => {
  const directory = temporary(t);
  await stage(directory);
  const html = readFileSync(join(directory, "site/index.html"), "utf8");
  assert.ok(!html.includes("{{"));
  assert.match(html, /noindex, nofollow/);
  for (const file of [
    ".env",
    "messages.en.json",
    "site.mjs",
    "media/birthday-fixture.json",
    "media/manifest.json",
  ])
    assert.equal(existsSync(join(directory, "site", file)), false, file);
  assert.ok(
    existsSync(join(directory, "site/media/provider-icons-license.txt")),
  );
  assert.ok(existsSync(join(directory, "site/design/brand/tokens.css")));
  assert.ok(existsSync(join(directory, "compose.yaml")));
});

test("release archives omit local filesystem metadata", (t) => {
  const directory = temporary(t);
  const staging = join(directory, "stage");
  mkdirSync(staging);
  writeFileSync(join(staging, "index.html"), "public content");
  if (process.platform === "darwin") {
    const result = spawnSync("xattr", [
      "-w",
      "com.situate.private-test",
      "synthetic-private-metadata",
      join(staging, "index.html"),
    ]);
    assert.equal(result.status, 0);
  }
  const archive = join(directory, "release.tar.gz");
  createArchive(staging, archive);
  const content = gunzipSync(readFileSync(archive)).toString("utf8");
  assert.ok(content.includes("public content"));
  assert.ok(!content.includes("synthetic-private-metadata"));
  assert.ok(!content.includes("LIBARCHIVE"));
  assert.ok(!content.includes("._index.html"));
});

test("retired preview DNS commands reject operations without invoking Terraform", (t) => {
  const directory = temporary(t);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const marker = join(directory, "terraform-called");
  writeFileSync(
    join(bin, "terraform"),
    `#!${process.execPath}\nrequire("fs").writeFileSync(${JSON.stringify(marker)}, "called");\n`,
    { mode: 0o700 },
  );
  for (const command of [
    "init",
    "validate",
    "plan",
    "show",
    "apply",
    "destroy",
  ]) {
    const result = spawnSync(
      process.execPath,
      [new URL("./dns.mjs", import.meta.url).pathname, command],
      {
        cwd: directory,
        env: { ...childEnvironment(), PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /retired/);
    assert.match(result.stderr, /infrastructure\/production\/terraform\.mjs/);
  }
  assert.equal(existsSync(marker), false);
  assert.match(
    readFileSync(new URL("./terraform/retired.tf", import.meta.url), "utf8"),
    /required_version = "< 0\.0\.0"/,
  );
});

test("invalid commands fail before any deployment", async () => {
  for (const args of [
    [],
    ["rollback", "../current"],
    ["deploy", "unexpected"],
    ["destroy"],
  ])
    await assert.rejects(main(args), /Usage/);
});

test("retired preview deployment rejects remote operations before loading credentials", async () => {
  for (const args of [
    ["deploy"],
    ["proxy"],
    ["rollback", "20260101000000-aaaaaaaaaaaa"],
  ])
    await assert.rejects(main(args), /Preview hosting is retired/);
});

const oldId = "20260101000000-aaaaaaaaaaaa";
const newId = "20260102000000-bbbbbbbbbbbb";
function activation(
  t,
  { previous = true, failure = "", stale = false, mode = "deploy" } = {},
) {
  const directory = temporary(t);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  for (const id of [oldId, newId])
    mkdirSync(join(directory, "releases", id), { recursive: true });
  if (previous)
    symlinkSync(join(directory, "releases", oldId), join(directory, "current"));
  if (stale)
    symlinkSync(
      join(directory, "releases", oldId),
      join(directory, "current.next"),
    );
  const script = readFileSync(
    new URL("./activate.sh", import.meta.url),
    "utf8",
  ).replaceAll("/opt/situate-reboot", directory);
  writeFileSync(join(directory, "activate.sh"), script);
  const executable = (name, source) =>
    writeFileSync(join(bin, name), `#!${process.execPath}\n${source}`, {
      mode: 0o700,
    });
  executable("flock", "process.exit(0)");
  executable(
    "readlink",
    `try { console.log(require('fs').realpathSync(process.argv.at(-1))) } catch { process.exit(1) }`,
  );
  executable(
    "mv",
    `require('fs').renameSync(process.argv.at(-2), process.argv.at(-1))`,
  );
  executable(
    "docker",
    `
const fs = require('fs');
const args = process.argv.slice(2);
const id = require('path').basename(process.cwd());
fs.appendFileSync(${JSON.stringify(join(directory, "calls"))}, JSON.stringify({ args, id }) + '\\n');
if (args.includes('up') && (${JSON.stringify(failure)} === 'all' || id === ${JSON.stringify(failure)})) process.exit(1);
`,
  );
  const result = spawnSync(
    "bash",
    [join(directory, "activate.sh"), newId, mode],
    {
      env: { ...childEnvironment(), PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    },
  );
  const calls = existsSync(join(directory, "calls"))
    ? readFileSync(join(directory, "calls"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)
    : [];
  return { directory, result, calls };
}

test("healthy deployment switches only the preview release", (t) => {
  const { directory, result, calls } = activation(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readlinkSync(join(directory, "current")),
    join(directory, "releases", newId),
  );
  assert.ok(calls.some(({ args }) => args.includes("--wait")));
  assert.ok(calls.every(({ id }) => id === newId));
});

test("explicit rollback never pulls an image", (t) => {
  const { result, calls } = activation(t, { mode: "rollback" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!calls.some(({ args }) => args.includes("pull")));
  const up = calls.find(({ args }) => args.includes("up"));
  assert.ok(up.args.includes("--pull"));
  assert.ok(up.args.includes("never"));
});

test("unhealthy deployment restores the previous container without moving current", (t) => {
  const { directory, result, calls } = activation(t, { failure: newId });
  assert.notEqual(result.status, 0);
  assert.equal(
    readlinkSync(join(directory, "current")),
    join(directory, "releases", oldId),
  );
  assert.ok(
    calls.some(
      ({ id, args }) =>
        id === oldId && args.includes("up") && args.includes("never"),
    ),
  );
});

test("failed first deployment removes only the new Compose project", (t) => {
  const { directory, result, calls } = activation(t, {
    previous: false,
    failure: newId,
  });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(directory, "current")), false);
  assert.ok(calls.some(({ args }) => args.includes("down")));
});

test("failed recovery is reported, not treated as success", (t) => {
  const { result } = activation(t, { failure: "all" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Rollback failed/);
});

test("an interrupted activation is not silently retried", (t) => {
  const { result, calls } = activation(t, { stale: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /interrupted activation/);
  assert.equal(calls.length, 0);
});
