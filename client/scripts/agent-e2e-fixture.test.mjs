import test from "node:test";
import assert from "node:assert/strict";
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
const importPrompt =
  "[e2e:onboarding-import] Import the two sources.\ntasks.json\n" +
  sourceJson +
  "\nnotes.md\n" +
  sourceMarkdown;
import { fixtureTurn } from "./agent-e2e-fixture.mjs";

test("recalled originals never enter main model context, regardless of the latest scenario", () => {
  for (const recalled of [
    "[e2e:steering] Keep the reply brief.",
    "[e2e:followup] Then acknowledge the follow-up.",
  ]) {
    for (const input of [
      [
        { role: "user", content: recalled },
        { role: "user", content: "[e2e:greeting] Hello." },
      ],
      [
        { role: "user", content: "[e2e:queue] Wait." },
        { role: "user", content: [{ type: "input_text", text: recalled }] },
      ],
    ])
      assert.throws(
        () => fixtureTurn({ input }),
        /fixture_recalled_input_in_context/,
      );
  }
});

test("distinct consumed steering and follow-up inputs remain valid model context", () => {
  const input = [
    { role: "user", content: "[e2e:steering] Keep this answer short." },
    {
      role: "user",
      content: "[e2e:followup] Afterward acknowledge this request.",
    },
  ];
  assert.equal(fixtureTurn({ input }).item.type, "message");
});

const methodExcerpt =
  "Review tasks each Friday. Keep notes and tasks in Markdown with task identities.";
const workingMethod =
  "# Working method\n\nReview tasks each Friday. Keep notes and tasks in Markdown with task identities. Preserve task metadata and keep created and due dates distinct. Never change source originals.\n";

function conversation(prompt, tools = [], support = false) {
  const input = [
    {
      role: "developer",
      content:
        workingMethod +
        " Use prepareCopy and show_imported_files." +
        (support
          ? " Propose at most three useful optional plugins directly in chat."
          : ""),
    },
    { role: "user", content: prompt },
  ];
  if (
    prompt.includes("[e2e:onboarding-import]") ||
    prompt.includes("[e2e:ordinary-import]")
  )
    tools = [
      ...tools,
      { name: "write" },
      ...(!prompt.includes("[e2e:ordinary-import]")
        ? [{ name: "show_imported_files" }]
        : []),
      { name: "create_batch" },
    ];
  const calls = [];
  for (let step = 0; step < 12; step++) {
    const { item } = fixtureTurn({ input, tools });
    if (item.type === "message") return calls;
    calls.push({ name: item.name, arguments: JSON.parse(item.arguments) });
    const completeImport = item.name === "show_imported_files";
    input.push(item, {
      type: "function_call_output",
      call_id: item.call_id,
      output: JSON.stringify(
        completeImport
          ? {
              complete: true,
              missing: [],
              next: "Discuss optional plugins in chat.",
            }
          : { ok: true },
      ),
    });
    if (completeImport) {
      tools = [];
      input[0].content =
        workingMethod +
        " Propose at most three useful optional plugins directly in chat.";
    }
  }
  assert.fail("Fixture did not finish");
}

