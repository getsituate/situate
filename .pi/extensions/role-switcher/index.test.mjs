import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(
  process.env.PI_PACKAGE_ROOT
    ? join(process.env.PI_PACKAGE_ROOT, "package.json")
    : import.meta.url,
);
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": process.env.PI_PACKAGE_ROOT
      ? join(process.env.PI_PACKAGE_ROOT, "dist/index.js")
      : import.meta.resolve("@earendil-works/pi-coding-agent"),
    "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
  },
});
const { default: extension } = await jiti.import("./index.ts");

function fixture(t, dispatchCommands = false, roleFlag) {
  const cwd = mkdtempSync(join(tmpdir(), "role-lifecycle-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const role = join(cwd, ".pi/role-mode/roles/writer");
  mkdirSync(role, { recursive: true });
  writeFileSync(join(role, "SYSTEM.md"), "Write precisely.");
  writeFileSync(
    join(role, "role.json"),
    JSON.stringify({ name: "writer", label: "Writer", skills: ["writing"] }),
  );
  const skill = join(cwd, ".pi/role-mode/skill-library/writing");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "Writing guidance");
  const handlers = {},
    commands = {},
    messages = [],
    branch = [];
  let idle = true,
    reloads = 0,
    shutdowns = 0,
    loadedSkills = [];
  const flags = {};
  const dispatched = [],
    registrations = [],
    unregistrations = [],
    notices = [];
  const servers = new Map();
  const ctx = {
    cwd,
    sessionManager: { getBranch: () => branch },
    isIdle: () => idle,
    shutdown: () => {
      shutdowns++;
    },
    ui: { notify: (...args) => notices.push(args), setWidget() {} },
    reload: async () => {
      reloads++;
      loadedSkills = (await handlers.resources_discover({}, ctx)).skillPaths;
    },
  };
  const pi = {
    on: (name, fn) => {
      handlers[name] = fn;
    },
    registerCommand: (name, def) => {
      commands[name] = def;
    },
    registerFlag: (name, definition) => {
      flags[name] = definition;
    },
    getFlag: (name) => (name === "role" ? roleFlag : undefined),
    registerMcpServer(name, config) {
      if (!config || (!config.url && !config.command))
        throw new Error("Missing MCP transport");
      servers.set(name, structuredClone(config));
      registrations.push(name);
    },
    unregisterMcpServer(name) {
      servers.delete(name);
      unregistrations.push(name);
    },
    registerEntryRenderer() {},
    appendEntry: (customType, data) =>
      branch.push({ type: "custom", customType, data }),
    sendUserMessage: (...args) => {
      messages.push(args);
      if (dispatchCommands && args[1]?.expandPromptTemplates === true) {
        dispatched.push(
          commands.role.handler(args[0].slice("/role ".length), ctx),
        );
      }
    },
  };
  extension(pi);
  t.after(() => handlers.session_shutdown({}, ctx));
  return {
    ctx,
    handlers,
    commands,
    messages,
    branch,
    dispatched,
    servers,
    registrations,
    unregistrations,
    notices,
    loadedSkills: () => loadedSkills,
    flags,
    recreateExtension: () => extension(pi),
    shutdowns: () => shutdowns,
    idle: (value) => {
      idle = value;
    },
    reloads: () => reloads,
  };
}

test("startup role is persisted before skill discovery and configures the first turn and MCP", async (t) => {
  const f = fixture(t, false, "writer");
  configureMcp(f, designServers);
  assert.equal(f.flags.role.type, "string");
  await f.handlers.session_start({ reason: "startup" }, f.ctx);
  assert.equal(f.branch.at(-1).data.role, "writer");
  assert.deepEqual(Object.fromEntries(f.servers), designServers);
  assert.equal(
    (await f.handlers.resources_discover({}, f.ctx)).skillPaths.length,
    1,
  );
  const event = { systemPromptOptions: { sections: {} } };
  await f.handlers.before_agent_start(event, f.ctx);
  assert.match(
    event.systemPromptOptions.sections.active_role,
    /Write precisely/,
  );
  assert.deepEqual(await f.handlers.input({}, f.ctx), { action: "continue" });
  assert.equal(f.reloads(), 0);
  assert.equal(f.shutdowns(), 0);
});

for (const flag of ["writer", "off", undefined]) {
  test(`startup flag ${flag} takes precedence over saved state only when supplied`, async (t) => {
    const f = fixture(t, false, flag);
    f.branch.push({
      type: "custom",
      customType: "role-switcher:change",
      data: { role: flag === "writer" ? "off" : "writer" },
    });
    await f.handlers.session_start({ reason: "startup" }, f.ctx);
    assert.equal(f.branch.at(-1).data.role, flag ?? "writer");
    assert.equal(
      (await f.handlers.resources_discover({}, f.ctx)).skillPaths.length,
      flag === "off" ? 0 : 1,
    );
  });
}

test("new sessions without a startup flag remain off", async (t) => {
  const f = fixture(t);
  await f.handlers.session_start({ reason: "startup" }, f.ctx);
  assert.equal(f.branch.length, 0);
  assert.deepEqual(
    (await f.handlers.resources_discover({}, f.ctx)).skillPaths,
    [],
  );
});

test("startup flag does not override later commands, reloads, session changes, or tree navigation", async (t) => {
  const f = fixture(t, false, "writer");
  await f.handlers.session_start({ reason: "startup" }, f.ctx);
  await f.commands.role.handler("off", f.ctx);
  f.recreateExtension();
  for (const reason of ["reload", "resume", "new", "fork"]) {
    await f.handlers.session_start({ reason }, f.ctx);
    assert.deepEqual(
      (await f.handlers.resources_discover({}, f.ctx)).skillPaths,
      [],
    );
  }
  const count = f.branch.length;
  await f.handlers.session_tree({}, f.ctx);
  assert.deepEqual(
    (await f.handlers.resources_discover({}, f.ctx)).skillPaths,
    [],
  );
  assert.equal(f.branch.length, count);
});

for (const flag of ["missing", "", "   "]) {
  test(`invalid startup role ${JSON.stringify(flag)} requests shutdown and blocks input`, async (t) => {
    const previousExitCode = process.exitCode;
    const exitListeners = new Set(process.listeners("exit"));
    t.after(() => {
      process.exitCode = previousExitCode;
      for (const listener of process.listeners("exit")) {
        if (!exitListeners.has(listener))
          process.removeListener("exit", listener);
      }
    });
    const f = fixture(t, false, flag);
    configureMcp(f, designServers);
    f.branch.push({
      type: "custom",
      customType: "role-switcher:change",
      data: { role: "writer" },
    });
    await f.handlers.session_start({ reason: "startup" }, f.ctx);
    assert.equal(f.shutdowns(), 1);
    assert.equal(process.exitCode, 2);
    const exitListener = process
      .listeners("exit")
      .find((listener) => !exitListeners.has(listener));
    assert.ok(exitListener);
    process.exitCode = 0;
    exitListener(0);
    assert.equal(process.exitCode, 2);
    assert.ok(
      f.notices.some(
        ([message, level]) =>
          level === "error" && message.includes("Unknown startup role"),
      ),
    );
    assert.deepEqual(await f.handlers.input({}, f.ctx), { action: "handled" });
    assert.deepEqual(
      (await f.handlers.resources_discover({}, f.ctx)).skillPaths,
      [],
    );
    assert.equal(f.servers.size, 0);
    assert.equal(f.branch.length, 1);
  });
}

test("role sections preserve other sections and clear on off; state resumes from the branch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  await f.handlers.session_start({}, f.ctx);
  await f.commands.role.handler("writer", f.ctx);
  assert.equal(f.branch[0].data.role, "writer");
  assert.equal(
    (await f.handlers.resources_discover({}, f.ctx)).skillPaths.length,
    1,
  );
  const event = { systemPromptOptions: { sections: { other: "untouched" } } };
  assert.equal(await f.handlers.before_agent_start(event, f.ctx), undefined);
  assert.match(
    event.systemPromptOptions.sections.active_role,
    /Write precisely/,
  );
  await f.handlers.session_start({ reason: "resume" }, f.ctx);
  await f.handlers.before_agent_start(event, f.ctx);
  assert.match(
    event.systemPromptOptions.sections.active_role,
    /Write precisely/,
  );
  f.branch.length = 0;
  await f.handlers.session_tree({}, f.ctx);
  await f.handlers.before_agent_start(event, f.ctx);
  assert.deepEqual(event.systemPromptOptions.sections, { other: "untouched" });
  t.mock.timers.tick(1);
  assert.deepEqual(f.messages.at(-1), [
    "/role off",
    { deliverAs: "followUp", expandPromptTemplates: true },
  ]);
  assert.deepEqual(
    (await f.handlers.resources_discover({}, f.ctx)).skillPaths,
    [],
  );
});

