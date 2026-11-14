import { createPrivateKey, randomBytes } from "node:crypto";
import { run } from "./ios-xcode.mjs";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

const names = [
  "APPLE_API_KEY",
  "APPLE_API_ISSUER",
  "APPLE_API_PRIVATE_KEY",
  "APPLE_APP_ID",
];
const maximumBytes = 2 * 1024 * 1024;
const maximumCertificateBytes = 1024 * 1024;
const certificateNames = [
  "APPLE_DEVELOPER_ID_P12_BASE64",
  "APPLE_DEVELOPER_ID_P12_FILE",
  "APPLE_DEVELOPER_ID_P12_PASSWORD",
];

function validateEnvFile(stat) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > maximumBytes ||
    (typeof process.getuid === "function" &&
      ((stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid()))
  )
    throw new Error(
      "Repository-root .env must be an owned, private regular file (chmod 600), without links, no larger than 2 MiB.",
    );
}

export function readAppleEnv(root, selectedNames = names) {
  const path = resolve(root, "../.env");
  let handle;
  try {
    let before;
    try {
      before = lstatSync(path);
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
    validateEnvFile(before);
    handle = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(handle);
    validateEnvFile(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw new Error("Repository-root .env changed while opening it.");
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(
        handle,
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!count) break;
      length += count;
    }
    const after = fstatSync(handle);
    const current = lstatSync(path);
    validateEnvFile(after);
    validateEnvFile(current);
    if (
      length > maximumBytes ||
      length !== after.size ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new Error("Repository-root .env changed while reading it.");
    const parsed = parseEnv(buffer.subarray(0, length).toString("utf8"));
    return Object.fromEntries(
      selectedNames
        .filter((key) => Object.hasOwn(parsed, key))
        .map((key) => [key, parsed[key]]),
    );
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

export function loadAppleCredentials({
  root,
  environment = process.env,
  upload = false,
}) {
  const required = upload ? names : names.slice(0, 3);
  const local =
    environment.CI === "true" ||
    required.every((key) => Object.hasOwn(environment, key))
      ? {}
      : readAppleEnv(root);
  return Object.fromEntries(
    required
      .filter(
        (key) => Object.hasOwn(environment, key) || Object.hasOwn(local, key),
      )
      .map((key) => [
        key,
        Object.hasOwn(environment, key) ? environment[key] : local[key],
      ]),
  );
}

export async function withAppleCredentials(
  { root, settings, environment = process.env, upload = false },
  use,
) {
  const credentials = loadAppleCredentials({ root, environment, upload });
  if (
    !names.some((name) => Object.hasOwn(credentials, name)) &&
    environment.CI !== "true"
  )
    return use(settings);
  const keyId = credentials.APPLE_API_KEY;
  const issuerId = credentials.APPLE_API_ISSUER;
  const privateKey = credentials.APPLE_API_PRIVATE_KEY;
  const appId = credentials.APPLE_APP_ID;
  if (
    !/^[A-Z0-9]{10,}$/.test(keyId ?? "") ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(issuerId ?? "") ||
    typeof privateKey !== "string" ||
    !privateKey.trim() ||
    Buffer.byteLength(privateKey) > 16384
  )
    throw new Error(
      "Set APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_PRIVATE_KEY in the repository-root .env or environment. No other credential source will be used for incomplete values.",
    );
  if (upload && !/^[1-9][0-9]+$/.test(appId ?? ""))
    throw new Error(
      "Set APPLE_APP_ID to the numeric iOS app-record ID before uploading.",
    );
  let valid = false;
  try {
    const key = createPrivateKey({
      key: privateKey,
      format: "pem",
      type: "pkcs8",
    });
    valid =
      key.asymmetricKeyType === "ec" &&
      key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    // Parser diagnostics can contain private input; do not expose them.
  }
  if (!valid)
    throw new Error(
      "APPLE_API_PRIVATE_KEY must contain an Apple P-256 .p8 private key.",
    );
  const directory = mkdtempSync(join(tmpdir(), "situate-apple-key-"));
  const path = join(directory, `AuthKey_${keyId}.p8`);
  try {
    writeFileSync(path, privateKey, { flag: "wx", mode: 0o600 });
    return await use({
      ...settings,
      appleApiKey: { keyId, issuerId, path },
      ...(upload
        ? {
            appStoreConnect: {
              appId,
              apiKeyId: keyId,
              apiIssuerId: issuerId,
              apiKeyPath: path,
            },
          }
        : {}),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function withSigningCertificate(
  { root, environment = process.env },
  use,
) {
  const [base64Name, fileName, passwordName] = certificateNames;
  const hasCertificate = [base64Name, fileName].some((name) =>
    Object.hasOwn(environment, name),
  );
  const local =
    environment.CI === "true" ||
    (hasCertificate && Object.hasOwn(environment, passwordName))
      ? {}
      : readAppleEnv(root, certificateNames);
  const source = hasCertificate ? environment : local;
  const encoded = source[base64Name];
  let certificate = source[fileName];
  const password = Object.hasOwn(environment, passwordName)
    ? environment[passwordName]
    : local[passwordName];
  if (encoded && certificate)
    throw new Error(
      "Set only one of APPLE_DEVELOPER_ID_P12_BASE64 or APPLE_DEVELOPER_ID_P12_FILE.",
    );
  if ((!encoded && !certificate) || typeof password !== "string")
    throw new Error(
      "Signing requires APPLE_DEVELOPER_ID_P12_BASE64 or APPLE_DEVELOPER_ID_P12_FILE, and APPLE_DEVELOPER_ID_P12_PASSWORD.",
    );
  let bytes;
  if (encoded) {
    if (
      typeof encoded !== "string" ||
      encoded.length > 4 * Math.ceil(maximumCertificateBytes / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      )
    )
      throw new Error(
        "APPLE_DEVELOPER_ID_P12_BASE64 must be canonical base64 containing 1 byte to 1 MiB.",
      );
    bytes = Buffer.from(encoded, "base64");
    if (
      !bytes.length ||
      bytes.length > maximumCertificateBytes ||
      bytes.toString("base64") !== encoded
    )
      throw new Error(
        "APPLE_DEVELOPER_ID_P12_BASE64 must be canonical base64 containing 1 byte to 1 MiB.",
      );
  } else {
    let valid = false;
    try {
      const stat = lstatSync(certificate);
      valid =
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        (typeof process.getuid !== "function" ||
          (stat.uid === process.getuid() && (stat.mode & 0o077) === 0));
    } catch {
      // File-system diagnostics can contain private certificate paths.
    }
    if (!valid)
      throw new Error(
        "Developer ID certificate must be an owned private regular file without links.",
      );
  }
  let directory, result, failure;
  let failed = false;
  try {
    if (bytes) {
      try {
        directory = mkdtempSync(join(tmpdir(), "situate-certificate-"));
        certificate = join(directory, "developer-id.p12");
        writeFileSync(certificate, bytes, { flag: "wx", mode: 0o600 });
      } catch {
        throw new Error(
          "Temporary Developer ID certificate preparation failed.",
        );
      }
    }
    const prepared = {
      ...environment,
      [fileName]: certificate,
      [passwordName]: password,
    };
    delete prepared[base64Name];
    result = await use(prepared);
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    if (directory) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        failure = new Error(
          "Temporary Developer ID certificate cleanup failed.",
        );
        failed = true;
      }
    }
  }
  if (failed) throw failure;
  return result;
}

export async function withSigningKeychain(options, use) {
  return withSigningCertificate(options, (environment) =>
    withPreparedSigningKeychain({ ...options, environment }, use),
  );
}

async function withPreparedSigningKeychain(
  { environment, execute = run, signal },
  use,
) {
  const certificate = environment.APPLE_DEVELOPER_ID_P12_FILE;
  const certificatePassword = environment.APPLE_DEVELOPER_ID_P12_PASSWORD;
  const directory = mkdtempSync(join(tmpdir(), "situate-signing-"));
  const keychain = join(directory, "signing.keychain-db");
  const password = randomBytes(32).toString("hex");
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME"]
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
  const options = { env, signal, capture: true };
  let created = false;
  let result;
  let failure;
  try {
    // Command failures must not expose security's arguments or private input.
    try {
      await execute(
        "security",
        ["create-keychain", "-p", password, keychain],
        options,
      );
      created = true;
      await execute(
        "security",
        ["set-keychain-settings", "-lut", "21600", keychain],
        options,
      );
      await execute(
        "security",
        ["unlock-keychain", "-p", password, keychain],
        options,
      );
      await execute(
        "security",
        [
          "import",
          certificate,
          "-k",
          keychain,
          "-P",
          certificatePassword,
          "-T",
          "/usr/bin/codesign",
          "-T",
          "/usr/bin/security",
        ],
        options,
      );
      await execute(
        "security",
        [
          "set-key-partition-list",
          "-S",
          "apple-tool:,apple:,codesign:",
          "-s",
          "-k",
          password,
          keychain,
        ],
        options,
      );
    } catch {
      throw new Error("Temporary Developer ID keychain setup failed.");
    }
    result = await use(keychain);
  } catch (error) {
    failure = { error };
  }
  try {
    if (created)
      await execute("security", ["delete-keychain", keychain], {
        ...options,
        signal: undefined,
      });
    rmSync(directory, { recursive: true, force: true });
  } catch {
    throw new Error(
      "Temporary signing keychain cleanup failed; inspect the private signing temporary directory before retrying.",
    );
  }
  if (failure) throw failure.error;
  return result;
}

export function notaryAuthentication(settings) {
  if (settings.appleApiKey) {
    const { keyId, issuerId, path } = settings.appleApiKey;
    return ["--key", path, "--key-id", keyId, "--issuer", issuerId];
  }
  return ["--keychain-profile", settings.notaryProfile];
}
