import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as sdk from "@earendil-works/pi-coding-agent";
import { restrictedSessionOptions } from "./release-agent-worker.mjs";

test("root-pinned SDK creates an isolated tool-free session with retries disabled", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "situate-release-sdk-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, "auth.json"), "{}");
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: path.join(cwd, "auth.json"),
    modelsPath: null,
    modelsStorePath: path.join(cwd, "models-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = modelRuntime
    .getModels()
    .find((entry) => entry.provider === "openai");
  assert.ok(model, "Pinned static model catalog must be available offline");
  const options = restrictedSessionOptions(sdk, { cwd, model, modelRuntime });
  assert.deepEqual(options.resourceLoader.getAgentsFiles(), {
    agentsFiles: [],
  });
  assert.deepEqual(options.resourceLoader.getExtensions().extensions, []);
  assert.deepEqual(options.resourceLoader.getSkills().skills, []);
  assert.equal(options.settingsManager.getCacheWarmingMode(), "off");
  assert.equal(options.settingsManager.getRetrySettings().enabled, false);
  assert.equal(
    options.settingsManager.getProviderRetrySettings().maxRetries,
    0,
  );
  const { session, modelFallbackMessage } =
    await sdk.createAgentSession(options);
  try {
    assert.equal(modelFallbackMessage, undefined);
    assert.equal(session.model.id, model.id);
    assert.deepEqual(session.getActiveToolNames(), []);
    assert.deepEqual(session.messages, []);
    assert.equal(session.systemPrompt.includes("untrusted data"), true);
  } finally {
    session.dispose();
  }
});
