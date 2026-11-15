import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSigning, main } from "./signing-check.mjs";
import { run } from "../client/scripts/ios-xcode.mjs";

const secret = "synthetic-private-value";
const identity = `Developer ID Application: ${secret} (TEAM123456)`;
const hash = "A".repeat(40);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(
  t,
  {
    selector = identity,
    member = false,
    identities,
    intercept = () => {},
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "situate-signing-check-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const files = [];
  let keychain;
  let cleanupFailed = false;
  const environment = {
    CI: "true",
    HOME: directory,
    PATH: "/usr/bin:/bin",
    APPLE_TEAM_ID: "TEAM123456",
    APPLE_MACOS_SIGNING_IDENTITY: selector,
    APPLE_DEVELOPER_ID_P12_BASE64: Buffer.from(secret).toString("base64"),
    APPLE_DEVELOPER_ID_P12_PASSWORD: secret,
    APPLE_API_KEY: secret,
    APPLE_API_PRIVATE_KEY: secret,
    TAURI_SIGNING_PRIVATE_KEY: secret,
    GH_TOKEN: secret,
    SSH_AUTH_SOCK: secret,
    OPENAI_API_KEY: secret,
    NODE_OPTIONS: secret,
  };
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(options.capture, true);
    assert.ok(
      Object.keys(options.env).every((key) =>
        [
          "PATH",
          "HOME",
          "TMPDIR",
          "USER",
          "LOGNAME",
          "LANG",
          "LC_ALL",
          "CI",
        ].includes(key),
      ),
    );
    if (command === "security" && args[0] === "create-keychain") {
      keychain = args.at(-1);
      files.push(keychain);
      t.after(() =>
        rmSync(dirname(keychain), { recursive: true, force: true }),
      );
      assert.equal(statSync(dirname(keychain)).mode & 0o777, 0o700);
      writeFileSync(keychain, secret, { mode: 0o600 });
    }
    if (command === "security" && args[0] === "import") {
      files.push(args[1]);
      assert.equal(readFileSync(args[1], "utf8"), secret);
    }
    if (command === "codesign") {
      files.push(args.at(-1));
      assert.equal(statSync(dirname(args.at(-1))).mode & 0o777, 0o700);
      const app = args.at(-1);
      for (const executable of [
        "Contents/MacOS/probe",
        "Contents/Helpers/helper",
      ])
        assert.deepEqual(
          readFileSync(join(app, executable)),
          readFileSync("/usr/bin/true"),
        );
      const plist = readFileSync(join(app, "Contents/Info.plist"), "utf8");
      assert.match(
        plist,
        /<key>CFBundleIdentifier<\/key><string>dev\.situate\.signing-probe<\/string>/,
      );
      assert.match(
        plist,
        /<key>CFBundleExecutable<\/key><string>probe<\/string>/,
      );
      assert.match(
        plist,
        /<key>CFBundlePackageType<\/key><string>APPL<\/string>/,
      );
    }
    let override;
    try {
      override = await intercept(command, args, options);
    } catch (error) {
      cleanupFailed = command === "security" && args[0] === "delete-keychain";
      throw error;
    }
    if (override !== undefined) return override;
    if (command === "python3")
      return JSON.stringify({ code: 0, unlocked: true });
    if (command === "security" && args[0] === "list-keychains")
      return `${JSON.stringify(member ? keychain.replace("/signing.keychain-db", "/./signing.keychain-db") : join(directory, "unrelated"))}\n`;
    if (command === "security" && args[0] === "find-identity")
      return (
        identities ??
        `  1) ${hash} "${identity}"\n     1 valid identities found\n`
      );
    return "";
  };
  return {
    environment,
    execute,
    calls,
    files,
    async check(options = {}) {
      const report = await checkSigning({
        root: directory,
        environment,
        platform: "darwin",
        execute,
        ...options,
      });
      for (const file of files) {
        if (cleanupFailed && file === keychain) {
          assert.equal(report.status, "failed");
          assert.equal(existsSync(file), true);
        } else assert.equal(existsSync(file), false);
      }
      const output = JSON.stringify(report);
      for (const value of [secret, hash, identity, directory, "TEAM123456"])
        assert.ok(!output.includes(value));
      assert.ok(output.length < 1500);
      return report;
    },
  };
}

