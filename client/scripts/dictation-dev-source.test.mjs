import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dictationDevEnvironment } from "./dictation-dev-source.mjs";
import { tauriDevCommand } from "./tauri-dev.mjs";

test("desktop development uses one local model source across worktrees", () => {
  const env = dictationDevEnvironment({});
  const source = join(homedir(), "Library", "Caches", "Situate", "Dictation");
  assert.deepEqual(env, { SITUATE_DICTATION_MODEL_SOURCE: source });
  for (const root of ["/first tree/client/app", "/second tree/client/app"]) {
    const command = tauriDevCommand(root, "http://127.0.0.1:49152", [], env);
    assert.equal(command.env.SITUATE_DICTATION_MODEL_SOURCE, source);
  }
});

test("an explicit model source reaches the build unchanged, including an empty value", () => {
  for (const source of ["/local models/parakeet", ""]) {
    const env = dictationDevEnvironment({
      SITUATE_DICTATION_MODEL_SOURCE: source,
      UNRELATED: "not forwarded",
    });
    assert.deepEqual(env, { SITUATE_DICTATION_MODEL_SOURCE: source });
    const command = tauriDevCommand("/app", "http://127.0.0.1:49152", [], env);
    assert.equal(command.env.SITUATE_DICTATION_MODEL_SOURCE, source);
  }
});
