import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { context } from "./ci-publish.mjs";
import {
  main,
  receiverSource,
  transfer,
  transferIdentity,
  transportConfiguration,
} from "./ci-image-transport.mjs";

function fixture(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-image-transfer-test-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const receiver = join(directory, "receiver");
  mkdirSync(source);
  mkdirSync(receiver, { mode: 0o750 });
  const identity = join(directory, "identity");
  const knownHosts = join(directory, "known_hosts");
  writeFileSync(identity, "synthetic-private-key\n", { mode: 0o600 });
  writeFileSync(knownHosts, "fixture.invalid synthetic-pinned-host\n", {
    mode: 0o600,
  });
  const environment = {
    GITHUB_REPOSITORY: "getsituate/situate",
    GITHUB_REPOSITORY_ID: "123",
    GITHUB_RUN_ID: "42",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "push",
    GITHUB_SHA: "a".repeat(40),
    WORKFLOW_SHA: "b".repeat(40),
    RUNNER_TEMP: directory,
    CI_IMAGE_TRANSFER_HOST: "ci-image-upload@fixture.invalid",
    CI_IMAGE_TRANSFER_SSH_IDENTITY: identity,
    CI_IMAGE_TRANSFER_KNOWN_HOSTS: knownHosts,
  };
  const archive = Buffer.from("Synthetic image archive; never executable");
  writeFileSync(join(source, "image.tar"), archive);
  const provenance = {
    version: 1,
    ...context(environment),
    revision: environment.GITHUB_SHA,
    inputsSha256: "c".repeat(64),
    imageId: `sha256:${"d".repeat(64)}`,
    configDigest: `sha256:${"d".repeat(64)}`,
    bytes: archive.length,
    archiveSha256: createHash("sha256").update(archive).digest("hex"),
  };
  const program = `${receiverSource}\nreceive(pathlib.Path(sys.argv[3]), sys.argv[1:3])`;
  const remote = (_configuration, mode, id) =>
    spawn("python3", ["-B", "-c", program, mode, id, receiver], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  return {
    directory,
    source,
    receiver,
    environment,
    provenance,
    archive,
    program,
    remote,
  };
}
test("exact run/source fingerprint transfers immutable data without Actions APIs or executing image bytes", async (t) => {
  const f = fixture(t);
  const options = { environment: f.environment, remote: f.remote };
  const uploaded = await transfer("upload", f.source, f.provenance, options);
  assert.equal(uploaded.transfer, transferIdentity(f.provenance));
  const stored = join(f.receiver, uploaded.transfer);
  assert.deepEqual(readdirSync(stored).sort(), [
    "image.tar",
    "provenance.json",
  ]);
  assert.deepEqual(readFileSync(join(stored, "image.tar")), f.archive);
  const destination = join(f.directory, "downloaded");
  await transfer("download", destination, f.provenance, options);
  assert.deepEqual(readFileSync(join(destination, "image.tar")), f.archive);
  await Promise.all([
    transfer("upload", f.source, f.provenance, options),
    transfer("upload", f.source, f.provenance, options),
  ]);
  assert.deepEqual(
    readdirSync(f.receiver).sort(),
    [".transfer.lock", uploaded.transfer].sort(),
  );
  assert.notEqual(
    transferIdentity({ ...f.provenance, attempt: "3" }),
    uploaded.transfer,
  );
  assert.notEqual(
    transferIdentity({ ...f.provenance, revision: "f".repeat(40) }),
    uploaded.transfer,
  );
});
test("receiver rejects truncated/oversized/mismatched frames and leaves no finalized data", (t) => {
  const f = fixture(t);
  const id = transferIdentity(f.provenance);
  for (const [meta, archive] of [
    [f.provenance, f.archive.subarray(1)],
    [{ ...f.provenance, bytes: 8 * 1024 ** 3 + 1 }, Buffer.alloc(0)],
    [{ ...f.provenance, repository: "attacker/fork" }, f.archive],
    [f.provenance, Buffer.concat([f.archive, Buffer.from("extra")])],
  ]) {
    const result = spawnSync(
      "python3",
      ["-B", "-c", f.program, "upload", id, f.receiver],
      {
        input: Buffer.concat([
          Buffer.from(`${JSON.stringify(meta)}\n`),
          archive,
        ]),
      },
    );
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(f.receiver), []);
  }
});
test("modified or linked remote data cannot be downloaded or silently replaced", async (t) => {
  const f = fixture(t);
  const options = { environment: f.environment, remote: f.remote };
  await transfer("upload", f.source, f.provenance, options);
  const stored = join(f.receiver, transferIdentity(f.provenance));
  writeFileSync(join(stored, "image.tar"), "modified-data");
  const download = join(f.directory, "corrupt-download");
  await assert.rejects(
    transfer("download", download, f.provenance, options),
    /transfer failed|Truncated/,
  );
  assert.equal(existsSync(download), false);
  await assert.rejects(
    transfer("upload", f.source, f.provenance, options),
    /transfer failed/,
  );
  assert.equal(
    readFileSync(join(stored, "image.tar"), "utf8"),
    "modified-data",
  );
  rmSync(join(stored, "image.tar"));
  symlinkSync(join(f.source, "image.tar"), join(stored, "image.tar"));
  await assert.rejects(transfer("download", download, f.provenance, options));
  assert.equal(existsSync(download), false);
});
test("local data/config validation precedes SSH and preserves exact repository/event/source checks", async (t) => {
  const f = fixture(t);
  const remote = () => assert.fail("Invalid input reached SSH");
  await assert.rejects(
    transfer(
      "upload",
      f.source,
      { ...f.provenance, revision: "f".repeat(40) },
      { environment: f.environment, remote },
    ),
    /source differs/,
  );
  await assert.rejects(
    transfer("upload", f.source, f.provenance, {
      environment: { ...f.environment, GITHUB_REF: "refs/heads/untrusted" },
      remote,
    }),
    /main-branch/,
  );
  assert.throws(
    () =>
      transportConfiguration({
        ...f.environment,
        CI_IMAGE_TRANSFER_HOST: "root@fixture.invalid",
      }),
    /isolated/,
  );
  assert.throws(
    () =>
      transportConfiguration({
        ...f.environment,
        CI_IMAGE_TRANSFER_HOST: "ci@fixture.invalid;command",
      }),
    /isolated/,
  );
  await assert.rejects(
    main(["gate"], { ...f.environment, CI_IMAGE_TRANSFER_HOST: "" }),
    /isolated/,
  );
  writeFileSync(join(f.source, "image.tar"), "different");
  await assert.rejects(
    transfer("upload", f.source, f.provenance, {
      environment: f.environment,
      remote,
    }),
    /differs before upload/,
  );
});
test("local commands use explicit identities and files without GitHub event variables", async (t) => {
  const f = fixture(t);
  const metadata = join(f.directory, "provenance.json");
  writeFileSync(metadata, JSON.stringify(f.provenance));
  const flags = [
    "--provenance",
    metadata,
    "--repository-id",
    "123",
    "--run-id",
    "42",
    "--attempt",
    "2",
    "--workflow-sha",
    "b".repeat(40),
    "--source",
    "a".repeat(40),
    "--host",
    f.environment.CI_IMAGE_TRANSFER_HOST,
    "--identity",
    f.environment.CI_IMAGE_TRANSFER_SSH_IDENTITY,
    "--known-hosts",
    f.environment.CI_IMAGE_TRANSFER_KNOWN_HOSTS,
  ];
  await main(["upload", f.source, ...flags], {}, { remote: f.remote });
  const downloaded = join(f.directory, "local-download");
  await main(["download", downloaded, ...flags], {}, { remote: f.remote });
  assert.deepEqual(readFileSync(join(downloaded, "image.tar")), f.archive);
  await assert.rejects(
    main(["upload", f.source, "--run-id", "42"], {}, { remote: f.remote }),
    /exact repository/,
  );
});

