import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [],
    include: ["src/plugins/executor-boundary.test.ts"],
    clearMocks: true,
    passWithNoTests: false,
  },
});
