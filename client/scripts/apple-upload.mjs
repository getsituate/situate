import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  appleEnvironment,
  loadAppleSettings,
  sha256,
} from "./apple-release.mjs";
import { assertLocalPath } from "./ios-project-lock.mjs";
import { run } from "./ios-xcode.mjs";
import { withAppleCredentials } from "./apple-credentials.mjs";

export function uploadCredentials(settings, root) {
  const account = settings.appStoreConnect;
  if (
    !account ||
    !/^[1-9][0-9]+$/.test(account.appId ?? "") ||
    !/^[A-Z0-9]{10,}$/.test(account.apiKeyId ?? "") ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      account.apiIssuerId ?? "",
    ) ||
    !isAbsolute(account.apiKeyPath ?? "")
  )
    throw new Error(
      "Configure appStoreConnect with appId, apiKeyId, apiIssuerId and an absolute apiKeyPath in .apple-release.local.json.",
    );
  const path = realpathSync(account.apiKeyPath);
  const location = relative(realpathSync(resolve(root, "..")), path);
  if (
    !location.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(location)
  )
    throw new Error(
      "Keep the App Store Connect private key outside the repository.",
    );
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error(
      "The App Store Connect private key must be an owned, private regular file (chmod 600).",
    );
  return [
    "--api-key",
    account.apiKeyId,
    "--api-issuer",
    account.apiIssuerId,
    "--p8-file-path",
    path,
  ];
}

export async function checkAppleUploadPrerequisites(options) {
  if ((options.host ?? process.platform) !== "darwin")
    throw new Error("TestFlight upload requires macOS with Xcode 27 or newer.");
  options.signal?.throwIfAborted();
  return withAppleCredentials(
    { ...options, upload: true },
    async (settings) => {
      uploadCredentials(settings, options.root);
      await (options.execute ?? run)("xcrun", ["--find", "altool"], {
        cwd: options.root,
        env: appleEnvironment(options.environment ?? process.env, options.root),
        signal: options.signal,
        capture: true,
      });
    },
  );
}

export async function uploadAppleRelease(options) {
  if ((options.host ?? process.platform) !== "darwin")
    throw new Error("TestFlight upload requires macOS with Xcode 27 or newer.");
  return withAppleCredentials({ ...options, upload: true }, (settings) =>
    uploadResolvedAppleRelease({ ...options, settings }),
  );
}

async function uploadResolvedAppleRelease({
  root,
  directory,
  settings,
  host = process.platform,
  environment = process.env,
  execute = run,
  signal,
}) {
  if (host !== "darwin")
    throw new Error("TestFlight upload requires macOS with Xcode 27 or newer.");
  directory = resolve(root, directory);
  assertLocalPath(join(root, "artifacts"), directory);
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  );
  const candidates =
    manifest.artifacts?.filter((item) => item.platform === "ios") ?? [];
  const artifact = candidates[0];
  if (
    manifest.schemaVersion !== 1 ||
    manifest.status !== "complete" ||
    candidates.length !== 1 ||
    artifact.exportMethod !== "app-store-connect" ||
    artifact.identifier !== settings.iosBundleIdentifier ||
    !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(artifact.identifier ?? "") ||
    !/^[1-9][0-9]{0,3}$/.test(artifact.buildNumber ?? "") ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")
  )
    throw new Error(
      "Upload requires a complete Apple release for the configured iOS app.",
    );
  const ipa = resolve(directory, artifact.path);
  assertLocalPath(directory, ipa);
  if (
    !ipa.endsWith(".ipa") ||
    !lstatSync(ipa).isFile() ||
    sha256(ipa) !== artifact.sha256
  )
    throw new Error(
      "IPA is missing, modified or does not match its release manifest.",
    );
  const credentials = uploadCredentials(settings, root);
  const receiptPath = join(directory, "upload.json");
  assertLocalPath(directory, receiptPath);
  if (existsSync(receiptPath))
    throw new Error(
      "An upload receipt already exists. Check App Store Connect before any retry; an interrupted upload may have succeeded.",
    );
  const options = {
    cwd: root,
    env: appleEnvironment(environment, root),
    signal,
  };
  const tool = [
    "altool",
    "--platform",
    "ios",
    "--apple-id",
    settings.appStoreConnect.appId,
    "--bundle-id",
    artifact.identifier,
    "--bundle-version",
    artifact.buildNumber,
    "--bundle-short-version-string",
    manifest.version,
    ...credentials,
  ];
  await execute("xcrun", ["--find", "altool"], { ...options, capture: true });
  const handle = openSync(receiptPath, "wx", 0o600);
  const receipt = {
    status: "validating",
    identifier: artifact.identifier,
    version: manifest.version,
    buildNumber: artifact.buildNumber,
    sha256: artifact.sha256,
    startedAt: new Date().toISOString(),
  };
  const save = () => {
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    fsyncSync(handle);
  };
  try {
    save();
    await execute("xcrun", [...tool, "--validate-app", ipa], options);
    if (sha256(ipa) !== artifact.sha256)
      throw new Error("IPA changed during validation; upload refused.");
    receipt.status = "uploading";
    save();
    const response = await execute(
      "xcrun",
      [...tool, "--upload-package", ipa, "--wait", "--output-format", "json"],
      { ...options, capture: true },
    );
    writeFileSync(
      join(directory, "upload-response.json"),
      `${JSON.stringify({ stdout: response }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    receipt.status = "processing";
    save();
    console.log(
      "Upload finished; Apple is processing the build. Check export compliance and tester availability in App Store Connect.",
    );
  } catch (error) {
    receipt.status =
      receipt.status === "validating" ? "validation-failed" : "unknown";
    save();
    throw error;
  } finally {
    closeSync(handle);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const { values } = parseArgs({
      options: { release: { type: "string" }, help: { type: "boolean" } },
    });
    if (values.help)
      console.log(`Usage: npm run release:apple:upload -- --release artifacts/apple-<run>
Validates and uploads an existing, checksum-verified IPA using App Store Connect credentials.
Requires Xcode 27 or newer and Apple credentials in the repository-root .env or environment. Does not submit an App Store release,
add testers or retry a prior upload. See client/README.md.`);
    else {
      if (!values.release)
        throw new Error("Specify --release artifacts/apple-<run>.");
      const root = fileURLToPath(new URL("../", import.meta.url));
      await uploadAppleRelease({
        root,
        directory: values.release,
        settings: loadAppleSettings(root),
        signal: controller.signal,
      });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