test("both independent selectors sign and verify private copies without changing keychain search or trust", async (t) => {
  const f = fixture(t);
  const report = await f.check();
  assert.equal(report.status, "passed");
  assert.deepEqual(report.keychain, {
    filePresent: true,
    unlocked: true,
    statusCode: 0,
    inSearchList: false,
    selectorKind: "name",
    validIdentities: 1,
    matchingIdentities: 1,
  });
  assert.deepEqual(report.attempts, [
    {
      selector: "configured",
      status: "passed",
      stage: "verify",
      errorCode: null,
      reason: "none",
    },
    {
      selector: "matched-sha",
      status: "passed",
      stage: "verify",
      errorCode: null,
      reason: "none",
    },
  ]);
  const signs = f.calls.filter(
    ({ command, args }) => command === "codesign" && args[0] === "--force",
  );
  assert.equal(signs.length, 2);
  const keychain = f.calls[0].args.at(-1);
  for (const [index, sign] of signs.entries()) {
    assert.deepEqual(sign.args.slice(0, -1), [
      "--force",
      "--deep",
      "--options",
      "runtime",
      "--timestamp",
      "--keychain",
      keychain,
      "--sign",
      index === 0 ? identity : hash,
    ]);
  }
  assert.notEqual(signs[0].args.at(-1), signs[1].args.at(-1));
  const verifies = f.calls.filter(
    ({ command, args }) => command === "codesign" && args[0] === "--verify",
  );
  assert.deepEqual(
    verifies.map(({ args }) => args.slice(0, -1)),
    [
      ["--verify", "--deep", "--strict"],
      ["--verify", "--deep", "--strict"],
    ],
  );
  const security = f.calls
    .filter(({ command }) => command === "security")
    .map(({ args }) => args);
  assert.deepEqual(
    security.map((args) => args[0]),
    [
      "create-keychain",
      "set-keychain-settings",
      "unlock-keychain",
      "import",
      "set-key-partition-list",
      "list-keychains",
      "find-identity",
      "delete-keychain",
    ],
  );
  assert.deepEqual(security[1], [
    "set-keychain-settings",
    "-lut",
    "21600",
    keychain,
  ]);
  assert.deepEqual(security[5], ["list-keychains", "-d", "user"]);
  assert.equal(f.calls.at(-1).options.signal, undefined);
});

test("search membership uses realpath equivalence and SHA selectors remain independent attempts", async (t) => {
  const f = fixture(t, { selector: hash, member: true });
  const report = await f.check();
  assert.equal(report.status, "passed");
  assert.equal(report.keychain.selectorKind, "sha1");
  assert.equal(report.keychain.inSearchList, true);
  assert.equal(report.attempts.length, 2);
});

