import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fixtureTurn } from "./agent-e2e-fixture.mjs";
import { PINNED_AGENT_MODEL } from "./agent-e2e-provider.mjs";

export function defaultFinalArtifactConfiguration({
  account,
  routing,
  predecessor,
  runnerImage,
}) {
  return {
    profile: "macos-direct-v1",
    account,
    routing,
    predecessor,
    runnerImage,
  };
}

export function completionTurn(body) {
  assert(body.model === PINNED_AGENT_MODEL, "Unexpected fixture model");
  const input = [];
  for (const message of body.messages ?? []) {
    if (message.role === "tool")
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      });
    else {
      if (message.content)
        input.push({ role: message.role, content: message.content });
      for (const tool of message.tool_calls ?? [])
        input.push({
          type: "function_call",
          call_id: tool.id,
          name: tool.function.name,
          arguments: tool.function.arguments,
        });
    }
  }
  const kind = input.some(
    (message) =>
      ["system", "developer"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.startsWith("Write a short conversation title"),
  )
    ? "title"
    : "main";
  const turn = fixtureTurn(
    { input, tools: (body.tools ?? []).map((tool) => tool.function) },
    kind,
  );
  const items = Array.isArray(turn.item) ? turn.item : [turn.item];
  const calls = items.filter((item) => item.type === "function_call");
  return {
    role: "assistant",
    content:
      items
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content.map((part) => part.text))
        .join("\n") || null,
    ...(calls.length
      ? {
          tool_calls: calls.map((item) => ({
            id: item.call_id,
            type: "function",
            function: { name: item.name, arguments: item.arguments },
          })),
        }
      : {}),
  };
}

// The installed product exposes custom endpoints through Chat Completions, not Responses.
export async function startFinalArtifactProvider({
  signal,
  serverFactory = createServer,
} = {}) {
  signal?.throwIfAborted();
  const token = randomBytes(32).toString("hex");
  let requests = 0;
  let budgetDenials = 0;
  let bytes = 0;
  let failed = false;
  let active = 0;
  let outputBytes = 0;
  const started = Date.now();
  const server = serverFactory(async (req, res) => {
    active++;
    try {
      const supplied = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      assert(
        supplied.length === expected.length &&
          timingSafeEqual(supplied, expected),
        "Fixture authentication failed",
      );
      assert(active <= 2, "Fixture concurrency exceeded");
      if (req.method === "GET" && req.url === "/v1/models") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              { id: PINNED_AGENT_MODEL, object: "model", owned_by: "fixture" },
            ],
          }),
        );
        return;
      }
      assert(
        req.method === "POST" && req.url === "/v1/chat/completions",
        "Unexpected fixture request",
      );
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        assert(size <= 1024 * 1024, "Fixture request exceeds limit");
        chunks.push(chunk);
      }
      bytes += size;
      if (
        requests >= 64 ||
        bytes > 16 * 1024 * 1024 ||
        Date.now() - started > 300_000
      ) {
        budgetDenials++;
        throw new Error("Fixture budget exhausted");
      }
      requests++;
      const body = JSON.parse(Buffer.concat(chunks));
      const message = completionTurn(body);
      const generated = Buffer.byteLength(JSON.stringify(message));
      outputBytes += generated;
      assert(
        generated <= 4096 && outputBytes <= 65536,
        "Fixture output budget exceeded",
      );
      const finish_reason = message.tool_calls ? "tool_calls" : "stop";
      const id = `fixture-${requests}`;
      if (body.stream) {
        res.setHeader("content-type", "text/event-stream");
        const delta = { ...message };
        if (delta.tool_calls)
          delta.tool_calls = delta.tool_calls.map((call, index) => ({
            index,
            ...call,
          }));
        res.end(
          `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason }] })}\n\ndata: [DONE]\n\n`,
        );
      } else {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id,
            object: "chat.completion",
            model: body.model,
            choices: [{ index: 0, message, finish_reason }],
          }),
        );
      }
    } catch {
      failed = true;
      res.writeHead(400).end();
    } finally {
      active--;
    }
  });
  server.requestTimeout = 30_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let closing;
  const abort = () => {
    void close();
  };
  const close = () =>
    (closing ??= (async () => {
      signal?.removeEventListener("abort", abort);
      server.closeAllConnections();
      await new Promise((resolve) => {
        server.close(resolve);
      });
    })());
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    await close();
    signal.throwIfAborted();
  }
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    token,
    report: () => ({
      requests,
      budgetDenials,
      failed,
      pluginEffects: { POST: 0, DELETE: 0 },
    }),
    close,
  };
}

const button = (name, window) => ({
  role: "AXButton",
  name,
  ...(window ? { window } : {}),
});
const text = (name, window) => ({
  role: "AXStaticText",
  name,
  ...(window ? { window } : {}),
});
const area = (name, window) => ({
  role: "AXTextArea",
  name,
  ...(window ? { window } : {}),
});
export const finalNote = "# E2E note\n\nBeta marker\n";
export const finalMethod =
  "# Working method\n\nReview tasks each Friday. Keep notes and tasks in Markdown with task identities. Preserve task metadata and keep created and due dates distinct. Never change source originals.\n";

