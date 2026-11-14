import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const toolNoticePins = {
  situate: "39f4fd9c29f32e6190133a824c0ae273d9a1a867c13afefd8c486741f0ba181a",
  manifest: "b6541bece874b908ea88a6124b58e4033f4e409375555750015ec7c5c5235470",
  verifier: "c2e0240106229e078b022d288e27096d4c686718f9245cdf230fb2e0d0746b8c",
};
for (const [path, expected] of [
  ["/opt/ci-tools/LICENSE-Situate.txt", toolNoticePins.situate],
  ["/opt/ci-tools/tool-notices/manifest.json", toolNoticePins.manifest],
  ["/opt/ci-tools/ci-tool-notices.py", toolNoticePins.verifier],
]) {
  assert.equal(
    createHash("sha256").update(readFileSync(path)).digest("hex"),
    expected,
    `Tool notice verification input: ${path}`,
  );
}
execFileSync("python3", ["-B", "/opt/ci-tools/ci-tool-notices.py", "verify"], {
  stdio: "inherit",
});

const quality = JSON.parse(
  readFileSync("/opt/ci-tools/toolchain.quality.json"),
);
for (const directory of [
  process.env.HOME,
  process.env.CARGO_HOME,
  process.env.npm_config_cache,
]) {
  assert.ok(directory, "HOME, CARGO_HOME and npm_config_cache must be set");
  mkdirSync(directory, { recursive: true });
}
const uid = process.getuid();
const gid = process.getgid();
assert.notEqual(uid, 0, "Run verification as a non-root UID");
execFileSync(
  "bash",
  [
    "-ec",
    `
  source /opt/ci-tools/ci-user.sh
  test "$(getent passwd "$(id -u)" | cut -d: -f3)" = "$(id -u)"
  test "$(getent group "$(id -g)" | cut -d: -f3)" = "$(id -g)"
  exec dbus-run-session -- true
`,
  ],
  { stdio: "inherit" },
);
console.log(`D-Bus session verified as UID ${uid}, GID ${gid}.`);
const output = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const toolchain = JSON.parse(readFileSync("/opt/volta/toolchain.json"));
assert.equal(output("volta", ["--version"]), toolchain.version);
assert.equal(output("node", ["--version"]), `v${toolchain.node}`);
assert.equal(output("npm", ["--version"]), toolchain.npm);
assert.equal(
  output("volta", ["which", "node"]),
  `/opt/volta/tools/image/node/${toolchain.node}/bin/node`,
);
const project = mkdtempSync(`${process.env.HOME}/volta-smoke-`);
try {
  writeFileSync(
    `${project}/package.json`,
    JSON.stringify({
      name: "volta-smoke",
      private: true,
      version: "1.0.0",
      volta: { node: toolchain.node, npm: toolchain.npm },
      scripts: {
        check:
          "node -e \"require('node:assert/strict').equal(process.version, 'v" +
          toolchain.node +
          "')\"",
      },
    }),
  );
  mkdirSync(`${project}/child`);
  writeFileSync(
    `${project}/child/package.json`,
    JSON.stringify({ volta: { extends: "../package.json" } }),
  );
  for (const [args, cwd] of [
    [
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
      ],
      project,
    ],
    [["ci", "--offline", "--no-audit"], project],
    [["run", "check"], project],
    [["exec", "--offline", "--", "node", "--version"], `${project}/child`],
  ])
    execFileSync("npm", args, { cwd, stdio: "inherit" });
} finally {
  rmSync(project, { recursive: true, force: true });
}
for (const [name, args] of [
  ["npm", ["--version"]],
  ["gh", ["--version"]],
  ["swift-format", ["--version"]],
  ["swiftlint", ["version"]],
  ["cargo-deny", ["--version"]],
  ["cargo-llvm-cov", ["llvm-cov", "--version"]],
  ["gitleaks", ["version"]],
  ["ktlint", ["--version"]],
]) {
  assert.ok(
    output(name, args).includes(quality[name].version),
    `${name} version`,
  );
}
assert.match(output("gh", ["api", "--help"]), /--slurp/);
const swiftSourcePins = {
  swiftManifest:
    "b0a38547657871ff600cd80f7cc8503e20f0444f57806e9958ba2f152d33f735",
  swiftVerifier:
    "68f150ec1f737216d39fcb314d7c72b41cbbd8e96690f6c8d9abe9907ada4ee7",
};
for (const [path, expected] of [
  ["/opt/ci-tools/ci-swift-tools.json", swiftSourcePins.swiftManifest],
  ["/opt/ci-tools/ci-swift-tools.py", swiftSourcePins.swiftVerifier],
])
  assert.equal(
    createHash("sha256").update(readFileSync(path)).digest("hex"),
    expected,
    `Swift verification input: ${path}`,
  );
