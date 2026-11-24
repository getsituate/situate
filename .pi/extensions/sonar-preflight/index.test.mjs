import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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

function fixture(node) {
  const commands = new Map();
  const events = new Map();
  const prompts = [];
  const git = new Map([["status --porcelain --untracked-files=all", ""]]);
  sonarPreflight({
    registerCommand: (name, { handler }) => commands.set(name, handler),
    on: (name, handler) => events.set(name, handler),
    sendUserMessage: (...args) => prompts.push(args),
    async exec(command, args) {
      if (command === "git") {
        assert.ok(git.has(args.join(" ")), args.join(" "));
        return { code: 0, stdout: git.get(args.join(" ")) };
      }
      assert.ok(node, "should not resolve Node before approval");
      assert.deepEqual([command, args], ["volta", ["which", "node"]]);
      return { code: 0, stdout: node };
    },
  });
  return { commands, events, prompts, git };
}

test("Pi requires confirmation before starting either preflight command", async () => {
  const { commands } = fixture();
  const ctx = {
    mode: "tui",
    ui: {
      confirm: async () => false,
      custom: () => assert.fail("should not start"),
    },
  };
  await commands.get("pr-check")("", ctx);
  await commands.get("pr-open")("", ctx);
});

for (const outcome of [
  "committed",
  "still dirty",
  "nothing committed",
  "aborted",
]) {
  test(`commit handoff: ${outcome}`, async () => {
    const { commands, events, prompts, git } = fixture(process.execPath);
    const notifications = [];
    let confirmations = 0;
    let scans = 0;
    const ctx = {
      cwd: "/synthetic-worktree",
      mode: "tui",
      model: {},
      isIdle: () => true,
      ui: {
        confirm: async (title) => {
          assert.equal(title, "Commit and run SonarCloud analysis?");
          confirmations++;
          return true;
        },
        notify: (message) => notifications.push(message),
        custom: async () => {
          scans++;
          return { message: "Scan complete", level: "info" };
        },
      },
    };
    git.set("status --porcelain --untracked-files=all", " M tools/example.mjs");
    git.set("branch --show-current", "feature");
    git.set("rev-parse HEAD", "original-head");
    await commands.get("pr-check")("", ctx);
    assert.equal(scans, 0);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0][0], /create one local commit/);
    events.get("before_agent_start")(
      { messageType: "user", prompt: prompts[0][0] },
      ctx,
    );

    git.set(
      "status --porcelain --untracked-files=all",
      outcome === "still dirty" ? "?? unrelated.txt" : "",
    );
    git.set(
      "log -1 --format=%P",
      outcome === "nothing committed" ? "older-head" : "original-head",
    );
    events.get("agent_settled")({ aborted: outcome === "aborted" }, ctx);
    if (outcome === "aborted") {
      assert.equal(prompts.length, 1);
      assert.match(notifications.at(-1), /cancelled/);
    } else {
      assert.deepEqual(prompts[1], [
        "/pr-check",
        { expandPromptTemplates: true },
      ]);
      await commands.get("pr-check")("", ctx);
      if (outcome !== "committed")
        assert.match(notifications.at(-1), /SonarCloud did not run/);
    }
    assert.equal(scans, outcome === "committed" ? 1 : 0);
    assert.equal(confirmations, 1);
  });
}

test(
  "streams progress while blocking the editor and releases it after Esc",
  { timeout: 5000 },
  async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "sonar-preflight-ui-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const node = join(cwd, "node");
    writeFileSync(
      node,
      "#!/bin/sh\necho 'Measuring Vue coverage…'\nexec sleep 4\n",
      { mode: 0o755 },
    );

    const { commands } = fixture(node);
    const progress = Promise.withResolvers();
    const notifications = [];
    let component;
    const ctx = {
      cwd,
      mode: "tui",
      ui: {
        confirm: async () => true,
        notify: (...args) => notifications.push(args),
        custom: (mount) =>
          new Promise((done) => {
            component = mount(
              {
                requestRender: () => {
                  if (component.render(100).includes("Measuring Vue coverage…"))
                    progress.resolve();
                },
              },
              { fg: (_, value) => value },
              {
                matches: (input, action) =>
                  input === "\x1b" && action === "tui.select.cancel",
              },
              done,
            );
          }),
      },
    };
    let returned = false;
    const command = commands
      .get("pr-check")("", ctx)
      .then(() => {
        returned = true;
      });
    await progress.promise;
    assert.equal(returned, false);
    assert.ok(component.render(100).includes("Esc to cancel"));
    component.handleInput("\x1b");
    await command;
    assert.match(notifications[0][0], /preflight cancelled/);
  },
);
