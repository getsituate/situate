import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startTauriDev } from "./tauri-dev.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = fileURLToPath(new URL("../workshop", import.meta.url));
  process.exitCode = await startTauriDev(root, {
    SITUATE_WORKSHOP_WORKTREE: basename(resolve(root, "../..")),
  });
}
