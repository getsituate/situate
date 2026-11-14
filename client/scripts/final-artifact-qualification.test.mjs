import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import fs from "node:fs";
import { join } from "node:path";
import dns from "node:dns/promises";
import https from "node:https";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { test } from "node:test";
import { qualificationFixture } from "../../tools/release-qualification-fixture.mjs";
import {
  accessibilityScript,
  captureQualificationDeviceState,
  qualifyPredecessorUpdate,
  createFinalArtifactQualificationHost,
  validateFinalArtifactConfiguration,
  verifyQualificationFeed,
} from "./final-artifact-qualification.mjs";

export function responseRequest(responses, calls = []) {
  return (url, options, callback) => {
    calls.push({ url: String(url), options });
    const request = new EventEmitter();
    request.destroy = (error) => request.emit("error", error);
    queueMicrotask(() => {
      const next = responses.shift();
      if (next instanceof Error) request.emit("error", next);
      else {
        const response = Readable.from([Buffer.from(next.body)]);
        response.statusCode = next.status ?? 200;
        callback(response);
      }
    });
    return request;
  };
}

test("native accessibility actions target owned PIDs and exact unique roles/names", () => {
  const script = accessibilityScript(1234, {
    click: { role: "AXButton", name: 'Install "and" restart' },
  });
  assert.match(script, /unix id is 1234/);
  assert.match(script, /count of matches is not 1/);
  assert.match(script, /AXPress/);
  assert.match(script, /Install \\"and\\" restart/);
  assert.throws(() => accessibilityScript(0, { type: "synthetic" }), /PID/);
  assert.throws(
    () => accessibilityScript(123, { shell: "echo fake" }),
    /Unsupported/,
  );
  assert.throws(
    () =>
      accessibilityScript(123, {
        assert: { role: "AXUnknown", name: "anything" },
      }),
    /Invalid accessibility target/,
  );
});

test("native configuration cannot substitute booleans for actual route and journey plans", () => {
  assert.throws(
    () => validateFinalArtifactConfiguration({}),
    /trusted ephemeral host/,
  );
  assert.throws(
    () =>
      validateFinalArtifactConfiguration({
        account: {
          mode: "ephemeral-host",
          uid: 501,
          name: "runner",
          home: "/synthetic",
        },
        routing: { isolatedRouting: true },
      }),
    /Invalid URL/,
  );
});

test("normal HTTPS qualification verifies candidate feed and exact downloaded updater for both architectures", async (t) => {
  const { manifest, artifact } = qualificationFixture(t);
  const feed = {
    version: manifest.version,
    platforms: Object.fromEntries(
      ["darwin-aarch64", "darwin-x86_64"].map((target) => [
        target,
        {
          url: "https://example.com/releases/candidate.app.tar.gz",
          signature: artifact.updater.signature,
        },
      ]),
    ),
  };
  const calls = [];
  const request = responseRequest(
    [
      { body: JSON.stringify(feed) },
      { body: "synthetic updater archive" },
      { body: "synthetic updater archive" },
    ],
    calls,
  );
  assert.equal(
    await verifyQualificationFeed(
      artifact.buildConfiguration.endpoint,
      manifest,
      { request },
    ),
    true,
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (call) =>
        call.options.rejectUnauthorized === true &&
        !call.options.lookup &&
        call.url.startsWith("https://example.com/"),
    ),
  );
});

test("HTTPS qualification fails wrong version, mutated downloads, TLS errors and origin changes", async (t) => {
  const { manifest, artifact } = qualificationFixture(t);
  const platform = {
    url: "https://example.com/candidate",
    signature: artifact.updater.signature,
  };
  const feed = {
    version: manifest.version,
    platforms: { "darwin-aarch64": platform, "darwin-x86_64": platform },
  };
  await assert.rejects(
    verifyQualificationFeed(artifact.buildConfiguration.endpoint, manifest, {
      request: responseRequest([
        { body: JSON.stringify({ ...feed, version: "0.1.5" }) },
      ]),
    }),
    /different version/,
  );
  await assert.rejects(
    verifyQualificationFeed(artifact.buildConfiguration.endpoint, manifest, {
      request: responseRequest([
        { body: JSON.stringify(feed) },
        { body: "modified" },
      ]),
    }),
    /differs from the sealed/,
  );
  await assert.rejects(
    verifyQualificationFeed(artifact.buildConfiguration.endpoint, manifest, {
      request: responseRequest([new Error("certificate rejected")]),
    }),
    /certificate rejected/,
  );
  const changed = structuredClone(feed);
  changed.platforms["darwin-aarch64"].url = "http://example.com/candidate";
  await assert.rejects(
    verifyQualificationFeed(artifact.buildConfiguration.endpoint, manifest, {
      request: responseRequest([{ body: JSON.stringify(changed) }]),
    }),
    /retain production HTTPS origin/,
  );
});

