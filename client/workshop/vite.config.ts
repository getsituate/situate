import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { uiBoundary } from "../scripts/ui-boundary.mjs";
import { fileURLToPath } from "node:url";

const sourceRoots = [".", "../node_modules"].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

export default defineConfig({
  plugins: [uiBoundary(sourceRoots), vue()],
  clearScreen: false,
  build: { target: ["es2022", "safari16", "chrome105"] },
  server: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
    fs: { allow: sourceRoots },
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
