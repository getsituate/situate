import { mkdtempSync, chmodSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAppleEnv } from "../client/scripts/apple-credentials.mjs";

const rawNames = [
  "SITUATE_RELEASE_SSH_PRIVATE_KEY",
  "SITUATE_RELEASE_SSH_KNOWN_HOSTS",
];
const pathNames = ["WEBSITE_SSH_IDENTITY", "WEBSITE_SSH_KNOWN_HOSTS"];

export function releaseEnvironment(root, names, environment = process.env) {
  const needed = names.filter((name) => !Object.hasOwn(environment, name));
  const local =
    !environment.CI && needed.length
      ? readAppleEnv(join(root, "client"), needed)
      : {};
  return Object.fromEntries(
    names
      .filter(
        (name) =>
          Object.hasOwn(environment, name) || Object.hasOwn(local, name),
      )
      .map((name) => [
        name,
        Object.hasOwn(environment, name) ? environment[name] : local[name],
      ]),
  );
}

export async function withReleaseSSH({ root, environment = process.env }, use) {
  const explicitRaw = rawNames.some((name) => Object.hasOwn(environment, name));
  const explicitPaths = pathNames.some((name) =>
    Object.hasOwn(environment, name),
  );
  const names =
    explicitRaw || explicitPaths
      ? [...(explicitRaw ? rawNames : []), ...(explicitPaths ? pathNames : [])]
      : [...rawNames, ...pathNames];
  const selected = releaseEnvironment(root, names, environment);
  const hasRaw = rawNames.some((name) => Boolean(selected[name]));
  const hasPaths = pathNames.some((name) => Boolean(selected[name]));
  if (hasRaw && hasPaths)
    throw new Error("Select SSH contents or SSH file paths, not both.");
  const prepared = { ...environment };
  for (const name of [...rawNames, ...pathNames]) delete prepared[name];
  if (!hasRaw && (!explicitRaw || hasPaths)) {
    for (const name of pathNames)
      if (Object.hasOwn(selected, name)) prepared[name] = selected[name];
    return await use(prepared);
  }
  for (const name of rawNames) {
    const value = selected[name];
    if (
      typeof value !== "string" ||
      !value.length ||
      value.includes("\0") ||
      Buffer.byteLength(value) > 1024 * 1024
    )
      throw new Error(
        `${name} must contain nonempty, NUL-free SSH contents no larger than 1 MiB.`,
      );
  }
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), "situate-release-ssh-"));
    chmodSync(directory, 0o700);
    for (const [index, name] of pathNames.entries()) {
      const path = join(directory, index === 0 ? "identity" : "known_hosts");
      writeFileSync(path, selected[rawNames[index]], {
        mode: 0o600,
        flag: "wx",
      });
      chmodSync(path, 0o600);
      prepared[name] = path;
    }
    return await use(prepared);
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}