test("operation-scoped transfer keys become private files and are removed after success or failure", async (t) => {
  const f = fixture(t);
  const env = {
    ...f.environment,
    PROVENANCE: JSON.stringify(f.provenance),
    CI_IMAGE_TRANSFER_SSH_PRIVATE_KEY: "synthetic-step-private-key",
    CI_IMAGE_TRANSFER_SSH_KNOWN_HOSTS: "fixture.invalid synthetic-pinned-host",
  };
  const paths = [];
  const remote = (configuration, ...args) => {
    paths.push(configuration.identity, configuration.knownHosts);
    assert.equal(lstatSync(configuration.identity).mode & 0o777, 0o600);
    assert.equal(lstatSync(configuration.knownHosts).mode & 0o777, 0o600);
    assert.equal(
      readFileSync(configuration.identity, "utf8"),
      "synthetic-step-private-key\n",
    );
    return f.remote(configuration, ...args);
  };
  await main(["upload", f.source], env, { remote });
  assert.ok(paths.every((path) => !existsSync(path)));
  await assert.rejects(
    main(
      ["download", join(f.directory, "bad-download")],
      {
        ...env,
        PROVENANCE: JSON.stringify({
          ...f.provenance,
          inputsSha256: "e".repeat(64),
        }),
      },
      { remote },
    ),
  );
  assert.ok(paths.every((path) => !existsSync(path)));
  assert.equal(
    readdirSync(f.directory).some((name) =>
      name.startsWith("situate-ci-image-ssh-"),
    ),
    false,
  );
});
