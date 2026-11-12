import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  chmod,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = fileURLToPath(new URL("../../", import.meta.url));
export const manifestName = "native-vm-manifest.json";
const scripts = [
  "native-vm-guest.mjs",
  "native-vm-build.mjs",
  "native-vm-package.mjs",
  "native-vm-host.mjs",
  "test-native.mjs",
  "document-source-fixtures.mjs",
  "test-agent-e2e.mjs",
  "native-smoke-runtime.mjs",
  "native-smoke-phase.mjs",
  "native-desktop-session.mjs",
  "coordinated-native-smoke.mjs",
  "coordinated-native-agent.mjs",
  "agent-e2e-runtime.mjs",
  "agent-e2e-credentials.mjs",
  "agent-e2e-provider.mjs",
  "agent-e2e-fixture.mjs",
];
const inputs = [
  "package.json",
  ...scripts.map((name) => `client/scripts/${name}`),
  "tools/compiler-cache.mjs",
  "tools/test-budget.mjs",
  "tools/run-coordinated.mjs",
  "tools/worktree-supervisor.py",
  ...["agent-e2e.js", "onboarding-source.json", "onboarding-source.md"].map(
    (name) => `client/app/src-tauri/tests/support/${name}`,
  ),
];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateRun(run) {
  if (
    !uuid.test(run.id) ||
    typeof run.root !== "string" ||
    !/^\/Users\/[a-z_][a-z0-9_-]*\/\.situate-test-runs\/[a-f0-9-]+$/.test(
      run.root,
    ) ||
    !run.root.endsWith(`/.situate-test-runs/${run.id}`)
  )
    throw new Error("Invalid native VM run identity.");
}
export function guestIsolation(run) {
  validateRun(run);
  return {
    root: `${run.root}/isolation`,
    owner: run.id,
    identifier: `dev.situate.client.smoke.${run.id}`,
  };
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function stagePackage(
  directory,
  { run, kind, args, modes, executable, source = repository },
) {
  validateRun(run);
  if (!["native", "agent"].includes(kind))
    throw new Error("Invalid native VM journey.");
  const files = {};
  async function stage(from, name) {
    const info = await lstat(from);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Native VM packages require regular files.");
    const destination = join(directory, name);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(from, destination);
    const mode = info.mode & 0o111 ? 0o500 : 0o400;
    await chmod(destination, mode);
    files[name] = { sha256: digest(await readFile(destination)), mode };
  }
  for (const name of inputs) await stage(join(source, name), name);
  await stage(executable, "runtime/situate-client");
  const manifest = {
    version: 1,
    id: run.id,
    root: run.root,
    kind,
    args,
    modes,
    isolation: guestIsolation(run),
    executable: "runtime/situate-client",
    files,
  };
  await writeFile(join(directory, manifestName), JSON.stringify(manifest), {
    flag: "wx",
    mode: 0o400,
  });
  return manifest;
}

export async function readPackage(directory) {
  const marker = join(directory, manifestName);
  if (!(await lstat(marker)).isFile() || (await lstat(marker)).isSymbolicLink())
    throw new Error("Invalid native VM manifest.");
  const manifest = JSON.parse(await readFile(marker, "utf8"));
  validateRun(manifest);
  if (
    manifest.version !== 1 ||
    !["native", "agent"].includes(manifest.kind) ||
    JSON.stringify(manifest.isolation) !==
      JSON.stringify(guestIsolation(manifest)) ||
    manifest.executable !== "runtime/situate-client" ||
    !Array.isArray(manifest.args) ||
    !manifest.args.every((arg) => typeof arg === "string") ||
    !manifest.modes ||
    Object.keys(manifest.modes).some(
      (key) => !["handoff", "process"].includes(key),
    ) ||
    Object.values(manifest.modes).some((value) => typeof value !== "boolean")
  )
    throw new Error("Invalid native VM manifest.");
  const expected = [...inputs, "runtime/situate-client"].sort();
  if (
    JSON.stringify(Object.keys(manifest.files ?? {}).sort()) !==
    JSON.stringify(expected)
  )
    throw new Error("Invalid native VM package inventory.");
  for (const name of expected) {
    const info = await lstat(join(directory, name));
    const record = manifest.files[name];
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      ![0o400, 0o500].includes(record.mode) ||
      (info.mode & 0o777) !== record.mode ||
      digest(await readFile(join(directory, name))) !== record.sha256
    )
      throw new Error("Native VM package checksum mismatch.");
  }
  async function inventory(parent, prefix = "") {
    const result = [];
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory())
        result.push(...(await inventory(join(parent, entry.name), name + "/")));
      else if (entry.isFile()) result.push(name);
      else throw new Error("Native VM packages require regular files.");
    }
    return result;
  }
  if (
    JSON.stringify((await inventory(directory)).sort()) !==
    JSON.stringify([...expected, manifestName].sort())
  )
    throw new Error("Unexpected native VM package content.");
  return { ...manifest, executable: resolve(directory, manifest.executable) };
}
