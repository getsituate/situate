import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "situate-context-"));
const context = join(scratch, "input");
const output = join(scratch, "output");
const included = [
  "LICENSE",
  "client/package.json",
  "client/docker/ci-tool-notices.py",
  "client/docker/ci-tool-notices-update.py",
  "client/docker/ci-tool-notices.json",
  "client/app/src/main.ts",
  "client/app/src-tauri/src/lib.rs",
  "client/workshop/package.json",
  "client/scripts/ui-boundary.mjs",
  "client/scripts/ui-boundary.d.mts",
  "client/crates/situate-core/src/lib.rs",
  "client/packages/ui/src/index.ts",
  "design/brand/tokens.css",
  "client/packages/localization/package.json",
  "client/packages/localization/src/index.ts",
  ...[
    "en.json",
    "de.json",
    "en.ui.json",
    "de.ui.json",
    "en.native.json",
    "de.native.json",
  ].map((file) => `client/packages/localization/src/catalogs/${file}`),
  "client/app/src-tauri/Info.plist",
  "client/crates/tauri-plugin-workspace-access/Cargo.toml",
  "client/crates/tauri-plugin-workspace-access/build.rs",
  "client/crates/tauri-plugin-workspace-access/src/lib.rs",
  "client/crates/tauri-plugin-workspace-access/android/src/main/AndroidManifest.xml",
  "client/crates/tauri-plugin-workspace-access/android/src/main/java/dev/situate/access/WorkspaceAccessPlugin.kt",
  "client/crates/tauri-plugin-workspace-access/ios/Package.swift",
  "client/crates/tauri-plugin-workspace-access/ios/Sources/WorkspaceAccessPlugin.swift",
  "design/brand/assets/wordmark.svg",
  "design/brand/bend/svg/wave-welcome.svg",
];
const excluded = [
  ".git/config",
  ".pi/settings.json",
  ".env",
  "notes.md",
  "design/brand/private.txt",
  "client/workshop/src/main.ts",
  "client/workshop/src/brand/tokens.css",
  "client/workshop/src-tauri/src/lib.rs",
  "client/workshop/src-tauri/Cargo.lock",
  "client/workshop/dist/index.html",
  "client/packages/localization/.env",
  "client/packages/localization/src/private.key",
  "client/.env.local",
  "client/.npmrc",
  "client/target/cache.bin",
  "client/artifacts/release/manifest.json",
  "client/node_modules/native/binary",
  "client/app/dist/index.html",
  "client/app/node_modules/native/binary",
  "client/app/src-tauri/gen/android/gradle.properties",
  "client/app/src-tauri/target/cache.bin",
  "client/app/src/.env",
  "client/app/src/example.pem",
  "client/app/src-tauri/icons/example.keystore",
  "client/crates/tauri-plugin-workspace-access/.tauri/tauri-api/Package.swift",
  "client/crates/tauri-plugin-workspace-access/android/.tauri/tauri-api/build/cache.bin",
  "client/crates/tauri-plugin-workspace-access/android/build/cache.bin",
  "client/crates/tauri-plugin-workspace-access/ios/.build/cache.bin",
];
try {
  for (const path of [...included, ...excluded]) {
    mkdirSync(dirname(join(context, path)), { recursive: true });
    writeFileSync(join(context, path), "fixture");
  }
  mkdirSync(join(context, "client/docker"), { recursive: true });
  for (const file of ["Dockerfile", "Dockerfile.dockerignore"])
    cpSync(join(root, "docker", file), join(context, "client/docker", file));
  const result = spawnSync(
    "docker",
    [
      "buildx",
      "build",
      "--target",
      "context-audit",
      "--file",
      join(context, "client/docker/Dockerfile"),
      "--output",
      `type=local,dest=${output}`,
      context,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Docker context export must succeed");
  for (const path of included)
    assert.ok(existsSync(join(output, path)), `Missing build input: ${path}`);
  for (const path of excluded)
    assert.ok(
      !existsSync(join(output, path)),
      `Unexpected build input: ${path}`,
    );
  console.log("Docker context filtering passed.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
