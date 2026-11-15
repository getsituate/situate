import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSigning, main, signingEnvironment } from "./signing-check.mjs";
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
  const searchList = [join(directory, "unrelated")];
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
      if (member)
        searchList.push(
          keychain.replace("/signing.keychain-db", "/./signing.keychain-db"),
        );
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
      if (command === "security" && args[0] === "delete-keychain")
        cleanupFailed = true;
      throw error;
    }
    if (override !== undefined) return override;
    if (command === "python3")
      return JSON.stringify({ code: 0, unlocked: true });
    if (command === "security" && args[0] === "list-keychains") {
      if (args.includes("-s"))
        searchList.splice(
          0,
          searchList.length,
          ...args.slice(args.indexOf("-s") + 1),
        );
      return searchList.map((path) => JSON.stringify(path)).join("\n");
    }
    if (command === "security" && args[0] === "delete-keychain") {
      const owned = realpathSync(keychain);
      searchList.splice(
        0,
        searchList.length,
        ...searchList.filter((path) => {
          try {
            return realpathSync(path) !== owned;
          } catch {
            return resolve(path) !== resolve(keychain);
          }
        }),
      );
      rmSync(keychain);
    }
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
    searchList,
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
    await main(["--help", "--probe-search-list"], {
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

const hosted = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
};

test("search-list experiment rejects non-hosted contexts before private input access", async (t) => {
  const output = [];
  t.mock.method(console, "log", (line) => output.push(line));
  for (const markers of [
    {},
    { ...hosted, CI: "false" },
    { ...hosted, CI: "TRUE" },
    { ...hosted, GITHUB_ACTIONS: "false" },
    { ...hosted, GITHUB_ACTIONS: undefined },
    { ...hosted, RUNNER_ENVIRONMENT: "self-hosted" },
    { ...hosted, RUNNER_ENVIRONMENT: undefined },
  ]) {
    const environment = new Proxy(markers, {
      get(target, key) {
        assert.ok(["CI", "GITHUB_ACTIONS", "RUNNER_ENVIRONMENT"].includes(key));
        return target[key];
      },
      getOwnPropertyDescriptor() {
        assert.fail("private input selection before hosted guard");
      },
    });
    const report = await checkSigning({
      platform: "darwin",
      environment,
      probeSearchList: true,
      execute: () => assert.fail("guard executed command"),
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.code, "hosted-ci-required");
    assert.equal(
      await main(["--probe-search-list"], {
        platform: "darwin",
        environment,
        execute: () => assert.fail("guard executed command"),
      }),
      1,
    );
    assert.equal(JSON.parse(output.at(-1)).code, "hosted-ci-required");
  }
});

test("function experiment opt-in must be a boolean before any environment access", async () => {
  for (const probeSearchList of ["true", "false", 1, {}]) {
    const report = await checkSigning({
      probeSearchList,
      environment: new Proxy(
        {},
        {
          get() {
            assert.fail("invalid opt-in read environment");
          },
        },
      ),
      execute: () => assert.fail("invalid opt-in executed command"),
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.code, "invalid-options");
  }
});

test("hosted defaults use release registration without enabling the comparison experiment", async (t) => {
  const f = fixture(t);
  const original = [...f.searchList];
  const environment = {
    ...f.environment,
    ...hosted,
    SITUATE_COORDINATED_WORKTREE: root,
  };
  const forwarded = signingEnvironment(environment);
  assert.equal(forwarded.GITHUB_ACTIONS, "true");
  assert.equal(forwarded.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(forwarded.SITUATE_COORDINATED_WORKTREE, root);
  for (const key of [
    "GH_TOKEN",
    "SSH_AUTH_SOCK",
    "OPENAI_API_KEY",
    "APPLE_API_KEY",
  ])
    assert.equal(forwarded[key], undefined);
  const report = await f.check({ environment });
  assert.equal(report.status, "passed");
  assert.equal(report.searchListProbe, undefined);
  assert.equal(report.keychain.inSearchList, true);
  assert.deepEqual(f.searchList, original);
});

test("registered attempts do not replace failed baseline and removal preserves concurrent entries in order", async (t) => {
  let concurrent, canonicalOwned;
  const f = fixture(t, {
    intercept(command, args) {
      if (command === "security" && args[0] === "create-keychain")
        canonicalOwned = realpathSync(args.at(-1));
      const registered = f.searchList.includes(canonicalOwned);
      if (command === "codesign" && args[0] === "--force" && !registered)
        throw new Error(`codesign failed (1).\n${secret}: no identity found`);
      if (
        command === "codesign" &&
        args[0] === "--verify" &&
        registered &&
        !concurrent
      ) {
        concurrent = dirname(f.searchList[0]) + "/./concurrent-private-entry";
        f.searchList.push(concurrent);
      }
    },
  });
  const others = [
    f.searchList[0],
    join(dirname(f.searchList[0]), "foreign", "signing.keychain-db"),
    join(dirname(f.searchList[0]), "second-private-entry"),
  ];
  f.searchList.push(...others.slice(1));
  const report = await f.check({
    environment: { ...f.environment, ...hosted },
    probeSearchList: true,
  });
  assert.equal(report.status, "failed");
  assert.equal(report.code, "signing-probe-failed");
  assert.equal(report.keychain.inSearchList, false);
  assert.ok(
    report.attempts.every((attempt) => attempt.reason === "identity-not-found"),
  );
  assert.equal(report.searchListProbe.status, "passed");
  assert.equal(report.searchListProbe.registered, true);
  assert.ok(
    report.searchListProbe.attempts.every(
      (attempt) => attempt.status === "passed",
    ),
  );
  assert.equal(report.searchListProbe.removal, "passed");
  assert.deepEqual(report.searchListProbe.cleanup, {
    status: "passed",
    fileAbsent: true,
    entryAbsent: true,
  });
  const writes = f.calls.filter(
    ({ command, args }) =>
      command === "security" &&
      args[0] === "list-keychains" &&
      args.includes("-s"),
  );
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].args.slice(4, -1), others);
  assert.equal(writes[0].args.at(-1), canonicalOwned);
  assert.deepEqual(writes[1].args.slice(4), [...others, concurrent]);
  assert.deepEqual(f.searchList, [...others, concurrent]);
  const firstWrite = f.calls.indexOf(writes[0]);
  assert.equal(
    f.calls.slice(0, firstWrite).filter(({ command }) => command === "codesign")
      .length,
    2,
  );
  assert.equal(writes[1].options.signal, undefined);
});

test("CLI flag runs the experiment but returns one when only the registered treatment succeeds", async (t) => {
  const output = [];
  t.mock.method(console, "log", (line) => output.push(line));
  const f = fixture(t, {
    intercept(command, args) {
      if (
        command === "codesign" &&
        args[0] === "--force" &&
        !f.searchList.some((path) => path.endsWith("signing.keychain-db"))
      )
        throw new Error(`codesign failed (1).\n${secret}: no identity found`);
    },
  });
  const code = await main(["--probe-search-list"], {
    platform: "darwin",
    environment: {
      ...f.environment,
      ...hosted,
      SITUATE_COORDINATED_WORKTREE: root,
    },
    execute: f.execute,
  });
  assert.equal(code, 1);
  const report = JSON.parse(output[0]);
  assert.equal(report.status, "failed");
  assert.equal(report.searchListProbe.status, "passed");
  assert.ok(!output.join("").includes(secret));
  for (const file of f.files) assert.equal(existsSync(file), false);
});

for (const failure of ["registration-write", "registration-confirmation"]) {
  test(`registration failure is nonpassing and cleans from the first mutation attempt: ${failure}`, async (t) => {
    let writes = 0;
    const f = fixture(t, {
      intercept(command, args) {
        if (
          command === "security" &&
          args[0] === "list-keychains" &&
          args.includes("-s") &&
          ++writes === 1
        ) {
          if (failure === "registration-write") {
            f.searchList.splice(0, f.searchList.length, ...args.slice(4));
            throw new Error(secret);
          }
          return "";
        }
      },
    });
    const original = [...f.searchList];
    const report = await f.check({
      environment: { ...f.environment, ...hosted },
      probeSearchList: true,
    });
    assert.equal(report.status, "failed");
    assert.equal(report.searchListProbe.code, "registration-failed");
    assert.equal(report.searchListProbe.removal, "passed");
    assert.deepEqual(report.searchListProbe.attempts, []);
    assert.deepEqual(report.searchListProbe.cleanup, {
      status: "passed",
      fileAbsent: true,
      entryAbsent: true,
    });
    assert.deepEqual(f.searchList, original);
  });
}

for (const at of ["registration", "registered-sign"]) {
  test(`cancellation during ${at} still removes only the owned entry with non-aborted cleanup commands`, async (t) => {
    const abort = new AbortController();
    let cancelled = false;
    const f = fixture(t, {
      intercept(command, args, options) {
        if (cancelled && command === "security")
          assert.equal(options.signal, undefined);
        const mutation =
          command === "security" &&
          args[0] === "list-keychains" &&
          args.includes("-s");
        const registeredSign =
          command === "codesign" &&
          f.searchList.some((path) => path.endsWith("signing.keychain-db"));
        if (
          !cancelled &&
          ((at === "registration" && mutation) ||
            (at === "registered-sign" && registeredSign))
        ) {
          if (mutation)
            f.searchList.splice(0, f.searchList.length, ...args.slice(4));
          cancelled = true;
          abort.abort(new Error(secret));
          throw new Error(secret);
        }
      },
    });
    const original = [...f.searchList];
    const report = await f.check({
      environment: { ...f.environment, ...hosted },
      probeSearchList: true,
      signal: abort.signal,
    });
    assert.equal(report.status, "cancelled");
    assert.equal(report.searchListProbe.status, "cancelled");
    assert.equal(report.searchListProbe.removal, "passed");
    assert.deepEqual(report.searchListProbe.cleanup, {
      status: "passed",
      fileAbsent: true,
      entryAbsent: true,
    });
    assert.deepEqual(f.searchList, original);
  });
}

for (const failure of [
  "removal-write",
  "removal-confirmation",
  "fallback-delete",
  "stale-entry",
  "post-delete-read",
]) {
  test(`cleanup failures and unknown post-deletion state cannot report success: ${failure}`, async (t) => {
    let writes = 0;
    let deleted = false;
    const f = fixture(t, {
      intercept(command, args) {
        if (command === "security" && args[0] === "list-keychains") {
          if (deleted && failure === "post-delete-read")
            throw new Error(secret);
          if (
            args.includes("-s") &&
            ++writes === 2 &&
            failure !== "post-delete-read"
          ) {
            if (failure === "removal-confirmation") return "";
            throw new Error(secret);
          }
        }
        if (command === "security" && args[0] === "delete-keychain") {
          deleted = true;
          if (failure === "fallback-delete") throw new Error(secret);
          if (failure === "stale-entry") return "";
        }
      },
    });
    const report = await f.check({
      environment: { ...f.environment, ...hosted },
      probeSearchList: true,
    });
    assert.equal(report.status, "failed");
    assert.equal(report.searchListProbe.status, "failed");
    assert.ok(report.attempts.every((attempt) => attempt.status === "passed"));
    assert.ok(
      report.searchListProbe.attempts.every(
        (attempt) => attempt.status === "passed",
      ),
    );
    const cleanup = report.searchListProbe.cleanup;
    if (failure === "post-delete-read") {
      assert.equal(cleanup.status, "unknown");
      assert.equal(cleanup.entryAbsent, null);
      assert.equal(cleanup.fileAbsent, true);
    } else if (failure === "fallback-delete") {
      assert.deepEqual(cleanup, {
        status: "failed",
        fileAbsent: false,
        entryAbsent: false,
      });
    } else if (failure === "stale-entry") {
      assert.deepEqual(cleanup, {
        status: "failed",
        fileAbsent: true,
        entryAbsent: false,
      });
    } else {
      assert.equal(
        report.searchListProbe.removal,
        failure === "removal-confirmation" ? "failed" : "unknown",
      );
      assert.deepEqual(cleanup, {
        status: "passed",
        fileAbsent: true,
        entryAbsent: true,
      });
    }
  });
}

test("CLI abort handlers remain installed through registered-phase removal and post-deletion checks", async (t) => {
  const output = [];
  t.mock.method(console, "log", (line) => output.push(line));
  const previous = process.listenerCount("SIGTERM");
  let cancelled = false;
  const f = fixture(t, {
    intercept(command, args, options) {
      if (cancelled && command === "security") {
        assert.equal(process.listenerCount("SIGTERM"), previous + 1);
        assert.equal(options.signal, undefined);
      }
      if (
        !cancelled &&
        command === "codesign" &&
        f.searchList.some((path) => path.endsWith("signing.keychain-db"))
      ) {
        cancelled = true;
        process.emit("SIGTERM");
        process.emit("SIGTERM");
        throw new Error(secret);
      }
    },
  });
  assert.equal(
    await main(["--probe-search-list"], {
      platform: "darwin",
      environment: {
        ...f.environment,
        ...hosted,
        SITUATE_COORDINATED_WORKTREE: root,
      },
      execute: f.execute,
    }),
    130,
  );
  const report = JSON.parse(output[0]);
  assert.equal(report.status, "cancelled");
  assert.equal(report.searchListProbe.removal, "passed");
  assert.equal(report.searchListProbe.cleanup.status, "passed");
  assert.ok(!output.join("").includes(secret));
  for (const file of f.files) assert.equal(existsSync(file), false);
  assert.equal(process.listenerCount("SIGTERM"), previous);
});

test("setup failure before the callback still checks the owned file and entry after deletion", async (t) => {
  const f = fixture(t, {
    intercept(_command, args) {
      if (args[0] === "import") throw new Error(secret);
    },
  });
  const report = await f.check({
    environment: { ...f.environment, ...hosted },
    probeSearchList: true,
  });
  assert.equal(report.status, "failed");
  assert.equal(report.code, "probe-failed");
  assert.deepEqual(report.searchListProbe.cleanup, {
    status: "passed",
    fileAbsent: true,
    entryAbsent: true,
  });
});

test("failure before any keychain path is known does not claim successful cleanup", async (t) => {
  const f = fixture(t);
  const report = await f.check({
    environment: {
      ...f.environment,
      ...hosted,
      APPLE_DEVELOPER_ID_P12_BASE64: "!",
    },
    probeSearchList: true,
  });
  assert.equal(report.status, "failed");
  assert.equal(report.code, "keychain-cleanup-unverified");
  assert.deepEqual(report.searchListProbe.cleanup, {
    status: "unknown",
    fileAbsent: null,
    entryAbsent: null,
  });
  assert.equal(f.calls.length, 0);
});
