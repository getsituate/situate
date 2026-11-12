import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assert } from "./release-catalog.mjs";

export function agentEnvironment(directory) {
  return {
    PATH: path.dirname(process.execPath),
    HOME: directory,
    TMPDIR: directory,
    LANG: "en_US.UTF-8",
    NO_COLOR: "1",
  };
}
export function createReleaseAgent(config, { allowModelCall = false } = {}) {
  assert(
    allowModelCall,
    "Model invocation requires --allow-model-call and explicit provider/model configuration",
  );
  assert(
    config &&
      typeof config.provider === "string" &&
      typeof config.model === "string" &&
      config.provider.length > 0 &&
      config.model.length > 0 &&
      /^[A-Z][A-Z0-9_]*$/u.test(config.apiKeyEnv),
    "Configure provider, model and apiKeyEnv explicitly in .release-preparation/agent.json or CLI arguments",
  );
  const apiKey = process.env[config.apiKeyEnv];
  assert(
    typeof apiKey === "string" && apiKey.length > 0,
    "Configured model credential is unavailable",
  );
  return async (request, { signal } = {}) => {
    signal?.throwIfAborted();
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "situate-release-agent-"),
    );
    fs.chmodSync(directory, 0o700);
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL("./release-agent-worker.mjs", import.meta.url),
            ),
          ],
          {
            cwd: directory,
            env: agentEnvironment(directory),
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let output = "",
          oversized = false;
        const cancel = () => child.kill("SIGTERM");
        signal?.addEventListener("abort", cancel, { once: true });
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.length > 64000) {
            oversized = true;
            child.kill("SIGTERM");
          }
        });
        // Provider diagnostics may include request content; do not forward them to normal logs.
        child.stderr.resume();
        child.on("error", reject);
        child.on("close", (code) => {
          signal?.removeEventListener("abort", cancel);
          if (signal?.aborted)
            return reject(signal.reason ?? new Error("Cancelled"));
          if (code !== 0 || oversized)
            return reject(
              new Error(
                "Release model failed; preparation is incomplete. No automatic retry was attempted.",
              ),
            );
          try {
            resolve(JSON.parse(output));
          } catch {
            reject(
              new Error(
                "Release model returned invalid JSON; no automatic retry was attempted",
              ),
            );
          }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(
          JSON.stringify({
            provider: config.provider,
            model: config.model,
            apiKey,
            request,
          }),
        );
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}
