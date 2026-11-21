import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { resolve, dirname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { assertLocalPath } from "./ios-project-lock.mjs";

export async function bundleReport(directory) {
  const root = resolve(directory);
  function artifactPath(file) {
    const path = resolve(root, file);
    assertLocalPath(root, path);
    return path;
  }
  async function readArtifact(file, encoding) {
    const handle = await open(
      artifactPath(file),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1)
        throw new Error(
          `Expected a single-link regular build artifact: ${file}`,
        );
      return await handle.readFile(encoding);
    } finally {
      await handle.close();
    }
  }

  const manifest = JSON.parse(
    await readArtifact(".vite/manifest.json", "utf8"),
  );
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing manifest chunk: ${key}`);
    initial.add(key);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry);
  if (!entries.length)
    throw new Error("No entry points in the build manifest.");
  for (const [key] of entries) visit(key);
  const initialFiles = new Set([...initial].map((key) => manifest[key].file));
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.name.endsWith(".js"))
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)));
  const present = new Set(files);
  // The native assets load outside Vite's entry graph but must still exist.
  for (const file of [
    ...Object.values(manifest).map((chunk) => chunk.file),
    "executor-supervisor.js",
    "plugin-check-renderer.js",
  ]) {
    if (typeof file !== "string" || isAbsolute(file))
      throw new Error(
        "Build artifact paths must be relative to the output directory.",
      );
    if (!file.endsWith(".js")) continue;
    if (!present.has(file))
      throw new Error(`Build manifest references a missing output: ${file}`);
  }
  const chunks = await Promise.all(
    files
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map(async (file) => {
        const bytes = await readArtifact(file);
        return {
          file,
          initial: initialFiles.has(file),
          bytes: bytes.length,
          gzipBytes: gzipSync(bytes).length,
        };
      }),
  );
  const sum = (selected) => ({
    bytes: selected.reduce((total, chunk) => total + chunk.bytes, 0),
    gzipBytes: selected.reduce((total, chunk) => total + chunk.gzipBytes, 0),
  });
  return {
    initialJavaScript: sum(chunks.filter((chunk) => chunk.initial)),
    allJavaScript: sum(chunks),
    chunks,
  };
}
export function checkBudget(
  report,
  { bytes = 1_000_000, gzipBytes = 140_000 } = {},
) {
  if (report.initialJavaScript.bytes > bytes) {
    throw new Error(
      `Initial JavaScript exceeds the uncompressed budget (${bytes} bytes).`,
    );
  }
  return report.initialJavaScript.gzipBytes > gzipBytes
    ? [
        `Initial JavaScript exceeds the gzip warning threshold (${gzipBytes} bytes): ${report.initialJavaScript.gzipBytes} gzip bytes.`,
      ]
    : [];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw new Error("Bundle reporting uses the app/dist build output.");
    const directory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../app/dist",
    );
    const report = await bundleReport(directory);
    console.log(JSON.stringify(report, null, 2));
    for (const warning of checkBudget(report)) console.warn(warning);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