test("native preparation binds both live public updater signatures and version to the configured predecessor", async (t) => {
  for (const fault of [
    "matching",
    "version",
    "arm-signature",
    "intel-signature",
  ])
    await t.test(fault, async (subtest) => {
      const { directory, manifest, artifact } = qualificationFixture(subtest);
      const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
      const identity = JSON.stringify({ operationId: "synthetic-operation" });
      const feed = {
        version: manifest.version,
        platforms: Object.fromEntries(
          ["darwin-aarch64", "darwin-x86_64"].map((target) => [
            target,
            { signature: artifact.updater.signature },
          ]),
        ),
      };
      if (fault === "version") feed.version = "2026.11.2";
      if (fault === "arm-signature")
        feed.platforms["darwin-aarch64"].signature = "ZGlmZmVyZW50";
      if (fault === "intel-signature")
        feed.platforms["darwin-x86_64"].signature = "ZGlmZmVyZW50";
      const publicFeed = JSON.stringify(feed);
      const calls = [];
      const request = responseRequest(
        [
          { body: identity },
          { status: 404, body: "" },
          { body: publicFeed },
          { status: 503, body: "" },
        ],
        calls,
      );
      const platform = Object.getOwnPropertyDescriptor(process, "platform");
      subtest.after(() => {
        subtest.mock.restoreAll();
        syncBuiltinESMExports();
        Object.defineProperty(process, "platform", platform);
      });
      Object.defineProperty(process, "platform", {
        ...platform,
        value: "darwin",
      });
      subtest.mock.method(os, "userInfo", () => ({
        uid: 501,
        username: "runner",
      }));
      subtest.mock.method(os, "homedir", () => directory);
      const lstat = fs.lstatSync;
      subtest.mock.method(fs, "lstatSync", (path, ...args) => {
        const stat = lstat(path, ...args);
        return path === fs.realpathSync(directory)
          ? Object.assign(stat, { uid: 501 })
          : stat;
      });
      subtest.mock.method(childProcess, "spawnSync", () => ({
        status: 0,
        stdout: '"IOConsoleLocked" = No\n',
      }));
      const lookup = subtest.mock.method(dns, "lookup", async () => [
        { address: "127.0.0.1" },
      ]);
      subtest.mock.method(https, "get", request);
      syncBuiltinESMExports();
      assert.equal((await import("node:dns/promises")).lookup, lookup);
      const assertion = {
        assert: { role: "AXStaticText", name: "Synthetic state" },
      };
      const host = createFinalArtifactQualificationHost(
        {
          account: {
            mode: "ephemeral-host",
            uid: 501,
            name: "runner",
            home: directory,
          },
          runnerImage: "synthetic-test-image",
          predecessor: { directory, manifest },
          routing: {
            endpoint: artifact.buildConfiguration.endpoint,
            privateAddress: "127.0.0.1",
            publicAddress: "93.184.215.14",
            interface: "lo0",
            identityPath: "/private-qualification/identity.json",
            identitySha256: sha(identity),
            publicFeedSha256: sha(publicFeed),
            operationId: "synthetic-operation",
          },
          journeys: Object.fromEntries(
            ["workspace", "onboarding", "plugins"].map((name) => [
              name,
              {
                actions: [assertion],
                reopen: [assertion],
                files: [
                  { path: "workspace/synthetic.md", sha256: "a".repeat(64) },
                ],
              },
            ]),
          ),
          lifecycle: Object.fromEntries(
            [
              "multiwindow",
              "unsavedCancellation",
              "replacement",
              "relaunch",
              "recovery",
            ].map((name) => [
              name,
              { before: [assertion], actions: [assertion], after: [assertion] },
            ]),
          ),
          updateActions: [
            { click: { role: "AXButton", name: "Install and restart" } },
          ],
        },
        {
          environment: { PATH: "/synthetic" },
          execute: async (command) => {
            if (command === "osascript") return "";
            if (command === "route") return "interface: lo0\n";
            assert.fail(
              "predecessor identity must be checked before installing or launching an app",
            );
          },
        },
      );
      await assert.rejects(
        host.prepare({ manifest }),
        fault === "matching"
          ? /HTTPS response was not successful/
          : /host-channel predecessor differs/,
      );
      assert.equal(calls.length, fault === "matching" ? 4 : 3);
    });
});