test("tree reload waits for navigation to become idle without requiring agent settlement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t, true);
  await f.handlers.session_start({}, f.ctx);
  f.branch.push({
    type: "custom",
    customType: "role-switcher:change",
    data: { role: "writer" },
  });
  f.idle(false);
  await f.handlers.session_tree({}, f.ctx);
  assert.equal(f.messages.length, 0);
  t.mock.timers.tick(1);
  assert.equal(f.messages.length, 0);
  assert.equal(f.reloads(), 0);
  f.idle(true);
  t.mock.timers.tick(10);
  await Promise.all(f.dispatched);
  assert.equal(f.messages.length, 1);
  assert.equal(f.reloads(), 1);
  assert.equal(f.loadedSkills().length, 1);
  t.mock.timers.tick(100);
  assert.equal(f.messages.length, 1);
});

for (const boundary of ["session_shutdown", "session_start"]) {
  test(`${boundary} cancels deferred navigation reload before touching stale context`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(t, true);
    f.idle(false);
    await f.handlers.session_tree({}, f.ctx);
    t.mock.timers.tick(1);
    await f.handlers[boundary]({}, f.ctx);
    f.ctx.isIdle = () => {
      throw new Error("Stale context");
    };
    t.mock.timers.tick(100);
    assert.equal(f.messages.length, 0);
    assert.equal(f.reloads(), 0);
  });
}

