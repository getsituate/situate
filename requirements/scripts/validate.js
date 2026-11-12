import { fileURLToPath } from "node:url";
import { loadCatalog } from "./catalog.js";

try {
  const catalog = await loadCatalog(
    fileURLToPath(new URL("../data/", import.meta.url)),
  );
  console.log(`${catalog.entries.length} entries validated.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
