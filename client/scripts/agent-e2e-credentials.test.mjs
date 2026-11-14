import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAgentTestKey,
  readAgentKeyFile,
  validateCredentialFile,
} from "./agent-e2e-credentials.mjs";

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "situate-test-key-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const create = (directory, text) =>
  writeFile(join(directory, ".env"), text, { mode: 0o600 });

test("dotenv loading consumes only the test key without evaluating or merging other values", async () => {
  await withDirectory(async (directory) => {
    const marker = join(directory, "must-not-exist");
    const environment = Object.freeze({ UNRELATED: "original" });
    await create(
      directory,
      `TEST_OPENAI_API_KEY="synthetic-test-key"\nUNRELATED=replaced\nNODE_OPTIONS=unsafe\nCOMMAND=$(touch ${marker})\n`,
    );
    assert.equal(
      await loadAgentTestKey({ environment, directory }),
      "synthetic-test-key",
    );
    assert.deepEqual(environment, { UNRELATED: "original" });
    await assert.rejects(access(marker));
    await create(directory, "TEST_OPENAI_API_KEY='$(not-a-command)'\n");
    assert.equal(await readAgentKeyFile(directory), "$(not-a-command)");
  });
});

test("environment property takes precedence including empty or undefined; CI never looks up the file", async () => {
  let lookedUp = false;
  const readFile = async () => {
    lookedUp = true;
    throw new Error("should not read");
  };
  for (const environment of [
    { TEST_OPENAI_API_KEY: "from-environment" },
    { TEST_OPENAI_API_KEY: "from-environment", CI: "true" },
  ])
    assert.equal(
      await loadAgentTestKey({ environment, readFile }),
      "from-environment",
    );
  for (const environment of [
    { TEST_OPENAI_API_KEY: "" },
    { TEST_OPENAI_API_KEY: "  " },
    { TEST_OPENAI_API_KEY: undefined },
    { CI: "true" },
  ])
    await assert.rejects(
      loadAgentTestKey({ environment, readFile }),
      /missing-TEST_OPENAI_API_KEY/,
    );
  assert.equal(lookedUp, false);
});

test("missing files and absent test keys fail without accepting ordinary provider credentials", async () => {
  await withDirectory(async (directory) => {
    const environment = { OPENAI_API_KEY: "not-the-test-key" };
    await assert.rejects(
      loadAgentTestKey({ environment, directory }),
      /missing-TEST_OPENAI_API_KEY/,
    );
    await create(directory, "OPENAI_API_KEY=not-the-test-key\n");
    await assert.rejects(
      loadAgentTestKey({ environment, directory }),
      /missing-TEST_OPENAI_API_KEY/,
    );
  });
});

test("credential files require ordinary single-link private owned files and bounded size", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, ".env");
    await mkdir(path);
    await assert.rejects(
      readAgentKeyFile(directory),
      /unsafe-agent-test-key-file/,
    );
    await rm(path, { recursive: true });
    const target = join(directory, "synthetic-key");
    await writeFile(target, "TEST_OPENAI_API_KEY=synthetic-secret", {
      mode: 0o600,
    });
    await symlink(target, path);
    await assert.rejects(
      readAgentKeyFile(directory),
      /unsafe-agent-test-key-file/,
    );
    await rm(path);
    await link(target, path);
    await assert.rejects(
      readAgentKeyFile(directory),
      /unsafe-agent-test-key-file/,
    );
    await rm(path);
    const prefix = "TEST_OPENAI_API_KEY=synthetic-boundary\n#";
    await create(
      directory,
      prefix + "x".repeat(2 * 1024 * 1024 - prefix.length),
    );
    assert.equal(await readAgentKeyFile(directory), "synthetic-boundary");
    await create(directory, "x".repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(
      readAgentKeyFile(directory),
      /unsafe-agent-test-key-file/,
    );
    await create(directory, "TEST_OPENAI_API_KEY=synthetic-secret\n");
    const metadata = await lstat(path);
    assert.throws(
      () =>
        validateCredentialFile(metadata, {
          platform: "darwin",
          uid: metadata.uid + 1,
        }),
      /unsafe-agent-test-key-file/,
    );
    if (process.platform !== "win32") {
      await chmod(path, 0o644);
      await assert.rejects(
        readAgentKeyFile(directory),
        /unsafe-agent-test-key-file/,
      );
    }
  });
});

test("file safety failures expose neither supplied content nor file paths", async () => {
  await withDirectory(async (directory) => {
    await create(
      directory,
      `TEST_OPENAI_API_KEY=synthetic-private-value\n${"x".repeat(2 * 1024 * 1024)}`,
    );
    await assert.rejects(readAgentKeyFile(directory), (error) => {
      assert.equal(error.outcome, "blocked");
      assert.ok(!error.message.includes("synthetic-private-value"));
      assert.ok(!error.message.includes(directory));
      return true;
    });
  });
});
