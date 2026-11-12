import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const packageRoot = process.env.PI_PACKAGE_ROOT;
const require = createRequire(
  packageRoot ? join(packageRoot, "package.json") : import.meta.url,
);
const sdkPath = packageRoot
  ? join(packageRoot, "dist/index.js")
  : fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": sdkPath,
    "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
  },
});
const { default: roleSwitcher } = await jiti.import("./index.ts");
const {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} = await import(pathToFileURL(sdkPath).href);

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await delay(25);
  }
  assert.ok(check(), "MCP lifecycle did not settle");
}

async function verifyRoleLifecycle(t, startupRole) {
  const previousExitCode = process.exitCode;
  const exitListeners = new Set(process.listeners("exit"));
  t.after(() => {
    process.exitCode = previousExitCode;
    for (const listener of process.listeners("exit")) {
      if (!exitListeners.has(listener))
        process.removeListener("exit", listener);
    }
  });
  const cwd = mkdtempSync(join(tmpdir(), "role-mcp-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 204 : 405).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    requests.push({ path: request.url, method: message.method });
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const results = {
      initialize: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "references", version: "1" },
      },
      "tools/list": {
        tools: [
          {
            name: "lookup",
            description: "Look up a design reference",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
      "tools/call": { content: [{ type: "text", text: "Reference" }] },
      ping: {},
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: results[message.method] ?? {},
      }),
    );
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const roleDir = join(cwd, ".pi/role-mode/roles");
  const projectRole = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../role-mode/roles/product-designer/role.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(projectRole.mcpServers).sort(), [
    "inspo",
    "ui-skills",
  ]);
  for (const name of ["ceo", "cto", "product-designer"]) {
    mkdirSync(join(roleDir, name), { recursive: true });
    const mcpServers =
      name === "product-designer"
        ? Object.fromEntries(
            Object.entries(projectRole.mcpServers).map(([key, config]) => [
              key,
              { ...config, url: `${url}/${key}` },
            ]),
          )
        : {};
    writeFileSync(
      join(roleDir, name, "role.json"),
      JSON.stringify({ name, label: name, mcpServers }),
    );
    writeFileSync(join(roleDir, name, "SYSTEM.md"), `Work as ${name}.`);
  }
  const agentDir = join(cwd, "agent");
  mkdirSync(agentDir);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      roleSwitcher,
      createCodemodeExtension(),
      createMcpExtension({
        loadConfig: () => ({ servers: [], errors: [] }),
        logPath: join(agentDir, "mcp.log"),
      }),
    ],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    settingsManager,
    modelRuntime,
    sessionManager: SessionManager.inMemory(cwd),
  });
  t.after(async () => {
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "exit",
    });
    session.dispose();
  });
  const errors = [];
  let reloads = 0,
    shutdowns = 0;
  if (startupRole !== undefined)
    session.extensionRunner.setFlagValue("role", startupRole);
  await session.bindExtensions({
    shutdownHandler: () => {
      shutdowns++;
    },
    onError: (error) => errors.push(error),
    commandContextActions: {
      reload: async () => {
        await session.reload();
        reloads++;
      },
    },
  });
  const visibleMcpTools = () =>
    session
      .getAllTools()
      .filter(
        (tool) => tool.name.startsWith("mcp__") && tool.exposure !== "hidden",
      );
  // Tool identifiers normalize hyphens; server keys and HTTP paths keep their original spelling.
  const expectedMcpTools = ["mcp__inspo__lookup", "mcp__ui_skills__lookup"];
  if (startupRole === "unknown-role") {
    assert.equal(shutdowns, 1);
    assert.equal(process.exitCode, 2);
    let agentStarts = 0;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_start") agentStarts++;
    });
    t.after(unsubscribe);
    await session.prompt("Do not start a model turn with an invalid role.");
    assert.equal(agentStarts, 0);
    assert.equal(requests.length, 0);
    assert.deepEqual(errors, []);
    return;
  }
  if (startupRole === "product-designer") {
    await until(() => visibleMcpTools().length === 2);
    assert.deepEqual(
      visibleMcpTools()
        .map((tool) => tool.name)
        .sort(),
      expectedMcpTools,
    );
    assert.equal(
      session.sessionManager.getBranch().at(-1).data.role,
      startupRole,
    );
    await session.reload();
    await until(() => visibleMcpTools().length === 2);
    await session.prompt("/role off");
    await until(() => visibleMcpTools().length === 0);
    await session.reload();
    await delay(100);
    assert.deepEqual(visibleMcpTools(), []);
    requests.length = 0;
  }
  await delay(50);
  assert.equal(requests.length, 0);
  assert.deepEqual(visibleMcpTools(), []);
  for (const name of ["ceo", "cto", "off"]) {
    await session.prompt(`/role ${name}`);
    assert.deepEqual(visibleMcpTools(), []);
  }
  assert.equal(requests.length, 0);

  for (const nextRole of ["ceo", "cto", "off"]) {
    await session.prompt("/role product-designer");
    await until(() => visibleMcpTools().length === 2);
    assert.deepEqual(
      visibleMcpTools()
        .map((tool) => tool.name)
        .sort(),
      expectedMcpTools,
    );
    assert.ok(
      requests.some(
        (request) =>
          request.path === "/ui-skills" && request.method === "tools/list",
      ),
    );
    assert.ok(
      requests.some(
        (request) =>
          request.path === "/inspo" && request.method === "tools/list",
      ),
    );
    await session.reload();
    await until(() => visibleMcpTools().length === 2);
    assert.deepEqual(
      visibleMcpTools()
        .map((tool) => tool.name)
        .sort(),
      expectedMcpTools,
    );
    await session.prompt(`/role ${nextRole}`);
    await until(() => visibleMcpTools().length === 0);
    const count = requests.length;
    await session.reload();
    await delay(100);
    assert.deepEqual(visibleMcpTools(), []);
    assert.equal(
      requests.length,
      count,
      "Inactive roles must not reconnect design servers",
    );
  }
  let agentStarts = 0;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "agent_start") agentStarts++;
  });
  t.after(unsubscribe);
  const beforeRole = session.sessionManager.appendMessage({
    role: "user",
    content: "Before selecting a role",
    timestamp: Date.now(),
  });
  await session.prompt("/role ceo");
  const afterRole = session.sessionManager.appendMessage({
    role: "user",
    content: "After selecting a role",
    timestamp: Date.now(),
  });
  const entries = structuredClone(session.sessionManager.getEntries());
  for (const target of [beforeRole, afterRole, afterRole, beforeRole]) {
    const previousReloads = reloads;
    const result = await session.navigateTree(target);
    assert.equal(result.cancelled, false);
    await until(
      () => reloads > previousReloads || errors.length > 0 || agentStarts > 0,
    );
    assert.deepEqual(errors, []);
    assert.equal(
      agentStarts,
      0,
      "Restoring a role must not start an agent turn",
    );
    assert.equal(reloads, previousReloads + 1);
    assert.deepEqual(
      session.sessionManager.getEntries(),
      entries,
      "Navigation must not append chat messages or role changes",
    );
  }
  assert.deepEqual(errors, []);
}

for (const startupRole of [undefined, "product-designer", "unknown-role"]) {
  test(
    `Pi role lifecycle with startup role ${startupRole ?? "unset"}`,
    { timeout: 30_000 },
    (t) => verifyRoleLifecycle(t, startupRole),
  );
}
