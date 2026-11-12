import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { assertLocalPath } from "./release.mjs";

// Docker otherwise injects proxy URLs (which can contain credentials) from CLI configuration.
export const proxyVariables = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "FTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
].flatMap((name) => [name, name.toLowerCase()]);

export function containerPlan({
  platform = "linux",
  arch = "native",
  daemon = "linux/aarch64",
  acceptWindowsSdkLicense = false,
  check = false,
} = {}) {
  if (!["linux", "windows"].includes(platform))
    throw new Error("Container releases support --platform linux or windows.");
  if (!["native", "arm64", "x64"].includes(arch))
    throw new Error("Use --arch native, arm64 or x64.");
  const native = {
    aarch64: "arm64",
    arm64: "arm64",
    x86_64: "x64",
    amd64: "x64",
  }[daemon.trim().split("/")[1]];
  if (!daemon.startsWith("linux/") || !native)
    throw new Error("A Linux Docker engine on ARM64 or x64 is required.");
  if (platform === "windows" && arch === "arm64")
    throw new Error("Windows container builds currently target x64 only.");
  if (platform === "windows" && !acceptWindowsSdkLicense) {
    throw new Error(
      "Windows cross-builds require explicit Microsoft SDK/CRT license acknowledgement. Read client/docker/README.md and pass --accept-windows-sdk-license to proceed.",
    );
  }
  const targetArch =
    platform === "windows" ? "x64" : arch === "native" ? native : arch;
  const buildArch = platform === "windows" ? native : targetArch;
  const dockerPlatform = `linux/${buildArch === "x64" ? "amd64" : "arm64"}`;
  const release = `npm run release -- --platform ${platform}${platform === "windows" ? " --windows-cross --accept-windows-sdk-license" : ""}`;
  const checks = check
    ? `npm run check && npm test && ${platform === "linux" ? "dbus-run-session -- xvfb-run -a npm run test:native && " : ""}`
    : "";
  return {
    platform,
    targetArch,
    buildArch,
    dockerPlatform,
    command: ["sh", "-c", `${checks}${release}`],
  };
}

function docker(args, { capture = false, signal } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("docker", args, {
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      signal,
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, reason) => {
      if (code === 0) resolveResult(output.trim());
      else
        reject(new Error(`docker ${args[0]} failed (exit ${code ?? reason}).`));
    });
  });
}

