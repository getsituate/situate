import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getFileInfo } from "prettier";

const root = new URL("../", import.meta.url);
const info = (relative) =>
  getFileInfo(fileURLToPath(new URL(relative, root)), {
    ignorePath: fileURLToPath(new URL(".prettierignore", root)),
  });

test("formatting preserves hash-bound release files without excluding interface translations", async () => {
  for (const relative of [
    "releases/1.2.3/release.json",
    "client/packages/localization/src/catalogs/releases/1.2.3/en.json",
    "client/packages/localization/src/catalogs/releases/1.2.3/de.json",
  ]) {
    assert.equal((await info(relative)).ignored, true, relative);
  }
  for (const relative of [
    "client/packages/localization/src/catalogs/en.release-history.json",
    "client/packages/localization/src/catalogs/de.release-history.json",
  ]) {
    assert.equal((await info(relative)).ignored, false, relative);
  }
});
