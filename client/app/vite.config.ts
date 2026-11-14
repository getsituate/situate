import { fileURLToPath } from "node:url";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { build, defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { uiBoundary } from "../scripts/ui-boundary.mjs";
import { readFileSync } from "node:fs";
import { releaseHistoryPlugin } from "../scripts/release-history.mjs";
import { javascriptLicensesPlugin } from "../scripts/native-licenses.mjs";
import { frontendLicensesPlugin } from "../scripts/native-licenses-frontend.mjs";

const sourceRoots = [
  ".",
  "../node_modules",
  "../packages/ui",
  "../packages/localization",
  "../contracts/diagnostics.json",
  "../../design/brand",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const host = process.env.TAURI_DEV_HOST;
const appRoot = fileURLToPath(new URL(".", import.meta.url));

const jsLicenseComponents = new Map();
const jsLicenses = () =>
  javascriptLicensesPlugin({
    root: fileURLToPath(new URL("../", import.meta.url)),
    components: jsLicenseComponents,
  });

const nativeScripts = [
  {
    entry: "executor-entry.ts",
    name: "SituateExecutor",
    file: "executor-supervisor.js",
  },
  {
    entry: "preview-entry.ts",
    name: "SituatePreview",
    file: "plugin-check-renderer.js",
  },
];

async function buildNativeScript(
  script: (typeof nativeScripts)[number],
): Promise<string> {
  const result = await build({
    configFile: false,
    root: appRoot,
    worker: { format: "es" },
    plugins: [vue(), jsLicenses()],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
    build: {
      target: "safari16",
      write: false,
      minify: true,
      lib: {
        entry: fileURLToPath(
          new URL(`./src/plugins/${script.entry}`, import.meta.url),
        ),
        name: script.name,
        formats: ["iife"],
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (output) => ("output" in output ? output.output : []),
  );
  const chunks = outputs.filter((output) => output.type === "chunk");
  if (chunks.length !== 1)
    throw new Error("Native renderer must be a single bundled script.");
  const css = outputs
    .flatMap((output) =>
      output.type === "asset" && output.fileName.endsWith(".css")
        ? [output.source]
        : [],
    )
    .join("\n");
  return (
    chunks[0].code +
    (css
      ? `;{const style=document.createElement("style");style.textContent=${JSON.stringify(css)};document.head.append(style);}`
      : "")
  );
}

async function writeNativeScripts(): Promise<void> {
  for (const script of nativeScripts) {
    const path = join(appRoot, "dist", script.file);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, await buildNativeScript(script));
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    uiBoundary(sourceRoots),
    releaseHistoryPlugin({
      repoRoot: fileURLToPath(new URL("../../", import.meta.url)),
      version:
        process.env.SITUATE_RELEASE_VERSION ??
        JSON.parse(
          readFileSync(
            new URL("../app/src-tauri/tauri.conf.json", import.meta.url),
            "utf8",
          ),
        ).version,
    }),
    vue(),
    {
      name: "native-renderer-artifacts",
      async generateBundle() {
        for (const script of nativeScripts) {
          this.emitFile({
            type: "asset",
            fileName: script.file,
            source: await buildNativeScript(script),
          });
        }
      },
      async configureServer(server) {
        await writeNativeScripts();
        let pending = Promise.resolve();
        const directories = [
          "./src/",
          "../packages/ui/",
          "../packages/localization/",
          "../../design/brand/",
        ].map((path) => fileURLToPath(new URL(path, import.meta.url)));
        const changed = (path: string) => {
          if (
            !directories.some((directory) => path.startsWith(directory)) ||
            !/\.(ts|vue|css|json)$/.test(path)
          )
            return;
          pending = pending.then(writeNativeScripts).catch((error) => {
            server.config.logger.error(String(error));
          });
        };
        server.watcher.on("change", changed);
        server.httpServer?.once("close", () =>
          server.watcher.off("change", changed),
        );
      },
    },
    jsLicenses(),
    frontendLicensesPlugin({
      root: fileURLToPath(new URL("../", import.meta.url)),
    }),
    {
      name: "browser-runtime-boundary",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (
            output.type === "chunk" &&
            output.moduleIds.some(
              (id) => id.includes("browser-external") || id.startsWith("node:"),
            )
          ) {
            this.error("A Node-only dependency entered the browser runtime.");
          }
        }
      },
    },
  ],
  worker: { format: "es", plugins: () => [jsLicenses()] },
  clearScreen: false,
  optimizeDeps: {
    // Source-only edits reuse the dependency cache; late shared helpers reload active pages.
    include: ["@vue/compiler-dom"],
  },
  build: {
    target: ["es2020", "safari16", "chrome105"],
    manifest: true,
    license: { fileName: "third-party-licenses.md" },
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
      },
    },
  },
  server: {
    fs: { allow: sourceRoots },
    port: mode === "ios-simulator" ? 0 : 1420,
    strictPort: true,
    host: mode === "ios-simulator" ? "127.0.0.1" : host || "127.0.0.1",
    hmr:
      mode !== "ios-simulator" && host ? { protocol: "ws", host } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