test("simultaneous runtimes never share active or queued roles", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  await a.handlers.session_start({}, a.ctx);
  await b.handlers.session_start({}, b.ctx);
  await a.commands.role.handler("writer", a.ctx);
  const event = () => ({ systemPromptOptions: { sections: {} } });
  const first = event(),
    second = event();
  await a.handlers.before_agent_start(first, a.ctx);
  await b.handlers.before_agent_start(second, b.ctx);
  assert.match(
    first.systemPromptOptions.sections.active_role,
    /Write precisely/,
  );
  assert.equal(second.systemPromptOptions.sections.active_role, undefined);
  a.idle(false);
  await a.commands.role.handler("off", a.ctx);
  await b.handlers.agent_settled({}, b.ctx);
  assert.equal(b.messages.length, 0);
  await a.handlers.agent_settled({}, a.ctx);
  assert.deepEqual(a.messages, [
    ["/role off", { deliverAs: "followUp", expandPromptTemplates: true }],
  ]);
});

test("queued switches dispatch once only after settlement, with reload in the command", async (t) => {
  const f = fixture(t);
  await f.handlers.session_start({}, f.ctx);
  f.idle(false);
  await f.commands.role.handler("writer", f.ctx);
  assert.equal(f.handlers.agent_end, undefined);
  assert.equal(f.messages.length, 0);
  await f.handlers.agent_settled({}, f.ctx);
  await f.handlers.agent_settled({}, f.ctx);
  assert.deepEqual(f.messages, [
    ["/role writer", { deliverAs: "followUp", expandPromptTemplates: true }],
  ]);
  assert.equal(f.reloads(), 0);
  f.idle(true);
  await f.commands.role.handler("writer", f.ctx);
  assert.equal(f.reloads(), 1);
});

test("arc42 skills link to their bundled references and templates", () => {
  const library = fileURLToPath(
    new URL("../../role-mode/skill-library/", import.meta.url),
  );
  const chapters = readdirSync(library).filter((name) =>
    name.startsWith("arc42-chapter-"),
  );
  assert.equal(chapters.length, 12);
  for (const chapter of chapters) {
    const root = join(library, chapter);
    const pending = [join(root, "SKILL.md")];
    const visited = new Set();
    while (pending.length) {
      const file = pending.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split("#")[0];
        if (!target.endsWith(".md") || /^[a-z]+:/i.test(target)) continue;
        const linked = resolve(dirname(file), target);
        assert.doesNotThrow(
          () => readFileSync(linked, "utf8"),
          `${file}: missing resource ${target}`,
        );
        if (linked.startsWith(`${root}/`)) pending.push(linked);
      }
    }
    for (const file of readdirSync(root, { recursive: true })) {
      if (!file.endsWith(".md")) continue;
      assert.ok(
        visited.has(join(root, file)),
        `${chapter}: unreachable resource ${file}`,
      );
    }
  }
});

