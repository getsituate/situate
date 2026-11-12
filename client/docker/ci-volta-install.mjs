import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";

const input = "/tmp/volta-input";
const pin = JSON.parse(readFileSync(`${input}/ci-volta.json`));
const npm = JSON.parse(readFileSync(`${input}/ci-npm.json`));
const { volta } = JSON.parse(readFileSync("/workspace/package.json"));
assert.equal(process.version, `v${volta.node}`);
assert.equal(npm.version, volta.npm);
assert.equal(
  readFileSync("/workspace/client/.node-version", "utf8").trim(),
  volta.node,
);
const asset = pin[process.arch];
assert.ok(asset, `Unsupported architecture: ${process.arch}`);
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit" });
function download(url, destination, checksum, algorithm = "sha256") {
  run("curl", ["--fail", "--location", "--retry", "3", url, "-o", destination]);
  assert.equal(
    createHash(algorithm)
      .update(readFileSync(destination))
      .digest(algorithm === "sha512" ? "base64" : "hex"),
    checksum,
    `Checksum mismatch: ${url}`,
  );
}
const home = "/opt/volta";
for (const directory of [
  "bin",
  "log",
  "tmp",
  "cache/node",
  "tools/inventory/node",
  "tools/inventory/npm",
  "tools/image/node",
  "tools/user",
])
  mkdirSync(`${home}/${directory}`, { recursive: true });
download(asset.url, "/tmp/volta.tar.gz", asset.sha256);
run("tar", ["-xzf", "/tmp/volta.tar.gz", "-C", `${home}/bin`]);
download(pin.license.url, `${home}/LICENSE`, pin.license.sha256);
assert.match(npm.integrity, /^sha512-/);
download(
  npm.url,
  `${home}/tools/inventory/npm/npm-${npm.version}.tgz`,
  npm.integrity.slice(7),
  "sha512",
);
// Seed Volta's pinned v4 layout from verified distributions, without another download.
symlinkSync("/opt/node", `${home}/tools/image/node/${volta.node}`);
const bundledNpm = JSON.parse(
  readFileSync(
    `${home}/tools/image/node/${volta.node}/lib/node_modules/npm/package.json`,
  ),
).version;
writeFileSync(
  `${home}/tools/inventory/node/node-v${volta.node}-npm`,
  bundledNpm,
);
writeFileSync(`${home}/layout.v4`, "");
writeFileSync(
  `${home}/tools/user/platform.json`,
  JSON.stringify({
    node: { runtime: volta.node, npm: null },
    pnpm: null,
    yarn: null,
  }),
);
writeFileSync(
  `${home}/toolchain.json`,
  JSON.stringify({ ...volta, version: pin.version }),
);
for (const name of ["node", "npm", "npx"])
  symlinkSync("volta-shim", `${home}/bin/${name}`);
rmSync("/tmp/volta.tar.gz");
run(`${home}/bin/volta`, ["install", `npm@${npm.version}`]);
run(`${home}/bin/volta`, ["--version"]);
run(`${home}/bin/node`, ["--version"]);
run(`${home}/bin/npm`, ["--version"]);
