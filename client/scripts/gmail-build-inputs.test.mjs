import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  gmailBuildInputs,
  withGmailBuildInputs,
} from "./gmail-build-inputs.mjs";

const id = "SITUATE_GMAIL_TEST_CLIENT_ID";
const secret = "SITUATE_GMAIL_TEST_CLIENT_SECRET";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gmail-build-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("local builds read only the two private dotenv inputs and preserve explicit empty values", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, ".env"),
    `${id}='synthetic-client'\n${secret}=synthetic-desktop\nOTHER_SECRET=not-forwarded\n`,
    { mode: 0o600 },
  );
  assert.deepEqual(gmailBuildInputs(root, {}), [
    "synthetic-client",
    "synthetic-desktop",
  ]);
  assert.deepEqual(
    gmailBuildInputs(root, { [id]: "", OTHER_SECRET: "not-forwarded" }),
    ["", "synthetic-desktop"],
  );
});

test("CI uses only explicit inputs even when a local dotenv file exists", (t) => {
  const root = fixture(t);
  writeFileSync(
    join(root, ".env"),
    `${id}=local-id\n${secret}=local-secret\n`,
    { mode: 0o600 },
  );
  assert.deepEqual(gmailBuildInputs(root, { CI: "true" }), ["", ""]);
  assert.deepEqual(
    gmailBuildInputs(root, {
      CI: "true",
      [id]: "hosted-id",
      [secret]: "hosted-secret",
    }),
    ["hosted-id", "hosted-secret"],
  );
});

test("release builds receive a private temporary file and bypass shared compiler caches", async (t) => {
  const root = fixture(t);
  let path;
  await assert.rejects(
    withGmailBuildInputs(
      root,
      ["synthetic-id", "synthetic-desktop"],
      (environment) => {
        path = environment.SITUATE_GMAIL_BUILD_INPUT;
        assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), [
          "synthetic-id",
          "synthetic-desktop",
        ]);
        if (process.platform !== "win32")
          assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.equal(environment[secret], undefined);
        assert.equal(environment.RUSTC_WRAPPER, "");
        assert.equal(environment.RUSTC_WORKSPACE_WRAPPER, "");
        throw new Error("synthetic build interruption");
      },
    ),
    /synthetic build interruption/,
  );
  assert.equal(existsSync(path), false);
});
