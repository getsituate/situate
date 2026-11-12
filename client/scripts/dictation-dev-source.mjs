import { homedir } from "node:os";
import { join } from "node:path";

export function dictationDevEnvironment(env = process.env) {
  return {
    SITUATE_DICTATION_MODEL_SOURCE:
      env.SITUATE_DICTATION_MODEL_SOURCE ??
      join(homedir(), "Library", "Caches", "Situate", "Dictation"),
  };
}
