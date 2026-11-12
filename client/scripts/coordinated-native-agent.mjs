import { Writable } from "node:stream";
import { runCoordinated } from "../../tools/run-coordinated.mjs";
import { AgentRunError } from "./agent-e2e-runtime.mjs";

export async function runCoordinatedNativeAgent(
  command,
  args,
  { cwd, env, timeoutMs, signal } = {},
  run = runCoordinated,
) {
  if (signal?.aborted) throw new AgentRunError("cancel", "interrupted");
  const timeout = AbortSignal.timeout(Math.ceil(timeoutMs));
  const lifetime = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  try {
    const code = await run({
      directory: cwd,
      resource: "desktop",
      command,
      args,
      environment: env,
      signal: lifetime,
      output,
    });
    if (signal?.aborted) throw new AgentRunError("cancel", "interrupted");
    if (timeout.aborted) throw new AgentRunError("budget", "deadline-exceeded");
    if (code === 2) {
      const error = new AgentRunError("blocked", "process-cleanup-failed");
      error.cleanupUnsafe = true;
      throw error;
    }
    if (code !== 0) throw new AgentRunError("product", "child-failed");
  } catch (error) {
    if (error instanceof AgentRunError) throw error;
    const failure = new AgentRunError("blocked", "process-cleanup-failed");
    failure.cleanupUnsafe = true;
    throw failure;
  } finally {
    output.end();
  }
}
