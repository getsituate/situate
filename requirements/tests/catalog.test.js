import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseEntry,
  validateEntries,
  loadCatalog,
} from "../scripts/catalog.js";
import { filterEntries } from "../src/filter.js";
import {
  inspectMarkdown,
  renderMarkdown,
  resolveDocumentLink,
} from "../src/markdown.js";

const goal = {
  id: "GOAL-0001",
  type: "goal",
  title: "A goal",
  status: "approved",
  area: "Planning",
  body: "A user problem",
  file: "goals/goal.md",
};
const requirement = {
  id: "REQ-0001",
  type: "requirement",
  title: "A requirement",
  status: "approved",
  area: "Planning",
  priority: "must",
  goals: ["GOAL-0001"],
  body: "A verifiable outcome",
  file: "requirements/req.md",
};

test("parses Markdown with LF and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) {
    const entry = parseEntry(
      ["---", "id: GOAL-0001", "title: Test", "---", "Description"].join(
        newline,
      ),
      "goal.md",
    );
    assert.equal(entry.id, "GOAL-0001");
    assert.equal(entry.body, "Description");
  }
});

test("rejects absent, duplicate and non-object metadata", () => {
  for (const source of [
    "# Text",
    "---\n- list\n---\nText",
    "---\nid: a\nid: b\n---\nText",
  ]) {
    assert.throws(() => parseEntry(source, "bad.md"));
  }
});

test("accepts a goal and a linked requirement", () => {
  assert.deepEqual(validateEntries([goal, requirement]), []);
});

test("rejects duplicate IDs, invalid enums and missing fields", () => {
  assert.match(validateEntries([goal, goal]).join("\n"), /Duplicate ID/);
  for (const mutation of [
    { id: "REQ-X" },
    { type: "other" },
    { title: "" },
    { area: null },
    { status: "done" },
    { priority: "urgent" },
    { goals: [] },
    { goals: "GOAL-0001" },
  ]) {
    assert.ok(
      validateEntries([goal, { ...requirement, ...mutation }]).length,
      JSON.stringify(mutation),
    );
  }
});

test("accepts decided statuses and rejects draft for both entry types", () => {
  for (const entry of [goal, requirement]) {
    for (const status of ["approved", "rejected"]) {
      const entries =
        entry.type === "goal"
          ? [{ ...entry, status }]
          : [goal, { ...entry, status }];
      assert.deepEqual(validateEntries(entries), []);
    }
    assert.match(
      validateEntries([{ ...entry, status: "draft" }]).join("\n"),
      /Invalid status/,
    );
  }
});

test("rejects requirement-only fields on goals", () => {
  for (const mutation of [
    { goals: "GOAL-0001" },
    { goals: { length: 1 } },
    { priority: "must" },
  ]) {
    assert.ok(validateEntries([{ ...goal, ...mutation }]).length);
  }
});

test("Markdown links respect code blocks, references and angle brackets", () => {
  const body =
    "```md\n[not a link](missing.md)\n```\n\n[Goal](<goal.md>)\n\n[Reference][g]\n\n[g]: other.md";
  assert.deepEqual(inspectMarkdown(body).links, ["goal.md", "other.md"]);
});

test("heading slugs and duplicate headings match generated HTML", () => {
  const body = "## Acceptance criteria\n\n## Acceptance criteria";
  assert.deepEqual(inspectMarkdown(body).headings, [
    "acceptance-criteria",
    "acceptance-criteria-1",
  ]);
  assert.match(renderMarkdown(body), /id="section-acceptance-criteria-1"/);
  assert.deepEqual(
    resolveDocumentLink("../goals/goal.md#user-problem", "requirements/req.md"),
    { file: "goals/goal.md", section: "user-problem" },
  );
  assert.throws(() => resolveDocumentLink("bad%name.md", "foundations.md"));
});

test("rejects references to missing goals or to requirements", () => {
  for (const id of ["GOAL-9999", "REQ-0001"]) {
    assert.match(
      validateEntries([goal, { ...requirement, goals: [id] }]).join("\n"),
      /Unknown goal/,
    );
  }
});

test("searches IDs, body and related goals with AND terms and combined filters", () => {
  assert.deepEqual(
    filterEntries([goal, requirement], {
      q: "VERIFIABLE outcome",
      status: "approved",
      priority: "must",
    }),
    [requirement],
  );
  assert.deepEqual(
    filterEntries([goal, requirement], { q: "GOAL-0001", type: "requirement" }),
    [requirement],
  );
  assert.deepEqual(filterEntries([goal, requirement], { area: "Other" }), []);
  assert.equal(filterEntries([goal, requirement], {}).length, 2);
});

test("loads an empty catalog and checks source links", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "requirements-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "goals"));
  await mkdir(path.join(directory, "requirements"));
  await writeFile(path.join(directory, "foundations.md"), "# Foundations");
  assert.deepEqual((await loadCatalog(directory)).entries, []);
  const source =
    "---\nid: GOAL-0001\ntype: goal\ntitle: Goal\nstatus: approved\narea: Planning\n---\n";
  await writeFile(
    path.join(directory, "goals/goal.md"),
    source + "[Foundations](../foundations.md)",
  );
  assert.equal((await loadCatalog(directory)).entries.length, 1);
  await writeFile(
    path.join(directory, "goals/goal.md"),
    source + "[Missing](../missing.md)",
  );
  await assert.rejects(loadCatalog(directory), /Unknown link target/);
  await writeFile(
    path.join(directory, "goals/goal.md"),
    source + "[Foundations](../foundations.md#missing)",
  );
  await assert.rejects(loadCatalog(directory), /Unknown section/);
  await writeFile(path.join(directory, "goals/goal.md"), source);
  await writeFile(
    path.join(directory, "foundations.md"),
    "[Link](bad%name.md)",
  );
  await assert.rejects(loadCatalog(directory), /Invalid link/);
  await writeFile(
    path.join(directory, "foundations.md"),
    "[Link][g]\n\n[g]: missing.md",
  );
  await assert.rejects(loadCatalog(directory), /Unknown link target/);
  await writeFile(
    path.join(directory, "goals/goal.md"),
    source.replace("type: goal", "type: requirement"),
  );
  await assert.rejects(loadCatalog(directory), /Wrong entry type/);
});
