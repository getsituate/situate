import * as vite from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  serveBrowserTests,
  startBrowserServer,
} from "../../tools/browser-server.mjs";

const root = process.cwd();
// Vite's static import crawl stops at the workspace's lazy presentation layers.
const startupUrls =
  root === fileURLToPath(new URL("../app", import.meta.url))
    ? [
        "/src/main.ts",
        "/src/components/AppShell.vue",
        "/src/layout/components/WorkspaceLayout.vue",
        "/src/components/ChatPane.vue",
      ]
    : [];

await serveBrowserTests(() =>
  startBrowserServer(
    vite,
    { root, configFile: resolve("vite.config.ts") },
    startupUrls,
  ),
);
