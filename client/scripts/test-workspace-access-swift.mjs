import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  throw new Error(
    "The workspace-access Swift checks require macOS and the Apple Swift compiler.",
  );
}

const source = fileURLToPath(
  new URL("../crates/tauri-plugin-workspace-access/ios/", import.meta.url),
);
const output = mkdtempSync(join(tmpdir(), "situate-workspace-access-swift-"));
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.signal ?? result.status}).`);
  }
}

try {
  for (const [name, files] of [
    [
      "directories",
      ["Sources/NewWorkspaceDirectory.swift", "Tests/main.swift"],
    ],
    [
      "content",
      [
        "Sources/NewWorkspaceDirectory.swift",
        "Sources/WorkspaceContent.swift",
        "Tests/Content/main.swift",
      ],
    ],
  ]) {
    const binary = join(output, name);
    run("swiftc", [...files.map((file) => join(source, file)), "-o", binary]);
    run(
      binary,
      name === "content"
        ? [
            fileURLToPath(
              new URL("../contracts/content-paths.json", import.meta.url),
            ),
          ]
        : [],
    );
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
