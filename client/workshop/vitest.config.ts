import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { uiBoundary } from "../scripts/ui-boundary.mjs";
import { fileURLToPath } from "node:url";

const sourceRoots = [".", "../node_modules"].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

export default defineConfig({
  plugins: [uiBoundary(sourceRoots), vue()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
  },
});
