import { fileURLToPath } from "node:url";
import { startTauriDev } from "./tauri-dev.mjs";
import { desktopDevDataRoot } from "./desktop-dev-data.mjs";
import { dictationDevEnvironment } from "./dictation-dev-source.mjs";

const root = fileURLToPath(new URL("../app", import.meta.url));
process.exitCode = await startTauriDev(
  root,
  dictationDevEnvironment(),
  process.argv.slice(2),
  { appDataRoot: await desktopDevDataRoot(root) },
);
