import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import appConfig from "../app/vite.config.ts";

export default defineConfig(async (environment) =>
  mergeConfig(await appConfig(environment), {
    resolve: {
      alias: [
        {
          find: /^@tauri-apps\/api\/core$/,
          replacement: fileURLToPath(
            new URL(
              "../app/src-tauri/tests/support/native-ios-tauri-core.mjs",
              import.meta.url,
            ),
          ),
        },
        {
          find: "@situate-native-ios/actual-core",
          replacement: fileURLToPath(
            new URL("../node_modules/@tauri-apps/api/core.js", import.meta.url),
          ),
        },
      ],
    },
  }),
);
