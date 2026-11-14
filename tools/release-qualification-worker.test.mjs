import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { qualifyFinalArtifacts } from "./release-qualification-worker.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-qualification-worker-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configuration = join(root, "configuration.json");
  const bytes = JSON.stringify({
    schemaVersion: 1,
    qualification: { profile: "synthetic" },
  });
  writeFileSync(configuration, bytes, { mode: 0o600 });
  return { directory: root, configuration, configurationSha256: hash(bytes) };
}

test("qualification worker checks authorized bytes and passes only desktop inputs to the host", async (t) => {
  const values = fixture(t);
  const host = { synthetic: true };
  const result = await qualifyFinalArtifacts({
    ...values,
    environment: {
      PATH: "/bin",
      HOME: "/Users/runner",
      APPLE_API_PRIVATE_KEY: "not-forwarded",
      GH_TOKEN: "not-forwarded",
      WEBSITE_SSH_IDENTITY: "not-forwarded",
    },
    createHost: (configuration, options) => {
      assert.deepEqual(configuration, { profile: "synthetic" });
      assert.deepEqual(options.environment, {
        PATH: "/bin",
        HOME: "/Users/runner",
      });
      return host;
    },
    writeReceipt: async (options) => {
      assert.equal(options.qualificationHost, host);
      assert.equal(options.directory, values.directory);
      return { receipt: "synthetic" };
    },
  });
  assert.deepEqual(result, { receipt: "synthetic" });
});

test("changed or linked configuration cannot launch qualification", async (t) => {
  const values = fixture(t);
  const createHost = () =>
    assert.fail("Unauthenticated configuration must not launch a host");
  await assert.rejects(
    qualifyFinalArtifacts({
      ...values,
      configurationSha256: "a".repeat(64),
      createHost,
    }),
    /authorized plan/,
  );
  const link = join(values.directory, "linked.json");
  symlinkSync(values.configuration, link);
  await assert.rejects(
    qualifyFinalArtifacts({ ...values, configuration: link, createHost }),
    /private regular file/,
  );
});

test("malformed private JSON is reported without its contents", async (t) => {
  const values = fixture(t);
  const privateText = '{"private":"do-not-display"';
  writeFileSync(values.configuration, privateText);
  await assert.rejects(
    qualifyFinalArtifacts({
      ...values,
      configurationSha256: hash(privateText),
    }),
    (error) => {
      assert.equal(
        error.message,
        "Qualification configuration is not valid JSON",
      );
      return true;
    },
  );
});
