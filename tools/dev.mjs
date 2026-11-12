#!/usr/bin/env node
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" && process.platform !== "linux") {
  console.error("The development terminal supports macOS and Linux only.");
  process.exit(1);
}

process.chdir(fileURLToPath(new URL("./dev-tui/", import.meta.url)));
// Replace the launcher so terminal signals reach Cargo without a Node wrapper.
process.execve(
  "/bin/sh",
  ["sh", "-c", "exec cargo run --locked --manifest-path Cargo.toml"],
  process.env,
);