export async function buildContainerRelease({
  root,
  platform = "linux",
  arch = "native",
  check = false,
  acceptWindowsSdkLicense = false,
  execute = docker,
  signal,
} = {}) {
  // Validate options and consent before contacting a daemon or downloading anything.
  containerPlan({ platform, arch, check, acceptWindowsSdkLicense });
  const daemon = await execute(
    ["info", "--format", "{{.OSType}}/{{.Architecture}}"],
    { capture: true, signal },
  );
  const plan = containerPlan({
    platform,
    arch,
    check,
    acceptWindowsSdkLicense,
    daemon,
  });
  const scope = createHash("sha256")
    .update(resolve(root))
    .digest("hex")
    .slice(0, 12);
  const cache = `situate-${scope}-${platform}-${plan.buildArch}-v1`;
  const name = `situate-release-${randomUUID()}`;
  const artifacts = join(root, "artifacts");
  assertLocalPath(root, artifacts);
  mkdirSync(artifacts, { recursive: true });
  const output = mkdtempSync(join(artifacts, "docker-"));
  const scratch = mkdtempSync(join(tmpdir(), "situate-docker-"));
  const report = {
    status: "building",
    target: platform,
    architecture: plan.targetArch,
    dockerPlatform: plan.dockerPlatform,
    checks: check,
    image: null,
    container: name,
    cachePrefix: cache,
  };
  const saveReport = () =>
    writeFileSync(
      join(output, "container.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  saveReport();
  let created = false;
  try {
    const iid = join(scratch, "image-id");
    await execute(
      [
        "buildx",
        "build",
        "--load",
        "--provenance=false",
        "--platform",
        plan.dockerPlatform,
        "--target",
        platform,
        ...proxyVariables.flatMap((name) => ["--build-arg", `${name}=`]),
        "--file",
        join(root, "docker/Dockerfile"),
        "--iidfile",
        iid,
        "--tag",
        `situate-client-${scope}:${platform}-${plan.buildArch}`,
        resolve(root, ".."),
      ],
      { signal },
    );
    report.image = readFileSync(iid, "utf8").trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(report.image))
      throw new Error("Docker did not return a valid image ID.");
    // Cargo timestamps cannot safely distinguish an older source image restored after a newer build.
    report.targetVolume = `${cache}-target-${report.image.slice(7)}`;
    saveReport();
    await execute(
      [
        "create",
        "--name",
        name,
        "--init",
        ...proxyVariables.flatMap((name) => ["--env", `${name}=`]),
        "--mount",
        `type=volume,source=${report.targetVolume},target=/workspace/client/target`,
        "--mount",
        `type=volume,source=${cache}-registry,target=/usr/local/cargo/registry`,
        "--mount",
        `type=volume,source=${cache}-git,target=/usr/local/cargo/git`,
        report.image,
        ...plan.command,
      ],
      { capture: true },
    );
    created = true;
    signal?.throwIfAborted();
    let buildError;
    try {
      await execute(["start", "--attach", name], { signal });
      const state = await execute(
        ["inspect", "--format", "{{.State.Status}}/{{.State.ExitCode}}", name],
        { capture: true, signal },
      );
      if (state !== "exited/0")
        throw new Error(`Build container did not exit successfully: ${state}`);
    } catch (error) {
      buildError = error;
    }
    // Never copy from a still-running container after an interrupted attachment.
    if (buildError)
      await execute(["stop", "--time", "10", name], { capture: true });
    try {
      await execute(["cp", `${name}:/workspace/client/artifacts/.`, output]);
    } catch (error) {
      if (!buildError) throw error;
      console.error(
        "No release artifacts could be recovered from the failed container.",
      );
    }
    if (buildError) throw buildError;
    signal?.throwIfAborted();
    const releases = readdirSync(output, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("release-"),
    );
    if (releases.length !== 1)
      throw new Error("Expected exactly one exported release directory.");
    const release = join(output, releases[0].name);
    const manifest = JSON.parse(
      readFileSync(join(release, "manifest.json"), "utf8"),
    );
    if (
      manifest.status !== "complete" ||
      manifest.architecture !== plan.targetArch ||
      JSON.stringify(manifest.completed) !== JSON.stringify([platform]) ||
      !Array.isArray(manifest.artifacts) ||
      !manifest.artifacts.length
    ) {
      throw new Error(
        "Exported release manifest does not describe a complete build of the selected target.",
      );
    }
    for (const artifact of manifest.artifacts) {
      const path = resolve(release, artifact);
      assertLocalPath(release, path);
      if (!lstatSync(path).isFile())
        throw new Error(`Exported artifact is not a package file: ${artifact}`);
    }
    report.releaseDirectory = releases[0].name;
    report.status = "complete";
    saveReport();
    console.log(`Container artifacts: ${output}`);
    return output;
  } catch (error) {
    report.status = "failed";
    saveReport();
    console.error(`Incomplete container build: ${output}`);
    throw error;
  } finally {
    if (created) {
      try {
        await execute(["rm", "--force", name], { capture: true });
      } catch {
        console.error(
          `Could not remove build container ${name}; inspect it before retrying.`,
        );
      }
    }
    rmSync(scratch, { recursive: true, force: true });
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
      options: {
        platform: { type: "string", default: "linux" },
        arch: { type: "string", default: "native" },
        check: { type: "boolean" },
        "accept-windows-sdk-license": { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(`Usage: npm run release:docker -- [--platform linux|windows] [--arch native|arm64|x64] [--check]

Linux defaults to the Docker engine's architecture; x64 builds on ARM64 need emulation.
Windows uses a native Linux cross-toolchain and produces an x64 NSIS installer.
Windows requires --accept-windows-sdk-license after reviewing client/docker/README.md.
--check runs static checks and unit tests, plus a headless native smoke test for Linux.
Artifacts are copied to client/artifacts/docker-*/; caches stay in Docker volumes.
No host source, dependency, credential or build directories are mounted into containers.`);
    } else {
      await buildContainerRelease({
        root: fileURLToPath(new URL("../", import.meta.url)),
        platform: values.platform,
        arch: values.arch,
        check: values.check,
        acceptWindowsSdkLicense: values["accept-windows-sdk-license"],
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
