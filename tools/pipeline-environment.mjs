import assert from "node:assert/strict";
import { win32 } from "node:path";

export function windowsInstallationPath(directory, ...segments) {
  assert(
    directory && /^[a-z]:[\\/]/iu.test(directory),
    "Expected an absolute Windows installation directory",
  );
  return win32.join(directory, ...segments);
}

export function pipelineGitPath(
  platform = process.platform,
  environment = process.env,
) {
  return platform === "win32"
    ? windowsInstallationPath(environment.ProgramFiles, "Git", "bin", "git.exe")
    : "/usr/bin/git";
}

export function ordinaryEnvironment(
  environment = process.env,
  platform = process.platform,
) {
  const names = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "VOLTA_HOME",
    "CI",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "CARGO_NET_OFFLINE",
    "RUSTUP_TOOLCHAIN",
    "DEVELOPER_DIR",
    "npm_config_cache",
    "PLAYWRIGHT_BROWSERS_PATH",
    "CARGO_INCREMENTAL",
    "CARGO_PROFILE_DEV_DEBUG",
    "CARGO_PROFILE_TEST_DEBUG",
    "LIBGL_ALWAYS_SOFTWARE",
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "SITUATE_CI_IMAGE",
    "SITUATE_TOOL_CONTAINER",
    "SITUATE_COORDINATED_WORKTREE",
    "SITUATE_NATIVE_EXECUTOR",
    "SITUATE_NATIVE_VM_CONFIG",
    "SITUATE_COMPILER_CACHE",
    "SITUATE_COMPILER_CACHE_SOCKET",
    "SITUATE_SCCACHE",
    "SCCACHE_DIR",
    "SCCACHE_CACHE_SIZE",
  ];
  if (environment.SITUATE_TOOL_BUILD_SLOTS === "1")
    names.push("SITUATE_TOOL_BUILD_SLOTS");
  if (environment.SITUATE_TOOL_CONTAINER === "1") {
    names.push(
      "NSS_WRAPPER_PASSWD",
      "NSS_WRAPPER_GROUP",
      "SITUATE_HOST_ADMISSION",
      "SITUATE_HOST_ADMITTED",
    );
    if (environment.LD_PRELOAD === "/opt/ci-tools/libnss_wrapper.so")
      names.push("LD_PRELOAD");
  }
  if (platform === "win32") {
    names.push(
      "SystemRoot",
      "windir",
      "SystemDrive",
      "ComSpec",
      "PATHEXT",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "PROGRAMDATA",
      "ProgramFiles",
      "ProgramFiles(x86)",
      "ProgramW6432",
      "PROCESSOR_ARCHITECTURE",
      "PROCESSOR_ARCHITEW6432",
      "ImageOS",
      "ImageVersion",
      "RUNNER_ENVIRONMENT",
      "RUNNER_TEMP",
    );
    const windows = new Map(
      Object.entries(environment).map(([key, value]) => [
        key.toUpperCase(),
        value,
      ]),
    );
    return Object.fromEntries(
      names.flatMap((name) => {
        const key = name.toUpperCase();
        return windows.has(key) ? [[name, windows.get(key)]] : [];
      }),
    );
  }
  return Object.fromEntries(
    names
      .filter((key) => Object.hasOwn(environment, key))
      .map((key) => [key, environment[key]]),
  );
}

export function hostContainerEnvironment(environment) {
  const allowed = ordinaryEnvironment(environment);
  for (const key of [
    "SITUATE_DOCKER_LEASE",
    "SITUATE_CONTAINER_CACHE",
    "SITUATE_CONTAINER_CACHE_DIR",
    "XDG_CACHE_HOME",
    "GITHUB_ACTIONS",
    "BUILD_ID",
    "TF_BUILD",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "DOCKER_API_VERSION",
    "SSH_AUTH_SOCK",
  ])
    if (Object.hasOwn(environment, key)) allowed[key] = environment[key];
  return allowed;
}
