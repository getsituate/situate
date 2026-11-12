import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { uiBoundary } from "../scripts/ui-boundary.mjs";
import { fileURLToPath } from "node:url";

const sourceRoots = [
  ".",
  "../node_modules",
  "../packages/ui",
  "../contracts",
  "../packages/localization",
  "../../design/brand",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

export default defineConfig({
  plugins: [uiBoundary(sourceRoots), vue()],
  server: { fs: { allow: sourceRoots } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "src/plugins/executor-boundary.test.ts",
    ],
    clearMocks: true,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,vue}"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "../target/coverage/vue",
    },
  },
});
