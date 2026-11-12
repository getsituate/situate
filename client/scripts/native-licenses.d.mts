import type { Plugin } from "vite";
export function javascriptLicensesPlugin(options: {
  root: string;
  components?: Map<string, unknown>;
}): Plugin;
