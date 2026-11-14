import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  chmodSync,
  rmSync,
} from "node:fs";

const input = "/ci-input";
const quality = JSON.parse(
  readFileSync(`${input}/tools/toolchain.quality.json`),
);
const assets = JSON.parse(
  readFileSync(`${input}/client/docker/ci-assets.json`),
);
const arch =
  process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
if (!arch) throw new Error(`Unsupported architecture: ${process.arch}`);
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit" });
function download(url, destination, checksum, algorithm = "sha256") {
  run("curl", ["--fail", "--location", "--retry", "3", url, "-o", destination]);
  const actual = createHash(algorithm)
    .update(readFileSync(destination))
    .digest(algorithm === "sha512" ? "base64" : "hex");
  if (actual !== checksum) throw new Error(`Checksum mismatch: ${url}`);
}
mkdirSync("/opt/ci-tools", { recursive: true });
for (const [name, tool] of Object.entries(assets)) {
  if (tool.version !== quality[name].version)
    throw new Error(`Update tool pins for ${name}`);
  const directory = `/opt/ci-tools/${name}`;
  mkdirSync(directory);
  if (tool.sourceBuild) {
    if (
      name !== "cargo-llvm-cov" ||
      tool.sourceBuild !== "cargo-install-locked"
    )
      throw new Error(`Unsupported source build: ${name}`);
  } else {
    const asset = tool[arch];
    download(asset.url, "/tmp/ci-archive.tar.gz", asset.sha256);
    run("tar", [
      "-xzf",
      "/tmp/ci-archive.tar.gz",
      "-C",
      directory,
      ...(["cargo-deny", "gh"].includes(name) ? ["--strip-components=1"] : []),
    ]);
  }
  if (name === "gh") symlinkSync("bin/gh", `${directory}/gh`);
  symlinkSync(`${directory}/${name}`, `/usr/local/bin/${name}`);
  for (const notice of tool.notices ?? [])
    download(notice.url, `${directory}/${notice.name}`, notice.sha256);
}
const ktlint = quality.ktlint;
mkdirSync("/opt/ci-tools/ktlint");
download(
  `https://github.com/pinterest/ktlint/releases/download/${ktlint.version}/ktlint`,
  "/opt/ci-tools/ktlint/ktlint",
  ktlint.sha256,
);
chmodSync("/opt/ci-tools/ktlint/ktlint", 0o755);
symlinkSync("/opt/ci-tools/ktlint/ktlint", "/usr/local/bin/ktlint");
download(
  `https://raw.githubusercontent.com/pinterest/ktlint/${ktlint.version}/LICENSE`,
  "/opt/ci-tools/ktlint/LICENSE",
  "b45bdb3357e761d4b1300470833cf5e5e9fafc32a5f98efef214ba926b0120d5",
);
const npmPin = JSON.parse(readFileSync(`${input}/client/docker/ci-npm.json`));
if (npmPin.version !== quality.npm.version)
  throw new Error("Update npm archive pin");
if (
  execFileSync("npm", ["--version"], { encoding: "utf8" }).trim() !==
  npmPin.version
)
  throw new Error("Volta npm version does not match the CI toolchain");
const browsers = JSON.parse(
  readFileSync(`${input}/client/docker/ci-browsers.json`),
);
const installed = new Set();
for (const project of ["client", "requirements"]) {
  const core = browsers[project];
  if (
    !core?.integrity?.startsWith("sha512-") ||
    !core.resolved.startsWith("https://registry.npmjs.org/playwright-core/")
  )
    throw new Error(`Invalid Playwright manifest: ${project}`);
  if (installed.has(core.version)) continue;
  installed.add(core.version);
  const directory = `/opt/ci-tools/playwright-${core.version}`;
  mkdirSync(directory);
  download(
    core.resolved,
    "/tmp/ci-archive.tar.gz",
    core.integrity.slice(7),
    "sha512",
  );
  run("tar", [
    "-xzf",
    "/tmp/ci-archive.tar.gz",
    "-C",
    directory,
    "--strip-components=1",
  ]);
  run("node", [`${directory}/cli.js`, "install-deps", "chromium", "webkit"]);
}
writeFileSync(
  "/opt/ci-tools/toolchain.quality.json",
  JSON.stringify(quality, null, 2),
);
writeFileSync(
  "/opt/ci-tools/debian-packages.tsv",
  execFileSync("dpkg-query", [
    "-W",
    "-f=${binary:Package}\\t${Version}\\t${source:Package}\\t${source:Version}\\n",
  ]),
);
writeFileSync(
  "/opt/ci-tools/ci-browsers.json",
  JSON.stringify(browsers, null, 2),
);
rmSync("/tmp/ci-archive.tar.gz");
run("npm", ["cache", "clean", "--force"]);
