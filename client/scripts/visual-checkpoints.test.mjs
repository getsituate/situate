import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkpointName,
  claimCheckpoint,
  visualGrep,
} from "../app/tests/browser/visual-checkpoints.mjs";

test("visual selection intersects the profile tag and user filter", () => {
  const desktop = "files-layout.spec.ts file menu 1440px @visual-desktop";
  const mobile = "files-layout.spec.ts file menu 390px @visual-mobile";
  assert.ok(visualGrep("desktop").test(desktop));
  assert.ok(!visualGrep("mobile").test(desktop));
  assert.ok(visualGrep("mobile", "file menu").test(mobile));
  assert.ok(!visualGrep("mobile", "file menu").test(desktop));
  assert.ok(!visualGrep("desktop", "unrelated").test(desktop));
  assert.ok(!visualGrep("desktop", ".*").test("ordinary untagged test"));
  assert.ok(!visualGrep("desktop").test("test @visual-desktop-extra"));
  assert.throws(() => visualGrep("desktop", "["), SyntaxError);
  assert.throws(() => visualGrep("other"), /profile/);
});

test("baseline identity uses the state, actual viewport and locale, not the test title", () => {
  assert.equal(
    checkpointName("files.document.read", { width: 390, height: 844 }, "en-US"),
    "files.document.read-390x844-en-US.png",
  );
  assert.equal(
    checkpointName(
      "files.document.read",
      { width: 1280, height: 800 },
      "de-DE",
    ),
    "files.document.read-1280x800-de-DE.png",
  );
  for (const name of ["../escape", "state/name", "", "State", "a..b"])
    assert.throws(() =>
      checkpointName(name, { width: 390, height: 844 }, "en-US"),
    );
  for (const viewport of [
    null,
    { width: 0, height: 800 },
    { width: 390.5, height: 844 },
  ])
    assert.throws(() => checkpointName("files.read", viewport, "en-US"));
  assert.throws(() =>
    checkpointName("files.read", { width: 390, height: 844 }, "../locale"),
  );
});

test("baseline updates reject duplicate writers without replacing the first owner", () => {
  const output = mkdtempSync(join(tmpdir(), "situate-checkpoints-"));
  try {
    claimCheckpoint(
      output,
      "desktop",
      "files.read-1280x800-en-US.png",
      "read test",
    );
    assert.throws(
      () =>
        claimCheckpoint(
          output,
          "desktop",
          "files.read-1280x800-en-US.png",
          "menu test",
        ),
      /read test and menu test/,
    );
    assert.throws(
      () =>
        claimCheckpoint(
          output,
          "desktop",
          "files.read-1280x800-en-US.png",
          "read test",
        ),
      /multiple writers/,
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(
            output,
            "checkpoint-owners/desktop/files.read-1280x800-en-US.png.json",
          ),
          "utf8",
        ),
      ),
      { owner: "read test" },
    );
    assert.doesNotThrow(() =>
      claimCheckpoint(
        output,
        "mobile",
        "files.read-1280x800-en-US.png",
        "mobile test",
      ),
    );
    assert.doesNotThrow(() =>
      claimCheckpoint(
        output,
        "desktop",
        "files.read-1440x900-en-US.png",
        "wide test",
      ),
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
