import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  projectModelsDev,
  writeModelsDevSnapshot,
} from "./models-dev-snapshot.mjs";

const chat = {
  id: "fixture-chat",
  name: "Fixture Chat",
  tool_call: true,
  modalities: { input: ["text", "image"], output: ["text"] },
  limit: { context: 128_000, output: 4096 },
  reasoning_options: [{ type: "effort", values: ["low", "high", "unknown"] }],
  cost: { input: 1 },
  api: "https://unused.invalid",
};
const response = Object.fromEntries(
  ["openai", "anthropic", "openrouter"].map((provider) => [
    provider,
    {
      api: "https://unused.invalid",
      models: {
        [chat.id]: chat,
        invalid: { ...chat, id: "invalid", tool_call: false },
      },
    },
  ]),
);

test("the embedded snapshot includes only qualified chat capability data", () => {
  const result = projectModelsDev(response);
  assert.deepEqual(result.openai.models, {
    "fixture-chat": {
      id: "fixture-chat",
      name: "Fixture Chat",
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 128_000, output: 4096 },
      reasoning_options: [{ type: "effort", values: ["low", "high"] }],
    },
  });
  assert.throws(
    () => projectModelsDev({ openai: response.openai }),
    /anthropic/u,
  );
});

test("release snapshot download is unauthenticated and never writes a partial fallback", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-models-dev-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "models.json");
  await assert.rejects(
    writeModelsDevSnapshot(output, { fetcher: async () => new Response("{}") }),
    /catalog/u,
  );
  await assert.rejects(readFile(output), { code: "ENOENT" });
  await writeModelsDevSnapshot(output, {
    fetcher: async (url, options) => {
      assert.equal(url, "https://models.dev/api.json");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers, undefined);
      return Response.json(response);
    },
  });
  assert.deepEqual(
    JSON.parse(await readFile(output, "utf8")),
    projectModelsDev(response),
  );
});
