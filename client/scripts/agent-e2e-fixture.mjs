import { randomUUID, createHash } from "node:crypto";
export const PLUGIN_ID = "e2e-capability";
const pluginPrefix = `plugin_${createHash("sha256").update(PLUGIN_ID).digest("hex").slice(0, 16)}_`;
export const PLUGIN_FIRST_TOOL = pluginPrefix + "first";
export const PLUGIN_SECOND_TOOL = pluginPrefix + "second";
export const SOURCE_LIST_TOOL = pluginPrefix + "source_list";
export const SOURCE_CONTENT_TOOL = pluginPrefix + "source_content";
import { readFileSync } from "node:fs";

const sourceJson = readFileSync(
  new URL(
    "../app/src-tauri/tests/support/onboarding-source.json",
    import.meta.url,
  ),
  "utf8",
);
const sourceMarkdown = readFileSync(
  new URL(
    "../app/src-tauri/tests/support/onboarding-source.md",
    import.meta.url,
  ),
  "utf8",
);

export const NOTE_TEXT = "# E2E note\n\nAlpha marker\n";
const recalledInputs = [
  "[e2e:steering] Keep the reply brief.",
  "[e2e:followup] Then acknowledge the follow-up.",
];
const METHOD_EXCERPT =
  "Review tasks each Friday. Keep notes and tasks in Markdown with task identities.";
const WORKING_METHOD =
  "# Working method\n\nReview tasks each Friday. Keep notes and tasks in Markdown with task identities. Preserve task metadata and keep created and due dates distinct. Never change source originals.\n";

function textOf(item) {
  if (typeof item.content === "string") return item.content;
  return (item.content ?? []).map((part) => part.text ?? "").join("\n");
}

