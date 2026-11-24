import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const packageRoot = process.env.PI_PACKAGE_ROOT;
const require = createRequire(
  packageRoot ? join(packageRoot, "package.json") : import.meta.url,
);
const { createJiti } = require("jiti");
const { default: sonarPreflight } = await createJiti(import.meta.url).import(
  "./index.ts",
);

test("Pi requires confirmation before starting either preflight command", async () => {
  const commands = new Map();
  const invocations = [];
  sonarPreflight({
    registerCommand(name, { handler }) {
      commands.set(name, handler);
    },
    async exec(command, args, options) {
      invocations.push([command, args, options.cwd]);
      return {
        code: 0,
        stdout: "https://github.com/getsituate/situate/pull/42\n",
        stderr: "",
      };
    },
  });
  const ctx = {
    hasUI: true,
    cwd: "/synthetic-worktree",
    ui: { confirm: async () => false, notify() {}, setStatus() {} },
  };
  await commands.get("pr-check")("", ctx);
  await commands.get("pr-open")("", ctx);
  assert.deepEqual(invocations, []);

  ctx.ui.confirm = async () => true;
  await commands.get("pr-check")("", ctx);
  await commands.get("pr-open")("", ctx);
  assert.deepEqual(invocations, [
    ["volta", ["run", "node", "tools/sonar-preflight.mjs", "check"], ctx.cwd],
    ["volta", ["run", "node", "tools/sonar-preflight.mjs", "open"], ctx.cwd],
  ]);
});
