import { fileURLToPath } from "node:url";
import { loadCatalog } from "./catalog.js";

const root = fileURLToPath(new URL("../", import.meta.url));
let stopping = false;
let finish;
const stopped = new Promise((resolve) => {
  finish = resolve;
});
const stop = () => {
  stopping = true;
  finish();
};
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of signals) process.on(signal, stop);
let server;
try {
  const { build, preview } = await import("vite");
  await loadCatalog(fileURLToPath(new URL("../data/", import.meta.url)));
  if (!stopping) await build({ root });
  if (!stopping) {
    server = await preview({
      root,
      preview: { host: "127.0.0.1", port: 0, open: false },
    });
    if (!stopping) {
      console.log(
        `Requirements preview: http://127.0.0.1:${server.httpServer.address().port}/`,
      );
      await stopped;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server?.close();
  for (const signal of signals) process.removeListener(signal, stop);
}