for (const fault of [
  "configured-sign",
  "matched-sign",
  "configured-verify",
  "setup",
  "cleanup",
  "status",
]) {
  test(`failure stays sanitized and nonpassing: ${fault}`, async (t) => {
    let signed = 0;
    const f = fixture(t, {
      intercept(command, args) {
        if (command === "codesign" && args[0] === "--force") signed++;
        const fail =
          (fault === "setup" && args[0] === "import") ||
          (fault === "cleanup" && args[0] === "delete-keychain") ||
          (fault === "configured-sign" &&
            command === "codesign" &&
            args[0] === "--force" &&
            signed === 1) ||
          (fault === "matched-sign" &&
            command === "codesign" &&
            args[0] === "--force" &&
            signed === 2) ||
          (fault === "configured-verify" &&
            command === "codesign" &&
            args[0] === "--verify" &&
            signed === 1);
        if (fail)
          throw Object.assign(
            new Error(`codesign failed (23).\n${secret} ${hash} ${identity}`),
            {
              code: fault === "configured-sign" ? secret : 23,
              stderr: secret,
            },
          );
        if (fault === "status" && command === "python3")
          return JSON.stringify({ code: secret, unlocked: secret });
      },
    });
    const report = await f.check();
    assert.equal(report.status, "failed");
    assert.equal(f.calls.at(-1).args[0], "delete-keychain");
    if (
      ["configured-sign", "matched-sign", "configured-verify"].includes(fault)
    ) {
      assert.equal(report.attempts.length, 2);
      const failed = report.attempts.find(
        (attempt) => attempt.status === "failed",
      );
      assert.equal(failed.errorCode, 23);
      assert.equal(
        failed.reason,
        fault === "configured-verify"
          ? "verification-failed"
          : "other-redacted-error",
      );
      assert.equal(
        report.attempts.filter((attempt) => attempt.status === "passed").length,
        1,
      );
    }
  });
}

test("keychain status accepts only bounded OS codes and typed unlock observations", async (t) => {
  for (const status of [
    { code: 0, unlocked: false },
    { code: -25293, unlocked: secret },
    { code: secret, message: "codesign failed (1).", unlocked: secret },
  ]) {
    const f = fixture(t, {
      intercept(command) {
        if (command === "python3") return JSON.stringify(status);
      },
    });
    const report = await f.check();
    assert.equal(report.status, "failed");
    if (status.code === 0) assert.equal(report.keychain.unlocked, false);
    else if (status.code === -25293) {
      assert.equal(report.keychain.unlocked, null);
      assert.equal(report.keychain.statusCode, -25293);
    } else assert.deepEqual(report.keychain, { filePresent: true });
  }
});

test("captured signing errors map only to fixed reasons without disclosing private messages", async (t) => {
  for (const [token, reason] of [
    ["no identity found", "identity-not-found"],
    ["errSecInternalComponent", "security-component-error"],
    ["User interaction is not allowed", "authorization-denied"],
    ["Authorization denied", "authorization-denied"],
    ["denied", "authorization-denied"],
    [secret, "other-redacted-error"],
  ]) {
    let signs = 0;
    const f = fixture(t, {
      intercept(command, args) {
        if (command === "codesign" && args[0] === "--force" && ++signs === 1)
          throw new Error(
            `codesign failed (1).\n/private/${secret}: ${token} ${identity}`,
          );
      },
    });
    const report = await f.check();
    assert.equal(report.status, "failed");
    assert.equal(report.attempts[0].reason, reason);
    assert.equal(report.attempts[0].errorCode, 1);
    assert.equal(report.attempts[1].status, "passed");
  }
});

test("ambiguous and foreign identities never become a hash fallback", async (t) => {
  for (const identities of [
    `  1) ${hash} "${identity}"\n  2) ${hash} "${identity}"\n`,
    `  1) ${hash} "Developer ID Application: ${secret} (OTHER12345)"\n`,
    secret,
  ]) {
    const f = fixture(t, { identities });
    const report = await f.check();
    assert.equal(report.status, "failed");
    assert.equal(report.code, "identity-not-unique");
    assert.deepEqual(report.attempts, []);
    assert.ok(!f.calls.some(({ command }) => command === "codesign"));
  }
});

test("abort stops further attempts and cleans the copies and keychain without an aborted cleanup signal", async (t) => {
  const abort = new AbortController();
  const f = fixture(t, {
    intercept(command) {
      if (command === "codesign") {
        abort.abort(new Error(secret));
        throw Object.assign(new Error(secret), { code: secret });
      }
    },
  });
  const report = await f.check({ signal: abort.signal });
  assert.equal(report.status, "cancelled");
  assert.equal(report.code, "interrupted");
  assert.equal(report.attempts.length, 1);
  assert.equal(report.attempts[0].errorCode, null);
  assert.equal(f.calls.at(-1).args[0], "delete-keychain");
  assert.equal(f.calls.at(-1).options.signal, undefined);
});

