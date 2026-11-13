export function ordinaryEnvironment(environment = process.env) {
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
    "SCCACHE_DIR",
  ];
  if (environment.SITUATE_TOOL_CONTAINER === "1") {
    names.push("NSS_WRAPPER_PASSWD", "NSS_WRAPPER_GROUP");
    if (environment.SITUATE_TOOL_BUILD_SLOTS === "1")
      names.push("SITUATE_TOOL_BUILD_SLOTS");
    if (environment.LD_PRELOAD === "/opt/ci-tools/libnss_wrapper.so")
      names.push("LD_PRELOAD");
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
