import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkProject } from "./localization-check.mjs";

test("product sources, browser fixtures, and all locale catalogs pass localization validation", () => {
  const errors = checkProject(fileURLToPath(new URL("../", import.meta.url)));
  assert.deepEqual(errors, [], errors.join("\n"));
});