test("A authors update state before replacement, then B asserts it before and after restart", async () => {
  const calls = [];
  let version = "B";
  let retained;
  await qualifyPredecessorUpdate({
    install: async () => {
      calls.push("install A");
      version = "A";
    },
    author: async () => {
      assert.equal(version, "A");
      retained = "A-authored";
      calls.push("author A");
    },
    report: () => ({ requests: 12 }),
    update: async () => {
      assert.equal(retained, "A-authored");
      calls.push("production updater");
      version = "B";
    },
    reopen: async (report) => {
      assert.equal(version, "B");
      assert.equal(report.requests, 12);
      calls.push("B product/files/no replay");
    },
    restart: async () => {
      calls.push("restart B");
    },
  });
  assert.deepEqual(calls, [
    "install A",
    "author A",
    "production updater",
    "B product/files/no replay",
    "restart B",
    "B product/files/no replay",
  ]);
});

test("failed post-update product assertions fail qualification before restart", async () => {
  let restarted = false;
  await assert.rejects(
    qualifyPredecessorUpdate({
      install: async () => {},
      author: async () => {},
      report: () => ({ requests: 4 }),
      update: async () => {},
      reopen: async () => {
        throw new Error("draft missing");
      },
      restart: async () => {
        restarted = true;
      },
    }),
    /draft missing/,
  );
  assert.equal(restarted, false);
});

test("AX entry, window assertions and chords reject unreviewed roles and keys", () => {
  assert.match(
    accessibilityScript(123, {
      focus: {
        role: "AXTextArea",
        name: "Message",
        window: "Qualification — Situate",
      },
    }),
    /AXFocused/,
  );
  assert.match(
    accessibilityScript(123, {
      assert: { role: "AXTextArea", name: "Message", value: "retained" },
    }),
    /Accessibility value differs/,
  );
  assert.match(
    accessibilityScript(123, { windows: 2 }),
    /count of windows is not 2/,
  );
  assert.match(
    accessibilityScript(123, {
      key: { key: "g", modifiers: ["command", "shift"] },
    }),
    /command down, shift down/,
  );
  for (const action of [
    { windows: 0 },
    { key: { key: "r", modifiers: ["command"] } },
    { key: { key: "g", modifiers: ["option"] } },
    { focus: { role: "AXWebArea", name: "anything" } },
  ])
    assert.throws(() => accessibilityScript(123, action));
});

function deviceStateFixture(t) {
  const home = fs.realpathSync(
    fs.mkdtempSync(join(os.tmpdir(), "situate-device-state-")),
  );
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const owned = join(home, "owned");
  fs.mkdirSync(owned);
  const identifier = "com.example.qualification";
  const application = join(home, "Library", "Application Support", identifier);
  const preferences = join(
    home,
    "Library",
    "Preferences",
    identifier + ".plist",
  );
  return {
    home,
    owned,
    identifier,
    application,
    preferences,
    uid: fs.lstatSync(home).uid,
  };
}

