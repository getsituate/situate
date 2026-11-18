import { createPrivateKey, randomBytes } from "node:crypto";
import { run } from "./ios-xcode.mjs";
import {
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readPrivateDotenv } from "./private-dotenv.mjs";

const names = [
  "APPLE_API_KEY",
  "APPLE_API_ISSUER",
  "APPLE_API_PRIVATE_KEY",
  "APPLE_APP_ID",
];
const maximumCertificateBytes = 1024 * 1024;
const certificateNames = [
  "APPLE_DEVELOPER_ID_P12_BASE64",
  "APPLE_DEVELOPER_ID_P12_FILE",
  "APPLE_DEVELOPER_ID_P12_PASSWORD",
];

export function readAppleEnv(root, selectedNames = names) {
  return readPrivateDotenv(resolve(root, "../.env"), selectedNames);
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
        const cleanup = new Error(
          "Temporary Developer ID certificate cleanup failed.",
        );
        failure = failed
          ? new AggregateError([failure, cleanup], cleanup.message, {
              cause: failure,
            })
          : cleanup;
        failed = true;
      }
    }
  }
  if (failed) throw failure;
  return result;
}

export function isHostedSigningEnvironment(environment) {
  return (
    environment?.CI === "true" &&
    environment?.GITHUB_ACTIONS === "true" &&
    environment?.RUNNER_ENVIRONMENT === "github-hosted"
  );
}

// Deleted keychains still need canonical matching in the final search-list check.
function canonicalKeychainPath(path) {
  const suffix = [];
  let current = resolve(path);
  while (true) {
    try {
      return join(realpathSync(current), ...suffix);
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR"].includes(error.code) ||
        dirname(current) === current
      )
        throw error;
      suffix.unshift(basename(current));
      current = dirname(current);
    }
  }
}

async function signingSearchList(execute, options) {
  const output = await execute(
    "security",
    ["list-keychains", "-d", "user"],
    options,
  );
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const path = JSON.parse(line.trim());
      if (typeof path !== "string" || !isAbsolute(path))
        throw new Error("Invalid keychain search list.");
      return path;
    });
}

export async function withSigningKeychain(options, use) {
  if (
    Object.hasOwn(options, "registerSearchList") &&
    typeof options.registerSearchList !== "boolean"
  )
    throw new Error(
      "Signing keychain search-list registration must be a boolean.",
    );
  if (
    options.registerSearchList &&
    !isHostedSigningEnvironment(options.environment ?? process.env)
  )
    throw new Error(
      "Signing keychain search-list registration requires GitHub-hosted CI.",
    );
  if (options.registerSearchList) options.signal?.throwIfAborted();
  return withSigningCertificate(options, (environment) =>
    withPreparedSigningKeychain({ ...options, environment }, use),
  );
}

async function withPreparedSigningKeychain(
  { environment, execute = run, signal, registerSearchList = false },
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
  let deleteRequired = false;
  let registrationAttempted = false;
  let canonicalKeychain;
  let result;
  let failure;
  const isOwned = (path) => canonicalKeychainPath(path) === canonicalKeychain;
  const cleanupOptions = { ...options, signal: undefined };
  try {
    // Command failures must not expose security's arguments or private input.
    try {
      if (registerSearchList) {
        canonicalKeychain = canonicalKeychainPath(keychain);
        deleteRequired = true;
      }
      await execute(
        "security",
        ["create-keychain", "-p", password, keychain],
        options,
      );
      deleteRequired = true;
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
    if (registerSearchList) {
      try {
        const current = await signingSearchList(execute, options);
        const registered = current.some(isOwned)
          ? current
          : [...current, canonicalKeychain];
        registrationAttempted = true;
        await execute(
          "security",
          ["list-keychains", "-d", "user", "-s", ...registered],
          options,
        );
        if (!(await signingSearchList(execute, options)).some(isOwned))
          throw new Error("Registration unconfirmed.");
      } catch {
        throw new Error(
          "Temporary signing keychain search-list registration failed.",
        );
      }
    }
    if (registerSearchList) signal?.throwIfAborted();
    result = await use(keychain);
    if (registerSearchList) signal?.throwIfAborted();
  } catch (error) {
    failure = { error };
  }
  const cleanupFailures = [];
  if (registerSearchList && (deleteRequired || registrationAttempted)) {
    try {
      const current = await signingSearchList(execute, cleanupOptions);
      const remaining = current.filter((path) => !isOwned(path));
      if (remaining.length !== current.length)
        await execute(
          "security",
          ["list-keychains", "-d", "user", "-s", ...remaining],
          cleanupOptions,
        );
      if ((await signingSearchList(execute, cleanupOptions)).some(isOwned))
        throw new Error("Removal unconfirmed.");
    } catch {
      cleanupFailures.push(
        new Error("Temporary signing keychain search-list cleanup failed."),
      );
    }
  }
  try {
    if (deleteRequired)
      await execute("security", ["delete-keychain", keychain], cleanupOptions);
  } catch {
    cleanupFailures.push(
      new Error("Temporary signing keychain deletion failed."),
    );
  }
  if (registerSearchList) {
    try {
      let absent = false;
      try {
        lstatSync(keychain);
      } catch (error) {
        if (error.code === "ENOENT") absent = true;
        else throw error;
      }
      if (!absent) throw new Error("Keychain still present.");
    } catch {
      cleanupFailures.push(
        new Error(
          "Temporary signing keychain file cleanup could not be verified.",
        ),
      );
    }
    try {
      if (
        !canonicalKeychain ||
        (await signingSearchList(execute, cleanupOptions)).some(isOwned)
      )
        throw new Error("Keychain search-list absence unconfirmed.");
    } catch {
      cleanupFailures.push(
        new Error(
          "Temporary signing keychain search-list absence could not be verified.",
        ),
      );
    }
  }
  if (!cleanupFailures.length) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      cleanupFailures.push(
        new Error("Temporary signing keychain directory cleanup failed."),
      );
    }
  }
  if (cleanupFailures.length) {
    throw new AggregateError(
      failure ? [failure.error, ...cleanupFailures] : cleanupFailures,
      "Temporary signing keychain cleanup failed; inspect the private signing temporary directory before retrying.",
      { cause: failure?.error },
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