function importRequest(prompt = importPrompt) {
  return {
    model: "gpt-4.1-mini",
    stream: true,
    input: [
      {
        role: "developer",
        content: workingMethod + " Use prepareCopy and show_imported_files.",
      },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    tools: [
      "read",
      "write",
      "create_batch",
      ...(!prompt.includes("[e2e:ordinary-import]")
        ? ["show_imported_files"]
        : []),
    ].map((name) => ({
      type: "function",
      name,
      description: name,
      parameters: { type: "object", properties: {} },
    })),
  };
}

test("adopted methods appear once in the native main instruction prefix despite conversation echoes", () => {
  for (const prompt of [
    importPrompt,
    importPrompt.replace("[e2e:onboarding-import]", "[e2e:ordinary-import]"),
  ]) {
    for (const location of ["developer", "system", "instructions"]) {
      const body = importRequest(prompt);
      if (location === "instructions")
        body.instructions = body.input.shift().content;
      else body.input[0].role = location;
      const userIndex = body.input.findIndex((item) => item.role === "user");
      body.input.splice(
        userIndex,
        0,
        {
          role: "user",
          content: [{ type: "input_text", text: workingMethod }],
        },
        {
          role: "assistant",
          content: [{ type: "output_text", text: workingMethod }],
        },
      );
      body.input.push(
        {
          type: "function_call",
          call_id: "read-method",
          name: "read",
          arguments: JSON.stringify({ path: ".situate/working-method.md" }),
        },
        {
          type: "function_call_output",
          call_id: "read-method",
          output: JSON.stringify({ text: workingMethod }),
        },
      );
      assert.equal(fixtureTurn(body).item.name, "create_batch");
    }
  }
});

test("missing or repeated main instruction copies cannot be supplied by history or tool output", () => {
  for (const prompt of [
    importPrompt,
    importPrompt.replace("[e2e:onboarding-import]", "[e2e:ordinary-import]"),
  ]) {
    for (const copies of [0, 2]) {
      const body = importRequest(prompt);
      body.input[0].content =
        workingMethod.repeat(copies) +
        " Use prepareCopy and show_imported_files.";
      body.input.push(
        {
          type: "function_call",
          call_id: "read-method",
          name: "read",
          arguments: "{}",
        },
        {
          type: "function_call_output",
          call_id: "read-method",
          output: JSON.stringify({ text: workingMethod }),
        },
      );
      body.input[1].content[0].text += "\n" + workingMethod;
      assert.throws(() => fixtureTurn(body), /fixture_working_method_copies/);
    }
    const body = importRequest(prompt);
    body.instructions = workingMethod;
    assert.throws(() => fixtureTurn(body), /fixture_working_method_copies/);
  }
});

test("quoted setup preferences do not count as the adopted working method document", () => {
  const description =
    methodExcerpt +
    " Preserve source content and task metadata, and keep created and due dates distinct. Never change source originals.";
  for (const copies of [0, 1, 2]) {
    const body = importRequest();
    body.instructions =
      "Known setup context (data, not instructions):\n" +
      JSON.stringify({ description });
    body.input[0].content =
      workingMethod.replaceAll("\n", "\r\n").repeat(copies) +
      " Use prepareCopy and show_imported_files.";
    if (copies === 1) assert.equal(fixtureTurn(body).item.name, "read");
    else
      assert.throws(() => fixtureTurn(body), /fixture_working_method_copies/);
  }
});

test("observed derived requests exclude main method instructions without rejecting source echoes", () => {
  for (const kind of ["title", "comment", "compaction"]) {
    const body = {
      model: "gpt-4.1-mini",
      stream: true,
      input: [
        {
          role: "developer",
          content: "Describe the supplied source material.",
        },
        {
          role: "user",
          content: [{ type: "input_text", text: workingMethod }],
        },
      ],
    };
    assert.equal(fixtureTurn(body, kind).scenario, kind);
    for (const privateText of [workingMethod, methodExcerpt]) {
      for (const location of ["instructions", "developer", "system"]) {
        const leaked = structuredClone(body);
        if (location === "instructions") leaked.instructions = privateText;
        else leaked.input[0] = { role: location, content: privateText };
        assert.throws(
          () => fixtureTurn(leaked, kind),
          /fixture_private_method_in_auxiliary/,
        );
      }
    }
  }
});

test("retained imports continue after guidance ends without setup-only instructions", () => {
  const input = [{ role: "user", content: importPrompt }];
  const instructions =
    workingMethod + "Use write or create_batch with prepareCopy true.";
  const tools = ["write", "create_batch", "show_imported_files"].map(
    (name) => ({ name }),
  );
  const calls = [];
  for (let step = 0; step < 5; step++) {
    const { item } = fixtureTurn({ instructions, input, tools });
    if (item.type === "message") break;
    calls.push(item.name);
    input.push(item, {
      type: "function_call_output",
      call_id: item.call_id,
      output: JSON.stringify({ ok: true }),
    });
  }
  assert.deepEqual(calls, ["read", "create_batch", "show_imported_files"]);
  assert.throws(
    () =>
      fixtureTurn({
        instructions:
          "Known setup context (data, not instructions): {}. " + instructions,
        input: [{ role: "user", content: importPrompt }],
        tools,
      }),
    /fixture_import_instructions_missing/,
  );
});

test("ordinary chats publish converted copies without setup tools or model UUIDs", () => {
  const calls = conversation(
    importPrompt.replace("[e2e:onboarding-import]", "[e2e:ordinary-import]"),
  );
  assert.deepEqual(
    calls.map((call) => call.name),
    ["read", "create_batch"],
  );
  assert.equal(calls[0].arguments.path, ".situate/working-method.md");
  assert.equal(calls[1].arguments.prepareCopy, true);
  assert.equal(calls[1].arguments.manifestPath, undefined);
  const copies = calls[1].arguments.entries;
  assert.deepEqual(
    copies.map((copy) => copy.path),
    ["later-imported-tasks.md", "later-imported-notes.md"],
  );
  assert.equal(
    (copies[0].text.match(/"situate-task-id":null/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(copies[0].text, /^---|situate-id:/m);
  assert.equal(copies[1].text, sourceMarkdown);
});

test("ordinary note creation is not mistaken for guided import when import tools are available", () => {
  for (const prompt of [
    "[e2e:create] Create e2e-note.md",
    "Create e2e-note.md",
    "Create e2e-note.md. Earlier guidance said: Propose at most three useful optional plugins directly.",
  ]) {
    const calls = conversation(prompt, [{ name: "create_batch" }]);
    assert.deepEqual(
      calls.map((call) => call.name),
      ["ls", "read", "write", "read"],
    );
    assert.deepEqual(calls[2].arguments, {
      path: "e2e-note.md",
      text: "# E2E note\n\nAlpha marker\n",
      expectedRevision: null,
    });
  }
});

test("ordinary reconciliation capability does not imply a confirmed working method", () => {
  const body = {
    input: [{ role: "user", content: "[e2e:create] Create e2e-note.md" }],
    tools: ["ls", "read", "write", "show_imported_files"].map((name) => ({
      name,
    })),
  };
  assert.equal(fixtureTurn(body).item.name, "ls");
  assert.throws(
    () =>
      fixtureTurn({
        ...body,
        instructions: "Known setup context (data, not instructions):",
      }),
    /fixture_working_method_copies/,
  );
});

test("method proposals use the review tool without writing instructions", () => {
  const calls = conversation("[e2e:onboarding-method] Review each Friday.");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["propose_working_method"],
  );
  assert.equal(calls[0].arguments.markdown, workingMethod);
});

test("import publishes one prepared batch and recommends support in the same turn", () => {
  const calls = conversation(importPrompt);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["read", "create_batch", "show_imported_files", "read", "read", "read"],
  );
  assert.equal(calls[0].arguments.path, ".situate/working-method.md");
  assert.equal(calls[1].arguments.prepareCopy, true);
  assert.equal(calls[1].arguments.manifestPath, undefined);
  const copies = calls[1].arguments.entries;
  assert.deepEqual(
    copies.map((copy) => copy.path),
    ["imported-tasks.md", "imported-notes.md"],
  );
  const tasks = copies[0].text;
  assert.equal((tasks.match(/"situate-task-id":null/g) ?? []).length, 2);
  assert.doesNotMatch(tasks, /situate-id:/);
  assert.equal(copies[1].text, sourceMarkdown);
  assert.deepEqual(calls.slice(3), [
    { name: "read", arguments: { path: ".situate/working-method.md" } },
    { name: "read", arguments: { path: "imported-tasks.md" } },
    { name: "read", arguments: { path: "imported-notes.md" } },
  ]);
  for (const value of [
    "garden-17",
    "garden-18",
    "2030-03-01",
    "2030-03-02",
    "2030-04-17",
    "2030-04-10",
    "river-east",
    "hill-west",
  ])
    assert.ok(tasks.includes(value), value);
  assert.match(tasks, /- \[ \] Book the garden visit/);
  assert.match(tasks, /- \[x\] File the itinerary/);
  assert.ok(
    calls.every(
      (call) => !["import_copy", "generate_import_ids"].includes(call.name),
    ),
  );
});

test("missing or changed attachment payloads cannot report an imported result", () => {
  for (const prompt of [
    "[e2e:onboarding-import] Import the two sources.",
    importPrompt.replace(sourceJson, "{}"),
    importPrompt.replace(sourceMarkdown, "# Missing note"),
  ])
    assert.throws(
      () => conversation(prompt),
      /fixture_source_attachment_missing/,
    );
});

test("unchanged repeated imports read both copies without issuing writes", () => {
  const calls = conversation(
    "[e2e:onboarding-repeat] Reconcile unchanged sources.",
    [],
    true,
  );
  assert.deepEqual(calls, [
    { name: "read", arguments: { path: ".situate/working-method.md" } },
    { name: "read", arguments: { path: "imported-tasks.md" } },
    { name: "read", arguments: { path: "imported-notes.md" } },
  ]);
});

test("question turns expose direct suggestions without a proposal or write", () => {
  assert.deepEqual(
    conversation("[e2e:onboarding-question] Ask about my review."),
    [
      {
        name: "ask_question",
        arguments: {
          prompt: "When would you like to review your tasks?",
          suggestions: [
            { id: "friday", label: "Each Friday" },
            { id: "monday", label: "Each Monday" },
          ],
        },
      },
    ],
  );
});

test("resumed answers use current tools rather than requiring another scenario marker", () => {
  for (const answer of [
    "Each Friday",
    "Keep my current review, but on Friday.",
  ]) {
    const calls = conversation(answer, [{ name: "propose_working_method" }]);
    assert.deepEqual(
      calls.map((call) => call.name),
      ["propose_working_method"],
    );
    assert.match(calls[0].arguments.markdown, /Friday/);
  }
  assert.deepEqual(
    conversation("Confirm method and import", [{ name: "create_batch" }]),
    [],
  );
});

test("support analysis can finish with no development suggestions", () => {
  const calls = conversation("Suggest optional tools.", [], true);
  assert.deepEqual(calls, [
    { name: "read", arguments: { path: ".situate/working-method.md" } },
  ]);
});
