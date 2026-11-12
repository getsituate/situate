import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "./scripts/catalog.js";

const dataDirectory = fileURLToPath(new URL("./data/", import.meta.url));
const moduleId = "\0virtual:catalog";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "requirements-catalog",
      resolveId(id) {
        if (id === "virtual:catalog") return moduleId;
      },
      async load(id) {
        if (id === moduleId)
          return `export default ${JSON.stringify(await loadCatalog(dataDirectory))}`;
      },
      configureServer(server) {
        server.watcher.add(dataDirectory);
        server.watcher.on("all", (event, file) => {
          if (
            !["add", "change", "unlink"].includes(event) ||
            !file.startsWith(dataDirectory) ||
            !file.endsWith(".md")
          )
            return;
          const module = server.moduleGraph.getModuleById(moduleId);
          if (module) server.moduleGraph.invalidateModule(module);
          server.ws.send({ type: "full-reload" });
        });
      },
    },
  ],
});
