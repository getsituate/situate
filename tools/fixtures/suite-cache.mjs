import { readFileSync } from "node:fs";

const types = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, types: ["node"] },
  include: ["src/**/*.ts", "src/**/*.vue"],
});
const vitest = `
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { uiBoundary } from "../scripts/ui-boundary.mjs";
import { fileURLToPath } from "node:url";
const sourceRoots = [".", "../node_modules"].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);
export default defineConfig({
  plugins: [uiBoundary(sourceRoots), vue()],
  test: { environment: "jsdom", include: ["src/**/*.test.ts"], clearMocks: true },
});
`;

export const cacheConfigurations = {
  "client/Cargo.toml": `
[workspace]
members = ["crates/situate-core"]
resolver = "2"

[workspace.package]
version = "0.0.1"
edition = "2024"
rust-version = "1.98"
publish = false
`,
  "client/crates/situate-core/Cargo.toml": `
[package]
name = "situate-core"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
publish.workspace = true

[dependencies]
fixture = { version = "1.0", features = ["std"], default-features = false }

[target.'cfg(unix)'.dependencies]
native-fixture = "1"
`,
  "client/app/tsconfig.json": types,
  "client/workshop/tsconfig.json": types,
  "client/app/vitest.config.ts": vitest,
  "client/workshop/vitest.config.ts": vitest,
  "client/scripts/ui-boundary.mjs": readFileSync(
    new URL("../suite-cache-policy/ui-boundary.mjs", import.meta.url),
    "utf8",
  ),
};