test("candidate device state archives only initially absent app namespaces without changing bytes or modes", (t) => {
  const fixture = deviceStateFixture(t);
  const archive = captureQualificationDeviceState(fixture);
  const note = join(fixture.application, "nested", "registry.bin");
  fs.mkdirSync(join(fixture.application, "nested"), { recursive: true });
  const bytes = Buffer.from([0, 255, 1, 13, 10]);
  fs.writeFileSync(note, bytes, { mode: 0o640 });
  fs.mkdirSync(join(fixture.home, "Library", "Preferences"), {
    recursive: true,
  });
  fs.writeFileSync(fixture.preferences, "synthetic preferences");
  const sibling = join(
    fixture.home,
    "Library",
    "Application Support",
    "unrelated",
  );
  fs.mkdirSync(sibling);
  fs.writeFileSync(join(sibling, "untouched"), "retain");
  const before = fs.statSync(note);
  const destination = archive(fixture.owned);
  const moved = join(
    destination,
    "Library",
    "Application Support",
    fixture.identifier,
    "nested",
    "registry.bin",
  );
  assert.deepEqual(fs.readFileSync(moved), bytes);
  assert.equal(fs.statSync(moved).ino, before.ino);
  assert.equal(fs.statSync(moved).mode, before.mode);
  assert.equal(
    fs.readFileSync(
      join(
        destination,
        "Library",
        "Preferences",
        fixture.identifier + ".plist",
      ),
      "utf8",
    ),
    "synthetic preferences",
  );
  assert.equal(fs.existsSync(fixture.application), false);
  assert.equal(fs.existsSync(fixture.preferences), false);
  assert.equal(fs.readFileSync(join(sibling, "untouched"), "utf8"), "retain");
  assert.throws(() => archive(fixture.owned), /already archived/);
  fs.mkdirSync(fixture.application);
  fs.writeFileSync(
    join(fixture.application, "A-authored"),
    "preserve through update",
  );
  assert.equal(
    fs.readFileSync(join(fixture.application, "A-authored"), "utf8"),
    "preserve through update",
  );
});

test("pre-existing app data and dangling links cannot obtain an absent-before proof", (t) => {
  const fixture = deviceStateFixture(t);
  fs.mkdirSync(fixture.application, { recursive: true });
  assert.throws(
    () => captureQualificationDeviceState(fixture),
    /retains prior app data/,
  );
  fs.rmdirSync(fixture.application);
  fs.symlinkSync(join(fixture.home, "missing"), fixture.application);
  assert.throws(
    () => captureQualificationDeviceState(fixture),
    /retains prior app data/,
  );
});

test("archive refuses generated links and hard links before moving any app data", (t) => {
  const fixture = deviceStateFixture(t);
  const archive = captureQualificationDeviceState(fixture);
  fs.mkdirSync(fixture.application, { recursive: true });
  fs.mkdirSync(join(fixture.home, "Library", "Preferences"), {
    recursive: true,
  });
  fs.writeFileSync(fixture.preferences, "unchanged");
  const original = join(fixture.application, "original");
  const unsafe = join(fixture.application, "unsafe");
  fs.writeFileSync(original, "synthetic");
  fs.symlinkSync(original, unsafe);
  assert.throws(() => archive(fixture.owned), /Unsafe or foreign/);
  fs.unlinkSync(unsafe);
  fs.linkSync(original, unsafe);
  assert.throws(() => archive(fixture.owned), /Unsafe or foreign/);
  assert.equal(fs.readFileSync(fixture.preferences, "utf8"), "unchanged");
  assert.equal(
    fs.existsSync(join(fixture.owned, "candidate-device-state")),
    false,
  );
});

test("archive rejects foreign ownership and swapped namespace parents before moving files", (t) => {
  const fixture = deviceStateFixture(t);
  const archive = captureQualificationDeviceState(fixture);
  fs.mkdirSync(fixture.application, { recursive: true });
  const foreign = join(fixture.application, "foreign");
  fs.writeFileSync(foreign, "synthetic foreign owner");
  const lstat = fs.lstatSync;
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const mock = t.mock.method(fs, "lstatSync", (path, ...args) => {
    const stat = lstat(path, ...args);
    return path === foreign
      ? Object.assign(stat, { uid: fixture.uid + 1 })
      : stat;
  });
  syncBuiltinESMExports();
  assert.throws(() => archive(fixture.owned), /Unsafe or foreign/);
  mock.mock.restore();
  syncBuiltinESMExports();
  fs.renameSync(
    join(fixture.home, "Library"),
    join(fixture.home, "moved-library"),
  );
  fs.symlinkSync(
    join(fixture.home, "moved-library"),
    join(fixture.home, "Library"),
  );
  assert.throws(() => archive(fixture.owned), /Unsafe application data parent/);
  assert.equal(
    fs.existsSync(join(fixture.owned, "candidate-device-state")),
    false,
  );
});
