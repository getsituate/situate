import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function sourceRequests(inventory) {
  const requests = new Set();
  for (const row of inventory.trim().split("\n")) {
    const fields = row.split("\t");
    assert.equal(
      fields.length,
      4,
      "Expected binary and source package versions",
    );
    const [, , name, version] = fields;
    assert.match(name, /^[a-z0-9][a-z0-9+.-]*$/);
    assert.match(version, /^[a-zA-Z0-9.+:~-]+$/);
    requests.add(`${name}=${version}`);
  }
  return [...requests].sort();
}

export function verifyJavaRelease(release, pin) {
  const properties = Object.fromEntries(
    release
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^([A-Z_]+)="(.*)"$/.exec(line);
        assert.ok(match, `Invalid JDK release property: ${line}`);
        return [match[1], match[2]];
      }),
  );
  assert.equal(properties.JAVA_VERSION, pin.javaVersion);
  assert.equal(
    properties.SOURCE_REPO,
    "https://github.com/adoptium/jdk21u.git",
  );
  assert.equal(
    properties.BUILD_SOURCE_REPO,
    "https://github.com/adoptium/temurin-build.git",
  );
  assert.equal(properties.SOURCE, `.:git:${pin.sourceCommit.slice(0, 12)}`);
  assert.equal(properties.BUILD_SOURCE, `git:${pin.buildCommit}`);
}

export function sourceArchiveNames(uris) {
  const names = uris
    .split("\n")
    .filter((line) => line.startsWith("'https://"))
    .map((line) => {
      const match =
        /^'https:\/\/snapshot\.debian\.org\/[^']+' ([a-zA-Z0-9.+~_-]+) \d+ /.exec(
          line,
        );
      assert.ok(match, `Unexpected source archive URI: ${line}`);
      return match[1];
    });
  assert.ok(names.length, "Source resolution produced no archives");
  return [...new Set(names)];
}

function main() {
  const run = (command, args, cwd) =>
    execFileSync(command, args, { cwd, stdio: "inherit" });
  const root = "/opt/ci-tools/sources";
  const debian = `${root}/debian`;
  const java = `${root}/temurin`;
  mkdirSync(debian, { recursive: true });
  mkdirSync(java);
  const pin = JSON.parse(
    readFileSync("/ci-input/client/docker/ci-sources.json"),
  );
  const release = readFileSync("/opt/java/openjdk/release", "utf8");
  verifyJavaRelease(release, pin);
  const arch =
    process.arch === "arm64"
      ? "arm64"
      : process.arch === "x64"
        ? "amd64"
        : null;
  assert.ok(arch, "Unsupported source architecture");
  const aptSources = readFileSync("/etc/apt/sources.list", "utf8");
  assert.ok(aptSources.includes("https://snapshot.debian.org/"));
  const sourceIndexes = aptSources.replace(/^deb /gm, "deb-src ");
  writeFileSync("/etc/apt/sources.list.d/ci-sources.list", sourceIndexes);
  writeFileSync(`${root}/apt-sources.list`, aptSources + sourceIndexes);
  copyFileSync(
    "/opt/ci-tools/debian-packages.tsv",
    `${root}/debian-packages.tsv`,
  );
  const requests = sourceRequests(
    readFileSync(`${root}/debian-packages.tsv`, "utf8"),
  );
  writeFileSync(`${root}/debian-requests.txt`, requests.join("\n") + "\n");
  run("apt-get", ["update"]);
  // Resolve every exact version before downloading; unavailable sources fail the image build.
  const args = ["source", "--download-only", "--only-source", ...requests];
  const uris = execFileSync("apt-get", ["--print-uris", ...args], {
    cwd: debian,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(`${root}/debian-download-uris.txt`, uris);
  const archives = sourceArchiveNames(uris);
  const cache = "/var/cache/situate-ci-sources";
  run("apt-get", args, cache);
  for (const name of archives)
    copyFileSync(`${cache}/${name}`, `${debian}/${name}`);
  for (const asset of [...pin.common, pin[arch]]) {
    run("curl", [
      "--fail",
      "--location",
      "--retry",
      "3",
      asset.url,
      "-o",
      `${java}/${asset.name}`,
    ]);
    const hash = execFileSync("sha256sum", [`${java}/${asset.name}`], {
      encoding: "utf8",
    }).split(" ")[0];
    assert.equal(hash, asset.sha256, `Source checksum: ${asset.name}`);
  }
  for (const name of [
    "binary-build-metadata.json",
    "OpenJDK21U-jdk-sources_21.0.12.1_1.tar.gz.json",
  ]) {
    const metadata = JSON.parse(readFileSync(`${java}/${name}`));
    assert.equal(
      metadata.openjdk_source,
      `https://github.com/adoptium/jdk21u/commit/${pin.sourceCommit}`,
    );
    assert.equal(
      metadata.buildRef,
      `https://github.com/adoptium/temurin-build/commit/${pin.buildCommit}`,
    );
  }
  copyFileSync("/opt/java/openjdk/release", `${java}/release`);
  writeFileSync(
    `${java}/source-pins.json`,
    JSON.stringify(pin, null, 2) + "\n",
  );
  const files = [
    "apt-sources.list",
    "debian-packages.tsv",
    "debian-requests.txt",
    "debian-download-uris.txt",
    ...["debian", "temurin"].flatMap((directory) =>
      readdirSync(`${root}/${directory}`)
        .sort()
        .map((name) => `${directory}/${name}`),
    ),
  ];
  writeFileSync(
    `${root}/SHA256SUMS`,
    execFileSync("sha256sum", files, {
      cwd: root,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