test("project roles load their complete skill sets and replace removed roles safely", async (t) => {
  const f = fixture(t);
  f.ctx.cwd = fileURLToPath(new URL("../../../", import.meta.url));
  const root = join(f.ctx.cwd, ".pi/role-mode");
  assert.deepEqual(readdirSync(join(root, "roles")).sort(), [
    "ceo",
    "cto",
    "dev-ops",
    "developer",
    "product-designer",
  ]);
  const { loadSkillsFromDir } = await import(
    process.env.PI_PACKAGE_ROOT
      ? pathToFileURL(join(process.env.PI_PACKAGE_ROOT, "dist/index.js")).href
      : "@earendil-works/pi-coding-agent"
  );
  const loaded = loadSkillsFromDir({
    dir: join(root, "skill-library"),
    source: "project",
  });
  assert.deepEqual(loaded.diagnostics, []);
  const available = new Set(loaded.skills.map((skill) => skill.name));
  const assigned = new Set();
  const event = { systemPromptOptions: { sections: {} } };
  for (const name of [
    "ceo",
    "cto",
    "dev-ops",
    "developer",
    "product-designer",
  ]) {
    const role = JSON.parse(
      readFileSync(join(root, "roles", name, "role.json"), "utf8"),
    );
    assert.equal(role.name, name);
    assert.equal(new Set(role.skills).size, role.skills.length);
    for (const skill of role.skills) {
      assert.ok(available.has(skill), `${name}: missing skill ${skill}`);
      assigned.add(skill);
    }
    await f.commands.role.handler(name, f.ctx);
    assert.deepEqual(Object.fromEntries(f.servers), role.mcpServers ?? {});
    assert.deepEqual(
      f.loadedSkills().sort(),
      role.skills.map((skill) => join(root, "skill-library", skill)).sort(),
    );
    await f.handlers.before_agent_start(event, f.ctx);
    assert.match(
      event.systemPromptOptions.sections.active_role,
      new RegExp(`# ${role.label}\\b`),
    );
  }
  await f.handlers.session_start({ reason: "resume" }, f.ctx);
  await f.handlers.before_agent_start(event, f.ctx);
  assert.match(
    event.systemPromptOptions.sections.active_role,
    /# Product Designer\b/,
  );
  await f.commands.role.handler("developer", f.ctx);
  assert.equal(f.servers.size, 0);
  assert.ok(
    f
      .loadedSkills()
      .includes(join(root, "skill-library", "clean-code-principles")),
  );
  await f.handlers.session_start({ reason: "resume" }, f.ctx);
  await f.handlers.before_agent_start(event, f.ctx);
  assert.match(event.systemPromptOptions.sections.active_role, /# Developer\b/);
  assert.ok(
    !f.loadedSkills().includes(join(root, "skill-library", "ux-discovery")),
  );
  await f.handlers.before_agent_start(event, f.ctx);
  assert.doesNotMatch(
    event.systemPromptOptions.sections.active_role,
    /# Product Designer\b/,
  );
  await f.commands.role.handler("off", f.ctx);
  assert.deepEqual(f.loadedSkills(), []);
  await f.handlers.before_agent_start(event, f.ctx);
  assert.equal(event.systemPromptOptions.sections.active_role, undefined);
  assert.deepEqual([...assigned].sort(), [...available].sort());
  assert.equal(
    [...available].filter((name) => name.startsWith("arc42-chapter-")).length,
    12,
  );
  f.branch.push({
    type: "custom",
    customType: "role-switcher:change",
    data: { role: "requirements-engineer" },
  });
  await f.handlers.session_start({}, f.ctx);
  assert.deepEqual(
    (await f.handlers.resources_discover({}, f.ctx)).skillPaths,
    [],
  );
  await f.handlers.before_agent_start(event, f.ctx);
  assert.equal(event.systemPromptOptions.sections.active_role, undefined);
});

function configureMcp(f, mcpServers) {
  writeFileSync(
    join(f.ctx.cwd, ".pi/role-mode/roles/writer/role.json"),
    JSON.stringify({
      name: "writer",
      label: "Writer",
      skills: ["writing"],
      mcpServers,
    }),
  );
}

const designServers = {
  references: { url: "https://references.example/mcp", exposure: "codemode" },
  guidance: { url: "https://guidance.example/mcp", exposure: "codemode" },
};

test("MCP servers are role-scoped, idempotent, and do not affect unrelated servers", async (t) => {
  const f = fixture(t);
  configureMcp(f, designServers);
  f.servers.set("unrelated", { url: "https://unrelated.example/mcp" });
  await f.handlers.resources_discover({}, f.ctx);
  await f.handlers.session_start({}, f.ctx);
  assert.deepEqual(f.registrations, []);
  await f.commands.role.handler("writer", f.ctx);
  assert.deepEqual(f.registrations, ["references", "guidance"]);
  await f.handlers.resources_discover({}, f.ctx);
  await f.handlers.session_start({ reason: "resume" }, f.ctx);
  assert.equal(f.registrations.length, 2);
  await f.commands.role.handler("off", f.ctx);
  assert.deepEqual([...f.servers.keys()], ["unrelated"]);
  assert.deepEqual(f.unregistrations, ["references", "guidance"]);
  await f.handlers.session_shutdown({}, f.ctx);
  assert.deepEqual([...f.servers.keys()], ["unrelated"]);
});

test("MCP configuration changes replace connections and disabled entries are not registered", async (t) => {
  const f = fixture(t);
  configureMcp(f, designServers);
  await f.commands.role.handler("writer", f.ctx);
  configureMcp(f, {
    references: { url: "https://other.example/mcp", exposure: "codemode" },
    guidance: { ...designServers.guidance, enabled: false },
  });
  await f.handlers.resources_discover({}, f.ctx);
  assert.deepEqual([...f.servers.keys()], ["references"]);
  assert.equal(f.servers.get("references").url, "https://other.example/mcp");
  assert.deepEqual(f.unregistrations, ["references", "guidance"]);
  configureMcp(f, {});
  await f.handlers.resources_discover({}, f.ctx);
  assert.equal(f.servers.size, 0);
});

test("MCP restoration follows the selected branch and removes a deleted role", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  configureMcp(f, designServers);
  f.branch.push({
    type: "custom",
    customType: "role-switcher:change",
    data: { role: "writer" },
  });
  await f.handlers.session_start({ reason: "resume" }, f.ctx);
  assert.equal(f.servers.size, 2);
  await f.handlers.session_shutdown({}, f.ctx);
  await f.handlers.session_shutdown({}, f.ctx);
  assert.equal(f.servers.size, 0);
  await f.handlers.resources_discover({}, f.ctx);
  assert.equal(f.servers.size, 2);
  f.branch.length = 0;
  await f.handlers.session_tree({}, f.ctx);
  assert.equal(f.servers.size, 0);
  f.branch.push({
    type: "custom",
    customType: "role-switcher:change",
    data: { role: "writer" },
  });
  await f.handlers.session_tree({}, f.ctx);
  assert.equal(f.servers.size, 2);
  rmSync(join(f.ctx.cwd, ".pi/role-mode/roles/writer"), { recursive: true });
  await f.handlers.resources_discover({}, f.ctx);
  assert.equal(f.servers.size, 0);
});

