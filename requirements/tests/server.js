import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import * as vite from "vite";
import {
  serveBrowserTests,
  startBrowserServer,
} from "../../tools/browser-server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await serveBrowserTests(async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "situate-viewer-"));
  let server;
  const close = async () => {
    try {
      await server?.close();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  };
  try {
    for (const file of [
      "package.json",
      "index.html",
      "src",
      "scripts",
      "vite.config.js",
    ]) {
      await cp(path.join(root, file), path.join(temporary, file), {
        recursive: true,
      });
    }
    // Test fixtures live only in this temporary copy, never in the source catalog.
    await cp(path.join(root, "tests/fixtures"), path.join(temporary, "data"), {
      recursive: true,
    });
    await symlink(
      path.join(root, "node_modules"),
      path.join(temporary, "node_modules"),
    );
    server = await startBrowserServer(vite, {
      root: temporary,
      configFile: path.join(temporary, "vite.config.js"),
    });
    return { url: server.url, close };
  } catch (error) {
    await close();
    throw error;
  }
});
