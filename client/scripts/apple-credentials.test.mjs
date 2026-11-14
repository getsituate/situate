import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applePosixFixture } from "./apple-posix-fixture.mjs";
import {
  loadAppleCredentials,
  notaryAuthentication,
  readAppleEnv,
  withAppleCredentials,
  withSigningKeychain,
  withSigningCertificate,
} from "./apple-credentials.mjs";

const { privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credentials = {
  APPLE_API_KEY: "EXAMPLE1234",
  APPLE_API_ISSUER: "11111111-2222-3333-4444-555555555555",
  APPLE_API_PRIVATE_KEY: privateKey,
  APPLE_APP_ID: "1234567890",
};

function fixture(t, content) {
  applePosixFixture(t);
  const directory = mkdtempSync(join(tmpdir(), "situate-apple-env-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "client");
  mkdirSync(root);
  const path = join(directory, ".env");
  if (content !== undefined) writeFileSync(path, content, { mode: 0o600 });
  return { root, path, directory };
}

function dotenv(values = credentials) {
  return Object.entries(values)
    .map(([key, value]) => `${key}="${value}"\n`)
    .join("");
}

test("reads only supported Apple variables from the repository root, including multiline PEM", (t) => {
  const { root, directory } = fixture(
    t,
    `${dotenv()}OTHER_SECRET=do-not-forward\nUNUSED=$(touch injected)\n`,
  );
  writeFileSync(join(root, ".env"), "APPLE_API_KEY=WRONG\n");
  assert.deepEqual(readAppleEnv(root), credentials);
  assert.ok(!existsSync(join(directory, "injected")));
  assert.equal(process.env.OTHER_SECRET, undefined);
});

test("explicit environment values, including empty ones, override the file", (t) => {
  const { root } = fixture(t, dotenv());
  assert.equal(
    loadAppleCredentials({ root, environment: { APPLE_API_KEY: "" } })
      .APPLE_API_KEY,
    "",
  );
  assert.equal(
    loadAppleCredentials({ root, environment: { APPLE_API_KEY: "OTHERKEY12" } })
      .APPLE_API_KEY,
    "OTHERKEY12",
  );
  assert.equal(
    loadAppleCredentials({ root, environment: {} }).APPLE_APP_ID,
    undefined,
  );
  assert.equal(
    loadAppleCredentials({ root, environment: {}, upload: true }).APPLE_APP_ID,
    "1234567890",
  );
});

test("CI and fully specified environment credentials never read the local file", (t) => {
  const { root, path } = fixture(t, dotenv());
  chmodSync(path, 0o644);
  assert.deepEqual(
    loadAppleCredentials({ root, environment: { CI: "true" } }),
    {},
  );
  assert.deepEqual(
    loadAppleCredentials({
      root,
      environment: { ...credentials, CI: "true" },
      upload: true,
    }),
    credentials,
  );
  assert.deepEqual(
    loadAppleCredentials({ root, environment: credentials, upload: true }),
    credentials,
  );
});

test("rejects insecure permissions, links and oversized credential files", (t) => {
  for (const kind of [
    "permissions",
    "symlink",
    "hardlink",
    "size",
    "directory",
  ]) {
    const { root, path, directory } = fixture(t);
    if (kind === "directory") mkdirSync(path);
    else if (kind === "symlink" || kind === "hardlink") {
      const target = join(directory, "outside.env");
      writeFileSync(target, dotenv(), { mode: 0o600 });
      if (kind === "symlink") symlinkSync(target, path);
      else linkSync(target, path);
    } else
      writeFileSync(
        path,
        kind === "size" ? "x".repeat(2 * 1024 * 1024 + 1) : dotenv(),
        {
          mode: kind === "permissions" ? 0o644 : 0o600,
        },
      );
    assert.throws(() => readAppleEnv(root), /owned, private regular file/);
  }
});

test("rejects credential files owned by another user before and after opening", (t) => {
  const { root } = fixture(t, dotenv());
  for (const method of ["lstatSync", "fstatSync"]) {
    const original = fs[method];
    const mocked = t.mock.method(fs, method, (...args) => {
      const stat = original(...args);
      stat.uid = process.getuid() + 1;
      return stat;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => readAppleEnv(root), /owned, private regular file/);
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
  }
});

test("Windows metadata fixture preserves requested modes and real file contents", (t) => {
  applePosixFixture(t, "win32");
  const { path, root } = fixture(t, "APPLE_API_KEY=EXAMPLE1234\n");
  assert.equal(lstatSync(path).mode & 0o7777, 0o600);
  assert.equal(lstatSync(path).uid, process.getuid());
  assert.equal(readFileSync(path, "utf8"), "APPLE_API_KEY=EXAMPLE1234\n");
  assert.deepEqual(readAppleEnv(root), { APPLE_API_KEY: "EXAMPLE1234" });
  chmodSync(path, 0o644);
  assert.equal(lstatSync(path).mode & 0o7777, 0o644);
  assert.throws(() => readAppleEnv(root), /owned, private regular file/);
  const defaultMode = join(path, "../public-key");
  writeFileSync(defaultMode, "public");
  assert.equal(lstatSync(defaultMode).mode & 0o7777, 0o666);
  const alias = `${defaultMode}.link`;
  linkSync(defaultMode, alias);
  chmodSync(alias, 0o600);
  assert.equal(lstatSync(defaultMode).mode & 0o7777, 0o600);
});

test("Windows metadata fixture preserves missing-path stat behavior", (t) => {
  applePosixFixture(t, "win32");
  const { path } = fixture(t);
  for (const bigint of [false, true]) {
    assert.equal(lstatSync(path, { bigint, throwIfNoEntry: false }), undefined);
    assert.throws(() => lstatSync(path, { bigint }), { code: "ENOENT" });
    assert.throws(() => lstatSync(path, { bigint, throwIfNoEntry: true }), {
      code: "ENOENT",
    });
  }
  assert.throws(() => lstatSync(path), { code: "ENOENT" });
});

test("Windows metadata fixture preserves BigInt stats and copy destinations", (t) => {
  applePosixFixture(t, "win32");
  const { path, directory } = fixture(t, "synthetic private contents");
  const expected = fs.statSync(path, { bigint: true });
  const handle = openSync(path, "r");
  try {
    for (const stat of [
      lstatSync(path, { bigint: true }),
      fstatSync(handle, { bigint: true }),
    ]) {
      assert.equal(stat.mode & 0o7777n, 0o600n);
      assert.equal(stat.uid, BigInt(process.getuid()));
      assert.equal(stat.dev, expected.dev);
      assert.equal(stat.ino, expected.ino);
      assert.equal(stat.size, expected.size);
      assert.equal(stat.nlink, 1n);
      assert.ok(stat.isFile());
      assert.ok(!stat.isSymbolicLink());
    }
  } finally {
    closeSync(handle);
  }
  const destination = join(directory, "copied-key");
  cpSync(path, destination, { filter: () => true });
  assert.equal(readFileSync(destination, "utf8"), "synthetic private contents");
  writeFileSync(path, "updated private contents");
  cpSync(path, destination, { filter: () => true });
  assert.equal(readFileSync(destination, "utf8"), "updated private contents");
});

test("Windows metadata fixture keeps adjacent 64-bit inode modes separate during native copies", (t) => {
  const native = { ...fs };
  const directory = mkdtempSync(join(tmpdir(), "situate-apple-inode-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "client");
  const path = join(directory, ".env");
  mkdirSync(root);
  writeFileSync(path, "APPLE_API_KEY=EXAMPLE1234\n", { mode: 0o600 });
  writeFileSync(join(root, "payload"), "synthetic bundle");
  const key = native.statSync(path, { bigint: true });
  const folder = native.statSync(root, { bigint: true });
  const keyInode = 2n ** 54n;
  const folderInode = keyInode + 1n;
  assert.equal(Number(keyInode), Number(folderInode));
  for (const method of ["statSync", "lstatSync", "fstatSync"]) {
    t.mock.method(fs, method, (entry, options) => {
      const stat = native[method](entry, options);
      if (stat === undefined) return stat;
      const exact = native[method](entry, { bigint: true });
      const inode =
        exact.dev === key.dev && exact.ino === key.ino
          ? keyInode
          : exact.dev === folder.dev && exact.ino === folder.ino
            ? folderInode
            : exact.ino;
      stat.ino = typeof stat.ino === "bigint" ? inode : Number(inode);
      return stat;
    });
  }
  applePosixFixture(t, "win32");
  chmodSync(path, native.statSync(path).mode | 0o644);
  const destination = join(directory, "bundle-copy");
  cpSync(root, destination, { recursive: true, filter: () => true });
  assert.equal(
    readFileSync(join(destination, "payload"), "utf8"),
    "synthetic bundle",
  );
  assert.throws(() => readAppleEnv(root), /owned, private regular file/);
  const alias = join(directory, "key-alias");
  linkSync(path, alias);
  chmodSync(alias, 0o600);
  const handle = openSync(path, "r");
  try {
    for (const bigint of [false, true]) {
      for (const stat of [
        lstatSync(path, { bigint }),
        fstatSync(handle, { bigint }),
      ]) {
        assert.equal(
          Object.getPrototypeOf(stat),
          Object.getPrototypeOf(native.statSync(path, { bigint })),
        );
        assert.equal(stat.ino, bigint ? keyInode : Number(keyInode));
        assert.equal(
          stat.mode & (bigint ? 0o7777n : 0o7777),
          bigint ? 0o600n : 0o600,
        );
        assert.equal(stat.nlink, bigint ? 2n : 2);
        assert.ok(stat.isFile());
      }
      const stat = lstatSync(root, { bigint });
      assert.equal(stat.ino, bigint ? folderInode : Number(folderInode));
      assert.equal(stat.mode, native.statSync(root, { bigint }).mode);
      assert.ok(stat.isDirectory());
    }
  } finally {
    closeSync(handle);
  }
  assert.throws(() => readAppleEnv(root), /owned, private regular file/);
  chmodSync(root, native.statSync(path).mode | 0o111);
  assert.ok(lstatSync(root).isDirectory());
  assert.ok(lstatSync(root, { bigint: true }).isDirectory());
  const missing = join(directory, "missing");
  assert.throws(() => cpSync(missing, destination), { code: "ENOENT" });
  assert.throws(() => chmodSync(missing, 0o600), { code: "ENOENT" });
});

test("missing dotenv leaves explicit existing local authentication unchanged", async (t) => {
  const { root } = fixture(t);
  const settings = { notaryProfile: "chosen-profile" };
  await withAppleCredentials(
    { root, settings, environment: {} },
    async (resolved) => {
      assert.equal(resolved, settings);
      assert.deepEqual(notaryAuthentication(resolved), [
        "--keychain-profile",
        "chosen-profile",
      ]);
    },
  );
});

test("CI rejects missing API environment credentials rather than using local authentication", async (t) => {
  const { root } = fixture(t, dotenv());
  await assert.rejects(
    withAppleCredentials(
      {
        root,
        settings: { notaryProfile: "local-profile" },
        environment: { CI: "true" },
      },
      () => assert.fail("Must not use local credentials"),
    ),
    /APPLE_API_KEY/,
  );
});

test("partial or invalid Apple values do not fall back to a Keychain profile", async (t) => {
  const { root } = fixture(t, dotenv());
  for (const environment of [
    { APPLE_API_KEY: "" },
    { APPLE_API_ISSUER: "invalid" },
    { APPLE_API_PRIVATE_KEY: "sensitive malformed input" },
  ]) {
    await assert.rejects(
      withAppleCredentials(
        { root, settings: { notaryProfile: "old-profile" }, environment },
        () => assert.fail("Must not continue"),
      ),
      (error) => {
        assert.ok(!error.message.includes("sensitive malformed input"));
        return /APPLE_API_/.test(error.message);
      },
    );
  }
});

test("creates an owned private temporary key and removes it after success or failure", async (t) => {
  const { root } = fixture(t, dotenv());
  for (const fail of [false, true]) {
    let keyPath;
    const operation = withAppleCredentials(
      { root, settings: {}, environment: {}, upload: true },
      async (resolved) => {
        keyPath = resolved.appleApiKey.path;
        assert.ok(!keyPath.startsWith(root));
        const stat = lstatSync(keyPath);
        assert.equal(stat.mode & 0o7777, 0o600);
        assert.equal(stat.uid, process.getuid());
        assert.ok(stat.isFile());
        assert.ok(!stat.isSymbolicLink());
        assert.equal(stat.nlink, 1);
        assert.equal(readFileSync(keyPath, "utf8"), privateKey);
        assert.deepEqual(notaryAuthentication(resolved), [
          "--key",
          keyPath,
          "--key-id",
          "EXAMPLE1234",
          "--issuer",
          "11111111-2222-3333-4444-555555555555",
        ]);
        assert.equal(resolved.appStoreConnect.appId, "1234567890");
        assert.equal(resolved.appStoreConnect.apiKeyPath, keyPath);
        assert.ok(!Object.hasOwn(resolved, "APPLE_API_PRIVATE_KEY"));
        if (fail) throw new Error("Operation cancelled");
      },
    );
    if (fail) await assert.rejects(operation, /Operation cancelled/);
    else await operation;
    assert.ok(!existsSync(keyPath));
  }
});

test("numeric App ID is required only when uploading", async (t) => {
  const { root } = fixture(t, dotenv({ ...credentials, APPLE_APP_ID: "" }));
  await withAppleCredentials(
    { root, settings: {}, environment: {} },
    async (settings) => assert.ok(settings.appleApiKey),
  );
  await assert.rejects(
    withAppleCredentials(
      { root, settings: {}, environment: {}, upload: true },
      () => assert.fail("Must not upload"),
    ),
    /APPLE_APP_ID/,
  );
});

const signingBytes = Buffer.from([0, 255, 1, 2, 128, 64]);
const signingCredentials = {
  APPLE_DEVELOPER_ID_P12_BASE64: signingBytes.toString("base64"),
  APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
};

test("local and CI certificates prepare identical private bytes and retain only caller configuration", async (t) => {
  const { root, path } = fixture(
    t,
    dotenv({ ...signingCredentials, UNRELATED_SECRET: "excluded" }),
  );
  for (const environment of [
    { KEEP: "caller" },
    { ...signingCredentials, KEEP: "caller" },
    { ...signingCredentials, CI: "true", KEEP: "caller" },
  ]) {
    if (environment.APPLE_DEVELOPER_ID_P12_BASE64) chmodSync(path, 0o644);
    let certificate;
    const result = await withSigningCertificate(
      { root, environment },
      async (prepared) => {
        certificate = prepared.APPLE_DEVELOPER_ID_P12_FILE;
        assert.deepEqual(readFileSync(certificate), signingBytes);
        assert.equal(lstatSync(certificate).mode & 0o777, 0o600);
        assert.equal(lstatSync(join(certificate, "..")).mode & 0o777, 0o700);
        assert.deepEqual(prepared, {
          KEEP: "caller",
          ...(environment.CI ? { CI: "true" } : {}),
          APPLE_DEVELOPER_ID_P12_FILE: certificate,
          APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
        });
        return "used";
      },
    );
    assert.equal(result, "used");
    assert.ok(!existsSync(join(certificate, "..")));
    assert.equal(environment.APPLE_DEVELOPER_ID_P12_FILE, undefined);
  }
});

test("certificate aliases use a single authoritative layer, including explicit empty values", async (t) => {
  const { root, directory, path } = fixture(t);
  const legacy = join(directory, "legacy.p12");
  writeFileSync(legacy, "legacy bytes", { mode: 0o600 });
  writeFileSync(
    path,
    dotenv({
      APPLE_DEVELOPER_ID_P12_FILE: legacy,
      APPLE_DEVELOPER_ID_P12_PASSWORD: "local-password",
    }),
    { mode: 0o600 },
  );
  await withSigningCertificate(
    {
      root,
      environment: {
        APPLE_DEVELOPER_ID_P12_BASE64:
          signingCredentials.APPLE_DEVELOPER_ID_P12_BASE64,
        APPLE_DEVELOPER_ID_P12_PASSWORD: "",
      },
    },
    async (prepared) => {
      assert.deepEqual(
        readFileSync(prepared.APPLE_DEVELOPER_ID_P12_FILE),
        signingBytes,
      );
      assert.equal(prepared.APPLE_DEVELOPER_ID_P12_PASSWORD, "");
    },
  );
  await withSigningCertificate(
    {
      root,
      environment: {
        APPLE_DEVELOPER_ID_P12_BASE64:
          signingCredentials.APPLE_DEVELOPER_ID_P12_BASE64,
      },
    },
    async (prepared) =>
      assert.equal(prepared.APPLE_DEVELOPER_ID_P12_PASSWORD, "local-password"),
  );
  for (const alias of [
    "APPLE_DEVELOPER_ID_P12_BASE64",
    "APPLE_DEVELOPER_ID_P12_FILE",
  ]) {
    await assert.rejects(
      withSigningCertificate({ root, environment: { [alias]: "" } }, () =>
        assert.fail("empty aliases must not fall back"),
      ),
      /Signing requires/,
    );
  }
  writeFileSync(path, dotenv(signingCredentials));
  await withSigningCertificate(
    { root, environment: { APPLE_DEVELOPER_ID_P12_FILE: legacy } },
    async (prepared) => {
      assert.equal(prepared.APPLE_DEVELOPER_ID_P12_FILE, legacy);
      assert.equal(readFileSync(legacy, "utf8"), "legacy bytes");
    },
  );
  assert.ok(existsSync(legacy));
});

test("missing, malformed, oversized and ambiguous certificate inputs fail before effects without secret diagnostics", async (t) => {
  const { root } = fixture(t, dotenv(signingCredentials));
  const invalid = [
    { CI: "true" },
    { APPLE_DEVELOPER_ID_P12_BASE64: "" },
    ...[
      "private!",
      "Zg",
      "Zh==",
      "Zg==\n",
      "Zg===",
      "-_==",
      Buffer.alloc(1024 * 1024 + 1).toString("base64"),
    ].map((value) => ({ APPLE_DEVELOPER_ID_P12_BASE64: value })),
    { ...signingCredentials, APPLE_DEVELOPER_ID_P12_FILE: "private-file" },
    { APPLE_DEVELOPER_ID_P12_FILE: "private-missing-file" },
  ];
  const calls = [];
  const mocked = t.mock.method(fs, "mkdtempSync", () => {
    calls.push("temporary directory");
    assert.fail("invalid inputs must not create files");
  });
  syncBuiltinESMExports();
  try {
    for (const input of invalid) {
      await assert.rejects(
        withSigningKeychain(
          {
            root,
            environment: {
              APPLE_DEVELOPER_ID_P12_PASSWORD: "private-password",
              ...input,
            },
            execute: async () => calls.push("security"),
          },
          () => calls.push("callback"),
        ),
        (error) => {
          assert.doesNotMatch(
            error.message,
            /private!|private-file|private-missing-file|private-password/,
          );
          return true;
        },
      );
    }
    assert.deepEqual(calls, []);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("ambiguous local aliases are rejected but ignored when environment supplies the certificate", async (t) => {
  const { root } = fixture(
    t,
    dotenv({
      ...signingCredentials,
      APPLE_DEVELOPER_ID_P12_FILE: "synthetic-file",
    }),
  );
  await assert.rejects(
    withSigningCertificate({ root, environment: {} }, () =>
      assert.fail("ambiguous"),
    ),
    /Set only one/,
  );
  await withSigningCertificate(
    {
      root,
      environment: {
        APPLE_DEVELOPER_ID_P12_BASE64:
          signingCredentials.APPLE_DEVELOPER_ID_P12_BASE64,
      },
    },
    async (prepared) => {
      assert.deepEqual(
        readFileSync(prepared.APPLE_DEVELOPER_ID_P12_FILE),
        signingBytes,
      );
    },
  );
});

test("the maximum certificate payload fits the bounded local dotenv reader", async (t) => {
  const bytes = Buffer.alloc(1024 * 1024, 42);
  const { root } = fixture(
    t,
    dotenv({
      ...signingCredentials,
      APPLE_DEVELOPER_ID_P12_BASE64: bytes.toString("base64"),
      OTHER_CONFIG: "x".repeat(65536),
    }),
  );
  await withSigningCertificate({ root, environment: {} }, async (prepared) => {
    assert.deepEqual(readFileSync(prepared.APPLE_DEVELOPER_ID_P12_FILE), bytes);
  });
});

test("materialized certificates are cleaned on callback and write failures", async (t) => {
  const { root } = fixture(t);
  let certificate;
  const failure = new Error("synthetic callback failure");
  await assert.rejects(
    withSigningCertificate(
      { root, environment: signingCredentials },
      async (prepared) => {
        certificate = prepared.APPLE_DEVELOPER_ID_P12_FILE;
        throw failure;
      },
    ),
    (error) => error === failure,
  );
  assert.ok(!existsSync(join(certificate, "..")));
  const mocked = t.mock.method(fs, "writeFileSync", (path, _bytes, options) => {
    certificate = path;
    assert.deepEqual(options, { flag: "wx", mode: 0o600 });
    throw new Error("private write diagnostics");
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      withSigningCertificate({ root, environment: signingCredentials }, () =>
        assert.fail("write failed"),
      ),
      { message: "Temporary Developer ID certificate preparation failed." },
    );
    assert.ok(!existsSync(join(certificate, "..")));
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("certificate cleanup failure is sanitized and never reported as success", async (t) => {
  const { root } = fixture(t);
  let certificate;
  const mocked = t.mock.method(fs, "rmSync", () => {
    throw new Error("private cleanup diagnostics");
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      withSigningCertificate(
        { root, environment: signingCredentials },
        async (prepared) => {
          certificate = prepared.APPLE_DEVELOPER_ID_P12_FILE;
          return "built";
        },
      ),
      { message: "Temporary Developer ID certificate cleanup failed." },
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
    if (certificate)
      rmSync(join(certificate, ".."), { recursive: true, force: true });
  }
});

test("legacy certificate privacy checks and user-file lifetime are preserved", async (t) => {
  for (const kind of [
    "regular",
    "permissions",
    "symlink",
    "hardlink",
    "directory",
    "owner",
  ]) {
    const { root, directory } = fixture(t);
    const certificate = join(directory, "certificate.p12");
    const target = join(directory, "target.p12");
    writeFileSync(target, signingBytes, { mode: 0o600 });
    if (kind === "symlink") symlinkSync(target, certificate);
    else if (kind === "hardlink") linkSync(target, certificate);
    else if (kind === "directory") mkdirSync(certificate);
    else
      writeFileSync(certificate, signingBytes, {
        mode: kind === "permissions" ? 0o644 : 0o600,
      });
    let mocked;
    if (kind === "owner") {
      const original = fs.lstatSync;
      mocked = t.mock.method(fs, "lstatSync", (...args) => {
        const stat = original(...args);
        stat.uid = process.getuid() + 1;
        return stat;
      });
      syncBuiltinESMExports();
    }
    try {
      const operation = withSigningCertificate(
        {
          root,
          environment: {
            APPLE_DEVELOPER_ID_P12_FILE: certificate,
            APPLE_DEVELOPER_ID_P12_PASSWORD: "",
          },
        },
        async (prepared) => {
          assert.equal(prepared.APPLE_DEVELOPER_ID_P12_FILE, certificate);
          throw new Error("callback failure");
        },
      );
      await assert.rejects(
        operation,
        kind === "regular" ? /callback failure/ : /owned private regular file/,
      );
      assert.ok(existsSync(certificate));
    } finally {
      mocked?.mock.restore();
      syncBuiltinESMExports();
    }
  }
});

test("keychain uses the shared materialized certificate and does not decode it again", async (t) => {
  const { root } = fixture(t);
  let certificate;
  await withSigningCertificate(
    {
      root,
      environment: {
        ...signingCredentials,
        CI: "true",
        OTHER_SECRET: "excluded",
      },
    },
    async (environment) => {
      certificate = environment.APPLE_DEVELOPER_ID_P12_FILE;
      await withSigningKeychain(
        {
          root,
          environment,
          execute: async (_command, args, options) => {
            assert.deepEqual(options.env, {});
            if (args[0] === "import") {
              assert.equal(args[1], certificate);
              assert.deepEqual(readFileSync(args[1]), signingBytes);
            }
          },
        },
        async () => "built",
      );
      assert.ok(existsSync(certificate));
    },
  );
  assert.ok(!existsSync(certificate));
  await withSigningKeychain(
    {
      root,
      environment: signingCredentials,
      execute: async (_command, args) => {
        if (args[0] === "import") {
          certificate = args[1];
          assert.deepEqual(readFileSync(certificate), signingBytes);
        }
      },
    },
    async () => "built",
  );
  assert.ok(!existsSync(certificate));
});

test("keychain cleanup failure still removes the materialized certificate", async (t) => {
  const { root } = fixture(t);
  let certificate;
  let keychain;
  try {
    await assert.rejects(
      withSigningKeychain(
        {
          root,
          environment: signingCredentials,
          execute: async (_command, args) => {
            if (args[0] === "import") certificate = args[1];
            if (args[0] === "delete-keychain") {
              keychain = args[1];
              throw new Error("synthetic cleanup failure");
            }
          },
        },
        async () => "built",
      ),
      /keychain cleanup failed/,
    );
    assert.ok(!existsSync(certificate));
  } finally {
    if (keychain)
      rmSync(join(keychain, ".."), { recursive: true, force: true });
  }
});

test("Developer ID import is isolated, operation-scoped and cleaned after callback failure", async (t) => {
  const { root, directory } = fixture(t);
  const certificate = join(directory, "synthetic.p12");
  writeFileSync(certificate, "synthetic certificate", { mode: 0o600 });
  const calls = [];
  let keychain;
  await assert.rejects(
    withSigningKeychain(
      {
        root,
        environment: {
          PATH: "/usr/bin",
          HOME: directory,
          CI: "true",
          APPLE_DEVELOPER_ID_P12_FILE: certificate,
          APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-pass",
          OTHER_SECRET: "excluded",
        },
        execute: async (command, args, options) => {
          calls.push({ command, args, options });
          assert.equal(options.env.OTHER_SECRET, undefined);
          return "";
        },
      },
      async (path) => {
        keychain = path;
        throw new Error("synthetic build failure");
      },
    ),
    /synthetic build failure/,
  );
  assert.ok(keychain.includes("situate-signing-"));
  assert.equal(calls[0].args[0], "create-keychain");
  assert.equal(calls.at(-1).args[0], "delete-keychain");
  assert.equal(calls.at(-1).args[1], keychain);
  assert.equal(calls.at(-1).options.signal, undefined);
  assert.ok(
    !calls.some(({ args }) =>
      ["default-keychain", "list-keychains"].includes(args[0]),
    ),
  );
  assert.ok(!existsSync(join(keychain, "..")));
});

test("Developer ID setup errors do not leak arguments and cleanup never reports success on failure", async (t) => {
  const { root, directory } = fixture(t);
  const certificate = join(directory, "synthetic.p12");
  writeFileSync(certificate, "synthetic certificate", { mode: 0o600 });
  const options = {
    root,
    environment: {
      CI: "true",
      APPLE_DEVELOPER_ID_P12_FILE: certificate,
      APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-pass",
    },
  };
  await assert.rejects(
    withSigningKeychain(
      {
        ...options,
        execute: async (_command, args) => {
          if (args[0] === "import") throw new Error("synthetic-pass PRIVATE");
        },
      },
      () => assert.fail("must not build"),
    ),
    (error) =>
      error.message === "Temporary Developer ID keychain setup failed.",
  );
  await assert.rejects(
    withSigningKeychain(
      {
        ...options,
        execute: async (_command, args) => {
          if (args[0] === "delete-keychain")
            throw new Error("synthetic-pass PRIVATE");
        },
      },
      () => "built",
    ),
    /cleanup failed/,
  );
});