test("busy role changes leave MCP connections alone until activation and sessions stay isolated", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  configureMcp(a, designServers);
  configureMcp(b, designServers);
  await a.commands.role.handler("writer", a.ctx);
  await b.commands.role.handler("writer", b.ctx);
  a.idle(false);
  await a.commands.role.handler("off", a.ctx);
  assert.equal(a.servers.size, 2);
  await a.handlers.agent_settled({}, a.ctx);
  assert.equal(a.servers.size, 2);
  a.idle(true);
  await a.commands.role.handler("off", a.ctx);
  assert.equal(a.servers.size, 0);
  assert.equal(b.servers.size, 2);
  b.branch.length = 0;
  await b.handlers.session_start({ reason: "new" }, b.ctx);
  assert.equal(b.servers.size, 0);
});

test("invalid MCP entries report errors without retaining obsolete connections", async (t) => {
  const f = fixture(t);
  configureMcp(f, designServers);
  await f.commands.role.handler("writer", f.ctx);
  configureMcp(f, { references: {}, guidance: designServers.guidance });
  await f.handlers.resources_discover({}, f.ctx);
  assert.deepEqual([...f.servers.keys()], ["guidance"]);
  assert.ok(
    f.notices.some(
      ([text, level]) => level === "error" && text.includes('"references"'),
    ),
  );
  await f.commands.role.handler("off", f.ctx);
  assert.equal(f.servers.size, 0);
});

test("shutdown and session replacement discard queued switches; legacy entries restore", async (t) => {
  const f = fixture(t);
  f.branch.push({
    type: "custom",
    customType: "role-switcher:change",
    data: { text: "Role switched to Writer" },
  });
  await f.handlers.resources_discover({}, f.ctx);
  const event = { systemPromptOptions: { sections: {} } };
  await f.handlers.before_agent_start(event, f.ctx);
  assert.match(
    event.systemPromptOptions.sections.active_role,
    /Write precisely/,
  );
  f.idle(false);
  await f.commands.role.handler("off", f.ctx);
  await f.handlers.session_shutdown({}, f.ctx);
  await f.handlers.session_start({}, f.ctx);
  await f.handlers.agent_settled({}, f.ctx);
  assert.equal(f.messages.length, 0);
});
