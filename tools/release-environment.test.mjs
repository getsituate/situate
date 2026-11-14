import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { releaseEnvironment, withReleaseSSH } from "./release-environment.mjs";

const key = "synthetic private contents\nline two\n";
const hosts = "synthetic.invalid synthetic-host-contents\n";
const raw = {
  SITUATE_RELEASE_SSH_PRIVATE_KEY: key,
  SITUATE_RELEASE_SSH_KNOWN_HOSTS: hosts,
};
function fixture(t, contents) {
  const root = mkdtempSync(join(tmpdir(), "situate-release-env-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "client"));
  if (contents !== undefined)
    writeFileSync(join(root, ".env"), contents, { mode: 0o600 });
  return root;
}

test("selected local inputs preserve bytes without forwarding unrelated secrets", async (t) => {
  const root = fixture(
    t,
    `SITUATE_RELEASE_SSH_PRIVATE_KEY="${key}"\nSITUATE_RELEASE_SSH_KNOWN_HOSTS="${hosts}"\nAPPLE_API_KEY=apple-secret\nGH_TOKEN=github-secret\nCONFIG_SECRET=config-secret\nWEBSITE_DEPLOY_HOST=synthetic.invalid\n`,
  );
  assert.deepEqual(releaseEnvironment(root, ["WEBSITE_DEPLOY_HOST"], {}), {
    WEBSITE_DEPLOY_HOST: "synthetic.invalid",
  });
  assert.deepEqual(
    releaseEnvironment(root, ["WEBSITE_DEPLOY_HOST"], {
      WEBSITE_DEPLOY_HOST: "",
    }),
    { WEBSITE_DEPLOY_HOST: "" },
  );
  for (const environment of [{}, raw]) {
    let paths;
    await withReleaseSSH({ root, environment }, async (prepared) => {
      paths = [prepared.WEBSITE_SSH_IDENTITY, prepared.WEBSITE_SSH_KNOWN_HOSTS];
      assert.deepEqual(Object.keys(prepared).sort(), [
        "WEBSITE_SSH_IDENTITY",
        "WEBSITE_SSH_KNOWN_HOSTS",
      ]);
      assert.equal(readFileSync(paths[0], "utf8"), key);
      assert.equal(readFileSync(paths[1], "utf8"), hosts);
      assert.equal(statSync(dirname(paths[0])).mode & 0o777, 0o700);
      for (const path of paths)
        assert.equal(statSync(path).mode & 0o777, 0o600);
      await Promise.resolve();
      assert(paths.every(existsSync));
    });
    assert(paths.every((path) => !existsSync(path)));
    assert(!existsSync(dirname(paths[0])));
  }
  assert.deepEqual(raw, {
    SITUATE_RELEASE_SSH_PRIVATE_KEY: key,
    SITUATE_RELEASE_SSH_KNOWN_HOSTS: hosts,
  });
});

test("blank local SSH templates retain agent defaults but explicit empty raw inputs do not fall back", async (t) => {
  const root = fixture(
    t,
    "SITUATE_RELEASE_SSH_PRIVATE_KEY=\nSITUATE_RELEASE_SSH_KNOWN_HOSTS=\nWEBSITE_SSH_IDENTITY=\nWEBSITE_SSH_KNOWN_HOSTS=\n",
  );
  await withReleaseSSH({ root, environment: {} }, (prepared) => {
    assert.equal(prepared.SITUATE_RELEASE_SSH_PRIVATE_KEY, undefined);
    assert.equal(prepared.SITUATE_RELEASE_SSH_KNOWN_HOSTS, undefined);
    assert(!prepared.WEBSITE_SSH_IDENTITY);
    assert(!prepared.WEBSITE_SSH_KNOWN_HOSTS);
  });
  await assert.rejects(
    withReleaseSSH(
      { root, environment: { SITUATE_RELEASE_SSH_PRIVATE_KEY: "" } },
      () => assert.fail("empty explicit credentials used"),
    ),
    /nonempty/,
  );
  writeFileSync(
    join(root, ".env"),
    `SITUATE_RELEASE_SSH_PRIVATE_KEY="${key}"\nSITUATE_RELEASE_SSH_KNOWN_HOSTS=\n`,
  );
  await assert.rejects(
    withReleaseSSH({ root, environment: {} }, () =>
      assert.fail("incomplete raw pair used"),
    ),
    /nonempty/,
  );
});

test("CI and fully explicit inputs never read unsafe local dotenv", async (t) => {
  const root = fixture(t, "WEBSITE_DEPLOY_HOST=local.invalid\n");
  chmodSync(join(root, ".env"), 0o644);
  assert.deepEqual(
    releaseEnvironment(root, ["WEBSITE_DEPLOY_HOST"], { CI: "true" }),
    {},
  );
  assert.deepEqual(
    releaseEnvironment(root, ["WEBSITE_DEPLOY_HOST"], {
      WEBSITE_DEPLOY_HOST: "",
    }),
    { WEBSITE_DEPLOY_HOST: "" },
  );
  await withReleaseSSH({ root, environment: raw }, () => {});
  assert.throws(
    () => releaseEnvironment(root, ["WEBSITE_DEPLOY_HOST"], {}),
    /owned, private regular file/,
  );
  rmSync(join(root, ".env"));
  symlinkSync(join(root, "missing"), join(root, ".env"));
  assert.throws(
    () => releaseEnvironment(root, ["WEBSITE_DEPLOY_HOST"], {}),
    /owned, private regular file/,
  );
  await withReleaseSSH({ root, environment: { CI: "1" } }, (prepared) =>
    assert.deepEqual(prepared, { CI: "1" }),
  );
});

test("explicit alias families do not fall back to the other local family", async (t) => {
  const root = fixture(
    t,
    `SITUATE_RELEASE_SSH_PRIVATE_KEY="${key}"\nSITUATE_RELEASE_SSH_KNOWN_HOSTS="${hosts}"\nWEBSITE_SSH_IDENTITY=local-identity\nWEBSITE_SSH_KNOWN_HOSTS=local-hosts\n`,
  );
  await withReleaseSSH(
    { root, environment: { WEBSITE_SSH_IDENTITY: "explicit-identity" } },
    (prepared) => {
      assert.deepEqual(prepared, {
        WEBSITE_SSH_IDENTITY: "explicit-identity",
        WEBSITE_SSH_KNOWN_HOSTS: "local-hosts",
      });
    },
  );
  await withReleaseSSH({ root, environment: raw }, (prepared) =>
    assert.notEqual(prepared.WEBSITE_SSH_IDENTITY, "local-identity"),
  );
  await assert.rejects(
    withReleaseSSH(
      { root, environment: { SITUATE_RELEASE_SSH_PRIVATE_KEY: "" } },
      () => assert.fail("invalid credentials used"),
    ),
    /nonempty/,
  );
  await assert.rejects(
    withReleaseSSH({ root, environment: {} }, () =>
      assert.fail("ambiguous credentials used"),
    ),
    /not both/,
  );
});

test("invalid raw credentials fail before the callback or filesystem materialization", async (t) => {
  const root = fixture(t);
  for (const value of [
    "",
    "nul\0value",
    "x".repeat(1024 * 1024 + 1),
    undefined,
    42,
  ]) {
    for (const name of Object.keys(raw)) {
      await assert.rejects(
        withReleaseSSH({ root, environment: { ...raw, [name]: value } }, () =>
          assert.fail("invalid credentials used"),
        ),
        /nonempty, NUL-free/,
      );
    }
  }
  await assert.rejects(
    withReleaseSSH(
      { root, environment: { ...raw, WEBSITE_SSH_IDENTITY: "legacy" } },
      () => assert.fail("ambiguous credentials used"),
    ),
    /not both/,
  );
});

test("cleanup covers synchronous throws and rejected promises without removing legacy files", async (t) => {
  const root = fixture(t);
  for (const asynchronous of [false, true]) {
    let path;
    await assert.rejects(
      withReleaseSSH({ root, environment: raw }, (prepared) => {
        path = prepared.WEBSITE_SSH_IDENTITY;
        if (asynchronous) return Promise.reject(new Error("callback failed"));
        throw new Error("callback failed");
      }),
      /callback failed/,
    );
    assert(!existsSync(dirname(path)));
  }
  const identity = join(root, "identity");
  const knownHosts = join(root, "known_hosts");
  writeFileSync(identity, key);
  writeFileSync(knownHosts, hosts);
  const environment = {
    WEBSITE_SSH_IDENTITY: identity,
    WEBSITE_SSH_KNOWN_HOSTS: knownHosts,
  };
  await assert.rejects(
    withReleaseSSH({ root, environment }, (prepared) => {
      assert.deepEqual(prepared, environment);
      throw new Error("legacy callback failed");
    }),
    /legacy callback failed/,
  );
  assert.equal(readFileSync(identity, "utf8"), key);
  assert.equal(readFileSync(knownHosts, "utf8"), hosts);
});