execFileSync(
  "python3",
  [
    "-B",
    "/opt/ci-tools/ci-swift-tools.py",
    "verify",
    "--input",
    "/opt/ci-tools",
  ],
  { stdio: "inherit" },
);
for (const path of [
  "/opt/ci-tools/swiftlint/swiftlint",
  "/opt/ci-tools/swift-format/swift-format",
  "/opt/ci-tools/swift-runtime/usr/lib/libsourcekitdInProc.so",
]) {
  const dependencies = output("ldd", [path]);
  assert.doesNotMatch(dependencies, /not found/);
  for (const [, library, resolved] of dependencies.matchAll(
    /(lib(?:swift|Foundation|_Foundation|dispatch|BlocksRuntime|_CompilerSwift)[^\s]*) => ([^\s]+)/g,
  ))
    assert.ok(
      resolved.startsWith("/opt/ci-tools/swift-runtime/"),
      `${library} must use the copied runtime`,
    );
}
const swiftSmoke = mkdtempSync(`${process.env.HOME}/swift-source-smoke-`);
try {
  const source = `${swiftSmoke}/example.swift`;
  writeFileSync(source, "let value:Int=1\n");
  execFileSync("swift-format", ["format", "--in-place", source]);
  execFileSync("swift-format", ["lint", "--strict", source]);
  const configuration = `${swiftSmoke}/swiftlint.yml`;
  writeFileSync(configuration, "only_rules:\n  - statement_position\n");
  writeFileSync(
    source,
    'if true {\n  print("first")\n}\nelse {\n  print("second")\n}\n',
  );
  const result = spawnSync(
    "swiftlint",
    ["lint", "--strict", "--no-cache", "--config", configuration, source],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    2,
    "SourceKit-dependent lint must detect the synthetic violation",
  );
  assert.match(result.stdout + result.stderr, /statement_position/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /skipping|prohibited|could not load|sourcekitd.*not found/i,
  );
} finally {
  rmSync(swiftSmoke, { recursive: true, force: true });
}
for (const [command, args] of [
  ["node", ["--version"]],
  ["rustc", ["--version"]],
  ["cargo", ["--version"]],
  ["git", ["--version"]],
  ["python3", ["--version"]],
  ["bash", ["--version"]],
  ["javac", ["-version"]],
  ["rustfmt", ["--version"]],
  ["cargo", ["clippy", "--version"]],
]) {
  console.log(output(command, args).split("\n")[0]);
}
assert.match(output("javac", ["-version"]), /^javac 21\./);
assert.ok(
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  "Browser cache path must be set",
);
for (const library of ["webkit2gtk-4.1", "gtk+-3.0", "openssl"]) {
  console.log(`${library}: ${output("pkg-config", ["--modversion", library])}`);
}
for (const dependency of [
  "libnss3",
  "libatk-bridge2.0-0",
  "libgtk-4-1",
  "gstreamer1.0-libav",
  "xvfb",
  "dbus-x11",
  "libnss-wrapper",
]) {
  assert.equal(
    output("dpkg-query", ["-W", "-f=${db:Status-Status}", dependency]),
    "installed",
    dependency,
  );
}
for (const path of [
  "/opt/playwright-browsers",
  "/workspace/client",
  "/workspace/node_modules",
  "/opt/nsis",
  "/var/run/docker.sock",
  "/root/.npm",
  "/root/.ssh",
  "/tmp/ci-swift-build",
  "/swift-input",
  "/usr/bin/swift",
  "/usr/bin/swiftc",
  "/usr/lib/swift",
]) {
  assert.equal(existsSync(path), false, `Unexpected image content: ${path}`);
}
const sources = "/opt/ci-tools/sources";
const requests = readFileSync(`${sources}/debian-requests.txt`, "utf8")
  .trim()
  .split("\n");
const upstreamHashes = [];
const sourcePackages = new Set(
  readdirSync(`${sources}/debian`)
    .filter((name) => name.endsWith(".dsc"))
    .map((name) => {
      const dsc = readFileSync(`${sources}/debian/${name}`, "utf8");
      const checksums = /^Checksums-Sha256:\n((?: .+\n)+)/m.exec(dsc);
      assert.ok(checksums, `Missing source hashes: ${name}`);
      for (const line of checksums[1].trim().split("\n")) {
        const match = /^\s*([a-f0-9]{64}) \d+ ([a-zA-Z0-9.+~_-]+)$/.exec(line);
        assert.ok(match, `Invalid source checksum: ${name}`);
        upstreamHashes.push(`${match[1]}  ${match[2]}`);
      }
      return `${/^Source: (.+)$/m.exec(dsc)?.[1]}=${/^Version: (.+)$/m.exec(dsc)?.[1]}`;
    }),
);
assert.deepEqual([...sourcePackages].sort(), requests);
const nssSource = output("dpkg-query", [
  "-W",
  "-f=${source:Package}=${source:Version}",
  "libnss-wrapper",
]);
assert.ok(
  sourcePackages.has(nssSource),
  "NSS wrapper corresponding source must be bundled",
);
execFileSync("sha256sum", ["--check", "--quiet"], {
  cwd: `${sources}/debian`,
  input: upstreamHashes.join("\n") + "\n",
  stdio: ["pipe", "inherit", "inherit"],
});
execFileSync("sha256sum", ["--check", "--quiet", "SHA256SUMS"], {
  cwd: sources,
  stdio: "inherit",
});
console.log(
  `${requests.length} Debian source packages and Temurin source hashes verified.`,
);
const require = createRequire(import.meta.url);
for (const directory of readdirSync("/opt/ci-tools").filter((name) =>
  name.startsWith("playwright-"),
)) {
  const playwright = require(`/opt/ci-tools/${directory}`);
  if (!process.argv.includes("--browsers")) continue;
  for (const name of ["chromium", "webkit"]) {
    const browser = await playwright[name].launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent("<title>CI browser check</title>");
      assert.equal(await page.title(), "CI browser check");
      console.log(`${directory} ${name}: launched`);
    } finally {
      await browser.close();
    }
  }
}
console.log(
  process.argv.includes("--browsers")
    ? "Linux CI tools and runtime browsers verified."
    : "Linux CI tools and system dependencies verified; browser launches not requested.",
);
