import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const frontendLicenseAsset = "situate-licenses.txt";
export const frontendLicenseHeading = "Situate licenses and notices\n";

export function bindNativeLicenses(directory, resources, targets) {
  const files = Object.keys(resources)
    .map((path) => ({
      name: basename(path),
      sha256: hash(readFileSync(path)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const binding = JSON.stringify({
    schemaVersion: 1,
    targets: [...targets].sort(),
    files,
  });
  writeFileSync(join(directory, "frontend-binding.json"), binding);
  return {
    SITUATE_NATIVE_LICENSE_DIRECTORY: directory,
    SITUATE_NATIVE_LICENSE_SHA256: hash(binding),
    SITUATE_LICENSE_TARGETS: JSON.stringify([...targets].sort()),
  };
}

function nativeTexts(environment) {
  const directory = environment.SITUATE_NATIVE_LICENSE_DIRECTORY;
  if (!directory) {
    if (
      environment.SITUATE_DISTRIBUTION ||
      environment.SITUATE_LICENSE_TARGETS ||
      environment.SITUATE_NATIVE_LICENSE_SHA256
    )
      throw new Error("Apple frontend requires bound native license material.");
    return [];
  }
  const bytes = readFileSync(join(directory, "frontend-binding.json"));
  if (hash(bytes) !== environment.SITUATE_NATIVE_LICENSE_SHA256)
    throw new Error("Native license binding changed.");
  const binding = JSON.parse(bytes);
  if (
    binding.schemaVersion !== 1 ||
    !Array.isArray(binding.files) ||
    !binding.files.length ||
    !binding.targets?.length ||
    JSON.stringify(binding.targets) !== environment.SITUATE_LICENSE_TARGETS
  )
    throw new Error("Native license targets do not match the frontend build.");
  const texts = [];
  for (const file of binding.files) {
    if (typeof file.name !== "string" || file.name !== basename(file.name))
      throw new Error("Invalid native license resource name.");
    const content = readFileSync(join(directory, file.name));
    if (hash(content) !== file.sha256)
      throw new Error(`Native license material changed: ${file.name}`);
    if (file.name.endsWith(".txt") && !file.name.startsWith("situate-"))
      texts.push(content.toString("utf8"));
  }
  for (const name of [
    "third-party-native-notices.txt",
    "rust-runtime-notices.txt",
  ]) {
    if (!binding.files.some((file) => file.name === name))
      throw new Error(`Missing native component notices: ${name}`);
  }
  return texts;
}

export function combinedLicenseText(root, javascript, environment = {}) {
  if (!javascript?.startsWith("Third-party software notices\n"))
    throw new Error("Missing bundled JavaScript notices.");
  const texts = nativeTexts(environment);
  texts.push(readFileSync(join(root, "../LICENSE"), "utf8"));
  texts.push(readFileSync(join(root, "../LICENSES/CC-BY-4.0.txt"), "utf8"));
  texts.push(
    "Original Situate artwork by Situate contributors.\nhttps://github.com/getsituate/situate/tree/main/design/brand\nLicensed under Creative Commons Attribution 4.0 International.\nhttps://creativecommons.org/licenses/by/4.0/\n",
  );
  const publicDirectory = join(root, "app/public/licenses");
  for (const name of readdirSync(publicDirectory).sort()) {
    if (name.endsWith(".txt"))
      texts.push(readFileSync(join(publicDirectory, name), "utf8"));
  }
  texts.push(
    readFileSync(join(root, "app/src/ai/assets/providers/SOURCES.md"), "utf8"),
  );
  texts.push(javascript);
  return (
    frontendLicenseHeading +
    "\n" +
    texts.join("\n========================================\n\n")
  );
}

export function frontendLicensesPlugin({ root, environment = process.env }) {
  return {
    name: "frontend-license-disclosure",
    generateBundle(_options, bundle) {
      const javascript = bundle["third-party-js-notices.txt"];
      if (javascript?.type !== "asset" || typeof javascript.source !== "string")
        throw new Error("Missing bundled JavaScript notices.");
      this.emitFile({
        type: "asset",
        fileName: frontendLicenseAsset,
        source: combinedLicenseText(root, javascript.source, environment),
      });
    },
    configureServer(server) {
      server.middlewares.use(
        `/${frontendLicenseAsset}`,
        (_request, response) => {
          const text = combinedLicenseText(
            root,
            "Third-party software notices\n",
            environment,
          );
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end(text);
        },
      );
    },
  };
}

export function verifyFrontendLicenses(root, environment) {
  const expected = combinedLicenseText(
    root,
    readFileSync(join(root, "app/dist/third-party-js-notices.txt"), "utf8"),
    environment,
  );
  if (
    readFileSync(join(root, "app/dist", frontendLicenseAsset), "utf8") !==
    expected
  )
    throw new Error(
      "Frontend license disclosure does not match this build's native and JavaScript components.",
    );
}
