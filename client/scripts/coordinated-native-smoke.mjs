import { fileURLToPath } from "node:url";
import { runCoordinated } from "../../tools/run-coordinated.mjs";

export async function runCoordinatedSmokePhase(
  executable,
  { cwd, env, signal, ...phase },
  run = runCoordinated,
) {
  signal?.throwIfAborted();
  const code = await run({
    directory: cwd,
    resource: "desktop",
    command: process.execPath,
    args: [
      fileURLToPath(new URL("./native-smoke-phase.mjs", import.meta.url)),
      JSON.stringify({ executable, ...phase }),
    ],
    environment: { ...process.env, ...env },
    signal,
  });
  if (code !== 0)
    throw new Error(
      `Native smoke phase failed: ${phase.phase ?? "verification"} (exit ${code})`,
    );
}
