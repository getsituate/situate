import { expect, test } from "vitest";
import {
  changePath,
  inspectionChanges,
  type AssignmentChange,
} from "./assignment-changes";

test("filters both rename paths, includes internal paths and keeps revision pairs separate", () => {
  const changes: AssignmentChange[] = [
    {
      id: "later",
      operation: "modified",
      attribution: "uncertain",
      before: {
        path: ".situate/source10.ts",
        revision: "r2",
        status: "available",
        text: "second",
      },
      after: {
        path: ".situate/source10.ts",
        revision: "r3",
        status: "available",
        text: "third",
      },
    },
    {
      id: "rename",
      operation: "renamed",
      attribution: "recorded",
      before: {
        path: "Notes/old.md",
        revision: "a",
        status: "available",
        text: "note",
      },
      after: {
        path: "Notes/new.md",
        revision: "b",
        status: "available",
        text: "note",
      },
    },
    {
      id: "earlier",
      operation: "modified",
      attribution: "recorded",
      before: {
        path: ".situate/source10.ts",
        revision: "r1",
        status: "available",
        text: "first",
      },
      after: {
        path: ".situate/source10.ts",
        revision: "r2",
        status: "available",
        text: "second",
      },
    },
    {
      id: "delete",
      operation: "deleted",
      attribution: "recorded",
      before: {
        path: ".situate/source2.ts",
        revision: "z",
        status: "unavailable",
      },
      after: null,
    },
  ];
  expect(
    inspectionChanges(changes, "  .SITUATE/ ").map((entry) => entry.id),
  ).toEqual(["delete", "later", "earlier"]);
  expect(inspectionChanges(changes, "OLD").map((entry) => entry.id)).toEqual([
    "rename",
  ]);
  expect(changePath(changes[3])).toBe(".situate/source2.ts");
  expect(changes[0].before?.revision).toBe("r2");
  expect(changes[2].before?.revision).toBe("r1");
  expect(changes.map((entry) => entry.id)).toEqual([
    "later",
    "rename",
    "earlier",
    "delete",
  ]);
});
