import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPrivateDotenv } from "./private-dotenv.mjs";

const credentialNames = [
  "SITUATE_GMAIL_TEST_CLIENT_ID",
  "SITUATE_GMAIL_TEST_CLIENT_SECRET",
];

export function gmailBuildInputs(repository, environment = process.env) {
  const missing = credentialNames.filter(
    (name) => !Object.hasOwn(environment, name),
  );
  const local =
    !environment.CI && missing.length
      ? readPrivateDotenv(join(repository, ".env"), missing)
      : {};
  return credentialNames.map((name) =>
    Object.hasOwn(environment, name) ? environment[name] : (local[name] ?? ""),
  );
}

export function requireGmailBuildInputs(environment, releaseEnvironment) {
  const inputs = credentialNames.map((name) => environment[name]);
  if (inputs.some((value) => !value?.trim())) {
    throw new Error(
      `Gmail sign-in configuration is required. In the ${releaseEnvironment} environment, set ${credentialNames[0]} as a variable and ${credentialNames[1]} as a secret.`,
    );
  }
  return inputs;
}

export async function withGmailBuildInputs(scratch, inputs, build) {
  const input = join(scratch, "gmail-build-input.json");
  writeFileSync(input, JSON.stringify(inputs), { mode: 0o600, flag: "wx" });
  try {
    return await build({
      SITUATE_GMAIL_BUILD_INPUT: input,
      // The compiler cache must not retain app credentials outside the build.
      ...(inputs.some(Boolean)
        ? { RUSTC_WRAPPER: "", RUSTC_WORKSPACE_WRAPPER: "" }
        : {}),
    });
  } finally {
    rmSync(input, { force: true });
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  process.stdout.write(JSON.stringify(gmailBuildInputs(repository)));
}
