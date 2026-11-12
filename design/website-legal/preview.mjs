import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../../website/site.mjs";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = createPreviewServer(
    process.argv[2] ? { legalDirectory: resolve(process.argv[2]) } : {},
  );
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(Number(process.env.PORT || 4178), "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${server.address().port}/legal-notice.html`);
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close());
}
