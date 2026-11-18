#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readPrivateDotenv } from "../client/scripts/private-dotenv.mjs";

if (process.platform !== "darwin" && process.platform !== "linux") {
  console.error("The development terminal supports macOS and Linux only.");
  process.exit(1);
}

const environment = { ...process.env };
const fixtureFolder = "SITUATE_TEST_WORKSPACES_DIR";
if (!environment.CI && !Object.hasOwn(environment, fixtureFolder)) {
  try {
    Object.assign(
      environment,
      readPrivateDotenv(new URL("../.env", import.meta.url), [fixtureFolder]),
    );
  } catch {
    console.warn(
      "Could not read SITUATE_TEST_WORKSPACES_DIR from the repository-root .env. Use an owned, private regular file (chmod 600) or set the environment variable before launching.",
    );
  }
}

process.chdir(fileURLToPath(new URL("./dev-tui/", import.meta.url)));
// Replace the launcher so terminal signals reach Cargo without a Node wrapper.
process.execve(
  "/bin/sh",
  ["sh", "-c", "exec cargo run --locked --manifest-path Cargo.toml"],
  environment,
);
