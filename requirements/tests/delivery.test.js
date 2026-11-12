import test from "node:test";
import assert from "node:assert/strict";
import {
  implementationSummary,
  milestoneNames,
  milestoneScope,
} from "../src/delivery.js";
import { validateEntries } from "../scripts/catalog.js";
import { filterEntries } from "../src/filter.js";

const goal = {
  id: "GOAL-0001",
  type: "goal",
  title: "Goal",
  status: "approved",
  area: "Planning",
  body: "",
  file: "goal.md",
};
const criteria = [
  { id: "AC-01", text: "Read notes", milestone: "MVP", status: "implemented" },
  { id: "AC-02", text: "Group notes", milestone: "Later", status: "open" },
  { id: "AC-03", text: "Export notes", status: "in-progress" },
];
const requirement = {
  id: "REQ-0001",
  type: "requirement",
  title: "Notes",
  status: "approved",
  priority: "must",
  area: "Planning",
  goals: [goal.id],
  body: "",
  file: "req.md",
  acceptanceCriteria: criteria,
};

test("milestone completion is independent of overall implementation and product approval", () => {
  assert.deepEqual(implementationSummary(criteria), {
    total: 3,
    implemented: 1,
    status: "partial",
  });
  const [{ entry, criteria: scope }] = milestoneScope(
    [goal, requirement],
    "MVP",
  );
  assert.equal(entry.status, "approved");
  assert.deepEqual(implementationSummary(scope), {
    total: 1,
    implemented: 1,
    status: "implemented",
  });
  assert.deepEqual(milestoneNames([goal, requirement]), ["Later", "MVP"]);
  assert.deepEqual(milestoneScope([requirement], "")[0].criteria, [
    criteria[2],
  ]);
  assert.deepEqual(milestoneScope([requirement], "missing"), []);
});

test("milestones group criteria across requirements without duplicating other scope", () => {
  const second = {
    ...requirement,
    id: "REQ-0002",
    status: "rejected",
    acceptanceCriteria: [criteria[0]],
  };
  const groups = milestoneScope([goal, requirement, second], "MVP");
  assert.deepEqual(
    groups.map(({ entry }) => entry.id),
    ["REQ-0001", "REQ-0002"],
  );
  assert.equal(groups[1].entry.status, "rejected");
  assert.equal(
    implementationSummary(groups.flatMap(({ criteria }) => criteria)).total,
    2,
  );
  assert.deepEqual(milestoneNames([requirement, second]), ["Later", "MVP"]);
});

test("legacy requirements are untracked rather than open or completed", () => {
  const legacy = { ...requirement };
  delete legacy.acceptanceCriteria;
  assert.deepEqual(validateEntries([goal, legacy]), []);
  assert.equal(implementationSummary().status, "untracked");
  assert.deepEqual(milestoneScope([legacy], ""), []);
  assert.deepEqual(milestoneNames([legacy]), []);
  assert.equal(implementationSummary([{ status: "open" }]).status, "open");
  assert.equal(
    implementationSummary([{ status: "in-progress" }]).status,
    "in-progress",
  );
});

test("structured criteria validate with local stable IDs and optional milestones", () => {
  assert.deepEqual(validateEntries([goal, requirement]), []);
  assert.deepEqual(
    validateEntries([goal, requirement, { ...requirement, id: "REQ-0002" }]),
    [],
  );
  assert.deepEqual(filterEntries([requirement], { q: "AC-01 MVP read" }), [
    requirement,
  ]);
  assert.deepEqual(filterEntries([requirement], { q: "export notes" }), [
    requirement,
  ]);
});

test("rejects malformed criteria and duplicate Markdown sources", () => {
  for (const acceptanceCriteria of [
    null,
    {},
    [],
    [null],
    ["text"],
    [criteria[0], criteria[0]],
    ...[
      { id: "1" },
      { text: " " },
      { status: "done" },
      { status: null },
      { milestone: "" },
      { milestone: " MVP" },
      { milestone: 3 },
      { milestone: "two\nlines" },
      { milestones: ["MVP"] },
    ].map((mutation) => [{ ...criteria[0], ...mutation }]),
  ]) {
    assert.ok(
      validateEntries([goal, { ...requirement, acceptanceCriteria }]).length,
      JSON.stringify(acceptanceCriteria),
    );
  }
  assert.ok(
    validateEntries([{ ...goal, acceptanceCriteria: criteria }]).length,
  );
  assert.match(
    validateEntries([
      goal,
      { ...requirement, body: "## Acceptance criteria\n\n- Duplicated" },
    ]).join("\n"),
    /replaces/,
  );
});
