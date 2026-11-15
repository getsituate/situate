import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  readAppleEnv,
  withSigningKeychain,
} from "../client/scripts/apple-credentials.mjs";
import { run } from "../client/scripts/ios-xcode.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

const directory = fileURLToPath(new URL("../", import.meta.url));
const client = join(directory, "client");
const baseNames = [
  "PATH",
  "HOME",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "CI",
];
const signingNames = [
  "APPLE_TEAM_ID",
  "APPLE_MACOS_SIGNING_IDENTITY",
  "APPLE_DEVELOPER_ID_P12_BASE64",
  "APPLE_DEVELOPER_ID_P12_FILE",
  "APPLE_DEVELOPER_ID_P12_PASSWORD",
];
const select = (environment, names) =>
  Object.fromEntries(
    names
      .filter((name) => Object.hasOwn(environment, name))
      .map((name) => [name, environment[name]]),
  );
export function signingEnvironment(environment = process.env) {
  return select(environment, [
    ...baseNames,
    ...signingNames,
    "SITUATE_COORDINATED_WORKTREE",
  ]);
}

const errorCode = (error) => {
  if (
    Number.isInteger(error?.code) &&
    error.code >= -2147483648 &&
    error.code <= 2147483647
  )
    return error.code;
  const status =
    typeof error?.message === "string"
      ? error.message.match(/^codesign failed \(([0-9]{1,3})\)\./)
      : null;
  return status && Number(status[1]) <= 255 ? Number(status[1]) : null;
};

function attemptReason(error, stage) {
  if (stage === "verify") return "verification-failed";
  const message = typeof error?.message === "string" ? error.message : "";
  if (/no identity found/i.test(message)) return "identity-not-found";
  if (/errSecInternalComponent/i.test(message))
    return "security-component-error";
  if (
    /user interaction (?:is )?not allowed|denied|errSecAuthFailed|errSecInteractionNotAllowed/i.test(
      message,
    )
  )
    return "authorization-denied";
  return "other-redacted-error";
}

const keychainStatus = `
import ctypes, json, sys
security = ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
core = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
security.SecKeychainOpen.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
security.SecKeychainOpen.restype = ctypes.c_int32
security.SecKeychainGetStatus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
security.SecKeychainGetStatus.restype = ctypes.c_int32
core.CFRelease.argtypes = [ctypes.c_void_p]
core.CFRelease.restype = None
keychain = ctypes.c_void_p()
status = ctypes.c_uint32()
code = security.SecKeychainOpen(sys.argv[1].encode(), ctypes.byref(keychain))
try:
    if code == 0:
        code = security.SecKeychainGetStatus(keychain, ctypes.byref(status))
    print(json.dumps({'code': code, 'unlocked': bool(status.value & 1) if code == 0 else None}))
finally:
    if keychain.value:
        core.CFRelease(keychain)
`;