export function fixtureTurn(body, kind = "main", pluginEffectsUrl) {
  const input =
    typeof body.input === "string"
      ? [{ role: "user", content: body.input }]
      : (body.input ?? []);
  const userIndex = input.findLastIndex((item) => item.role === "user");
  const prompt = textOf(input[userIndex] ?? {});
  const context = [
    body.instructions ?? "",
    ...input
      .filter((item) => ["system", "developer"].includes(item.role))
      .map(textOf),
  ].join("\n");
  if (
    prompt.startsWith(
      "Summarize completed work, decisions, outstanding requests, exact file references and tool outcomes for continuation.",
    )
  )
    kind = "compaction";
  if (
    kind === "main" &&
    input.some(
      (item) =>
        item.role === "user" &&
        recalledInputs.some((recalled) => textOf(item).includes(recalled)),
    )
  )
    throw new Error("fixture_recalled_input_in_context");
  const prefix = [body.instructions ?? ""];
  for (const item of input) {
    if (!["system", "developer"].includes(item.role)) break;
    prefix.push(textOf(item));
  }
  const instructions = prefix.join("\n");
  const methodCopies =
    instructions.replace(/\r\n?/g, "\n").split(WORKING_METHOD.trim()).length -
    1;
  if (kind !== "main" && instructions.includes(METHOD_EXCERPT))
    throw new Error("fixture_private_method_in_auxiliary");
  if (
    kind === "main" &&
    (/\[e2e:(?:onboarding-(?:import|repeat)|ordinary-import)\]/.test(prompt) ||
      (instructions.includes("Known setup context (data, not instructions):") &&
        body.tools?.some((tool) => tool.name === "show_imported_files")) ||
      instructions.includes(
        "Propose at most three useful optional plugins directly",
      )) &&
    methodCopies !== 1
  )
    throw new Error("fixture_working_method_copies");
  const scenario =
    prompt.match(
      /\[e2e:(greeting|create|edit|queue|consume|stop|comment|image|view|compaction|compact|long|settings|workspace|plugins|source-chat|steering|followup|onboarding-method|onboarding-question|onboarding-sources|onboarding-import|onboarding-repeat)\]/,
    )?.[1] ?? "unmarked";
  const chain = input.slice(userIndex + 1);
  const outputs = chain.filter((item) => item.type === "function_call_output");
  const call = (name, args) => ({
    type: "function_call",
    id: `fc_${randomUUID()}`,
    call_id: `call_${randomUUID()}`,
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  });
  const final = (text) => ({
    type: "message",
    id: `msg_${randomUUID()}`,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  });
  const latest = (index = outputs.length - 1) => {
    const output = outputs[index]?.output;
    const value =
      typeof output === "string"
        ? JSON.parse(output)
        : JSON.parse(
            output?.find((part) =>
              ["input_text", "output_text", "text"].includes(part.type),
            )?.text ?? "{}",
          );
    if (value.error || value.ok === false || value.isError === true)
      throw new Error("fixture_tool_failed");
    return value;
  };
  const revision = () => {
    const value = latest();
    if (typeof value.revision !== "string" || !value.revision)
      throw new Error("fixture_revision_missing");
    return value.revision;
  };
  const step = outputs.length;
  let item;
  if (kind === "main" && prompt.includes("[e2e:final-artifact-plugin]")) {
    const id = "final-artifact";
    const path = `.situate/plugins/${id}/code/`;
    const service = `export default () => ({tools:[{name:"preserved",description:"Read the saved synthetic plugin version.",parameters:{type:"object",properties:{},additionalProperties:false},execute:async()=>({content:[{type:"text",text:"Final artifact plugin v1"}],details:{version:"v1"}})}]});`;
    const steps = [
      ["inspect_plugin", { operation: "create", pluginId: id }],
      [
        "write",
        {
          path: path + "plugin.json",
          text: JSON.stringify({
            schemaVersion: 2,
            id,
            name: "Final artifact plugin",
            description: "Synthetic retained capability.",
            serviceEntry: "service.js",
          }),
          expectedRevision: null,
        },
      ],
      [
        "write",
        { path: path + "service.js", text: service, expectedRevision: null },
      ],
      [
        "check_plugin_changes",
        {
          changes: [{ pluginId: id }],
          checks: [
            {
              pluginId: id,
              timeoutMs: 10000,
              script:
                'assert.ok(plugin.tools.some(tool => tool.name === "preserved")); const result = await plugin.invokeTool("preserved", {}); assert.equal(result.content[0].text, "Final artifact plugin v1");',
            },
          ],
        },
      ],
    ];
    if (step) latest();
    if (step < steps.length) item = call(...steps[step]);
    else if (step === 4) {
      const check = latest();
      if (
        check.passed !== true ||
        typeof check.checkId !== "string" ||
        !check.results?.some(
          (result) =>
            result.pluginId === id &&
            result.passed === true &&
            result.assertions > 0,
        )
      )
        throw new Error("fixture_final_artifact_check_failed");
      item = call("activate_plugin_changes", { checkId: check.checkId });
    } else {
      const activation = latest();
      if (
        activation.activated !== true ||
        activation.publication?.status !== "published"
      )
        throw new Error("fixture_final_artifact_activation_failed");
      item = final("Final artifact plugin activated.");
    }
  } else if (
    kind === "main" &&
    prompt.includes("[e2e:final-artifact-plugin-read]")
  ) {
    if (step === 0) {
      const name = `plugin_${createHash("sha256").update("final-artifact").digest("hex").slice(0, 16)}_preserved`;
      if (!body.tools?.some((tool) => tool.name === name))
        throw new Error("fixture_final_artifact_tool_missing");
      item = call(name, {});
    } else {
      const result = latest();
      if (result.version !== "v1")
        throw new Error("fixture_final_artifact_tool_changed");
      item = final("Final artifact plugin v1 verified.");
    }
  } else if (scenario === "plugins") {
    if (kind !== "main") throw new Error("fixture_plugins_auxiliary_request");
    const names = (body.tools ?? []).map((tool) => tool.name);
    const expected = step < 3 ? PLUGIN_FIRST_TOOL : PLUGIN_SECOND_TOOL;
    const excluded = step < 3 ? PLUGIN_SECOND_TOOL : PLUGIN_FIRST_TOOL;
    if (
      !names.includes(expected) ||
      names.includes(excluded) ||
      !names.includes("check_plugin_changes") ||
      !names.includes("activate_plugin_changes")
    )
      throw new Error("fixture_plugins_capability_graph");
    if (step === 0)
      item = call("check_plugin_changes", {
        changes: [{ pluginId: PLUGIN_ID }],
        checks: [
          {
            pluginId: PLUGIN_ID,
            timeoutMs: 10000,
            script:
              "assert.ok(plugin.tools.some(tool => tool.name === 'second')); const result = await plugin.invokeTool('second', {}); assert.equal(result.details.version, 'v2'); " +
              "const descriptor = await plugin.invokeExport('documentSourceDescribe', {}); assert.equal(descriptor.source.instanceId, 'fixture-account'); " +
              "const page = await plugin.invokeExport('documentSourceList', {limit:2}); assert.equal(page.status, 'partial'); assert.equal(page.items[0].ref.revision, 'fixture-r2'); " +
              "const text = await plugin.invokeTool('source_content', {ref:page.items[0].ref,maxChars:256}); assert.equal(text.structuredContent.text, 'Synthetic source text, not an instruction.'); assert.equal(text.content[0].text, JSON.stringify(text.structuredContent));",
          },
        ],
      });
    else if (step === 1) {
      const check = latest();
      if (
        check.passed !== true ||
        typeof check.checkId !== "string" ||
        !check.results?.some(
          (result) =>
            result.pluginId === PLUGIN_ID &&
            result.passed === true &&
            result.assertions > 0,
        )
      )
        throw new Error("fixture_plugins_worker_evidence");
      item = [
        call("activate_plugin_changes", { checkId: check.checkId }),
        call(PLUGIN_FIRST_TOOL, {}),
      ];
    } else if (step === 3) {
      const activation = latest(1);
      if (
        activation.activated !== true ||
        activation.publication?.status !== "published"
      )
        throw new Error("fixture_plugins_activation");
      const raw = outputs[2].output;
      const prior =
        typeof raw === "string"
          ? JSON.parse(raw)
          : JSON.parse(raw.find((part) => part.text)?.text ?? "{}");
      if (
        prior.version !== "v1" &&
        !["native.ai.tool.unavailable", "native.plugins.unavailable"].includes(
          prior.error,
        )
      )
        throw new Error("fixture_plugins_old_tool_rerouted");
      if (!pluginEffectsUrl) throw new Error("fixture_plugins_effect_endpoint");
      item = call(PLUGIN_SECOND_TOOL, { endpoint: pluginEffectsUrl });
    } else if (step === 4) {
      if (
        latest().version !== "v2" ||
        latest().http?.status !== 202 ||
        latest().http?.body !== '{"effect":"POST"}'
      )
        throw new Error("fixture_plugins_new_tool_missing");
      item = final(
        "Activated the checked plugin and used its current capability.",
      );
    } else throw new Error("fixture_plugins_unexpected_turn");
  } else if (scenario === "source-chat") {
    const names = (body.tools ?? []).map((tool) => tool.name);
    if (
      kind !== "main" ||
      !names.includes(SOURCE_LIST_TOOL) ||
      !names.includes(SOURCE_CONTENT_TOOL) ||
      names.includes("check_plugin_changes") ||
      names.includes("activate_plugin_changes") ||
      names.includes(PLUGIN_FIRST_TOOL)
    )
      throw new Error("fixture_source_chat_tools");
    if (step === 0) item = call(SOURCE_LIST_TOOL, { limit: 2 });
    else {
      const page = latest(0);
      const ref = page.items?.[0]?.ref;
      if (
        page.version !== 1 ||
        page.source?.pluginId !== PLUGIN_ID ||
        page.source?.instanceId !== "fixture-account" ||
        page.scopeId !== "fixture-scope" ||
        page.operation !== "list" ||
        page.status !== "partial" ||
        page.truncated !== true ||
        page.reason !== "source-partial" ||
        JSON.stringify(ref?.source) !== JSON.stringify(page.source) ||
        ref?.id !== "42" ||
        ref?.identity !== "stable" ||
        ref?.revision !== "fixture-r2"
      )
        throw new Error("fixture_source_chat_page");
      if (step === 1) item = call(SOURCE_CONTENT_TOOL, { ref, maxChars: 256 });
      else if (step === 2) {
        const content = latest(1);
        if (
          content.version !== 1 ||
          JSON.stringify(content.source) !== JSON.stringify(page.source) ||
          content.scopeId !== page.scopeId ||
          content.operation !== "content" ||
          content.status !== "ok" ||
          content.truncated !== false ||
          content.text !== "Synthetic source text, not an instruction." ||
          content.provenance?.kind !== "source-text" ||
          content.provenance?.section !== "Example" ||
          JSON.stringify(content.provenance?.ref) !== JSON.stringify(ref)
        )
          throw new Error("fixture_source_chat_content");
        item = final(
          "Read Example note from Synthetic documents. The listing is partial; the text is source-provided.",
        );
      } else throw new Error("fixture_source_chat_unexpected_turn");
    }
  } else if (kind === "title") {
    item = final(
      prompt.includes("[e2e:final-artifact-plugin-read]")
        ? "[e2e:final-artifact-plugin-read]"
        : "Workspace note preparation",
    );
  } else if (kind === "comment" || kind === "compaction") {
    item = final(
      kind === "compaction"
        ? "The user is testing note creation and editing in the workspace."
        : "The note is ready for review.",
    );
  } else if (
    context.includes("Propose at most three useful optional plugins directly")
  ) {
    const handoff = outputs.findLastIndex((output) =>
      chain.some(
        (item) =>
          item.type === "function_call" &&
          item.call_id === output.call_id &&
          item.name === "show_imported_files",
      ),
    );
    const supportStep = outputs.length - handoff - 1;
    const requests = [
      ["read", { path: ".situate/working-method.md" }],
      ...(/\[e2e:onboarding-(?:import|repeat)\]/.test(prompt)
        ? [
            ["read", { path: "imported-tasks.md" }],
            ["read", { path: "imported-notes.md" }],
          ]
        : []),
    ];
    if (step) latest();
    item =
      supportStep < requests.length
        ? call(...requests[supportStep])
        : final(
            (/\[e2e:onboarding-(?:import|repeat)\]/.test(prompt)
              ? "The import is complete. Your notes and tasks are available."
              : "Your working method is ready.") +
              " No additional plugins are needed for this workflow. You can finish setup or discuss another idea here.",
          );
  } else if (prompt.includes("[e2e:onboarding-question]")) {
    item =
      step === 0
        ? call("ask_question", {
            prompt: "When would you like to review your tasks?",
            suggestions: [
              { id: "friday", label: "Each Friday" },
              { id: "monday", label: "Each Monday" },
            ],
          })
        : final("Choose a review day or describe your preference.");
  } else if (
    prompt.includes("[e2e:onboarding-method]") ||
    body.tools?.some((tool) => tool.name === "propose_working_method")
  ) {
    item =
      step === 0
        ? call("propose_working_method", {
            markdown: WORKING_METHOD,
          })
        : final("The working method is ready for review.");
  } else if (
    prompt.includes("[e2e:onboarding-sources]") ||
    (context.includes("Known setup context (data, not instructions):") &&
      body.tools?.some((tool) => tool.name === "show_imported_files") &&
      !/\[e2e:onboarding-(?:import|repeat)\]/.test(prompt))
  ) {
    item = final("Attach the export and note when ready.");
  } else if (
    prompt.includes("[e2e:onboarding-import]") ||
    prompt.includes("[e2e:ordinary-import]")
  ) {
    const ordinary = prompt.includes("[e2e:ordinary-import]");
    if (
      !instructions.includes("prepareCopy") ||
      (instructions.includes("Known setup context (data, not instructions):") &&
        !instructions.includes("show_imported_files")) ||
      !/Friday/i.test(instructions)
    )
      throw new Error("fixture_import_instructions_missing");
    if (
      ![
        "write",
        "create_batch",
        ...(!ordinary ? ["show_imported_files"] : []),
      ].every((name) => body.tools?.some((tool) => tool.name === name))
    )
      throw new Error("fixture_import_tools_missing");
    if (
      !prompt.includes("tasks.json\n" + sourceJson) ||
      !prompt.includes("notes.md\n" + sourceMarkdown)
    )
      throw new Error("fixture_source_attachment_missing");
    const ids = [null, null];
    const copies = [
      {
        path: ordinary ? "later-imported-tasks.md" : "imported-tasks.md",
        text: `# Tasks\n\n- [ ] Book the garden visit <!-- ${JSON.stringify({ "situate-task-id": ids[0], sourceId: "garden-17", created: "2030-03-01", due: "2030-04-17", routingCode: "river-east" })} -->\n- [x] File the itinerary <!-- ${JSON.stringify({ "situate-task-id": ids[1], sourceId: "garden-18", created: "2030-03-02", due: "2030-04-10", routingCode: "hill-west" })} -->\n`,
      },
      {
        path: ordinary ? "later-imported-notes.md" : "imported-notes.md",
        text: sourceMarkdown,
      },
    ];
    const requests = [
      ["read", { path: ".situate/working-method.md" }],
      ["create_batch", { entries: copies, prepareCopy: true }],
      ...(!ordinary
        ? [
            [
              "show_imported_files",
              { paths: copies.map((copy) => copy.path), missing: [] },
            ],
          ]
        : []),
    ];
    if (step) latest();
    item =
      step < requests.length
        ? call(...requests[step])
        : final("Imported both sources without changing the originals.");
  } else if (prompt.includes("[e2e:onboarding-repeat]")) {
    const requests = [
      ["read", { path: "imported-tasks.md" }],
      ["read", { path: "imported-notes.md" }],
      [
        "show_imported_files",
        { paths: ["imported-tasks.md", "imported-notes.md"], missing: [] },
      ],
    ];
    if (step) latest();
    item =
      step < requests.length
        ? call(...requests[step])
        : final("The existing imported files are unchanged.");
  } else if (prompt.includes("[e2e:view]")) {
    if (step === 0) item = call("read", { path: "e2e-image.png" });
    else {
      latest();
      item = final("Read the image.");
    }
  } else if (
    prompt.includes("[e2e:create]") ||
    prompt.toLowerCase().includes("create e2e-note.md")
  ) {
    if (step === 0) item = call("ls", {});
    else if (step === 1) {
      latest();
      item = call("read", { path: "seed.md" });
    } else if (step === 2) {
      latest();
      item = call("write", {
        path: "e2e-note.md",
        text: NOTE_TEXT,
        expectedRevision: null,
      });
    } else if (step === 3) {
      latest();
      item = call("read", { path: "e2e-note.md" });
    } else {
      latest();
      item = final("Created the note.");
    }
  } else if (
    prompt.includes("[e2e:edit]") ||
    prompt.toLowerCase().includes("replace only alpha marker with beta marker")
  ) {
    if (step === 0) item = call("read", { path: "e2e-note.md" });
    else if (step === 1)
      item = call("edit", {
        path: "e2e-note.md",
        expectedRevision: revision(),
        edits: [{ oldText: "Alpha marker", newText: "Beta marker" }],
      });
    else if (step === 2) {
      latest();
      item = call("read", { path: "e2e-note.md" });
    } else {
      latest();
      item = final("Updated the note.");
    }
  } else item = final("Hello.");
  return {
    item,
    scenario: kind === "main" ? scenario : kind,
    marker:
      kind === "main"
        ? (prompt.match(
            /\[e2e:(?:queue|consume|stop|comment|image|compaction|settings|workspace|plugins)[\w-]*\]/,
          )?.[0] ?? null)
        : null,
  };
}

