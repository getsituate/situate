import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

export async function voltaTools(
  pi: ExtensionAPI,
  root: string,
  signal: AbortSignal,
): Promise<string[]> {
  const tools: string[] = [];
  for (const tool of ["node", "npm", "npx"]) {
    signal.throwIfAborted();
    const result = await pi.exec("volta", ["which", tool], {
      cwd: root,
      signal,
      timeout: 10000,
    });
    const executable = result.stdout.trim();
    if (result.code !== 0 || result.killed || !isAbsolute(executable))
      throw new Error(`Volta could not resolve the project's ${tool}.`);
    tools.push(await realpath(executable));
  }
  return tools;
}
