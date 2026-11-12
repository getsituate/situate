import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function imageInputs(directory = root) {
  return [
    "LICENSE",
    "package.json",
    "client/docker/Dockerfile",
    "client/docker/Dockerfile.dockerignore",
    "client/.node-version",
    "client/rust-toolchain.toml",
    "tools/toolchain.quality.json",
    ...readdirSync(resolve(directory, "client/docker"))
      .filter(
        (name) =>
          /^ci-.*\.(?:mjs|py|sh|json)$/.test(name) || name === "ci-NOTICES.md",
      )
      .map((name) => `client/docker/${name}`),
  ].sort();
}
export function inputDigest(directory = root) {
  const hash = createHash("sha256");
  for (const name of imageInputs(directory)) {
    const content = readFileSync(resolve(directory, name));
    const bytes =
      name === "package.json"
        ? Buffer.from(JSON.stringify(JSON.parse(content).volta))
        : content;
    hash.update(`${name}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
export function validateLock(lock, digest) {
  if (
    lock?.version !== 1 ||
    lock.platform !== "linux/amd64" ||
    typeof lock.image !== "string" ||
    !/^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(lock.image) ||
    !/^[a-f0-9]{64}$/.test(lock.inputsSha256 ?? "")
  )
    throw new Error("Invalid CI image lock.");
  if (lock.inputsSha256 !== digest)
    throw new Error(
      "CI image inputs changed. Build and verify a new image, then update tools/ci-image.lock.json with its digest and input hash.",
    );
  return lock;
}
export function checkBrowserPins(directory = root) {
  const browserPins = JSON.parse(
    readFileSync(resolve(directory, "client/docker/ci-browsers.json"), "utf8"),
  );
  for (const name of ["client", "requirements"]) {
    const lock = JSON.parse(
      readFileSync(resolve(directory, name, "package-lock.json"), "utf8"),
    );
    const actual = lock.packages?.["node_modules/playwright-core"];
    if (
      !actual ||
      ["version", "resolved", "integrity"].some(
        (key) =>
          !browserPins[name]?.[key] || browserPins[name][key] !== actual[key],
      )
    )
      throw new Error(
        `Update ci-browsers.json and rebuild the CI image for the ${name} Playwright version.`,
      );
  }
}
export function readImageLock(directory = root) {
  checkBrowserPins(directory);
  return validateLock(
    JSON.parse(
      readFileSync(resolve(directory, "tools/ci-image.lock.json"), "utf8"),
    ),
    inputDigest(directory),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { inputs: { type: "boolean" }, directory: { type: "string" } },
  });
  const directory = values.directory ? resolve(values.directory) : root;
  if (values.inputs) {
    checkBrowserPins(directory);
    console.log(inputDigest(directory));
  } else console.log(JSON.stringify(readImageLock(directory)));
}