export async function checkSigning({
  root = client,
  environment = process.env,
  platform = process.platform,
  execute = run,
  signal,
} = {}) {
  const report = {
    version: 1,
    status: "failed",
    stage: "inputs",
    code: "probe-failed",
    attempts: [],
  };
  let temporary;
  try {
    if (platform !== "darwin") {
      report.status = "blocked";
      report.code = "macos-required";
      return report;
    }
    signal?.throwIfAborted();
    const selected = select(environment, [...baseNames, ...signingNames]);
    const needsLocal =
      !Object.hasOwn(selected, "APPLE_TEAM_ID") ||
      !Object.hasOwn(selected, "APPLE_MACOS_SIGNING_IDENTITY") ||
      !["APPLE_DEVELOPER_ID_P12_BASE64", "APPLE_DEVELOPER_ID_P12_FILE"].some(
        (key) => Object.hasOwn(selected, key),
      ) ||
      !Object.hasOwn(selected, "APPLE_DEVELOPER_ID_P12_PASSWORD");
    const local =
      selected.CI !== "true" && needsLocal
        ? readAppleEnv(root, signingNames)
        : {};
    if (
      ["APPLE_DEVELOPER_ID_P12_BASE64", "APPLE_DEVELOPER_ID_P12_FILE"].some(
        (key) => Object.hasOwn(selected, key),
      )
    ) {
      delete local.APPLE_DEVELOPER_ID_P12_BASE64;
      delete local.APPLE_DEVELOPER_ID_P12_FILE;
    }
    const env = { ...local, ...selected };
    const selector = env.APPLE_MACOS_SIGNING_IDENTITY;
    if (
      !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? "") ||
      typeof selector !== "string" ||
      !selector.trim() ||
      selector === "-" ||
      selector.length > 1024 ||
      [...selector].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      ![
        env.APPLE_DEVELOPER_ID_P12_BASE64,
        env.APPLE_DEVELOPER_ID_P12_FILE,
      ].some(Boolean) ||
      typeof env.APPLE_DEVELOPER_ID_P12_PASSWORD !== "string"
    ) {
      report.code = "invalid-signing-inputs";
      return report;
    }
    const options = { env: select(env, baseNames), signal, capture: true };
    temporary = mkdtempSync(join(tmpdir(), "situate-signing-probe-"));
    report.stage = "keychain";
    await withSigningKeychain(
      { root, environment: env, execute, signal },
      async (keychain) => {
        report.stage = "observations";
        report.keychain = { filePresent: existsSync(keychain) };
        const status = JSON.parse(
          await execute("python3", ["-c", keychainStatus, keychain], options),
        );
        if (
          errorCode({ code: status.code }) === null ||
          (status.code === 0 && typeof status.unlocked !== "boolean")
        )
          throw new Error("invalid-status");
        const search = await execute(
          "security",
          ["list-keychains", "-d", "user"],
          options,
        );
        const canonicalKeychain = report.keychain.filePresent
          ? realpathSync(keychain)
          : null;
        const inSearchList = search
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .some((line) => {
            const path = JSON.parse(line.trim());
            if (typeof path !== "string")
              throw new Error("invalid-search-list");
            try {
              return realpathSync(path) === canonicalKeychain;
            } catch {
              return false;
            }
          });
        Object.assign(report.keychain, {
          unlocked: status.code === 0 ? status.unlocked : null,
          statusCode: status.code,
          inSearchList,
          selectorKind: /^[A-Fa-f0-9]{40}$/.test(selector) ? "sha1" : "name",
        });
        report.stage = "identities";
        const identities = await execute(
          "security",
          ["find-identity", "-v", "-p", "codesigning", keychain],
          options,
        );
        const valid = [
          ...identities.matchAll(
            /^\s*\d+\) ([A-Fa-f0-9]{40}) "([^"\r\n]+)"\s*$/gm,
          ),
        ];
        const matching = valid.filter(
          ([, hash, name]) =>
            (hash === selector || name === selector) &&
            name.startsWith("Developer ID Application:") &&
            name.endsWith(`(${env.APPLE_TEAM_ID})`),
        );
        report.keychain.validIdentities = Math.min(valid.length, 10000);
        report.keychain.matchingIdentities = Math.min(matching.length, 10000);
        if (matching.length !== 1 || valid.length > 10000) {
          report.code = "identity-not-unique";
          return;
        }
        report.stage = "attempts";
        for (const [kind, identity] of [
          ["configured", selector],
          ["matched-sha", matching[0][1]],
        ]) {
          signal?.throwIfAborted();
          const copy = join(temporary, `${kind}.app`);
          mkdirSync(join(copy, "Contents/MacOS"), { recursive: true });
          mkdirSync(join(copy, "Contents/Helpers"));
          writeFileSync(
            join(copy, "Contents/Info.plist"),
            `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.situate.signing-probe</string>
<key>CFBundleExecutable</key><string>probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>\n`,
          );
          copyFileSync("/usr/bin/true", join(copy, "Contents/MacOS/probe"));
          copyFileSync("/usr/bin/true", join(copy, "Contents/Helpers/helper"));
          const attempt = {
            selector: kind,
            status: "failed",
            stage: "sign",
            errorCode: null,
            reason: "none",
          };
          report.attempts.push(attempt);
          try {
            await execute(
              "codesign",
              [
                "--force",
                "--deep",
                "--options",
                "runtime",
                "--timestamp",
                "--keychain",
                keychain,
                "--sign",
                identity,
                copy,
              ],
              options,
            );
            attempt.stage = "verify";
            await execute(
              "codesign",
              ["--verify", "--deep", "--strict", copy],
              options,
            );
            attempt.status = "passed";
          } catch (error) {
            attempt.errorCode = errorCode(error);
            attempt.reason = attemptReason(error, attempt.stage);
            signal?.throwIfAborted();
          }
        }
        report.stage = "cleanup";
        const passed =
          report.attempts.every((attempt) => attempt.status === "passed") &&
          report.keychain.filePresent &&
          report.keychain.unlocked === true;
        report.status = passed ? "passed" : "failed";
        report.code = passed ? "probe-complete" : "signing-probe-failed";
      },
    );
    signal?.throwIfAborted();
    if (report.stage === "cleanup") report.stage = "complete";
  } catch {
    report.status = signal?.aborted ? "cancelled" : "failed";
    report.code = signal?.aborted ? "interrupted" : "probe-failed";
  } finally {
    if (temporary) {
      try {
        rmSync(temporary, { recursive: true, force: true });
      } catch {
        report.status = "failed";
        report.code = "temporary-cleanup-failed";
      }
    }
  }
  return report;
}

export async function main(
  args = process.argv.slice(2),
  {
    environment = process.env,
    platform = process.platform,
    execute = run,
  } = {},
) {
  try {
    const { values } = parseArgs({
      args,
      options: { help: { type: "boolean" } },
    });
    if (values.help) {
      console.log(
        "Usage: node tools/signing-check.mjs [--help]\nProbe macOS deep signing access using isolated synthetic app bundles.",
      );
      return 0;
    }
  } catch {
    console.log(
      JSON.stringify({
        version: 1,
        status: "blocked",
        code: "invalid-options",
      }),
    );
    return 1;
  }
  const env = signingEnvironment(environment);
  if (platform === "darwin" && !coordinated(directory, env)) {
    try {
      return await runCoordinated({
        directory,
        resource: "worktree",
        command: process.execPath,
        args: [fileURLToPath(import.meta.url)],
        environment: env,
        cleanupGraceMs: 90000,
      });
    } catch {
      console.log(
        JSON.stringify({
          version: 1,
          status: "failed",
          code: "coordination-failed",
        }),
      );
      return 1;
    }
  }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(name, cancel);
  try {
    const report = await checkSigning({
      environment: env,
      platform,
      execute,
      signal: abort.signal,
    });
    console.log(JSON.stringify(report));
    return report.status === "passed"
      ? 0
      : report.status === "cancelled"
        ? 130
        : 1;
  } finally {
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.removeListener(name, cancel);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