test("cancellation during keychain deletion cannot turn into a successful report", async (t) => {
  const abort = new AbortController();
  const f = fixture(t, {
    intercept(_command, args, options) {
      if (args[0] === "delete-keychain") {
        assert.equal(options.signal, undefined);
        abort.abort(new Error(secret));
      }
    },
  });
  const report = await f.check({ signal: abort.signal });
  assert.equal(report.status, "cancelled");
  assert.equal(report.code, "interrupted");
  assert.ok(report.attempts.every((attempt) => attempt.status === "passed"));
});

test("unsupported platforms, pre-abort and explicit empty CI inputs do not touch signing tools or local settings", async (t) => {
  const f = fixture(t);
  const abort = new AbortController();
  abort.abort(new Error(secret));
  assert.equal((await f.check({ platform: "linux" })).code, "macos-required");
  assert.equal((await f.check({ signal: abort.signal })).status, "cancelled");
  assert.equal(
    (await f.check({ environment: { CI: "true", APPLE_TEAM_ID: "" } })).code,
    "invalid-signing-inputs",
  );
  assert.equal(f.calls.length, 0);
});

test("CLI help does not inspect environment or execute commands", async (t) => {
  const output = [];
  t.mock.method(console, "log", (line) => output.push(line));
  const environment = new Proxy(
    {},
    {
      get() {
        assert.fail("help read environment");
      },
      getOwnPropertyDescriptor() {
        assert.fail("help read environment");
      },
    },
  );
  assert.equal(
    await main(["--help"], {
      environment,
      execute: () => assert.fail("help executed command"),
    }),
    0,
  );
  assert.match(output[0], /^Usage:/);
});

test("CLI retains abort handlers through cleanup and emits only sanitized JSON", async (t) => {
  const output = [];
  t.mock.method(console, "log", (line) => output.push(line));
  const previous = Object.fromEntries(
    ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [
      name,
      process.listenerCount(name),
    ]),
  );
  const f = fixture(t, {
    intercept(command, args, options) {
      if (command === "codesign") {
        process.emit("SIGTERM");
        process.emit("SIGTERM");
        throw new Error(secret);
      }
      if (args[0] === "delete-keychain") {
        assert.equal(options.signal, undefined);
        for (const [name, count] of Object.entries(previous))
          assert.equal(process.listenerCount(name), count + 1);
      }
    },
  });
  const code = await main([], {
    platform: "darwin",
    environment: { ...f.environment, SITUATE_COORDINATED_WORKTREE: root },
    execute: f.execute,
  });
  assert.equal(code, 130);
  assert.equal(JSON.parse(output[0]).status, "cancelled");
  assert.ok(!output.join("").includes(secret));
  for (const file of f.files) assert.equal(existsSync(file), false);
  for (const [name, count] of Object.entries(previous))
    assert.equal(process.listenerCount(name), count);
});

test("captured runner output and private failure messages never reach reports or console", async (t) => {
  const leaked = [];
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    t.mock.method(stream, "write", (chunk, ...args) => {
      if (String(chunk).includes(secret)) leaked.push(String(chunk));
      return original(chunk, ...args);
    });
  }
  for (const exitCode of [0, 23]) {
    const f = fixture(t, {
      intercept(command, _args, options) {
        if (command === "codesign")
          return run(
            process.execPath,
            [
              "-e",
              `process.stdout.write('${secret}'); process.stderr.write('${secret}'); process.exit(${exitCode})`,
            ],
            { ...options, env: {} },
          );
      },
    });
    const report = await f.check();
    assert.equal(report.status, exitCode === 0 ? "passed" : "failed");
    if (exitCode !== 0)
      assert.ok(
        report.attempts.every(
          (attempt) =>
            attempt.status === "failed" && attempt.errorCode === null,
        ),
      );
  }
  assert.deepEqual(leaked, []);
});
