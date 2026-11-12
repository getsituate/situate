import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

test("plain JavaScript adapters emit catalog events without exporting private fields", async (t) => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(
          new URL("../app/src/diagnostics/producer.ts", import.meta.url),
        ),
        formats: ["es"],
      },
    },
  });
  const chunk = (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .find((output) => output.type === "chunk" && output.isEntry);
  assert.ok(chunk);
  const { createDiagnostics } = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );
  const events = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sdk = createDiagnostics(async (command, args) => {
    if (command === "diagnostics_register")
      return { producer_id: "11111111-1111-4111-8111-111111111111" };
    if (command === "diagnostics_emit") {
      assert.ok(args instanceof Uint8Array);
      const batch = JSON.parse(new TextDecoder().decode(args));
      events.push(...batch.events);
      return { accepted: batch.events.length, dropped: 0 };
    }
    assert.equal(command, "diagnostics_release");
  });
  const plugin = sdk.producer();
  plugin.emit("plugin.loaded", "plugin");
  plugin.emit("plugin.loaded", "plugin", { name: "PRIVATE_PLUGIN_NAME" });
  plugin.emit("PRIVATE_PLUGIN_EVENT", "plugin");
  for (let turn = 0; turn < 8; turn++) {
    t.mock.timers.tick(250);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
  assert.equal(
    events.filter((event) => event.event === "plugin.loaded").length,
    1,
  );
  assert.equal(JSON.stringify(events).includes("PRIVATE_PLUGIN"), false);
  assert.equal(sdk.stats().queuedEvents, 0);
  sdk.shutdown();
  t.mock.timers.tick(1000);
});