export function finalArtifactJourneys({ actions, seed, verifyFiles, phase }) {
  const name = `Qualification ${phase}`;
  const window = `${name} — Situate`;
  const secondary = `Secondary ${phase}`;
  const chatDraft = "Unsent qualification draft";
  const workspaceMenu = {
    role: "AXPopUpButton",
    name: "Workspace menu",
    window,
  };
  const click = async (target) =>
    actions([{ assert: target }, { click: target }]);
  const expect = async (target) => actions([{ assert: target }]);
  const navigationClick = (target) =>
    actions([{ navigation: target }, { assert: target }, { click: target }]);
  const key = async (key, modifiers = []) =>
    actions([{ key: { key, modifiers } }]);
  const fill = async (target, value) => {
    await expect(target);
    await actions([{ focus: target }]);
    await key("a", ["command"]);
    await actions([{ type: value }]);
  };
  const send = async (prompt, reply) => {
    await fill(area("Message", window), prompt);
    await click(button("Send message", window));
    await expect(text(reply, window));
  };
  async function create(workspaceName) {
    await click(
      button("Create a workspace Start fresh in a new folder on this device."),
    );
    await fill({ role: "AXTextField", name: "Workspace name" }, workspaceName);
    await click(button("Choose…"));
    await key("g", ["command", "shift"]);
    await actions([{ folderField: true }]);
    await actions([
      { type: "{{workspace}}" },
      { folderField: "{{workspace}}" },
    ]);
    await key("return");
    await click(button("Open"));
    await click(button("Create workspace"));
  }
  async function reopen(draft = "") {
    await actions([{ windows: 2 }]);
    await actions([{ navigation: workspaceMenu }, { assert: workspaceMenu }]);
    await navigationClick(button("[e2e:final-artifact-plugin-read]", window));
    await expect({
      ...area("Message", window),
      value: draft,
    });
    await expect(text("Final artifact plugin v1 verified.", window));
    await navigationClick(button("Plugins", window));
    await expect(text("Final artifact plugin", window));
    await expect(button("Disable", window));
    await navigationClick(button("Files", window));
    await click(button("e2e-note.md", window));
    await click({ role: "AXPopUpButton", name: "File actions", window });
    await click({ role: "AXMenuItem", name: "Edit source", window });
    await expect({ ...area("Markdown source", window), value: finalNote });
    await verifyFiles(name, [
      ["e2e-note.md", finalNote],
      [".situate/working-method.md", finalMethod],
    ]);
    await expect(button("OpenAI-compatible server", `${secondary} — Situate`));
  }
  return {
    async exercise() {
      await create(name);
      await click(button("OpenAI-compatible server", window));
      await fill(
        { role: "AXTextField", name: "OpenAI-compatible endpoint" },
        "{{fixture.baseUrl}}",
      );
      await fill(
        { role: "AXTextField", name: "API key or token (optional)" },
        "{{fixture.token}}",
      );
      await click({
        role: "AXCheckBox",
        name: "I understand and want to use this HTTP destination.",
      });
      await click(button("Save AI access"));
      await expect(
        text(
          "The saved chat model is unavailable or could not be read. Choose a model again.",
          window,
        ),
      );
      await click(button("Dismiss", window));
      await click({ role: "AXPopUpButton", name: "Model", window });
      await fill(
        { role: "AXTextField", name: "Model ID" },
        "{{fixture.model}}",
      );
      await click(button("Use model ID"));
      await click(button("Check and continue"));
      await click({
        role: "AXCheckBox",
        name: "Start without bringing existing content",
      });
      await fill(
        area("Anything else Situate should know?"),
        "[e2e:onboarding-method] Review tasks each Friday.",
      );
      await click(button("Start setting up my workspace"));
      await click(button("Adopt working method"));
      await click(button("Finish setup"));
      await seed(name, "seed.md", "# Synthetic seed\n");
      await navigationClick(button("New chat", window));
      await send("[e2e:create] Create e2e-note.md", "Created the note.");
      await send(
        "[e2e:edit] Replace only Alpha marker with Beta marker",
        "Updated the note.",
      );
      await navigationClick(button("Plugins", window));
      await click(button("Create a plugin", window));
      await send(
        "[e2e:final-artifact-plugin] Create and activate the synthetic plugin.",
        "Final artifact plugin activated.",
      );
      await navigationClick(button("New chat", window));
      await send(
        "[e2e:final-artifact-plugin-read]",
        "Final artifact plugin v1 verified.",
      );
      await fill(area("Message", window), chatDraft);
      await navigationClick(workspaceMenu);
      await click({ role: "AXMenuItem", name: "Open workspace…", window });
      await create(secondary);
      await expect(
        button("OpenAI-compatible server", `${secondary} — Situate`),
      );
      await actions([{ windows: 2 }]);
      // Chat drafts remain in memory; saved history must survive relaunch.
      await reopen(chatDraft);
    },
    reopen,
    async close() {
      await navigationClick(workspaceMenu);
      await click({ role: "AXMenuItem", name: "Close workspace", window });
      await expect(
        button("OpenAI-compatible server", `${secondary} — Situate`),
      );
      await key("w", ["command"]);
    },
  };
}
