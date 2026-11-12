import type { Plugin } from "vite";

export function releaseHistoryPlugin(options: {
  repoRoot: string;
  version: string;
  environment?: NodeJS.ProcessEnv;
}): Plugin;