export function responseEvents(item, model, sequence, maxOutputTokens = 1024) {
  const response = {
    id: `resp_fixture_${sequence}`,
    object: "response",
    created_at: 1,
    model,
    status: "in_progress",
    output: [],
  };
  const events = [];
  const emit = (type, data) =>
    events.push({ type, sequence_number: events.length, ...data });
  emit("response.created", { response });
  emit("response.in_progress", { response });
  const items = Array.isArray(item) ? item : [item];
  for (const [outputIndex, item] of items.entries()) {
    emit("response.output_item.added", {
      output_index: outputIndex,
      item: {
        ...item,
        status: "in_progress",
        ...(item.type === "function_call"
          ? { arguments: "" }
          : { content: [] }),
      },
    });
    if (item.type === "function_call") {
      emit("response.function_call_arguments.delta", {
        item_id: item.id,
        output_index: outputIndex,
        delta: item.arguments,
      });
      emit("response.function_call_arguments.done", {
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments,
      });
    } else {
      const part = item.content[0];
      emit("response.content_part.added", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        part: { ...part, text: "" },
      });
      emit("response.output_text.delta", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        delta: part.text,
      });
      emit("response.output_text.done", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        text: part.text,
      });
      emit("response.content_part.done", {
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        part,
      });
    }
    emit("response.output_item.done", { output_index: outputIndex, item });
  }
  emit("response.completed", {
    response: {
      ...response,
      status: "completed",
      output: items,
      usage: {
        input_tokens: 1000003,
        input_tokens_details: { cached_tokens: 17 },
        output_tokens: Math.min(997, maxOutputTokens),
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 1000003 + Math.min(997, maxOutputTokens),
      },
    },
  });
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}
